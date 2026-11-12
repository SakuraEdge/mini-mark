using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Moye;

public sealed class WindowsTokenStore(string dataRoot) : ICloudTokenStore {
    private readonly string target = "MiniMark/GitHub/" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(dataRoot))));
    public string? Read() {
        if (!CredRead(target, 1, 0, out var pointer)) {
            if (Marshal.GetLastWin32Error() == 1168) return null;
            throw new IOException("无法读取 Windows 凭据管理器。");
        }
        try {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            return Marshal.PtrToStringUni(credential.Blob, (int)credential.BlobSize / 2);
        } finally { CredFree(pointer); }
    }
    public void Write(string token) {
        var blob = Marshal.StringToCoTaskMemUni(token);
        try {
            var credential = new Credential { Type = 1, Target = target, UserName = "MiniMark", BlobSize = (uint)Encoding.Unicode.GetByteCount(token), Blob = blob, Persist = 2 };
            if (!CredWrite(ref credential, 0)) throw new IOException("无法保存 GitHub 登录凭据。", new Win32Exception(Marshal.GetLastWin32Error()));
        } finally { Marshal.ZeroFreeCoTaskMemUnicode(blob); }
    }
    public void Clear() {
        if (!CredDelete(target, 1, 0) && Marshal.GetLastWin32Error() != 1168) throw new IOException("无法移除 GitHub 登录凭据。");
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential {
        public uint Flags, Type;
        public string Target;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint BlobSize;
        public IntPtr Blob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string? Alias;
        public string UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredWrite(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credential);
}
