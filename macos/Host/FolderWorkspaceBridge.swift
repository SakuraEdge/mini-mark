import AppKit
import CoreFoundation

extension AppDelegate {
    func handleFolderRequest(_ body: [String: Any]) {
        guard let requestId = body["requestId"] as? String, !requestId.isEmpty, requestId.count <= 128,
              let action = body["action"] as? String else { return }
        func reply(_ result: Result<[String: Any], Error>) {
            switch result {
            case .success(let data): self.post(["type": "folderResponse", "requestId": requestId, "data": data])
            case .failure(let error): self.post(["type": "folderResponse", "requestId": requestId, "error": error.localizedDescription])
            }
        }
        switch action {
        case "choose":
            guard !folderChanging, folderPanel == nil, window.attachedSheet == nil, !confirmedClose, closingRequest == nil else {
                reply(.failure(Store.failure("请先完成当前窗口操作。"))); return
            }
            folderGeneration += 1
            let epoch = folderGeneration
            folderChanging = true
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
            panel.canCreateDirectories = false; panel.resolvesAliases = false; panel.prompt = "选择文件夹"
            folderPanel = panel
            panel.beginSheetModal(for: window) { result in
                if self.folderPanel === panel { self.folderPanel = nil }
                guard result == .OK, let url = panel.url, epoch == self.folderGeneration else {
                    if epoch == self.folderGeneration { self.folderChanging = false }
                    reply(.success(["cancelled": true])); return
                }
                self.folderQueue.async {
                    let selected = Result { try self.folders.select(url.path) }
                    DispatchQueue.main.async {
                        guard epoch == self.folderGeneration else { reply(.success(["cancelled": true])); return }
                        self.folderChanging = false
                        reply(selected)
                    }
                }
            }
        case "restore", "close":
            guard action == "close" || !folderChanging else { reply(.failure(Store.failure("工作区正在切换，请稍候。"))); return }
            folderGeneration += 1
            let epoch = folderGeneration
            folderChanging = true
            if action == "close" { folderPanel?.cancel(nil) }
            folderQueue.async {
                let result = Result { try action == "close" ? self.folders.close() : self.folders.restore() }
                DispatchQueue.main.async {
                    guard epoch == self.folderGeneration else { reply(.failure(Store.failure("工作区已经改变，请重试。"))); return }
                    self.folderChanging = false
                    reply(result)
                }
            }
        case "list":
            guard !folderChanging else { reply(.failure(Store.failure("工作区正在切换，请稍候。"))); return }
            guard let rootId = body["rootId"] as? String, let path = body["path"] as? String else {
                reply(.failure(Store.failure("目录请求无效。"))); return
            }
            let offset: Int
            if let raw = body["offset"] {
                guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
                      let integer = raw as? Int, integer >= 0 else { reply(.failure(Store.failure("目录分页参数无效。"))); return }
                offset = integer
            } else { offset = 0 }
            let epoch = folderGeneration
            folderQueue.async {
                let result = Result { try self.folders.list(rootId: rootId, path: path, offset: offset) }
                DispatchQueue.main.async {
                    guard epoch == self.folderGeneration else { reply(.failure(Store.failure("工作区已经改变，请重试。"))); return }
                    reply(result)
                }
            }
        default: reply(.failure(Store.failure("不支持的工作区操作。")))
        }
    }

    func openWorkspaceFile(_ body: [String: Any]) {
        beginDocumentOperation { done in
            guard !self.folderChanging else { done(.failure(Store.failure("工作区正在切换，请稍候。"))); return }
            guard let rootId = body["rootId"] as? String, let path = body["path"] as? String else {
                done(.failure(Store.failure("工作区文件路径缺失。"))); return
            }
            let epoch = self.folderGeneration
            let existingPaths = self.session.documents.compactMap { document -> (id: String, path: String)? in
                document.path.map { (document.id, $0) }
            }
            self.folderQueue.async {
                let result = Result { () -> (Document, String?) in
                    let document = try self.folders.read(rootId: rootId, path: path)
                    let existing = existingPaths.first { Store.samePath($0.path, document.path!) }?.id
                    return (document, existing)
                }
                DispatchQueue.main.async {
                    do {
                        guard epoch == self.folderGeneration else { throw Store.failure("工作区已经改变，文件未打开。") }
                        let (document, existingId) = try result.get()
                        if let existing = self.session.documents.first(where: { $0.id == existingId }) {
                            self.session.activeId = existing.id
                        } else {
                            self.session.documents.append(document); self.session.activeId = document.id
                        }
                        self.publish(); self.persist(); done(.success(()))
                    } catch { done(.failure(error)) }
                }
            }
        }
    }
}
