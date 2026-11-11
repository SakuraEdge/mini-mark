import AppKit

enum EquationClipboard {
    static func copy(mathml: String, omml: String) throws {
        guard !mathml.isEmpty, !omml.isEmpty, mathml.utf8.count <= 1000000, omml.utf8.count <= 1000000,
              !mathml.contains("<!"), !omml.contains("<!") else { throw Store.failure("公式格式无效。") }
        let math = try XMLDocument(xmlString: mathml, options: .nodeLoadExternalEntitiesNever)
        let office = try XMLDocument(xmlString: omml, options: .nodeLoadExternalEntitiesNever)
        guard math.rootElement()?.localName == "math", math.rootElement()?.uri == "http://www.w3.org/1998/Math/MathML",
              office.rootElement()?.localName == "oMath", office.rootElement()?.uri == "http://schemas.openxmlformats.org/officeDocument/2006/math" else { throw Store.failure("公式格式无效。") }
        let fragment = omml.replacingOccurrences(of: "http://schemas.openxmlformats.org/officeDocument/2006/math", with: "http://schemas.microsoft.com/office/2004/12/omml")
        let html = "<html xmlns:m=\"http://schemas.microsoft.com/office/2004/12/omml\"><head><meta charset=\"utf-8\"></head><body><p>\(fragment)</p></body></html>"
        let item = NSPasteboardItem()
        item.setString(html, forType: .html)
        item.setString(mathml, forType: NSPasteboard.PasteboardType("public.mathml"))
        item.setString(mathml, forType: NSPasteboard.PasteboardType("com.apple.mathml"))
        item.setString(mathml, forType: .string)
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.writeObjects([item]) else { throw Store.failure("剪贴板暂时不可用，请重试。") }
    }
}
