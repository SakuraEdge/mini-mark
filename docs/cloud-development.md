# GitHub 云文档维护

此文档面向维护者。用户说明在 README 的“云文档”章节。

## 登录配置

Mini Mark 使用 GitHub OAuth App 的设备授权流程。注册应用并启用 Device Flow 后，将公开 Client ID 写入 `public/github-oauth.json` 的 `clientId`。开发时也可设置 `MINIMARK_GITHUB_CLIENT_ID` 环境变量。不要填写 Client Secret、个人访问令牌或其他凭据。

默认申请 `repo` scope，以便创建和读写用户自己的私有 `MiniMarkDisk`。GitHub OAuth 的这个权限范围不限于单个仓库，授权页面会显示实际范围。软件自身只访问登录用户的 `MiniMarkDisk`，不读取其他仓库。若未来改用权限更细的 GitHub App，需要同时重做安装授权、创建仓库和用户令牌刷新流程，不能仅替换 Client ID。

发布工作流会拒绝空 Client ID。真实 OAuth 登录、私有仓库创建和跨设备冲突需在发布前人工验证；模拟测试不能替代这一步。

## 模块

| 目录 | 职责 |
| --- | --- |
| `src/features/cloud` | 登录界面、目录浏览、文件位置选择、请求超时与取消 |
| `native/Cloud` | GitHub 请求、Windows 凭据管理器、文档同步协调 |
| `macos/Cloud` | GitHub 请求、macOS Keychain、文档同步协调 |
| `native/Documents/DocumentWorkspace.cs` | 本地与云端基线、恢复与脏状态 |
| `macos/Documents/DocumentStore.swift` | macOS 文档模型与会话 |
| `tests/cloud.spec.ts` | 模拟宿主协议的界面回归 |
| `native-tests/CloudTests.cs` | 模拟 GitHub HTTP、路径校验、冲突和账号隔离 |

前端 `cloudRequest` 只接受预定义动作，不能提供任意 URL。令牌和设备授权内部码不进入网页消息、会话、日志或仓库。用户看到的设备授权码不同于内部 `device_code`。

## 保存约定

- 新建和本地打开的文件默认不上传。首次云保存必须由用户选择目录和文件名。
- `CloudBinding` 保存 `owner`、`path`、`sha`、`baseline`，不存储令牌。
- 本地 `baseline` 与 `cloud.baseline` 分开保存。切回本地时，未写入本地文件的更改仍标为未保存。
- 打开云端文件时使用 metadata SHA 对应的 blob，避免把新内容与旧 SHA 混在一起。
- 更新文件必须携带原 SHA。409/422 不自动覆盖、不重试 PUT；失败保留正文和原基线。
- 同步成功只更新已发送快照的基线。关闭文档前再次检查 revision 和 dirty。
- 退出或取消登录递增会话代次，迟到结果不能变成新账号的保存成功。
- 不自动后台重试写入，避免用户切回本地后仍然上传。
- 网络请求不在启动阶段运行，云功能按用户操作发起；网络请求采用异步 API，macOS 解析与凭据操作位于独立队列。

云端文本限制为 5 MB，允许 Markdown、YAML、HTML、TXT。文件夹用 `.gitkeep` 保留。目录路径禁止绝对路径、反斜杠、空段、`.`、`..`、`.git` 和控制字符。

## macOS 免费签名

默认打包使用 `codesign --sign -` 的 ad-hoc 签名，不产生 Apple 证书，也不等于公证。免费个人团队的开发签名用于本机测试，不作为公开下载包的 Developer ID 身份。此项目不会自动注册付费 Apple Developer Program。

## 发布前检查

1. 配置公开 Client ID，并完成一次真实登录、创建私有仓库、保存、退出、重新登录。
2. 另一台设备修改同一文件，确认旧 SHA 保存失败且正文保留。
3. 执行前端、浏览器、原生和真实 WebView 测试；由 Actions 验证 macOS。
4. 发布 `Rev v1.0.0`，确认所有下载包和更新清单可获取后，再删除旧 Release。Git 标签与内部版本继续递增以兼容旧更新器。
