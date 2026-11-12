using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using System.Web;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Moye;

public sealed partial class MainWindow : Form {
    private readonly WebView2 browser = new();
    private readonly string root = Path.Combine(AppContext.BaseDirectory, "wwwroot");
    private readonly string dataRoot;
    private readonly string sessionFile;
    private readonly string[] args;
    private readonly System.Windows.Forms.Timer draftTimer = new() { Interval = 700 };
    private readonly Queue<Func<Task>> actions = new();
    private readonly Queue<string[]> pendingOpen = new();
    private readonly Dictionary<string, double> timings = new();
    private DocumentWorkspace workspace = new();
    private CoreWebView2Environment? environment;
    private bool initialized, closingConfirmed, busy, persistenceBlocked, draftErrorShown, startupRecorded;
    private string? closingRequest;
    private PdfRequest? pdfRequest;
    private readonly GitHubUpdates updates;
    private readonly GitHubCloud cloud;
    private CancellationTokenSource? updateDownload;
    private DownloadedInstaller? preparedInstaller;
    public DownloadedInstaller? InstallerToRun { get; private set; }
    private sealed record PdfRequest(string Id, string DocumentId, string Name, string Text, string? SourceFolder, string Target, TaskCompletionSource<string> Html);

    public MainWindow(string[] arguments) {
        args = arguments;
        dataRoot = AppPaths.DataRoot;
        Directory.CreateDirectory(dataRoot);
        sessionFile = Path.Combine(dataRoot, "session-v2.json");
        updates = new GitHubUpdates(dataRoot);
        cloud = new GitHubCloud(new WindowsTokenStore(dataRoot), () => GitHubCloud.ReadClientId(root));
        Text = "Mini Mark";
        Width = 1180; Height = 840; MinimumSize = new Size(720, 520);
        StartPosition = FormStartPosition.CenterScreen; BackColor = Color.White;
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        browser.DefaultBackgroundColor = Color.White; browser.Dock = DockStyle.Fill; Controls.Add(browser);
        Shown += async (_, _) => {
            var scale = DeviceDpi / 96.0;
            var area = Screen.FromHandle(Handle).WorkingArea;
            Size = new Size(Math.Min((int)(1180 * scale), area.Width - 48), Math.Min((int)(840 * scale), area.Height - 48));
            MinimumSize = new Size((int)(720 * scale), (int)(520 * scale));
            CenterToScreen(); await Initialize();
        };
        FormClosing += OnClosing;
        FormClosed += (_, _) => { updateDownload?.Cancel(); draftTimer.Stop(); draftTimer.Dispose(); browser.Dispose(); };
        draftTimer.Tick += (_, _) => { draftTimer.Stop(); Persist(); };
    }

