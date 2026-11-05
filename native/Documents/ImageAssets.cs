using System.Security.Cryptography;
using System.IO;
using System.Text.RegularExpressions;

namespace Moye;

public static class ImageAssets {
    public const int MaximumBytes = 10 * 1024 * 1024;
    public static (byte[] Data, string MimeType) ReadLocal(string directory, string relativePath) {
        var root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
        if (Path.IsPathRooted(relativePath) || relativePath.Contains(':')) throw new IOException("图片路径无效。");
        var file = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!file.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("图片必须位于文档目录内。");
        for (var check = file; check is not null && check.Length >= root.Length; check = Path.GetDirectoryName(check)) {
            if ((File.Exists(check) || Directory.Exists(check)) && (File.GetAttributes(check) & FileAttributes.ReparsePoint) != 0) throw new IOException("图片路径不能包含链接。");
        }
        var mime = Path.GetExtension(file).ToLowerInvariant() switch {
            ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".gif" => "image/gif",
            ".webp" => "image/webp", ".svg" => "image/svg+xml", ".bmp" => "image/bmp", ".avif" => "image/avif",
            _ => throw new IOException("仅允许读取图片文件。")
        };
        if (new FileInfo(file).Length > MaximumBytes) throw new IOException("图片不能超过 10 MB。");
        return (File.ReadAllBytes(file), mime);
    }
    public static string Import(string dataUrl, string? documentPath) {
        if (dataUrl.Length > MaximumBytes * 4 / 3 + 128) throw new IOException("图片不能超过 10 MB。");
        var comma = dataUrl.IndexOf(',');
        if (comma < 0) throw new IOException("无效的图片数据。");
        var extension = dataUrl[..comma] switch {
            "data:image/png;base64" => ".png",
            "data:image/jpeg;base64" => ".jpg",
            "data:image/gif;base64" => ".gif",
            "data:image/webp;base64" => ".webp",
            _ => throw new IOException("不支持的图片格式。")
        };
        var bytes = Convert.FromBase64String(dataUrl[(comma + 1)..]);
        if (bytes.Length == 0 || bytes.Length > MaximumBytes || !ValidSignature(bytes, extension)) throw new IOException("图片内容与格式不匹配。");
        if (documentPath is null) return dataUrl;
        var directory = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(documentPath))!, "assets");
        if (Directory.Exists(directory) && (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new IOException("图片目录不能是目录链接。");
        Directory.CreateDirectory(directory);
        var name = "mini-mark-" + Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() + extension;
        var target = Path.Combine(directory, name);
        if (File.Exists(target)) {
            if ((File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0 || new FileInfo(target).Length != bytes.Length ||
                !File.ReadAllBytes(target).AsSpan().SequenceEqual(bytes)) throw new IOException("图片文件名发生冲突。");
        } else {
            using var stream = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            stream.Write(bytes); stream.Flush(true);
        }
        return "assets/" + name;
    }
    public static void CopyForSaveAs(string text, string? previousPath, string targetPath) {
        if (previousPath is null || DocumentWorkspace.SamePath(previousPath, targetPath)) return;
        var folder = Path.GetDirectoryName(Path.GetFullPath(previousPath))!;
        foreach (Match match in Regex.Matches(text, @"assets/mini-mark-([0-9a-f]{64})\.(png|jpg|gif|webp)")) {
            var asset = Path.Combine(folder, match.Value);
            if (!File.Exists(asset)) throw new IOException("图片资源缺失，无法完成另存为。");
            if (new FileInfo(asset).Length > MaximumBytes) throw new IOException("图片资源过大。");
            var bytes = File.ReadAllBytes(asset);
            if (Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != match.Groups[1].Value) throw new IOException("图片资源已被修改，无法完成另存为。");
            var mime = match.Groups[2].Value == "jpg" ? "jpeg" : match.Groups[2].Value;
            Import("data:" + "image/" + mime + ";base64," + Convert.ToBase64String(bytes), targetPath);
        }
    }
    private static bool ValidSignature(byte[] bytes, string extension) {
        var span = bytes.AsSpan();
        return extension switch {
            ".png" => span.StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
            ".jpg" => span.StartsWith(new byte[] { 255, 216, 255 }),
            ".gif" => span.StartsWith("GIF87a"u8) || span.StartsWith("GIF89a"u8),
            ".webp" => span.Length >= 12 && span[..4].SequenceEqual("RIFF"u8) && span.Slice(8, 4).SequenceEqual("WEBP"u8),
            _ => false
        };
    }
}
