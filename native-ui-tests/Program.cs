using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;
using Moye;

internal static class Program {
    [STAThread]
    private static void Main() {
        var folder = Path.Combine(Path.GetTempPath(), "moye-ui-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        Environment.SetEnvironmentVariable("MOYE_DATA_DIR", folder);
        Environment.SetEnvironmentVariable("MINIMARK_GITHUB_CLIENT_ID", " ");
        var tokenStore = new WindowsTokenStore(folder);
        try {
            if (tokenStore.Read() is not null) throw new Exception("Isolated cloud credential target was not empty");
            var sentinel = Guid.NewGuid().ToString("N");
            tokenStore.Write(sentinel);
            if (tokenStore.Read() != sentinel) throw new Exception("Windows cloud credential did not round trip");
            tokenStore.Clear();
            if (tokenStore.Read() is not null) throw new Exception("Windows cloud credential was not removed");
        } finally { tokenStore.Clear(); }
        Console.WriteLine("PASS isolated Windows cloud credential read/write/clear");
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
            if (args.IsSuccess) {
                browser.CoreWebView2.WebMessageReceived += (_, _) => received++;
                browser.CoreWebView2.WebResourceResponseReceived += (_, response) => {
                    if (response.Request.Uri.Contains("document.moye.local")) Console.WriteLine($"Image resource: {response.Response.StatusCode} {response.Request.Uri}");
                };
            }
        };
        window.Shown += async (_, _) => {
            try {
                async Task<bool> Evaluate(string expression) {
                    if (browser.CoreWebView2 is null) return false;
                    return await browser.CoreWebView2.ExecuteScriptAsync(expression) == "true";
                }
                async Task Wait(string expression, string failure) {
                    for (var i = 0; i < 200; i++) { if (await Evaluate(expression)) return; await Task.Delay(50); }
                    var diagnostics = await browser.CoreWebView2.ExecuteScriptAsync("JSON.stringify({preview:document.getElementById('reading-view')?.innerHTML,plugin:document.getElementById('plugin-status')?.textContent})");
                    throw new Exception(failure + $" (renderer messages: {received}; diagnostics: {diagnostics})");
                }
                Task Click(string id) => browser.CoreWebView2.ExecuteScriptAsync($"document.getElementById('{id}').click()");
                async Task Rename(string selector, string next) {
                    await browser.CoreWebView2.ExecuteScriptAsync($"document.querySelector({JsonSerializer.Serialize(selector)}).dispatchEvent(new MouseEvent('contextmenu', {{bubbles:true,cancelable:true,clientX:150,clientY:110}}))");
                    await Wait("!document.querySelector('.document-context-menu').hidden", "Native rename context menu missing");
                    await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.document-context-menu button').click()");
                    await Wait("document.querySelector('.text-input-dialog').open", "Native rename dialog missing");
                    await browser.CoreWebView2.ExecuteScriptAsync($"document.getElementById('text-dialog-input').value={JsonSerializer.Serialize(next)};document.querySelector('.text-input-dialog form').requestSubmit()");
                    await Wait("!document.querySelector('.text-input-dialog').open && !document.getElementById('app').classList.contains('transition-pending')", "Native rename did not complete");
                }
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
                using var bitmap = new System.Drawing.Bitmap(24, 24);
                using (var graphics = System.Drawing.Graphics.FromImage(bitmap)) graphics.Clear(System.Drawing.Color.CornflowerBlue);
                using var png = new MemoryStream();
                bitmap.Save(png, System.Drawing.Imaging.ImageFormat.Png);
                var base64 = Convert.ToBase64String(png.ToArray());
                await browser.CoreWebView2.ExecuteScriptAsync($$"""
                (() => {
                  const data = new DataTransfer();
                  data.items.add(new File([Uint8Array.from(atob('{{base64}}'), c => c.charCodeAt(0))], 'native-test.png', {type:'image/png'}));
                  document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', {clipboardData:data,bubbles:true,cancelable:true}));
                })()
                """);
                await Wait("document.querySelector('.cm-content').textContent.includes('assets/mini-mark-')", "Native image import did not insert an asset reference");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-mode=read]').click()");
                await Wait("document.querySelector('#reading-view img')?.naturalWidth === 24", "Native image asset did not render");
                if (Directory.GetFiles(Path.Combine(folder, "assets"), "*.png").Length != 1) throw new Exception("Native image was not persisted beside the document");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-mode=source]').click()");
                await Click("save-markdown");
                await Wait("document.getElementById('save-state').textContent === '已保存'", "Image document save failed");
                await Click("cloud-documents");
                await Wait("document.getElementById('cloud-dialog').open && document.getElementById('cloud-status').textContent.includes('未配置')", "Native cloud status did not report missing OAuth configuration");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('#cloud-dialog [data-action=close]').click()");
                await Wait("!document.getElementById('cloud-dialog').open && !document.getElementById('app').classList.contains('transition-pending')", "Cloud dialog close locked the editor");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.cm-content').focus(); document.execCommand('insertText', false, 'Cloud dialog closed. ')");
                await Wait("document.querySelector('.cm-content').textContent.includes('Cloud dialog closed.') && document.getElementById('save-state').textContent === '未保存'", "Editor did not accept edits after cloud dialog closed");
                await Click("save-markdown");
                await Wait("document.getElementById('save-state').textContent === '已保存'", "Local save failed after cloud dialog closed");
                if (!File.ReadAllText(savedFile).Contains("Cloud dialog closed.")) throw new Exception("Local save lost edit after cloud dialog closed");
                Console.WriteLine("PASS native cloud status, missing OAuth configuration, dialog close and subsequent local edit/save");
                await Click("manage-plugins");
                await Click("plugins-title");
                await browser.CoreWebView2.ExecuteScriptAsync("""
                document.querySelector('#plugins-dialog [data-action=new]').click();
                document.getElementById('plugin-source').value = "miniMark.register({id:'native-test',name:'Native plugin',version:'1',commands:[{id:'check',title:'Native boundary check',async run(){let blocked=false;try{await fetch('https://example.com/probe')}catch{blocked=true}return {message:blocked && typeof chrome === 'undefined' && typeof document === 'undefined' ? 'NATIVE_PLUGIN_OK' : 'NATIVE_PLUGIN_FAILED'}}}]});";
                document.querySelector('#plugins-dialog [data-action=save]').click();
                """);
                await Wait("document.getElementById('plugin-status').textContent === '已保存'", "Native plugin sandbox did not initialize");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.plugin-commands button').click()");
                await Wait("document.getElementById('toast').textContent === 'NATIVE_PLUGIN_OK'", "Native plugin sandbox network/bridge isolation failed");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('#plugins-dialog [data-action=close]').click()");
                await Click("math");
                await Wait("document.getElementById('formula-dialog')?.open === true", "Production formula dialog failed to load");
                await browser.CoreWebView2.ExecuteScriptAsync("""
                (() => {
                  const source = document.getElementById('formula-latex');
                  source.value = String.raw`\frac{1}{2}+\sqrt{x}+\alpha`;
                  source.dispatchEvent(new Event('input', {bubbles:true}));
                })()
                """);
                await Wait("Boolean(document.querySelector('#formula-dialog .formula-preview .katex'))", "Formula preview missing");
                var previousClipboard = new DataObject();
                var clipboard = Clipboard.GetDataObject();
                if (clipboard is not null) {
                    // OLE owner/link descriptors cannot be republished by a different process.
                    foreach (var format in new[] { DataFormats.UnicodeText, DataFormats.Html, DataFormats.Rtf, DataFormats.Bitmap, DataFormats.FileDrop }) {
                        try {
                            if (!clipboard.GetDataPresent(format, false)) continue;
                            var data = clipboard.GetData(format, false);
                            if (data is MemoryStream bytes) data = new MemoryStream(bytes.ToArray());
                            if (data is System.Drawing.Image image) data = image.Clone();
                            if (data is not null) previousClipboard.SetData(format, false, data);
                        } catch { /* A clipboard owner may decline a delayed format. */ }
                    }
                }
                try {
                    var authorization = new GitHubCloud(new EmptyClipboardTokenStore(), () => "clipboard-test-client", new HttpClient(new ClipboardAuthorizationHandler()));
                    await authorization.Execute(JsonSerializer.SerializeToElement(new { action = "startLogin" }));
                    authorization.CopyAuthorizationCode("ABCD-EFGH", value => Clipboard.SetText(value, TextDataFormat.UnicodeText));
                    if (Clipboard.GetText(TextDataFormat.UnicodeText) != "ABCD-EFGH") throw new Exception("Native clipboard did not contain the complete user authorization code");
                    try { authorization.CopyAuthorizationCode("ABCD", value => Clipboard.SetText(value)); throw new Exception("Partial authorization code copied"); }
                    catch (IOException) { }
                    if (Clipboard.GetText(TextDataFormat.UnicodeText) != "ABCD-EFGH") throw new Exception("Invalid code altered native clipboard");
                    await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('#formula-dialog [data-action=copy]').click()");
                    await Wait("document.getElementById('formula-status').textContent === '已复制可编辑公式'", "Native structured equation copy failed");
                    var copied = Clipboard.GetDataObject() ?? throw new Exception("Equation clipboard was empty");
                    var html = copied.GetData(DataFormats.Html) as string ?? "";
                    if (!copied.GetDataPresent("MathML", false) || !html.Contains("<m:f>") || !html.Contains("<m:rad>") || !html.Contains("α"))
                        throw new Exception("Clipboard lost structured equation or Unicode");
                    var bytes = System.Text.Encoding.UTF8.GetBytes(html);
                    int Offset(string name) => int.Parse(System.Text.RegularExpressions.Regex.Match(html, name + @":(\d+)").Groups[1].Value);
                    var fragment = System.Text.Encoding.UTF8.GetString(bytes[Offset("StartFragment")..Offset("EndFragment")]);
                    if (!fragment.StartsWith("<p>") || !fragment.EndsWith("</p>")) throw new Exception("CF_HTML UTF-8 fragment offsets are incorrect");
                    if (copied.GetData("MathML", false) is not MemoryStream stream || !System.Text.Encoding.UTF8.GetString(stream.ToArray()).Contains("<mfrac>"))
                        throw new Exception("Registered MathML clipboard bytes are incorrect");
                } finally {
                    Clipboard.SetDataObject(previousClipboard, true, 20, 100);
                }
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('#formula-dialog [data-action=save]').click()");
                await Wait("!document.getElementById('formula-dialog') && document.querySelector('.cm-content').textContent.includes('frac')", "Formula writeback failed");
                await Click("save-markdown");
                await Wait("document.getElementById('save-state').textContent === '已保存'", "Formula document save failed");
                if (!File.ReadAllText(savedFile).Contains("\\frac{1}{2}+\\sqrt{x}+\\alpha")) throw new Exception("Saved file lost formula");
                Console.WriteLine("PASS production formula dialog, preview, structured MathML/OMML clipboard, UTF-8 offsets, writeback and native save");
                var htmlFile = Path.Combine(folder, "网页.html");
                File.WriteAllText(Path.Combine(folder, "local.css"), "h1 { color: rgb(12, 100, 50); }");
                File.WriteAllText(Path.Combine(folder, "local.js"), "document.getElementById('result').textContent='HTML_SCRIPT_OK';");
                File.WriteAllText(htmlFile, "<!doctype html><html><head><link rel='stylesheet' href='local.css'></head><body><h1 id='result'>BEFORE</h1><script src='local.js'></script></body></html>");
                window.OpenFromArguments([htmlFile]);
                await Wait("document.getElementById('document-format').textContent === 'HTML' && document.getElementById('surface').dataset.mode === 'source'", "HTML source mode missing");
                if (window.OwnedForms.OfType<HtmlPreviewWindow>().Any()) throw new Exception("HTML executed on open");
                await Click("run-html");
                HtmlPreviewWindow? htmlWindow = null;
                WebView2? htmlWeb = null;
                for (var attempt = 0; attempt < 200; attempt++) {
                    htmlWindow = window.OwnedForms.OfType<HtmlPreviewWindow>().FirstOrDefault();
                    htmlWeb = htmlWindow?.Controls.OfType<WebView2>().SingleOrDefault();
                    if (htmlWeb?.CoreWebView2 is not null && await htmlWeb.CoreWebView2.ExecuteScriptAsync("document.getElementById('result')?.textContent === 'HTML_SCRIPT_OK'") == "true") break;
                    await Task.Delay(50);
                }
                if (htmlWeb?.CoreWebView2 is null || await htmlWeb.CoreWebView2.ExecuteScriptAsync("document.getElementById('result')?.textContent === 'HTML_SCRIPT_OK' && getComputedStyle(document.querySelector('h1')).color === 'rgb(12, 100, 50)'") != "true")
                    throw new Exception("Native HTML relative CSS/JS did not execute");
                if (htmlWeb.CoreWebView2.Settings.IsWebMessageEnabled || htmlWeb.CoreWebView2.Settings.AreHostObjectsAllowed)
                    throw new Exception("HTML preview exposes native bridge");
                htmlWindow!.Close();
                Console.WriteLine("PASS native HTML open/save/run, local CSS/JS and isolated preview without host bridge");
                await Click("new-tab");
                await Wait("document.getElementById('document-name').textContent.startsWith('未命名') && !document.getElementById('app').classList.contains('transition-pending')", "Automatic title draft not created");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.cm-content').focus();document.execCommand('insertText',false,'# Native auto title')");
                await Wait("document.getElementById('document-name').textContent === 'Native auto title.md'", "First H1 did not update native draft title");
                await Task.Delay(850);
                var autoDraft = DocumentWorkspace.Restore(session, Path.Combine(folder, "draft.json")).Active;
                if (autoDraft.Name != "Native auto title.md" || autoDraft.AutoName != true) throw new Exception("Native auto title did not persist");
                await Rename(".document-tab.active .tab-select", "Manual title");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.cm-content').focus();document.execCommand('selectAll');document.execCommand('insertText',false,'# Ignored title after manual rename')");
                await Wait("document.getElementById('document-name').textContent === 'Manual title.md' && document.querySelector('.cm-content').textContent.includes('Ignored title')", "Manual rename failed to disable auto naming");
                await Rename(".document-tab:first-child .tab-select", "Background rename.md");
                await Wait("document.getElementById('document-name').textContent === 'Manual title.md' && document.querySelector('.document-tab:first-child .tab-select').textContent === 'Background rename.md'", "Nonactive rename changed focus or wrong target");
                var renameSource = Path.Combine(folder, "rename-ui.md");
                DocumentStore.Write(renameSource, "# Stored\r\nOriginal\r\n", true, "\r\n");
                var renameBytes = File.ReadAllBytes(renameSource);
                window.OpenFromArguments([renameSource]);
                await Wait("document.getElementById('document-name').textContent === 'rename-ui.md'", "Local rename fixture did not open");
                await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.cm-content').focus();document.execCommand('insertText',false,'Dirty edit. ')");
                await Rename(".document-tab.active .tab-select", "renamed-ui");
                var renameTarget = Path.Combine(folder, "renamed-ui.md");
                if (File.Exists(renameSource) || !File.Exists(renameTarget) || !File.ReadAllBytes(renameTarget).SequenceEqual(renameBytes))
                    throw new Exception("Native UI rename rewrote bytes or left old file");
                await Wait("document.getElementById('save-state').textContent === '未保存' && document.querySelector('.cm-content').textContent.includes('Dirty edit.')", "Native rename discarded unsaved edits");
                await Click("save-markdown");
                await Wait("document.getElementById('save-state').textContent === '已保存'", "Save after local rename failed");
                if (!File.ReadAllText(renameTarget).Contains("Dirty edit.")) throw new Exception("Renamed file save lost dirty text");
                Console.WriteLine("PASS native H1 auto naming, persistent manual override, inactive-tab rename, local atomic rename with dirty text and original bytes");
                if (!window.Text.Contains("Mini Mark")) throw new Exception("Window branding did not update");
                Console.WriteLine($"PASS actual WebView2 CRLF restore, native New/Open/Save/tab buttons, view/theme/focus/menu controls, clean session, bounded messages ({received})");
                Console.WriteLine("PASS actual WebView2 image import/render/save and plugin sandbox/network/bridge isolation");
            } catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode = 1; }
            finally { window.Dispose(); Application.ExitThread(); }
        };
        Application.Run(window);
    }
}

sealed class EmptyClipboardTokenStore : ICloudTokenStore {
    public string? Read() => null;
    public void Write(string token) => throw new InvalidOperationException("Clipboard fixture must not persist credentials");
    public void Clear() { }
}
sealed class ClipboardAuthorizationHandler : HttpMessageHandler {
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
        if (request.RequestUri?.AbsoluteUri != "https://github.com/login/device/code") throw new InvalidOperationException("Unexpected clipboard fixture request");
        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) {
            Content = new StringContent(JsonSerializer.Serialize(new { device_code = "private-not-copied", user_code = "ABCD-EFGH", verification_uri = "https://github.com/login/device", expires_in = 900, interval = 5 }))
        });
    }
}
