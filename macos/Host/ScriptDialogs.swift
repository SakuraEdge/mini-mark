import AppKit
import WebKit

final class ScriptConfirmation {
    let alert: NSAlert
    private var completion: ((Bool) -> Void)?
    init(message: String, completion: @escaping (Bool) -> Void) {
        alert = NSAlert(); alert.messageText = "Mini Mark"; alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "取消").keyEquivalent = "\r"
        alert.addButton(withTitle: "确定").keyEquivalent = ""
        self.completion = completion
    }
    func resolve(_ confirmed: Bool) {
        let callback = completion; completion = nil
        callback?(confirmed)
    }
}

extension AppDelegate: WKUIDelegate {
    static func trustedAppFrame(_ frame: WKFrameInfo) -> Bool {
        guard frame.isMainFrame, let url = frame.request.url else { return false }
        return url.scheme == "moye" && url.host == "app" && url.path == "/index.html"
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard webView === web, Self.trustedAppFrame(frame), window.isVisible, !confirmedClose,
              closingRequest == nil, scriptConfirmation == nil, window.attachedSheet == nil else {
            completionHandler(false); return
        }
        let pending = ScriptConfirmation(message: String(message.prefix(4000)), completion: completionHandler)
        scriptConfirmation = pending
        pending.alert.beginSheetModal(for: window) { result in
            if self.scriptConfirmation === pending { self.scriptConfirmation = nil }
            pending.resolve(result == .alertSecondButtonReturn && self.window.isVisible && !self.confirmedClose)
        }
    }
    func cancelScriptConfirmation() {
        guard let pending = scriptConfirmation else { return }
        scriptConfirmation = nil
        pending.resolve(false)
        if pending.alert.window.sheetParent != nil { window.endSheet(pending.alert.window, returnCode: .abort) }
    }
    func windowWillClose(_ notification: Notification) { cancelScriptConfirmation() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if webView === web { cancelScriptConfirmation() } }
}
