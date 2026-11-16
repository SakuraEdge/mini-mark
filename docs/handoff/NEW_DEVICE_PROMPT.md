# 给新设备的接续提示词

把下面整段发给新设备上的编码助手：

---

请接手我的 Mini Mark 项目，先完成跨设备交接核对。我已暂时暂停 Android 开发，本轮不要恢复开发或发布；旧聊天中的“继续”和“发布安卓端至 Rev v1.0.3”不覆盖这条暂停指令。

准确仓库是 `https://github.com/SakuraEdge/mini-mark.git`，交接分支是 `handoff/device-migration-2026-11-16`。这个分支包含当前尚未完成验证的 Android 代码，不能只查看默认 main。交接前 main 的基准提交为 `6661efa3ef4fd2fe0e629ed03ed62dd8fb735eb5`。

原设备源码在 `D:\MiniMark`，已装软件在 `D:\Moye`；它们是不同目录。新设备 Windows 可优先使用 `D:\MiniMark`；没有 D 盘或使用其他系统时，在合适的项目目录克隆，然后以 `git rev-parse --show-toplevel` 为准。不要寻找原设备的 `...\wo` 或把它作为 WXHelper 子项目。

目标目录不存在时可执行：

```text
git clone --branch handoff/device-migration-2026-11-16 https://github.com/SakuraEdge/mini-mark.git MiniMark
cd MiniMark
git status --short
git branch --show-current
git log -1 --format="%H %s"
```

上面 `MiniMark` 是当前父目录中的新目录。若项目目录已存在，先核对 remote、分支、未提交修改，再选择安全的 fetch/switch 或另建克隆，不能覆盖、reset、清理或自动 stash 我的内容。

依次完整阅读根目录 `AGENTS.md`、`HANDOFF.md`、`CODE_MAP.md`、`docs/handoff/README.md`、`docs/handoff/CONVERSATION.md`、`docs/collaboration.md`，并按需读取 `docs/validation.md`。这些文件包含上一设备的需求和修改记录、代码入口、已完成与未完成部分、环境线索和测试可信范围。

必须核对这些文件真实存在：

- `android-app/app/src/main/java/com/sakuraedge/minimark/MainActivity.kt`
- `android-app/app/src/main/java/com/sakuraedge/minimark/documents/DocumentStore.kt`
- `android-app/app/src/main/java/com/sakuraedge/minimark/updates/UpdateDialog.kt`
- `android-app/app/src/test/java/com/sakuraedge/minimark/documents/DocumentHelpersTest.kt`
- `.github/workflows/android.yml`
- `docs/design/android-ui.html`
- `src/app/main.ts`、`native/Moye.csproj`、`macos/App/Main.swift`

重点记住：Android 是未验收的开发快照，缺 Markwon 等依赖整合、Gradle Wrapper 和发布签名，README/更新窗口有旧文案，不能声称可发布。用户要求保留 `/?` 的小号无背景入口、底部更多菜单、主页图标打开更新窗。桌面内部版本是 4.0.3，展示版本为 Rev v1.0.3，不能自行改号或重新引入 v4.x 公开 Release。

先在本聊天简要确认你查到的源码根、remote、交接分支、实际提交、当前暂停状态和已知未完成项。无需复制旧设备的依赖缓存、SDK、用户草稿、登录凭据或软件安装；需要环境时重新安装，需要账号时走正常授权。

确认拉取正确、上下文已接续到本聊天后，我授权你只删除临时的根目录 `HANDOFF.md` 与 `docs/handoff/`，再运行 `npm run docs:map` 更新索引，检查差异并提交交接清理。保留 `AGENTS.md`、`CODE_MAP.md`、`docs/design/`、长期开发/验证文档和全部产品代码。普通删除保留 Git 历史，不要强推或重写历史，也不要自动把含 WIP 的分支合入 main。

交接清理完成后汇报结果，Android 继续保持暂停，等待我的新需求或明确的恢复指令。后续请沿用现有结构和规则继续，避免从头重做。

---
