using System.Net;
using System.Text.Json;
using Moye;

static class CloudRefreshTests {
    private const string OldAccess = "old-test-access";
    private const string OldRefresh = "old-test-refresh";
    private const string NewAccess = "new-test-access";
    private const string NewRefresh = "new-test-refresh";
    private static JsonElement Body(object value) => JsonSerializer.SerializeToElement(value);
    private static HttpResponseMessage Json(object value, HttpStatusCode status = HttpStatusCode.OK) => new(status) { Content = new StringContent(JsonSerializer.Serialize(value)) };
    private static HttpResponseMessage User() => Json(new { login = "alice" });
    private static HttpResponseMessage Renewed() => Json(new { access_token = NewAccess, refresh_token = NewRefresh, expires_in = 28800, refresh_token_expires_in = 15897600 });
    private static CloudCredential Credential(int expiresIn = 30, int refreshExpiresIn = 1000) =>
        new(OldAccess, OldRefresh, DateTimeOffset.UtcNow.AddSeconds(expiresIn), DateTimeOffset.UtcNow.AddSeconds(refreshExpiresIn), "stored-client", "alice");
    private static GitHubCloud Client(CloudTestHandler handler, MemoryCloudTokenStore store) => new(store, () => "current-client", new HttpClient(handler));
    private static async Task<Exception> Fails(Func<Task> action, Action<bool, string> check, string message) {
        try { await action(); }
        catch (Exception error) when (error is IOException or OperationCanceledException or HttpRequestException) { check(true, message); return error; }
        throw new Exception(message);
    }

    public static async Task Run(Action<bool, string> check) {
        var legacy = CloudCredential.Read(OldAccess);
        check(legacy?.AccessToken == OldAccess && legacy.RefreshToken is null && legacy.AccessExpiresAt is null, "Legacy plain access token was not readable");
        check(CloudCredential.Read(Credential().Serialize())?.RefreshToken == OldRefresh, "Credential envelope did not round trip");
        check(!Credential().ToString().Contains(OldAccess) && !Credential().ToString().Contains(OldRefresh), "Credential diagnostic string exposed secrets");
        await Rotation(check);
        await Unauthorized(check);
        await Failures(check);
        await LogoutRace(check);
        await PersistenceRecovery(check);
        foreach (var invalid in new[] {
            Body(new { access_token = NewAccess, token_type = "mac" }),
            Body(new { access_token = NewAccess, expires_in = "28800" }),
            Body(new { access_token = NewAccess, expires_in = -1 })
        }) {
            try { CloudCredential.FromResponse(invalid, "client", DateTimeOffset.UtcNow); throw new Exception("Invalid token response accepted"); }
            catch (IOException) { check(true, "Invalid token response rejected safely"); }
        }
    }

    private static async Task Rotation(Action<bool, string> check) {
        var store = new MemoryCloudTokenStore(Credential().Serialize());
        var requested = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var result = new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = new CloudTestHandler((request, _) => {
            if (request.Url == "https://github.com/login/oauth/access_token") { requested.TrySetResult(); return result.Task; }
            return Task.FromResult(User());
        });
        var client = Client(handler, store);
        var first = client.Execute(Body(new { action = "status" }));
        await requested.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var second = client.Execute(Body(new { action = "status" }));
        check(handler.Requests.Count == 1, "Concurrent expiring-token requests did not share one refresh");
        var request = handler.Requests[0];
        check(request.Method == HttpMethod.Post && request.Token is null && request.Body == "client_id=stored-client&grant_type=refresh_token&refresh_token=old-test-refresh" &&
            !request.Body.Contains("secret") && !request.Body.Contains("scope"), "Token refresh sent incorrect device grant parameters");
        result.SetResult(Renewed());
        var statuses = await Task.WhenAll(first, second);
        check(statuses.All(status => Body(status).GetProperty("authenticated").GetBoolean()), "Refreshed authentication did not succeed");
        var saved = CloudCredential.Read(store.Token)!;
        check(saved.AccessToken == NewAccess && saved.RefreshToken == NewRefresh && saved.ClientId == "stored-client" && saved.Account == "alice" &&
            saved.AccessExpiresAt > DateTimeOffset.UtcNow.AddHours(7) && saved.RefreshExpiresAt > DateTimeOffset.UtcNow.AddDays(180), "Refreshed credential rotation lost new tokens or expiries");
        check(store.WriteCount == 1 && handler.Requests.Count(request => request.Url.Contains("/oauth/")) == 1, "Concurrent token refresh rotated or stored twice");
        check(handler.Requests.Where(request => request.Url.EndsWith("/user")).All(request => request.Token == NewAccess), "Account verification reused the invalidated old access token");
        check(statuses.All(status => !Body(status).GetRawText().Contains(NewAccess) && !Body(status).GetRawText().Contains(NewRefresh)), "Refreshed status exposed credentials");

        var restart = Client(handler, store);
        await restart.Execute(Body(new { action = "status" }));
        check(handler.Requests.Count(request => request.Url.Contains("/oauth/")) == 1, "Restart discarded the refreshed expiry");
        var legacyStore = new MemoryCloudTokenStore(OldAccess);
        var legacyHandler = new CloudTestHandler((_, _) => Task.FromResult(User()));
        await Client(legacyHandler, legacyStore).Execute(Body(new { action = "status" }));
        check(legacyHandler.Requests.Count == 1 && legacyHandler.Requests[0].Token == OldAccess && legacyStore.WriteCount == 0, "Legacy token was changed or refreshed unnecessarily");
    }

