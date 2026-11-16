# 跨设备交接说明

## 当前指令与位置

2026-11-16，用户要求暂停 Android 开发，把当前源码和对应的修改上下文上传 GitHub，供另一台设备接手。新设备确认接手后删除临时交接资料。此前“把安卓端发布至 Rev v1.0.3”的任务也暂停，不在交接时自动恢复或发布。

| 项目 | 内容 |
| --- | --- |
| 项目 | Mini Mark / MiniMark，原名墨页 Moye |
| 公开仓库 | `https://github.com/SakuraEdge/mini-mark.git` |
| 交接分支 | `handoff/device-migration-2026-11-16` |
| 交接前 main 提交 | `6661efa3ef4fd2fe0e629ed03ed62dd8fb735eb5` |
| 原设备真实源码根 | `D:\MiniMark` |
| 错误或历史路径 | `D:\GPTProject\WXHelper\MiniMark`、聊天默认的 `...\wo` 不是当前源码根 |
| 原设备软件安装目录 | `D:\Moye`，本次不移动、不打包用户安装和数据 |
| 桌面内部版本 | `package.json` 的 `version = 4.0.3` |
| 桌面用户版本 | `releaseVersion = 1.0.3`，正式标签规则 `rev-vX.Y.Z` |
| Android 草稿版本 | `versionName = 1.0.3`、`versionCode = 103`；这不代表已发布 |

分支包含基准提交的完整项目以及原设备未提交的 Android 相关修改。远程 `main` 不因本次迁移改变。确认上传的证据应是 GitHub 上交接分支的提交和文件，而不是旧聊天中“已完成”的描述。

## 阅读顺序

1. 根目录 `AGENTS.md`、`CODE_MAP.md`。
2. 本文与 `CONVERSATION.md`；后者是用户需求、决定和修改记录的整理，不是完整聊天数据库导出。
3. `docs/collaboration.md`、`docs/validation.md`。
4. 继续具体功能时再读对应开发文档，例如 `docs/workspace-development.md`、`docs/cloud-development.md`、`docs/updates-development.md`。

## 代码结构与桌面端

- `src/`：共享 TypeScript 前端，使用 CodeMirror、Markdown/公式渲染与功能模块。
- `native/`：Windows .NET / WebView2 宿主；`macos/`：Swift / AppKit / WKWebView 宿主。
- `installer/`、`scripts/`、`.github/workflows/`：安装、构建、验证与发布。
- `tests/`、`native-tests/`、`native-ui-tests/`、`native-pdf-tests/`：各层测试。
- `CODE_MAP.md` 为人工导航，`docs/code-map.json` 由 `npm run docs:map` 生成。

桌面已有多文档、工作区、Markdown/YAML/HTML、公式、PDF、图片、插件、主题背景、GitHub 云文档与更新等代码。不要把 Android 未完成功能误当成桌面缺失功能，也不要重做现有实现。

本次保留的桌面相关未提交文件原本包括：`CODE_MAP.md`、`docs/code-map.json`、`scripts/code-map.mjs`，以及 README / Rev v1.0.3 发布说明中的 Android 草稿介绍。桌面产品代码在本次交接中未继续开发。

## Android 暂停位置

`android-app/` 使用 Kotlin / Jetpack Compose，包名 `com.sakuraedge.minimark`，最低 API 26、compile/target API 35；AGP 8.7.3、Kotlin 2.0.21。以下是源码中已写入的路径，不是最终运行验收结论：

- `app/src/main/java/com/sakuraedge/minimark/MainActivity.kt`：文档库、搜索、新建、Android SAF 打开/保存/另存为、源码/阅读/分屏、撤销/重做、插入文本、更多菜单、`/?` 快捷指令入口，以及点击主页品牌打开更新窗口。
- `.../documents/DocumentStore.kt`：ViewModel 文档状态、IO 协程、草稿暂存、UTF-8/BOM/换行处理、文件修改冲突检测、H1 自动命名、文档大小限制。
- `.../updates/UpdateDialog.kt`：版本窗口和打开 GitHub 发布页；没有实现 Android 在线更新源或下载更新。
- `app/src/test/java/.../documents/DocumentHelpersTest.kt`：10 个辅助函数测试，尚未完成当前快照的执行。
- `.github/workflows/android.yml`：独立 Android 预览构建草稿，只生成未签名 release APK 和 SHA-256；没有上传正式 Release 的步骤。

恢复 Android 开发时优先处理这些已知未完成事项：

