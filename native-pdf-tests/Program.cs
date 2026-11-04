using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Moye;

internal static class Program {
    [STAThread]
    private static void Main(string[] args) {
        if (args.Length != 3) throw new ArgumentException("Expected HTML path, PDF path, isolated WebView profile");
        ApplicationConfiguration.Initialize();
        using var form = new Form { Width = 400, Height = 300, ShowInTaskbar = false, Opacity = 0 };
        form.Shown += async (_, _) => {
            try {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.GetFullPath(args[2]));
                await PdfExporter.Export(form, environment, File.ReadAllText(args[0]), Path.GetDirectoryName(Path.GetFullPath(args[0])), Path.GetFullPath(args[1]));
                var bytes = File.ReadAllBytes(args[1]);
                if (bytes.Length < 1000) throw new Exception("PDF was unexpectedly small");
                Console.WriteLine($"PASS native PDF export: {bytes.Length} bytes");
            } catch (Exception exception) { Console.Error.WriteLine(exception); Environment.ExitCode = 1; }
            finally { form.Close(); }
        };
        Application.Run(form);
    }
}
