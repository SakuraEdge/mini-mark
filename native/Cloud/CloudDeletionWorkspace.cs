namespace Moye;

public static class CloudDeletionWorkspace {
    public static bool Includes(CloudBinding binding, string owner, string path, string type) =>
        binding.Owner.Equals(owner, StringComparison.OrdinalIgnoreCase) &&
        (binding.Path == path || type == "dir" && binding.Path.StartsWith(path + "/", StringComparison.Ordinal));

    public static int Detach(DocumentWorkspace workspace, string owner, CloudDeletion deletion) {
        var count = 0;
        foreach (var document in workspace.Documents) {
            if (document.Cloud is null || !Includes(document.Cloud, owner, deletion.Path, deletion.Type)) continue;
            document.UntitledName = document.Name;
            document.Cloud = null;
            document.AutoName = false;
            count++;
        }
        return count;
    }
}
