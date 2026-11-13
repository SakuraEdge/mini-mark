import Foundation
import Darwin

enum DocumentNames {
    static let extensions = ["md", "markdown", "mdown", "txt", "yaml", "yml", "html", "htm"]
    static func generated(_ name: String) -> Bool {
        name.range(of: #"\A未命名(?: [1-9][0-9]*)?\.md\z"#, options: [.regularExpression, .caseInsensitive]) != nil
    }
    static func heading(_ text: String) -> String? {
        let end = text.unicodeScalars.firstIndex(where: { $0 == "\n" || $0 == "\r" }) ?? text.endIndex
        let line = String(text[..<end])
        guard let match = line.range(of: #"\A {0,3}#[ \t]+(.+)\z"#, options: .regularExpression) else { return nil }
        var title = String(line[match])
        title = title.replacingOccurrences(of: #"\A {0,3}#[ \t]+"#, with: "", options: .regularExpression)
        title = title.replacingOccurrences(of: #"[ \t]+#+[ \t]*\z"#, with: "", options: .regularExpression)
        title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.allSatisfy({ $0 == "#" }) { return nil }
        title = title.replacingOccurrences(of: #"[<>:"/\\|?*\x00-\x1F\x7F-\x9F]"#, with: " ", options: .regularExpression)
        title = title.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        title = title.replacingOccurrences(of: #"[. ]+\z"#, with: "", options: .regularExpression)
        guard !title.isEmpty else { return nil }
        if reserved(title) { title = "_" + title }
        var scalars = String.UnicodeScalarView(), bytes = 0
        for scalar in title.unicodeScalars.prefix(117) {
            let size = String(scalar).utf8.count
            if bytes + size > 237 { break }
            scalars.append(scalar); bytes += size
        }
        title = String(scalars)
        title = title.replacingOccurrences(of: #"[. ]+\z"#, with: "", options: .regularExpression)
        return title.isEmpty ? nil : title + ".md"
    }
    static func validate(_ value: String, current: String) throws -> String {
        guard !value.isEmpty, value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              value.range(of: #"[<>:"/\\|?*\x00-\x1F\x7F-\x9F]"#, options: .regularExpression) == nil,
              !value.hasSuffix("."), !value.hasSuffix(" "), !reserved(value) else { throw Store.failure("文件名无效。") }
        let oldExtension = (current as NSString).pathExtension
        let name = value.contains(".") ? value : value + "." + oldExtension
        guard name.unicodeScalars.count <= 120, name.utf8.count <= 240, extensions.contains((name as NSString).pathExtension.lowercased()) else {
            throw Store.failure("文件名最多 120 个字符，扩展名须为 Markdown、YAML、HTML 或 TXT。")
        }
        return name
    }
    static func reserved(_ value: String) -> Bool {
        value.range(of: #"\A(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|\z)"#, options: [.regularExpression, .caseInsensitive]) != nil
    }
    static func moveLocal(_ document: Document, name: String) throws -> String {
        guard let oldPath = document.path else { throw Store.failure("本地文件路径缺失。") }
        let source = URL(fileURLWithPath: oldPath).standardizedFileURL
        let destination = source.deletingLastPathComponent().appendingPathComponent(name).standardizedFileURL
        if source.path == destination.path { return source.path }
        if source.path.caseInsensitiveCompare(destination.path) == .orderedSame { throw Store.failure("仅修改文件名大小写暂不支持，请使用其他名称。") }
        let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular else { throw Store.failure("只能重命名普通本地文件。") }
        guard !Store.conflict(document) else { throw Store.failure("文件已被其他程序修改，请重新打开后再重命名。") }
        guard !FileManager.default.fileExists(atPath: destination.path) else { throw Store.failure("同目录中已有该名称，请更换文件名。") }
        let result = source.path.withCString { from in destination.path.withCString { to in renamex_np(from, to, UInt32(RENAME_EXCL)) } }
        guard result == 0 else { throw Store.failure("文件重命名失败，原文件已保留。") }
        return destination.path
    }
}

extension Document {
    var automaticNameEnabled: Bool { path == nil && cloud == nil && (name as NSString).pathExtension.lowercased() == "md" && (autoName ?? DocumentNames.generated(name)) }
    mutating func updateAutomaticName(hint: String? = nil) {
        guard automaticNameEnabled else { return }
        if let title = DocumentNames.heading(text) { untitledName = title; autoName = true }
        else if let hint = hint, (hint as NSString).pathExtension.lowercased() == "md",
                (try? DocumentNames.validate(hint, current: name)) == hint {
            untitledName = hint; autoName = true
        }
    }
}
