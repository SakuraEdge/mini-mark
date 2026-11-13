namespace Moye;

public sealed partial class GitHubCloud {
    public async Task<CloudDeletion> Delete(string owner, string path, string sha, string type) {
        var commit = await MutateTree(owner, path, sha, type);
        return new(path, type, true, commit);
    }
}
