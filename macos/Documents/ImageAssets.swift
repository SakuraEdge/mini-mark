import Foundation
import CryptoKit

enum ImageAssets {
    static func copyForSaveAs(_ text: String, previousPath: String?, targetPath: String) throws {
        guard let previous = previousPath, !Store.samePath(previous, targetPath) else { return }
        let regex = try NSRegularExpression(pattern: #"assets/mini-mark-([0-9a-f]{64})\.(png|jpg|gif|webp)"#)
        let string = text as NSString, folder = URL(fileURLWithPath: previous).deletingLastPathComponent()
        for match in regex.matches(in: text, range: NSRange(location: 0, length: string.length)) {
            let path = folder.appendingPathComponent(string.substring(with: match.range))
            let size = try path.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 10 * 1024 * 1024 else { throw Store.failure("图片资源过大。") }
            let data = try Data(contentsOf: path)
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard hash == string.substring(with: match.range(at: 1)) else { throw Store.failure("图片资源已被修改，无法完成另存为。") }
            let ext = string.substring(with: match.range(at: 2)), mime = ext == "jpg" ? "jpeg" : ext
            _ = try importImage("data:" + "image/" + mime + ";base64," + data.base64EncodedString(), documentPath: targetPath)
        }
    }
    static func importImage(_ dataUrl: String, documentPath: String?) throws -> String {
        guard dataUrl.utf8.count <= 14_000_000, let comma = dataUrl.firstIndex(of: ",") else { throw Store.failure("图片不能超过 10 MB。") }
        let header = String(dataUrl[..<comma])
        let extensions = ["data:image/png;base64": "png", "data:image/jpeg;base64": "jpg", "data:image/gif;base64": "gif", "data:image/webp;base64": "webp"]
        guard let ext = extensions[header], let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])),
              !data.isEmpty, data.count <= 10 * 1024 * 1024 else { throw Store.failure("无效的图片数据。") }
        let prefix = Array(data.prefix(12))
        let valid: Bool
        switch ext {
        case "png": valid = prefix.starts(with: [137, 80, 78, 71, 13, 10, 26, 10])
        case "jpg": valid = prefix.starts(with: [255, 216, 255])
        case "gif": valid = prefix.starts(with: Array("GIF87a".utf8)) || prefix.starts(with: Array("GIF89a".utf8))
        default: valid = prefix.count >= 12 && Array(prefix[0..<4]) == Array("RIFF".utf8) && Array(prefix[8..<12]) == Array("WEBP".utf8)
        }
        guard valid else { throw Store.failure("图片内容与格式不匹配。") }
        guard let path = documentPath else { return dataUrl }
        let directory = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent("assets", isDirectory: true)
        let manager = FileManager.default
        if manager.fileExists(atPath: directory.path), (try directory.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink == true { throw Store.failure("图片目录不能是目录链接。") }
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let name = "mini-mark-\(hash).\(ext)", target = directory.appendingPathComponent(name)
        if manager.fileExists(atPath: target.path) {
            guard (try target.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true,
                  try Data(contentsOf: target) == data else { throw Store.failure("图片文件名发生冲突。") }
        } else { try data.write(to: target, options: .withoutOverwriting) }
        return "assets/" + name
    }
}
