import AppKit

extension AppDelegate {
    func cloudRequest(_ action: String, fields: [String: Any] = [:], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        var body = fields
        body["type"] = "cloudRequest"; body["requestId"] = UUID().uuidString; body["action"] = action
        cloud.handle(body) { response in
            if let error = response["error"] as? String { completion(.failure(Store.failure(error))) }
            else if let data = response["data"] as? [String: Any] { completion(.success(data)) }
            else { completion(.failure(Store.failure("云文档响应无效。"))) }
        }
    }

    func beginDocumentOperation(_ action: (@escaping (Result<Void, Error>) -> Void) -> Void) {
        guard !cloudBusy else { notice("云文档操作尚未完成，请稍候。", error: true); post(["type": "operationComplete"]); return }
        cloudBusy = true
        action { result in
            self.cloudBusy = false
            if case .failure(let error) = result { self.closingRequest = nil; self.notice(error.localizedDescription, error: true) }
            self.post(["type": "operationComplete"])
            self.drainQueuedDocumentPaths()
        }
    }

    func drainQueuedDocumentPaths() {
        if !queuedPaths.isEmpty && !confirmedClose {
            let paths = queuedPaths; queuedPaths = []
            do { for path in paths { try openPath(path) }; publish(); persist(); window.makeKeyAndOrderFront(nil) }
            catch { notice(error.localizedDescription, error: true) }
        }
    }

    func performCloudDocument(_ type: String, body: [String: Any], documentId: String) {
        beginDocumentOperation { done in
            guard let index = self.session.documents.firstIndex(where: { $0.id == documentId }) else { done(.failure(Store.failure("文档已关闭。"))); return }
            if type == "cloudDetach" {
                let name = self.session.documents[index].name
                self.session.documents[index].cloud = nil
                self.session.documents[index].autoName = false
                if self.session.documents[index].path == nil { self.session.documents[index].untitledName = name }
                self.publish(); self.persist(); done(.success(())); return
            }
            guard let owner = body["owner"] as? String, !owner.isEmpty, let path = body["cloudPath"] as? String else {
                done(.failure(Store.failure("云文档路径缺失。"))); return
            }
            if let existing = self.session.documents.first(where: { $0.cloud?.owner.caseInsensitiveCompare(owner) == .orderedSame && $0.cloud?.path == path }) {
                if type == "cloudOpen" { self.session.activeId = existing.id; self.publish(); self.persist(); done(.success(())) }
                else { done(.failure(Store.failure("该云文档已在另一个标签中打开。"))) }
                return
            }
            let snapshot = self.session.documents[index]
            if type == "cloudBind" && snapshot.cloud != nil { done(.failure(Store.failure("当前文档已经是云文档。"))); return }
            var fields: [String: Any] = ["owner": owner, "path": path]
            if type == "cloudBind" { fields["text"] = snapshot.text }
            self.cloudRequest(type == "cloudOpen" ? "read" : "write", fields: fields) { result in
                do {
                    let response = try result.get()
                    guard let sha = response["sha"] as? String, response["path"] as? String == path else { throw Store.failure("无法确认云文档版本。") }
                    if type == "cloudOpen" {
                        guard let raw = response["text"] as? String else { throw Store.failure("云文档内容缺失。") }
                        let text = Store.normalize(raw)
                        let doc = Document(untitledName: URL(fileURLWithPath: path).lastPathComponent, text: text, baseline: "",
                                           cloud: CloudBinding(owner: owner, path: path, sha: sha, baseline: text), autoName: false)
                        self.session.documents.append(doc); self.session.activeId = doc.id
                    } else {
                        guard let current = self.session.documents.firstIndex(where: { $0.id == documentId }) else { throw Store.failure("文档已关闭。") }
                        self.session.documents[current].cloud = CloudBinding(owner: owner, path: path, sha: sha, baseline: snapshot.text)
                        self.session.documents[current].autoName = false
                    }
                    self.persist(); self.publish(); done(.success(()))
                } catch { done(.failure(error)) }
            }
        }
    }

