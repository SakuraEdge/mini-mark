using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Moye;

public static class PdfExporter {
    public static async Task Export(Form owner, CoreWebView2Environment environment, string html, string? sourceFolder, string target) {
        using var printView = new WebView2 { Left = -12000, Top = 0, Width = 900, Height = 1200 };
        owner.Controls.Add(printView);
        try {
            printView.CreateControl();
            await printView.EnsureCoreWebView2Async(environment);
            var core = printView.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            var url = "https://export.moye.local/" + Guid.NewGuid().ToString("N");
            if (sourceFolder is not null) core.SetVirtualHostNameToFolderMapping("print-document.moye.local", sourceFolder, CoreWebView2HostResourceAccessKind.DenyCors);
            html = html.Replace("<head>", "<head><base href=\"https://print-document.moye.local/\">", StringComparison.Ordinal);
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => {
                if (e.Request.Uri == url) {
                    e.Response = environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(html)), 200, "OK", "Content-Type: text/html; charset=utf-8");
                } else if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var resource) ||
                           !(resource.Scheme == "data" || (resource.Scheme == "https" && resource.Host == "print-document.moye.local" && e.ResourceContext == CoreWebView2WebResourceContext.Image))) {
                    e.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Blocked", "Content-Type: text/plain");
                }
            };
            core.NavigationStarting += (_, e) => { if (e.Uri != url) e.Cancel = true; };
            var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            core.WebMessageReceived += (_, e) => {
                if (e.Source == url && e.TryGetWebMessageAsString() == "print-ready") ready.TrySetResult();
            };
            core.NavigationCompleted += async (_, e) => {
                if (!e.IsSuccess) { ready.TrySetException(new IOException("PDF 排版页面加载失败。")); return; }
                try {
                    await core.ExecuteScriptAsync("""
                    (async () => {
                        await document.fonts.ready;
                        await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
                        document.body.getBoundingClientRect();
                        chrome.webview.postMessage('print-ready');
                    })();
                    """);
                } catch (Exception exception) { ready.TrySetException(exception); }
            };
            core.Navigate(url);
            await ready.Task.WaitAsync(TimeSpan.FromSeconds(45));
            var settings = environment.CreatePrintSettings();
            settings.PageWidth = 8.2677;
            settings.PageHeight = 11.6929;
            settings.MarginTop = settings.MarginBottom = 0.6;
            settings.MarginLeft = settings.MarginRight = 0.6;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;
            using var pdf = await core.PrintToPdfStreamAsync(settings);
            using var bytes = new MemoryStream();
            await pdf.CopyToAsync(bytes);
            if (bytes.Length < 5 || Encoding.ASCII.GetString(bytes.GetBuffer(), 0, 5) != "%PDF-") throw new IOException("PDF 生成失败，原文件未改变。");
            DocumentStore.AtomicWrite(target, bytes.ToArray());
        } finally { owner.Controls.Remove(printView); }
    }
}
