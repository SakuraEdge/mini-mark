import AppKit
import WebKit

final class PdfExporter: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private var completion: ((Error?) -> Void)?
    private var target: URL!
    private var timeout: DispatchWorkItem?
    func export(html: String, folder: URL?, to target: URL, owner: NSWindow, completion: @escaping (Error?) -> Void) {
        self.target = target; self.completion = completion
        let config = WKWebViewConfiguration()
        let scheme = AppScheme(root: folder ?? FileManager.default.temporaryDirectory); scheme.documentFolder = folder
        config.setURLSchemeHandler(scheme, forURLScheme: "moye")
        config.userContentController.add(self, name: "printReady")
        config.userContentController.addUserScript(WKUserScript(source: """
        addEventListener('load', async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
          window.webkit.messageHandlers.printReady.postMessage('ready');
        });
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: NSRect(x: -12000, y: 0, width: 794, height: 1123), configuration: config)
        web.navigationDelegate = self
        owner.contentView?.addSubview(web)
        let htmlWithBase = html.replacingOccurrences(of: "<head>", with: "<head><base href=\"moye://document/\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: moye:;\">")
        web.loadHTMLString(htmlWithBase, baseURL: URL(string: "moye://document/"))
        let timeout = DispatchWorkItem { [weak self] in self?.finish(Store.failure("PDF 排版超时。")) }
        self.timeout = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard completion != nil else { return }
        DispatchQueue.main.async { [weak self] in self?.printDocument() }
    }
    private func printDocument() {
        guard completion != nil, let target = target else { return }
        let temporary = target.deletingLastPathComponent().appendingPathComponent(".moye-\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: temporary) }
        let info = NSPrintInfo()
        info.paperSize = NSSize(width: 595.28, height: 841.89)
        info.topMargin = 43.2; info.bottomMargin = 43.2; info.leftMargin = 43.2; info.rightMargin = 43.2
        info.horizontalPagination = .fit; info.verticalPagination = .automatic
        info.isHorizontallyCentered = false; info.isVerticallyCentered = false
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = temporary
        let operation = web.printOperation(with: info)
        operation.showsPrintPanel = false; operation.showsProgressPanel = false
        guard operation.run() else { finish(Store.failure("PDF 打印失败。")); return }
        do {
            let data = try Data(contentsOf: temporary)
            guard data.starts(with: Data("%PDF-".utf8)) else { throw Store.failure("未生成有效 PDF。") }
            try data.write(to: target, options: .atomic); finish(nil)
        } catch { finish(error) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(error) }
    private func finish(_ error: Error?) {
        guard let callback = completion else { return }
        completion = nil; timeout?.cancel()
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "printReady")
        web?.removeFromSuperview(); web = nil
        callback(error)
    }
}
