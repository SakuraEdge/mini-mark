using System.Net;
using System.Net.Http;
using System.Text.Json;

namespace Moye;

public sealed partial class GitHubCloud {
    private sealed record TreeEntry(string Path, string Mode, string Type, string Sha) {
        public object Payload => new { path = Path, mode = Mode, type = Type, sha = Sha };
    }
    private sealed record TreeLevel(string Child, List<TreeEntry> Entries);

    private async Task<string> MutateTree(string owner, string path, string sha, string type, string? rename = null) {
        var operation = rename is null ? "删除" : "重命名";
        CloudPaths.Validate(path, true);
        if (type is not ("file" or "dir") || !CloudPaths.IsSha(sha)) throw new IOException("操作目标或版本无效，请刷新后重试。");
        if (type == "file") CloudPaths.Validate(path);
        var parts = path.Split('/');
        if (parts.Length > 16) throw new IOException("文件夹层级超过 16 层，暂不支持在应用内操作。");
        var epoch = generation;
        owner = await Account(owner);
        var repository = Repo(owner);
        var repo = await TreeApi(HttpMethod.Get, repository, null, epoch);
        var branch = StringField(repo, "default_branch");
        if (!ValidBranch(branch)) throw new IOException("GitHub 默认分支信息无效。");
        var reference = "heads/" + CloudPaths.Encode(branch);
        var head = await TreeApi(HttpMethod.Get, $"{repository}/git/ref/{reference}", null, epoch);
        if (StringField(head, "ref") != "refs/heads/" + branch || StringField(head.GetProperty("object"), "type") != "commit")
            throw new IOException("GitHub 分支引用无效。");
        var previousCommit = ShaField(head.GetProperty("object"));
        var commit = await TreeApi(HttpMethod.Get, $"{repository}/git/commits/{previousCommit}", null, epoch);
        if (ShaField(commit) != previousCommit) throw new IOException("GitHub 提交版本不一致。");
        var treeSha = ShaField(commit.GetProperty("tree"));
        var levels = new List<TreeLevel>();
        for (var index = 0; index < parts.Length; index++) {
            var tree = await TreeApi(HttpMethod.Get, $"{repository}/git/trees/{treeSha}", null, epoch);
            var entries = ReadTree(tree, treeSha);
            var target = entries.SingleOrDefault(item => item.Path == parts[index]) ??
                throw new IOException("云端目标已删除或移动，请刷新后重试。");
            levels.Add(new(parts[index], entries));
            if (index < parts.Length - 1) {
                if (target.Type != "tree" || target.Mode != "040000") throw new IOException("目标路径包含非普通文件夹。");
                treeSha = target.Sha;
            } else {
                var validType = type == "dir" ? target.Type == "tree" && target.Mode == "040000" :
                    target.Type == "blob" && target.Mode is "100644" or "100755";
                if (!validType) throw new IOException("仅支持普通文件或文件夹，不支持符号链接或子模块。");
                if (!target.Sha.Equals(sha, StringComparison.OrdinalIgnoreCase)) throw new IOException($"云端内容已变化，未执行{operation}。请刷新后重试。");
                if (rename is not null && entries.Any(item => item.Path == rename)) throw new IOException("同一云目录已有此名称，未覆盖任何文件。");
            }
        }

        string? rebuilt = null;
        for (var index = levels.Count - 1; index >= 0; index--) {
            var level = levels[index];
            var entries = level.Entries.Where(item => item.Path != level.Child).Select(item => item.Payload).ToList();
            if (rename is not null && index == levels.Count - 1) {
                var source = level.Entries.Single(item => item.Path == level.Child);
                entries.Add(new { path = rename, mode = source.Mode, type = source.Type, sha = source.Sha });
            }
            if (rebuilt is not null) entries.Add(new { path = level.Child, mode = "040000", type = "tree", sha = rebuilt });
            if (entries.Count == 0) entries.Add(new { path = ".gitkeep", mode = "100644", type = "blob", content = "" });
            var tree = await TreeApi(HttpMethod.Post, $"{repository}/git/trees", new { tree = entries }, epoch);
            rebuilt = ShaField(tree);
        }
        var created = await TreeApi(HttpMethod.Post, $"{repository}/git/commits",
            new { message = rename is null ? $"Delete {path} via Mini Mark" : $"Rename {path} to {rename} via Mini Mark", tree = rebuilt!, parents = new[] { previousCommit } }, epoch);
        var nextCommit = ShaField(created);
        if (ShaField(created.GetProperty("tree")) != rebuilt ||
            created.GetProperty("parents").ValueKind != JsonValueKind.Array || created.GetProperty("parents").GetArrayLength() != 1 ||
            ShaField(created.GetProperty("parents")[0]) != previousCommit) throw new IOException("GitHub 提交结果无效。");
        var latest = await TreeApi(HttpMethod.Get, $"{repository}/git/ref/{reference}", null, epoch);
        if (StringField(latest, "ref") != "refs/heads/" + branch || StringField(latest.GetProperty("object"), "type") != "commit" ||
            ShaField(latest.GetProperty("object")) != previousCommit)
            throw new IOException($"云端仓库已变化，未执行{operation}。请刷新后重试。");
        try {
            var updated = await TreeApi(HttpMethod.Patch, $"{repository}/git/refs/{reference}", new { sha = nextCommit, force = false }, epoch);
            if (StringField(updated, "ref") != "refs/heads/" + branch || StringField(updated.GetProperty("object"), "type") != "commit" ||
                ShaField(updated.GetProperty("object")) != nextCommit) throw new IOException("操作结果无法确认，请刷新云端目录后核对。");
        } catch (ApiError error) when (error.Status is HttpStatusCode.Conflict or HttpStatusCode.UnprocessableEntity) {
            throw new IOException($"云端仓库已变化，未执行{operation}。请刷新后重试。");
        } catch (Exception error) when (error is IOException or HttpRequestException or OperationCanceledException or JsonException or InvalidOperationException or KeyNotFoundException) {
            throw new IOException($"无法确认云端{operation}结果，请刷新核对，不要直接重复{operation}。");
        }
        return nextCommit;
    }

