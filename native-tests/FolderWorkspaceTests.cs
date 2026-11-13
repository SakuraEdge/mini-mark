using System.Text;
using System.Text.Json;
using Moye;

static class FolderWorkspaceTests {
    public static void Run(string temporary, Action<bool, string> check) {
        var folder = Path.Combine(temporary, "folder-tests");
        var profile = Path.Combine(folder, "profile");
        var rootPath = Path.Combine(folder, "workspace");
        var outside = Path.Combine(folder, "workspace-other");
        Directory.CreateDirectory(profile);
        Directory.CreateDirectory(rootPath);
        Directory.CreateDirectory(outside);
        Directory.CreateDirectory(Path.Combine(outside, "child"));
        File.WriteAllText(Path.Combine(outside, "outside.md"), "Outside");
        var saved = Path.Combine(profile, "workspace-folder.json");
        var folders = new FolderWorkspace(profile);
        check(folders.Root is null && folders.Restore() is null && !File.Exists(saved), "Folder workspace loaded or created a root without authorization");
        void Reject(Action action, string message) {
            try { action(); } catch (IOException) { check(true, message); return; }
            throw new Exception(message);
        }
        Reject(() => folders.List("never-authorized"), "Unauthenticated folder listing accepted");
        var root = folders.SelectRoot(rootPath);
        var empty = folders.List(root.Id);
        check(root.Path == rootPath && root.Name == "workspace" && empty.Entries.Count == 0 && empty.NextOffset is null, "Empty chosen root did not round trip");
        check(new FolderWorkspace(profile).Root is null, "Folder constructor restored a saved root eagerly");
        var first = new FolderWorkspace(profile);
        var restored = first.Restore()!;
        check(restored.Path == root.Path && restored.Id != root.Id && first.List(restored.Id).Root == restored, "Restored folder root reused stale authorization");
        Reject(() => first.List(root.Id), "Old root ID was accepted after restoration");
        Reject(() => folders.SelectRoot(Path.Combine(rootPath, "missing")), "Missing root was accepted");
        check(folders.Root == root && File.Exists(saved), "Invalid root selection discarded authorization");
        Directory.CreateDirectory(Path.Combine(rootPath, "z-directory"));
        Directory.CreateDirectory(Path.Combine(rootPath, ".hidden"));
        Directory.CreateDirectory(Path.Combine(rootPath, "中文目录"));
        File.WriteAllText(Path.Combine(rootPath, "A.md"), "# Alpha\n");
        File.WriteAllText(Path.Combine(rootPath, ".secret"), "hidden");
        File.WriteAllText(Path.Combine(rootPath, "program.exe"), "not executed");
        File.WriteAllText(Path.Combine(rootPath, "中文目录", "中文 文档.YAML"), "name: 示例\n", new UTF8Encoding(true));
        foreach (var extension in new[] { "md", "markdown", "mdown", "txt", "yaml", "yml", "html", "htm" })
            File.WriteAllText(Path.Combine(rootPath, "extension." + extension), extension);
        var listing = folders.List(root.Id);
        check(listing.Entries.Take(3).All(entry => entry.Type == "directory") && listing.Entries[0].Name == ".hidden", "Folder ordering or dot directory visibility failed");
        check(listing.Entries.Any(entry => entry.Name == ".secret" && !entry.Supported) &&
            listing.Entries.Any(entry => entry.Name == "program.exe" && !entry.Supported), "Unsupported or hidden files were omitted");
        check(listing.Entries.Where(entry => entry.Name.StartsWith("extension.", StringComparison.Ordinal)).All(entry => entry.Supported), "Supported document extensions were disabled");
        var nested = folders.List(root.Id, "中文目录");
        check(nested.Path == "中文目录" && nested.Entries.Single().Path == "中文目录/中文 文档.YAML", "Unicode child paths did not round trip");
        var yaml = folders.Read(root.Id, nested.Entries.Single().Path);
        check(yaml.Bom && yaml.Text == "name: 示例\n", "Workspace read lost UTF-8 BOM or document text");
        var drafts = new DocumentWorkspace();
        var draft = drafts.AddNew("Unsaved original");
        var opened = folders.OpenInto(drafts, root.Id, yaml);
        opened.Update("Newer unsaved YAML", 1);
        var again = folders.OpenInto(drafts, root.Id, folders.Read(root.Id, nested.Entries.Single().Path));
        check(again.Id == opened.Id && again.Text == "Newer unsaved YAML" && drafts.Documents.Count == 2 &&
            draft.Text == "Unsaved original", "Workspace opening replaced an existing dirty tab or unrelated draft");
        foreach (var invalid in new[] { "../workspace-other", "/absolute", "C:/Windows", @"C:\Windows", @"\\server\share",
            "中文目录/../A.md", "中文目录//x", ".", "..", "A.md:stream", "A.md ", "A.md.", "a\\b", "a\0b", "CON.md" }) {
            Reject(() => folders.List(root.Id, invalid), "Unsafe relative folder path accepted");
            Reject(() => folders.Read(root.Id, invalid), "Unsafe relative document path accepted");
        }
        Reject(() => folders.Read(root.Id, ""), "Root was opened as a document");
        Reject(() => folders.Read(root.Id, "program.exe"), "Unsupported executable was opened");
        Reject(() => folders.List(root.Id, "A.md"), "Document was listed as a directory");
        Reject(() => folders.List(root.Id, "", -1), "Negative pagination offset accepted");
        check(folders.List(root.Id, "", int.MaxValue).Entries.Count == 0, "Out-of-range pagination overflowed");
        File.WriteAllBytes(Path.Combine(rootPath, "binary.md"), [0xff, 0xfe, 0x00]);
        try { folders.Read(root.Id, "binary.md"); throw new Exception("Invalid UTF-8 workspace file accepted"); }
        catch (DecoderFallbackException) { check(true, "Invalid UTF-8 rejected"); }
        File.WriteAllText(Path.Combine(rootPath, "nul.md"), "text\0binary");
        Reject(() => folders.Read(root.Id, "nul.md"), "Binary workspace file accepted");
        using (var oversized = File.Create(Path.Combine(rootPath, "large.md"))) oversized.SetLength(DocumentStore.MaxFileBytes + 1);
        Reject(() => folders.Read(root.Id, "large.md"), "Oversized workspace file accepted");
        var pages = Path.Combine(rootPath, "pages");
        Directory.CreateDirectory(pages);
        for (var index = 0; index < 505; index++) File.WriteAllText(Path.Combine(pages, $"entry-{index:D3}.md"), "");
        var pageOne = folders.List(root.Id, "pages");
        var pageTwo = folders.List(root.Id, "pages", pageOne.NextOffset!.Value);
        check(pageOne.Entries.Count == 500 && pageOne.NextOffset == 500 && pageTwo.Entries.Count == 5 && pageTwo.NextOffset is null &&
            pageOne.Entries.Concat(pageTwo.Entries).Select(entry => entry.Path).Distinct().Count() == 505, "Folder pagination lost or duplicated immediate children");
        check(pageOne.Entries[0].Name == "entry-000.md" && pageTwo.Entries[^1].Name == "entry-504.md", "Folder pagination was not stably sorted");
        CheckLinks(folders, root, rootPath, outside, check, Reject);
        var replacement = folders.SelectRoot(outside);
        Reject(() => folders.Read(root.Id, "A.md"), "Changed root retained previous authorization");
        Reject(() => folders.OpenInto(drafts, root.Id, yaml), "Late loaded document entered workspace after root changed");
        folders.Close();
        check(folders.Root is null && !File.Exists(saved) && new FolderWorkspace(profile).Restore() is null, "Closing folder did not revoke persisted root");
        Reject(() => folders.List(replacement.Id), "Closed root retained authorization");
        check(drafts.Documents.Count == 2 && draft.Text == "Unsaved original" && opened.Text == "Newer unsaved YAML", "Closing folder modified document drafts");
        File.WriteAllText(saved, "{invalid");
        Reject(() => new FolderWorkspace(profile).Restore(), "Malformed saved folder configuration accepted");
        File.WriteAllText(saved, JsonSerializer.Serialize(new { schemaVersion = 1, path = Path.Combine(folder, "missing") }));
        Reject(() => new FolderWorkspace(profile).Restore(), "Missing restored folder was accepted");
        check(File.Exists(saved), "Failed restoration erased the chosen folder setting");
    }

