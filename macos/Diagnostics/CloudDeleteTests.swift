import Foundation

private final class DeleteTokenStore: CloudTokenStorage {
    var token: String? = "test_delete_token"
    func read() throws -> String? { token }
    func save(_ value: String) throws { token = value }
    func remove() throws { token = nil }
}

private final class DeleteFixture {
    var folder = false
    var onlyTarget = false
    var changedTarget = false
    var truncated = false
    var headConflict = false
    var malformedPatch = false
    var malformedCommit = false
    var malformedParents = false
    var finalHead: String?
    var referenceReads = 0
    var targetMode: String?
    var parentMode: String?
    var branch = "main"
    var calls: [String] = []
    var treePayloads: [[String: Any]] = []
    var commitPayload: [String: Any]?
    var patchPayload: [String: Any]?
    var holdRoot: ((Result<Data, Error>) -> Void)?
    var holdRootRequest = false
    var target: String { folder ? "archive" : "note.md" }
    var path: String { "docs/" + target }
    var targetSha: String { Self.sha(folder ? "5" : "3") }
    static func sha(_ char: String) -> String { String(repeating: char, count: 40) }
    static func entry(_ path: String, _ type: String, _ mode: String, _ sha: String) -> [String: Any] {
        ["path": path, "type": type, "mode": mode, "sha": sha]
    }
    func root() -> [String: Any] {
        ["sha": Self.sha("1"), "truncated": truncated, "tree": [
            Self.entry("docs", parentMode == nil ? "tree" : "blob", parentMode ?? "040000", Self.sha("2")),
            Self.entry("binary.dat", "blob", "100644", Self.sha("9")),
            Self.entry("link", "blob", "120000", Self.sha("a")),
            Self.entry("module", "commit", "160000", Self.sha("b"))
        ]]
    }
    func send(_ request: URLRequest, _ complete: @escaping (Result<Data, Error>) -> Void) {
        let path = request.url?.path ?? "", method = request.httpMethod ?? "GET"
        calls.append(method + " " + path)
        func done(_ value: [String: Any]) { complete(.success(try! JSONSerialization.data(withJSONObject: value))) }
        let prefix = "/repos/octocat/MiniMarkDisk"
        if path == "/user" { done(["login": "octocat"]); return }
        if path == prefix && method == "GET" { done(["default_branch": branch]); return }
        if path == prefix + "/git/ref/heads/" + branch && method == "GET" {
            referenceReads += 1
            done(["ref": "refs/heads/" + branch, "object": ["type": "commit", "sha": referenceReads > 1 ? finalHead ?? Self.sha("4") : Self.sha("4")]]); return
        }
        if path == prefix + "/git/commits/" + Self.sha("4") && method == "GET" {
            done(["sha": Self.sha("4"), "tree": ["sha": Self.sha("1")]]); return
        }
        if path == prefix + "/git/trees/" + Self.sha("1") && method == "GET" {
            if holdRootRequest { DispatchQueue.main.async { self.holdRoot = complete }; return }
            done(root()); return
        }
        if path == prefix + "/git/trees/" + Self.sha("2") && method == "GET" {
            let mode = targetMode ?? (folder ? "040000" : "100644")
            var items = [Self.entry(target, folder ? "tree" : "blob", mode, changedTarget ? Self.sha("f") : targetSha)]
            if !onlyTarget { items.append(Self.entry("keep.md", "blob", "100755", Self.sha("8"))) }
            done(["sha": Self.sha("2"), "truncated": false, "tree": items]); return
        }
        let payload = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        if path == prefix + "/git/trees" && method == "POST" {
            treePayloads.append(payload)
            done(["sha": Self.sha(treePayloads.count == 1 ? "c" : "d")]); return
        }
        if path == prefix + "/git/commits" && method == "POST" {
            commitPayload = payload
            done(["sha": Self.sha("e"), "tree": ["sha": malformedCommit ? Self.sha("f") : Self.sha("d")],
                  "parents": [["sha": malformedParents ? Self.sha("0") : Self.sha("4")]]]); return
        }
        if path == prefix + "/git/refs/heads/" + branch && method == "PATCH" {
            patchPayload = payload
            if headConflict { complete(.failure(CloudFailure("Cloud changed", status: 409))); return }
            if malformedPatch { done(["ref": "refs/heads/" + branch]); return }
            done(["ref": "refs/heads/" + branch, "object": ["type": "commit", "sha": Self.sha("e")]]); return
        }
        complete(.failure(Store.failure("Unexpected deletion request: " + method + " " + path)))
    }
    func client() -> GitHubCloud {
        GitHubCloud(store: DeleteTokenStore(), clientId: { "test_client_id" }, request: send)
    }
}

