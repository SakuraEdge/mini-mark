import Foundation

extension AppDelegate {
    func renameDocument(_ body: [String: Any]) {
        beginDocumentOperation { done in
            do {
                guard let targetId = body["targetId"] as? String, let name = body["name"] as? String,
                      let index = self.session.documents.firstIndex(where: { $0.id == targetId }) else { throw Store.failure("文档已关闭。") }
                let snapshot = self.session.documents[index]
                let newName = try DocumentNames.validate(name, current: snapshot.name)
                if newName == snapshot.name {
                    self.session.documents[index].autoName = false
                    self.persist(); self.publish(); done(.success(())); return
                }
                if let binding = snapshot.cloud {
                    guard let sha = binding.sha else { throw Store.failure("云文档版本缺失，请重新打开。") }
                    let newPath = (binding.path.split(separator: "/").dropLast().map(String.init) + [newName]).joined(separator: "/")
                    if self.session.documents.contains(where: {
                        $0.id != targetId && $0.cloud?.owner.caseInsensitiveCompare(binding.owner) == .orderedSame && $0.cloud?.path == newPath
                    }) { throw Store.failure("新名称对应的云文档已在另一标签打开。") }
                    self.cloudRequest("rename", fields: ["owner": binding.owner, "path": binding.path, "sha": sha, "name": newName]) { result in
                        do {
                            let response = try result.get()
                            guard response["previousPath"] as? String == binding.path,
                                  response["path"] as? String == newPath, response["sha"] as? String == sha else {
                                throw Store.failure("无法确认云端重命名结果，请刷新后检查。")
                            }
                            for i in self.session.documents.indices {
                                guard let current = self.session.documents[i].cloud,
                                      current.owner.caseInsensitiveCompare(binding.owner) == .orderedSame,
                                      current.path == binding.path else { continue }
                                self.session.documents[i].cloud?.path = newPath
                                self.session.documents[i].autoName = false
                            }
                            self.persist(); self.publish(); done(.success(()))
                        } catch { done(.failure(error)) }
                    }
                    return
                }
                if let path = snapshot.path {
                    let destination = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent(newName).path
                    if self.session.documents.contains(where: { $0.id != targetId && ($0.path.map { Store.samePath($0, destination) } ?? false) }) {
                        throw Store.failure("新名称对应的文件已在另一标签打开。")
                    }
                    self.session.documents[index].path = try DocumentNames.moveLocal(snapshot, name: newName)
                } else { self.session.documents[index].untitledName = newName }
                self.session.documents[index].autoName = false
                self.persist(); self.publish(); done(.success(()))
            } catch { done(.failure(error)) }
        }
    }
}
