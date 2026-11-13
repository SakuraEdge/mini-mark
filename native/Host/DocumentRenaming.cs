namespace Moye;

public sealed partial class MainWindow {
    private async Task RenameDocument(string id, string requested, long queuedMutationRevision, CloudBinding? expectedBinding) {
        var document = workspace.Find(id) ?? throw new IOException("文档已关闭。");
        if (queuedMutationRevision != cloudDeletionRevision || document.Cloud != expectedBinding)
            throw new IOException("文档存储位置已变化，请重新重命名。");
        var name = DocumentNames.Rename(requested, document.Name);
        if (document.Cloud is CloudBinding binding) {
            if (name == document.Name) { document.AutoName = false; Publish(); Persist(); return; }
            var target = binding.Path.Contains('/') ? binding.Path[..(binding.Path.LastIndexOf('/') + 1)] + name : name;
            if (workspace.Documents.Any(item => item.Id != id && item.Cloud?.Owner.Equals(binding.Owner, StringComparison.OrdinalIgnoreCase) == true && item.Cloud.Path == target))
                throw new IOException("此云端名称已在其他标签打开。");
            var renamed = await cloud.Rename(binding.Owner, binding.Path, binding.Sha ?? "", name);
            cloudDeletionRevision++;
            CloudRenameWorkspace.Apply(workspace, binding.Owner, renamed);
        } else DocumentRenaming.RenameLocal(workspace, document, name);
        Publish(); Persist();
    }
}