    private async Task Initialize() {
        try {
            timings["windowLoaded"] = Program.Startup.Elapsed.TotalMilliseconds;
            if (!File.Exists(Path.Combine(root, "index.html"))) throw new IOException("找不到编辑器资源。请保留 MiniMark.exe 和 wwwroot 文件夹在同一目录。");
            environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataRoot, "WebView2"));
            timings["environmentCreated"] = Program.Startup.Elapsed.TotalMilliseconds;
            await browser.EnsureCoreWebView2Async(environment);
            timings["webViewInitialized"] = Program.Startup.Elapsed.TotalMilliseconds;
            var core = browser.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("moye.local", root, CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.IsStatusBarEnabled = false; core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsZoomControlEnabled = false; core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("MOYE_DEVTOOLS") == "1";
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.NavigationStarting += (_, e) => {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "moye.local") e.Cancel = true;
            };
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => {
                if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri)) return;
                if (uri.Scheme == "https" && uri.Host == "document.moye.local") {
                    try {
                        if (e.ResourceContext != CoreWebView2WebResourceContext.Image) throw new IOException("Image resource only");
                        var token = HttpUtility.ParseQueryString(uri.Query)["document"];
                        var document = token is null ? workspace.Active : workspace.Documents.Find(item => item.Id + ":" + (item.Path ?? "") == token);
                        if (document?.Path is null) throw new IOException("Document unavailable");
                        var image = ImageAssets.ReadLocal(Path.GetDirectoryName(document.Path)!, Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/'));
                        e.Response = environment.CreateWebResourceResponse(new MemoryStream(image.Data), 200, "OK", $"Content-Type: {image.MimeType}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
                    } catch {
                        e.Response = environment.CreateWebResourceResponse(Stream.Null, 404, "Image unavailable", "Content-Type: text/plain");
                    }
                    return;
                }
                var allowed = uri.Scheme == "https" && (uri.Host == "moye.local" || uri.Host == "document.moye.local");
                var remoteImage = uri.Scheme == "https" && e.ResourceContext == CoreWebView2WebResourceContext.Image;
                if (((uri.Scheme == "https" || uri.Scheme == "http") && !allowed && !remoteImage) ||
                    (uri.Host == "document.moye.local" && e.ResourceContext != CoreWebView2WebResourceContext.Image))
                    e.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Offline document", "Content-Type: text/plain");
            };
            core.WebMessageReceived += Receive;
            browser.Source = new Uri("https://moye.local/index.html");
        } catch (Exception exception) {
            Controls.Clear();
            var message = exception is WebView2RuntimeNotFoundException ? "需要 Microsoft Edge WebView2 Runtime，请安装后重新打开 Mini Mark。" : exception.Message;
            Controls.Add(new Label { Text = message, Dock = DockStyle.Fill, Padding = new Padding(48), Font = new Font("Microsoft YaHei UI", 14) });
        }
    }

    private void Receive(object? sender, CoreWebView2WebMessageReceivedEventArgs e) {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || source.Host != "moye.local" || source.Scheme != "https" || source.AbsolutePath != "/index.html") return;
        try {
            using var json = JsonDocument.Parse(e.WebMessageAsJson);
            var message = json.RootElement;
            var type = message.GetProperty("type").GetString();
            if (type == "ready") {
                if (initialized) return;
                initialized = true; timings["rendererConnected"] = Program.Startup.Elapsed.TotalMilliseconds;
                Restore(); Publish(workspace.Documents.Any(document => document.Dirty));
                while (pendingOpen.TryDequeue(out var request)) OpenFromArguments(request);
                return;
            }
            if (!initialized) return;
            if (type == "cloudRequest") { _ = CloudRequest(message.Clone()); return; }
            if (type is "pdfHtml" or "pdfError") {
                var pending = pdfRequest;
                if (pending is null || message.GetProperty("requestId").GetString() != pending.Id || message.GetProperty("documentId").GetString() != pending.DocumentId) return;
                if (type == "pdfHtml") pending.Html.TrySetResult(message.GetProperty("html").GetString()!);
                else pending.Html.TrySetException(new IOException(message.GetProperty("message").GetString()));
                return;
            }
            if (type == "openExternal") { OpenExternal(message.GetProperty("url").GetString()); return; }
            if (type == "rendered") { RecordStartup(message); return; }
            if (type == "checkUpdates") { _ = CheckUpdates(message.GetProperty("requestId").GetString()!); return; }
            if (type == "installUpdate") { _ = InstallUpdate(message.GetProperty("version").GetString()!); return; }
            if (type == "cancelUpdate") { updateDownload?.Cancel(); return; }
            if (type == "copyEquation") {
                var requestId = message.GetProperty("requestId").GetString()!;
                try {
                    EquationClipboard.Copy(message.GetProperty("mathml").GetString()!, message.GetProperty("omml").GetString()!);
                    Post(new { type = "equationCopied", requestId });
                } catch (Exception error) { Post(new { type = "equationCopied", requestId, error = $"公式复制失败：{error.Message}" }); }
                return;
            }
            if (type == "exportPlugin") {
                var code = message.GetProperty("source").GetString()!;
                var filename = Path.GetFileName(message.GetProperty("name").GetString()!);
                if (code.Length > 200000) throw new IOException("插件文件过大。");
                RunAction(() => {
                    using var dialog = new SaveFileDialog { Filter = "JavaScript 插件 (*.js)|*.js", FileName = filename, DefaultExt = "js", AddExtension = true };
                    if (dialog.ShowDialog(this) == DialogResult.OK) DocumentStore.AtomicWrite(dialog.FileName, Encoding.UTF8.GetBytes(code));
                });
                return;
            }
            if (type == "importImages") {
                var requestId = message.GetProperty("requestId").GetString()!;
                try {
                    var target = workspace.Find(message.GetProperty("documentId").GetString()) ?? throw new IOException("文档已关闭。");
                    var images = message.GetProperty("images").EnumerateArray().ToArray();
                    if (images.Length is < 1 or > 10) throw new IOException("一次最多插入 10 张图片。");
                    var sources = images.Select(image => ImageAssets.Import(image.GetProperty("dataUrl").GetString()!, target.Cloud is null ? target.Path : null)).ToArray();
                    Post(new { type = "imagesImported", requestId, sources });
                } catch (Exception error) { Post(new { type = "imagesImported", requestId, error = error.Message }); }
                return;
            }
            if (type == "closingText" && (closingRequest is null || message.GetProperty("requestId").GetString() != closingRequest)) return;
            if (!message.TryGetProperty("documentId", out var id)) return;
            var document = workspace.Find(id.GetString());
            if (document is null) {
                if (type != "edit") { Post(new { type = "error", message = "文档已关闭，请重新选择文档。" }); Post(new { type = "operationComplete" }); }
                return;
            }
            if (message.TryGetProperty("text", out var value) && message.TryGetProperty("revision", out var revision)) {
                if (!document.Update(value.GetString()!, revision.GetInt64())) {
                    Publish();
                    if (type != "edit") { Post(new { type = "error", message = "文档内容已变化，请重新操作。" }); Post(new { type = "operationComplete" }); }
                    return;
                }
            }
            if (type == "edit") { UpdateTitle(); draftTimer.Stop(); draftTimer.Start(); return; }
            switch (type) {
                case "new":
                    var initial = message.TryGetProperty("initialText", out var initialValue) ? initialValue.GetString()! : "";
                    var initialName = message.TryGetProperty("name", out var nameValue) ? nameValue.GetString() : null;
                    RunAction(() => { workspace.AddNew(initial, initialName); Publish(); Persist(); }); break;
                case "activate":
                    var target = message.GetProperty("targetId").GetString()!;
                    RunAction(() => { workspace.Activate(target); Publish(); Persist(); }); break;
                case "cloudOpen":
                    var cloudOwner = message.GetProperty("owner").GetString()!;
                    var cloudPath = message.GetProperty("cloudPath").GetString()!;
                    RunAsync(() => OpenCloud(cloudOwner, cloudPath)); break;
                case "cloudBind":
                    var bindOwner = message.GetProperty("owner").GetString()!;
                    var bindPath = message.GetProperty("cloudPath").GetString()!;
                    RunAsync(() => BindCloud(document, bindOwner, bindPath)); break;
                case "cloudDetach":
                    RunAction(() => { document.UntitledName = document.Name; document.Cloud = null; Publish(); Persist(); }); break;
                case "closeTab":
                    var closeId = message.GetProperty("targetId").GetString()!;
                    RunAsync(() => CloseTab(closeId)); break;
                case "open": RunAction(Open); break;
                case "save": RunAsync(async () => { if (document.Cloud is not null) await SaveCloud(document); else Save(document, false, true); }); break;
                case "saveAs": RunAction(() => Save(document, true, true)); break;
                case "exportPdf": RunAction(() => ChoosePdf(document)); break;
                case "runHtml":
                    var previewTarget = message.GetProperty("target").GetString();
                    RunAction(() => {
                        if (!HtmlResources.IsHtml(document.Name)) throw new IOException("仅 HTML 文档可运行。");
                        if (previewTarget is not ("builtin" or "chrome")) throw new IOException("未知的浏览器。");
                        var chrome = previewTarget == "chrome" ? ChromeLauncher.FindChrome() ?? throw new IOException("未找到 Google Chrome，请安装 Chrome 或使用内置浏览器。") : null;
                        if (!Save(document, false, false)) return;
                        if (!HtmlResources.IsHtml(document.Name)) throw new IOException("请保存为 .html 或 .htm 后再运行。");
                        if (chrome is not null) ChromeLauncher.Open(chrome, document.Path!);
                        else new HtmlPreviewWindow(document.Path!) { ShowInTaskbar = ShowInTaskbar, Opacity = Opacity }.Show(this);
                    }); break;
                case "exportHtml":
                    var html = message.GetProperty("html").GetString()!;
                    var exportName = message.TryGetProperty("name", out var htmlName) ? htmlName.GetString()! : document.Name;
                    RunAction(() => ExportHtml(html, exportName)); break;
                case "closingText": RunAsync(FinishClose); break;
            }
        } catch (Exception exception) { Post(new { type = "error", message = exception.Message }); Post(new { type = "operationComplete" }); }
    }

    private void RunAction(Action action) {
        RunAsync(() => { action(); return Task.CompletedTask; });
    }
    private void RunAsync(Func<Task> action) {
        actions.Enqueue(action);
        DrainActions();
    }
    private void DrainActions() {
        if (busy || actions.Count == 0 || IsDisposed) return;
        busy = true;
        // Leave WebView2's callback before entering a native modal message loop.
        BeginInvoke(async () => {
            try { await actions.Dequeue()(); }
            catch (Exception exception) { closingRequest = null; preparedInstaller = null; if (!IsDisposed) Post(new { type = "error", message = CloudError(exception) }); }
            finally {
                busy = false;
                if (!IsDisposed) {
                    Post(new { type = "operationComplete" });
                    DrainActions();
                }
            }
        });
    }

    public void OpenFromArguments(string[] arguments) {
        if (!initialized) { pendingOpen.Enqueue(arguments); return; }
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show(); Activate();
        RunAction(() => {
            foreach (var file in arguments.Where(argument => !argument.StartsWith("--", StringComparison.Ordinal))) workspace.Open(file);
            Publish(); Persist();
        });
    }

    private void Restore() {
        try { workspace = DocumentWorkspace.Restore(sessionFile, Path.Combine(dataRoot, "draft.json")); }
        catch (Exception exception) {
            persistenceBlocked = true;
            Post(new { type = "error", message = $"无法读取旧会话，原文件将保留；请手动保存当前文档。{exception.Message}" });
        }
        foreach (var requested in args.Where(argument => !argument.StartsWith("--", StringComparison.Ordinal))) {
            try { workspace.Open(requested); } catch (Exception exception) { Post(new { type = "error", message = exception.Message }); }
        }
        if (workspace.Documents.Count == 0) {
            var sample = File.ReadAllText(Path.Combine(root, "welcome.md"));
            workspace.AddNew(sample, "随手记.md", sample);
        }
        Persist();
    }

    private void Publish(bool recovered = false) {
        var document = workspace.Active;
        Post(new {
            type = "workspace", recovered,
            tabs = workspace.Documents.Select(item => new { id = item.Id, name = item.Name, path = item.Path, cloud = item.Cloud is null ? null : new { owner = item.Cloud.Owner, path = item.Cloud.Path, sha = item.Cloud.Sha }, dirty = item.Dirty, revision = item.Revision }),
            document = new { id = document.Id, text = document.Text, baseline = document.SavedBaseline, name = document.Name, path = document.Path, cloud = document.Cloud, revision = document.Revision }
        });
        UpdateTitle();
    }
    private void UpdateTitle() { var document = workspace.Active; Text = $"{(document.Dirty ? "• " : "")}{document.Name} · Mini Mark"; }
    private void Open() {
        using var dialog = new OpenFileDialog { Filter = "Markdown / YAML / HTML 文档|*.md;*.markdown;*.mdown;*.txt;*.yaml;*.yml;*.html;*.htm|所有文件|*.*", CheckFileExists = true, Multiselect = true };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        foreach (var file in dialog.FileNames) workspace.Open(file);
        Publish(); Persist();
    }

    private static bool IsYaml(string name) => Path.GetExtension(name).Equals(".yaml", StringComparison.OrdinalIgnoreCase) || Path.GetExtension(name).Equals(".yml", StringComparison.OrdinalIgnoreCase);
    private static string PreferredExtension(string name) => HtmlResources.IsHtml(name) ? Path.GetExtension(name).ToLowerInvariant() : Path.GetExtension(name).Equals(".yml", StringComparison.OrdinalIgnoreCase) ? ".yml" : IsYaml(name) ? ".yaml" : ".md";

    private bool Save(OpenDocument document, bool saveAs, bool allowPdf) {
        // A cloud document's local copy must be chosen explicitly before leaving cloud mode.
        saveAs |= document.Cloud is not null;
        allowPdf &= !HtmlResources.IsHtml(document.Name);
        var target = document.Path;
        if (target is null || saveAs) {
            using var dialog = new SaveFileDialog {
                Filter = "Markdown / YAML / HTML 文档|*.md;*.markdown;*.mdown;*.yaml;*.yml;*.html;*.htm" + (allowPdf ? "|PDF 文档 (*.pdf)|*.pdf" : ""),
                DefaultExt = PreferredExtension(document.Name).TrimStart('.'), FileName = document.Name, AddExtension = true, OverwritePrompt = true
            };
            if (dialog.ShowDialog(this) != DialogResult.OK) return false;
            target = dialog.FileName;
            if (allowPdf && dialog.FilterIndex == 2) {
                var pdfTarget = ConfirmPdfTarget(target);
                if (pdfTarget is not null) BeginPdf(document, pdfTarget);
                return false;
            }
            if (Path.GetExtension(target).Equals(".pdf", StringComparison.OrdinalIgnoreCase)) throw new IOException("当前选择的是 Markdown/YAML 格式；保存 PDF 请在文件类型中选择 PDF。");
        } else if (DocumentStore.HasConflict(target, document.Fingerprint)) {
            var answer = MessageBox.Show(this, "文件已被其他程序修改或删除。\n是：覆盖；否：另存为；取消：继续编辑。", "文件发生变化", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
            if (answer == DialogResult.Cancel) return false;
            if (answer == DialogResult.No) return Save(document, true, allowPdf);
        }
        if (workspace.PathOwnedByAnother(target, document.Id)) throw new IOException("该文件已在另一个标签页打开，请选择其他文件名。");
        var saved = document.Text;
        if (!HtmlResources.IsHtml(document.Name)) ImageAssets.CopyForSaveAs(saved, document.Path, target);
        document.Fingerprint = DocumentStore.Write(target, saved, document.Bom, document.Newline);
        document.Path = target; document.Baseline = saved; document.Cloud = null;
        Persist();
        Post(new { type = "saved", documentId = document.Id, name = document.Name, path = document.Path, cloud = document.Cloud, text = saved });
        UpdateTitle(); return true;
    }

    private async Task CloseTab(string id) {
        var document = workspace.Find(id);
        if (document is null) return;
        if (document.Dirty) {
            var answer = AskSave(document);
            if (answer == DialogResult.Cancel || (answer == DialogResult.Yes && !await SaveForClose(document))) return;
            if (answer == DialogResult.Yes && document.Dirty) throw new IOException("同步期间文档又有修改，请保存后再关闭。");
        }
        workspace.Remove(id); Publish(); Persist();
    }
    private DialogResult AskSave(OpenDocument document) => MessageBox.Show(this, $"是否保存对“{document.Name}”的修改？", "Mini Mark", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);

    private void OnClosing(object? sender, FormClosingEventArgs e) {
        if (closingConfirmed || !initialized) return;
        e.Cancel = true;
        if (pdfRequest is not null) { Post(new { type = "notice", message = "PDF 正在导出，请稍候再退出。" }); return; }
        if (closingRequest is not null || busy) return;
        closingRequest = Guid.NewGuid().ToString("N");
        Post(new { type = "requestClosingText", requestId = closingRequest });
    }
    private async Task FinishClose() {
        var revisions = workspace.Documents.ToDictionary(item => item.Id, item => item.Revision);
        var decisions = new List<(OpenDocument Document, DialogResult Decision)>();
        foreach (var document in workspace.Documents.Where(item => item.Dirty)) {
            var answer = AskSave(document);
            if (answer == DialogResult.Cancel) { CancelClosingUpdate(); return; }
            decisions.Add((document, answer));
        }
        foreach (var (document, decision) in decisions) {
            if (decision == DialogResult.Yes && !await SaveForClose(document)) { CancelClosingUpdate(); return; }
            if (decision == DialogResult.Yes && document.Dirty) throw new IOException("同步期间文档又有修改，请保存后再退出。");
        }
        if (workspace.Documents.Any(item => !revisions.TryGetValue(item.Id, out var savedRevision) || savedRevision != item.Revision))
            throw new IOException("文档在关闭过程中发生了修改，请重试。");
        foreach (var (document, decision) in decisions) {
            if (decision != DialogResult.No) continue;
            if (document.Path is null && document.Cloud is null) workspace.Remove(document.Id);
            else document.Text = document.SavedBaseline;
        }
        Persist(); InstallerToRun = preparedInstaller; closingConfirmed = true; Close();
    }
    private void CancelClosingUpdate() {
        closingRequest = null;
        if (preparedInstaller is not null) Post(new { type = "updateInstallStatus", message = "已取消安装，继续编辑。", downloading = false });
        preparedInstaller = null;
    }
    private void Persist() {
        if (!initialized || persistenceBlocked) return;
        try { workspace.SaveSession(sessionFile); }
        catch (Exception exception) {
            if (!draftErrorShown) { Post(new { type = "error", message = $"草稿备份失败，请手动保存：{exception.Message}" }); draftErrorShown = true; }
        }
    }

    private void ChoosePdf(OpenDocument document) {
        if (pdfRequest is not null) { Post(new { type = "notice", message = "上一份 PDF 正在导出，请稍候。" }); return; }
        using var dialog = new SaveFileDialog { Filter = "PDF 文档 (*.pdf)|*.pdf", DefaultExt = "pdf", FileName = Path.GetFileNameWithoutExtension(document.Name) + ".pdf", AddExtension = true };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var target = ConfirmPdfTarget(dialog.FileName);
        if (target is not null) BeginPdf(document, target);
    }
    private string? ConfirmPdfTarget(string selectedPath) {
        var target = Path.ChangeExtension(selectedPath, ".pdf");
        if (!DocumentWorkspace.SamePath(target, selectedPath) && File.Exists(target) &&
            MessageBox.Show(this, $"“{Path.GetFileName(target)}”已存在，是否替换？", "保存 PDF", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return null;
        return target;
    }
    private void BeginPdf(OpenDocument document, string target) {
        if (pdfRequest is not null) { Post(new { type = "notice", message = "上一份 PDF 正在导出，请稍候。" }); return; }
        if (workspace.Documents.Any(item => item.Path is not null && DocumentWorkspace.SamePath(target, item.Path))) throw new IOException("PDF 不能覆盖打开的 Markdown 源文件。");
        var request = new PdfRequest(Guid.NewGuid().ToString("N"), document.Id, document.Name, document.Text, document.Path is null ? null : Path.GetDirectoryName(document.Path), target, new(TaskCreationOptions.RunContinuationsAsynchronously));
        pdfRequest = request;
        Post(new { type = "requestExportPdf", requestId = request.Id, documentId = request.DocumentId, name = request.Name, text = request.Text });
        _ = CompletePdf(request);
    }
    private async Task CompletePdf(PdfRequest request) {
        try {
            var html = await request.Html.Task.WaitAsync(TimeSpan.FromSeconds(45));
            await PdfExporter.Export(this, environment!, html, request.SourceFolder, request.Target);
            Post(new { type = "notice", message = $"PDF 已保存：{Path.GetFileName(request.Target)}" });
        } catch (Exception exception) { if (!IsDisposed) Post(new { type = "error", message = $"PDF 导出失败：{exception.Message}" }); }
        finally { pdfRequest = null; }
    }
    private void ExportHtml(string html, string name) {
        using var dialog = new SaveFileDialog { Filter = "HTML 文档|*.html", DefaultExt = "html", FileName = Path.GetFileNameWithoutExtension(name) + ".html" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        DocumentStore.AtomicWrite(dialog.FileName, new UTF8Encoding(false).GetBytes(html));
        Post(new { type = "notice", message = "HTML 已导出（公式字体已内嵌）" });
    }
    private static void OpenExternal(string? value) {
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https") Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }
    private async Task CheckUpdates(string requestId) {
        try {
            var result = await updates.Check();
            if (!IsDisposed) Post(new { type = "updateResult", requestId, releases = result.Manifest.Releases, cacheNotice = result.CacheNotice, installSupported = true });
        } catch (Exception exception) {
            if (!IsDisposed) Post(new { type = "updateResult", requestId, error = exception.Message });
        }
    }
    private async Task InstallUpdate(string version) {
        if (updateDownload is not null) return;
        if (pdfRequest is not null) { Post(new { type = "updateInstallStatus", message = "请先等待 PDF 导出完成。", downloading = false }); return; }
        updateDownload = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        try {
            var progress = new Progress<int>(percent => { if (!IsDisposed) Post(new { type = "updateInstallStatus", message = $"正在下载更新… {percent}%", downloading = true }); });
            var installer = await updates.DownloadInstaller(version, progress, updateDownload.Token);
            if (IsDisposed) return;
            if (pdfRequest is not null) { Post(new { type = "updateInstallStatus", message = "安装包已准备好，PDF 导出完成后请再次点击更新。", downloading = false }); return; }
            if (busy || closingRequest is not null) { Post(new { type = "updateInstallStatus", message = "安装包已准备好，当前操作结束后请再次点击更新。", downloading = false }); return; }
            preparedInstaller = installer;
            Post(new { type = "updateInstallStatus", message = "校验通过，正在保存文档并准备覆盖安装。", downloading = false });
            Close();
        } catch (OperationCanceledException) {
            if (!IsDisposed) Post(new { type = "updateInstallStatus", message = "下载已取消或超时，可以重新尝试。", downloading = false });
        } catch (Exception exception) {
            if (!IsDisposed) Post(new { type = "updateInstallStatus", message = $"更新未安装：{exception.Message}", downloading = false });
        } finally { updateDownload?.Dispose(); updateDownload = null; }
    }
    private void RecordStartup(JsonElement message) {
        var file = Environment.GetEnvironmentVariable("MOYE_DIAGNOSTICS_PATH");
        if (file is null || startupRecorded) return;
        startupRecorded = true;
        File.WriteAllText(file, JsonSerializer.Serialize(new { startupMilliseconds = Program.Startup.Elapsed.TotalMilliseconds, rendererMilliseconds = message.GetProperty("elapsed").GetDouble(), browserProcessId = browser.CoreWebView2.BrowserProcessId, timings, utc = DateTime.UtcNow }));
        if (args.Contains("--benchmark")) { closingConfirmed = true; BeginInvoke(Close); }
    }
    private static readonly JsonSerializerOptions MessageJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private void Post(object message) { if (!IsDisposed) browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, MessageJson)); }
}
