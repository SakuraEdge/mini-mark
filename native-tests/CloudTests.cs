using System.Net;
using System.Text;
using System.Text.Json;
using Moye;

static class CloudTests {
    private const string Token = "cloud-test-token";
    private const string Sha = "0123456789abcdef0123456789abcdef01234567";
    private const string NextSha = "abcdef0123456789abcdef0123456789abcdef01";
    private static JsonElement Body(object value) => JsonSerializer.SerializeToElement(value);
    private static JsonElement Result(object value) => JsonSerializer.SerializeToElement(value);
    private static HttpResponseMessage Json(object value) => new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(value)) };
    private static HttpResponseMessage User() => Json(new { login = "alice" });
    private static GitHubCloud Client(CloudTestHandler handler, MemoryCloudTokenStore? store = null) =>
        new(store ?? new(Token), () => "test-client-id", new HttpClient(handler));

    private static async Task<Exception> Fails(Func<Task> action, Action<bool, string> check, string message) {
        try { await action(); }
        catch (Exception error) when (error is IOException or OperationCanceledException or DecoderFallbackException) {
            check(true, message); return error;
        }
        throw new Exception(message);
    }

    public static async Task Run(string folder, Action<bool, string> check) {
        Paths(check);
        Configuration(folder, check);
        await Authentication(check);
        await DeviceFlow(check);
        await CloudRefreshTests.Run(check);
        await Contents(check);
        await Failures(check);
        await LogoutRace(check);
        Workspace(folder, check);
    }

    private static void Configuration(string folder, Action<bool, string> check) {
        const string variable = "MINIMARK_GITHUB_CLIENT_ID";
        var original = Environment.GetEnvironmentVariable(variable);
        var root = Path.Combine(folder, "cloud-config");
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "github-oauth.json"), """{"clientId":"packaged-test-client"}""");
        try {
            Environment.SetEnvironmentVariable(variable, null);
            check(GitHubCloud.ReadClientId(root) == "packaged-test-client", "Packaged public OAuth Client ID was not loaded");
            Environment.SetEnvironmentVariable(variable, "  override-test-client  ");
            check(GitHubCloud.ReadClientId(root) == "override-test-client", "Explicit OAuth Client ID did not override packaged configuration");
            Environment.SetEnvironmentVariable(variable, " \t ");
            check(GitHubCloud.ReadClientId(root) == "", "Explicit blank OAuth override fell back to packaged configuration");
        } finally {
            Environment.SetEnvironmentVariable(variable, original);
        }
    }

    private static void Paths(Action<bool, string> check) {
        foreach (var path in new[] {
            "", "../note.md", "/note.md", "notes/../note.md", "notes/./note.md", "notes//note.md",
            "notes\\note.md", "C:/note.md", ".git/config.md", "notes/.GIT/config.md", "note.md?x=1",
            "note.md#anchor", "notes/\0.md", "notes/\n.md", "notes/", "photo.png", "program.exe"
        }) {
            try { CloudPaths.Validate(path); throw new Exception("Unsafe or unsupported cloud path accepted: " + path); }
            catch (IOException) { check(true, "Unsafe cloud path rejected"); }
        }
        foreach (var extension in new[] { "md", "markdown", "mdown", "txt", "yaml", "yml", "html", "htm", "MD" })
            check(CloudPaths.Validate("资料/文件." + extension) == "资料/文件." + extension, "Supported cloud format rejected");
        check(CloudPaths.Validate("目录/子目录", true) == "目录/子目录", "Cloud folder rejected");
        check(CloudPaths.Encode("notes/a b%20.md") == "notes/a%20b%2520.md", "Cloud path was not segment encoded");
        check(CloudPaths.IsSha(Sha) && CloudPaths.IsSha(new string('a', 64)), "Valid Git SHA rejected");
        check(!CloudPaths.IsSha("../blob") && !CloudPaths.IsSha(new string('z', 40)) && !CloudPaths.IsSha(null), "Invalid Git SHA accepted");
        CloudPaths.CheckText(new string('x', CloudPaths.MaxBytes));
        check(true, "Exact UTF-8 byte limit rejected");
        foreach (var text in new[] { new string('x', CloudPaths.MaxBytes + 1), new string('中', CloudPaths.MaxBytes / 3 + 1), "text\0binary" }) {
            try { CloudPaths.CheckText(text); throw new Exception("Oversized or binary cloud text accepted"); }
            catch (IOException) { check(true, "Invalid cloud text rejected"); }
        }
    }

    private static async Task Authentication(Action<bool, string> check) {
        var handler = new CloudTestHandler((_, _) => Task.FromResult(User()));
        var store = new MemoryCloudTokenStore(null);
        var client = Client(handler, store);
        var status = Result(await client.Execute(Body(new { action = "status" })));
        check(!status.GetProperty("authenticated").GetBoolean() && handler.Requests.Count == 0, "Logged-out status performed a network request");
        await Fails(() => client.Read("alice", "note.md"), check, "Logged-out read was allowed");
        await Fails(() => client.Write("alice", "note.md", "text", null), check, "Logged-out write was allowed");
        check(handler.Requests.Count == 0 && store.ReadCount == 1, "Logged-out operations accessed network or repeatedly loaded credentials");

        store = new MemoryCloudTokenStore(Token);
        handler = new CloudTestHandler((_, _) => Task.FromResult(User()));
        client = Client(handler, store);
        status = Result(await client.Execute(Body(new { action = "status" })));
        check(status.GetProperty("authenticated").GetBoolean() && status.GetProperty("login").GetString() == "alice", "Cloud status lost authenticated account");
        check(handler.Requests.Count == 1 && handler.Requests[0].Url == "https://api.github.com/user" && handler.Requests[0].Method == HttpMethod.Get, "Account check used an unexpected endpoint");
        check(handler.Requests[0].Scheme == "Bearer" && handler.Requests[0].Token == Token, "Account check omitted authorization");
        check(!status.GetRawText().Contains(Token), "Cloud status exposed the access token");
        await client.Execute(Body(new { action = "status" }));
        check(handler.Requests.Count == 2 && handler.Requests[1].Url == "https://api.github.com/user", "Repeated account status did not revalidate GitHub authentication");
        await Fails(() => client.Write("bob", "note.md", "text", Sha), check, "Different-account cloud write was accepted");
        check(handler.Requests.Count == 2 && store.Token == Token, "Different-account write issued a request or erased credentials");

        var unconfigured = new GitHubCloud(new MemoryCloudTokenStore(null), () => "", new HttpClient(handler));
        await Fails(() => unconfigured.Execute(Body(new { action = "startLogin" })), check, "Unconfigured OAuth login was attempted");
        check(handler.Requests.Count == 2, "Missing OAuth configuration reached the network");

        var accountChecks = 0;
        store = new MemoryCloudTokenStore(Token);
        handler = new CloudTestHandler((_, _) => Task.FromResult(++accountChecks == 1 ? User() : new HttpResponseMessage(HttpStatusCode.Unauthorized)));
        client = Client(handler, store);
        await client.Execute(Body(new { action = "status" }));
        status = Result(await client.Execute(Body(new { action = "status" })));
        check(!status.GetProperty("authenticated").GetBoolean() && !status.TryGetProperty("login", out _), "Revoked GitHub login remained authenticated after status refresh");
        check(handler.Requests.Count == 2 && store.Token is null && store.ClearCount == 1, "Definitively revoked login was not removed from secure storage");
        await Fails(() => client.Write("alice", "note.md", "text", Sha), check, "Revoked login used a cached account for saving");
        check(handler.Requests.Count == 2 && handler.Requests.All(request => request.Method == HttpMethod.Get), "Revoked login accessed GitHub after credentials were invalidated");
    }

    private static async Task Contents(Action<bool, string> check) {
        var handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.EndsWith("/user") ? User() : Json(new object[] {
            new { name = "child", path = "notes/child", type = "dir", sha = Sha, size = 0 },
            new { name = "file.md", path = "notes/file.md", type = "file", sha = Sha, size = 12 },
            new { name = "settings.YAML", path = "notes/settings.YAML", type = "file", sha = Sha, size = 13 },
            new { name = ".gitkeep", path = "notes/.gitkeep", type = "file", sha = Sha, size = 0 },
            new { name = "image.png", path = "notes/image.png", type = "file", sha = Sha, size = 2 },
            new { name = "link.md", path = "notes/link.md", type = "symlink", sha = Sha, size = 2 }
        })));
        var client = Client(handler);
        var list = Result(await client.Execute(Body(new { action = "list", owner = "alice", path = "notes" })));
        check(list.GetProperty("path").GetString() == "notes" && list.GetProperty("entries").GetArrayLength() == 3, "Cloud list included unsupported entries or lost folders");
        check(handler.Requests[1].Url == "https://api.github.com/repos/alice/MiniMarkDisk/contents/notes", "Directory list used the wrong owner, repository or path");
        check(!list.GetRawText().Contains(Token), "Cloud list exposed the access token");
        check(handler.Requests.All(request => request.Token == Token && request.Url.StartsWith("https://api.github.com/")), "Cloud API sent credentials outside GitHub");

        const string text = "# 中文\r\ncloud\r\n";
        handler = new CloudTestHandler((request, _) => Task.FromResult(
            request.Url.EndsWith("/user") ? User() :
            request.Url.Contains("/contents/") ? Json(new { type = "file", size = Encoding.UTF8.GetByteCount(text), sha = Sha, download_url = "https://untrusted.invalid/document" }) :
            Json(new { encoding = "base64", sha = Sha, size = Encoding.UTF8.GetByteCount(text), content = Convert.ToBase64String(Encoding.UTF8.GetBytes(text)) })));
        client = Client(handler);
        var file = await client.Read("alice", "notes/a b.md");
        check(file.Path == "notes/a b.md" && file.Sha == Sha && file.Text == "# 中文\ncloud\n", "Cloud read lost path, SHA or normalized UTF-8 text");
        check(handler.Requests.Count == 3 && handler.Requests[1].Url.EndsWith("/contents/notes/a%20b.md") && handler.Requests[2].Url.EndsWith("/git/blobs/" + Sha), "Cloud read was not pinned to the metadata blob SHA");
        check(handler.Requests[1].Accept == "application/vnd.github.object+json", "Cloud metadata read did not request object semantics");
        check(handler.Requests.All(request => !request.Url.Contains("untrusted")), "Cloud read followed a download URL");

        handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.EndsWith("/user") ? User() :
            Json(new { default_branch = "main", @private = true })));
        client = Client(handler);
        var repo = Result(await client.Execute(Body(new { action = "createRepository" })));
        var create = handler.Requests[1];
        using (var json = JsonDocument.Parse(create.Body!)) {
            check(create.Method == HttpMethod.Post && create.Url == "https://api.github.com/user/repos", "Cloud repository creation used the wrong endpoint");
            check(json.RootElement.GetProperty("private").GetBoolean() && json.RootElement.GetProperty("auto_init").GetBoolean() &&
                json.RootElement.GetProperty("name").GetString() == "MiniMarkDisk", "Cloud repository was not private and initialized with the expected name");
        }
        check(repo.GetProperty("owner").GetString() == "alice" && repo.GetProperty("private").GetBoolean(), "Cloud repository result lost owner or visibility");

        handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.EndsWith("/user") ? User() :
            Json(new { content = new { sha = NextSha } })));
        client = Client(handler);
        var saved = await client.Write("ALICE", "notes/a b.md", "# 修改\n", Sha);
        var write = handler.Requests[1];
        using (var json = JsonDocument.Parse(write.Body!)) {
            check(write.Method == HttpMethod.Put && write.Url.EndsWith("/contents/notes/a%20b.md"), "Cloud save used the wrong method or path");
            check(json.RootElement.GetProperty("sha").GetString() == Sha, "Cloud save omitted its conflict-protection SHA");
            check(Encoding.UTF8.GetString(Convert.FromBase64String(json.RootElement.GetProperty("content").GetString()!)) == "# 修改\n", "Cloud save damaged UTF-8 content");
        }
        check(saved.Path == "notes/a b.md" && saved.Sha == NextSha, "Cloud save did not return its new SHA");
        await client.Write("alice", "new.md", "", null);
        using (var json = JsonDocument.Parse(handler.Requests[2].Body!))
            check(!json.RootElement.TryGetProperty("sha", out _), "New cloud file included an invented SHA");
        await client.Execute(Body(new { action = "folder", owner = "alice", path = "notes/new folder" }));
        check(handler.Requests[3].Url.EndsWith("/contents/notes/new%20folder/.gitkeep"), "Cloud folder creation lost its path");
    }

    private static async Task DeviceFlow(Action<bool, string> check) {
        const string deviceCode = "private-device-test-code";
        const string userCode = "ABCD-EFGH";
        HttpResponseMessage Start() => Json(new { device_code = deviceCode, user_code = userCode, verification_uri = "https://github.com/login/device", expires_in = 900, interval = 5 });
        HttpResponseMessage Authorized() => Json(new { access_token = Token, refresh_token = "device-refresh-test", expires_in = 28800, refresh_token_expires_in = 15897600, token_type = "bearer", scope = "repo" });
        var store = new MemoryCloudTokenStore(null);
        var verifying = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var verified = new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = new CloudTestHandler((request, _) => {
            if (request.Url.EndsWith("/device/code")) return Task.FromResult(Start());
            if (request.Url.EndsWith("/oauth/access_token")) return Task.FromResult(Authorized());
            verifying.SetResult(); return verified.Task;
        });
        var client = Client(handler, store);
        var start = Result(await client.Execute(Body(new { action = "startLogin" })));
        var request = handler.Requests.Single();
        check(request.Method == HttpMethod.Post && request.Url == "https://github.com/login/device/code", "Device login used an unexpected endpoint");
        check(request.Body == "client_id=test-client-id&scope=repo" && request.Token is null && !request.Body.Contains("client_secret"), "Device login sent incorrect scopes or a secret");
        check(start.GetProperty("userCode").GetString() == userCode && start.GetProperty("verificationUri").GetString() == "https://github.com/login/device", "Device login public instructions were lost");
        check(!start.GetRawText().Contains(deviceCode) && !start.GetRawText().Contains(Token), "Device login exposed private authorization data");
        var pending = Result(await client.Execute(Body(new { action = "pollLogin" })));
        check(pending.GetProperty("pending").GetBoolean() && pending.GetProperty("interval").GetInt32() == 5 && handler.Requests.Count == 1, "Immediate device polling ignored the server interval");
        check(store.WriteCount == 0 && store.Token is null, "Device login stored credentials before approval");

        var cancelledStore = new MemoryCloudTokenStore(null);
        var cancelVerifying = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancelVerified = new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancelHandler = new CloudTestHandler((item, _) => {
            if (item.Url.EndsWith("/device/code")) return Task.FromResult(Start());
            if (item.Url.EndsWith("/oauth/access_token")) return Task.FromResult(Authorized());
            cancelVerifying.SetResult(); return cancelVerified.Task;
        });
        var cancelled = Client(cancelHandler, cancelledStore);
        await cancelled.Execute(Body(new { action = "startLogin" }));

        var slowStore = new MemoryCloudTokenStore(null);
        var slowHandler = new CloudTestHandler((item, _) => Task.FromResult(item.Url.EndsWith("/device/code") ? Start() : Json(new { error = "slow_down" })));
        var slowClient = Client(slowHandler, slowStore);
        await slowClient.Execute(Body(new { action = "startLogin" }));

        var immediateHandler = new CloudTestHandler((_, _) => Task.FromResult(Start()));
        var immediate = Client(immediateHandler, new MemoryCloudTokenStore(null));
        await immediate.Execute(Body(new { action = "startLogin" }));
        await immediate.Execute(Body(new { action = "cancelLogin" }));
        await Fails(() => immediate.Execute(Body(new { action = "pollLogin" })), check, "Cancelled device login continued polling");
        check(immediateHandler.Requests.Count == 1, "Cancelled login issued an OAuth token request");

        await Task.Delay(5100);
        var successPoll = client.Execute(Body(new { action = "pollLogin" }));
        await verifying.Task.WaitAsync(TimeSpan.FromSeconds(5));
        check(store.Token is null && store.WriteCount == 0, "Candidate token was stored before account verification");
        var exchange = handler.Requests[1];
        check(exchange.Token is null && exchange.Body!.Contains("client_id=test-client-id") && exchange.Body.Contains("device_code=" + deviceCode) &&
            exchange.Body.Contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code") && !exchange.Body.Contains("client_secret"), "OAuth token exchange omitted device grant data or included a secret");
        check(handler.Requests[2].Url == "https://api.github.com/user" && handler.Requests[2].Token == Token, "Candidate token was not verified against the GitHub account");
        verified.SetResult(User());
        var success = Result(await successPoll);
        check(success.GetProperty("authenticated").GetBoolean() && success.GetProperty("login").GetString() == "alice", "Approved device login did not complete");
        var stored = CloudCredential.Read(store.Token);
        check(stored?.AccessToken == Token && stored.RefreshToken == "device-refresh-test" && stored.AccessExpiresAt > DateTimeOffset.UtcNow.AddHours(7) &&
            stored.RefreshExpiresAt > DateTimeOffset.UtcNow.AddDays(180) && stored.ClientId == "test-client-id" && stored.Account == "alice" && store.WriteCount == 1 &&
            !success.GetRawText().Contains(Token) && !success.GetRawText().Contains("device-refresh-test"), "Approved login lost expiring credentials or exposed the token");

        var cancelPoll = cancelled.Execute(Body(new { action = "pollLogin" }));
        await cancelVerifying.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await cancelled.Execute(Body(new { action = "cancelLogin" }));
        cancelVerified.SetResult(User());
        await Fails(() => cancelPoll, check, "Account verification after login cancellation was accepted");
        check(cancelledStore.Token is null && cancelledStore.WriteCount == 0, "Cancelled authorization persisted a candidate token");

        var slow = Result(await slowClient.Execute(Body(new { action = "pollLogin" })));
        check(slow.GetProperty("pending").GetBoolean() && slow.GetProperty("interval").GetInt32() == 10, "Device slow_down did not increase polling delay");
        slow = Result(await slowClient.Execute(Body(new { action = "pollLogin" })));
        check(slow.GetProperty("interval").GetInt32() == 10 && slowHandler.Requests.Count == 2 && slowStore.WriteCount == 0, "Device slow_down allowed an immediate request or persisted credentials");
    }

    private static async Task Failures(Action<bool, string> check) {
        foreach (var code in new[] { HttpStatusCode.Conflict, HttpStatusCode.UnprocessableEntity, HttpStatusCode.Unauthorized }) {
            var store = new MemoryCloudTokenStore(Token);
            var handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.EndsWith("/user") ? User() :
                new HttpResponseMessage(code) { Content = new StringContent("remote-error-including-" + Token) }));
            var client = Client(handler, store);
            var error = await Fails(() => client.Write("alice", "note.md", "unsaved text", Sha), check, "Rejected cloud save reported success");
            check(handler.Requests.Count == 2, "Rejected cloud save retried and risked overwriting a newer version");
            check((code == HttpStatusCode.Unauthorized ? store.Token is null && store.ClearCount == 1 : store.Token == Token && store.ClearCount == 0) &&
                store.WriteCount == 0, "Rejected cloud save mishandled secure credentials");
            check(!error.Message.Contains(Token), "Cloud API error leaked response contents or credentials");
        }
        var timeoutStore = new MemoryCloudTokenStore(Token);
        var timeoutHandler = new CloudTestHandler(async (request, _) => {
            if (request.Url.EndsWith("/user")) return User();
            await Task.Yield();
            throw new TaskCanceledException("Simulated network timeout");
        });
        await Fails(() => Client(timeoutHandler, timeoutStore).Write("alice", "note.md", "unsaved", Sha), check, "Timed-out cloud save reported success");
        check(timeoutStore.Token == Token && timeoutStore.ClearCount == 0 && timeoutHandler.Requests.Count == 2, "Cloud timeout erased credentials or retried");

        foreach (var invalid in new object[] {
            new { type = "symlink", size = 4, sha = Sha },
            new { type = "file", size = 4, sha = Sha, target = "other.md" },
            new { type = "file", size = CloudPaths.MaxBytes + 1, sha = Sha },
            new { type = "file", size = 4, sha = "not-a-sha" }
        }) {
            var handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.EndsWith("/user") ? User() : Json(invalid)));
            await Fails(() => Client(handler).Read("alice", "note.md"), check, "Invalid cloud file metadata accepted");
            check(handler.Requests.Count == 2, "Invalid metadata caused a blob request");
        }
        var invalidUtf8 = new CloudTestHandler((request, _) => Task.FromResult(request.Url.EndsWith("/user") ? User() :
            request.Url.Contains("/contents/") ? Json(new { type = "file", size = 2, sha = Sha }) :
            Json(new { encoding = "base64", sha = Sha, size = 2, content = Convert.ToBase64String(new byte[] { 0xff, 0xfe }) })));
        await Fails(() => Client(invalidUtf8).Read("alice", "note.md"), check, "Invalid UTF-8 blob accepted");
        var mismatchedBlob = new CloudTestHandler((request, _) => Task.FromResult(request.Url.EndsWith("/user") ? User() :
            request.Url.Contains("/contents/") ? Json(new { type = "file", size = 4, sha = Sha }) :
            Json(new { encoding = "base64", sha = NextSha, size = 4, content = Convert.ToBase64String("text"u8.ToArray()) })));
        await Fails(() => Client(mismatchedBlob).Read("alice", "note.md"), check, "Blob with a different SHA than metadata was accepted");

        foreach (var repositoryExists in new[] { true, false }) {
            var handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.EndsWith("/user") ? User() :
                request.Url.EndsWith("/MiniMarkDisk") && repositoryExists ? Json(new { name = "MiniMarkDisk" }) :
                new HttpResponseMessage(HttpStatusCode.NotFound)));
            var client = Client(handler);
            if (repositoryExists) {
                var result = Result(await client.Execute(Body(new { action = "list", owner = "alice", path = "" })));
                check(result.GetProperty("entries").GetArrayLength() == 0, "Existing empty repository did not return an empty listing");
            } else {
                await Fails(() => client.Execute(Body(new { action = "list", owner = "alice", path = "" })), check, "Missing repository was silently treated as an empty directory");
            }
            check(handler.Requests.Count == 3 && handler.Requests[2].Url.EndsWith("/repos/alice/MiniMarkDisk"), "Empty-root response did not verify repository availability");
        }
    }

    private static async Task LogoutRace(Action<bool, string> check) {
        var requested = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var response = new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        var store = new MemoryCloudTokenStore(Token);
        var handler = new CloudTestHandler((request, _) => {
            if (request.Url.EndsWith("/user")) return Task.FromResult(User());
            requested.SetResult(); return response.Task;
        });
        var client = Client(handler, store);
        var pending = client.Write("alice", "note.md", "new text", Sha);
        await requested.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var logout = Result(await client.Execute(Body(new { action = "logout" })));
        response.SetResult(Json(new { content = new { sha = NextSha } }));
        await Fails(() => pending, check, "Save response arriving after logout reported success");
        check(!logout.GetProperty("authenticated").GetBoolean() && store.Token is null && store.ClearCount == 1, "Logout did not clear the secure token");
        var status = Result(await client.Execute(Body(new { action = "status" })));
        check(!status.GetProperty("authenticated").GetBoolean() && handler.Requests.Count == 2, "Late response restored a logged-out account");
    }

    private static void Workspace(string folder, Action<bool, string> check) {
        var localPath = Path.Combine(folder, "cloud-local.md");
        var sessionPath = Path.Combine(folder, "cloud-session.json");
        DocumentStore.Write(localPath, "local baseline\n", false, "\n");
        var workspace = new DocumentWorkspace();
        var document = workspace.Open(localPath);
        document.Cloud = new("alice", "notes/cloud-name.md", Sha, "cloud baseline\n");
        document.Text = "cloud baseline\n";
        check(!document.Dirty && document.Name == "cloud-name.md" && document.Baseline == "local baseline\n", "Cloud binding replaced the local baseline or name");
        workspace.SaveSession(sessionPath);
        DocumentStore.Write(localPath, "external local change\n", false, "\n");
        var restored = DocumentWorkspace.Restore(sessionPath, Path.Combine(folder, "missing-cloud-draft.json")).Active;
        check(restored.Cloud == document.Cloud && restored.Path == localPath && restored.Fingerprint == document.Fingerprint, "Cloud session lost metadata or separate local path");
        check(restored.Text == "cloud baseline\n" && !restored.Dirty, "Disk changes replaced cloud text during session restore");
        check(restored.Baseline == "local baseline\n" && restored.SavedBaseline == "cloud baseline\n", "Local and cloud baselines were merged");
        restored.Cloud = null;
        check(restored.Dirty && restored.Name == "cloud-local.md" && restored.Baseline == "local baseline\n", "Cloud detachment lost local save state");
        restored.Cloud = new("alice", "notes/cloud-name.md", Sha, "cloud baseline\n");
        restored.Text = "pending offline edit\n";
        var pendingWorkspace = new DocumentWorkspace();
        pendingWorkspace.Documents.Add(restored); pendingWorkspace.Activate(restored.Id);
        pendingWorkspace.SaveSession(sessionPath);
        var pending = DocumentWorkspace.Restore(sessionPath, Path.Combine(folder, "missing-cloud-draft.json")).Active;
        check(pending.Dirty && pending.Text == "pending offline edit\n" && pending.Cloud!.Sha == Sha, "Offline cloud edits or conflict SHA were lost on restart");
        check(!File.ReadAllText(sessionPath).Contains(Token), "Workspace persisted credentials");
    }
}

sealed class MemoryCloudTokenStore(string? token) : ICloudTokenStore {
    public string? Token { get; private set; } = token;
    public int ReadCount { get; private set; }
    public int WriteCount { get; private set; }
    public int ClearCount { get; private set; }
    public int FailWrites { get; set; }
    public string? Read() { ReadCount++; return Token; }
    public void Write(string value) { if (FailWrites > 0) { FailWrites--; throw new IOException("Simulated secure storage failure"); } WriteCount++; Token = value; }
    public void Clear() { ClearCount++; Token = null; }
}

sealed record CloudTestRequest(HttpMethod Method, string Url, string? Body, string? Scheme, string? Token, string Accept);
sealed class CloudTestHandler(Func<CloudTestRequest, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler {
    public List<CloudTestRequest> Requests { get; } = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
        var captured = new CloudTestRequest(request.Method, request.RequestUri!.AbsoluteUri,
            request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken),
            request.Headers.Authorization?.Scheme, request.Headers.Authorization?.Parameter, request.Headers.Accept.ToString());
        Requests.Add(captured);
        return await respond(captured, cancellationToken);
    }
}
