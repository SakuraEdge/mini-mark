import Foundation

extension AppDelegate {
    func handleEncoding(_ body: [String: Any]) {
        guard let requestId = body["requestId"] as? String, let id = body["documentId"] as? String else { return }
        var response: [String: Any] = ["type": "encodingResponse", "requestId": requestId, "documentId": id]
        do {
            guard ready, !cloudBusy, !folderChanging, closingRequest == nil, session.activeId == id,
                  let index = session.documents.firstIndex(where: { $0.id == id }), let encoding = body["encoding"] as? String else {
                throw Store.failure("文档状态已变化，请重新打开编码面板。")
            }
            let doc = session.documents[index], action = body["action"] as? String
            guard doc.cloud == nil, doc.revision == body["revision"] as? Int, doc.text == body["text"] as? String else {
                throw Store.failure("文档状态已变化，请重新打开编码面板。")
            }
            var preview = doc.text
            switch action {
            case "previewRead", "switch":
                guard !doc.dirty, let path = doc.path else { throw Store.failure("请先保存修改，再切换查看编码。") }
                var disk = try Store.read(path, encoding: encoding, folderSource: doc.folderSource == true)
                guard disk.fingerprint == doc.fingerprint else { throw Store.failure("磁盘文件已改变，请重新打开。") }
                preview = disk.text
                if action == "switch" {
                    disk.id = id; disk.revision = doc.revision; session.documents[index] = disk
                }
            case "previewConvert", "convert":
                guard doc.needsEncoding != true else { throw Store.failure("请先选择能正确读取正文的编码。") }
                guard !Store.conflict(doc) else { throw Store.failure("磁盘文件已改变，请重新打开。") }
                _ = try FileEncoding.encode(doc.text, as: encoding, bom: encoding != doc.currentEncoding || doc.bom, newline: doc.newline)
                if action == "convert" { session.documents[index].pendingEncoding = encoding == doc.currentEncoding ? nil : encoding }
            default: throw Store.failure("未知的编码操作。")
            }
            if action == "switch" || action == "convert" { persist(); publish() }
            response["preview"] = String(preview.prefix(1000))
        } catch { response["error"] = error.localizedDescription }
        post(response)
    }
}
