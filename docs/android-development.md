# Android 应用

2026-11-18 用户审核通过移动端设计。应用使用 Kotlin 原生宿主与离线打包的共享 Web 编辑器，包名为 `com.sakuraedge.minimark`，版本为 `1.0.3` / `103`。最低安装版本为 Android 8.0 / API 26，运行需要支持 AndroidX `WEB_MESSAGE_LISTENER` 的近期 Android System WebView。

## 界面与共享能力

`src/features/android/shell.ts` 与 `shell.css` 实现文档、工作区、云文档、设置四个入口，多文档标签、底部编辑栏、小号 `/?`、更多菜单和品牌更新入口。手机分屏上下排列，600 CSS px 起左右排列。主题、字号、标签偏好和每份文档的阅读模式保存在 WebView 私有存储。

编辑器复用 `src/editor/` 的 CodeMirror、即时排版、源码、阅读、分屏、中文命令、独立撤销重做、大纲和查找替换。YAML 使用语法高亮。公式使用现有 MathLive、KaTeX 与 Office 转换模块。图片、主题背景、插件、HTML 导出复用 `src/features/` 现有实现。

`docs/design/android-approved.html` 保留本次审核稿。原先 `android-ui.html` 继续作为早期设计记录。

## 原生宿主与协议

- `MainActivity.kt` 管理 WebView、系统文件选择、窗口 Insets、剪贴板、PDF 系统打印和 HTML 预览。
- `host/AndroidBridge.kt` 分派文档、工作区、图片、云文档与导出请求，所有文档操作使用显式 ID。
- `host/AndroidHostState.kt` 保留跨 Activity 的操作、资源登记与文件选择目标，并将后续界面操作转交给当前 Activity。`SavedStateHandle` 恢复选择器的目标文档 ID，等待中的 PDF 排版在新页面就绪后重发。
- `host/WebResources.kt` 提供打包资源与已授权文档旁的图片。`host/PreviewServer.kt` 为外部浏览器提供随机路径的 loopback 预览。
- `src/platform/android.ts` 将 Android 的消息通道接入现有 `chrome.webview` 协议。桌面调用继续使用原协议。

可信主页面固定为 `https://app.minimark.local/index.html`。AndroidX WebMessageListener 限定此 origin，并核对 `isMainFrame`。插件继续在无同源权限 iframe 与 Worker 中执行。HTML 在独立 WebView 中运行，其窗口使用独立 origin 并阻止加载应用资源。外部浏览器预览使用绑定到 `127.0.0.1` 的随机路径，只读取当前文档授权目录。

Android 新增的 `appearance` 请求仅控制系统栏明暗。保存遇到 GitHub 409/422 时，宿主发送 `cloudConflict`，携带 `documentId`、`owner`、`path`。移动端提供另存副本和保留本机草稿后在新标签打开云版本。`cloudOpenRemote` 实现后一流程，旧标签正文保持可编辑。桌面宿主继续处理已有消息。

## 文件、工作区与草稿

系统 Storage Access Framework 负责授权，应用保存可持久化 URI 权限。文档按 provider authority 与 document ID 去重。创建文件按扩展名选 MIME，保存与重名另存为保留后缀。旧的 Compose 预览草稿 `documents.json` 可直接恢复。

正文与保存基线统一为 LF，BOM 与 CRLF 作为独立元数据写回。UTF-8 使用严格编解码并拒绝 NUL。本地文档上限为 20 MB。覆盖前比较 SHA-256，写入后读回校验。保存捕获快照，稍后的编辑继续保留未保存状态。SAF 直接写入由提供者实现，写入中断可能让目标成为空文件或部分内容，应用会保留草稿并引导另存为。

`workspace/FolderWorkspace.kt` 保存树授权，按相对路径逐级枚举直接子项。在 API 29 及以上系统额外调用 `DocumentsContract.isChildDocument` 核对从属关系，API 26–28 依靠提供者的直接子项和树授权校验。每页 500 项，虚拟文档禁用。关闭工作区清除应用中的根授权登记，已打开文件保留其 URI 访问能力。Android 文档提供者决定实际后端路径，验证范围以系统 SAF 和提供者能力为准。

