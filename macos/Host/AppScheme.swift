import AppKit
import WebKit
import UniformTypeIdentifiers

final class AppScheme: NSObject, WKURLSchemeHandler {
    let root: URL
    var documentFolder: URL?
    init(root: URL) { self.root = root }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        do {
            guard let url = task.request.url, url.scheme == "moye" else { throw Store.failure("Invalid resource") }
            let localImage = url.host == "document"
            guard url.host == "app" || localImage, let base = localImage ? documentFolder : root else { throw Store.failure("Resource unavailable") }
            let path = url.path.removingPercentEncoding ?? url.path
            let file = base.appendingPathComponent(path == "/" ? "index.html" : String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
            let folder = base.standardizedFileURL.resolvingSymlinksInPath().path + "/"
            guard file.path.hasPrefix(folder) else { throw Store.failure("Resource outside document folder") }
            let ext = file.pathExtension.lowercased()
            if localImage && !["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "tiff"].contains(ext) { throw Store.failure("Image resource only") }
            let type = ext == "js" ? "text/javascript" : UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
            let data = try Data(contentsOf: file)
            let pluginHost = url.host == "app" && url.path == "/plugin-host.html"
            let policy = pluginHost
                ? "default-src 'none'; script-src 'self' moye://app blob:; worker-src blob:; child-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none';"
                : "default-src 'self' data: blob: moye:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' moye: data: blob: https:; connect-src 'self' moye:;"
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type, "Access-Control-Allow-Origin": "*", "Content-Length": String(data.count), "Content-Security-Policy": policy])!
            task.didReceive(response); task.didReceive(data); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

let bridgeScript = """
(() => {
  const listeners = [];
  window.chrome = { webview: {
    addEventListener: (type, callback) => { if (type === 'message') listeners.push(callback); },
    postMessage: message => window.webkit.messageHandlers.bridge.postMessage(message)
  }};
  window.__moyeReceive = data => listeners.forEach(callback => callback({ data }));
  if (!crypto.randomUUID) crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    return [...b].map((v,i) => ([4,6,8,10].includes(i) ? '-' : '') + v.toString(16).padStart(2,'0')).join('');
  };
})();
"""
