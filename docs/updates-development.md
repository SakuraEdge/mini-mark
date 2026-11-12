# Rev 更新维护

## 版本与清单

- `package.json.version` 是内部递增版本，与 Windows 程序集和 macOS `CFBundleVersion` 一致，负责防降级。
- `package.json.releaseVersion` 是用户看到的 Rev 版本。正式 Git 标签为 `rev-vX.Y.Z`，附件只使用 `MiniMark-Rev-X.Y.Z-*`。
- 两平台读取 `updates/rev-stable.json`，失败后读取最新正式 Release 的 `update.json`。schema 2 包含内部 `version`、公开 `releaseVersion`、实际 `tag` 和 Windows 安装器的地址、大小、SHA-256。
- 原生端严格检查 tag、Rev 文件名和 GitHub 下载路径一致。Windows 下载前后验证大小和哈希，安装前再次校验，不接受任意地址。
- 前端用内部版本判断有无更新，用 Rev 主版本决定是否自动弹窗。同主版本不弹窗，手动检测和安装仍可使用。旧提醒偏好迁移到 `moye.updates.rev.v1`，保留自动检测与关闭提醒选项，但不迁移旧的主版本提醒计数。

## 一次性过渡

旧程序的 schema 1 校验器将 `v<内部版本>` 和安装器文件名写死，无法直接识别 Rev 地址。`rev-transition.yml` 仅允许内部 4.0.1 / Rev 1.0.1，并要求安装器哈希与已经正式发布的 Rev 附件完全相同。它临时提供旧地址与 schema 1 `stable.json`，不成为 latest。

必须先确认实际旧版已通过更新通道升到 Rev v1.0.1，再删除兼容 Release。清理后将旧 `stable.json` 同步为 schema 2，避免保留已失效下载地址。尚未迁移的旧程序此后需要从正式下载页安装一次；无法同时删除写死的旧地址并承诺所有旧安装仍可自动更新。

正常的 `release.yml` 不生成过渡附件，也不发布 `v4.x` 等内部版本 Release。不要再次运行过渡工作流恢复已经清理的端点。

## 验证

`npm test` 覆盖 Rev 版本与清单生成；`test:native` 和 macOS 原生自测覆盖 schema、路径、哈希与防降级；`tests/updates.spec.ts` 覆盖同主版本静默、Rev 2 弹窗、偏好迁移和下载取消。发布后核对 6 个附件及 `rev-stable.json`。安装器不超过 256 MiB。
