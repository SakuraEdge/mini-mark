import Foundation
import CoreFoundation

enum FileEncoding {
    static let maximum = 20 * 1024 * 1024
    private static let codecs = ["utf-8": "UTF-8", "utf-8-bom": "UTF-8", "utf-16le": "UTF-16LE", "utf-16be": "UTF-16BE",
                                 "gbk": "CP936", "gb18030": "GB18030", "windows-1252": "WINDOWS-1252"]
    private static let signatures = ["utf-8-bom": Data([0xef, 0xbb, 0xbf]), "utf-16le": Data([0xff, 0xfe]), "utf-16be": Data([0xfe, 0xff])]
    // Darwin iconv rejects supplementary GB18030 characters. Foundation uses the full four-byte mapping.
    private static let gb18030 = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(0x0632 /* kCFStringEncodingGB_18030_2000 */))
    private static func transcode(_ data: Data, from: String, to: String, limit: Int) throws -> Data {
        if from == "GB18030" || to == "GB18030" {
            let source: String.Encoding = from == "GB18030" ? gb18030 : .utf8
            let destination: String.Encoding = to == "GB18030" ? gb18030 : .utf8
            guard let text = String(data: data, encoding: source),
                  let bytes = text.data(using: destination, allowLossyConversion: false),
                  text.data(using: source, allowLossyConversion: false) == data else {
                throw Store.failure("GB18030 无法完整读取或表示正文。")
            }
            guard bytes.count <= limit else { throw Store.failure("编码后的文档超过大小限制。") }
            return bytes
        }
        var pointer: UnsafeMutablePointer<UInt8>?, count = 0
        let status = data.withUnsafeBytes { bytes in
            mm_transcode(to, from, bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count, limit, &pointer, &count)
        }
        guard status == 0, let pointer = pointer else {
            throw Store.failure(status == 2 ? "编码后的文档超过大小限制。" : "所选编码无法完整读取或表示正文。")
        }
        return Data(bytesNoCopy: pointer, count: count, deallocator: .free)
    }
    static func decode(_ data: Data, path: String, requested: String? = nil, offerChoice: Bool = false) throws -> Document {
        guard data.count <= maximum else { throw Store.failure("文件超过 20 MB。") }
        let signature = signatures.first { data.starts(with: $0.value) }?.key
        let name = requested ?? signature ?? "utf-8"
        guard let codec = codecs[name] else { throw Store.failure("请选择支持的文件编码。") }
        let bom = signature == name || (name == "utf-8" && signature == "utf-8-bom")
        let actual = codec == "UTF-8" ? (bom ? "utf-8-bom" : "utf-8") : name
        var doc = Document(untitledName: URL(fileURLWithPath: path).lastPathComponent, path: path, text: "", baseline: "", fingerprint: Store.hash(data), bom: bom, autoName: false, encoding: actual)
        do {
            let input = bom ? data.dropFirst(signatures[signature!]!.count) : data
            let utf8 = codec == "UTF-8" ? input : try transcode(input, from: codec, to: "UTF-8", limit: maximum * 4)
            guard let raw = String(data: utf8, encoding: .utf8), !raw.contains("\0") else { throw Store.failure("所选编码无法读取完整文件。") }
            doc.text = Store.normalize(raw); doc.baseline = doc.text; doc.newline = raw.contains("\r\n") ? "\r\n" : "\n"
        } catch { if !offerChoice { throw error }; doc.needsEncoding = true }
        return doc
    }
    static func encode(_ text: String, as name: String, bom: Bool, newline: String) throws -> Data {
        guard let codec = codecs[name], !text.contains("\0") else { throw Store.failure("编码或正文无效。") }
        let body = Data(Store.normalize(text).replacingOccurrences(of: "\n", with: newline).utf8)
        let bytes = codec == "UTF-8" ? body : try transcode(body, from: "UTF-8", to: codec, limit: maximum)
        let prefix = (name == "utf-8-bom" || bom) ? signatures[name] ?? Data() : Data()
        guard bytes.count + prefix.count <= maximum else { throw Store.failure("编码后的文件超过 20 MB。") }
        if codec != "UTF-8", try transcode(bytes, from: codec, to: "UTF-8", limit: maximum * 4) != body {
            throw Store.failure("目标编码无法完整表示正文。")
        }
        return prefix + bytes
    }
}