func runCloudDeleteTests() throws {
    func wait(_ predicate: () -> Bool) throws {
        let deadline = Date().addingTimeInterval(5)
        while !predicate() && Date() < deadline { _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01)) }
        guard predicate() else { throw Store.failure("Cloud deletion test timed out") }
    }
    func body(_ fixture: DeleteFixture) -> [String: Any] {
        ["requestId": UUID().uuidString, "action": "delete", "owner": "octocat",
         "path": fixture.path, "sha": fixture.targetSha, "entryType": fixture.folder ? "dir" : "file"]
    }
    func response(_ client: GitHubCloud, _ body: [String: Any]) throws -> [String: Any] {
        var output: [String: Any]?
        client.handle(body) { output = $0 }
        try wait { output != nil }
        return output!
    }
    func rejected(_ fixture: DeleteFixture, _ request: [String: Any]? = nil, writes: Bool = false) throws {
        let result = try response(fixture.client(), request ?? body(fixture))
        guard result["error"] is String, writes || !fixture.calls.contains(where: { $0.hasPrefix("POST ") || $0.hasPrefix("PATCH ") }) else {
            throw Store.failure("Unsafe cloud deletion was accepted")
        }
    }
    let file = DeleteFixture()
    file.branch = "notes/main"
    let deleted = try response(file.client(), body(file))
    guard let data = deleted["data"] as? [String: Any], data["deleted"] as? Bool == true,
          data["path"] as? String == file.path, data["type"] as? String == "file",
          data["commit"] as? String == DeleteFixture.sha("e"), file.treePayloads.count == 2,
          file.treePayloads.allSatisfy({ $0["base_tree"] == nil }),
          let child = file.treePayloads[0]["tree"] as? [[String: Any]], child.count == 1,
          child[0]["path"] as? String == "keep.md", child[0]["mode"] as? String == "100755",
          let root = file.treePayloads[1]["tree"] as? [[String: Any]], root.count == 4,
          root.first(where: { $0["path"] as? String == "docs" })?["sha"] as? String == DeleteFixture.sha("c"),
          root.first(where: { $0["path"] as? String == "link" })?["mode"] as? String == "120000",
          root.first(where: { $0["path"] as? String == "module" })?["type"] as? String == "commit",
          file.commitPayload?["parents"] as? [String] == [DeleteFixture.sha("4")],
          file.commitPayload?["tree"] as? String == DeleteFixture.sha("d"),
          file.patchPayload?["force"] as? Bool == false, file.referenceReads == 2 else { throw Store.failure("Atomic file deletion changed unrelated tree entries") }
    let folder = DeleteFixture()
    folder.folder = true; folder.onlyTarget = true
    let removedFolder = try response(folder.client(), body(folder))
    guard (removedFolder["data"] as? [String: Any])?["type"] as? String == "dir",
          !folder.calls.contains(where: { $0.contains("/git/trees/" + folder.targetSha) }),
          let emptyParent = folder.treePayloads.first?["tree"] as? [[String: Any]],
          emptyParent.count == 1, emptyParent[0]["path"] as? String == ".gitkeep", emptyParent[0]["content"] as? String == "" else {
        throw Store.failure("Folder deletion recursed into contents or lost empty parent")
    }
    let changed = DeleteFixture(); changed.changedTarget = true; try rejected(changed)
    let truncated = DeleteFixture(); truncated.truncated = true; try rejected(truncated)
    let symlink = DeleteFixture(); symlink.targetMode = "120000"; try rejected(symlink)
    let symlinkParent = DeleteFixture(); symlinkParent.parentMode = "120000"; try rejected(symlinkParent)
    let conflicting = DeleteFixture(); conflicting.headConflict = true; try rejected(conflicting, writes: true)
    guard conflicting.calls.filter({ $0.hasPrefix("PATCH ") }).count == 1,
          conflicting.patchPayload?["force"] as? Bool == false else { throw Store.failure("Conflicting deletion retried or forced branch update") }
    for differentHead in [DeleteFixture.sha("f"), DeleteFixture.sha("0")] {
        let advanced = DeleteFixture(); advanced.finalHead = differentHead
        try rejected(advanced, writes: true)
        guard advanced.referenceReads == 2, advanced.commitPayload != nil, advanced.patchPayload == nil else {
            throw Store.failure("Changed or rolled-back branch was updated after deletion snapshot")
        }
    }
    let malformedCommit = DeleteFixture(); malformedCommit.malformedCommit = true
    try rejected(malformedCommit, writes: true)
    guard malformedCommit.referenceReads == 1, malformedCommit.patchPayload == nil else {
        throw Store.failure("Unexpected commit contents reached branch update")
    }
    let malformedParents = DeleteFixture(); malformedParents.malformedParents = true
    try rejected(malformedParents, writes: true)
    guard malformedParents.referenceReads == 1, malformedParents.patchPayload == nil else {
        throw Store.failure("Unexpected commit parents reached branch update")
    }
    let unknown = DeleteFixture(); unknown.malformedPatch = true
    let unknownResult = try response(unknown.client(), body(unknown))
    guard (unknownResult["error"] as? String)?.contains("无法确认云端删除结果") == true,
          unknown.calls.filter({ $0.hasPrefix("PATCH ") }).count == 1 else { throw Store.failure("Unknown deletion outcome was retried or misreported") }
    for path in ["", "/", "../note.md", "docs/../note.md", ".git/config.md", "docs\\note.md",
                 Array(repeating: "deep", count: 17).joined(separator: "/") + "/note.md", "docs/unsupported.exe"] {
        let invalid = DeleteFixture()
        var request = body(invalid); request["path"] = path
        try rejected(invalid, request)
    }
    let wrongOwner = DeleteFixture()
    var wrongRequest = body(wrongOwner); wrongRequest["owner"] = "another-user"; try rejected(wrongOwner, wrongRequest)
    let invalidType = DeleteFixture()
    var typeRequest = body(invalidType); typeRequest["entryType"] = "symlink"; try rejected(invalidType, typeRequest)
    let invalidSha = DeleteFixture()
    var shaRequest = body(invalidSha); shaRequest["sha"] = invalidSha.targetSha + "\n"; try rejected(invalidSha, shaRequest)

    let pending = DeleteFixture(); pending.holdRootRequest = true
    let pendingClient = pending.client()
    var pendingResponse: [String: Any]?
    pendingClient.handle(body(pending)) { pendingResponse = $0 }
    try wait { pending.holdRoot != nil }
    _ = try response(pendingClient, ["requestId": "logout-delete", "action": "logout"])
    pending.holdRoot?(.success(try JSONSerialization.data(withJSONObject: pending.root())))
    try wait { pendingResponse != nil }
    guard pendingResponse?["error"] is String,
          !pending.calls.contains(where: { $0.hasPrefix("POST ") || $0.hasPrefix("PATCH ") }) else {
        throw Store.failure("Late deletion response continued after logout")
    }

    var local = Document(untitledName: "local.md", path: "/tmp/local.md", text: "unsaved local edit", baseline: "local saved",
                         cloud: CloudBinding(owner: "octocat", path: "docs/note.md", sha: DeleteFixture.sha("3"), baseline: "cloud saved"))
    let childDraft = Document(untitledName: "draft.md", text: "remote child", baseline: "",
                              cloud: CloudBinding(owner: "octocat", path: "docs/folder/child.md", sha: DeleteFixture.sha("3"), baseline: "remote child"))
    let otherOwner = Document(untitledName: "other.md", text: "other owner", baseline: "",
                              cloud: CloudBinding(owner: "other", path: "docs/note.md", sha: DeleteFixture.sha("3"), baseline: "other owner"))
    let adjacent = Document(untitledName: "adjacent.md", text: "adjacent", baseline: "",
                            cloud: CloudBinding(owner: "octocat", path: "docs-other/note.md", sha: DeleteFixture.sha("3"), baseline: "adjacent"))
    var documents = [local, childDraft, otherOwner, adjacent]
    guard CloudDocumentDeletion.detach(&documents, owner: "octocat", path: "docs", type: "dir") == 2,
          documents.count == 4, documents[0].text == local.text, documents[0].baseline == "local saved",
          documents[0].path == local.path, documents[0].cloud == nil, documents[0].dirty,
          documents[1].name == "child.md", documents[1].cloud == nil, documents[1].dirty,
          documents[2].cloud != nil, documents[3].cloud != nil else { throw Store.failure("Deleted cloud documents did not retain local copies") }
    local.cloud = CloudBinding(owner: "octocat", path: "docs/note.md", sha: DeleteFixture.sha("3"), baseline: "")
    documents = [local, childDraft]
    guard CloudDocumentDeletion.detach(&documents, owner: "OCTOCAT", path: "docs/note.md", type: "file") == 1,
          documents[1].cloud != nil else { throw Store.failure("File deletion detached another document") }
    print("PASS macOS cloud deletion: atomic file/folder removal, preserved trees, SHA conflicts, truncated trees, paths, logout and open-document detachment")
}
