import AppKit
import WebKit

extension AppDelegate {
    func checkFolderWorkspaceSmoke(_ completion: @escaping (Error?) -> Void) {
        guard let output = smokeOutput else { completion(Store.failure("Workspace smoke output missing")); return }
        let original = session
        do {
            let folder = output.appendingPathComponent("workspace-fixture").resolvingSymlinksInPath()
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try Data("# Workspace disk\n".utf8).write(to: folder.appendingPathComponent("workspace.md"))
            try Data("not editable".utf8).write(to: folder.appendingPathComponent("unsupported.exe"))
            folderQueue.async {
                let selection = Result { try self.folders.select(folder.path) }
                DispatchQueue.main.async {
                    do {
                        let page = try selection.get()
                        guard let root = page["root"] as? [String: Any], let rootId = root["id"] as? String else {
                            throw Store.failure("Workspace smoke root missing")
                        }
                        let active = self.session.documents[self.activeIndex]
                        self.web.callAsyncJavaScript("""
                        let latest = snapshot, expected, done;
                        const bridge = window.chrome.webview;
                        bridge.addEventListener('message', event => {
                          if (event.data.type === 'workspace') latest = event.data.document;
                          if (event.data.type === 'operationComplete' && done) { const callback = done; done = undefined; callback(); }
                          if (event.data.type === 'folderResponse' && event.data.requestId === expected?.id) {
                            const callback = expected.resolve; expected = undefined; callback(event.data);
                          }
                        });
                        const invoke = payload => new Promise((resolve, reject) => {
                          const timer = setTimeout(() => { done = undefined; reject(new Error('Workspace document operation timed out')); }, 5000);
                          done = () => { clearTimeout(timer); resolve(); };
                          bridge.postMessage({ ...latest, ...payload, type: 'openWorkspaceFile', documentId: latest.id });
                        });
                        const folder = (action, fields = {}) => new Promise((resolve, reject) => {
                          const id = crypto.randomUUID();
                          const timer = setTimeout(() => { expected = undefined; reject(new Error('Workspace RPC timed out')); }, 5000);
                          expected = { id, resolve: value => { clearTimeout(timer); resolve(value); } };
                          bridge.postMessage({ type: 'folderRequest', requestId: id, action, ...fields });
                        });
                        const listed = await folder('list', { rootId, path: '', offset: 0 });
                        if (listed.error || listed.data?.root?.id !== rootId || !listed.data.entries.some(entry =>
                            entry.name === 'unsupported.exe' && entry.supported === false)) throw new Error('Workspace RPC list mismatch');
                        await invoke({ rootId, path: 'workspace.md' });
                        if (latest.name !== 'workspace.md' || latest.text !== '# Workspace disk\\n') throw new Error('Workspace native open failed');
                        const openedId = latest.id;
                        latest = { ...latest, text: '# Workspace unsaved\\n', revision: latest.revision + 1 };
                        await invoke({ rootId, path: 'workspace.md' });
                        if (latest.id !== openedId || latest.text !== '# Workspace unsaved\\n') throw new Error('Workspace duplicate open replaced dirty text');
                        const closed = await folder('close');
                        if (closed.error || closed.data?.root !== null) throw new Error('Workspace close failed');
                        const stale = await folder('list', { rootId, path: '', offset: 0 });
                        if (!stale.error || latest.id !== openedId || latest.text !== '# Workspace unsaved\\n') throw new Error('Workspace close retained root or discarded document');
                        return true;
                        """, arguments: ["rootId": rootId, "snapshot": ["id": active.id, "text": active.text, "revision": active.revision]],
                           in: nil, in: .page) { result in
                            self.session = original; self.publish(); self.persist()
                            switch result {
                            case .success(let value):
                                if value as? Bool == true {
                                    print("PASS macOS workspace WK bridge: list, safe open, repeated dirty open, close and stale-root rejection")
                                    completion(nil)
                                } else { completion(Store.failure("Workspace smoke failed")) }
                            case .failure(let error): completion(error)
                            }
                        }
                    } catch { completion(error) }
                }
            }
        } catch { completion(error) }
    }
}
