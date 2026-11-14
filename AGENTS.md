# Mini Mark 项目协作规范

本目录是 Mini Mark 的独立源码项目。主工作区为 `D:\GPTProject\WXHelper\MiniMark`，其他工作区以 `git rev-parse --show-toplevel` 为准。

这里只存放源码、测试、构建脚本、开发文档和必要资源。已安装的软件、用户文档、草稿、GitHub 凭据、快捷方式和运行时数据不因源码任务被移动或删除。父目录 WXHelper 的产品、人设、仓库及发布约定不适用于本独立项目，不修改父项目文件。

## 开始工作

1. 执行 `git status --short`，保留已有修改，确认当前分支和工作区。
2. 阅读 `CODE_MAP.md`，再阅读目标功能对应的开发文档和 `docs/validation.md`。
3. 阅读 `docs/collaboration.md`，检查 Git 公共目录中的本地协作登记；不要仅依赖某个聊天的记忆。
4. 改动目录职责后运行 `npm run docs:map`，同步 `docs/code-map.json`。
5. 使用 `npm ci` 重建依赖，不复制旧 `node_modules`、构建产物或绝对路径配置。

## 多工作区协作

- 每项独立任务使用独立分支和 worktree；不要让两个工作区同时写入同一分支。现有工作区以 `git worktree list` 为准。
- 并行修改前登记负责人、工作区、分支、负责文件、接口约定、验证范围；按 `docs/collaboration.md` 交接。登记不替代 Git，不是自动互斥锁。
- 同一工作树内的代理先划分文件归属，公共入口、版本号、锁文件和共享协议指定单一整合者。文件重叠先协调再编辑。
- 不覆盖、重置、清理或回滚他人未交接的修改，不自动 stash；禁止未经明确要求执行破坏性 Git 操作。
- 不在其他工作区直接编辑或代替其提交。通过提交哈希交接，由整合者检查后合入；分支未经合入不算主工作区已完成。
- 发布、推送、合并、修改版本或安装用户软件由主代理统一处理，并遵循当次用户授权。普通子任务不自行发布。

## 职责与行为约定

- 按 `CODE_MAP.md` 的现有目录拆分职责，不把所有功能继续堆到 `src/app/main.ts` 或宿主入口。
- 前端、Windows 与 macOS 的共享消息协议保持一致；修改协议需列出消息、字段、兼容和失败处理。
- 内存正文和保存基线使用 LF；磁盘 BOM 与 CRLF/LF 作为元数据保留，写回时恢复。
- `revision` 只在真实编辑时递增。收到 `workspace` 时不得无条件回发 `edit`，避免冲突和重复消息形成循环。
- 异步操作必须覆盖成功、失败、取消、冲突及过期响应，不能锁死按钮或一直忙碌。
- 重命名、打开和保存操作使用明确的文档 ID，不能将活动文档正文写入另一个标签。
- 文件夹授权校验根目录及相对路径，不跟随符号链接或重解析点；关闭工作区只撤销授权，不删除文档。
- HTML 预览和插件不能获得主编辑器原生桥权限；插件使用隔离 iframe/Worker，不在主线程直接执行不受信任代码。
- 云令牌、Keychain/DPAPI 数据、用户草稿和本机配置不得进入 Git、日志、交接记录或发布包。公开 OAuth Client ID 不是令牌。
- 背景图片和用户偏好与正文、PDF、HTML 导出隔离。

## 验证

```powershell
npm ci
npm run build
npm test
npm run test:e2e
npm run test:native
npm run test:native-ui
npm run docs:map
```

- 按风险运行测试：前端至少 build/unit；交互和跨模块改动增加 e2e；存储或宿主协议改动增加 native 和真实 Windows native-ui。
- native-ui 在生产构建后运行。PDF 改动增加 `native-pdf-tests`；界面改动检查实际桌面和窄窗口截图。
- macOS 改动通过对应 Actions 的 Swift 编译、原生存储和 WKWebView smoke 验证，不把 Windows 结果描述为 macOS 已验证。
- 每个工作区使用自己的测试端口、产物目录和隔离 `MOYE_DATA_DIR`，不要覆盖用户真实会话或终止别人的测试进程。
- 记录命令、结果、提交和未覆盖范围。不得放宽断言或跳过失败测试来伪造通过。

## 版本与交付

- 独立仓库是 `SakuraEdge/mini-mark`，不要向父项目仓库提交本项目代码。
- `version` 是内部构建防降级版本，`releaseVersion` 是用户可见版本；正式标签为 `rev-vX.Y.Z`。
- 仅在用户明确要求且两平台测试通过后，使用 `.github/workflows/release.yml` 发布已验证的构建。检查附件、哈希和更新清单后才称已发布。
- 安装升级保持原程序目录、用户数据、草稿和快捷方式；不因源码维护重新安装或迁移软件。
- README 和 Release 面向用户，简洁陈述功能和限制；内部协议、协作和测试细节留在本文件、`CODE_MAP.md` 或开发文档。
- 提交前检查 `git diff --check`、`git status --short` 和实际 diff；仅提交本任务文件。
- 不提交 `node_modules/`、`dist/`、`release/`、`bin/obj/`、测试结果、本机凭据脚本和用户数据。

## Sol / DeepSeek Flash

Sol 负责计划、工具执行、整合、验证和交付，不切换主聊天模型或提供商。适合且有收益的有界草拟、常规代码或独立审查使用 DeepSeek `delegate`；只提供必要上下文和验收条件，不提供凭据或整段历史。建议必须复核后采用，同一子任务默认最多两次请求；失败则继续主代理工作并说明。
