using System.Text;
using Moye;

var folder = Path.Combine(Path.GetTempPath(), "moye-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
var count = 0;
void Check(bool valid, string message) { if (!valid) throw new Exception(message); count++; }
try {
    var previewFolder = Path.Combine(folder, "html");
    Directory.CreateDirectory(previewFolder);
    File.WriteAllText(Path.Combine(previewFolder, "index.html"), "<h1>HTML</h1>");
    File.WriteAllText(Path.Combine(previewFolder, "test.js"), "window.ready=true");
    Check(Encoding.UTF8.GetString(HtmlResources.Read(previewFolder, "index.html").Data) == "<h1>HTML</h1>", "HTML resource read failed");
    Check(HtmlResources.Read(previewFolder, "test.js").Mime.StartsWith("text/javascript"), "JavaScript MIME incorrect");
    Check(HtmlResources.IsHtml("中文.HTM") && !HtmlResources.IsHtml("x.md"), "HTML extension recognition failed");
    foreach (var bad in new[] { "../index.html", "/index.html", "folder/../../index.html", "C:/index.html", "index.html:secret", "secret.txt", "a\\test.js" }) {
        try { HtmlResources.Read(previewFolder, bad); throw new Exception("Unsafe HTML resource accepted"); }
        catch (IOException) { count++; }
    }
    var file = Path.Combine(folder, "中文 文件.md");
    var fingerprint = DocumentStore.Write(file, "# 标题\n公式 $$x$$\n", true, "\r\n");
    var document = DocumentStore.Read(file);
    Check(document.Bom, "UTF-8 BOM lost");
    Check(document.Newline == "\r\n", "CRLF lost");
    Check(document.Text == "# 标题\n公式 $$x$$\n", "Text did not round trip");
    Check(!DocumentStore.HasConflict(file, fingerprint), "Unchanged file reported conflict");
    File.AppendAllText(file, "external");
    Check(DocumentStore.HasConflict(file, fingerprint), "External modification missed");
    var draftFile = Path.Combine(folder, "draft.json");
    var draft = new Draft(file, "未保存\n", document.Text, fingerprint, true, "\r\n");
    DocumentStore.SaveDraft(draftFile, draft);
    Check(DocumentStore.ReadDraft(draftFile) == draft, "Draft did not round trip");
    DocumentStore.Write(file, "next\nline", false, "\n");
    Check(!DocumentStore.Read(file).Bom, "Unexpected BOM");
    Check(!Directory.EnumerateFiles(folder, "*.tmp").Any(), "Temporary files left behind");
    var imageBytes = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3 };
    var imageData = "data:" + "image/png;base64," + Convert.ToBase64String(imageBytes);
    Check(ImageAssets.Import(imageData, null) == imageData, "Draft image must remain portable");
    var imagePath = ImageAssets.Import(imageData, file);
    Check(imagePath.StartsWith("assets/mini-mark-") && File.ReadAllBytes(Path.Combine(folder, imagePath)).SequenceEqual(imageBytes), "Image asset did not round trip");
    Check(ImageAssets.ReadLocal(folder, imagePath).Data.SequenceEqual(imageBytes), "Document image resource failed");
    try { ImageAssets.ReadLocal(folder, "../escape.png"); throw new Exception("Image traversal accepted"); }
    catch (IOException) { count++; }
    try { ImageAssets.ReadLocal(folder, "session-v2.json"); throw new Exception("Non-image resource accepted"); }
    catch (IOException) { count++; }
    Check(ImageAssets.Import(imageData, file) == imagePath && Directory.GetFiles(Path.Combine(folder, "assets")).Length == 1, "Identical images were duplicated");
    var movedFile = Path.Combine(folder, "moved", "note.md");
    ImageAssets.CopyForSaveAs("![](" + imagePath + ")", file, movedFile);
    Check(File.ReadAllBytes(Path.Combine(folder, "moved", imagePath)).SequenceEqual(imageBytes), "Save As lost imported image assets");
    try { ImageAssets.Import("data:" + "image/png;base64," + Convert.ToBase64String("invalid"u8.ToArray()), file); throw new Exception("Invalid image signature accepted"); }
    catch (IOException) { count++; }
    File.WriteAllText(Path.Combine(folder, imagePath), "user modified");
    try { ImageAssets.Import(imageData, file); throw new Exception("Modified asset was overwritten"); }
    catch (IOException) { count++; }
    File.WriteAllBytes(file, new byte[] { 0xff, 0xfe, 0x00 });
    try { DocumentStore.Read(file); throw new Exception("Invalid UTF-8 accepted"); }
    catch (DecoderFallbackException) { count++; }
    File.WriteAllText(draftFile, "{broken");
    Check(DocumentStore.ReadDraft(draftFile) is null, "Corrupt draft was accepted");
    Check(DocumentStore.HasConflict(Path.Combine(folder, "missing.md"), fingerprint), "Deleted file conflict missed");
    var workspace = new DocumentWorkspace();
    var a = workspace.AddNew("草稿 A");
    var b = workspace.AddNew("草稿 B");
    Check(workspace.Documents.Count == 2 && a.Text == "草稿 A", "New document replaced old draft");
    Check(a.Name != b.Name, "Untitled names must be distinct");
    Check(a.Update("最后输入", 3) && !a.Update("过期", 2), "Stale revision accepted");
    Check(a.Text == "最后输入" && b.Text == "草稿 B", "Cross-document update leaked");
    var sessionFile = Path.Combine(folder, "session-v2.json");
    workspace.Activate(a.Id); workspace.SaveSession(sessionFile);
    var restored = DocumentWorkspace.Restore(sessionFile, draftFile);
    Check(restored.Documents.Count == 2 && restored.ActiveId == a.Id && restored.Active.Text == "最后输入", "Multi-document recovery failed");
    var namingWorkspace = new DocumentWorkspace();
    namingWorkspace.AddNew("", "历史.md");
    namingWorkspace.AddNew("", "未命名 9.md");
    var namingSession = Path.Combine(folder, "naming-session.json");
    namingWorkspace.SaveSession(namingSession);
    var namingRestored = DocumentWorkspace.Restore(namingSession, draftFile);
    Check(namingRestored.AddNew().Name == "未命名 1.md", "Untitled numbering did not restart at one");
    workspace.Remove(a.Id);
    Check(workspace.ActiveId == b.Id, "Close did not select adjacent document");
    workspace.Remove(b.Id);
    Check(workspace.Documents.Count == 1 && workspace.Active.Text == "", "Last close did not create blank document");
    DocumentStore.Write(file, "磁盘内容", true, "\r\n");
    var opened = workspace.Open(file);
    var repeated = workspace.Open(file);
    Check(opened.Id == repeated.Id && workspace.Documents.Count == 2, "Opening same path created duplicates");
    Check(workspace.PathOwnedByAnother(file, workspace.Documents[0].Id), "Overwriting another tab's path was allowed");
    var legacy = new Draft(file, "旧草稿", "原文", "fingerprint", true, "\r\n");
    DocumentStore.SaveDraft(draftFile, legacy);
    var migrated = DocumentWorkspace.Restore(Path.Combine(folder, "migrated-v2.json"), draftFile);
    Check(migrated.Active.Text == legacy.Text && migrated.Active.Bom && migrated.Active.Newline == "\r\n", "Legacy draft metadata lost");
    Check(DocumentStore.ReadDraft(draftFile) == legacy, "Legacy backup was changed");
    var migratedAgain = DocumentWorkspace.Restore(Path.Combine(folder, "migrated-v2.json"), draftFile);
    Check(migratedAgain.Documents.Count == 1 && migratedAgain.ActiveId == migrated.ActiveId, "Migration created duplicate tabs");
    var windows = workspace.AddNew("# Windows\r\nbody\r", "Windows.md", "# Windows\nbody\n");
    Check(!windows.Dirty && windows.Text == windows.Baseline, "CRLF sample was marked dirty before editing");
    Check(windows.Update("# Windows\nbody\n", 0), "Normalized editor text rejected at the same revision");
    windows.Newline = "\r\n";
    workspace.SaveSession(sessionFile);
    var oldSession = File.ReadAllText(sessionFile).Replace("# Windows\\nbody\\n", "# Windows\\r\\nbody\\r\\n");
    File.WriteAllText(sessionFile, oldSession);
    var normalizedRestore = DocumentWorkspace.Restore(sessionFile, draftFile).Find(windows.Id)!;
    Check(!normalizedRestore.Dirty && normalizedRestore.Text == "# Windows\nbody\n" && normalizedRestore.Newline == "\r\n", "Legacy CRLF session did not normalize while preserving save format");
    await UpdateTests.Run(folder, Check);
    await CloudTests.Run(folder, Check);
    await CloudDeleteTests.Run(folder, Check);
    DocumentNameTests.Run(folder, Check);
    if (args.Contains("--live-update")) {
        var live = await new GitHubUpdates(Path.Combine(folder, "live")).Check();
        Check(!live.OfflineCache, "Live update check used an offline cache");
        Console.WriteLine($"Public static update feed: v{live.Manifest.Version}");
    }
    Console.WriteLine($"PASS {count} native storage, cloud and update checks");
} finally { Directory.Delete(folder, true); }
