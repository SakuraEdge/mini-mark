import Foundation

func runUpdateManifestTests() throws {
    let hash = String(repeating: "a", count: 64)
    let legacy: [String: Any] = [
        "schemaVersion": 1, "version": "3.0.0",
        "windows": ["url": "https://github.com/SakuraEdge/moye-markdown/releases/download/v3.0.0/Moye-Setup-3.0.0-windows-x64.exe",
                    "sha256": hash, "size": 1024]
    ]
    let rev: [String: Any] = [
        "schemaVersion": 2, "version": "4.0.1", "releaseVersion": "1.0.0", "tag": "rev-v1.0.0",
        "windows": ["url": "https://github.com/SakuraEdge/mini-mark/releases/download/rev-v1.0.0/MiniMark-Rev-1.0.0-Setup-windows-x64.exe",
                    "sha256": hash, "size": 1024]
    ]
    func decode(_ value: [String: Any]) throws -> UpdateManifest {
        let manifest = try JSONDecoder().decode(UpdateManifest.self, from: JSONSerialization.data(withJSONObject: value))
        try manifest.validate()
        return manifest
    }
    func reject(_ value: [String: Any]) throws {
        do { _ = try decode(value) }
        catch { return }
        throw Store.failure("Invalid update manifest accepted")
    }
    func field(_ name: String, _ value: Any) throws {
        var invalid = rev; invalid[name] = value
        try reject(invalid)
    }
    func asset(_ name: String, _ value: Any) throws {
        var invalid = rev, windows = rev["windows"] as! [String: Any]
        windows[name] = value; invalid["windows"] = windows
        try reject(invalid)
    }
    let old = try decode(legacy)
    guard old.release["tag_name"] as? String == "v3.0.0", old.release["version"] as? String == "3.0.0",
          old.release["releaseVersion"] == nil else { throw Store.failure("Legacy update metadata changed") }
    var modernLegacy = legacy
    modernLegacy["windows"] = ["url": "https://github.com/SakuraEdge/mini-mark/releases/download/v3.0.0/MiniMark-Setup-3.0.0-windows-x64.exe",
                                "sha256": hash.uppercased(), "size": 256 * 1024 * 1024]
    _ = try decode(modernLegacy)
    let current = try decode(rev)
    guard current.notes == nil, current.release["notes"] == nil else { throw Store.failure("Missing update notes changed compatibility") }
    var noted = rev
    let notes = "## 更新\n\n- 工作区\n- 界面背景"
    noted["notes"] = notes
    let withNotes = try decode(noted)
    let notesCache = CachedUpdate(manifest: withNotes, checkedAt: Date())
    let restoredNotes = try JSONDecoder().decode(CachedUpdate.self, from: JSONEncoder().encode(notesCache))
    guard restoredNotes.manifest.notes == notes, restoredNotes.manifest.release["notes"] as? String == notes else {
        throw Store.failure("Update notes did not survive cache or release mapping")
    }
    noted["notes"] = String(repeating: "a", count: 16000)
    _ = try decode(noted)
    noted["notes"] = String(repeating: "\u{1f600}", count: 8000)
    _ = try decode(noted)
    let invalidNotes: [Any] = [String(repeating: "a", count: 16001), String(repeating: "\u{1f600}", count: 8001), 42, ["invalid"]]
    for value in invalidNotes {
        try field("notes", value)
    }
    noted["notes"] = NSNull()
    guard try decode(noted).notes == nil else { throw Store.failure("Null update notes were not optional") }
    var alternateAsset = rev
    alternateAsset["windowsV2"] = rev["windows"]
    try reject(alternateAsset)
    let cached = CachedUpdate(manifest: current, checkedAt: Date(timeIntervalSince1970: 2_000_000_000))
    let recovered = try JSONDecoder().decode(CachedUpdate.self, from: JSONEncoder().encode(cached))
    try recovered.manifest.validate()
    let release = UpdateCheck(cached: recovered, offline: false).releases[0]
    guard release["tag_name"] as? String == "rev-v1.0.0", release["version"] as? String == "4.0.1",
          release["releaseVersion"] as? String == "1.0.0", release["name"] as? String == "Mini Mark Rev v1.0.0",
          release["draft"] as? Bool == false, release["prerelease"] as? Bool == false else {
        throw Store.failure("Rev update metadata mismatch")
    }
    for version in ["01.0.0", "-1.0.0", "1.0", "1.0.0.0", "1.0.0-beta", "1.0.0+build", "1.0.0\n", "2147483648.0.0", "9999999999999999999999.0.0"] {
        try field("version", version); try field("releaseVersion", version)
    }
    for tag in ["v4.0.1", "rev-v1.0.1", "Rev-v1.0.0", "rev-v1.0.0\n", "rev-v1.0.0/extra"] { try field("tag", tag) }
    for name in ["releaseVersion", "tag"] {
        var missing = rev; missing.removeValue(forKey: name); try reject(missing)
        try field(name, 1)
    }
    for schema in [0, 3, -1] { try field("schemaVersion", schema) }
    try field("version", 4)
    try field("windows", NSNull())
    for url in [
        "http://github.com/SakuraEdge/mini-mark/releases/download/rev-v1.0.0/MiniMark-Rev-1.0.0-Setup-windows-x64.exe",
        "https://example.com/SakuraEdge/mini-mark/releases/download/rev-v1.0.0/MiniMark-Rev-1.0.0-Setup-windows-x64.exe",
        "https://github.com/SakuraEdge/mini-mark/releases/download/rev-v1.0.1/MiniMark-Rev-1.0.0-Setup-windows-x64.exe",
        "https://github.com/SakuraEdge/mini-mark/releases/download/rev-v1.0.0/MiniMark-Setup-4.0.1-windows-x64.exe",
        "https://github.com/SakuraEdge/mini-mark/releases/download/rev-v1.0.0/MiniMark-Rev-1.0.0-Setup-windows-x64.exe?download=1"
    ] { try asset("url", url) }
    for invalidHash in ["", String(repeating: "a", count: 63), String(repeating: "g", count: 64), hash + "\n"] { try asset("sha256", invalidHash) }
    for size in [-1, 0, 256 * 1024 * 1024 + 1] { try asset("size", size) }
    try asset("size", 1.5); try asset("size", "1024")
    print("PASS macOS updates: legacy and Rev schemas, notes and cache round trip, metadata, URL, tag, hash and numeric validation")
}
