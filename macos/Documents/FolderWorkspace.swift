import Foundation
import Darwin

struct WorkspaceFolderRoot {
    let id: String
    let path: String
    let device: dev_t
    let inode: ino_t
    var message: [String: Any] {
        ["id": id, "name": URL(fileURLWithPath: path).lastPathComponent.isEmpty ? path : URL(fileURLWithPath: path).lastPathComponent, "path": path]
    }
}

struct WorkspaceFolderEntry {
    let name: String
    let path: String
    let directory: Bool
    let supported: Bool
    let link: Bool
    var message: [String: Any] {
        ["name": name, "path": path, "type": directory ? "directory" : "file", "supported": supported, "link": link]
    }
}

// All methods are invoked on the host's serial folder queue; initialization performs no disk access.
final class FolderWorkspace {
    private struct StoredRoot: Codable { let path: String }
    private let stateFile: URL
    private(set) var root: WorkspaceFolderRoot?
    static let pageSize = 500
    private let maximumBytes = 20 * 1024 * 1024
    init(stateFile: URL) { self.stateFile = stateFile }

    func select(_ path: String) throws -> [String: Any] {
        let candidate = try authorizedRoot(path)
        let page = try listing(root: candidate, path: "", offset: 0)
        try FileManager.default.createDirectory(at: stateFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(StoredRoot(path: candidate.path)).write(to: stateFile, options: .atomic)
        root = candidate
        return page
    }
    func restore() throws -> [String: Any] {
        guard FileManager.default.fileExists(atPath: stateFile.path) else {
            root = nil; return Self.empty
        }
        let size = try FileManager.default.attributesOfItem(atPath: stateFile.path)[.size] as? NSNumber
        guard let size = size, size.intValue <= 32768 else { throw Store.failure("工作区记录无效，请重新选择文件夹。") }
        let bytes = try Data(contentsOf: stateFile)
        guard bytes.count <= 32768 else { throw Store.failure("工作区记录无效，请重新选择文件夹。") }
        let previous = try JSONDecoder().decode(StoredRoot.self, from: bytes)
        let candidate = try authorizedRoot(previous.path)
        let page = try listing(root: candidate, path: "", offset: 0)
        root = candidate
        return page
    }
    func close() throws -> [String: Any] {
        root = nil
        if FileManager.default.fileExists(atPath: stateFile.path) { try FileManager.default.removeItem(at: stateFile) }
        return Self.empty
    }
    static var empty: [String: Any] { ["root": NSNull(), "path": "", "entries": [[String: Any]]()] }
    func list(rootId: String, path: String, offset: Int) throws -> [String: Any] {
        try listing(root: current(rootId), path: path, offset: offset)
    }
    func read(rootId: String, path: String) throws -> Document {
        let root = try current(rootId), segments = try Self.relativeSegments(path, allowRoot: false)
        guard Self.supported(path) else { throw Store.failure("该文件类型不支持编辑。") }
        let rootFd = try openRoot(root)
        defer { Darwin.close(rootFd) }
        let fileFd = try descend(rootFd, segments: segments, directory: false)
        defer { Darwin.close(fileFd) }
        var before = stat()
        guard fstat(fileFd, &before) == 0, Self.isRegular(before),
              before.st_size >= 0, before.st_size <= off_t(maximumBytes) else { throw Store.failure("只能打开不超过 20 MB 的普通文本文档。") }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 65536)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(fileFd, $0.baseAddress, $0.count) }
            if count < 0 { if errno == EINTR { continue }; throw Store.failure("无法读取工作区文件。") }
            if count == 0 { break }
            guard data.count + count <= maximumBytes else { throw Store.failure("文件超过 20 MB。") }
            data.append(contentsOf: buffer.prefix(count))
        }
        var after = stat()
        guard fstat(fileFd, &after) == 0, before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_size == after.st_size, before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec else { throw Store.failure("文件在读取时发生变化，请重试。") }
        let validated = try openRoot(root)
        defer { Darwin.close(validated) }
        let check = try descend(validated, segments: segments, directory: false)
        defer { Darwin.close(check) }
        var currentFile = stat()
        guard fstat(check, &currentFile) == 0, currentFile.st_dev == after.st_dev, currentFile.st_ino == after.st_ino else {
            throw Store.failure("文件位置在读取时发生变化，请刷新工作区。")
        }
        let bom = data.starts(with: [0xef, 0xbb, 0xbf])
        guard let raw = String(data: bom ? data.dropFirst(3) : data, encoding: .utf8), !raw.contains("\0") else {
            throw Store.failure("文件不是 UTF-8 文本文档。")
        }
        let absolute = URL(fileURLWithPath: root.path).appendingPathComponent(path).path
        let text = Store.normalize(raw)
        return Document(untitledName: segments.last!, path: absolute, text: text, baseline: text,
                        fingerprint: Store.hash(data), bom: bom, newline: raw.contains("\r\n") ? "\r\n" : "\n", autoName: false)
    }
    private func current(_ rootId: String) throws -> WorkspaceFolderRoot {
        guard let root = root, !rootId.isEmpty, root.id == rootId else { throw Store.failure("工作区已经改变，请重新选择文件夹。") }
        return root
    }
    private func authorizedRoot(_ path: String) throws -> WorkspaceFolderRoot {
        guard path.hasPrefix("/"), !path.contains("\0"), path.utf8.count <= 16384 else { throw Store.failure("文件夹路径无效。") }
        let segments = path.split(separator: "/").map(String.init)
        guard !segments.contains(".") && !segments.contains("..") else { throw Store.failure("文件夹路径无效。") }
        let normalized = "/" + segments.joined(separator: "/")
        let fd = try openAbsolute(normalized)
        defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, Self.isDirectory(info) else { throw Store.failure("请选择普通文件夹。") }
        return WorkspaceFolderRoot(id: UUID().uuidString, path: normalized, device: info.st_dev, inode: info.st_ino)
    }
    private func openRoot(_ root: WorkspaceFolderRoot) throws -> Int32 {
        let fd = try openAbsolute(root.path)
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_dev == root.device, info.st_ino == root.inode else {
            Darwin.close(fd); throw Store.failure("工作区文件夹已经被移动或替换，请重新选择。")
        }
        return fd
    }
    private func openAbsolute(_ path: String) throws -> Int32 {
        let descriptor = Darwin.open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else { throw Store.failure("无法读取文件夹。") }
        defer { Darwin.close(descriptor) }
        return try descend(descriptor, segments: path.split(separator: "/").map(String.init), directory: true)
    }
    private func descend(_ base: Int32, segments: [String], directory: Bool) throws -> Int32 {
        var current = dup(base)
        guard current >= 0 else { throw Store.failure("无法读取工作区。") }
        for (index, segment) in segments.enumerated() {
            let flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | ((directory || index < segments.count - 1) ? O_DIRECTORY : O_NONBLOCK)
            let next = segment.withCString { openat(current, $0, flags) }
            Darwin.close(current)
            guard next >= 0 else { throw Store.failure("路径不存在、无权读取或包含符号链接。") }
            current = next
        }
        return current
    }
    private func listing(root: WorkspaceFolderRoot, path: String, offset: Int) throws -> [String: Any] {
        let segments = try Self.relativeSegments(path, allowRoot: true)
        guard offset >= 0 else { throw Store.failure("目录分页参数无效。") }
        let rootFd = try openRoot(root)
        defer { Darwin.close(rootFd) }
        let fd = try descend(rootFd, segments: segments, directory: true)
        defer { Darwin.close(fd) }
        let copy = dup(fd)
        guard copy >= 0 else { throw Store.failure("无法读取目录。") }
        guard let directory = fdopendir(copy) else { Darwin.close(copy); throw Store.failure("无法读取目录。") }
        defer { closedir(directory) }
        var entries: [WorkspaceFolderEntry] = []
        while true {
            errno = 0
            guard let item = readdir(directory) else {
                if errno != 0 { throw Store.failure("目录读取失败，请重试。") }
                break
            }
            let capacity = MemoryLayout.size(ofValue: item.pointee.d_name)
            let name = withUnsafePointer(to: &item.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: capacity) { String(validatingUTF8: $0) }
            }
            guard let name = name else { throw Store.failure("目录包含无法显示的非 UTF-8 文件名。") }
            if name == "." || name == ".." { continue }
            var info = stat()
            let available = name.withCString { fstatat(fd, $0, &info, AT_SYMLINK_NOFOLLOW) } == 0
            let link = available && Self.isLink(info)
            let isDirectory = available && Self.isDirectory(info)
            let relative = (segments + [name]).joined(separator: "/")
            let usablePath = (try? Self.relativeSegments(relative, allowRoot: false)) != nil
            entries.append(WorkspaceFolderEntry(name: name, path: relative, directory: isDirectory,
                                                supported: usablePath && available && !link && (isDirectory || Self.isRegular(info) && Self.supported(name)), link: link))
        }
        let validated = try openRoot(root)
        defer { Darwin.close(validated) }
        let check = try descend(validated, segments: segments, directory: true)
        defer { Darwin.close(check) }
        var original = stat(), latest = stat()
        guard fstat(fd, &original) == 0, fstat(check, &latest) == 0, original.st_dev == latest.st_dev, original.st_ino == latest.st_ino else {
            throw Store.failure("目录在读取时发生变化，请刷新工作区。")
        }
        entries.sort {
            if $0.directory != $1.directory { return $0.directory }
            let left = $0.name.lowercased().utf8, right = $1.name.lowercased().utf8
            return left.elementsEqual(right) ? $0.name.utf8.lexicographicallyPrecedes($1.name.utf8) : left.lexicographicallyPrecedes(right)
        }
        let start = min(offset, entries.count), end = min(start + Self.pageSize, entries.count)
        var result: [String: Any] = ["root": root.message, "path": path, "entries": entries[start..<end].map(\.message)]
        if end < entries.count { result["nextOffset"] = end }
        return result
    }
    static func relativeSegments(_ path: String, allowRoot: Bool) throws -> [String] {
        if path.isEmpty && allowRoot { return [] }
        let segments = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !segments.isEmpty, path.utf8.count <= 16384, !path.contains("\\"),
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              segments.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains(":") }) else {
            throw Store.failure("工作区相对路径无效。")
        }
        return segments
    }
    private static func supported(_ path: String) -> Bool { DocumentNames.extensions.contains((path as NSString).pathExtension.lowercased()) }
    private static func isDirectory(_ value: stat) -> Bool { value.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR) }
    private static func isRegular(_ value: stat) -> Bool { value.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) }
    private static func isLink(_ value: stat) -> Bool { value.st_mode & mode_t(S_IFMT) == mode_t(S_IFLNK) }
}
