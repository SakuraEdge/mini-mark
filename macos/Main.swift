import AppKit
import WebKit
import UniformTypeIdentifiers

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var scheme: AppScheme!
    var session = Session()
    var ready = false, confirmedClose = false, persistenceBlocked = false
    var queuedPaths: [String] = []
    var draftTimer: Timer?
    var closingRequest: String?
    var closingApplication = false
    var pdfRequest: (id: String, documentId: String, folder: URL?, target: URL)?
    var pdfExporter: PdfExporter?
    let updates = GitHubUpdates()
    let root = Bundle.main.resourceURL!.appendingPathComponent("wwwroot")
    let dataRoot: URL = {
        if let path = ProcessInfo.processInfo.environment["MOYE_DATA_DIR"] { return URL(fileURLWithPath: path) }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Moye")
    }()
    var sessionFile: URL { dataRoot.appendingPathComponent("session-mac-v1.json") }
    var activeIndex: Int { session.documents.firstIndex { $0.id == session.activeId } ?? 0 }
    var smokeStarted = false
    var smokeOutput: URL? {
        guard let index = CommandLine.arguments.firstIndex(of: "--smoke"), index + 1 < CommandLine.arguments.count else { return nil }
        return URL(fileURLWithPath: CommandLine.arguments[index + 1], isDirectory: true)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "墨页 Moye"; window.minSize = NSSize(width: 720, height: 520); window.center(); window.delegate = self
        let config = WKWebViewConfiguration()
        scheme = AppScheme(root: root); config.setURLSchemeHandler(scheme, forURLScheme: "moye")
        config.userContentController.add(self, name: "bridge")
        config.userContentController.addUserScript(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: window.contentView!.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]; web.navigationDelegate = self
        window.contentView!.addSubview(web); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        web.load(URLRequest(url: URL(string: "moye://app/index.html")!))
        if smokeOutput != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 90) { if !self.confirmedClose { self.smokeFinish(Store.failure("Native macOS smoke timed out")) } }
        }
    }
    func buildMenu() {
        let menu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于墨页", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(withTitle: "检测更新…", action: #selector(checkUpdateMenu), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出墨页", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let file = NSMenuItem(), fileMenu = NSMenu(title: "文件")
        for (title, selector, key) in [("新建", #selector(newMenu), "n"), ("打开…", #selector(openMenu), "o"), ("保存", #selector(saveMenu), "s"), ("关闭文档", #selector(closeMenu), "w")] {
            let item = NSMenuItem(title: title, action: selector, keyEquivalent: key); item.target = self; fileMenu.addItem(item)
        }
        file.submenu = fileMenu; menu.addItem(file)
        let edit = NSMenuItem(), editMenu = NSMenu(title: "编辑")
        for (title, selector, key) in [("撤销", #selector(undoMenu), "z"), ("重做", #selector(redoMenu), "Z"), ("剪切", #selector(NSText.cut(_:)), "x"), ("拷贝", #selector(NSText.copy(_:)), "c"), ("粘贴", #selector(NSText.paste(_:)), "v"), ("全选", #selector(NSText.selectAll(_:)), "a")] {
            let item = NSMenuItem(title: title, action: selector, keyEquivalent: key)
            if title == "撤销" || title == "重做" { item.target = self }
            editMenu.addItem(item)
        }
        edit.submenu = editMenu; menu.addItem(edit); NSApp.mainMenu = menu
    }
    func click(_ id: String) { web.evaluateJavaScript("document.getElementById('\(id)')?.click()", completionHandler: nil) }
    @objc func checkUpdateMenu() { click("check-updates") }
    @objc func newMenu() { click("new-file") }
    @objc func openMenu() { click("open-file") }
    @objc func saveMenu() { click("save-markdown") }
    @objc func closeMenu() { web.evaluateJavaScript("document.querySelector('.document-tab.active .tab-close')?.click()", completionHandler: nil) }
    @objc func undoMenu() { click("undo") }
    @objc func redoMenu() { click("redo") }
    func post(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__moyeReceive(\(json))", completionHandler: nil)
    }
    func notice(_ message: String, error: Bool = false) { post(["type": error ? "error" : "notice", "message": message]) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.host == "app", let body = message.body as? [String: Any] else { return }
        DispatchQueue.main.async {
            do { try self.receive(body) } catch { self.notice(error.localizedDescription, error: true); self.post(["type": "operationComplete"]) }
        }
    }
    func receive(_ body: [String: Any]) throws {
        guard let type = body["type"] as? String else { return }
        if type == "ready" {
            if ready { return }; ready = true
            do { session = try Store.restore(sessionFile) } catch { persistenceBlocked = true; notice("旧会话无法读取，已保留原文件。", error: true) }
            if session.documents.isEmpty {
                let text = try String(contentsOf: root.appendingPathComponent("welcome.md"), encoding: .utf8)
                add(text, "随手记.md", baseline: text)
            }
            for path in queuedPaths { try openPath(path) }; queuedPaths = []
            publish(recovered: session.documents.contains { $0.dirty }); persist(); return
        }
        if type == "rendered" { if smokeOutput != nil && !smokeStarted { smokeStarted = true; runSmoke() }; return }
        if type == "checkUpdates" {
            let id = body["requestId"] as? String ?? ""
            updates.check { result in
                switch result {
                case .success(let result): self.post(["type": "updateResult", "requestId": id, "releases": result.releases, "cacheNotice": result.cacheNotice as Any? ?? NSNull()])
                case .failure(let error): self.post(["type": "updateResult", "requestId": id, "error": error.localizedDescription])
                }
            }; return
        }
        if type == "openExternal", let value = body["url"] as? String, let url = URL(string: value), ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url); return }
        if type == "pdfHtml" || type == "pdfError" {
            guard let request = pdfRequest, body["requestId"] as? String == request.id, body["documentId"] as? String == request.documentId else { return }
            if type == "pdfError" { pdfRequest = nil; notice("PDF 排版失败。", error: true); return }
            guard let html = body["html"] as? String else { return }
            let exporter = PdfExporter(); pdfExporter = exporter
            exporter.export(html: html, folder: request.folder, to: request.target, owner: window) { error in
                self.pdfRequest = nil; self.pdfExporter = nil
                if let error = error { self.notice(error.localizedDescription, error: true) } else { self.notice("PDF 已保存：\(request.target.lastPathComponent)") }
                if self.smokeOutput != nil { self.finishSmokePdf(error) }
            }; return
        }
        if type == "closingText", body["requestId"] as? String != closingRequest { return }
        guard ready, let id = body["documentId"] as? String, let index = session.documents.firstIndex(where: { $0.id == id }) else { post(["type": "operationComplete"]); return }
        if let text = body["text"] as? String, let revision = body["revision"] as? Int {
            if revision < session.documents[index].revision || (revision == session.documents[index].revision && text != session.documents[index].text) { publish(); return }
            session.documents[index].text = text; session.documents[index].revision = revision
        }
        if type == "edit" {
            title(); draftTimer?.invalidate()
            draftTimer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: false) { _ in self.persist() }; return
        }
        defer { post(["type": "operationComplete"]) }
        switch type {
        case "new": add(body["initialText"] as? String ?? "", body["name"] as? String); publish(); persist()
        case "activate":
            if let target = body["targetId"] as? String, session.documents.contains(where: { $0.id == target }) { session.activeId = target; publish(); persist() }
        case "closeTab":
            if let target = body["targetId"] as? String, let i = session.documents.firstIndex(where: { $0.id == target }) {
                if try confirmSave(i) { remove(target); publish(); persist() }
            }
        case "open":
            let panel = NSOpenPanel(); panel.allowedContentTypes = [.plainText, .text]; panel.allowsMultipleSelection = true
            if panel.runModal() == .OK { for url in panel.urls { try openPath(url.path) }; publish(); persist() }
        case "save", "saveAs": _ = try save(index, saveAs: type == "saveAs", allowPdf: true)
        case "exportPdf": try choosePdf(session.documents[index])
        case "exportHtml":
            let panel = NSSavePanel(); panel.allowedContentTypes = [.html]; panel.nameFieldStringValue = (body["name"] as? String ?? "文档").replacingOccurrences(of: ".md", with: "") + ".html"
            if panel.runModal() == .OK, let url = panel.url, let html = body["html"] as? String { try Data(html.utf8).write(to: url, options: .atomic); notice("HTML 已导出") }
        case "closingText": try finishClose()
        default: break
        }
    }
    func add(_ text: String = "", _ name: String? = nil, baseline: String = "") {
        let name = name ?? "未命名 \(session.nextUntitled).md"; session.nextUntitled += 1
        let doc = Document(untitledName: name, text: text, baseline: baseline)
        session.documents.append(doc); session.activeId = doc.id
    }
    func remove(_ id: String) {
        guard let index = session.documents.firstIndex(where: { $0.id == id }) else { return }
        session.documents.remove(at: index)
        if session.documents.isEmpty { add() }
        else if session.activeId == id { session.activeId = session.documents[min(index, session.documents.count - 1)].id }
    }
    func openPath(_ path: String) throws {
        if let doc = session.documents.first(where: { $0.path.map { Store.samePath($0, path) } ?? false }) { session.activeId = doc.id; return }
        let doc = try Store.read(path); session.documents.append(doc); session.activeId = doc.id
    }
    func publish(recovered: Bool = false) {
        let doc = session.documents[activeIndex]
        scheme.documentFolder = doc.path.map { URL(fileURLWithPath: $0).deletingLastPathComponent() }
        post(["type": "workspace", "recovered": recovered, "tabs": session.documents.map { ["id": $0.id, "name": $0.name, "path": $0.path as Any? ?? NSNull(), "dirty": $0.dirty, "revision": $0.revision] },
              "document": ["id": doc.id, "name": doc.name, "path": doc.path as Any? ?? NSNull(), "text": doc.text, "baseline": doc.baseline, "revision": doc.revision]])
        title()
    }
    func title() { if !session.documents.isEmpty { let doc = session.documents[activeIndex]; window.title = "\(doc.dirty ? "• " : "")\(doc.name) · 墨页" } }
    func persist() {
        if persistenceBlocked { return }
        do { try Store.saveSession(session, sessionFile) } catch { notice("草稿备份失败，请手动保存文档。", error: true) }
    }
    func save(_ index: Int, saveAs: Bool, allowPdf: Bool) throws -> Bool {
        var doc = session.documents[index], path = doc.path
        if path == nil || saveAs {
            let panel = NSSavePanel(); panel.nameFieldStringValue = doc.name; panel.allowedContentTypes = [.init(filenameExtension: "md")!]
            let formats = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 240, height: 28))
            if allowPdf {
                formats.addItems(withTitles: ["Markdown (.md)", "PDF (.pdf)"])
                panel.accessoryView = formats
                formats.target = panel; formats.action = #selector(NSSavePanel.moyeFormatChanged(_:))
            }
            if panel.runModal() != .OK { return false }
            guard let selected = panel.url else { return false }
            if allowPdf && formats.indexOfSelectedItem == 1 { try beginPdf(doc, selected); return false }
            path = selected.path
        } else if Store.conflict(doc) {
            let alert = NSAlert(); alert.messageText = "文件已被其他程序修改"; alert.informativeText = "是否覆盖磁盘上的文件？"
            alert.addButton(withTitle: "取消"); alert.addButton(withTitle: "另存为"); alert.addButton(withTitle: "覆盖")
            let answer = alert.runModal()
            if answer == .alertFirstButtonReturn { return false }
            if answer == .alertSecondButtonReturn { return try save(index, saveAs: true, allowPdf: allowPdf) }
        }
        guard let target = path else { return false }
        if session.documents.contains(where: { $0.id != doc.id && ($0.path.map { Store.samePath($0, target) } ?? false) }) { throw Store.failure("该文件已在另一个标签打开，请选择其他文件名。") }
        doc.fingerprint = try Store.write(doc, to: target); doc.path = target; doc.baseline = doc.text; session.documents[index] = doc
        persist(); post(["type": "saved", "documentId": doc.id, "name": doc.name, "path": target, "text": doc.text])
        if doc.id == session.activeId { scheme.documentFolder = URL(fileURLWithPath: target).deletingLastPathComponent() }; title(); return true
    }
    func saveDecision(_ document: Document) -> NSApplication.ModalResponse {
        let alert = NSAlert(); alert.messageText = "是否保存对“\(document.name)”的修改？"
        alert.addButton(withTitle: "保存"); alert.addButton(withTitle: "取消"); alert.addButton(withTitle: "不保存")
        return alert.runModal()
    }
    func confirmSave(_ index: Int) throws -> Bool {
        if !session.documents[index].dirty { return true }
        let answer = saveDecision(session.documents[index])
        if answer == .alertSecondButtonReturn { return false }
        if answer == .alertThirdButtonReturn { return true }
        return try save(index, saveAs: false, allowPdf: false)
    }
    func choosePdf(_ document: Document) throws {
        if pdfRequest != nil { notice("上一份 PDF 正在导出，请稍候。"); return }
        let panel = NSSavePanel(); panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = URL(fileURLWithPath: document.name).deletingPathExtension().lastPathComponent + ".pdf"
        if panel.runModal() == .OK, let url = panel.url { try beginPdf(document, url) }
    }
    func beginPdf(_ document: Document, _ target: URL) throws {
        if pdfRequest != nil { throw Store.failure("上一份 PDF 正在导出，请稍候。") }
        if session.documents.contains(where: { $0.path.map { Store.samePath($0, target.path) } ?? false }) { throw Store.failure("PDF 不能覆盖打开的源文件。") }
        let id = UUID().uuidString
        pdfRequest = (id, document.id, document.path.map { URL(fileURLWithPath: $0).deletingLastPathComponent() }, target)
        post(["type": "requestExportPdf", "requestId": id, "documentId": document.id, "name": document.name, "text": document.text])
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
            if self.pdfRequest?.id == id && self.pdfExporter == nil { self.pdfRequest = nil; self.notice("PDF 排版超时。", error: true) }
        }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { if confirmedClose { return true }; requestClose(false); return false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if confirmedClose || !ready { return .terminateNow }
        requestClose(true); return .terminateCancel
    }
    func requestClose(_ application: Bool) {
        if pdfRequest != nil { notice("PDF 正在导出，请稍候再退出。"); return }
        if closingRequest != nil { return }
        closingApplication = application; closingRequest = UUID().uuidString
        post(["type": "requestClosingText", "requestId": closingRequest!])
    }
    func finishClose() throws {
        defer { closingRequest = nil }
        var decisions: [(String, NSApplication.ModalResponse)] = []
        for doc in session.documents where doc.dirty {
            let answer = saveDecision(doc)
            if answer == .alertSecondButtonReturn { return }
            decisions.append((doc.id, answer))
        }
        for (id, answer) in decisions where answer == .alertFirstButtonReturn {
            if let index = session.documents.firstIndex(where: { $0.id == id }), try !save(index, saveAs: false, allowPdf: false) { return }
        }
        for (id, answer) in decisions where answer == .alertThirdButtonReturn {
            guard let index = session.documents.firstIndex(where: { $0.id == id }) else { continue }
            if session.documents[index].path == nil { remove(id) } else { session.documents[index].text = session.documents[index].baseline }
        }
        persist(); confirmedClose = true; NSApp.terminate(nil)
    }
    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        if !ready { queuedPaths.append(contentsOf: filenames) }
        else { do { for path in filenames { try openPath(path) }; publish(); persist(); window.makeKeyAndOrderFront(nil) } catch { notice(error.localizedDescription, error: true) } }
        sender.reply(toOpenOrPrint: .success)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.scheme == "moye" && navigationAction.request.url?.host == "app" ? .allow : .cancel)
    }
}

extension NSSavePanel {
    @objc func moyeFormatChanged(_ sender: NSPopUpButton) {
        let ext = sender.indexOfSelectedItem == 1 ? "pdf" : "md"
        allowedContentTypes = [.init(filenameExtension: ext)!]
        nameFieldStringValue = URL(fileURLWithPath: nameFieldStringValue).deletingPathExtension().lastPathComponent + "." + ext
    }
}

@main
enum MoyeMain {
    static func main() {
        if CommandLine.arguments.contains("--self-test") {
            do { try runStoreTests(); exit(0) } catch { fputs("FAIL \(error)\n", stderr); exit(1) }
        }
        let application = NSApplication.shared, delegate = AppDelegate()
        application.setActivationPolicy(.regular); application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }
}