    private static async Task Unauthorized(Action<bool, string> check) {
        var store = new MemoryCloudTokenStore(Credential(3600).Serialize());
        var handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.Contains("/oauth/") ? Renewed() :
            request.Token == OldAccess ? new HttpResponseMessage(HttpStatusCode.Unauthorized) : User()));
        var status = Body(await Client(handler, store).Execute(Body(new { action = "status" })));
        check(status.GetProperty("authenticated").GetBoolean() && handler.Requests.Count(request => request.Url.Contains("/oauth/")) == 1, "401 did not trigger one refresh");
        check(handler.Requests.Count == 4 && handler.Requests[^1].Token == NewAccess && store.ClearCount == 0, "401 refresh did not retry once with the rotated credential");

        store = new MemoryCloudTokenStore(Credential(3600).Serialize());
        handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.Contains("/oauth/") ? Renewed() : new HttpResponseMessage(HttpStatusCode.Unauthorized)));
        status = Body(await Client(handler, store).Execute(Body(new { action = "status" })));
        check(!status.GetProperty("authenticated").GetBoolean() && handler.Requests.Count == 3 && store.ClearCount == 1 && store.Token is null, "Revoked refreshed token retried indefinitely or remained stored");

        store = new MemoryCloudTokenStore(Credential(3600).Serialize());
        handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.Contains("/oauth/") ? Renewed() :
            request.Url.EndsWith("/user") ? User() : new HttpResponseMessage(HttpStatusCode.Unauthorized)));
        await Fails(() => Client(handler, store).Write("alice", "note.md", "text", null), check, "401 on a retried write was accepted");
        check(handler.Requests.Count(request => request.Method == HttpMethod.Put) == 2 &&
            handler.Requests.Count(request => request.Url.Contains("/oauth/")) == 1 && store.ClearCount == 1, "Repeated API401 exceeded one refresh and one retry");
    }

    private static async Task Failures(Action<bool, string> check) {
        foreach (var code in new[] { HttpStatusCode.OK, HttpStatusCode.BadRequest }) {
            var store = new MemoryCloudTokenStore(Credential().Serialize());
            var handler = new CloudTestHandler((_, _) => Task.FromResult(Json(new { error = "bad_refresh_token", error_description = OldRefresh }, code)));
            var client = Client(handler, store);
            var error = await Fails(() => client.Write("alice", "note.md", "text", null), check, "Bad refresh token did not require reauthentication");
            check(store.Token is null && store.ClearCount == 1 && handler.Requests.Count == 1 && error.Message.Contains("重新登录") && !error.Message.Contains(OldRefresh), "Bad refresh token leaked data or left invalid credentials");
            var status = Body(await client.Execute(Body(new { action = "status" })));
            check(!status.GetProperty("authenticated").GetBoolean() && handler.Requests.Count == 1, "Invalidated credential was reused");
        }
        foreach (var timeout in new[] { false, true }) {
            var stored = Credential().Serialize();
            var store = new MemoryCloudTokenStore(stored);
            var handler = new CloudTestHandler((_, _) => timeout ? Task.FromException<HttpResponseMessage>(new TaskCanceledException("offline")) :
                Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));
            await Fails(() => Client(handler, store).Execute(Body(new { action = "status" })), check, "Unavailable refresh endpoint reported authentication success");
            check(store.Token == stored && store.WriteCount == 0 && store.ClearCount == 0, "Transient refresh failure removed credentials");
        }

        var rotatedStore = new MemoryCloudTokenStore(Credential().Serialize());
        var rotatedHandler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.Contains("/oauth/") ? Renewed() :
            new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));
        await Fails(() => Client(rotatedHandler, rotatedStore).Execute(Body(new { action = "status" })), check, "Offline account verification reported success");
        check(CloudCredential.Read(rotatedStore.Token)?.RefreshToken == NewRefresh && rotatedStore.ClearCount == 0, "Offline verification lost the newly rotated token pair");
        var mismatchHandler = new CloudTestHandler((_, _) => Task.FromResult(Json(new { login = "bob" })));
        var mismatch = Body(await Client(mismatchHandler, rotatedStore).Execute(Body(new { action = "status" })));
        check(!mismatch.GetProperty("authenticated").GetBoolean() && rotatedStore.Token is null, "Restart after offline refresh lost the stored account binding");

        var expiredStore = new MemoryCloudTokenStore(Credential(-1, -1).Serialize());
        var expiredHandler = new CloudTestHandler((_, _) => throw new Exception("Expired refresh credential reached network"));
        var expired = Body(await Client(expiredHandler, expiredStore).Execute(Body(new { action = "status" })));
        check(!expired.GetProperty("authenticated").GetBoolean() && expiredStore.Token is null && expiredStore.ClearCount == 1, "Locally expired refresh credential did not require login");
    }

    private static async Task LogoutRace(Action<bool, string> check) {
        var store = new MemoryCloudTokenStore(Credential().Serialize());
        var requested = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var response = new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = new CloudTestHandler((_, _) => { requested.TrySetResult(); return response.Task; });
        var client = Client(handler, store);
        var pending = client.Execute(Body(new { action = "status" }));
        await requested.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await client.Execute(Body(new { action = "logout" }));
        response.SetResult(Renewed());
        await Fails(() => pending, check, "Late refresh response restored a logged-out account");
        check(store.Token is null && store.ClearCount == 1 && store.WriteCount == 0 && handler.Requests.Count == 1, "Late refresh response persisted or verified a token after logout");

        store = new MemoryCloudTokenStore(Credential().Serialize());
        requested = new(TaskCreationOptions.RunContinuationsAsynchronously);
        response = new(TaskCreationOptions.RunContinuationsAsynchronously);
        handler = new CloudTestHandler((request, _) => {
            if (request.Url.Contains("/oauth/")) return Task.FromResult(Renewed());
            requested.TrySetResult(); return response.Task;
        });
        client = Client(handler, store);
        pending = client.Execute(Body(new { action = "status" }));
        await requested.Task.WaitAsync(TimeSpan.FromSeconds(5));
        check(CloudCredential.Read(store.Token)?.RefreshToken == NewRefresh, "Rotated pair was not preserved while awaiting verification");
        await client.Execute(Body(new { action = "logout" }));
        response.SetResult(User());
        await Fails(() => pending, check, "Late refreshed account verification restored logged-out state");
        check(store.Token is null && store.ClearCount == 1 && store.WriteCount == 1, "Late verification repersisted credentials after logout");
    }

    private static async Task PersistenceRecovery(Action<bool, string> check) {
        var before = Credential().Serialize();
        var store = new MemoryCloudTokenStore(before) { FailWrites = 1 };
        var handler = new CloudTestHandler((request, _) => Task.FromResult(request.Url.Contains("/oauth/") ? Renewed() : User()));
        var client = Client(handler, store);
        await Fails(() => client.Execute(Body(new { action = "status" })), check, "Failed secure storage was ignored");
        check(store.Token == before && handler.Requests.Count == 1, "Secure storage failure allowed API access or erased the old disk entry");
        var status = Body(await client.Execute(Body(new { action = "status" })));
        check(status.GetProperty("authenticated").GetBoolean() && CloudCredential.Read(store.Token)?.RefreshToken == NewRefresh, "Rotated in-memory credentials were not saved on retry");
        check(handler.Requests.Count(request => request.Url.Contains("/oauth/")) == 1 && handler.Requests[^1].Token == NewAccess,
            "Secure storage retry reused an invalidated old refresh token");

        store = new MemoryCloudTokenStore(before) { FailWrites = 2 };
        client = Client(handler, store);
        await Fails(() => client.Execute(Body(new { action = "status" })), check, "Failed secure storage was ignored before logout");
        await client.Execute(Body(new { action = "logout" }));
        status = Body(await client.Execute(Body(new { action = "status" })));
        check(!status.GetProperty("authenticated").GetBoolean() && store.Token is null, "Logout did not discard unpersisted rotated credentials");
    }
}
