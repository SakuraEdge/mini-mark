using System.Text;
using System.Text.RegularExpressions;

namespace Moye;

public sealed record CloudBinding(string Owner, string Path, string? Sha, string Baseline);
public sealed record CloudFile(string Path, string Sha, string Text);
public sealed record CloudWrite(string Path, string Sha);
public sealed record CloudDeletion(
    [property: System.Text.Json.Serialization.JsonPropertyName("path")] string Path,
    [property: System.Text.Json.Serialization.JsonPropertyName("type")] string Type,
    [property: System.Text.Json.Serialization.JsonPropertyName("deleted")] bool Deleted,
    [property: System.Text.Json.Serialization.JsonPropertyName("commit")] string Commit);
public interface ICloudTokenStore {
    string? Read();
    void Write(string token);
    void Clear();
}

public static partial class CloudPaths {
    public const int MaxBytes = 5 * 1024 * 1024;
    public static string Validate(string path, bool folder = false) {
        if (path.Length > 1024 || path.Contains('\\') || path.Any(char.IsControl) ||
            path.Split('/').Any(part => part.Length == 0 || part is "." or ".." || part.Equals(".git", StringComparison.OrdinalIgnoreCase)) ||
            path.IndexOfAny([':', '?', '#']) >= 0)
            throw new IOException("云文档路径无效。");
        if (!folder && !DocumentExtension().IsMatch(path)) throw new IOException("仅支持 Markdown、YAML、HTML 和纯文本文档。");
        return path;
    }
    public static string Encode(string path) => string.Join("/", path.Split('/').Select(Uri.EscapeDataString));
    public static void CheckText(string text) {
        if (text.Contains('\0') || Encoding.UTF8.GetByteCount(text) > MaxBytes) throw new IOException("云文档必须为不超过 5 MB 的 UTF-8 文本。");
    }
    public static bool IsSha(string? value) => value is not null && ShaPattern().IsMatch(value);
    [GeneratedRegex(@"\.(md|markdown|mdown|txt|yaml|yml|html|htm)$", RegexOptions.IgnoreCase)]
    private static partial Regex DocumentExtension();
    [GeneratedRegex("\\A[a-fA-F0-9]{40}([a-fA-F0-9]{24})?\\z")]
    private static partial Regex ShaPattern();
}
