# Mini Mark v1.0.3

> 历史版本，发布时使用名称“墨页 Moye”。原安装包与校验和保持不变。


修复 Windows 首次打开或恢复带 CRLF 的草稿后，新建、打开、保存等操作不响应的问题。

- 正文与保存基线进入内存时统一换行格式；保留原文件的 BOM 和磁盘换行格式。
- 旧会话会自动规范化，不会仅因换行不同就误报未保存或版本冲突。
- 修复宿主与编辑器反复回传文档状态的循环，恢复后续按钮操作。

Windows 使用 `Moye-Setup-1.0.3-windows-x64.exe` 覆盖安装到现有目录。macOS 通用版支持 macOS 13+、Apple Silicon 和 Intel。

安装包仍未完成商业代码签名或 Apple Developer ID 公证，。
