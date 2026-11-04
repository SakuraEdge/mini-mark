using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace Moye;

public static class Program {
    public static readonly Stopwatch Startup = Stopwatch.StartNew();

    [STAThread]
    public static void Main(string[] args) {
        Startup.Restart();
        var dataRoot = Path.GetFullPath(Environment.GetEnvironmentVariable("MOYE_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Moye"));
        using var instance = new SingleInstance(dataRoot);
        if (!instance.IsPrimary) {
            try { instance.Forward(args); }
            catch (IOException) { MessageBox.Show("墨页正在启动，请稍后重试。", "墨页"); }
            catch (TimeoutException) { MessageBox.Show("墨页暂时没有响应，请回到已打开的窗口。", "墨页"); }
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.ThreadException += (_, e) => {
            MessageBox.Show(e.Exception.Message, "墨页", MessageBoxButtons.OK, MessageBoxIcon.Error);
        };
        var window = new MainWindow(args);
        window.HandleCreated += (_, _) => instance.Listen(arguments => window.BeginInvoke(() => window.OpenFromArguments(arguments)));
        Application.Run(window);
    }
}
