namespace Moye;

public static class DocumentRenaming {
    public static void RenameLocal(DocumentWorkspace workspace, OpenDocument document, string requested) {
        if (document.Cloud is not null) throw new IOException("云文档需要通过云端重命名。");
        var name = DocumentNames.Rename(requested, document.Name);
        if (document.Path is null) { document.UntitledName = name; document.AutoName = false; return; }
        var previous = Path.GetFullPath(document.Path);
        var target = Path.Combine(Path.GetDirectoryName(previous)!, name);
        if (workspace.PathOwnedByAnother(target, document.Id)) throw new IOException("该名称已在另一个标签页打开。");
        if (DocumentStore.HasConflict(previous, document.Fingerprint)) throw new IOException("磁盘文件已被修改或删除，请重新打开后再重命名。");
        if (string.Equals(previous, target, StringComparison.Ordinal)) { document.AutoName = false; return; }
        var caseOnly = DocumentWorkspace.SamePath(previous, target);
        if (caseOnly) throw new IOException("暂不支持仅修改本地文件名大小写，请先改为另一个名称。");
        if (File.Exists(target) || Directory.Exists(target)) throw new IOException("同目录已有同名文件，请使用其他名称。");
        if ((File.GetAttributes(previous) & FileAttributes.ReparsePoint) != 0) throw new IOException("暂不支持重命名链接文件。");
        File.Move(previous, target, false);
        document.Path = target; document.UntitledName = name; document.AutoName = false;
    }
}
