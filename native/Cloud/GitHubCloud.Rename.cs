namespace Moye;

public sealed partial class GitHubCloud {
    public async Task<CloudRename> Rename(string owner, string path, string sha, string requested) {
        CloudPaths.Validate(path);
        var oldName = path.Split('/')[^1];
        var name = DocumentNames.Rename(requested, oldName);
        if (name == oldName) throw new IOException("新文件名与当前名称相同。");
        var parent = path.Contains('/') ? path[..(path.LastIndexOf('/') + 1)] : "";
        var target = parent + name;
        CloudPaths.Validate(target);
        var commit = await MutateTree(owner, path, sha, "file", name);
        return new(target, path, sha, commit);
    }
}
