using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Moye;

public sealed record UpdateAsset(string Url, string Sha256, long Size);
public sealed record DownloadedInstaller(string Path, UpdateAsset Asset);
public sealed record UpdateManifest(int SchemaVersion, string Version, UpdateAsset Windows) {
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public const long MaximumInstallerBytes = 256 * 1024 * 1024;
    public static UpdateManifest Parse(byte[] bytes) {
        var manifest = JsonSerializer.Deserialize<UpdateManifest>(bytes, JsonOptions) ?? throw new IOException("更新清单为空。");
        manifest.Validate(); return manifest;
    }
    public void Validate() {
        if (SchemaVersion != 1 || !System.Version.TryParse(Version, out var version) || version.Build < 0 || version.Revision >= 0 || version.ToString(3) != Version) throw new IOException("更新版本格式无效。");
        var expected = $"https://github.com/SakuraEdge/moye-markdown/releases/download/v{Version}/Moye-Setup-{Version}-windows-x64.exe";
        if (Windows is null || Windows.Url != expected || Windows.Size <= 0 || Windows.Size > MaximumInstallerBytes ||
            Windows.Sha256 is null || !Regex.IsMatch(Windows.Sha256, "^[a-fA-F0-9]{64}$")) throw new IOException("更新安装包信息无效。");
    }
    [JsonIgnore]
    public JsonElement Releases => JsonSerializer.SerializeToElement(new[] { new { tag_name = "v" + Version, draft = false, prerelease = false } });
}
public sealed record UpdateCheck(UpdateManifest Manifest, DateTimeOffset CheckedAt, bool OfflineCache) {
    [JsonIgnore]
    public string? CacheNotice => OfflineCache ? $"网络暂不可用，以下为 {CheckedAt.ToLocalTime():MM-dd HH:mm} 的检测记录。" : null;
}
