using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Moye;

internal sealed class FolderAccess : IDisposable {
    private const uint ReadAttributes = 0x80, GenericRead = 0x80000000;
    private const uint OpenExisting = 3, BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
    private readonly List<SafeFileHandle> handles = [];

    public static FolderAccess Directory(string path) {
        var access = new FolderAccess();
        try {
            var volume = Path.GetPathRoot(path) ?? throw new IOException("文件夹路径无效。");
            var current = volume;
            access.Open(current, true);
            foreach (var segment in path[volume.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries)) {
                current = Path.Combine(current, segment);
                access.Open(current, true);
            }
            return access;
        } catch { access.Dispose(); throw; }
    }

    public byte[] ReadFile(string path) {
        var handle = Open(path, false);
        using var stream = new FileStream(handle, FileAccess.Read);
        if (stream.Length > DocumentStore.MaxFileBytes) throw new IOException("文件超过 20 MB，请使用适合大文件的文本工具。");
        using var bytes = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int read;
        while ((read = stream.Read(buffer)) > 0) {
            if (bytes.Length + read > DocumentStore.MaxFileBytes) throw new IOException("文件超过 20 MB，请使用适合大文件的文本工具。");
            bytes.Write(buffer, 0, read);
        }
        return bytes.ToArray();
    }

    private SafeFileHandle Open(string path, bool directory) {
        // Keep checked ancestors in place and prevent changing them into reparse points.
        var handle = CreateFile(path, directory ? ReadAttributes : GenericRead, FileShare.Read,
            IntPtr.Zero, OpenExisting, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
        if (handle.IsInvalid) {
            var error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new IOException("无法访问工作区中的文件或文件夹。", new Win32Exception(error));
        }
        handles.Add(handle);
        if (!GetFileInformationByHandle(handle, out var info))
            throw new IOException("无法检查工作区路径。", new Win32Exception(Marshal.GetLastWin32Error()));
        var attributes = (FileAttributes)info.Attributes;
        if (attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("工作区不能打开或遍历链接文件及链接文件夹。");
        if (attributes.HasFlag(FileAttributes.Directory) != directory || GetFileType(handle) != 1)
            throw new IOException(directory ? "目标不是普通文件夹。" : "目标不是普通文本文档。");
        return handle;
    }

    public void Dispose() {
        for (var index = handles.Count - 1; index >= 0; index--) handles[index].Dispose();
        handles.Clear();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
        public uint VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, FileShare sharing, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);
    [DllImport("kernel32.dll")]
    private static extern uint GetFileType(SafeFileHandle handle);
}
