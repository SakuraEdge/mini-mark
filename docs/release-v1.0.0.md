# 墨页 Moye v1.0.0

第一个正式版本，面向 Windows 与 macOS。

## 下载

- **Windows 安装版**：`Moye-Setup-1.0.0-windows-x64.exe`
- **Windows 便携版**：`Moye-1.0.0-windows-x64.zip`，完整解压后运行 `Moye.exe`。
- **macOS 通用版**：`Moye-1.0.0-macos-universal.dmg`，将 Moye 拖入 Applications。同时支持 Apple Silicon 和 Intel，要求 macOS 13+。
- **macOS ZIP**：`Moye-1.0.0-macos-universal.zip`。
- 校验文件：`SHA256SUMS-v1.0.0.txt`。

## 本版功能

- 中文 `/公式`、`/代码`、`/表格` 等命令，兼容输入法选词确认。
- 即时 / 源码 / 阅读视图，公式排版、代码高亮、主题与专注模式。
- 多标签、独立撤销、会话与草稿恢复。
- 原生 Markdown 保存，A4 PDF 与独立 HTML 导出。
- GitHub 正式版本检测；大版本弹窗可以永久关闭，仍可手动检测。
- Windows 安装程序可勾选 `.md` 默认应用，并进入系统设置完成确认。
- macOS 使用原生 AppKit / WebKit，无需安装额外运行时。

## 安装说明

Windows 需要系统 WebView2，安装版按当前用户安装。已有 `.md` 默认关联由 Windows 保护，不会强行覆盖。升级前请先正常退出旧版。

当前发行包尚无 Windows 商业代码签名，也未完成 Apple Developer ID 签名与公证。首次运行可能出现系统来源确认；请核对本公开仓库发布页与校验和。macOS 包含本地临时签名，不代表 Apple 身份认证。无需关闭系统安全保护。

## 已知范围

尚未完成稳定 1 秒内冷启动验收；网络图片默认不加载；打开上限 20 MB，采用 UTF-8。未提供云同步、Mermaid、插件或文件夹管理。

更新检测只读取公开 GitHub Release，不上传文档，不自动执行下载的程序。PDF 导出不代替 Markdown 源文件保存。
