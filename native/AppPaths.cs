using Microsoft.Win32;

namespace Moye;

public static class AppPaths {
    public static string DataRoot {
        get {
            var explicitPath = Environment.GetEnvironmentVariable("MOYE_DATA_DIR");
            if (!string.IsNullOrWhiteSpace(explicitPath)) return Path.GetFullPath(explicitPath);
            using var settings = Registry.CurrentUser.OpenSubKey(@"Software\Moye");
            if (settings?.GetValue("DataDirectory") is string configured && Path.IsPathFullyQualified(configured)) return Path.GetFullPath(configured);
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Moye");
        }
    }
}
