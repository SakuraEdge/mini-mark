import Foundation
import Darwin

func physicalWorkspaceFixture(_ url: URL) throws -> URL {
    guard let path = url.path.withCString({ realpath($0, nil) }) else {
        throw Store.failure("Workspace fixture realpath failed (errno \(errno))")
    }
    defer { free(path) }
    // Foundation resolvingSymlinksInPath can shorten /private/var back to the /var symlink.
    return URL(fileURLWithPath: String(cString: path), isDirectory: true)
}

func runFolderWorkspaceTests() throws {
    let files = FileManager.default
    let temporary = files.temporaryDirectory.appendingPathComponent("minimark-folders-" + UUID().uuidString)
    try files.createDirectory(at: temporary, withIntermediateDirectories: true)
    let folder = try physicalWorkspaceFixture(temporary)
    defer { try? files.removeItem(at: folder) }
    let source = folder.appendingPathComponent("中文 # workspace"), state = folder.appendingPathComponent("settings/workspace-folder.json")
    try files.createDirectory(at: source, withIntermediateDirectories: true)
    let workspace = FolderWorkspace(stateFile: state)
    func require(_ condition: Bool, _ message: String) throws { if !condition { throw Store.failure(message) } }
    func reject(_ action: () throws -> Void) throws {
        do { try action() } catch { return }
        throw Store.failure("Unsafe workspace operation accepted")
    }
    func entries(_ page: [String: Any]) throws -> [[String: Any]] {
        guard let result = page["entries"] as? [[String: Any]] else { throw Store.failure("Workspace entries missing") }
        return result
    }
    func step<T>(_ name: String, _ action: () throws -> T) throws -> T {
        do { return try action() }
        catch { throw Store.failure("Workspace \(name): \(error.localizedDescription)") }
    }
    try require(!files.fileExists(atPath: state.path) && workspace.root == nil, "Workspace initializer accessed disk")
    let none = try workspace.restore()
    try require(none["root"] is NSNull && !files.fileExists(atPath: state.path), "Absent folder restore created a selection")
    for name in ["aFolder", "BFolder", "directory.md"] {
        try files.createDirectory(at: source.appendingPathComponent(name), withIntermediateDirectories: true)
    }
    let bytes = Data([0xef, 0xbb, 0xbf] + Array("# Workspace\r\n中文\r\n".utf8))
    try bytes.write(to: source.appendingPathComponent("note.md"))
    for name in [".hidden.md", "config.YAML", "page.html", "plain.txt", "unsupported.exe", "unsafe\\name.md"] {
        try Data("text".utf8).write(to: source.appendingPathComponent(name))
    }
    try Data("nested".utf8).write(to: source.appendingPathComponent("aFolder/inside.yml"))
    try Data([0xff, 0xfe, 0x00]).write(to: source.appendingPathComponent("binary.md"))
    try files.createSymbolicLink(at: source.appendingPathComponent("file-link.md"), withDestinationURL: source.appendingPathComponent("note.md"))
    try files.createSymbolicLink(at: source.appendingPathComponent("directory-link"), withDestinationURL: source.appendingPathComponent("aFolder"))
    let selected = try step("select fixture") { try workspace.select(source.path) }
    guard let first = workspace.root else { throw Store.failure("Folder selection did not activate") }
    let rows = try entries(selected)
    try require((selected["root"] as? [String: Any])?["id"] as? String == first.id && selected["path"] as? String == "", "Selected folder metadata missing")
    let actualRows = rows.map { row in
        "\(row["name"] as? String ?? "?"):\(row["type"] as? String ?? "?"):supported=\(row["supported"] as? Bool ?? false)"
    }.joined(separator: ", ")
    try require(rows.prefix(3).allSatisfy { $0["type"] as? String == "directory" } &&
                rows.prefix(3).compactMap { $0["name"] as? String } == ["aFolder", "BFolder", "directory.md"],
                "Folders are not sorted first: " + actualRows)
    for name in [".hidden.md", "config.YAML", "page.html", "plain.txt"] {
        try require(rows.contains { $0["name"] as? String == name && $0["supported"] as? Bool == true }, "Supported or hidden workspace file missing")
    }
    for name in ["unsupported.exe", "unsafe\\name.md"] {
        try require(rows.contains { $0["name"] as? String == name && $0["supported"] as? Bool == false }, "Unsupported workspace entry was omitted or enabled")
    }
    for name in ["file-link.md", "directory-link"] {
        try require(rows.contains { $0["name"] as? String == name && $0["link"] as? Bool == true && $0["supported"] as? Bool == false }, "Symbolic link was omitted or followed")
    }
    let nested = try step("list nested folder") { try workspace.list(rootId: first.id, path: "aFolder", offset: 0) }
    try require(nested["path"] as? String == "aFolder" && (try entries(nested)).first?["path"] as? String == "aFolder/inside.yml", "Nested list path was not retained")
    let document = try step("read regular file") { try workspace.read(rootId: first.id, path: "note.md") }
    try require(document.text == "# Workspace\n中文\n" && document.bom && document.newline == "\r\n" && !document.dirty &&
                document.autoName == false && document.fingerprint == Store.hash(bytes), "Workspace read changed document encoding or baseline")
    try require(try Data(contentsOf: source.appendingPathComponent("note.md")) == bytes, "Workspace read changed disk contents")
    for path in ["", "../note.md", "aFolder/../note.md", "./note.md", "/note.md", "aFolder//inside.yml", "aFolder/", "aFolder\\inside.yml", "bad:name.md", "bad\u{0081}.md"] {
        try reject { _ = try workspace.read(rootId: first.id, path: path) }
    }
    for path in ["unsupported.exe", "binary.md", "directory.md", "file-link.md", "directory-link/inside.yml"] {
        try reject { _ = try workspace.read(rootId: first.id, path: path) }
    }
    try reject { _ = try workspace.list(rootId: "stale", path: "", offset: 0) }
    try reject { _ = try workspace.list(rootId: first.id, path: "directory-link", offset: 0) }
    try reject { _ = try workspace.list(rootId: first.id, path: "", offset: -1) }
    let beyond = try step("list out-of-range page") { try workspace.list(rootId: first.id, path: "", offset: Int.max) }
    try require(try entries(beyond).isEmpty && beyond["nextOffset"] == nil, "Out-of-range folder page was not empty")
    let parentLink = folder.appendingPathComponent("root-link")
    try files.createSymbolicLink(at: parentLink, withDestinationURL: source)
    try reject { _ = try workspace.select(parentLink.path) }
    try reject { _ = try workspace.select(parentLink.appendingPathComponent("aFolder").path) }
    try require(workspace.root?.id == first.id, "Failed selection replaced the authorized root")
    let oversized = source.appendingPathComponent("oversized.md")
    _ = files.createFile(atPath: oversized.path, contents: nil)
    let handle = try FileHandle(forWritingTo: oversized)
    try handle.truncate(atOffset: 20 * 1024 * 1024 + 1); try handle.close()
    try reject { _ = try workspace.read(rootId: first.id, path: "oversized.md") }
    let restored = FolderWorkspace(stateFile: state)
    _ = try step("restore selection") { try restored.restore() }
    guard let next = restored.root else { throw Store.failure("Folder selection did not restore") }
    try require(next.id != first.id && next.path == first.path, "Restored folder reused an old authorization ID")
    try reject { _ = try restored.read(rootId: first.id, path: "note.md") }
    let moved = folder.appendingPathComponent("moved-workspace")
    try files.moveItem(at: source, to: moved)
    try files.createDirectory(at: source, withIntermediateDirectories: true)
    try Data("replacement".utf8).write(to: source.appendingPathComponent("note.md"))
    try reject { _ = try restored.list(rootId: next.id, path: "", offset: 0) }
    try reject { _ = try restored.read(rootId: next.id, path: "note.md") }
    _ = try step("close selection") { try restored.close() }
    try require(!files.fileExists(atPath: state.path) && restored.root == nil, "Closing workspace retained authorization")
    try reject { _ = try restored.list(rootId: next.id, path: "", offset: 0) }
    let many = folder.appendingPathComponent("pagination")
    try files.createDirectory(at: many.appendingPathComponent("first"), withIntermediateDirectories: true)
    try files.createDirectory(at: many.appendingPathComponent("Second"), withIntermediateDirectories: true)
    for index in 0..<503 {
        _ = files.createFile(atPath: many.appendingPathComponent(String(format: "%04d.md", index)).path, contents: Data())
    }
    let pageOne = try step("select pagination fixture") { try workspace.select(many.path) }
    let pageId = workspace.root!.id
    let pageTwo = try step("list second page") { try workspace.list(rootId: pageId, path: "", offset: 500) }
    let one = try entries(pageOne), two = try entries(pageTwo)
    try require(one.count == 500 && two.count == 5 && pageOne["nextOffset"] as? Int == 500 && pageTwo["nextOffset"] == nil, "Workspace pagination is incomplete")
    let names = (one + two).compactMap { $0["path"] as? String }
    try require(names.count == 505 && Set(names).count == 505 && names[0] == "first" && names[1] == "Second", "Workspace pagination duplicated entries or changed ordering")
    print("PASS macOS workspace: lazy restore, folder ordering, 500-entry pages, UTF-8, unsupported entries, stale IDs, no-follow paths and root replacement")
}
