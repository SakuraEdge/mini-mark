using System.Net;
using System.Net.Http;
using System.Text.Json;

namespace Moye;

public sealed class GitHubUpdates {
    private readonly HttpClient client;
    private Task<JsonElement>? pending;
    public GitHubUpdates(string dataRoot, HttpMessageHandler? handler = null) {
        client = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Moye/1.0.0");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        client.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
    }
    public async Task<JsonElement> Check() {
        var task = pending;
        if (task is null || task.IsCompleted) pending = task = Fetch();
        try { return await task; }
        finally { if (ReferenceEquals(pending, task)) pending = null; }
    }
    private async Task<JsonElement> Fetch() {
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/repos/SakuraEdge/moye-markdown/releases?per_page=100");
        try {
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if (response.StatusCode == HttpStatusCode.NotFound) throw new IOException("暂时找不到 GitHub 发布信息，请稍后重试。");
            if (response.StatusCode == HttpStatusCode.Forbidden || (int)response.StatusCode == 429) throw new IOException("GitHub 请求次数受限，请稍后重试。");
            if (!response.IsSuccessStatusCode) throw new IOException($"GitHub 暂时不可用（HTTP {(int)response.StatusCode}）。");
            if (response.Content.Headers.ContentLength > 4 * 1024 * 1024) throw new IOException("GitHub 版本列表过大。");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            int read;
            while ((read = await stream.ReadAsync(chunk, timeout.Token)) > 0) {
                if (buffer.Length + read > 4 * 1024 * 1024) throw new IOException("GitHub 版本列表过大。");
                buffer.Write(chunk, 0, read);
            }
            using var json = JsonDocument.Parse(buffer.ToArray());
            if (json.RootElement.ValueKind != JsonValueKind.Array) throw new IOException("GitHub 返回的版本列表无效。");
            // Only expose version metadata to the renderer, never credentials or request headers.
            return JsonSerializer.SerializeToElement(json.RootElement.EnumerateArray().Select(r => new {
                tag_name = r.GetProperty("tag_name").GetString(),
                draft = r.GetProperty("draft").GetBoolean(),
                prerelease = r.GetProperty("prerelease").GetBoolean()
            }));
        } catch (OperationCanceledException) { throw new IOException("连接 GitHub 超时，请稍后重试。"); }
        catch (HttpRequestException) { throw new IOException("无法连接 GitHub，请检查网络后重试。"); }
        catch (JsonException) { throw new IOException("GitHub 返回的版本信息无法读取。"); }
    }
}
