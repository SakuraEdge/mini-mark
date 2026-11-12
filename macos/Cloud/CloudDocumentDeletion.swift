import Foundation

enum CloudDocumentDeletion {
    static func detach(_ documents: inout [Document], owner: String, path: String, type: String) -> Int {
        var changed = 0
        for index in documents.indices {
            guard let binding = documents[index].cloud, binding.owner.caseInsensitiveCompare(owner) == .orderedSame,
                  binding.path == path || (type == "dir" && binding.path.hasPrefix(path + "/")) else { continue }
            let name = documents[index].name
            documents[index].cloud = nil
            if documents[index].path == nil { documents[index].untitledName = name }
            changed += 1
        }
        return changed
    }
}

extension AppDelegate {
    func mutateCloudEntry(_ body: [String: Any]) {
        guard let requestId = body["requestId"] as? String, !requestId.isEmpty, requestId.count <= 128 else { return }
        guard !cloudBusy, closingRequest == nil else {
            post(["type": "cloudResponse", "requestId": requestId, "error": "文档操作尚未完成，请稍候。"]); return
        }
        cloudBusy = true
        cloud.handle(body) { response in
            self.cloudBusy = false
            self.post(response)
            self.drainQueuedDocumentPaths()
        }
    }

    func deleteCloudEntry(_ body: [String: Any]) {
        guard let requestId = body["requestId"] as? String, !requestId.isEmpty, requestId.count <= 128 else { return }
        guard !cloudBusy, closingRequest == nil else {
            post(["type": "cloudResponse", "requestId": requestId, "error": "文档操作尚未完成，请稍候再删除。"]); return
        }
        guard let owner = body["owner"] as? String, !owner.isEmpty,
              let path = body["path"] as? String, !path.isEmpty,
              let type = body["entryType"] as? String, ["file", "dir"].contains(type) else {
            post(["type": "cloudResponse", "requestId": requestId, "error": "删除目标无效。"]); return
        }
        cloudBusy = true
        cloud.handle(body) { response in
            self.cloudBusy = false
            if let data = response["data"] as? [String: Any], data["deleted"] as? Bool == true,
               data["path"] as? String == path, data["type"] as? String == type {
                _ = CloudDocumentDeletion.detach(&self.session.documents, owner: owner, path: path, type: type)
                self.persist(); self.publish()
            }
            self.post(response)
            self.drainQueuedDocumentPaths()
        }
    }
}
