import AppKit
import WebKit
import UniformTypeIdentifiers

final class HtmlResourceScheme: NSObject, WKURLSchemeHandler {
    let folder: URL
    let host: String
    init(folder: URL, host: String) { self.folder = folder.standardizedFileURL; self.host = host }
    static let extensions = ["html", "htm", "css", "js", "mjs", "json", "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "woff", "woff2", "ttf", "mp3", "mp4", "webm", "wasm"]
    func resource(_ url: URL) throws -> (Data, String) {
        guard url.host == host, url.scheme == "minimark-preview" else { throw Store.failure("Invalid preview origin") }
        let path = url.path
        guard !path.contains("\\"), !path.contains(":"), !path.contains("\0"),
              !path.split(separator: "/").contains("..") else { throw Store.failure("Invalid resource path") }
        let file = folder.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        let realFolder = folder.resolvingSymlinksInPath()
        let realFile = file.resolvingSymlinksInPath()
        guard realFile.path.hasPrefix(realFolder.path + "/"), Self.extensions.contains(file.pathExtension.lowercased()),
              file.path == realFile.path || file.path.replacingOccurrences(of: "/var/", with: "/private/var/") == realFile.path else { throw Store.failure("Resource outside preview folder") }
        let attributes = try FileManager.default.attributesOfItem(atPath: realFile.path)
        guard ((attributes[.size] as? NSNumber)?.intValue ?? Int.max) <= 20 * 1024 * 1024 else { throw Store.failure("Resource too large") }
        let type = ["js", "mjs"].contains(file.pathExtension.lowercased()) ? "text/javascript" : UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return (try Data(contentsOf: realFile), type)
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        do {
            guard let url = task.request.url, task.request.httpMethod == "GET" else { throw Store.failure("Invalid resource request") }
            let (data, type) = try resource(url)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"])!
            task.didReceive(response); task.didReceive(data); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class HtmlPreview: NSWindowController, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    let web: WKWebView
    let scheme: HtmlResourceScheme
    var closed: (() -> Void)?
    init(file: URL) {
        let host = UUID().uuidString.lowercased()
        scheme = HtmlResourceScheme(folder: file.deletingLastPathComponent(), host: host)
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(scheme, forURLScheme: "minimark-preview")
        web = WKWebView(frame: .zero, configuration: config)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1050, height: 760), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init(window: window)
        window.title = file.lastPathComponent + " · HTML 预览"; window.center(); window.delegate = self
        let container = NSView(frame: window.contentView!.bounds)
        let reload = NSButton(title: "重新运行", target: self, action: #selector(refresh))
        reload.frame = NSRect(x: 12, y: container.bounds.height - 36, width: 100, height: 28)
        reload.autoresizingMask = [.minYMargin]
        web.frame = NSRect(x: 0, y: 0, width: container.bounds.width, height: container.bounds.height - 44)
        web.autoresizingMask = [.width, .height]
        container.addSubview(web); container.addSubview(reload); window.contentView = container
        web.navigationDelegate = self; web.uiDelegate = self
        var components = URLComponents(); components.scheme = "minimark-preview"; components.host = host; components.path = "/" + file.lastPathComponent
        web.load(URLRequest(url: components.url!))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    @objc func refresh() { web.reload() }
    func windowWillClose(_ notification: Notification) { web.stopLoading(); closed?() }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        let allowed = (url?.scheme == "minimark-preview" && url?.host == scheme.host) || ["https", "http", "about", "data", "blob"].contains(url?.scheme ?? "")
        decisionHandler(allowed && action.targetFrame != nil ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { completionHandler(false) }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) { completionHandler(nil) }
}
