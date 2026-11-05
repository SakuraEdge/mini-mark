using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Moye;

static class UpdateTests {
    private const string Primary = "https://raw.githubusercontent.com/SakuraEdge/mini-mark/updates/stable.json";
    private const string Fallback = "https://github.com/SakuraEdge/mini-mark/releases/latest/download/update.json";
    public static async Task Run(string root, Action<bool, string> check) {
        var bytes = Encoding.UTF8.GetBytes("verified installer fixture");
        var manifest = new UpdateManifest(1, "2.0.0", new UpdateAsset("https://github.com/SakuraEdge/moye-markdown/releases/download/v2.0.0/Moye-Setup-2.0.0-windows-x64.exe", Convert.ToHexString(SHA256.HashData(bytes)), bytes.Length));
        var branded = manifest with { WindowsV2 = manifest.Windows with { Url = "https://github.com/SakuraEdge/mini-mark/releases/download/v2.0.0/MiniMark-Setup-2.0.0-windows-x64.exe" } };
        branded.Validate();
        check(branded.DownloadAsset.Url.Contains("/mini-mark/"), "New updater did not select branded installer");
        check(UpdateManifest.Parse(JsonSerializer.SerializeToUtf8Bytes(manifest, UpdateManifest.JsonOptions)).DownloadAsset == manifest.Windows, "Legacy update feed was rejected");
        try { (branded with { WindowsV2 = branded.WindowsV2! with { Size = 1 } }).Validate(); throw new Exception("Mismatched compatible assets accepted"); }
        catch (IOException) { check(true, "Mismatched compatible assets rejected"); }
        HttpResponseMessage Manifest() => new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(manifest, UpdateManifest.JsonOptions)) };
        var handler = new FakeUpdateHandler(_ => Manifest());
        var folder = Path.Combine(root, "updates");
        var updater = new GitHubUpdates(folder, handler);
        var results = await Task.WhenAll(updater.Check(), updater.Check());
        check(handler.Uris.SequenceEqual(new[] { Primary }), "Concurrent checks did not merge or used the wrong endpoint");
        check(handler.NoAuthentication, "Public feed requested authentication");
        check(results[0].Manifest.Releases[0].GetProperty("tag_name").GetString() == "v2.0.0", "Release version was lost");
        await updater.Check();
        check(handler.Uris.Count == 1, "Immediate repeat did not use short cache");
        var fallback = new FakeUpdateHandler(uri => uri == Primary ? new(HttpStatusCode.Forbidden) : Manifest());
        var checkedFallback = await new GitHubUpdates(Path.Combine(root, "fallback"), fallback).Check();
        check(!checkedFallback.OfflineCache && fallback.Uris.SequenceEqual(new[] { Primary, Fallback }), "Primary failure did not use public release fallback");
        var offline = await new GitHubUpdates(folder, new FakeUpdateHandler(_ => new(HttpStatusCode.ServiceUnavailable))).Check();
        check(offline.OfflineCache && offline.CacheNotice!.Contains("检测记录") && offline.Manifest.Version == "2.0.0", "Offline result was not clearly marked");
        async Task ExpectFailure(Func<Task> action, string message) {
            try { await action(); } catch (IOException) { check(true, message); return; }
            throw new Exception(message);
        }
        await ExpectFailure(() => new GitHubUpdates(Path.Combine(root, "missing"), new FakeUpdateHandler(_ => new(HttpStatusCode.Forbidden))).Check(), "Missing cache allowed a false successful check");
        await ExpectFailure(() => new GitHubUpdates(Path.Combine(root, "invalid-json"), new FakeUpdateHandler(_ => new(HttpStatusCode.OK) { Content = new StringContent("{broken") })).Check(), "Invalid JSON accepted");
        await ExpectFailure(() => new GitHubUpdates(Path.Combine(root, "oversized"), new FakeUpdateHandler(_ => new(HttpStatusCode.OK) { Content = new StringContent(new string(' ', 65537)) })).Check(), "Unbounded manifest accepted");
        var redirect = new FakeUpdateHandler(_ => { var response = new HttpResponseMessage(HttpStatusCode.Redirect); response.Headers.Location = new Uri("https://example.com/setup.exe"); return response; });
        await ExpectFailure(() => new GitHubUpdates(Path.Combine(root, "redirect"), redirect).Check(), "Untrusted redirect accepted");
        check(redirect.Uris.All(uri => uri == Primary || uri == Fallback), "Request reached an untrusted host");
        foreach (var invalid in new[] {
            manifest with { SchemaVersion = 2 }, manifest with { Version = "02.0.0" },
            manifest with { Version = "2.0.0-beta" }, manifest with { Version = "2.0" },
            manifest with { Windows = manifest.Windows with { Url = "https://example.com/setup.exe" } },
            manifest with { Windows = manifest.Windows with { Size = 0 } },
            manifest with { Windows = manifest.Windows with { Size = UpdateManifest.MaximumInstallerBytes + 1 } },
            manifest with { Windows = manifest.Windows with { Sha256 = "invalid" } }
        }) {
            try { invalid.Validate(); throw new Exception("Invalid release metadata accepted"); } catch (IOException) { check(true, "Invalid metadata rejected"); }
        }
        var assetHandler = new FakeUpdateHandler(uri => uri == manifest.Windows.Url ? new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) } : Manifest());
        var downloader = new GitHubUpdates(Path.Combine(root, "download"), assetHandler);
        await downloader.Check();
        await ExpectFailure(() => downloader.DownloadInstaller("v3.0.0", new Progress<int>(), default), "Renderer could choose an unverified release");
        var downloaded = await downloader.DownloadInstaller("v2.0.0", new Progress<int>(), default);
        check(await GitHubUpdates.VerifyInstaller(downloaded.Path, downloaded.Asset, default), "Verified installer download failed");
        check(GitHubUpdates.VerifyBeforeLaunch(downloaded), "Pre-launch verification failed");
        await downloader.DownloadInstaller("v2.0.0", new Progress<int>(), default);
        check(assetHandler.Uris.Count == 2, "Verified cached installer was downloaded again");
        File.WriteAllBytes(downloaded.Path, new byte[bytes.Length]);
        check(!GitHubUpdates.VerifyBeforeLaunch(downloaded), "Tampered installer passed pre-launch verification");
        var corruptFolder = Path.Combine(root, "corrupt-download");
        var corrupt = new GitHubUpdates(corruptFolder, new FakeUpdateHandler(uri => uri == manifest.Windows.Url ? new(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[bytes.Length]) } : Manifest()));
        await corrupt.Check();
        await ExpectFailure(() => corrupt.DownloadInstaller("v2.0.0", new Progress<int>(), default), "Corrupt installer accepted");
        check(!Directory.EnumerateFiles(Path.Combine(corruptFolder, "Updates")).Any(), "Failed download left an executable or partial file");
        var cancelFolder = Path.Combine(root, "canceled-download");
        var cancelUpdater = new GitHubUpdates(cancelFolder, assetHandler);
        await cancelUpdater.Check();
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        try { await cancelUpdater.DownloadInstaller("v2.0.0", new Progress<int>(), cancellation.Token); throw new Exception("Canceled download completed"); }
        catch (OperationCanceledException) { check(!Directory.EnumerateFiles(Path.Combine(cancelFolder, "Updates")).Any(), "Canceled download left temporary files"); }
    }
}

sealed class FakeUpdateHandler(Func<string, HttpResponseMessage> respond) : HttpMessageHandler {
    public List<string> Uris { get; } = [];
    public bool NoAuthentication { get; private set; } = true;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
        var uri = request.RequestUri!.AbsoluteUri;
        Uris.Add(uri);
        NoAuthentication &= request.Headers.Authorization is null;
        await Task.Delay(20, cancellationToken);
        return respond(uri);
    }
}
