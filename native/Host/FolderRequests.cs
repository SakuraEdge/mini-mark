using System.Text.Json;
using System.Windows.Forms;

namespace Moye;

public sealed partial class MainWindow {
    private readonly SemaphoreSlim folderChanges = new(1, 1);
    private async Task FolderRequest(JsonElement message) {
        var requestId = message.TryGetProperty("requestId", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        if (string.IsNullOrEmpty(requestId)) return;
        try {
            // Native dialogs must be opened after the WebView message callback has returned.
            await Task.Yield();
            var action = message.GetProperty("action").GetString();
            if (action == "list") {
                var rootId = message.GetProperty("rootId").GetString() ?? "";
                var path = message.TryGetProperty("path", out var pathValue) ? pathValue.GetString() ?? "" : "";
                var offset = message.TryGetProperty("offset", out var offsetValue) ? offsetValue.GetInt32() : 0;
                var listing = await Task.Run(() => folders.List(rootId, path, offset));
                folders.EnsureCurrent(rootId);
                Post(new { type = "folderResponse", requestId, data = listing });
                return;
            }
            await folderChanges.WaitAsync();
            try {
                FolderRoot? root;
                switch (action) {
                    case "choose":
                        using (var dialog = new FolderBrowserDialog { Description = "选择工作区文件夹", UseDescriptionForTitle = true, ShowNewFolderButton = false }) {
                            if (dialog.ShowDialog(this) != DialogResult.OK) {
                                Post(new { type = "folderResponse", requestId, data = new { cancelled = true } });
                                return;
                            }
                            var selectedPath = dialog.SelectedPath;
                            root = await Task.Run(() => folders.SelectRoot(selectedPath));
                        }
                        break;
                    case "restore": root = await Task.Run(folders.Restore); break;
                    case "close":
                        await Task.Run(folders.Close);
                        Post(new { type = "folderResponse", requestId, data = new FolderListing(null, "", []) });
                        return;
                    default: throw new IOException("未知的工作区操作。");
                }
                var result = root is null ? new FolderListing(null, "", []) : await Task.Run(() => folders.List(root.Id));
                if (root is not null) folders.EnsureCurrent(root.Id);
                Post(new { type = "folderResponse", requestId, data = result });
            } finally { folderChanges.Release(); }
        } catch (Exception error) {
            Post(new { type = "folderResponse", requestId, error = error is IOException ? error.Message : "无法读取工作区，请检查文件夹权限后重试。" });
        }
    }

    private async Task OpenWorkspaceFile(string rootId, string path) {
        var loaded = await Task.Run(() => folders.Read(rootId, path));
        folders.OpenInto(workspace, rootId, loaded);
        Publish(); Persist();
    }
}
