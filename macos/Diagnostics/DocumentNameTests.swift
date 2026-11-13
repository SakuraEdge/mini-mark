import Foundation

func runDocumentNameTests() throws {
    let cases: [(String, String?)] = [
        ("# Title", "Title.md"), ("   # 中文标题 ###", "中文标题.md"), ("# Chapter #1", "Chapter #1.md"),
        ("# a/b:c?d*e", "a b c d e.md"), ("# CON", "_CON.md"), ("# a... ", "a.md"),
        ("## Not H1", nil), ("    # Indented", nil), ("before\n# Later", nil), ("# ###", nil), ("# #", nil),
        ("# <>:\"/\\|?*", nil), ("#\t标题\r\nbody", "标题.md"), ("#without space", nil),
        ("# A\u{0081}B", "A B.md")
    ]
    for (text, expected) in cases {
        guard DocumentNames.heading(text) == expected else { throw Store.failure("H1 filename mismatch: " + text) }
    }
    let longTitle = DocumentNames.heading("# " + String(repeating: "中", count: 200))!
    guard longTitle.utf8.count <= 240, longTitle.unicodeScalars.count <= 120, longTitle.hasSuffix(".md") else {
        throw Store.failure("Automatic filename exceeded filesystem limits")
    }
    guard try DocumentNames.validate("new", current: "old.MD") == "new.MD",
          try DocumentNames.validate("new#1.md", current: "old.md") == "new#1.md" else { throw Store.failure("Manual rename normalization mismatch") }
    for invalid in ["../x.md", "CON.md", "bad.", " leading.md", "trailing.md ", "a/b.md", "a\u{0081}b.md", "unsupported.exe", String(repeating: "中", count: 90) + ".md"] {
        var rejected = false
        do { _ = try DocumentNames.validate(invalid, current: "old.md") } catch { rejected = true }
        guard rejected else { throw Store.failure("Unsafe filename accepted") }
    }
    var automatic = Document(untitledName: "未命名 1.md", text: "# First\nbody", baseline: "", autoName: true)
    automatic.updateAutomaticName()
    guard automatic.name == "First.md", automatic.automaticNameEnabled else { throw Store.failure("Generated draft did not auto-name") }
    automatic.text = "## none"; automatic.updateAutomaticName()
    guard automatic.name == "First.md" else { throw Store.failure("Non-heading cleared automatic name") }
    automatic.updateAutomaticName(hint: "Debounced.md")
    guard automatic.name == "Debounced.md" else { throw Store.failure("Valid automatic label hint was lost") }
    automatic.updateAutomaticName(hint: "../wrong.md")
    guard automatic.name == "Debounced.md" else { throw Store.failure("Unsafe automatic label hint was accepted") }
    automatic.autoName = false; automatic.text = "# Changed"; automatic.updateAutomaticName()
    guard automatic.name == "Debounced.md" else { throw Store.failure("Manual rename was replaced by H1") }
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("minimark-names-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let source = folder.appendingPathComponent("old.md"), bytes = Data([0xef, 0xbb, 0xbf] + Array("# Saved\r\n".utf8))
    try bytes.write(to: source)
    var local = try Store.read(source.path)
    local.text = "# Unsaved body"; local.revision = 9
    let renamed = try DocumentNames.moveLocal(local, name: "renamed.md")
    guard try Data(contentsOf: URL(fileURLWithPath: renamed)) == bytes, !FileManager.default.fileExists(atPath: source.path),
          local.text == "# Unsaved body", local.revision == 9 else { throw Store.failure("Rename wrote unsaved text or changed bytes") }
    local.path = renamed
    let collision = folder.appendingPathComponent("collision.md"); try Data("keep".utf8).write(to: collision)
    var refused = false
    do { _ = try DocumentNames.moveLocal(local, name: "collision.md") } catch { refused = true }
    guard refused, try Data(contentsOf: collision) == Data("keep".utf8) else { throw Store.failure("Rename overwrote collision") }
    try Data("external".utf8).write(to: URL(fileURLWithPath: renamed))
    refused = false
    do { _ = try DocumentNames.moveLocal(local, name: "changed.md") } catch { refused = true }
    guard refused, FileManager.default.fileExists(atPath: renamed) else { throw Store.failure("Rename ignored external edits") }
    var legacy = Document(untitledName: "未命名.md", text: "# Restored", baseline: "")
    let manual = Document(untitledName: "未命名 2.md", text: "# Keep", baseline: "", autoName: false)
    let sessionFile = folder.appendingPathComponent("session.json")
    try Store.saveSession(Session(documents: [legacy, manual], activeId: legacy.id), sessionFile)
    let recovered = try Store.restore(sessionFile)
    legacy = recovered.documents[0]
    guard legacy.name == "Restored.md", legacy.autoName == true, recovered.documents[1].name == manual.name,
          recovered.documents[1].autoName == false else { throw Store.failure("Legacy auto-name inference changed explicit preference") }
    let time = Date()
    guard AuthorizationCode.matches("ABCD-1234", current: "ABCD-1234", expires: time.addingTimeInterval(20), now: time),
          !AuthorizationCode.matches("ABCD", current: "ABCD-1234", expires: time.addingTimeInterval(20), now: time),
          !AuthorizationCode.matches("ABCD-1234", current: "ABCD-1234", expires: time, now: time),
          !AuthorizationCode.matches("test_secret", current: "test_secret", expires: time.addingTimeInterval(20), now: time) else {
        throw Store.failure("Authorization clipboard validation failed")
    }
    print("PASS macOS names: H1, Unicode limits, manual override, local no-overwrite move, legacy drafts and authorization code safety")
}
