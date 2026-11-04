import Foundation
import CryptoKit

struct Document: Codable {
    var id = UUID().uuidString
    var untitledName: String
    var path: String?
    var text: String
    var baseline: String
    var fingerprint: String?
    var bom = false
    var newline = "\n"
    var revision = 0
    var name: String { path.map { URL(fileURLWithPath: $0).lastPathComponent } ?? untitledName }
    var dirty: Bool { text != baseline }
}
struct Session: Codable {
    var version = 1
    var documents: [Document] = []
    var activeId = ""
    var nextUntitled = 1
}
enum Store {
    static func normalize(_ text: String) -> String { text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n") }
    static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func read(_ path: String) throws -> Document {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        if (attributes[.size] as? NSNumber)?.intValue ?? 0 > 20 * 1024 * 1024 { throw failure("文件超过 20 MB。") }
        let data = try Data(contentsOf: url)
        let bom = data.starts(with: [0xef, 0xbb, 0xbf])
        guard let raw = String(data: bom ? data.dropFirst(3) : data, encoding: .utf8), !raw.contains("\0") else { throw failure("文件不是 UTF-8 文本文档。") }
        return Document(untitledName: url.lastPathComponent, path: url.path, text: normalize(raw), baseline: normalize(raw), fingerprint: hash(data), bom: bom, newline: raw.contains("\r\n") ? "\r\n" : "\n")
    }
    static func write(_ document: Document, to path: String) throws -> String {
        let text = normalize(document.text).replacingOccurrences(of: "\n", with: document.newline)
        var data = document.bom ? Data([0xef, 0xbb, 0xbf]) : Data()
        data.append(Data(text.utf8))
        try data.write(to: URL(fileURLWithPath: path), options: .atomic)
        return hash(data)
    }
    static func samePath(_ a: String, _ b: String) -> Bool {
        URL(fileURLWithPath: a).standardizedFileURL.resolvingSymlinksInPath() == URL(fileURLWithPath: b).standardizedFileURL.resolvingSymlinksInPath()
    }
    static func conflict(_ document: Document) -> Bool {
        guard let path = document.path else { return false }
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return true }
        return hash(data) != document.fingerprint
    }
    static func restore(_ file: URL) throws -> Session {
        guard FileManager.default.fileExists(atPath: file.path) else { return Session() }
        var session = try JSONDecoder().decode(Session.self, from: Data(contentsOf: file))
        guard session.version == 1, Set(session.documents.map(\.id)).count == session.documents.count else { throw failure("会话格式无法识别，旧文件已保留。") }
        for i in session.documents.indices {
            session.documents[i].text = normalize(session.documents[i].text)
            session.documents[i].baseline = normalize(session.documents[i].baseline)
        }
        for i in session.documents.indices where !session.documents[i].dirty {
            guard let path = session.documents[i].path else { continue }
            if var disk = try? read(path) { disk.id = session.documents[i].id; session.documents[i] = disk }
            else { session.documents[i].path = nil; session.documents[i].baseline = "" }
        }
        if !session.documents.contains(where: { $0.id == session.activeId }) { session.activeId = session.documents.first?.id ?? "" }
        return session
    }
    static func saveSession(_ session: Session, _ file: URL) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(session).write(to: file, options: .atomic)
    }
    static func failure(_ message: String) -> NSError { NSError(domain: "Moye", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
