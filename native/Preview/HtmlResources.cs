namespace Moye;

public static class HtmlResources {
    private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase) {
        [".html"] = "text/html; charset=utf-8", [".htm"] = "text/html; charset=utf-8",
        [".css"] = "text/css; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".mjs"] = "text/javascript; charset=utf-8",
        [".json"] = "application/json", [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif", [".webp"] = "image/webp", [".svg"] = "image/svg+xml", [".ico"] = "image/x-icon",
        [".avif"] = "image/avif", [".woff"] = "font/woff", [".woff2"] = "font/woff2", [".ttf"] = "font/ttf",
        [".mp3"] = "audio/mpeg", [".mp4"] = "video/mp4", [".webm"] = "video/webm", [".wasm"] = "application/wasm",
    };
    public static bool IsHtml(string name) => Path.GetExtension(name).ToLowerInvariant() is ".html" or ".htm";
    public static (byte[] Data, string Mime) Read(string folder, string relative) {
        if (string.IsNullOrWhiteSpace(relative) || relative.Contains('\\') || relative.Contains(':') ||
            relative.Contains('\0') || relative.Split('/').Any(part => part is ".." or "." or "") || Path.IsPathRooted(relative))
            throw new IOException("Resource outside preview folder");
        var root = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar);
        var full = Path.GetFullPath(Path.Combine(root, relative));
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
            !Types.TryGetValue(Path.GetExtension(full), out var mime)) throw new IOException("Unsupported preview resource");
        // Reject links/junctions in the full path, including ancestors of the document folder.
        for (var path = full; path is not null; path = Path.GetDirectoryName(path)) {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Linked preview resources are not allowed");
        }
        using var file = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length > 20 * 1024 * 1024) throw new IOException("Preview resource exceeds 20 MB");
        var bytes = new byte[(int)file.Length];
        file.ReadExactly(bytes);
        return (bytes, mime);
    }
}
