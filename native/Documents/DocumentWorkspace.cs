using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Moye;

public sealed class OpenDocument {
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string UntitledName { get; set; } = "未命名.md";
    public string? Path { get; set; }
    private string text = "", baseline = "";
    public string Text { get => text; set => text = value is null ? null! : DocumentStore.Normalize(value); }
    public string Baseline { get => baseline; set => baseline = value is null ? null! : DocumentStore.Normalize(value); }
    public string? Fingerprint { get; set; }
    public bool Bom { get; set; }
    public string Newline { get; set; } = "\n";
    public long Revision { get; set; }
    public bool? AutoName { get; set; }
    public CloudBinding? Cloud { get; set; }
    [JsonIgnore] public string Name => Cloud is not null ? Cloud.Path.Split('/')[^1] : Path is null ? UntitledName : System.IO.Path.GetFileName(Path);
    [JsonIgnore] public string SavedBaseline => Cloud?.Baseline ?? Baseline;
    [JsonIgnore] public bool Dirty => Text != SavedBaseline;
    public bool Update(string text, long revision, string? autoTitle = null) {
        text = DocumentStore.Normalize(text);
        if (revision < Revision || (revision == Revision && text != Text)) return false;
        Text = text; Revision = revision; UpdateAutoName();
        if (AutoName == true && Path is null && Cloud is null && DocumentNames.FirstHeading(Text) is null && autoTitle is not null) {
            try {
                var name = DocumentNames.Rename(autoTitle, UntitledName);
                if (name == autoTitle && DocumentNames.IsMarkdown(name)) UntitledName = name;
            } catch (IOException) { }
        }
        return true;
    }
    public void UpdateAutoName() {
        if (Path is not null || Cloud is not null || !DocumentNames.IsMarkdown(UntitledName)) { AutoName = false; return; }
        AutoName ??= DocumentNames.IsLegacyUntitled(UntitledName);
        if (AutoName == true && DocumentNames.FirstHeading(Text) is string name) UntitledName = name;
    }
    public void Load(LoadedDocument loaded) {
        Path = loaded.Path; Text = Baseline = loaded.Text;
        Fingerprint = loaded.Fingerprint; Bom = loaded.Bom; Newline = loaded.Newline;
        AutoName = false;
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
        var document = new OpenDocument { Text = text, Baseline = baseline, UntitledName = name ?? NextUntitledName(), AutoName = name is null };
        document.UpdateAutoName();
        Documents.Add(document); ActiveId = document.Id; return document;
    }
    private string NextUntitledName() {
        var number = 1;
        while (Documents.Any(document => string.Equals(document.Name, $"未命名 {number}.md", StringComparison.OrdinalIgnoreCase))) number++;
        NextUntitled = number + 1;
        return $"未命名 {number}.md";
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
            foreach (var document in workspace.Documents) document.UpdateAutoName();
            // Untitled numbering is recalculated for each process, not continued from an old session.
            workspace.NextUntitled = 1;
            workspace.ActiveId = workspace.Find(session.ActiveId)?.Id ?? workspace.Documents.FirstOrDefault()?.Id ?? "";
            foreach (var document in workspace.Documents.Where(document => !document.Dirty && document.Path is not null && document.Cloud is null)) {
                try { document.Load(DocumentStore.Read(document.Path!)); }
                catch (IOException) { document.UntitledName = document.Name; document.Path = null; document.Baseline = ""; }
                catch (UnauthorizedAccessException) { document.UntitledName = document.Name; document.Path = null; document.Baseline = ""; }
            }
        } else if (DocumentStore.ReadDraft(legacyFile) is Draft draft) {
            var document = workspace.AddNew(draft.Text, draft.Path is null ? "未命名.md" : System.IO.Path.GetFileName(draft.Path), draft.Baseline);
            document.Path = draft.Path; document.Fingerprint = draft.Fingerprint; document.Bom = draft.Bom; document.Newline = draft.Newline;
            document.AutoName = draft.Path is null;
            document.UpdateAutoName();
            if (!document.Dirty && document.Path is not null && File.Exists(document.Path)) document.Load(DocumentStore.Read(document.Path));
            // Keep the legacy draft as a backup; v2 takes precedence next time.
            workspace.SaveSession(sessionFile);
        }
        return workspace;
    }
}
