# Mini Mark 图标预览

2026-11-05。用户已选择 C，要求字母向左微调，界面配色清晰明亮、不要花哨。

- A：炫彩底、白色 M 与向下箭头，强调 Markdown。
- B：彩色背景、白色折角纸页，强调文档。
- C：大小双 M，呼应 Mini Mark。

`concepts/` 保存 SVG 源文件、1024px 透明背景 PNG、明暗背景与小尺寸对照图、可直接打开的 HTML 预览。运行 `node scripts/preview-branding.mjs` 可用 Microsoft Edge 重新导出预览。

正式源文件为 `public/mini-mark.svg`，字母与下划线整体左移 30/1024。Windows 多尺寸图标为 `native/Assets/mini-mark.ico`，预览为 `docs/branding/mini-mark-final.png`；运行 `node scripts/create-icon.mjs` 生成。macOS 图标脚本读取同一 SVG。

界面采用白底、浅灰分区、蓝色强调色；炫彩只用于图标。亮暗主题切换颜色过渡约 260 ms，并尊重系统减少动画偏好。

版本为 2.0.0，用户已要求双平台验证后发布。显示名、可执行文件和主要安装包统一使用 Mini Mark / MiniMark；安装 AppId、数据目录和注册表身份保持兼容。更新清单同时保留旧版验证器可接受的安装包别名，确保 v1.x 能升级。
