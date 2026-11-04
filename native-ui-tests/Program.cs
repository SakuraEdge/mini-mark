using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;
using Moye;

internal static class Program {
    [STAThread]
    private static void Main() {
        var folder = Path.Combine(Path.GetTempPath(), "moye-ui-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        Environment.SetEnvironmentVariable("MOYE_DATA_DIR", folder);
        var fixture = new DocumentWorkspace();
        fixture.AddNew("# Windows note\r\n\r\nKeep this text.\r\n", "CRLF.md", "# Windows note\r\n\r\nKeep this text.\r\n");
        // Write the original pre-normalization session shape to cover older installations.
        var session = Path.Combine(folder, "session-v2.json");
        File.WriteAllText(session, JsonSerializer.Serialize(new WorkspaceSession(2, new List<OpenDocument> { fixture.Active }, fixture.ActiveId, 2)).Replace("Windows note\\n\\nKeep this text.\\n", "Windows note\\r\\n\\r\\nKeep this text.\\r\\n"));
        ApplicationConfiguration.Initialize();
        using var window = new MainWindow([]) { ShowInTaskbar = false, Opacity = 0 };
        var browser = window.Controls.OfType<WebView2>().Single();
        var received = 0;
        browser.CoreWebView2InitializationCompleted += (_, args) => {
            if (args.IsSuccess) browser.CoreWebView2.WebMessageReceived += (_, _) => received++;
        };
        window.Shown += async (_, _) => {
            try {
                async Task<bool> Evaluate(string expression) {
                    if (browser.CoreWebView2 is null) return false;
                    return await browser.CoreWebView2.ExecuteScriptAsync(expression) == "true";
                }
                async Task Wait(string expression, string failure) {
                    for (var i = 0; i < 200; i++) { if (await Evaluate(expression)) return; await Task.Delay(50); }
                    throw new Exception(failure + $" (renderer messages: {received})");
                }
                Task Click(string id) => browser.CoreWebView2.ExecuteScriptAsync($"document.getElementById('{id}').click()");
                await Wait("Boolean(window.__MOYE_READY__)", "Editor did not become ready");
                await Click("new-file");
                await Wait("document.querySelectorAll('.document-tab').length === 2 && !document.getElementById('app').classList.contains('transition-pending')", "New button stalled after CRLF restoration");
                await Click("new-tab");
                await Wait("document.querySelectorAll('.document-tab').length === 3", "New-tab button stalled");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('.tab-select')[0].click()");
                await Wait("document.querySelector('.cm-content').textContent.includes('Keep this text.')", "Tab switch lost the original document");
                await Click("theme");
                await Click("focus-mode");
                await Wait("document.getElementById('app').classList.contains('focus-mode')", "Focus button did not respond");
                await Click("focus-mode");
                await Click("more");
                await Wait("!document.getElementById('more-menu').hidden", "More button did not respond");
                await Click("more");
                await Click("save-file");
                await Wait("!document.getElementById('save-menu').hidden", "Save menu did not respond");
                await Click("save-file");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-mode=read]').click()");
                await Wait("!document.getElementById('reading-view').hidden", "Read view did not respond");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-mode=source]').click()");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-mode=split]').click()");
                await Wait("document.getElementById('surface').getAttribute('data-mode') === 'split' && !document.getElementById('reading-view').hidden && !document.getElementById('editor').hidden", "Split view did not respond");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-mode=source]').click()");
                var before = received;
                await Task.Delay(500);
                if (received - before > 5) throw new Exception("Workspace messages did not settle");
                var restored = DocumentWorkspace.Restore(session, Path.Combine(folder, "draft.json"));
                if (restored.Documents.Count != 3 || restored.Documents[0].Dirty || restored.Documents[0].Text != "# Windows note\n\nKeep this text.\n") throw new Exception("Native session did not preserve the CRLF document as clean normalized text");
                var savedFile = Path.Combine(folder, "existing.md");
                File.WriteAllText(savedFile, "# Saved\r\nOriginal\r\n");
                window.OpenFromArguments([savedFile]);
                await Wait("document.getElementById('document-name').textContent === 'existing.md'", "Opening a native file did not publish it");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.cm-content').focus(); document.execCommand('insertText', false, 'Saved through button. ')");
                await Wait("document.getElementById('save-state').textContent === '未保存'", "Native edit did not become dirty");
                await Click("save-file");
                await Click("save-markdown");
                await Wait("document.getElementById('save-state').textContent === '已保存' && !document.getElementById('app').classList.contains('transition-pending')", "Native Save button did not complete");
                var disk = File.ReadAllText(savedFile);
                if (!disk.Contains("Saved through button.") || !disk.Contains("\r\n")) throw new Exception("Native save lost text or CRLF formatting");
                Console.WriteLine($"PASS actual WebView2 CRLF restore, native New/Open/Save/tab buttons, view/theme/focus/menu controls, clean session, bounded messages ({received})");
            } catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode = 1; }
            finally { window.Dispose(); Application.ExitThread(); }
        };
        Application.Run(window);
    }
}
