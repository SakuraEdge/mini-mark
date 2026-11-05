using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Moye;

public sealed record UpdateAsset(string Url, string Sha256, long Size);
public sealed record DownloadedInstaller(string Path, UpdateAsset Asset);
public sealed record UpdateManifest(int SchemaVersion, string Version, UpdateAsset Windows, UpdateAsset? WindowsV2 = null) {
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public const long MaximumInstallerBytes = 256 * 1024 * 1024;
    public static UpdateManifest Parse(byte[] bytes) {
        var manifest = JsonSerializer.Deserialize<UpdateManifest>(bytes, JsonOptions) ?? throw new IOException("更新清单为空。");
        manifest.Validate(); return manifest;
    }
    public void Validate() {
        if (SchemaVersion != 1 || !System.Version.TryParse(Version, out var version) || version.Build < 0 || version.Revision >= 0 || version.ToString(3) != Version) throw new IOException("更新版本格式无效。");
        var legacy = $"https://github.com/SakuraEdge/moye-markdown/releases/download/v{Version}/Moye-Setup-{Version}-windows-x64.exe";
        var current = $"https://github.com/SakuraEdge/mini-mark/releases/download/v{Version}/MiniMark-Setup-{Version}-windows-x64.exe";
        ValidateAsset(Windows, legacy, current);
        if (WindowsV2 is not null) {
            ValidateAsset(WindowsV2, current, current);
            if (WindowsV2.Sha256 != Windows.Sha256 || WindowsV2.Size != Windows.Size) throw new IOException("更新兼容包校验不一致。");
        }
    }
    private static void ValidateAsset(UpdateAsset asset, string legacy, string current) {
        if (asset is null || (asset.Url != legacy && asset.Url != current) || asset.Size <= 0 || asset.Size > MaximumInstallerBytes ||
            asset.Sha256 is null || !Regex.IsMatch(asset.Sha256, "^[a-fA-F0-9]{64}$")) throw new IOException("更新安装包信息无效。");
    }
    [JsonIgnore]
    public UpdateAsset DownloadAsset => WindowsV2 ?? Windows;
    [JsonIgnore]
    public JsonElement Releases => JsonSerializer.SerializeToElement(new[] { new { tag_name = "v" + Version, draft = false, prerelease = false } });
}
public sealed record UpdateCheck(UpdateManifest Manifest, DateTimeOffset CheckedAt, bool OfflineCache) {
    [JsonIgnore]
    public string? CacheNotice => OfflineCache ? $"网络暂不可用，以下为 {CheckedAt.ToLocalTime():MM-dd HH:mm} 的检测记录。" : null;
}
