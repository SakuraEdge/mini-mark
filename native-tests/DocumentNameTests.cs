using System.Text;
using System.Text.Json;
using Moye;

static class DocumentNameTests {
    public static void Run(string folder, Action<bool, string> check) {
        foreach (var (text, expected) in new[] {
            ("# First title\nbody", "First title.md"), ("   # 标题 ###\nbody", "标题.md"),
            ("#\tTitle\t##", "Title.md"), ("# CON.md", "_CON.md.md"),
            ("# A <B>: \"C\" / D\\E|F?G*", "A B C D E F G.md"), ("# hello....   ", "hello.md")
        }) check(DocumentNames.FirstHeading(text) == expected, "First-line title normalization differs: " + text);
        foreach (var text in new[] { "\n# later", "body\n# later", "## title", "#### title", "    # indented", "\t# indented", "#no space", "# ", "# ###", "# #", "# <>:\"/\\|?*" })
            check(DocumentNames.FirstHeading(text) is null, "Non-title or empty first line renamed a document");
        var unicode = DocumentNames.FirstHeading("# " + string.Concat(Enumerable.Repeat("😀", 150)))!;
        check(unicode.EnumerateRunes().Count() <= 120 && Encoding.UTF8.GetByteCount(unicode) <= 240 && !unicode.Contains('\ufffd'), "Auto title exceeded Unicode bounds");
        var chinese = DocumentNames.FirstHeading("# " + new string('中', 200))!;
        check(Encoding.UTF8.GetByteCount(chinese) == 240 && chinese.EndsWith(".md"), "Chinese title exceeded portable filename byte limit");
        check(DocumentNames.Rename("new name", "old.yaml") == "new name.yaml", "Manual rename did not preserve extension");
        foreach (var invalid in new[] { "", " new.md", "new.md ", "new.", "../new.md", "new/name.md", "new\\name.md", "CON.md", "aux", "LPT1.txt", "a?.md", "a.exe", new string('x', 118) + ".md", new string('中', 80) + ".md" }) {
            try { DocumentNames.Rename(invalid, "old.md"); throw new Exception("Invalid rename accepted"); }
            catch (IOException) { check(true, "Invalid rename rejected"); }
        }
        var workspace = new DocumentWorkspace();
        var draft = workspace.AddNew("# Start");
        var id = draft.Id;
        check(draft.AutoName == true && draft.Name == "Start.md", "Generated Markdown draft did not name itself");
        draft.Update("# Changed", 1);
        draft.Update("No heading", 2);
        check(draft.Name == "Changed.md", "Non-H1 text did not preserve the last automatic name");
        var rapid = workspace.AddNew();
        rapid.Update("Heading was just removed", 2, "Transient title.md");
        check(rapid.Name == "Transient title.md", "Debounced H1 removal lost the renderer's verified automatic name");
        rapid.Update("# Current heading", 3, "Stale hint.md");
        check(rapid.Name == "Current heading.md", "Renderer hint overrode a current H1");
        rapid.Update("No heading", 4, "../unsafe.md");
        check(rapid.Name == "Current heading.md", "Unsafe auto-title hint was accepted");
        DocumentRenaming.RenameLocal(workspace, draft, "Manual");
        draft.Update("# Ignored", 3);
        check(draft.AutoName == false && draft.Name == "Manual.md" && draft.Id == id && draft.Revision == 3, "Manual rename did not permanently disable auto naming");
        foreach (var name in new[] { "sample.md", "未命名 8.md", "settings.yaml" }) {
            var named = workspace.AddNew("# Do not rename", name);
            check(named.Name == name && named.AutoName == false, "Explicitly named document auto-renamed");
        }
        var session = Path.Combine(folder, "auto-name-session.json");
        workspace.SaveSession(session);
        check(DocumentWorkspace.Restore(session, Path.Combine(folder, "absent-draft")).Find(id)!.AutoName == false, "Manual naming choice was not persisted");
        var legacy = new DocumentWorkspace();
        var inferred = legacy.AddNew("", "未命名 2.md"); inferred.AutoName = null; inferred.Text = "# Legacy";
        var namedLegacy = legacy.AddNew("# Keep", "named.md"); namedLegacy.AutoName = null;
        var blocked = legacy.AddNew("# Keep", "未命名 3.md"); blocked.AutoName = false;
        legacy.SaveSession(session);
        var restored = DocumentWorkspace.Restore(session, Path.Combine(folder, "absent-draft"));
        check(restored.Find(inferred.Id)!.Name == "Legacy.md" && restored.Find(inferred.Id)!.AutoName == true, "Legacy unnamed draft inference failed");
        check(restored.Find(namedLegacy.Id)!.Name == "named.md" && restored.Find(blocked.Id)!.Name == "未命名 3.md", "Legacy inference renamed explicit/manual documents");

        var source = Path.Combine(folder, "rename-source.md");
        DocumentStore.Write(source, "# Original\r\nbody\r\n", true, "\r\n");
        var originalBytes = File.ReadAllBytes(source);
        var local = workspace.Open(source);
        local.Update("# Unsaved title\nunsaved body", 8);
        var baseline = local.Baseline;
        var fingerprint = local.Fingerprint;
        DocumentRenaming.RenameLocal(workspace, local, "renamed");
        check(!File.Exists(source) && File.ReadAllBytes(local.Path!).SequenceEqual(originalBytes), "Local rename rewrote file content");
        check(local.Text == "# Unsaved title\nunsaved body" && local.Baseline == baseline && local.Fingerprint == fingerprint &&
            local.Bom && local.Newline == "\r\n" && local.Revision == 8 && local.Dirty, "Local rename lost unsaved text or encoding metadata");
        try { DocumentRenaming.RenameLocal(workspace, local, "RENAMED.md"); throw new Exception("Case-only rename accepted without safe platform support"); }
        catch (IOException) { check(Path.GetFileName(local.Path) == "renamed.md" && File.ReadAllBytes(local.Path!).SequenceEqual(originalBytes), "Rejected case-only rename changed the source"); }
        var collision = Path.Combine(folder, "collision.md"); File.WriteAllText(collision, "keep");
        var currentPath = local.Path;
        foreach (var target in new[] { "collision.md", "CON.md" }) {
            try { DocumentRenaming.RenameLocal(workspace, local, target); throw new Exception("Unsafe local rename succeeded"); }
            catch (IOException) { check(local.Path == currentPath && File.ReadAllText(collision) == "keep", "Failed rename changed files or metadata"); }
        }
        var another = workspace.Open(collision);
        try { DocumentRenaming.RenameLocal(workspace, local, another.Name); throw new Exception("Open-document collision succeeded"); }
        catch (IOException) { check(local.Path == currentPath, "Open-document collision changed metadata"); }
        File.AppendAllText(currentPath!, "external");
        try { DocumentRenaming.RenameLocal(workspace, local, "external-rename.md"); throw new Exception("Externally modified file renamed"); }
        catch (IOException) { check(local.Path == currentPath && !File.Exists(Path.Combine(folder, "external-rename.md")), "External conflict changed metadata or disk path"); }
        var cloud = workspace.AddNew("# Cloud", "cloud.md"); cloud.Cloud = new("alice", "cloud.md", new string('a', 40), "# Cloud"); cloud.AutoName = true;
        cloud.Update("# Still cloud", 1);
        check(cloud.Name == "cloud.md" && cloud.AutoName == false, "Cloud document auto-renamed");
    }
}
