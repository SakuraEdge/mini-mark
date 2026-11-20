using System.IO;
using System.Text;
using System.Text.Json;

namespace Moye;

public sealed partial class MainWindow {
    private void HandleEncoding(JsonElement message) {
        var requestId = message.GetProperty("requestId").GetString();
        var documentId = message.GetProperty("documentId").GetString();
        try {
            var doc = workspace.Active;
            if (busy || closingRequest is not null || doc.Id != documentId || doc.Cloud is not null ||
                doc.Revision != message.GetProperty("revision").GetInt64() || doc.Text != message.GetProperty("text").GetString())
                throw new IOException("文档状态已改变，请重新打开编码面板。");
            var action = message.GetProperty("action").GetString();
            var encoding = message.GetProperty("encoding").GetString() ?? "";
            string preview;
            switch (action) {
                case "previewRead": case "switch":
                    if (doc.Path is null || doc.Dirty) throw new IOException("请先保存修改，再切换查看编码。");
                    var loaded = DocumentStore.Read(doc.Path, encoding);
                    if (loaded.Fingerprint != doc.Fingerprint) throw new IOException("磁盘文件已改变，请重新打开。");
                    preview = loaded.Text;
                    if (action == "switch") doc.Load(loaded);
                    break;
                case "previewConvert": case "convert":
                    if (doc.NeedsEncoding) throw new IOException("请先选择能正确读取正文的编码。");
                    if (doc.Path is not null && DocumentStore.HasConflict(doc.Path, doc.Fingerprint)) throw new IOException("磁盘文件已改变，请重新打开。");
                    FileEncoding.Encode(doc.Text, encoding, encoding != doc.CurrentEncoding || doc.Bom, doc.Newline);
                    preview = doc.Text;
                    if (action == "convert") doc.PendingEncoding = encoding == doc.CurrentEncoding ? null : encoding;
                    break;
                default: throw new IOException("未知的编码操作。");
            }
            if (action is "switch" or "convert") { Persist(); Publish(); }
            Post(new { type = "encodingResponse", requestId, documentId, preview = preview[..Math.Min(1000, preview.Length)] });
        } catch (Exception error) {
            var hint = error is DecoderFallbackException ? "所选编码无法读取完整文件。" : error.Message;
            Post(new { type = "encodingResponse", requestId, documentId, error = hint });
        }
    }
}