    private async Task<JsonElement> TreeApi(HttpMethod method, string path, object? body, int epoch) {
        CheckGeneration(epoch);
        var result = await Api(method, path, body);
        CheckGeneration(epoch);
        return result;
    }
    private static string StringField(JsonElement value, string name) {
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(name, out var field) || field.ValueKind != JsonValueKind.String)
            throw new IOException("GitHub 目录数据无效。");
        return field.GetString()!;
    }
    private static string ShaField(JsonElement value) {
        var sha = StringField(value, "sha");
        if (!CloudPaths.IsSha(sha)) throw new IOException("GitHub 目录版本无效。");
        return sha;
    }
    private static bool ValidBranch(string branch) =>
        branch.Length is > 0 and <= 1024 && !branch.Any(char.IsControl) && !branch.Any(char.IsWhiteSpace) &&
        branch.IndexOfAny(['\\', ':', '?', '*', '[', '~', '^']) < 0 && !branch.Contains("..") && !branch.Contains("@{") &&
        branch.Split('/').All(part => part.Length > 0 && !part.StartsWith('.') && !part.EndsWith('.') && !part.EndsWith(".lock", StringComparison.OrdinalIgnoreCase));
    private static List<TreeEntry> ReadTree(JsonElement tree, string expectedSha) {
        if (ShaField(tree) != expectedSha || !tree.TryGetProperty("truncated", out var truncated) || truncated.ValueKind != JsonValueKind.False ||
            !tree.TryGetProperty("tree", out var list) || list.ValueKind != JsonValueKind.Array)
            throw new IOException("云端目录信息不完整，已停止操作。");
        var entries = new List<TreeEntry>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in list.EnumerateArray()) {
            var path = StringField(item, "path");
            var mode = StringField(item, "mode");
            var type = StringField(item, "type");
            if (path.Length == 0 || path.Contains('/') || path.Contains('\0') || path is "." or ".." || !names.Add(path) ||
                !(type == "tree" && mode == "040000" || type == "blob" && mode is "100644" or "100755" or "120000" || type == "commit" && mode == "160000"))
                throw new IOException("云端目录条目无效，已停止操作。");
            entries.Add(new(path, mode, type, ShaField(item)));
        }
        return entries;
    }
}
