# 验证记录

## v0.2.0

2026-11-04，Windows x64。

- `npm run build`：TypeScript 检查与生产打包通过。
- `npm test`：15 项单元测试通过，覆盖中文命令、IME 边界和多标签状态模型。
- `npm run test:e2e`：13 项 Microsoft Edge 交互测试通过，覆盖新建保留最后输入、独立撤销、整组会话恢复、取消关闭未保存文档、MD/PDF 菜单与原有编辑功能。
- `npm run test:native`：23 项检查通过，覆盖 UTF-8、外部修改、原子替换、文档身份、同路径复用、会话迁移与恢复。
- `dotnet publish`：Windows x64 自包含发布成功，无编译警告。
- 真实桌面窗口：原有两个文档旁边新建第三个标签；切换回原文档内容完整，Ctrl+S 保存到原路径并逐字检查磁盘内容。
- 真实 PDF 菜单及原生保存对话框：将中文公式笔记保存为中文文件名 PDF；解析确认内容属于所选标签，没有混入其他标签。导出后 Markdown 路径仍为空、状态仍为未保存。
- 真实 WebView2 PDF 引擎：生成 3 页 A4 测试文件，逐页渲染检查中文、行内与块级公式、代码高亮、表格、本地图片及分页。文字可提取，未包含编辑器界面。

PDF 引擎检查可在安装 WebView2 的 Windows 环境中复现：

```powershell
node scripts/pdf-fixture.mjs test-results/pdf/review.html
dotnet run --project native-pdf-tests/Moye.PdfTests.csproj -- test-results/pdf/review.html test-results/pdf/review.pdf test-results/pdf/profile
```

测试使用隔离草稿目录，不改写真实用户会话。IME 自动测试仍为合成事件，尚未覆盖全部真实中文输入法。v0.2.0 未重新验收冷启动时间，也不宣称达到稳定 1 秒内启动；大文件压力测试和跨平台构建仍未完成。

## v0.1

2026-11-04，Windows x64。

- `npm run build`：TypeScript 检查与生产打包通过。
- `npm test`：10 项命令匹配与 IME 防误触检查通过。
- `npm run test:e2e`：10 项 Microsoft Edge 交互测试通过。
- `npm run test:native`：11 项存储检查通过。
- `dotnet publish`：Windows x64 自包含发布成功，无编译警告。
- 实际 Windows 窗口：输入 `/公式`，确认后得到三行公式块；在中间输入 `x^2 + y^2 = z^2`。
- 实际原生保存对话框：保存为中文文件名；从磁盘读取，逐字比对原始 Markdown 通过。
- 重启桌面程序：恢复之前未保存的公式草稿成功。
- 高 DPI 显示：修复初始窗口按物理像素过小的问题，侧栏与正文按屏幕缩放显示。

IME 自动测试通过合成 composition/keyboard 事件覆盖顺序边界，不等同于所有实际中文输入法验证。

尚未完成：1 秒内冷启动验收、所有输入法组合验证、跨平台构建、大文件压力测试。浏览器测试中的文件宿主协议使用模拟桥接，原生文件存储另有独立检查和手工保存验证。
