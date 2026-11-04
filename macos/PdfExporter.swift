import AppKit
import WebKit

final class PdfExporter: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private var completion: ((Error?) -> Void)?
    private var target: URL!
    private var timeout: DispatchWorkItem?
    private weak var owner: NSWindow?
    private var temporary: URL?
    private var operation: NSPrintOperation?
    func export(html: String, folder: URL?, to target: URL, owner: NSWindow, completion: @escaping (Error?) -> Void) {
        self.target = target; self.completion = completion
        self.owner = owner
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
        guard completion != nil, let target = target, let owner = owner else { return }
        let temporary = target.deletingLastPathComponent().appendingPathComponent(".moye-\(UUID().uuidString).pdf")
        self.temporary = temporary
        let info = NSPrintInfo()
        info.paperSize = NSSize(width: 595.28, height: 841.89)
        info.topMargin = 43.2; info.bottomMargin = 43.2; info.leftMargin = 43.2; info.rightMargin = 43.2
        info.horizontalPagination = .fit; info.verticalPagination = .automatic
        info.isHorizontallyCentered = false; info.isVerticallyCentered = false
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = temporary
        let operation = web.printOperation(with: info)
        self.operation = operation
        operation.showsPrintPanel = false; operation.showsProgressPanel = false
        // WebKit needs the main event loop while collecting printable page data.
        operation.runModal(for: owner, delegate: self, didRun: #selector(printFinished(_:success:contextInfo:)), contextInfo: nil)
    }
    @objc private func printFinished(_ operation: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        // AppKit still owns the printing view during this delegate call.
        // Dispose the WKWebView only after AppKit finishes unwinding it.
        DispatchQueue.main.async { [self, operation] in
            _ = operation
            completePrint(success)
        }
    }
    private func completePrint(_ success: Bool) {
        guard completion != nil, let temporary = temporary, let target = target else { return }
        guard success else { finish(Store.failure("PDF 打印失败。")); return }
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
        if let temporary = temporary { try? FileManager.default.removeItem(at: temporary) }
        operation = nil; temporary = nil
        callback(error)
    }
}
