using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace Moye;

public static class Program {
    public static readonly Stopwatch Startup = Stopwatch.StartNew();

    [STAThread]
    public static void Main(string[] args) {
        Startup.Restart();
        string dataRoot;
        try { dataRoot = AppPaths.DataRoot; Directory.CreateDirectory(dataRoot); }
        catch (Exception exception) {
            MessageBox.Show($"无法打开 Mini Mark 数据目录，请检查磁盘是否可用。\n{exception.Message}", "Mini Mark", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        using var instance = new SingleInstance(dataRoot);
        if (!instance.IsPrimary) {
            try { instance.Forward(args); }
            catch (IOException) { MessageBox.Show("Mini Mark 正在启动，请稍后重试。", "Mini Mark"); }
            catch (TimeoutException) { MessageBox.Show("Mini Mark 暂时没有响应，请回到已打开的窗口。", "Mini Mark"); }
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.ThreadException += (_, e) => {
            MessageBox.Show(e.Exception.Message, "Mini Mark", MessageBoxButtons.OK, MessageBoxIcon.Error);
        };
        var window = new MainWindow(args);
        window.HandleCreated += (_, _) => instance.Listen(arguments => window.BeginInvoke(() => window.OpenFromArguments(arguments)));
        Application.Run(window);
        if (window.InstallerToRun is DownloadedInstaller installer) {
            try {
                if (!GitHubUpdates.VerifyBeforeLaunch(installer)) throw new IOException("安装包在下载后发生变化，已停止安装。");
                var start = new ProcessStartInfo(installer.Path) { UseShellExecute = true };
                start.ArgumentList.Add("/DIR=" + AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar));
                start.ArgumentList.Add("/NORESTART");
                Process.Start(start);
            } catch (Exception exception) {
                MessageBox.Show($"安装程序未能启动，当前版本仍保留。\n{exception.Message}", "Mini Mark 更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }
}
