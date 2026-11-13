import AppKit
import WebKit
import PDFKit

func runStoreTests() throws {
    try runUpdateManifestTests()
    try runDocumentNameTests()
    try runFolderWorkspaceTests()
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("moye-test-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let path = folder.appendingPathComponent("中文 文档.md").path
    var doc = Document(untitledName: "文档.md", text: "# 中文\n公式 $$x$$\n", baseline: "", bom: true, newline: "\r\n")
    doc.fingerprint = try Store.write(doc, to: path); doc.path = path
    let read = try Store.read(path)
    guard read.text == doc.text, read.bom, read.newline == "\r\n", !Store.conflict(doc) else { throw Store.failure("UTF-8 round trip failed") }
    try Data("外部修改".utf8).write(to: URL(fileURLWithPath: path))
    guard Store.conflict(doc) else { throw Store.failure("Conflict missed") }
    let second = Document(untitledName: "第二份.md", text: "草稿B", baseline: "")
    let session = Session(documents: [doc, second], activeId: second.id)
    let file = folder.appendingPathComponent("session.json"); try Store.saveSession(session, file)
    let restored = try Store.restore(file)
    guard restored.documents.count == 2, restored.activeId == second.id, restored.documents[0].text == doc.text else { throw Store.failure("Session round trip failed") }
    let windows = Document(untitledName: "CRLF.md", text: "# Windows\r\nbody\r\n", baseline: "# Windows\r\nbody\r\n", newline: "\r\n")
    try Store.saveSession(Session(documents: [windows], activeId: windows.id), file)
    let normalized = try Store.restore(file).documents[0]
    guard normalized.text == "# Windows\nbody\n", !normalized.dirty, normalized.newline == "\r\n" else { throw Store.failure("CRLF recovery normalization failed") }
    var cloudDoc = Document(untitledName: "local.md", path: path, text: "# Cloud\r\nbody", baseline: "local baseline",
                            cloud: CloudBinding(owner: "octocat", path: "notes/cloud.md", sha: String(repeating: "a", count: 40), baseline: "# Cloud\r\nbody"))
    try Store.saveSession(Session(documents: [cloudDoc], activeId: cloudDoc.id), file)
    cloudDoc = try Store.restore(file).documents[0]
    guard cloudDoc.name == "cloud.md", cloudDoc.text == "# Cloud\nbody", !cloudDoc.dirty,
          cloudDoc.cloud?.baseline == "# Cloud\nbody", cloudDoc.baseline == "local baseline",
          cloudDoc.path == path else { throw Store.failure("Cloud recovery reread local disk or lost baseline") }
    cloudDoc.cloud = nil
    guard cloudDoc.dirty else { throw Store.failure("Cloud detach incorrectly marked local disk saved") }
    let cloudOnly = Document(untitledName: "draft.md", text: "saved cloud text", baseline: "",
                             cloud: CloudBinding(owner: "octocat", path: "cloud.md", sha: String(repeating: "b", count: 40), baseline: "saved cloud text"))
    guard !cloudOnly.dirty, cloudOnly.savedText == "saved cloud text" else { throw Store.failure("Cloud saved baseline mismatch") }
    let image = Data([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    let dataUrl = "data:" + "image/png;base64," + image.base64EncodedString()
    let relative = try ImageAssets.importImage(dataUrl, documentPath: path)
    guard relative.hasPrefix("assets/mini-mark-"), try Data(contentsOf: folder.appendingPathComponent(relative)) == image else { throw Store.failure("Image import failed") }
    guard try ImageAssets.importImage(dataUrl, documentPath: nil) == dataUrl else { throw Store.failure("Draft image changed") }
    let moved = folder.appendingPathComponent("moved/note.md")
    try ImageAssets.copyForSaveAs("![](\(relative))", previousPath: path, targetPath: moved.path)
    guard try Data(contentsOf: moved.deletingLastPathComponent().appendingPathComponent(relative)) == image else { throw Store.failure("Image Save As failed") }
    print("PASS macOS storage: UTF-8, BOM, CRLF, conflict, two-document recovery, cloud baseline and detach")
}

extension AppDelegate {
    func checkConfirmationSmoke(_ completion: @escaping (Error?) -> Void) {
        var completions = 0
        let once = ScriptConfirmation(message: "Test") { _ in completions += 1 }
        once.resolve(false); once.resolve(true)
        guard completions == 1 else { completion(Store.failure("JavaScript confirmation completed more than once")); return }
        func run(_ accepted: Bool, next: @escaping (Error?) -> Void) {
            var finished = false
            func finish(_ error: Error?) { if !finished { finished = true; next(error) } }
            web.evaluateJavaScript("confirm('MAC_CONFIRM_SMOKE')") { value, error in
                guard error == nil, value as? Bool == accepted else { finish(error ?? Store.failure("JavaScript confirm result mismatch")); return }
                finish(nil)
            }
            func poll(_ remaining: Int) {
                if finished { return }
                if let pending = self.scriptConfirmation {
                    guard pending.alert.buttons.count == 2, pending.alert.buttons[0].title == "取消" else { finish(Store.failure("Confirmation cancel button unavailable")); return }
                    self.window.endSheet(pending.alert.window, returnCode: accepted ? .alertSecondButtonReturn : .alertFirstButtonReturn)
                } else if remaining == 0 { finish(Store.failure("Native confirmation sheet did not appear")) }
                else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { poll(remaining - 1) } }
            }
            poll(100)
        }
        run(false) { error in
            if let error = error { completion(error); return }
            run(true) { error in
                if error == nil { print("PASS macOS trusted JavaScript confirmation sheets: cancel and accept") }
                completion(error)
            }
        }
    }

    func checkHtmlSmoke(_ completion: @escaping (Error?) -> Void) {
        guard let output = smokeOutput else { return }
        do {
            let file = output.appendingPathComponent("preview.html")
            try Data("<!doctype html><html><head><link rel='stylesheet' href='local.css'></head><body><h1 id='result'>BEFORE</h1><script src='local.js'></script></body></html>".utf8).write(to: file)
            try Data("h1 { color: rgb(12, 100, 50); }".utf8).write(to: output.appendingPathComponent("local.css"))
            try Data("document.getElementById('result').textContent='HTML_SCRIPT_OK'".utf8).write(to: output.appendingPathComponent("local.js"))
            let preview = HtmlPreview(file: file)
            preview.showWindow(nil)
            func poll(_ remaining: Int) {
                preview.web.evaluateJavaScript("""
                document.getElementById('result')?.textContent === 'HTML_SCRIPT_OK' &&
                getComputedStyle(document.querySelector('h1')).color === 'rgb(12, 100, 50)' &&
                typeof window.chrome?.webview === 'undefined' &&
                typeof window.webkit?.messageHandlers?.bridge === 'undefined'
                """) { value, error in
                    if value as? Bool == true {
                        preview.close()
                        print("PASS macOS HTML relative CSS/JS and no native bridge")
                        completion(nil)
                    } else if remaining == 0 {
                        preview.close()
                        completion(error ?? Store.failure("HTML preview smoke failed"))
                    } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { poll(remaining - 1) } }
                }
            }
            poll(100)
        } catch { completion(error) }
    }
    func checkPluginSmoke(_ completion: @escaping (Error?) -> Void) {
        web.callAsyncJavaScript("""
        const wait = async predicate => {
          for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 60)); }
          throw new Error('Plugin timeout: ' + document.getElementById('plugin-status').textContent);
        };
        document.getElementById('manage-plugins').click();
        document.querySelector('#plugins-dialog [data-action=new]').click();
        document.getElementById('plugin-source').value = "miniMark.register({id:'mac-smoke',name:'Mac test',version:'1',commands:[{id:'check',title:'Check sandbox',async run(){let blocked=false;try{await fetch('https://example.com/probe')}catch{blocked=true}return {message:blocked && typeof chrome === 'undefined' && typeof document === 'undefined' ? 'MAC_PLUGIN_OK' : 'MAC_PLUGIN_FAILED'}}}]});";
        document.querySelector('#plugins-dialog [data-action=save]').click();
        await wait(() => document.getElementById('plugin-status').textContent === '已保存');
        document.querySelector('.plugin-commands button').click();
        await wait(() => document.getElementById('toast').textContent === 'MAC_PLUGIN_OK');
        document.querySelector('#plugins-dialog [data-action=close]').click();
        return true;
        """, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): completion(value as? Bool == true ? nil : Store.failure("Plugin smoke failed"))
            case .failure(let error): completion(error)
            }
        }
    }
    func runSmoke() {
        guard let output = smokeOutput else { return }
        do {
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            try runStoreTests()
            add("# macOS 验证\n\n中文公式\n\n$$\na^2+b^2=c^2\n$$\n\n```cpp\ncout<<ans<<\"\\n\";\n```\n\n" + (1...45).map { "第 \($0) 段：用于验证中文文字与多页 PDF。\n\n" }.joined(), "Mac 验证.md")
            publish(); persist()
        } catch { smokeFinish(error); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            self.web.evaluateJavaScript("""
            (() => {
              localStorage.setItem('moye.smoke', 'ok');
              return document.querySelectorAll('.document-tab').length >= 2 &&
                !!document.querySelector('.math-block .katex') &&
                localStorage.getItem('moye.smoke') === 'ok' &&
                typeof crypto.randomUUID() === 'string';
            })()
            """) { result, error in
                guard error == nil, result as? Bool == true else { self.smokeFinish(error ?? Store.failure("Editor, math, tabs or local storage unavailable")); return }
                self.checkPluginSmoke { error in
                if let error = error { self.smokeFinish(error); return }
                self.checkHtmlSmoke { error in
                if let error = error { self.smokeFinish(error); return }
                self.checkConfirmationSmoke { error in
                if let error = error { self.smokeFinish(error); return }
                self.checkFolderWorkspaceSmoke { error in
                if let error = error { self.smokeFinish(error); return }
                self.checkBackgroundSmoke { error in
                if let error = error { self.smokeFinish(error); return }
                self.web.takeSnapshot(with: nil) { image, error in
                    if let image = image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) { try? png.write(to: output.appendingPathComponent("macos-editor.png")) }
                    do {
                        let index = self.activeIndex
                        let path = output.appendingPathComponent("中文保存.md").path
                        self.session.documents[index].fingerprint = try Store.write(self.session.documents[index], to: path)
                        self.session.documents[index].path = path
                        guard try Store.read(path).text == self.session.documents[index].text else { throw Store.failure("Native save mismatch") }
                        try self.beginPdf(self.session.documents[index], output.appendingPathComponent("macos-export.pdf"))
                    } catch { self.smokeFinish(error) }
                }
                }
                }
                }
                }
                }
            }
        }
    }
    func finishSmokePdf(_ error: Error?) {
        if let error = error { smokeFinish(error); return }
        guard let output = smokeOutput, let pdf = PDFDocument(url: output.appendingPathComponent("macos-export.pdf")), pdf.pageCount > 1, pdf.string?.contains("macOS 验证") == true else { smokeFinish(Store.failure("Paginated PDF failed")); return }
        do {
            let data = try Data(contentsOf: root.appendingPathComponent("index.html"))
            guard !data.isEmpty else { throw Store.failure("Missing resources") }
            try "PASS macOS native editor, math, two tabs, persistence, UTF-8 save, image storage, plugin isolation, \(pdf.pageCount)-page PDF\n".write(to: output.appendingPathComponent("result.txt"), atomically: true, encoding: .utf8)
            smokeFinish(nil)
        } catch { smokeFinish(error) }
    }
    func smokeFinish(_ error: Error?) {
        guard !confirmedClose else { return }
        confirmedClose = true
        var finished = false
        func finish(_ cleanupError: Error? = nil) {
            guard !finished else { return }
            finished = true
            if let failure = error ?? cleanupError {
                let details = String(describing: failure as NSError)
                fputs("FAIL \(details)\n", stderr)
                if let output = self.smokeOutput { try? details.write(to: output.appendingPathComponent("error.txt"), atomically: true, encoding: .utf8) }
                exit(1)
            }
            print("PASS macOS native smoke")
            NSApp.terminate(nil)
        }
        guard #available(macOS 14.0, *), let identifier = smokeDataStoreID else { finish(); return }
        web?.stopLoading()
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "bridge")
        web?.removeFromSuperview()
        web?.navigationDelegate = nil
        web?.uiDelegate = nil
        web = nil
        smokeRestoreWeb?.stopLoading()
        smokeRestoreWeb?.navigationDelegate = nil
        smokeRestoreWeb?.uiDelegate = nil
        smokeRestoreWeb = nil
        func cleanup(_ attempt: Int) {
            WKWebsiteDataStore.remove(forIdentifier: identifier) { cleanupError in
                if cleanupError != nil && attempt < 20 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { cleanup(attempt + 1) }
                } else {
                    DispatchQueue.main.async { finish(cleanupError) }
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { cleanup(0) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { finish(Store.failure("Isolated WK smoke storage cleanup timed out")) }
    }
}
