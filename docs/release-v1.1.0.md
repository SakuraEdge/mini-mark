# 墨页 Moye v1.1.0

新增 YAML 阅读与编辑支持，并补充标题快捷键。

- 打开 `.yaml` / `.yml` 时使用 YAML 语法解析和高亮，阅读与分屏视图保留注释、缩进、多文档分隔线和原始文本。
- Markdown 与 YAML 标签切换时保留文档正文、光标、滚动位置和撤销记录；YAML 不显示 Markdown 即时排版和斜杠命令。
- 保存、另存为、HTML/PDF 导出会识别 YAML 文件类型；浏览器预览、Windows 和 macOS 原生打开/保存对话框同步支持 `.yaml` / `.yml`。
- `Ctrl+1` … `Ctrl+6`（macOS 为 `⌘1` … `⌘6`）将当前行或选中行设置为对应标题级别，代码围栏和输入法组合不会被误改。
- Windows 安装器新增 YAML 文件关联选项，同时继续保留 `.md` 默认应用设置的系统确认流程。

Windows 使用 `Moye-Setup-1.1.0-windows-x64.exe` 覆盖安装到现有目录，数据目录与快捷方式保持不变。macOS 通用版支持 macOS 13+、Apple Silicon 和 Intel。

安装包仍未完成商业代码签名或 Apple Developer ID 公证，尚未完成稳定 1 秒内冷启动验收。
