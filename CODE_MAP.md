# Mini Mark 开发导航

这份文件按职责说明代码入口。完整文件索引保存在 `docs/code-map.json`，调整文件位置后执行 `npm run docs:map` 更新。

## 目录

```text
src/
  app/                 应用状态、按钮行为、快捷键、文档切换
  ui/                  窗口布局、工具栏、菜单和图标
  editor/              CodeMirror、即时排版、中文斜杠命令、IME
  documents/           文档模型、多标签会话、示例内容、换行规范化
  markdown/            Markdown/公式渲染、HTML 与 PDF 的排版内容
  platform/            前端与原生宿主的消息桥、浏览器预览文件操作
  features/updates/    检测更新界面、版本比较、提醒偏好
  features/theme/      主题偏好与渐变切换
  features/images/     图片插入、粘贴与拖入
  features/plugins/    插件管理、校验与隔离执行协议
  styles/              全局样式、主题、响应式布局和动画
native/                Windows / .NET
  Program.cs           程序入口、单实例入口与退出后启动更新
  Host/                WebView2 初始化、消息分发和原生窗口
  Documents/           文件读写、会话、外部修改检测
  Infrastructure/      数据路径和进程间通信
  Export/              原生 PDF 引擎
  Updates/             更新清单、下载、校验与缓存
macos/                 macOS / Swift
  App/                 AppKit 入口、窗口、菜单与消息协调
  Host/                WKWebView 本地资源和图片访问
  Documents/           文档存储和会话
  Export/              原生 PDF 引擎
  Updates/             更新清单和缓存
  Diagnostics/         实际 WKWebView 与存储回归
tests/                 浏览器交互测试与宿主协议模拟
native-tests/          无界面的 Windows 存储与更新检查
native-ui-tests/       真实 Windows WebView2 按钮与会话回归
native-pdf-tests/      真实 Windows PDF 引擎检查
installer/             Windows 安装、覆盖升级、快捷方式和文件关联
scripts/               打包、图标、性能、PDF 验证、文件索引生成
.github/workflows/     两平台构建、测试与经验证的发布流程
public/                图标和初始文档
docs/                  发布记录、验证记录、性能记录和生成索引
```

## 按需求找代码

| 修改内容 | 先读这些文件 |
| --- | --- |
| 按钮、菜单、快捷键 | `src/ui/layout.ts`、`src/app/main.ts` |
| 新建、标签切换、脏状态 | `src/app/main.ts`、`src/documents/workspace.ts` |
| 文档打开与保存 | `src/platform/bridge.ts`、`native/Host/MainWindow.cs`、`native/Documents/` |
| 中文命令与输入法 | `src/editor/commands.ts`、`src/editor/editor.ts` |
| Markdown、YAML、公式、代码高亮 | `src/markdown/render.ts`、`src/editor/editor.ts`、`src/documents/formats.ts` |
| PDF、HTML 导出 | `src/markdown/export.ts`、两平台的 `Export/` |
| 主题、字号、标签动画 | `src/styles/app.css`、`src/app/main.ts` |
| Mini Mark 图标与预览 | `public/mini-mark.svg`、`docs/branding/README.md`、`scripts/create-icon.mjs`、`scripts/icon-mac.mjs` |
| 图片导入与资源访问 | `src/features/images/`、`src/markdown/render.ts`、两平台 `Documents/ImageAssets`、`docs/images.md` |
| 自定义插件 | `src/features/plugins/`、`public/plugin-host.html`、`public/plugin-host.js`、`docs/plugins.md` |
| 更新、提醒、下载 | `src/features/updates/`、两平台的 `Updates/` |
| 数据盘、单实例 | `native/Infrastructure/` |
| 安装位置、快捷方式、旧文件清理 | `installer/Moye.iss`、`scripts/package-win.ps1` |
| 网络受限时的维护安装包 | `.github/workflows/local-patch.yml`；基于已经通过验证的发行包生成差异，并校验其余程序文件 |

## 消息和文档约定

`src/ui/layout.ts` 只生成界面，`src/app/main.ts` 绑定行为；文件系统和安装程序由原生宿主操作。消息类型集中在 `src/platform/bridge.ts`。

文档进入内存时，正文和保存基线都统一为 LF。磁盘原有的 BOM、LF/CRLF 单独作为元数据保存，写回文件时恢复。恢复旧会话、新建示例和收到消息时都必须遵循这个约定。`.yaml` 与 `.yml` 通过 `src/documents/formats.ts` 识别，YAML 阅读视图只做安全高亮，不执行或重排配置内容。

`revision` 只在真实编辑时增长。新建、切换、保存等请求已经携带当前正文；收到 `workspace` 时不得无条件发回 `edit`，否则会在冲突时形成消息循环。接收后的较新本地编辑仍保留在缓存中。

标题快捷键由 `src/editor/editor.ts` 以单次 CodeMirror 事务处理，当前行或选中行一起变更，并跳过代码围栏；选中可编辑行已经全部处于目标标题等级时，再按同一快捷键恢复正文。YAML 文档和阅读模式不会响应。标题跨度采用内联排版，换行高度由浏览器计算，不固定跨度高度；对应回归在 `tests/editor.spec.ts`。

未命名文档从 1 开始寻找当前标签中尚未占用的编号，不沿用持久化会话的历史计数。浏览器、Windows 和 macOS 的命名入口分别在 `src/documents/workspace.ts`、`native/Documents/DocumentWorkspace.cs`、`macos/App/Main.swift`。

实际数据目录由 `MOYE_DATA_DIR`（开发覆盖）、当前用户注册表 `Software\Moye\DataDirectory` 或默认 AppData 决定。测试必须使用隔离目录，不改写实际用户会话。

v2 的展示名、可执行文件和主要安装包使用 Mini Mark / MiniMark；AppId、数据目录和存储键保留兼容。`update.json` 的 `windows` 字段保留旧地址与兼容安装包名，`windowsV2` 使用新地址；两者必须是相同哈希的同一安装器，避免 v1.x 验证器拒绝升级。插件从主页面发送消息到无同源权限的 iframe，再在 Worker 执行；不要改成在主线程直接 eval，也不要开放原生文件或网络能力。

## 开发与验证

```powershell
npm ci
npm run dev
npm run build
npm test
npm run test:e2e
npm run test:native
npm run test:native-ui
npm run docs:map
```

`test:native-ui` 需要 Windows、.NET 8 和 WebView2，并在生产构建后运行。它会真实点击按钮，通过会话文件和消息数量检查结果。macOS 的实际运行验证在 Actions 中完成，入口为 `macos/Diagnostics/SmokeTests.swift`。

`dist/`、`release/`、`bin/`、`obj/` 和测试结果是生成物；源码修改应落在上面列出的职责目录中。发布版本和测试结果分别写入 `docs/release-v*.md` 与 `docs/validation.md`。
