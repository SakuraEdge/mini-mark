using System.IO;
using System.Text;

namespace Moye;

public static class FileEncoding {
    static FileEncoding() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    private static Encoding Codec(string name) => name switch {
        "utf-8" or "utf-8-bom" => new UTF8Encoding(true, true),
        "utf-16le" => new UnicodeEncoding(false, true, true),
        "utf-16be" => new UnicodeEncoding(true, true, true),
        "gbk" => StrictCodePage(936), "gb18030" => StrictCodePage(54936),
        "windows-1252" => StrictCodePage(1252),
        _ => throw new IOException("请选择支持的文件编码。")
    };
    private static Encoding StrictCodePage(int id) => Encoding.GetEncoding(id, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);

    public static LoadedDocument Decode(string path, byte[] bytes, string? requested = null, bool offerChoice = false) {
        if (bytes.LongLength > DocumentStore.MaxFileBytes) throw new IOException("文件超过 20 MB。");
        var detected = bytes.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf }) ? "utf-8-bom" :
            bytes.AsSpan().StartsWith(new byte[] { 0xff, 0xfe }) ? "utf-16le" :
            bytes.AsSpan().StartsWith(new byte[] { 0xfe, 0xff }) ? "utf-16be" : null;
        var name = requested ?? detected ?? "utf-8";
        var codec = Codec(name);
        var preamble = codec.GetPreamble();
        var bom = preamble.Length > 0 && bytes.AsSpan().StartsWith(preamble);
        var prefix = bom ? preamble.Length : 0;
        var result = new LoadedDocument(Path.GetFullPath(path), "", DocumentStore.Hash(bytes), bom, "\n", name);
        try {
            var text = codec.GetString(bytes, prefix, bytes.Length - prefix);
            if (text.Contains('\0')) throw new IOException("此编码读出了空字符，请选择其他文本编码。");
            if (name is "utf-8" or "utf-8-bom") name = bom ? "utf-8-bom" : "utf-8";
            return result with { Text = DocumentStore.Normalize(text), Newline = text.Contains("\r\n") ? "\r\n" : "\n", EncodingName = name };
        } catch (Exception ex) when (offerChoice && (ex is DecoderFallbackException or IOException)) {
            return result with { NeedsEncoding = true };
        }
    }

    public static byte[] Encode(string text, string name, bool bom, string newline) {
        var codec = Codec(name);
        var value = DocumentStore.Normalize(text);
        if (value.Contains('\0')) throw new IOException("文本包含空字符，无法保存。");
        if (newline == "\r\n") value = value.Replace("\n", "\r\n");
        byte[] prefix = name == "utf-8-bom" || (bom && name is "utf-16le" or "utf-16be") ? codec.GetPreamble() : [];
        try {
            var length = codec.GetByteCount(value);
            if ((long)length + prefix.Length > DocumentStore.MaxFileBytes) throw new IOException("编码后的文件超过 20 MB。");
            var bytes = new byte[length + prefix.Length];
            prefix.CopyTo(bytes, 0);
            codec.GetBytes(value.AsSpan(), bytes.AsSpan(prefix.Length));
            if (!codec.GetString(bytes, prefix.Length, length).Equals(value, StringComparison.Ordinal)) throw new EncoderFallbackException();
            return bytes;
        } catch (EncoderFallbackException) { throw new IOException("目标编码无法完整表示正文，请选择其他编码。"); }
    }
}
