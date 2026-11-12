using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Moye;

public sealed record UpdateAsset(string Url, string Sha256, long Size);
public sealed record DownloadedInstaller(string Path, UpdateAsset Asset);
public sealed record UpdateManifest(int SchemaVersion, string Version, UpdateAsset Windows, UpdateAsset? WindowsV2 = null,
    string? ReleaseVersion = null, string? Tag = null) {
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public const long MaximumInstallerBytes = 256 * 1024 * 1024;
    public static UpdateManifest Parse(byte[] bytes) {
        var manifest = JsonSerializer.Deserialize<UpdateManifest>(bytes, JsonOptions) ?? throw new IOException("更新清单为空。");
        manifest.Validate(); return manifest;
    }
    public void Validate() {
        if (SchemaVersion is not (1 or 2) || !IsStableVersion(Version)) throw new IOException("更新版本格式无效。");
        if (SchemaVersion == 2) {
            if (!IsStableVersion(ReleaseVersion) || Tag != "rev-v" + ReleaseVersion || WindowsV2 is not null)
                throw new IOException("Rev 发布版本信息无效。");
            var release = $"https://github.com/SakuraEdge/mini-mark/releases/download/{Tag}/MiniMark-Rev-{ReleaseVersion}-Setup-windows-x64.exe";
            ValidateAsset(Windows, release, release);
            return;
        }
        var legacy = $"https://github.com/SakuraEdge/moye-markdown/releases/download/v{Version}/Moye-Setup-{Version}-windows-x64.exe";
        var current = $"https://github.com/SakuraEdge/mini-mark/releases/download/v{Version}/MiniMark-Setup-{Version}-windows-x64.exe";
        ValidateAsset(Windows, legacy, current);
        if (WindowsV2 is not null) {
            ValidateAsset(WindowsV2, current, current);
            if (WindowsV2.Sha256 != Windows.Sha256 || WindowsV2.Size != Windows.Size) throw new IOException("更新兼容包校验不一致。");
        }
    }
    private static bool IsStableVersion(string? value) =>
        System.Version.TryParse(value, out var version) && version.Build >= 0 && version.Revision < 0 && version.ToString(3) == value;
    private static void ValidateAsset(UpdateAsset asset, string legacy, string current) {
        if (asset is null || (asset.Url != legacy && asset.Url != current) || asset.Size <= 0 || asset.Size > MaximumInstallerBytes ||
            asset.Sha256 is null || !Regex.IsMatch(asset.Sha256, "\\A[a-fA-F0-9]{64}\\z")) throw new IOException("更新安装包信息无效。");
    }
    [JsonIgnore]
    public UpdateAsset DownloadAsset => WindowsV2 ?? Windows;
    [JsonIgnore]
    public string ReleaseTag => SchemaVersion == 2 ? Tag! : "v" + Version;
    [JsonIgnore]
    public JsonElement Releases => SchemaVersion == 2
        ? JsonSerializer.SerializeToElement(new[] { new { tag_name = ReleaseTag, version = Version, releaseVersion = ReleaseVersion, name = "Mini Mark Rev v" + ReleaseVersion, draft = false, prerelease = false } })
        : JsonSerializer.SerializeToElement(new[] { new { tag_name = ReleaseTag, version = Version, draft = false, prerelease = false } });
}
public sealed record UpdateCheck(UpdateManifest Manifest, DateTimeOffset CheckedAt, bool OfflineCache) {
    [JsonIgnore]
    public string? CacheNotice => OfflineCache ? $"网络暂不可用，以下为 {CheckedAt.ToLocalTime():MM-dd HH:mm} 的检测记录。" : null;
}
