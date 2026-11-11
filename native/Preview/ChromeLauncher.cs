using System.Diagnostics;
using Microsoft.Win32;

namespace Moye;

public static class ChromeLauncher {
    public static string? FindChrome() {
        var candidates = new List<string>();
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine }) {
            using var registry = RegistryKey.OpenBaseKey(hive, RegistryView.Registry64);
            using var key = registry.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe");
            if (key?.GetValue(null) is string registered) candidates.Add(registered.Trim('"'));
        }
        foreach (var folder in new[] { Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) })
            candidates.Add(Path.Combine(folder, "Google", "Chrome", "Application", "chrome.exe"));
        return candidates.FirstOrDefault(candidate => Path.IsPathFullyQualified(candidate) && Path.GetFileName(candidate).Equals("chrome.exe", StringComparison.OrdinalIgnoreCase) && File.Exists(candidate));
    }
    public static void Open(string executable, string file) {
        if (!HtmlResources.IsHtml(file) || !File.Exists(file)) throw new IOException("请先保存为 HTML 文件。");
        var start = new ProcessStartInfo(executable) { UseShellExecute = false };
        start.ArgumentList.Add(new Uri(Path.GetFullPath(file)).AbsoluteUri);
        Process.Start(start);
    }
}
