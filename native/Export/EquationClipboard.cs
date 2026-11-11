using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace Moye;

public static class EquationClipboard {
    public const string MathNamespace = "http://www.w3.org/1998/Math/MathML";
    public const string OfficeNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/math";

    public static string ValidateXml(string value, string rootName, string ns) {
        if (value.Length is 0 or > 1000000) throw new IOException("公式数据过大或为空。");
        using var reader = XmlReader.Create(new StringReader(value), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 1000000 });
        var root = XElement.Load(reader);
        if (root.Name != XName.Get(rootName, ns) || root.DescendantsAndSelf().Any(element => element.Name.NamespaceName != ns))
            throw new IOException("公式格式无效。");
        return root.ToString(SaveOptions.DisableFormatting);
    }

    public static string HtmlFragment(string omml) {
        var body = omml.Replace(OfficeNamespace, "http://schemas.microsoft.com/office/2004/12/omml", StringComparison.Ordinal);
        return $"<html xmlns:m=\"http://schemas.microsoft.com/office/2004/12/omml\"><head><meta charset=\"utf-8\"></head><body><!--StartFragment--><p>{body}</p><!--EndFragment--></body></html>";
    }

    public static string ClipboardHtml(string html) {
        const string template = "Version:1.0\r\nStartHTML:{0:D10}\r\nEndHTML:{1:D10}\r\nStartFragment:{2:D10}\r\nEndFragment:{3:D10}\r\n";
        var headerSize = Encoding.UTF8.GetByteCount(string.Format(template, 0, 0, 0, 0));
        var start = html.IndexOf("<!--StartFragment-->", StringComparison.Ordinal) + "<!--StartFragment-->".Length;
        var end = html.IndexOf("<!--EndFragment-->", StringComparison.Ordinal);
        if (start < "<!--StartFragment-->".Length || end < start) throw new IOException("无效的公式片段。");
        return string.Format(template, headerSize, headerSize + Encoding.UTF8.GetByteCount(html),
            headerSize + Encoding.UTF8.GetByteCount(html[..start]), headerSize + Encoding.UTF8.GetByteCount(html[..end])) + html;
    }

    public static void Copy(string mathml, string omml) {
        mathml = ValidateXml(mathml, "math", MathNamespace);
        omml = ValidateXml(omml, "oMath", OfficeNamespace);
        var data = new DataObject();
        data.SetData(DataFormats.Html, false, ClipboardHtml(HtmlFragment(omml)));
        // MathML is a registered clipboard format containing null-terminated UTF-8.
        data.SetData("MathML", false, new MemoryStream(Encoding.UTF8.GetBytes(mathml + "\0")));
        data.SetData("MathML Presentation", false, new MemoryStream(Encoding.UTF8.GetBytes(mathml + "\0")));
        data.SetData(DataFormats.UnicodeText, false, mathml);
        Clipboard.SetDataObject(data, true, 5, 100);
    }
}
