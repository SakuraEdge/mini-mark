using System.Text;
using Moye;

var folder = Path.Combine(Path.GetTempPath(), "moye-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
var count = 0;
void Check(bool valid, string message) { if (!valid) throw new Exception(message); count++; }
try {
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
    File.WriteAllBytes(file, new byte[] { 0xff, 0xfe, 0x00 });
    try { DocumentStore.Read(file); throw new Exception("Invalid UTF-8 accepted"); }
    catch (DecoderFallbackException) { count++; }
    File.WriteAllText(draftFile, "{broken");
    Check(DocumentStore.ReadDraft(draftFile) is null, "Corrupt draft was accepted");
    Check(DocumentStore.HasConflict(Path.Combine(folder, "missing.md"), fingerprint), "Deleted file conflict missed");
    Console.WriteLine($"PASS {count} native storage checks");
} finally { Directory.Delete(folder, true); }
