using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;

namespace Moye;

public sealed class GitHubUpdates {
    private static readonly string[] Feeds = [
        "https://raw.githubusercontent.com/SakuraEdge/mini-mark/updates/rev-stable.json",
        "https://github.com/SakuraEdge/mini-mark/releases/latest/download/update.json"
    ];
    private readonly HttpClient client;
    private readonly string cacheFile, downloadDirectory;
    private Task<UpdateCheck>? pending;
    private UpdateCheck? lastResult;
    public GitHubUpdates(string dataRoot, HttpMessageHandler? handler = null) {
        cacheFile = Path.Combine(dataRoot, "update-cache.json");
        downloadDirectory = Path.Combine(dataRoot, "Updates");
        client = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("MiniMark/" + (typeof(GitHubUpdates).Assembly.GetName().Version?.ToString(3) ?? "2.0.0"));
    }
    public async Task<UpdateCheck> Check() {
        if (lastResult is { OfflineCache: false } cached && DateTimeOffset.UtcNow >= cached.CheckedAt && DateTimeOffset.UtcNow - cached.CheckedAt < TimeSpan.FromSeconds(10)) return cached;
        var task = pending;
        if (task is null || task.IsCompleted) pending = task = Fetch();
        try { return await task; }
        finally { if (ReferenceEquals(pending, task)) pending = null; }
    }
    private async Task<UpdateCheck> Fetch() {
        foreach (var feed in Feeds) {
            try {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(7));
                using var response = await Get(new Uri(feed), timeout.Token);
                var bytes = await ReadLimited(response, 64 * 1024, timeout.Token);
                var manifest = UpdateManifest.Parse(bytes);
                lastResult = new UpdateCheck(manifest, DateTimeOffset.UtcNow, false);
                try {
                    Directory.CreateDirectory(Path.GetDirectoryName(cacheFile)!);
                    DocumentStore.AtomicWrite(cacheFile, JsonSerializer.SerializeToUtf8Bytes(lastResult, UpdateManifest.JsonOptions));
                } catch (IOException) { } catch (UnauthorizedAccessException) { }
                return lastResult;
            } catch (Exception error) when (error is HttpRequestException or IOException or JsonException or OperationCanceledException) { }
        }
        try {
            var cached = JsonSerializer.Deserialize<UpdateCheck>(File.ReadAllBytes(cacheFile), UpdateManifest.JsonOptions);
            if (cached?.Manifest is not null && cached.CheckedAt <= DateTimeOffset.UtcNow.AddMinutes(1)) {
                cached.Manifest.Validate();
                return lastResult = cached with { OfflineCache = true };
            }
        } catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException) { }
        throw new IOException("暂时无法连接更新服务，请检查网络后重试。");
    }
    private async Task<HttpResponseMessage> Get(Uri uri, CancellationToken cancellation) {
        for (var hop = 0; hop < 5; hop++) {
            if (uri.Scheme != "https" || !new[] { "github.com", "raw.githubusercontent.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com" }.Contains(uri.Host))
                throw new IOException("更新服务重定向到不受信任的地址。");
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
            if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308) {
                var next = response.Headers.Location; response.Dispose();
                if (next is null) throw new IOException("更新地址无效。");
                uri = new Uri(uri, next); continue;
            }
            if (!response.IsSuccessStatusCode) { var status = (int)response.StatusCode; response.Dispose(); throw new IOException($"更新服务暂不可用（HTTP {status}）。"); }
            return response;
        }
        throw new IOException("更新服务重定向过多。");
    }
    private static async Task<byte[]> ReadLimited(HttpResponseMessage response, long limit, CancellationToken cancellation) {
        if (response.Content.Headers.ContentLength > limit) throw new IOException("更新响应超出大小限制。");
        await using var input = await response.Content.ReadAsStreamAsync(cancellation);
        using var output = new MemoryStream();
        var buffer = new byte[8192]; int count;
        while ((count = await input.ReadAsync(buffer, cancellation)) > 0) {
            if (output.Length + count > limit) throw new IOException("更新响应超出大小限制。");
            output.Write(buffer, 0, count);
        }
        return output.ToArray();
    }
    public async Task<DownloadedInstaller> DownloadInstaller(string tag, IProgress<int> progress, CancellationToken cancellation) {
        var manifest = lastResult?.Manifest ?? throw new IOException("请先检测更新。");
        manifest.Validate();
        var installed = typeof(GitHubUpdates).Assembly.GetName().Version ?? new Version(2, 0, 0);
        if (tag != manifest.ReleaseTag || new Version(manifest.Version) <= new Version(installed.Major, installed.Minor, installed.Build)) throw new IOException("此版本不高于当前版本，请重新检测更新。");
        Directory.CreateDirectory(downloadDirectory);
        var asset = manifest.DownloadAsset;
        var target = Path.Combine(downloadDirectory, "Moye-Update.exe");
        if (await VerifyInstaller(target, asset, cancellation)) return new(target, asset);
        var temporary = target + ".part";
        try {
            using var response = await Get(new Uri(asset.Url), cancellation);
            if (response.Content.Headers.ContentLength is long declared && declared != asset.Size) throw new IOException("安装包大小与发布清单不一致。");
            await using (var input = await response.Content.ReadAsStreamAsync(cancellation))
            await using (var output = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true)) {
                var buffer = new byte[81920]; long received = 0; int count, reported = -1;
                while ((count = await input.ReadAsync(buffer, cancellation)) > 0) {
                    received += count;
                    if (received > asset.Size) throw new IOException("安装包超出发布大小。");
                    await output.WriteAsync(buffer.AsMemory(0, count), cancellation);
                    var percent = (int)(received * 100 / asset.Size);
                    if (percent != reported) { reported = percent; progress.Report(percent); }
                }
                await output.FlushAsync(cancellation);
            }
            if (!await VerifyInstaller(temporary, asset, cancellation)) throw new IOException("安装包 SHA-256 校验失败，请重试。");
            File.Move(temporary, target, true);
            return new(target, asset);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public static async Task<bool> VerifyInstaller(string file, UpdateAsset asset, CancellationToken cancellation) {
        if (!File.Exists(file) || new FileInfo(file).Length != asset.Size) return false;
        await using var stream = File.OpenRead(file);
        var hash = await SHA256.HashDataAsync(stream, cancellation);
        return Convert.ToHexString(hash).Equals(asset.Sha256, StringComparison.OrdinalIgnoreCase);
    }
    public static bool VerifyBeforeLaunch(DownloadedInstaller installer) {
        if (!File.Exists(installer.Path) || new FileInfo(installer.Path).Length != installer.Asset.Size) return false;
        using var stream = File.OpenRead(installer.Path);
        return Convert.ToHexString(SHA256.HashData(stream)).Equals(installer.Asset.Sha256, StringComparison.OrdinalIgnoreCase);
    }
}