草稿使用 `AtomicFile` 和进程级单线程队列，300 ms 合并编辑写入。后续 ViewModel 的恢复排在上一实例最终写入之后。文件选择结果等待恢复完成后处理。突然断电或进程在写入完成前终止仍有最后一段输入丢失窗口。损坏会话保留原文件，并提示保存当前内容。

## 图片与导出

在工作区打开的 Markdown 可写入同级 `assets`，图片按 SHA-256 命名并读回检查。单文件 SAF 授权和云文档使用内嵌图片。使用本应用 `assets` 引用的文档另存到单文件目标或首次保存到云端时，将图片内嵌，避免失去资源目录。此转换会更新正文修订。手写的其他相对资源引用需在原工作区中访问。

每张图片最多 10 MB，最多 4000 万像素。云文档大小仍受 5 MB 限制。主题背景独立保存，正文与导出采用各自排版。

PDF 使用共享 HTML 排版并调用 Android PrintManager。用户在系统窗口选择“Save as PDF / 另存为 PDF”，可选择纸张、方向和目标位置。HTML 导出使用系统文件选择器。结构化公式通过 Android 剪贴板传递 HTML 与 MathML，Word/WPS 的可编辑粘贴效果需要接收应用支持。

## GitHub 云文档

`cloud/GitHubCloud.kt` 处理设备授权、账号验证、凭据刷新、私有 MiniMarkDisk 创建、目录、读取、SHA 条件保存及文件夹创建。`CloudTreeMutation.kt` 用非递归 Git tree 重建进行重命名和删除，核对原 SHA、分支 head 与目标类型，保留兄弟条目，非强制更新分支。

`EncryptedCloudCredentials` 使用 Android Keystore 的 AES-GCM 密钥，密文位于 `noBackupFilesDir/github-credential.bin`。令牌和内部设备码只留在原生层。刷新成功先持久化新令牌，再核对账号。代次校验阻止退出或取消后的迟到回执。网络使用固定 GitHub 域名、TLS、响应上限和超时，禁用重定向及网络失败自动重试。

文档保存与删除、重命名互斥。云保存使用正文快照，正文修改与本地保存基线分别保留。云端变化时停止覆盖。结果未知的网络错误需刷新核对。真实账号授权、仓库创建和跨设备读写仍需账号级验收，自动化使用隔离测试凭据和模拟 GitHub。

## 构建与验证

需要 Node.js 24、JDK 17、Android SDK Platform 35、Build Tools 35.0.0 与 Platform Tools。仓库根目录先执行 `npm ci`，设置 `JAVA_HOME`、`ANDROID_HOME`，然后在 `android-app` 执行。

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:connectedDebugAndroidTest
```

Linux/macOS 使用 `bash gradlew`。Wrapper 固定 Gradle 8.9 并校验分发包 SHA-256。Gradle 自动构建共享前端，并将输出复制到生成的 assets 目录，排除 source map。开发 APK 输出到 `app/build/outputs/apk/debug/app-debug.apk`。覆盖安装需要相同开发证书。

`WebEditorFlowTest` 在隔离英文 API 35 模拟器验证中文编辑、撤销重做、搜索重命名、关闭确认、公式表格、分屏旋转、Activity 恢复、系统保存另存为、取消、重复打开、选择期间重建、长文档软键盘、当前标签可见性、阅读模式按钮、插件及原生桥隔离。debug-only iframe 探针仅进入调试 APK。Keystore 检查使用测试目录。

JVM 测试覆盖文档、旧会话、BOM/CRLF、外部修改、部分写入失败、云与本地基线、过期 revision、账号隔离、OAuth、刷新凭据持久化、SHA 冲突和 Git tree 变更。共享前端继续通过原桌面测试集。

本机工具链位于源码外 `D:\AndroidToolchain\MiniMark`。本机 Maven Central 镜像配置位于该工具链的 Gradle cache，仓库保留标准依赖地址。详细执行结果见验证记录。[验证记录](validation.md)

## 后续验收

真实手机、真实中文输入法、API 26、不同文件提供者、大文件性能、Word/WPS 粘贴及真实 GitHub 账号全流程待验收。Android 正式签名和自动覆盖安装更新渠道待配置。当前更新检查只识别带 APK 附件的正式 Release。