1. `MainActivity.kt` 已引用 `io.noties.markwon.Markwon`，但 app Gradle 尚未声明 Markwon；需核对 `activity-ktx`、`lifecycle-viewmodel-ktx` / 协程依赖和 JUnit 测试依赖。此前建议的坐标为 Markwon core 4.6.2、activity-ktx 1.10.0、lifecycle-viewmodel-ktx 2.8.7，尚未整合，不应照抄后声称通过。
2. 项目没有 Gradle Wrapper。CI 配置 Gradle 8.9；原设备曾用外部 Gradle 8.11.1。需要在恢复任务后统一可复现的构建入口。
3. 当前源码替换发生在早期 Debug 构建之后；最终本地编辑器与存储实现没有完成编译、测试或实机验收。
4. README、Release 文档及 `UpdateDialog.kt` 中仍有早期“仅 UI、未接入存储/含云文档界面”的描述，与较新的本地编辑器源码不完全一致。恢复后按实际验收结果统一文案。
5. Android GitHub 登录/云同步、目录工作区、PDF、完整图片管理、HTML 运行、主题/插件等桌面功能尚未完成移动端接入。当前图片按钮主要插入 Markdown 占位文本，公式入口主要插入 `$$` 文本。
6. 还需检查 IME/键盘遮挡、屏幕旋转、长文档分屏滚动、草稿生命周期、异步保存期间继续编辑、文件提供者写入失败和冲突行为。单凭源码检查不能确认这些场景安全可用。
7. 没有 Android 正式发布签名配置/密钥，也没有完成可安装的正式 APK、远程附件核验或 Android 发布。不要发布未签名 APK，也不要拿旧 Debug APK冒充当前版本。

用户确认过的 UI 意图见 `../design/android-ui.html`，是独立参考稿；界面中出现的账号、云同步状态、文件列表和版本号是演示内容，不是账号授权或功能完成证据。

## 本地环境与验证可信度

原设备曾使用以下工具路径，仅作定位线索，不要写入新设备的构建配置：

- JDK：`D:\Program Files\Java\jdk-21`。
- Android SDK：`D:\cocosProject\android-toolchain\sdk`。
- Gradle：`D:\cocosProject\android-toolchain\gradle-8.11.1\bin\gradle.bat`。
- 曾因 Maven TLS/AAPT2 获取问题，临时通过 `-Pandroid.aapt2FromMavenOverride=<本机SDK>\build-tools\35.0.0\aapt2.exe` 构建较早的界面骨架。

上一阶段聊天记录有 `npm ci`、桌面 `npm run build`、36 项前端测试与 4 项清单测试通过，以及较早 Android 骨架 Debug 构建通过的记录。这些不是当前 Android 快照通过的证明。旧 APK、构建缓存和已装 SDK 不随 Git 迁移。

本次是源码交接：只检查差异、文件完整性、排除项、目录索引与远程提交，不继续执行 Android 开发，也不将历史测试当作本次复测。桌面各版本的长期验证记录仍以 `docs/validation.md` 为准；本次没有创建或修改任何 Release、标签或更新源。

新设备如需恢复桌面验证，先运行 `npm ci`，再按 `AGENTS.md` 选择 `npm run build`、`npm test` 等命令。Windows 原生需要 .NET 8 和 WebView2；macOS 编译与 WKWebView 验证必须在 macOS / Actions 上执行。

## 接手与清理

1. 克隆明确的交接分支，或在已有仓库确认 remote、工作区干净后 fetch / switch；不要覆盖本地修改。
2. 查看 `git log -1`、`git status --short`、上述入口与 UI 设计稿，确认 Android WIP 以及交接前 main 基准都在历史中。
3. 在新设备聊天中说明仓库、分支、提交、源码根、暂停状态和已知阻塞；将需要保留的上下文接续到该聊天。
4. 成功核对后，按用户已给出的授权，仅删除根目录 `HANDOFF.md` 和 `docs/handoff/`。保留 `docs/design/`、所有产品源码、`AGENTS.md`、`CODE_MAP.md`、长期验证与发布文档。
5. 运行 `npm run docs:map`，检查 diff 后可以提交这次交接清理；不要为了清理合入 main、删除源码或重写 Git 历史。
6. Android 继续暂停；新设备等待用户的新任务或明确恢复开发指令。

临时文件的普通 Git 删除只移除新提交中的文件，旧提交仍保留交接记录。交接资料没有凭据或用户正文；若未来要求清除公开历史，那是另一项需明确范围的任务。

## 不随仓库迁移的内容

`node_modules/`、`dist/`、`release/`、Android/原生 build 缓存、`local.properties`、用户文档/草稿、GitHub 令牌、Windows 凭据管理器/DPAPI、macOS 钥匙串、签名密钥、SDK 与已安装软件不在交接中。新设备需要时重新安装工具或通过正常登录流程授权；不要从原机拷贝凭据。

Sol 保持主代理，适合的有界任务可按 `AGENTS.md` 使用 DeepSeek Flash，结果必须复核。新设备没有对应插件时按该文件的后备方式处理；不要把此协作偏好解释为切换主聊天模型。
