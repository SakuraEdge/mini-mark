using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Moye;

public sealed class MainWindow : Form {
    private readonly WebView2 browser = new();
    private readonly string root = System.IO.Path.Combine(AppContext.BaseDirectory, "wwwroot");
    private readonly string dataRoot;
    private readonly string draftFile;
    private readonly string[] args;
    private readonly System.Windows.Forms.Timer draftTimer = new() { Interval = 700 };
    private string text = "";
    private string baseline = "";
    private string? path;
    private string? fingerprint;
    private string newline = "\n";
    private bool bom;
    private bool initialized;
    private bool closingConfirmed;
    private bool closePending;
    private bool busy;
    private bool recovered;
    private bool draftErrorShown;
    private bool discardConfirmed;
    private string documentId = Guid.NewGuid().ToString("N");
    private readonly Queue<string[]> pendingOpen = new();
    private readonly Dictionary<string, double> timings = new();

    public MainWindow(string[] arguments) {
        args = arguments;
        dataRoot = Environment.GetEnvironmentVariable("MOYE_DATA_DIR") ?? System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Moye");
        Directory.CreateDirectory(dataRoot);
        draftFile = System.IO.Path.Combine(dataRoot, "draft.json");
        Text = "墨页 Moye";
        Width = 1180; Height = 840; MinimumSize = new Size(720, 520);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        browser.DefaultBackgroundColor = System.Drawing.Color.White;
        browser.Dock = DockStyle.Fill;
        Controls.Add(browser);
        Shown += async (_, _) => {
            var scale = DeviceDpi / 96.0;
            var area = Screen.FromHandle(Handle).WorkingArea;
            Size = new Size(Math.Min((int)(1180 * scale), area.Width - 48), Math.Min((int)(840 * scale), area.Height - 48));
            MinimumSize = new Size((int)(720 * scale), (int)(520 * scale));
            CenterToScreen();
            await Initialize();
        };
        FormClosing += OnClosing;
        FormClosed += (_, _) => { draftTimer.Stop(); draftTimer.Dispose(); browser.Dispose(); };
        draftTimer.Tick += (_, _) => { draftTimer.Stop(); PersistDraft(); };
    }

