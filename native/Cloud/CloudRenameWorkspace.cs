namespace Moye;

public static class CloudRenameWorkspace {
    public static void Apply(DocumentWorkspace workspace, string owner, CloudRename renamed) {
        foreach (var document in workspace.Documents) {
            var binding = document.Cloud;
            if (binding is null || !binding.Owner.Equals(owner, StringComparison.OrdinalIgnoreCase) || binding.Path != renamed.PreviousPath) continue;
            document.Cloud = binding with { Path = renamed.Path, Sha = renamed.Sha };
            document.UntitledName = renamed.Path.Split('/')[^1]; document.AutoName = false;
        }
    }
}
