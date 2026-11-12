using System.Text.Json;

namespace Moye;

public sealed partial class MainWindow {
    private async Task CloudRequest(JsonElement message) {
        var requestId = message.GetProperty("requestId").GetString();
        try { Post(new { type = "cloudResponse", requestId, data = await cloud.Execute(message) }); }
        catch (Exception error) { Post(new { type = "cloudResponse", requestId, error = CloudError(error) }); }
    }
    private static string CloudError(Exception error) => error is OperationCanceledException
        ? "GitHub 连接超时，文档尚未同步，请稍后重试。"
        : error is System.Net.Http.HttpRequestException ? "无法连接 GitHub，请检查网络。文档尚未同步。" : error.Message;
    private async Task OpenCloud(string owner, string path) {
        CloudPaths.Validate(path);
        var existing = workspace.Documents.Find(item => item.Cloud is not null &&
            item.Cloud.Owner.Equals(owner, StringComparison.OrdinalIgnoreCase) && item.Cloud.Path == path);
        if (existing is not null) { workspace.Activate(existing.Id); Publish(); return; }
        var file = await cloud.Read(owner, path);
        var document = workspace.AddNew(file.Text, path.Split('/')[^1]);
        document.Cloud = new(owner, path, file.Sha, file.Text);
        Publish(); Persist();
    }
    private async Task BindCloud(OpenDocument document, string owner, string path) {
        CloudPaths.Validate(path);
        if (workspace.Documents.Any(item => item.Id != document.Id && item.Cloud?.Owner.Equals(owner, StringComparison.OrdinalIgnoreCase) == true && item.Cloud.Path == path))
            throw new IOException("该云文档已在其他标签打开。");
        if (document.Cloud is not null) throw new IOException("请先切换为本地文档，再选择新的云端位置。");
        var text = document.Text;
        var saved = await cloud.Write(owner, path, text, null);
        document.Cloud = new(owner, path, saved.Sha, text);
        Publish(); Persist();
    }
    private async Task SaveCloud(OpenDocument document) {
        var binding = document.Cloud ?? throw new IOException("当前不是云文档。");
        var text = document.Text;
        var saved = await cloud.Write(binding.Owner, binding.Path, text, binding.Sha);
        if (workspace.Find(document.Id) != document || document.Cloud != binding) throw new IOException("文档状态已改变，请核对云端保存结果。");
        document.Cloud = binding with { Sha = saved.Sha, Baseline = text };
        Persist();
        Post(new { type = "saved", documentId = document.Id, name = document.Name, path = document.Path, cloud = document.Cloud, text });
        UpdateTitle();
    }
    private async Task<bool> SaveForClose(OpenDocument document) {
        if (document.Cloud is null) return Save(document, false, false);
        await SaveCloud(document); return true;
    }
}