    private async Task Initialize() {
        try {
            timings["windowLoaded"] = Program.Startup.Elapsed.TotalMilliseconds;
            if (!File.Exists(System.IO.Path.Combine(root, "index.html"))) throw new IOException("找不到编辑器资源。请保留 Moye.exe 和 wwwroot 文件夹在同一目录。");
            var environment = await CoreWebView2Environment.CreateAsync(null, System.IO.Path.Combine(dataRoot, "WebView2"));
            timings["environmentCreated"] = Program.Startup.Elapsed.TotalMilliseconds;
            await browser.EnsureCoreWebView2Async(environment);
            timings["webViewInitialized"] = Program.Startup.Elapsed.TotalMilliseconds;
            var core = browser.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("moye.local", root, CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("MOYE_DEVTOOLS") == "1";
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.NavigationStarting += (_, e) => {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "moye.local") e.Cancel = true;
            };
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => {
                if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) &&
                    ((uri.Scheme is "https" or "http" && !(uri.Scheme == "https" && uri.Host is "moye.local" or "document.moye.local")) ||
                    (uri.Host == "document.moye.local" && e.ResourceContext != CoreWebView2WebResourceContext.Image))) {
                    e.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Offline document", "Content-Type: text/plain");
                }
            };
            core.WebMessageReceived += Receive;
            browser.Source = new Uri("https://moye.local/index.html");
        } catch (WebView2RuntimeNotFoundException) {
            ShowError("需要 Microsoft Edge WebView2 Runtime。\n请从 Microsoft 官网安装 Evergreen Runtime 后重新打开墨页。");
        } catch (Exception exception) {
            ShowError(exception.Message);
        }
    }

    private void ShowError(string message) {
        Controls.Clear();
        Controls.Add(new Label { Text = message, Dock = DockStyle.Fill, Padding = new Padding(48), Font = new Font("Microsoft YaHei UI", 14) });
    }

    private void Receive(object? sender, CoreWebView2WebMessageReceivedEventArgs e) {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || source.Host != "moye.local" || source.Scheme != "https") return;
        try {
            using var json = JsonDocument.Parse(e.WebMessageAsJson);
            var message = json.RootElement;
            var type = message.GetProperty("type").GetString();
            if (type != "ready" && (!message.TryGetProperty("documentId", out var id) || id.GetString() != documentId)) return;
            if (busy || (closePending && type != "closingText") || (type == "closingText" && !closePending)) return;
            if (type is "edit" or "save" or "saveAs" or "new" or "open" or "closingText") {
                if (!message.TryGetProperty("text", out var value) || value.ValueKind != JsonValueKind.String) return;
                text = value.GetString()!;
            }
            switch (type) {
                case "ready":
                    if (initialized) return;
                    initialized = true;
                    timings["rendererConnected"] = Program.Startup.Elapsed.TotalMilliseconds;
                    try { Restore(); }
                    catch (Exception exception) { ResetDocument(); Post(new { type = "error", message = exception.Message }); }
                    PublishDocument();
                    break;
                case "rendered":
                    RecordStartup(message);
                    break;
                case "edit":
                    Text = $"{(text != baseline ? "• " : "")}{DisplayName} · 墨页";
                    draftTimer.Stop(); draftTimer.Start();
                    break;
                case "save": RunOnce(() => Save(false)); break;
                case "saveAs": RunOnce(() => Save(true)); break;
                case "new": RunOnce(() => { if (ConfirmDiscard()) { ResetDocument(); PublishDocument(); PersistDraft(); } }); break;
                case "open": RunOnce(Open); break;
                case "exportHtml":
                    var html = message.GetProperty("html").GetString()!;
                    RunOnce(() => ExportHtml(html));
                    break;
                case "openExternal": OpenExternal(message.GetProperty("url").GetString()); break;
                case "closingText":
                    RunOnce(() => {
                        closePending = false;
                        if (ConfirmDiscard()) { if (discardConfirmed) text = baseline; closingConfirmed = true; PersistDraft(); Close(); }
                    });
                    break;
            }
        } catch (Exception exception) { Post(new { type = "error", message = exception.Message }); }
    }

    private void RunOnce(Action action) {
        if (busy) return;
        busy = true;
        // Native modal dialogs must run after the WebView2 callback returns.
        BeginInvoke(() => {
            try { action(); }
            catch (Exception exception) { if (!IsDisposed) Post(new { type = "error", message = exception.Message }); }
            finally {
                busy = false;
                if (!IsDisposed && pendingOpen.TryDequeue(out var arguments)) BeginInvoke(() => OpenFromArguments(arguments));
            }
        });
    }

    public void OpenFromArguments(string[] arguments) {
        if (!initialized || busy || closePending) {
            pendingOpen.Enqueue(arguments);
            if (!initialized) {
                var retry = new System.Windows.Forms.Timer { Interval = 250 };
                retry.Tick += (_, _) => { if (initialized) { retry.Stop(); retry.Dispose(); if (pendingOpen.TryDequeue(out var next)) OpenFromArguments(next); } };
                retry.Start();
            }
            return;
        }
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show(); Activate();
        var file = arguments.FirstOrDefault(argument => !argument.StartsWith("--", StringComparison.Ordinal));
        if (file is null) return;
        RunOnce(() => {
            try { if (ConfirmDiscard()) { LoadFile(file); PublishDocument(); PersistDraft(); } }
            catch (Exception exception) { Post(new { type = "error", message = exception.Message }); }
        });
    }

    private void Restore() {
        var requested = args.FirstOrDefault(argument => !argument.StartsWith("--", StringComparison.Ordinal));
        var draft = DocumentStore.ReadDraft(draftFile);
        if (draft is not null && draft.Text != draft.Baseline) {
            path = draft.Path; text = draft.Text; baseline = draft.Baseline; fingerprint = draft.Fingerprint; bom = draft.Bom; newline = draft.Newline; recovered = true;
            if (requested is not null) Post(new { type = "notice", message = "已优先恢复未保存草稿，请保存后再打开其他文件。" });
            return;
        }
        if (requested is not null) { LoadFile(requested); return; }
        if (draft?.Path is string previous && File.Exists(previous)) { LoadFile(previous); return; }
        text = File.ReadAllText(System.IO.Path.Combine(root, "welcome.md"));
        baseline = text;
    }

    private void ResetDocument() { text = baseline = ""; path = fingerprint = null; bom = false; newline = "\n"; }

    private void LoadFile(string file) {
        var loaded = DocumentStore.Read(file);
        path = loaded.Path; text = baseline = loaded.Text; fingerprint = loaded.Fingerprint; bom = loaded.Bom; newline = loaded.Newline;
    }

    private string DisplayName => path is null ? "未命名.md" : System.IO.Path.GetFileName(path);

    private void PublishDocument() {
        documentId = Guid.NewGuid().ToString("N");
        var core = browser.CoreWebView2;
        core.ClearVirtualHostNameToFolderMapping("document.moye.local");
        if (path is not null) core.SetVirtualHostNameToFolderMapping("document.moye.local", System.IO.Path.GetDirectoryName(path)!, CoreWebView2HostResourceAccessKind.DenyCors);
        Post(new { type = "document", documentId, document = new { text, baseline, name = DisplayName, path, saved = text == baseline, recovered } });
        recovered = false;
        Text = $"{(text != baseline ? "• " : "")}{DisplayName} · 墨页";
    }

    private void Open() {
        if (!ConfirmDiscard()) return;
        var dialog = new OpenFileDialog { Filter = "Markdown 文档|*.md;*.markdown;*.mdown;*.txt|所有文件|*.*", CheckFileExists = true };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        LoadFile(dialog.FileName); PublishDocument(); PersistDraft();
    }

    private bool Save(bool saveAs) {
        var target = path;
        if (target is null || saveAs) {
            var dialog = new SaveFileDialog { Filter = "Markdown 文档|*.md|文本文件|*.txt", DefaultExt = ".md", FileName = DisplayName, AddExtension = true };
            if (dialog.ShowDialog(this) != DialogResult.OK) return false;
            target = dialog.FileName;
        } else if (DocumentStore.HasConflict(target, fingerprint)) {
            var answer = MessageBox.Show(this, "文件已被其他程序修改或删除。\n是：覆盖磁盘文件；否：另存为；取消：继续编辑。", "文件发生变化", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
            if (answer == DialogResult.Cancel) return false;
            if (answer == DialogResult.No) return Save(true);
        }
        var savedText = text;
        fingerprint = DocumentStore.Write(target, savedText, bom, newline);
        path = target; baseline = savedText;
        browser.CoreWebView2.ClearVirtualHostNameToFolderMapping("document.moye.local");
        browser.CoreWebView2.SetVirtualHostNameToFolderMapping("document.moye.local", System.IO.Path.GetDirectoryName(path)!, CoreWebView2HostResourceAccessKind.DenyCors);
        PersistDraft();
        Post(new { type = "saved", documentId, name = DisplayName, path, text = savedText });
        Text = $"{DisplayName} · 墨页";
        return true;
    }

    private bool ConfirmDiscard() {
        discardConfirmed = false;
        if (text == baseline) return true;
        var answer = MessageBox.Show(this, $"是否保存对“{DisplayName}”的修改？", "墨页", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
        if (answer == DialogResult.Yes) return Save(false);
        if (answer == DialogResult.Cancel) return false;
        discardConfirmed = true;
        return true;
    }

    private void PersistDraft() {
        if (!initialized) return;
        try { DocumentStore.SaveDraft(draftFile, new Draft(path, text, baseline, fingerprint, bom, newline)); }
        catch (Exception exception) {
            if (!draftErrorShown) { Post(new { type = "error", message = $"草稿备份失败，请手动保存：{exception.Message}" }); draftErrorShown = true; }
        }
    }

    private void OnClosing(object? sender, FormClosingEventArgs e) {
        if (closingConfirmed || !initialized) return;
        e.Cancel = true;
        if (closePending || busy) return;
        closePending = true;
        // Ask the renderer for its current text, including the last debounce interval.
        Post(new { type = "requestClosingText" });
    }

    private void ExportHtml(string html) {
        var dialog = new SaveFileDialog { Filter = "HTML 文档|*.html", DefaultExt = ".html", FileName = System.IO.Path.GetFileNameWithoutExtension(DisplayName) + ".html" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        DocumentStore.AtomicWrite(dialog.FileName, new UTF8Encoding(false).GetBytes(html));
        Post(new { type = "notice", message = "HTML 已导出（公式字体已内嵌）" });
    }

    private static void OpenExternal(string? value) {
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https") Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private void RecordStartup(JsonElement message) {
        var file = Environment.GetEnvironmentVariable("MOYE_DIAGNOSTICS_PATH");
        if (file is null) return;
        File.WriteAllText(file, JsonSerializer.Serialize(new { startupMilliseconds = Program.Startup.Elapsed.TotalMilliseconds, rendererMilliseconds = message.GetProperty("elapsed").GetDouble(), browserProcessId = browser.CoreWebView2.BrowserProcessId, timings, utc = DateTime.UtcNow }));
        if (args.Contains("--benchmark")) { closingConfirmed = true; BeginInvoke(Close); }
    }

    private void Post(object message) => browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
}
