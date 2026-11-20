using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Moye;

public sealed record LoadedDocument(string Path, string Text, string Fingerprint, bool Bom, string Newline, string EncodingName = "utf-8", bool NeedsEncoding = false);
public sealed record Draft(string? Path, string Text, string Baseline, string? Fingerprint, bool Bom, string Newline);

public static class DocumentStore {
    public const long MaxFileBytes = 20 * 1024 * 1024;

    public static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));

    public static LoadedDocument Read(string path, string? encoding = null, bool offerChoice = false) {
        using var access = FolderAccess.Directory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        return Decode(path, access.ReadFile(path), encoding, offerChoice);
    }

    public static LoadedDocument Decode(string path, byte[] bytes, string? encoding = null, bool offerChoice = false) =>
        FileEncoding.Decode(path, bytes, encoding, offerChoice);

    public static string Normalize(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n');

    public static bool HasConflict(string path, string? fingerprint) {
        if (fingerprint is null) return File.Exists(path);
        if (!File.Exists(path)) return true;
        using var access = FolderAccess.Directory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        return Hash(access.ReadFile(path)) != fingerprint;
    }

    public static string Write(string path, string text, bool bom, string newline, string? encoding = null) {
        var bytes = FileEncoding.Encode(text, encoding ?? (bom ? "utf-8-bom" : "utf-8"), bom, newline);
        AtomicWrite(path, bytes);
        return Hash(bytes);
    }

    public static void AtomicWrite(string path, byte[] bytes) {
        var absolute = System.IO.Path.GetFullPath(path);
        var temporary = absolute + ".moye-" + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) {
                stream.Write(bytes);
                stream.Flush(true);
            }
            if (File.Exists(absolute)) File.Replace(temporary, absolute, null);
            else File.Move(temporary, absolute);
        } finally {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    public static void SaveDraft(string file, Draft draft) {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(file)!);
        AtomicWrite(file, JsonSerializer.SerializeToUtf8Bytes(draft));
    }

    public static Draft? ReadDraft(string file) {
        if (!File.Exists(file)) return null;
        try { return JsonSerializer.Deserialize<Draft>(File.ReadAllText(file)); }
        catch (JsonException) { return null; }
    }
}
