using System.Text.Json;

namespace Moye;

public sealed record FolderRoot(string Id, string Name, string Path);
public sealed record FolderEntry(string Name, string Path, string Type, bool Supported, bool Link = false);
public sealed record FolderListing(FolderRoot? Root, string Path, IReadOnlyList<FolderEntry> Entries, int? NextOffset = null);

public sealed class FolderWorkspace(string dataRoot) {
    public const int PageSize = 500;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly object gate = new();
    private readonly object changes = new();
    private readonly string settingsFile = System.IO.Path.Combine(dataRoot, "workspace-folder.json");
    private FolderRoot? selected;
    private sealed record FolderSettings(int SchemaVersion, string Path);

    public FolderRoot? Root { get { lock (gate) return selected; } }

    public FolderRoot SelectRoot(string path) {
        lock (changes) {
            var absolute = CanonicalRoot(path);
            using var access = FolderAccess.Directory(absolute);
            var root = NewRoot(absolute);
            System.IO.Directory.CreateDirectory(dataRoot);
            DocumentStore.AtomicWrite(settingsFile, JsonSerializer.SerializeToUtf8Bytes(new FolderSettings(1, absolute), JsonOptions));
            lock (gate) selected = root;
            return root;
        }
    }

    public FolderRoot? Restore() {
        lock (changes) {
            if (!File.Exists(settingsFile)) { lock (gate) selected = null; return null; }
            if (new FileInfo(settingsFile).Length > 16384) throw new IOException("保存的工作区配置无效，请重新选择文件夹。");
            FolderSettings settings;
            try { settings = JsonSerializer.Deserialize<FolderSettings>(File.ReadAllBytes(settingsFile), JsonOptions) ?? throw new JsonException(); }
            catch (JsonException) { throw new IOException("保存的工作区配置无效，请重新选择文件夹。"); }
            if (settings.SchemaVersion != 1) throw new IOException("保存的工作区配置版本无效，请重新选择文件夹。");
            var absolute = CanonicalRoot(settings.Path);
            using var access = FolderAccess.Directory(absolute);
            var root = NewRoot(absolute);
            lock (gate) selected = root;
            return root;
        }
    }

    public void Close() {
        lock (changes) {
            lock (gate) selected = null;
            if (File.Exists(settingsFile)) File.Delete(settingsFile);
        }
    }

    public FolderListing List(string rootId, string path = "", int offset = 0) {
        if (offset < 0) throw new IOException("目录分页位置无效。");
        var root = Require(rootId);
        var relative = ValidateRelative(path, true);
        var absolute = Resolve(root, relative);
        using var access = FolderAccess.Directory(absolute);
        var entries = new List<FolderEntry>();
        var options = new EnumerationOptions { RecurseSubdirectories = false, AttributesToSkip = 0, IgnoreInaccessible = false };
        foreach (var entry in new DirectoryInfo(absolute).EnumerateFileSystemInfos("*", options)) {
            FileAttributes attributes;
            try { attributes = entry.Attributes; }
            catch (FileNotFoundException) { continue; }
            catch (DirectoryNotFoundException) { continue; }
            var directory = attributes.HasFlag(FileAttributes.Directory);
            var link = attributes.HasFlag(FileAttributes.ReparsePoint);
            var itemPath = relative.Length == 0 ? entry.Name : relative + "/" + entry.Name;
            var usable = IsRelative(itemPath) && !link;
            entries.Add(new FolderEntry(entry.Name, itemPath, directory ? "directory" : "file",
                usable && (directory || IsSupported(entry.Name)), link));
        }
        var ordered = entries.OrderBy(entry => entry.Type == "directory" ? 0 : 1)
            .ThenBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase).ThenBy(entry => entry.Name, StringComparer.Ordinal).ToArray();
        var page = ordered.Skip(offset).Take(PageSize).ToArray();
        EnsureCurrent(rootId);
        return new FolderListing(root, relative, page, (long)offset + page.Length < ordered.Length ? offset + page.Length : null);
    }

    public LoadedDocument Read(string rootId, string path) {
        var root = Require(rootId);
        var relative = ValidateRelative(path, false);
        if (!IsSupported(relative)) throw new IOException("工作区仅支持打开 Markdown、YAML、HTML 和 TXT 文档。");
        var absolute = Resolve(root, relative);
        using var access = FolderAccess.Directory(System.IO.Path.GetDirectoryName(absolute)!);
        var loaded = DocumentStore.Decode(absolute, access.ReadFile(absolute));
        EnsureCurrent(rootId);
        return loaded;
    }

    public void EnsureCurrent(string rootId) => Require(rootId);

    public OpenDocument OpenInto(DocumentWorkspace workspace, string rootId, LoadedDocument loaded) {
        lock (gate) {
            Require(rootId);
            return workspace.Open(loaded);
        }
    }

    public static bool IsSupported(string path) => System.IO.Path.GetExtension(path).ToLowerInvariant()
        is ".md" or ".markdown" or ".mdown" or ".txt" or ".yaml" or ".yml" or ".html" or ".htm";

    private FolderRoot Require(string rootId) {
        lock (gate) return selected is not null && selected.Id == rootId ? selected : throw new IOException("工作区已关闭或改变，请刷新后重试。");
    }
    private static FolderRoot NewRoot(string absolute) =>
        new(Guid.NewGuid().ToString("N"), System.IO.Path.GetFileName(absolute) is { Length: > 0 } name ? name : absolute, absolute);
    private static string CanonicalRoot(string path) {
        if (string.IsNullOrWhiteSpace(path) || !System.IO.Path.IsPathFullyQualified(path) ||
            path.StartsWith(@"\\?\", StringComparison.Ordinal) || path.StartsWith(@"\\.\", StringComparison.Ordinal))
            throw new IOException("请选择一个有效的文件夹。");
        return System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(path));
    }
    private static string Resolve(FolderRoot root, string path) {
        var target = System.IO.Path.GetFullPath(System.IO.Path.Combine(root.Path, path.Replace('/', System.IO.Path.DirectorySeparatorChar)));
        var prefix = System.IO.Path.EndsInDirectorySeparator(root.Path) ? root.Path : root.Path + System.IO.Path.DirectorySeparatorChar;
        if (!string.Equals(target, root.Path, StringComparison.OrdinalIgnoreCase) && !target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new IOException("文件不在当前工作区中。");
        return target;
    }
    private static bool IsRelative(string path) {
        try { ValidateRelative(path, false); return true; }
        catch (IOException) { return false; }
    }
    private static string ValidateRelative(string path, bool allowEmpty) {
        if (path is null || (path.Length == 0 && !allowEmpty) || path.Length > 32700 ||
            System.IO.Path.IsPathRooted(path) || path.Any(character => char.IsControl(character) || "\\:<>\"|?*".Contains(character)))
            throw new IOException("工作区相对路径无效。");
        if (path.Length == 0) return path;
        foreach (var part in path.Split('/')) {
            if (part.Length == 0 || part is "." or ".." || part.EndsWith('.') || part.EndsWith(' '))
                throw new IOException("工作区相对路径无效。");
            var stem = part.Split('.')[0].ToUpperInvariant();
            if (stem is "CON" or "PRN" or "AUX" or "NUL" or "CONIN$" or "CONOUT$" ||
                stem.Length == 4 && (stem.StartsWith("COM", StringComparison.Ordinal) || stem.StartsWith("LPT", StringComparison.Ordinal)) && stem[3] is >= '1' and <= '9')
                throw new IOException("工作区相对路径无效。");
        }
        return path;
    }
}
