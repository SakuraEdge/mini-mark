using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Moye;

public sealed class HtmlPreviewWindow : Form {
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly string file;
    private readonly string host = "preview-" + Guid.NewGuid().ToString("N") + ".minimark.local";
    public HtmlPreviewWindow(string path) {
        file = Path.GetFullPath(path);
        Text = Path.GetFileName(file) + " · HTML 预览";
        Width = 1100; Height = 800; MinimumSize = new System.Drawing.Size(480, 360);
        var toolbar = new ToolStrip { GripStyle = ToolStripGripStyle.Hidden, Dock = DockStyle.Top };
        var reload = new ToolStripButton("重新运行") { ToolTipText = "重新读取已保存的 HTML" };
        reload.Click += (_, _) => browser.CoreWebView2?.Reload();
        toolbar.Items.Add(reload);
        toolbar.Items.Add(new ToolStripLabel(Path.GetFileName(file)));
        Controls.Add(browser); Controls.Add(toolbar);
        FormClosed += (_, _) => browser.Dispose();
        Shown += async (_, _) => {
            try {
                var profile = Path.Combine(AppPaths.DataRoot, "HtmlPreviewWebView2");
                var environment = await CoreWebView2Environment.CreateAsync(null, profile);
                await browser.EnsureCoreWebView2Async(environment);
                var core = browser.CoreWebView2;
                core.Settings.IsWebMessageEnabled = false;
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.AreDefaultScriptDialogsEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsStatusBarEnabled = true;
                core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
                core.NewWindowRequested += (_, e) => e.Handled = true;
                core.DownloadStarting += (_, e) => e.Cancel = true;
                core.NavigationStarting += (_, e) => {
                    if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) e.Cancel = true;
                };
                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += (_, e) => {
                    if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri)) return;
                    if (uri.Scheme == "https" && uri.Host == host && e.Request.Method == "GET") {
                        try {
                            var resource = HtmlResources.Read(Path.GetDirectoryName(file)!, Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')));
                            e.Response = environment.CreateWebResourceResponse(new MemoryStream(resource.Data), 200, "OK",
                                $"Content-Type: {resource.Mime}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
                            return;
                        } catch (Exception) {
                            e.Response = environment.CreateWebResourceResponse(Stream.Null, 404, "Not found", "Content-Type: text/plain");
                            return;
                        }
                    }
                    if (uri.Host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) || uri.Scheme is not ("http" or "https" or "data" or "blob"))
                        e.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Blocked", "Content-Type: text/plain");
                };
                core.Navigate($"https://{host}/{Uri.EscapeDataString(Path.GetFileName(file))}");
            } catch (Exception error) {
                MessageBox.Show(this, $"无法运行 HTML：{error.Message}", "HTML 预览", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        };
    }
}
