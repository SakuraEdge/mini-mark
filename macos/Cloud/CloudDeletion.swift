import Foundation

final class CloudDeletion {
    typealias Request = (String, String, [String: Any]?, @escaping (Result<Any, Error>) -> Void) -> Void
    private struct TreeEntry {
        let path: String
        let mode: String
        let type: String
        let sha: String
        var payload: [String: Any] { ["path": path, "mode": mode, "type": type, "sha": sha] }
    }
    private let path: String
    private let expectedSha: String
    private let entryType: String
    private let segments: [String]
    private let request: Request
    private var parents: [[TreeEntry]] = []
    private var branch = ""
    private var head = ""
    private var updatingReference = false
    private var complete: ((Result<String, Error>) -> Void)?

    init(path: String, expectedSha: String, entryType: String, request: @escaping Request) throws {
        let segments = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !path.isEmpty, segments.count <= 16, segments.allSatisfy(Self.validSegment),
              Self.validSha(expectedSha), ["file", "dir"].contains(entryType) else {
            throw CloudFailure("删除路径或版本无效，目录最多支持 16 层。")
        }
        self.path = path; self.expectedSha = expectedSha; self.entryType = entryType
        self.segments = segments; self.request = request
    }

    func run(_ completion: @escaping (Result<String, Error>) -> Void) {
        complete = completion
        fetch("") { repository in
            guard let branch = repository["default_branch"] as? String, !branch.isEmpty,
                  branch.utf8.count <= 1024, branch.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ Self.validSegment(String($0)) }) else {
                throw CloudFailure("仓库分支信息无效。")
            }
            self.branch = branch
            self.fetch("/git/ref/heads/" + Self.encode(branch)) { reference in
                guard reference["ref"] as? String == "refs/heads/" + branch,
                      let object = reference["object"] as? [String: Any], object["type"] as? String == "commit" else {
                    throw CloudFailure("仓库分支信息无效。")
                }
                self.head = try Self.sha(object)
                self.fetch("/git/commits/" + self.head) { commit in
                    guard try Self.sha(commit) == self.head, let tree = commit["tree"] as? [String: Any] else {
                        throw CloudFailure("仓库提交信息无效。")
                    }
                    try self.walk(tree: Self.sha(tree), depth: 0)
                }
            }
        }
    }

    private func walk(tree: String, depth: Int) throws {
        fetch("/git/trees/" + tree) { response in
            guard try Self.sha(response) == tree, response["truncated"] as? Bool == false,
                  let items = response["tree"] as? [[String: Any]] else {
                throw CloudFailure("云端目录未完整返回，删除已停止。")
            }
            let entries = try items.map(Self.entry)
            guard Set(entries.map(\.path)).count == entries.count,
                  let target = entries.first(where: { $0.path == self.segments[depth] }) else {
                throw CloudFailure("云端目标不存在或目录无效，请刷新后重试。")
            }
            self.parents.append(entries)
            if depth < self.segments.count - 1 {
                guard target.type == "tree", target.mode == "040000" else { throw CloudFailure("目标父目录不是普通文件夹。") }
                try self.walk(tree: target.sha, depth: depth + 1)
                return
            }
            let regularFile = target.type == "blob" && ["100644", "100755"].contains(target.mode)
            let directory = target.type == "tree" && target.mode == "040000"
            guard (self.entryType == "file" ? regularFile : directory),
                  target.sha.caseInsensitiveCompare(self.expectedSha) == .orderedSame else {
                throw CloudFailure("云端目标已经变化，未删除。请刷新后重试。")
            }
            self.rebuild(depth: depth, child: nil)
        }
    }

    private func rebuild(depth: Int, child: String?) {
        let removedName = segments[depth]
        var entries = parents[depth].filter { $0.path != removedName }.map(\.payload)
        if let child = child { entries.append(["path": removedName, "mode": "040000", "type": "tree", "sha": child]) }
        if entries.isEmpty { entries.append(["path": ".gitkeep", "mode": "100644", "type": "blob", "content": ""]) }
        // Rebuild the complete parent tree without base_tree; retaining it would retain the deleted subtree.
        fetch("/git/trees", method: "POST", payload: ["tree": entries]) { response in
            let created = try Self.sha(response)
            if depth > 0 { self.rebuild(depth: depth - 1, child: created) }
            else { self.commit(tree: created) }
        }
    }

    private func commit(tree: String) {
        fetch("/git/commits", method: "POST",
              payload: ["message": "Delete \(path) via Mini Mark", "tree": tree, "parents": [head]]) { response in
            let created = try Self.sha(response)
            guard let createdTree = response["tree"] as? [String: Any], try Self.sha(createdTree) == tree,
                  let createdParents = response["parents"] as? [[String: Any]], createdParents.count == 1,
                  try Self.sha(createdParents[0]) == self.head else {
                throw CloudFailure("新提交内容无法确认，删除未提交。")
            }
            self.fetch("/git/ref/heads/" + Self.encode(self.branch)) { latest in
                guard latest["ref"] as? String == "refs/heads/" + self.branch,
                      let object = latest["object"] as? [String: Any], object["type"] as? String == "commit",
                      try Self.sha(object) == self.head else {
                    throw CloudFailure("云端分支已经变化，删除未提交，请刷新后重试。", status: 409)
                }
                self.updatingReference = true
                self.fetch("/git/refs/heads/" + Self.encode(self.branch), method: "PATCH", payload: ["sha": created, "force": false]) { reference in
                    guard reference["ref"] as? String == "refs/heads/" + self.branch,
                          let object = reference["object"] as? [String: Any], object["type"] as? String == "commit",
                          try Self.sha(object) == created else { throw CloudFailure("无法确认云端删除结果，请刷新后检查。") }
                    self.finish(.success(created))
                }
            }
        }
    }

    private func fetch(_ path: String, method: String = "GET", payload: [String: Any]? = nil,
                       next: @escaping ([String: Any]) throws -> Void) {
        request(path, method, payload) { result in
            do {
                guard let value = try result.get() as? [String: Any] else { throw CloudFailure("GitHub 返回了无效的仓库数据。") }
                try next(value)
            } catch {
                if self.updatingReference {
                    let status = (error as? CloudFailure)?.status ?? 0
                    let message = [409, 422].contains(status)
                        ? "云端分支已经变化，删除未提交，请刷新后重试。"
                        : "无法确认云端删除结果。请刷新仓库核对，不要直接重复删除。"
                    self.finish(.failure(CloudFailure(message, status: status)))
                } else { self.finish(.failure(error)) }
            }
        }
    }
    private func finish(_ result: Result<String, Error>) {
        let callback = complete; complete = nil
        callback?(result)
    }
    private static func entry(_ value: [String: Any]) throws -> TreeEntry {
        guard let path = value["path"] as? String, validTreeName(path),
              let mode = value["mode"] as? String, let type = value["type"] as? String,
              (type == "blob" && ["100644", "100755", "120000"].contains(mode)) ||
                (type == "tree" && mode == "040000") || (type == "commit" && mode == "160000") else {
            throw CloudFailure("云端目录包含无法识别的条目，删除已停止。")
        }
        return TreeEntry(path: path, mode: mode, type: type, sha: try sha(value))
    }
    private static func sha(_ value: [String: Any]) throws -> String {
        guard let sha = value["sha"] as? String, validSha(sha) else { throw CloudFailure("GitHub 返回了无效的仓库版本。") }
        return sha
    }
    private static func validSha(_ value: String) -> Bool {
        value.range(of: #"\A(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})\z"#, options: .regularExpression) != nil
    }
    private static func validSegment(_ value: String) -> Bool {
        validTreeName(value) && !value.contains("\\") && !value.contains(":") && !value.contains("?") && !value.contains("#")
    }
    private static func validTreeName(_ value: String) -> Bool {
        !value.isEmpty && value != "." && value != ".." && value.lowercased() != ".git" && !value.contains("/") && !value.contains("\0")
    }
    private static func encode(_ value: String) -> String {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return value.split(separator: "/").map { String($0).addingPercentEncoding(withAllowedCharacters: allowed)! }.joined(separator: "/")
    }
}
