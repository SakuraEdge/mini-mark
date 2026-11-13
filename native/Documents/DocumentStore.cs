using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Moye;

public sealed record LoadedDocument(string Path, string Text, string Fingerprint, bool Bom, string Newline);
public sealed record Draft(string? Path, string Text, string Baseline, string? Fingerprint, bool Bom, string Newline);

public static class DocumentStore {
    public const long MaxFileBytes = 20 * 1024 * 1024;

    public static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));

    public static LoadedDocument Read(string path) {
        var info = new FileInfo(path);
        if (info.Length > MaxFileBytes) throw new IOException("文件超过 20 MB，请使用适合大文件的文本工具。");
        var bytes = File.ReadAllBytes(path);
        return Decode(path, bytes);
    }

    public static LoadedDocument Decode(string path, byte[] bytes) {
        if (bytes.LongLength > MaxFileBytes) throw new IOException("文件超过 20 MB，请使用适合大文件的文本工具。");
        var bom = bytes.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf });
        var raw = new UTF8Encoding(false, true).GetString(bytes, bom ? 3 : 0, bytes.Length - (bom ? 3 : 0));
        if (raw.Contains('\0')) throw new IOException("此文件不是 UTF-8 文本文档。");
        var newline = raw.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        return new LoadedDocument(System.IO.Path.GetFullPath(path), Normalize(raw), Hash(bytes), bom, newline);
    }

    public static string Normalize(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n');

    public static bool HasConflict(string path, string? fingerprint) {
        if (fingerprint is null) return File.Exists(path);
        return !File.Exists(path) || Hash(File.ReadAllBytes(path)) != fingerprint;
    }

    public static string Write(string path, string text, bool bom, string newline) {
        var normalized = Normalize(text);
        if (newline == "\r\n") normalized = normalized.Replace("\n", "\r\n");
        var encoding = new UTF8Encoding(bom);
        var bytes = encoding.GetPreamble().Concat(encoding.GetBytes(normalized)).ToArray();
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
