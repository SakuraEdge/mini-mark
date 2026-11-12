using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Moye;

public sealed partial class GitHubCloud {
    private readonly HttpClient http;
    private readonly ICloudTokenStore store;
    private readonly Func<string> clientId;
    private CloudCredential? credential;
    private string? login;
    private bool loaded, needsPersistence;
    private DateTimeOffset verifiedAt;
    private int generation;
    private DeviceLogin? device;
    private readonly SemaphoreSlim pollGate = new(1);
    private readonly object authLock = new();
    private Task<CloudCredential>? refreshing;
    private sealed record DeviceLogin(string ClientId, string Code, DateTimeOffset Expires, int Interval, DateTimeOffset NextPoll);
    private sealed class ApiError(HttpStatusCode status, string message) : IOException(message) { public HttpStatusCode Status { get; } = status; }
    private sealed class LoginRequired() : IOException("GitHub 登录已失效，请重新登录。");

    public GitHubCloud(ICloudTokenStore store, Func<string> clientId, HttpClient? http = null) {
        this.store = store; this.clientId = clientId;
        this.http = http ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(30) };
    }
    public static string ReadClientId(string root) {
        var value = Environment.GetEnvironmentVariable("MINIMARK_GITHUB_CLIENT_ID");
        var path = Path.Combine(root, "github-oauth.json");
        if (value is null && File.Exists(path)) {
            using var json = JsonDocument.Parse(File.ReadAllText(path));
            value = json.RootElement.TryGetProperty("clientId", out var id) ? id.GetString() : null;
        }
        return value?.Trim() ?? "";
    }
    private void Load() { lock (authLock) { if (!loaded) { credential = CloudCredential.Read(store.Read()); loaded = true; } } }
    private void CheckGeneration(int value) { if (value != generation) throw new IOException("登录状态已改变，请重新操作。"); }
    private void AdvanceGeneration() { generation++; refreshing = null; }
    private LoginRequired Invalidate(int epoch, CloudCredential expected) {
        lock (authLock) {
            CheckGeneration(epoch);
            if (credential == expected) {
                AdvanceGeneration(); credential = null; login = null; verifiedAt = default; loaded = true; needsPersistence = false;
                store.Clear();
            }
        }
        return new LoginRequired();
    }
    private async Task<CloudCredential> AccessCredential(string? rejectedToken = null) {
        Load();
        TaskCompletionSource<CloudCredential>? completion = null;
        Task<CloudCredential> task;
        CloudCredential current;
        string? expectedLogin;
        int epoch;
        lock (authLock) {
            current = credential ?? throw new LoginRequired();
            if (needsPersistence) { store.Write(current.Serialize()); needsPersistence = false; }
            epoch = generation; expectedLogin = current.Account ?? login;
            var rejected = rejectedToken == current.AccessToken;
            var expiring = current.AccessExpiresAt is DateTimeOffset expires && expires <= DateTimeOffset.UtcNow.AddSeconds(60);
            if (refreshing is null && !rejected && !expiring) return current;
            if (refreshing is null && (current.RefreshToken is null || current.RefreshExpiresAt <= DateTimeOffset.UtcNow)) {
                if (!rejected && current.AccessExpiresAt > DateTimeOffset.UtcNow) return current;
                throw Invalidate(epoch, current);
            }
            if (refreshing is null) {
                completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
                refreshing = completion.Task;
            }
            task = refreshing;
        }
        if (completion is not null) _ = CompleteRefresh(current, expectedLogin, epoch, completion);
        var result = await task;
        CheckGeneration(epoch);
        return result;
    }
    private async Task CompleteRefresh(CloudCredential previous, string? expectedLogin, int epoch, TaskCompletionSource<CloudCredential> completion) {
        try {
            var id = previous.ClientId ?? clientId();
            if (string.IsNullOrWhiteSpace(id)) throw new IOException("此安装包尚未配置 GitHub 登录。");
            var response = await OAuth("oauth/access_token", new() { ["client_id"] = id, ["grant_type"] = "refresh_token", ["refresh_token"] = previous.RefreshToken! });
            CheckGeneration(epoch);
            if (response.TryGetProperty("error", out var error)) {
                if (error.GetString() is "bad_refresh_token" or "invalid_grant") throw Invalidate(epoch, previous);
                throw new IOException("暂时无法刷新 GitHub 登录，请稍后重试。");
            }
            var next = CloudCredential.FromResponse(response, id, DateTimeOffset.UtcNow, requireRefresh: true) with { Account = expectedLogin };
            lock (authLock) {
                CheckGeneration(epoch);
                // Rotation invalidates the old pair; preserve the new pair before account verification can fail offline.
                credential = next; login = null; verifiedAt = default; needsPersistence = true;
                store.Write(next.Serialize()); needsPersistence = false;
            }
            JsonElement user;
            try { user = await Request(HttpMethod.Get, "https://api.github.com/user", null, next.AccessToken); }
            catch (ApiError rejected) when (rejected.Status == HttpStatusCode.Unauthorized) { throw Invalidate(epoch, next); }
            lock (authLock) {
                CheckGeneration(epoch);
                var account = user.GetProperty("login").GetString()!;
                if (expectedLogin is not null && !string.Equals(expectedLogin, account, StringComparison.OrdinalIgnoreCase)) throw Invalidate(epoch, next);
                if (next.Account is null) {
                    next = next with { Account = account }; credential = next; needsPersistence = true;
                    store.Write(next.Serialize()); needsPersistence = false;
                }
                login = account; verifiedAt = DateTimeOffset.UtcNow;
            }
            completion.TrySetResult(next);
        } catch (Exception error) { completion.TrySetException(error); }
        finally { lock (authLock) { if (ReferenceEquals(refreshing, completion.Task)) refreshing = null; } }
    }
    private async Task<string> Account(string? expected = null) {
        var epoch = generation;
        await AccessCredential();
        CheckGeneration(epoch);
        if (login is null || DateTimeOffset.UtcNow - verifiedAt > TimeSpan.FromMinutes(1)) {
            var user = await Api(HttpMethod.Get, "user");
            lock (authLock) {
                CheckGeneration(epoch);
                var account = user.GetProperty("login").GetString()!;
                if (credential?.Account is string saved && !string.Equals(saved, account, StringComparison.OrdinalIgnoreCase))
                    throw Invalidate(epoch, credential);
                login = account; verifiedAt = DateTimeOffset.UtcNow;
            }
        }
        if (expected is not null && !string.Equals(expected, login, StringComparison.OrdinalIgnoreCase))
            throw new IOException($"此文档属于 GitHub 账号 {expected}，请切换账号后再保存。");
        return login;
    }
    private string Repo(string owner) => $"repos/{Uri.EscapeDataString(owner)}/MiniMarkDisk";
    public async Task<object> Execute(JsonElement body) {
        var action = body.GetProperty("action").GetString();
        string Value(string key) => body.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : "";
        switch (action) {
            case "status":
                Load();
                if (credential is null) return new { authenticated = false, configured = clientId().Length > 0 };
                verifiedAt = default;
                try { return new { authenticated = true, configured = clientId().Length > 0, login = await Account() }; }
                catch (LoginRequired) { return new { authenticated = false, configured = clientId().Length > 0 }; }
            case "startLogin": return await StartLogin();
            case "pollLogin": return await PollLogin();
            case "cancelLogin": lock (authLock) { AdvanceGeneration(); device = null; } return new { cancelled = true };
            case "logout":
                lock (authLock) {
                    AdvanceGeneration(); device = null; credential = null; login = null; loaded = false; needsPersistence = false;
                    store.Clear(); loaded = true;
                }
                return new { authenticated = false, configured = clientId().Length > 0 };
            case "repository": {
                var owner = await Account();
                try {
                    var repo = await Api(HttpMethod.Get, Repo(owner));
                    return new { exists = true, owner, defaultBranch = repo.GetProperty("default_branch").GetString(), @private = repo.GetProperty("private").GetBoolean() };
                } catch (ApiError error) when (error.Status == HttpStatusCode.NotFound) { return new { exists = false, owner }; }
            }
            case "createRepository": {
                var owner = await Account();
                var repo = await Api(HttpMethod.Post, "user/repos", new { name = "MiniMarkDisk", @private = true, auto_init = true, description = "Mini Mark documents" });
                return new { exists = true, owner, defaultBranch = repo.GetProperty("default_branch").GetString(), @private = repo.GetProperty("private").GetBoolean() };
            }
            case "list": {
                var owner = await Account(Value("owner"));
                var path = Value("path");
                if (path.Length > 0) CloudPaths.Validate(path, true);
                JsonElement result;
                try { result = await Api(HttpMethod.Get, $"{Repo(owner)}/contents/{CloudPaths.Encode(path)}"); }
                catch (ApiError error) when (path.Length == 0 && error.Status == HttpStatusCode.NotFound) {
                    await Api(HttpMethod.Get, Repo(owner));
                    return new { entries = Array.Empty<object>(), path };
                }
                if (result.ValueKind != JsonValueKind.Array) throw new IOException("该路径不是文件夹。");
                var entries = result.EnumerateArray().Where(item => item.GetProperty("name").GetString() != ".gitkeep")
                    .Select(item => new { name = item.GetProperty("name").GetString(), path = item.GetProperty("path").GetString(), type = item.GetProperty("type").GetString(), sha = item.GetProperty("sha").GetString(), size = item.GetProperty("size").GetInt64() })
                    .Where(item => item.type == "dir" || item.type == "file" && IsDocument(item.path!)).ToArray();
                return new { entries, path };
            }
            case "read": return await Read(Value("owner"), Value("path"));
            case "write": return await Write(Value("owner"), Value("path"), Value("text"), Value("sha") is "" ? null : Value("sha"));
            case "delete": return await Delete(Value("owner"), Value("path"), Value("sha"), Value("entryType"));
            case "folder": {
                var owner = await Account(Value("owner"));
                var path = CloudPaths.Validate(Value("path"), true);
                var result = await Api(HttpMethod.Put, $"{Repo(owner)}/contents/{CloudPaths.Encode(path)}/.gitkeep", new { message = $"Create folder {path}", content = "" });
                return new { path, sha = result.GetProperty("content").GetProperty("sha").GetString() };
            }
            default: throw new IOException("未知的云文档操作。");
        }
    }
    public async Task<CloudFile> Read(string owner, string path) {
        path = CloudPaths.Validate(path);
        owner = await Account(owner);
        var metadata = await Api(HttpMethod.Get, $"{Repo(owner)}/contents/{CloudPaths.Encode(path)}", accept: "application/vnd.github.object+json");
        if (metadata.ValueKind != JsonValueKind.Object || metadata.GetProperty("type").GetString() != "file" ||
            metadata.TryGetProperty("target", out _) || metadata.TryGetProperty("submodule_git_url", out _) ||
            metadata.GetProperty("size").GetInt64() > CloudPaths.MaxBytes) throw new IOException("只能打开不超过 5 MB 的普通文本文档。");
        var sha = metadata.GetProperty("sha").GetString()!;
        if (!CloudPaths.IsSha(sha)) throw new IOException("GitHub 返回的文件版本无效。");
        var blob = await Api(HttpMethod.Get, $"{Repo(owner)}/git/blobs/{sha}");
        if (blob.GetProperty("encoding").GetString() != "base64" || blob.GetProperty("sha").GetString() != sha || blob.GetProperty("size").GetInt64() > CloudPaths.MaxBytes) throw new IOException("无法读取云端文本。");
        var epoch = generation;
        var text = await Task.Run(() => {
            var bytes = Convert.FromBase64String(blob.GetProperty("content").GetString()!);
            if (bytes.Length > CloudPaths.MaxBytes) throw new IOException("文件超过 5 MB。");
            var value = new UTF8Encoding(false, true).GetString(bytes).TrimStart('\uFEFF');
            CloudPaths.CheckText(value);
            return DocumentStore.Normalize(value);
        });
        CheckGeneration(epoch);
        return new(path, sha, text);
    }
    public async Task<CloudWrite> Write(string owner, string path, string text, string? sha) {
        path = CloudPaths.Validate(path); CloudPaths.CheckText(text);
        if (sha is not null && !CloudPaths.IsSha(sha)) throw new IOException("云文档版本无效，请重新打开。");
        var epoch = generation;
        var encoded = await Task.Run(() => Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
        CheckGeneration(epoch);
        owner = await Account(owner);
        var payload = new Dictionary<string, object> { ["message"] = $"Update {path} via Mini Mark", ["content"] = encoded };
        if (sha is not null) payload["sha"] = sha;
        var result = await Api(HttpMethod.Put, $"{Repo(owner)}/contents/{CloudPaths.Encode(path)}", payload);
        var next = result.GetProperty("content").GetProperty("sha").GetString();
        if (!CloudPaths.IsSha(next)) throw new IOException("保存结果无法确认，请刷新云端后核对。");
        return new(path, next!);
    }
    private static bool IsDocument(string path) { try { CloudPaths.Validate(path); return true; } catch (IOException) { return false; } }
    private async Task<object> StartLogin() {
        var id = clientId();
        if (id.Length == 0) throw new IOException("此安装包尚未配置 GitHub 登录。请联系 Mini Mark 维护者。");
        int epoch;
        lock (authLock) { AdvanceGeneration(); epoch = generation; device = null; }
        var result = await OAuth("device/code", new() { ["client_id"] = id, ["scope"] = "repo" });
        CheckGeneration(epoch);
        if (result.TryGetProperty("error", out _)) throw new IOException("GitHub 登录不可用，请检查应用的设备授权设置。");
        var seconds = result.GetProperty("expires_in").GetInt32();
        var interval = Math.Max(5, result.GetProperty("interval").GetInt32());
        var uri = result.GetProperty("verification_uri").GetString();
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var address) || address.Scheme != "https" || address.Host != "github.com") throw new IOException("GitHub 登录地址无效。");
        device = new(id, result.GetProperty("device_code").GetString()!, DateTimeOffset.UtcNow.AddSeconds(seconds), interval, DateTimeOffset.UtcNow.AddSeconds(interval));
        return new { userCode = result.GetProperty("user_code").GetString(), verificationUri = uri, interval, expiresIn = seconds };
    }
    private async Task<object> PollLogin() {
        if (!await pollGate.WaitAsync(0)) throw new IOException("正在检查登录状态。");
        try {
            var pending = device ?? throw new IOException("登录已取消，请重新登录。");
            if (pending.Expires <= DateTimeOffset.UtcNow) { device = null; throw new IOException("登录授权已过期，请重新登录。"); }
            if (pending.NextPoll > DateTimeOffset.UtcNow) return new { pending = true, interval = pending.Interval };
            var epoch = generation;
            var result = await OAuth("oauth/access_token", new() { ["client_id"] = pending.ClientId, ["device_code"] = pending.Code, ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code" });
            CheckGeneration(epoch);
            if (result.TryGetProperty("error", out var error)) {
                if (error.GetString() is "authorization_pending" or "slow_down") {
                    var interval = pending.Interval + (error.GetString() == "slow_down" ? 5 : 0);
                    device = pending with { Interval = interval, NextPoll = DateTimeOffset.UtcNow.AddSeconds(interval) };
                    return new { pending = true, interval };
                }
                device = null; throw new IOException(error.GetString() == "access_denied" ? "已拒绝 GitHub 授权。" : "GitHub 授权已失效，请重新登录。");
            }
            var candidate = CloudCredential.FromResponse(result, pending.ClientId, DateTimeOffset.UtcNow);
            var user = await Request(HttpMethod.Get, "https://api.github.com/user", null, candidate.AccessToken);
            CheckGeneration(epoch);
            var account = user.GetProperty("login").GetString()!;
            candidate = candidate with { Account = account };
            lock (authLock) {
                CheckGeneration(epoch);
                store.Write(candidate.Serialize()); AdvanceGeneration(); credential = candidate; login = account; loaded = true; needsPersistence = false; device = null; verifiedAt = DateTimeOffset.UtcNow;
            }
            return new { authenticated = true, login, configured = true };
        } finally { pollGate.Release(); }
    }
    private async Task<JsonElement> OAuth(string endpoint, Dictionary<string, string> values) {
        using var content = new FormUrlEncodedContent(values);
        return await Request(HttpMethod.Post, "https://github.com/login/" + endpoint, content, null, oauth: true);
    }
    private async Task<JsonElement> Api(HttpMethod method, string path, object? body = null, string accept = "application/vnd.github+json") {
        var epoch = generation;
        var current = await AccessCredential();
        for (var attempt = 0; ; attempt++) {
            CheckGeneration(epoch);
            using var content = body is null ? null : new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            try {
                var result = await Request(method, "https://api.github.com/" + path, content, current.AccessToken, accept);
                CheckGeneration(epoch); return result;
            } catch (ApiError error) when (error.Status == HttpStatusCode.Unauthorized) {
                CheckGeneration(epoch);
                if (attempt > 0) throw Invalidate(epoch, current);
                current = await AccessCredential(current.AccessToken);
            }
        }
    }
    private async Task<JsonElement> Request(HttpMethod method, string url, HttpContent? content, string? bearer, string accept = "application/json", bool oauth = false) {
        using var request = new HttpRequestMessage(method, url) { Content = content };
        request.Headers.UserAgent.ParseAdd("MiniMark/1.0");
        request.Headers.Accept.ParseAdd(accept);
        if (bearer is not null) {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        }
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        var oauthError = oauth && response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized;
        if (!response.IsSuccessStatusCode && !oauthError) {
            var message = response.StatusCode switch {
                HttpStatusCode.Unauthorized => "GitHub 登录已失效，请退出后重新登录。",
                HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests => "GitHub 暂时拒绝访问，请检查仓库权限或稍后重试。",
                HttpStatusCode.NotFound => "云端文件或仓库不存在，或当前账号没有访问权限。",
                HttpStatusCode.Conflict or HttpStatusCode.UnprocessableEntity => "云端内容已改变或路径已存在。未覆盖云端文件，请重新打开或使用其他名称。",
                _ => $"GitHub 请求失败（{(int)response.StatusCode}），文档尚未同步。"
            };
            throw new ApiError(response.StatusCode, message);
        }
        if (response.Content.Headers.ContentLength > 8 * 1024 * 1024) throw new IOException("GitHub 响应超过大小限制。");
        await using var stream = await response.Content.ReadAsStreamAsync();
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        int count;
        while ((count = await stream.ReadAsync(chunk, timeout.Token)) > 0) {
            if (buffer.Length + count > 8 * 1024 * 1024) throw new IOException("GitHub 响应超过大小限制。");
            buffer.Write(chunk, 0, count);
        }
        var data = buffer.ToArray();
        var result = await Task.Run(() => {
            using var json = JsonDocument.Parse(data);
            return json.RootElement.Clone();
        });
        if (oauthError && (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty("error", out _))) throw new IOException("GitHub 授权请求失败，请稍后重试。");
        return result;
    }
}