    func saveCloudDocument(_ id: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard let snapshot = session.documents.first(where: { $0.id == id }), let binding = snapshot.cloud else {
            completion(.failure(Store.failure("云文档已关闭或已切换为本地文档。"))); return
        }
        var fields: [String: Any] = ["owner": binding.owner, "path": binding.path, "text": snapshot.text]
        if let sha = binding.sha { fields["sha"] = sha }
        cloudRequest("write", fields: fields) { result in
            do {
                let response = try result.get()
                guard let sha = response["sha"] as? String, response["path"] as? String == binding.path,
                      let index = self.session.documents.firstIndex(where: { $0.id == id }),
                      self.session.documents[index].cloud?.owner == binding.owner,
                      self.session.documents[index].cloud?.path == binding.path,
                      self.session.documents[index].cloud?.sha == binding.sha else { throw Store.failure("云文档状态已经变化，请重新打开。") }
                self.session.documents[index].cloud?.sha = sha
                self.session.documents[index].cloud?.baseline = snapshot.text
                let document = self.session.documents[index]
                self.persist(); self.title()
                self.post(["type": "saved", "documentId": id, "name": document.name, "path": document.path as Any? ?? NSNull(),
                           "cloud": document.cloud!.message, "autoName": false, "text": snapshot.text])
                completion(.success(()))
            } catch { completion(.failure(error)) }
        }
    }

    func saveDocumentForClosing(_ id: String, completion: @escaping (Result<Bool, Error>) -> Void) {
        guard let index = session.documents.firstIndex(where: { $0.id == id }) else { completion(.success(false)); return }
        if session.documents[index].cloud != nil {
            saveCloudDocument(id) { result in
                switch result {
                case .success: completion(.success(true))
                case .failure(let error): completion(.failure(error))
                }
            }
        } else {
            do { completion(.success(try save(index, saveAs: false, allowPdf: false))) }
            catch { completion(.failure(error)) }
        }
    }

    func closeDocument(_ id: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard let document = session.documents.first(where: { $0.id == id }) else { completion(.success(())); return }
        if !document.dirty { remove(id); publish(); persist(); completion(.success(())); return }
        let decision = saveDecision(document)
        if decision == .alertSecondButtonReturn { completion(.success(())); return }
        guard session.documents.first(where: { $0.id == id })?.revision == document.revision else {
            completion(.failure(Store.failure("文档在关闭过程中发生了修改，请重试。"))); return
        }
        if decision == .alertThirdButtonReturn { remove(id); publish(); persist(); completion(.success(())); return }
        saveDocumentForClosing(id) { result in
            do {
                if try result.get() {
                    if self.session.documents.first(where: { $0.id == id })?.dirty == true { throw Store.failure("同步期间文档又有修改，请保存后再关闭。") }
                    self.remove(id); self.publish(); self.persist()
                }
                completion(.success(()))
            } catch { completion(.failure(error)) }
        }
    }

    func finishCloudAwareClose(completion: @escaping (Result<Void, Error>) -> Void) {
        let revisions = Dictionary(uniqueKeysWithValues: session.documents.map { ($0.id, $0.revision) })
        var decisions: [(id: String, answer: NSApplication.ModalResponse)] = []
        for document in session.documents where document.dirty {
            let answer = saveDecision(document)
            if answer == .alertSecondButtonReturn { closingRequest = nil; completion(.success(())); return }
            decisions.append((document.id, answer))
        }
        func saveNext(_ position: Int) {
            if position < decisions.count {
                let decision = decisions[position]
                if decision.answer != .alertFirstButtonReturn { saveNext(position + 1); return }
                saveDocumentForClosing(decision.id) { result in
                    do {
                        guard try result.get() else { self.closingRequest = nil; completion(.success(())); return }
                        guard self.session.documents.first(where: { $0.id == decision.id })?.dirty != true else {
                            throw Store.failure("同步期间文档又有修改，请保存后再退出。")
                        }
                        saveNext(position + 1)
                    } catch { self.closingRequest = nil; completion(.failure(error)) }
                }
                return
            }
            for document in self.session.documents {
                guard revisions[document.id] == document.revision else {
                    self.closingRequest = nil; completion(.failure(Store.failure("文档在关闭过程中发生了修改，请重试。"))); return
                }
            }
            for decision in decisions where decision.answer == .alertThirdButtonReturn {
                guard let index = self.session.documents.firstIndex(where: { $0.id == decision.id }) else { continue }
                if self.session.documents[index].path == nil && self.session.documents[index].cloud == nil { self.remove(decision.id) }
                else { self.session.documents[index].text = self.session.documents[index].savedText }
            }
            self.persist(); self.closingRequest = nil; self.confirmedClose = true
            completion(.success(())); NSApp.terminate(nil)
        }
        saveNext(0)
    }
}
