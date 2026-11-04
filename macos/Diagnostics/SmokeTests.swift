import AppKit
import WebKit
import PDFKit

func runStoreTests() throws {
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
    print("PASS macOS storage: UTF-8, BOM, CRLF, conflict, two-document recovery")
}

extension AppDelegate {
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
    func finishSmokePdf(_ error: Error?) {
        if let error = error { smokeFinish(error); return }
        guard let output = smokeOutput, let pdf = PDFDocument(url: output.appendingPathComponent("macos-export.pdf")), pdf.pageCount > 1, pdf.string?.contains("macOS 验证") == true else { smokeFinish(Store.failure("Paginated PDF failed")); return }
        do {
            let data = try Data(contentsOf: root.appendingPathComponent("index.html"))
            guard !data.isEmpty else { throw Store.failure("Missing resources") }
            try "PASS macOS native editor, math, two tabs, persistence, UTF-8 save, \(pdf.pageCount)-page PDF\n".write(to: output.appendingPathComponent("result.txt"), atomically: true, encoding: .utf8)
            smokeFinish(nil)
        } catch { smokeFinish(error) }
    }
    func smokeFinish(_ error: Error?) {
        confirmedClose = true
        if let error = error {
            fputs("FAIL \(error.localizedDescription)\n", stderr)
            if let output = smokeOutput { try? error.localizedDescription.write(to: output.appendingPathComponent("error.txt"), atomically: true, encoding: .utf8) }
            exit(1)
        }
        print("PASS macOS native smoke")
        NSApp.terminate(nil)
    }
}
