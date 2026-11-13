using System.Text;
using System.Text.RegularExpressions;

namespace Moye;

public static partial class DocumentNames {
    public static bool IsLegacyUntitled(string name) => UntitledPattern().IsMatch(name);
    public static bool IsMarkdown(string name) => Path.GetExtension(name).Equals(".md", StringComparison.OrdinalIgnoreCase);
    public static string Rename(string requested, string previous) {
        if (string.IsNullOrWhiteSpace(requested) || requested != requested.Trim() || requested.EndsWith('.') ||
            requested.Any(character => char.IsControl(character) || "<>:\"/\\|?*".Contains(character)) || Reserved(requested))
            throw new IOException("文件名无效，请去掉特殊字符、末尾空格或保留名称。");
        var name = requested.Contains('.') ? requested : requested + (ExtensionPattern().IsMatch(previous) ? Path.GetExtension(previous) : ".md");
        if (!ExtensionPattern().IsMatch(name) || name.EnumerateRunes().Count() > 120 || Encoding.UTF8.GetByteCount(name) > 240)
            throw new IOException("文件名最多 120 个字符，仅支持 Markdown、YAML、HTML 和 TXT 扩展名。");
        return name;
    }
    public static string? FirstHeading(string text) {
        var end = text.IndexOf('\n');
        var first = end < 0 ? text : text[..end];
        var match = HeadingPattern().Match(first.TrimEnd('\r'));
        if (!match.Success) return null;
        var heading = ClosingHashes().Replace(match.Groups[1].Value, "").Trim();
        if (heading.Length == 0 || heading.All(character => character == '#')) return null;
        var clean = string.Concat(heading.Select(character => char.IsControl(character) || "<>:\"/\\|?*".Contains(character) ? ' ' : character));
        clean = Whitespace().Replace(clean, " ").Trim().TrimEnd('.', ' ');
        if (clean.Length == 0) return null;
        if (Reserved(clean)) clean = "_" + clean;
        var limited = new StringBuilder();
        var bytes = 0;
        foreach (var rune in clean.EnumerateRunes().Take(117)) {
            if (bytes + rune.Utf8SequenceLength > 237) break;
            limited.Append(rune.ToString()); bytes += rune.Utf8SequenceLength;
        }
        clean = limited.ToString().TrimEnd('.', ' ');
        return clean.Length == 0 ? null : clean + ".md";
    }
    private static bool Reserved(string name) => ReservedPattern().IsMatch(name.Split('.')[0]);
    [GeneratedRegex("\\A未命名(?: [1-9][0-9]*)?\\.md\\z", RegexOptions.IgnoreCase)]
    private static partial Regex UntitledPattern();
    [GeneratedRegex("\\A {0,3}#[ \\t]+(.+)\\z")]
    private static partial Regex HeadingPattern();
    [GeneratedRegex("[ \\t]+#+[ \\t]*\\z")]
    private static partial Regex ClosingHashes();
    [GeneratedRegex("\\s+")]
    private static partial Regex Whitespace();
    [GeneratedRegex("\\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\\z", RegexOptions.IgnoreCase)]
    private static partial Regex ReservedPattern();
    [GeneratedRegex("\\.(?:md|markdown|mdown|txt|yaml|yml|html|htm)\\z", RegexOptions.IgnoreCase)]
    private static partial Regex ExtensionPattern();
}