    private static void CheckLinks(FolderWorkspace folders, FolderRoot root, string path, string outside,
        Action<bool, string> check, Action<Action, string> reject) {
        var directoryLink = Path.Combine(path, "linked-directory");
        var fileLink = Path.Combine(path, "linked.md");
        try {
            var start = new System.Diagnostics.ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NonInteractive"); start.ArgumentList.Add("-Command");
            start.ArgumentList.Add("New-Item -ItemType Junction -Path $env:MOYE_TEST_LINK -Target $env:MOYE_TEST_TARGET -ErrorAction Stop | Out-Null");
            start.Environment["MOYE_TEST_LINK"] = directoryLink;
            start.Environment["MOYE_TEST_TARGET"] = outside;
            using var process = System.Diagnostics.Process.Start(start)!;
            process.WaitForExit();
            if (process.ExitCode != 0) throw new Exception("Could not create isolated junction fixture: " + process.StandardError.ReadToEnd());
            var entries = folders.List(root.Id).Entries;
            check(entries.Any(entry => entry.Name == "linked-directory" && entry.Type == "directory" && entry.Link && !entry.Supported), "Directory links were not listed as disabled entries");
            reject(() => folders.List(root.Id, "linked-directory"), "Directory link traversal accepted");
            reject(() => folders.Read(root.Id, "linked-directory/outside.md"), "Intermediate directory link escaped the root");
            reject(() => folders.SelectRoot(directoryLink), "Linked workspace root was authorized");
            reject(() => folders.SelectRoot(Path.Combine(directoryLink, "child")), "Linked workspace ancestor was authorized");
            try {
                File.CreateSymbolicLink(fileLink, Path.Combine(outside, "outside.md"));
                check(folders.List(root.Id).Entries.Any(entry => entry.Name == "linked.md" && entry.Link && !entry.Supported), "File links were not listed as disabled entries");
                reject(() => folders.Read(root.Id, "linked.md"), "Linked document was opened");
            } catch (Exception error) when (error is UnauthorizedAccessException || error is IOException && (error.HResult & 0xffff) == 1314) {
                Console.WriteLine("SKIP file symbolic-link fixture: Windows developer mode or symlink privilege is unavailable; directory junction checks ran");
            }
        } finally {
            if (File.Exists(fileLink)) File.Delete(fileLink);
            if (Directory.Exists(directoryLink)) Directory.Delete(directoryLink);
        }
    }
}
