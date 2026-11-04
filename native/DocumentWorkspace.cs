using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Moye;

public sealed class OpenDocument {
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string UntitledName { get; set; } = "未命名.md";
    public string? Path { get; set; }
    public string Text { get; set; } = "";
    public string Baseline { get; set; } = "";
    public string? Fingerprint { get; set; }
    public bool Bom { get; set; }
    public string Newline { get; set; } = "\n";
    public long Revision { get; set; }
    [JsonIgnore] public string Name => Path is null ? UntitledName : System.IO.Path.GetFileName(Path);
    [JsonIgnore] public bool Dirty => Text != Baseline;
    public bool Update(string text, long revision) {
        if (revision < Revision || (revision == Revision && text != Text)) return false;
        Text = text; Revision = revision; return true;
    }
    public void Load(LoadedDocument loaded) {
        Path = loaded.Path; Text = Baseline = loaded.Text;
        Fingerprint = loaded.Fingerprint; Bom = loaded.Bom; Newline = loaded.Newline;
    }
}
public sealed record WorkspaceSession(int SchemaVersion, List<OpenDocument> Documents, string ActiveId, int NextUntitled);

public sealed class DocumentWorkspace {
    public List<OpenDocument> Documents { get; } = [];
    public string ActiveId { get; private set; } = "";
    public int NextUntitled { get; private set; } = 1;
    public OpenDocument Active => Find(ActiveId) ?? throw new InvalidOperationException("No active document");
    public OpenDocument? Find(string? id) => Documents.Find(document => document.Id == id);
    public OpenDocument AddNew(string text = "", string? name = null, string baseline = "") {
        var document = new OpenDocument { Text = text, Baseline = baseline, UntitledName = name ?? $"未命名 {NextUntitled++}.md" };
        Documents.Add(document); ActiveId = document.Id; return document;
    }
    public OpenDocument Open(string path) {
        var absolute = System.IO.Path.GetFullPath(path);
        var existing = Documents.Find(document => document.Path is not null && SamePath(document.Path, absolute));
        if (existing is not null) { ActiveId = existing.Id; return existing; }
        var loaded = DocumentStore.Read(absolute);
        var document = new OpenDocument(); document.Load(loaded);
        Documents.Add(document); ActiveId = document.Id; return document;
    }
    public bool Activate(string id) {
        if (Find(id) is null) return false;
        ActiveId = id; return true;
    }
    public void Remove(string id) {
        var index = Documents.FindIndex(document => document.Id == id);
        if (index < 0) return;
        Documents.RemoveAt(index);
        if (Documents.Count == 0) AddNew();
        else if (ActiveId == id) ActiveId = Documents[Math.Min(index, Documents.Count - 1)].Id;
    }
    public bool PathOwnedByAnother(string path, string id) => Documents.Any(document => document.Id != id && document.Path is not null && SamePath(path, document.Path));
    public static bool SamePath(string a, string b) => string.Equals(System.IO.Path.GetFullPath(a), System.IO.Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);
    public void SaveSession(string file) {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(file)!);
        DocumentStore.AtomicWrite(file, JsonSerializer.SerializeToUtf8Bytes(new WorkspaceSession(2, Documents, ActiveId, NextUntitled)));
    }
    public static DocumentWorkspace Restore(string sessionFile, string legacyFile) {
        var workspace = new DocumentWorkspace();
        if (File.Exists(sessionFile)) {
            var session = JsonSerializer.Deserialize<WorkspaceSession>(File.ReadAllText(sessionFile)) ?? throw new IOException("会话文件为空。");
            if (session.SchemaVersion != 2) throw new IOException("会话版本不受支持；原会话文件将保留。");
            if (session.Documents is null || session.Documents.Any(document => document is null || string.IsNullOrEmpty(document.Id) || document.Text is null || document.Baseline is null) || session.Documents.Select(document => document.Id).Distinct().Count() != session.Documents.Count) throw new IOException("会话文件内容无效；原会话文件将保留。");
            workspace.Documents.AddRange(session.Documents);
            workspace.NextUntitled = Math.Max(1, session.NextUntitled);
            workspace.ActiveId = workspace.Find(session.ActiveId)?.Id ?? workspace.Documents.FirstOrDefault()?.Id ?? "";
            foreach (var document in workspace.Documents.Where(document => !document.Dirty && document.Path is not null)) {
                try { document.Load(DocumentStore.Read(document.Path!)); }
                catch (IOException) { document.UntitledName = document.Name; document.Path = null; document.Baseline = ""; }
                catch (UnauthorizedAccessException) { document.UntitledName = document.Name; document.Path = null; document.Baseline = ""; }
            }
        } else if (DocumentStore.ReadDraft(legacyFile) is Draft draft) {
            var document = workspace.AddNew(draft.Text, draft.Path is null ? "未命名.md" : System.IO.Path.GetFileName(draft.Path), draft.Baseline);
            document.Path = draft.Path; document.Fingerprint = draft.Fingerprint; document.Bom = draft.Bom; document.Newline = draft.Newline;
            if (!document.Dirty && document.Path is not null && File.Exists(document.Path)) document.Load(DocumentStore.Read(document.Path));
            // Keep the legacy draft as a backup; v2 takes precedence next time.
            workspace.SaveSession(sessionFile);
        }
        return workspace;
    }
}
