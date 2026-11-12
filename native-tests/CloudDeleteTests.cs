using System.Net;
using System.Text.Json;
using Moye;

static class CloudDeleteTests {
    private const string Root = "1111111111111111111111111111111111111111";
    private const string Head = "2222222222222222222222222222222222222222";
    private const string Target = "3333333333333333333333333333333333333333";
    private const string Sibling = "4444444444444444444444444444444444444444";
    private const string Folder = "5555555555555555555555555555555555555555";
    private const string Nested = "6666666666666666666666666666666666666666";
    private const string NextCommit = "9999999999999999999999999999999999999999";
    private static JsonElement Body(object value) => JsonSerializer.SerializeToElement(value);
    private static HttpResponseMessage Json(object value, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(value)) };
    private static object Entry(string path, string type, string sha, string? mode = null) =>
        new { path, mode = mode ?? (type == "tree" ? "040000" : "100644"), type, sha };
    private static GitHubCloud Client(Fixture fixture) => new(new MemoryCloudTokenStore("delete-test-token"), () => "client", new HttpClient(fixture.Handler));
    private static async Task<Exception> Fails(Func<Task> action, Action<bool, string> check, string message) {
        try { await action(); }
        catch (Exception error) when (error is IOException or OperationCanceledException) { check(true, message); return error; }
        throw new Exception(message);
    }
    public static async Task Run(string folder, Action<bool, string> check) {
        await Files(check);
        await Folders(check);
        await Rejections(check);
        await Workspace(folder, check);
        await LogoutRace(check);
    }
    private static async Task Files(Action<bool, string> check) {
        var fixture = new Fixture {
            Trees = { [Root] = [
                Entry("note.md", "blob", Target), Entry("note.md.backup", "blob", Sibling),
                Entry("other", "tree", Folder), Entry("link", "blob", Sibling, "120000"), Entry("submodule", "commit", Sibling, "160000")
            ] }
        };
        var result = await Client(fixture).Execute(Body(new { action = "delete", owner = "alice", path = "note.md", sha = Target, entryType = "file" }));
        var deletion = (CloudDeletion)result;
        check(deletion.Path == "note.md" && deletion.Type == "file" && deletion.Deleted && deletion.Commit == NextCommit, "File deletion result lost metadata");
        var serialized = Body(deletion);
        check(serialized.GetProperty("path").GetString() == "note.md" && serialized.GetProperty("deleted").GetBoolean(), "Deletion response did not use lower-case protocol keys");
        var entries = fixture.CreatedTrees.Single().GetProperty("tree").EnumerateArray().ToArray();
        check(entries.Length == 4 && entries.All(entry => entry.GetProperty("path").GetString() != "note.md"), "File deletion changed the wrong tree entries");
        check(entries.Any(entry => entry.GetProperty("path").GetString() == "note.md.backup" && entry.GetProperty("sha").GetString() == Sibling), "Similar-prefix sibling file was removed");
        check(entries.Any(entry => entry.GetProperty("mode").GetString() == "120000") && entries.Any(entry => entry.GetProperty("mode").GetString() == "160000"), "Unrelated symlink or submodule was lost");
        check(fixture.CreatedTrees.All(tree => !tree.TryGetProperty("base_tree", out _)), "Replacement trees unexpectedly inherited deleted entries");
        check(fixture.Commits.Count == 1 && fixture.Commits[0].GetProperty("parents")[0].GetString() == Head &&
            fixture.Patches.Count == 1 && !fixture.Patches[0].GetProperty("force").GetBoolean(), "Deletion was not a single non-force child commit");
        check(fixture.Handler.Requests.All(request => request.Method != HttpMethod.Delete && !request.Url.Contains("?recursive")), "Deletion used partial file deletes or recursive tree traversal");

        fixture = new Fixture { Trees = { [Root] = [Entry("note.md", "blob", Target)] } };
        await Client(fixture).Delete("alice", "note.md", Target, "file");
        var placeholder = fixture.CreatedTrees.Single().GetProperty("tree")[0];
        check(placeholder.GetProperty("path").GetString() == ".gitkeep" && placeholder.GetProperty("content").GetString() == "", "Empty root was not preserved");
    }
    private static async Task Folders(Action<bool, string> check) {
        var fixture = new Fixture { Trees = { [Root] = [Entry("notes", "tree", Target), Entry("notes-old", "tree", Sibling), Entry("photo.png", "blob", Folder)] } };
        await Client(fixture).Delete("alice", "notes", Target, "dir");
        check(fixture.Handler.Requests.All(request => !request.Url.EndsWith("/git/trees/" + Target)), "Folder deletion traversed its contents");
        var remaining = fixture.CreatedTrees.Single().GetProperty("tree").EnumerateArray().ToArray();
        check(remaining.Length == 2 && remaining.Any(entry => entry.GetProperty("path").GetString() == "notes-old") &&
            remaining.Any(entry => entry.GetProperty("path").GetString() == "photo.png"), "Folder deletion removed unrelated content");

        fixture = new Fixture { Branch = "release/cloud", Trees = {
            [Root] = [Entry("parent", "tree", Folder), Entry("keep.yaml", "blob", Sibling)],
            [Folder] = [Entry("nested", "tree", Nested)],
            [Nested] = [Entry("target", "tree", Target)]
        } };
        await Client(fixture).Delete("alice", "parent/nested/target", Target, "dir");
        check(fixture.CreatedTrees.Count == 3 && fixture.CreatedTrees[0].GetProperty("tree")[0].GetProperty("path").GetString() == ".gitkeep", "Empty target parent was not preserved");
        check(fixture.CreatedTrees[1].GetProperty("tree")[0].GetProperty("path").GetString() == "nested" &&
            fixture.CreatedTrees[2].GetProperty("tree").EnumerateArray().Any(entry => entry.GetProperty("path").GetString() == "keep.yaml"), "Ancestor rebuilding lost a parent or root sibling");
        check(fixture.Handler.Requests.Any(request => request.Url.EndsWith("/git/refs/heads/release/cloud") && request.Method == HttpMethod.Patch),
            "Branch containing a slash was not handled");
    }
    private static async Task Rejections(Action<bool, string> check) {
        foreach (var (path, sha, type) in new[] {
            ("", Target, "dir"), ("/", Target, "dir"), ("../notes", Target, "dir"), ("a//b", Target, "dir"),
            ("note.md", "invalid", "file"), ("note.md", Target + "\n", "file"), ("note.md", Target, "symlink"),
            ("photo.png", Target, "file"),
            (string.Join('/', Enumerable.Repeat("a", 17)), Target, "dir")
        }) {
            var fixture = new Fixture();
            await Fails(() => Client(fixture).Delete("alice", path, sha, type), check, "Invalid delete request accepted");
            check(fixture.Handler.Requests.Count == 0, "Invalid delete request reached the network");
        }
        foreach (var fixture in new[] {
            new Fixture { Trees = { [Root] = [Entry("note.md", "blob", Sibling)] } },
            new Fixture { Trees = { [Root] = [] } },
            new Fixture { Trees = { [Root] = [Entry("note.md", "tree", Target)] } },
            new Fixture { Trees = { [Root] = [Entry("note.md", "blob", Target, "120000")] } },
            new Fixture { Trees = { [Root] = [Entry("note.md", "blob", Target)] }, Truncated = true },
            new Fixture { Trees = { [Root] = [Entry("note.md", "blob", Target), Entry("note.md", "blob", Sibling)] } }
        }) {
            await Fails(() => Client(fixture).Delete("alice", "note.md", Target, "file"), check, "Stale or unsafe target accepted");
            check(fixture.CreatedTrees.Count == 0 && fixture.Patches.Count == 0, "Unsafe target changed the repository");
        }
        var wrongOwner = new Fixture();
        await Fails(() => Client(wrongOwner).Delete("bob", "note.md", Target, "file"), check, "Wrong account could delete a file");
        check(wrongOwner.Handler.Requests.Count == 1, "Wrong-account deletion reached repository data");
        var ancestor = new Fixture { Trees = { [Root] = [Entry("parent", "blob", Folder, "120000")] } };
        await Fails(() => Client(ancestor).Delete("alice", "parent/note.md", Target, "file"), check, "Symlink ancestor was traversed");
        check(ancestor.CreatedTrees.Count == 0, "Symlink ancestor changed the repository");
        foreach (var status in new[] { HttpStatusCode.Conflict, HttpStatusCode.UnprocessableEntity, HttpStatusCode.ServiceUnavailable, HttpStatusCode.Forbidden }) {
            var fixture = new Fixture { Trees = { [Root] = [Entry("note.md", "blob", Target)] }, PatchStatus = status };
            var error = await Fails(() => Client(fixture).Delete("alice", "note.md", Target, "file"), check, "Failed atomic ref update reported deletion success");
            check(fixture.Patches.Count == 1 && fixture.Commits.Count == 1 && !fixture.Patches[0].GetProperty("force").GetBoolean(),
                "Failed ref update retried or forced deletion");
            check(error.Message.Contains(status is HttpStatusCode.Conflict or HttpStatusCode.UnprocessableEntity ? "未执行删除" : "无法确认云端删除结果"),
                "Uncertain deletion result was presented as a safe retry");
        }
        foreach (var failure in new[] { "timeout", "network", "invalid-response" }) {
            var fixture = new Fixture { Trees = { [Root] = [Entry("note.md", "blob", Target)] }, PatchFailure = failure };
            var error = await Fails(() => Client(fixture).Delete("alice", "note.md", Target, "file"), check, "Uncertain ref update reported deletion success");
            check(error.Message.Contains("不要直接重复删除") && fixture.Patches.Count == 1, "Unknown ref outcome was retried or not disclosed");
        }
        foreach (var changedHead in new[] { Sibling, NextCommit }) {
            var fixture = new Fixture { Trees = { [Root] = [Entry("note.md", "blob", Target)] }, FinalHead = changedHead };
            await Fails(() => Client(fixture).Delete("alice", "note.md", Target, "file"), check, "Changed final branch head accepted");
            check(fixture.Commits.Count == 1 && fixture.Patches.Count == 0, "Advanced or rewound branch was patched");
        }
    }
    private static async Task Workspace(string folder, Action<bool, string> check) {
        var workspace = new DocumentWorkspace();
        var target = workspace.AddNew("unsaved local text", "draft.md", "local baseline");
        target.Cloud = new("Alice", "notes/note.md", Target, "cloud baseline");
        target.Path = Path.Combine(folder, "local-original.md");
        var draft = workspace.AddNew("cloud-only text", "cloud.md");
        draft.Cloud = new("alice", "notes/nested/draft.md", Target, "cloud-only text");
        var sibling = workspace.AddNew("keep");
        sibling.Cloud = new("alice", "notes-old/keep.md", Sibling, "keep");
        var other = workspace.AddNew("other");
        other.Cloud = new("bob", "notes/note.md", Target, "other");
        var fixture = new Fixture { Trees = { [Root] = [Entry("notes", "tree", Target)] }, PatchStatus = HttpStatusCode.Conflict };
        try {
            var deleted = await Client(fixture).Delete("alice", "notes", Target, "dir");
            CloudDeletionWorkspace.Detach(workspace, "alice", deleted);
        } catch (IOException) { }
        check(workspace.Documents.All(document => document.Cloud is not null), "Failed deletion detached open documents");
        var count = CloudDeletionWorkspace.Detach(workspace, "alice", new("notes", "dir", true, NextCommit));
        check(count == 2 && target.Cloud is null && draft.Cloud is null && sibling.Cloud is not null && other.Cloud is not null, "Deletion detached sibling-prefix or other-account documents");
        check(target.Text == "unsaved local text" && target.Baseline == "local baseline" && target.Path!.EndsWith("local-original.md") &&
            target.UntitledName == "note.md", "Detachment lost text, filename or local save baseline");
        check(draft.Text == "cloud-only text" && draft.Baseline == "" && draft.Name == "draft.md" && draft.Dirty, "Cloud-only detached document was not preserved as a local draft");
        check(!CloudDeletionWorkspace.Includes(new("alice", "notes/note.md/more.md", Target, ""), "alice", "notes/note.md", "file"), "File deletion matched descendant-like paths");
    }
    private static async Task LogoutRace(Action<bool, string> check) {
        var fixture = new Fixture { Trees = { [Root] = [Entry("note.md", "blob", Target)] } };
        var requested = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        fixture.BeforeCreateTree = async () => { requested.TrySetResult(); await release.Task; };
        var client = Client(fixture);
        var pending = client.Delete("alice", "note.md", Target, "file");
        await requested.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await client.Execute(Body(new { action = "logout" }));
        release.SetResult();
        await Fails(() => pending, check, "Deletion continued after logout");
        check(fixture.Patches.Count == 0 && fixture.Commits.Count == 0, "Logged-out deletion updated a branch");
    }

    private sealed class Fixture {
        public Dictionary<string, object[]> Trees { get; } = new();
        public string Branch { get; init; } = "main";
        public bool Truncated { get; init; }
        public HttpStatusCode PatchStatus { get; init; } = HttpStatusCode.OK;
        public string? FinalHead { get; init; }
        public string? PatchFailure { get; init; }
        public Func<Task>? BeforeCreateTree { get; set; }
        public List<JsonElement> CreatedTrees { get; } = [];
        public List<JsonElement> Commits { get; } = [];
        public List<JsonElement> Patches { get; } = [];
        public CloudTestHandler Handler { get; }
        private string rebuilt = "";
        public Fixture() { Handler = new(Respond); }
        private async Task<HttpResponseMessage> Respond(CloudTestRequest request, CancellationToken _) {
            var path = new Uri(request.Url).AbsolutePath;
            var repo = "/repos/alice/MiniMarkDisk";
            if (path == "/user") return Json(new { login = "alice" });
            if (path == repo) return Json(new { default_branch = Branch });
            if (path == repo + "/git/ref/heads/" + Branch) return Json(new { @ref = "refs/heads/" + Branch, @object = new { type = "commit", sha = Commits.Count > 0 ? FinalHead ?? Head : Head } });
            if (path == repo + "/git/commits/" + Head) return Json(new { sha = Head, tree = new { sha = Root } });
            if (request.Method == HttpMethod.Get && path.StartsWith(repo + "/git/trees/")) {
                var sha = path.Split('/')[^1];
                if (!Trees.TryGetValue(sha, out var entries)) throw new Exception("Unexpected subtree traversal");
                return Json(new { sha, truncated = Truncated, tree = entries });
            }
            if (request.Method == HttpMethod.Post && path == repo + "/git/trees") {
                if (BeforeCreateTree is not null) await BeforeCreateTree();
                CreatedTrees.Add(Body(JsonDocument.Parse(request.Body!).RootElement));
                rebuilt = (700 + CreatedTrees.Count).ToString("x40");
                return Json(new { sha = rebuilt });
            }
            if (request.Method == HttpMethod.Post && path == repo + "/git/commits") {
                Commits.Add(Body(JsonDocument.Parse(request.Body!).RootElement));
                return Json(new { sha = NextCommit, tree = new { sha = rebuilt }, parents = new[] { new { sha = Head } } });
            }
            if (request.Method == HttpMethod.Patch && path == repo + "/git/refs/heads/" + Branch) {
                Patches.Add(Body(JsonDocument.Parse(request.Body!).RootElement));
                if (PatchFailure == "timeout") throw new TaskCanceledException("simulated timeout");
                if (PatchFailure == "network") throw new HttpRequestException("simulated disconnect");
                if (PatchFailure == "invalid-response") return Json(new { invalid = true });
                return Json(new { @ref = "refs/heads/" + Branch, @object = new { type = "commit", sha = NextCommit } }, PatchStatus);
            }
            throw new Exception("Unexpected cloud delete request");
        }
    }
}
