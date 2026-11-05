<div align="center">

<img src="public/mini-mark.svg" width="84" height="84" alt="Mini Mark 图标">

# Mini Mark

**轻快写作，清晰表达。**

为 Windows 与 macOS 打造的 Markdown / YAML 编辑器。
中文公式、实时分屏、图片和自定义插件，让想法留在自己的电脑里。

[![Release](https://img.shields.io/github/v/release/SakuraEdge/mini-mark?color=286bd6&label=Download)](https://github.com/SakuraEdge/mini-mark/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-526a85)](LICENSE)

[下载 Windows 版](https://github.com/SakuraEdge/mini-mark/releases/latest/download/MiniMark-Setup-2.0.0-windows-x64.exe) · [下载 macOS 版](https://github.com/SakuraEdge/mini-mark/releases/latest/download/MiniMark-2.0.0-macos-universal.dmg) · [全部版本](https://github.com/SakuraEdge/mini-mark/releases)

</div>

![Mini Mark：清爽的编辑界面](docs/mini-mark-editor.png)

## 写作需要的，放在顺手的位置

| | |
| --- | --- |
| **中文命令** | 输入 `/公式`、`/代码`、`/表格`，不用记住所有符号 |
| **四种视图** | 即时排版、源码、阅读、分屏，适合不同写作习惯 |
| **图片** | 选择文件、拖入或粘贴，也可以使用图片网址 |
| **清晰排版** | 数学公式、语法高亮、表格、任务清单与大纲 |
| **多文档** | 标签切换、独立撤销、草稿恢复，不打断当前思路 |
| **YAML** | 保留注释和缩进，编辑配置文件也能看得清楚 |
| **自定义插件** | 用 JavaScript 编写自己的文字处理命令 |
| **分享成果** | 保存 Markdown / YAML，导出 PDF 或 HTML |

亮色界面采用白底与清爽蓝色，深色主题适合夜间。主题切换平滑过渡，也支持系统“减少动画”偏好。

## 从 `/公式` 开始

在空白行输入 `/公式`，按回车，就能开始填写：

```latex
$$
a^2 + b^2 = c^2
$$
```

离开公式所在行，即时视图会自动排版。输入 `/` 可浏览全部命令，也支持拼音和英文前缀。

| 输入 | 插入内容 |
| --- | --- |
| `/公式` / `/gongshi` / `/math` | 块级公式 |
| `/行内公式` | 行内公式 |
| `/代码` | 代码块 |
| `/表格` | Markdown 表格 |
| `/待办` | 任务清单 |
| `/引用` | 引用段落 |

## 图片与插件

**图片：** 点击工具栏图片按钮，或直接拖入、粘贴 PNG、JPEG、GIF、WebP。已保存文档的图片放在旁边的 `assets` 文件夹；未保存草稿中的图片内嵌保存。分享文档时，记得一并携带相对图片资源。[图片使用说明](docs/images.md)

**插件：** 打开“更多 → 插件”，可以导入 `.js` 文件，也可以从内置示例开始修改。插件能插入内容、处理选中文字、替换全文、统计并展示结果；修改支持撤销。[编写自己的插件](docs/plugins.md)

## 下载与安装

| 系统 | 安装版 | 便携 / 压缩包 |
| --- | --- | --- |
| Windows 10 / 11，x64 | [下载 EXE](https://github.com/SakuraEdge/mini-mark/releases/download/v2.0.0/MiniMark-Setup-2.0.0-windows-x64.exe) | [下载 ZIP](https://github.com/SakuraEdge/mini-mark/releases/download/v2.0.0/MiniMark-2.0.0-windows-x64.zip) |
| macOS 13 或更新版本 | [下载 DMG](https://github.com/SakuraEdge/mini-mark/releases/download/v2.0.0/MiniMark-2.0.0-macos-universal.dmg) | [下载 ZIP](https://github.com/SakuraEdge/mini-mark/releases/download/v2.0.0/MiniMark-2.0.0-macos-universal.zip) |

macOS 通用版支持 **Apple Silicon 与 Intel**。[查看 SHA-256 校验和](https://github.com/SakuraEdge/mini-mark/releases/download/v2.0.0/SHA256SUMS-v2.0.0.txt)

**Windows：** 运行安装程序，可选择桌面快捷方式和 Markdown / YAML 文件关联。默认应用的最终选择由 Windows 设置确认。便携版完整解压后运行 `MiniMark.exe`。需要系统安装 Microsoft Edge WebView2 Runtime。

**macOS：** 打开 DMG，将 `Mini Mark.app` 拖入 Applications。从原“墨页 Moye”升级时，新应用会继续读取原有草稿；确认文档恢复后，可移除旧的 `Moye.app`，避免两个入口混淆。

**首次运行提示：** 安装包尚未使用 Windows 商业代码签名或 Apple Developer ID 公证，系统可能要求确认来源。请从本仓库下载并核对校验和，无需关闭系统安全保护。

## 常用快捷键

| 操作 | Windows | macOS |
| --- | --- | --- |
| 新建 / 打开 / 保存 | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` | `⌘N` / `⌘O` / `⌘S` |
| 另存为 | `Ctrl+Shift+S` | `⌘⇧S` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` | `⌘Z` / `⌘⇧Z` |
| 加粗 / 斜体 / 链接 | `Ctrl+B` / `Ctrl+I` / `Ctrl+K` | `⌘B` / `⌘I` / `⌘K` |
| 查找 | `Ctrl+F` | `⌘F` |
| 切换标题等级 | `Ctrl+1` 至 `Ctrl+6` | `⌘1` 至 `⌘6` |
| 关闭当前标签 | `Ctrl+W` | `⌘W` |

相同标题快捷键再按一次，恢复普通正文。标题可作用于当前行或选中行。

## 保存、更新与隐私

PDF 是阅读副本，不替代 Markdown 源文件。导出 PDF 后，仍需保存文档本身。HTML 导出内嵌公式字体；相对图片保持原路径，分享时需携带资源文件。

“更多 → 检测更新”可查看新版本。Windows 支持下载并覆盖更新，沿用原安装目录并保留文档和草稿；大版本升级会提醒，可以勾选不再弹出。

文档保存在本机，不需要账号，没有云同步或遥测。基础编辑和本地图片可离线使用；更新检测与 HTTPS 外链图片需要网络。草稿恢复不等于正式保存，请定期保存重要文件。

当前支持 UTF-8 文本，打开上限为 20 MB。暂不支持 Mermaid、文件夹管理和云同步。插件目前用于文字处理和结果展示，不开放网络、任意文件读写或后台常驻能力。

---

遇到问题？请[提交反馈](https://github.com/SakuraEdge/mini-mark/issues)，附上系统、版本和复现步骤；分享示例文档前请移除个人信息。

MIT License · 原名墨页 Moye
