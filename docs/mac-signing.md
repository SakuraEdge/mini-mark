# macOS 签名

## 当前状态

Mini Mark 的公开构建使用 ad-hoc 签名，只验证包内容完整性。尚未取得用户的 Apple 开发证书，也未进行 Developer ID 签名或 Apple 公证。

不自动加入付费 Apple Developer Program，不填写付款信息，不把个人开发证书当作公开分发证书。

## 免费个人开发证书

需要用户自己的 Mac、Xcode 和 Apple Account。Windows 本机与 GitHub 托管构建机不能代替用户在 Xcode 中建立 Personal Team。不要将 Apple 账号密码、验证码、证书私钥或导出的 `.p12` 文件提交到仓库。

在用户的 Mac 上：

1. 打开 Xcode 的 Settings，进入 Accounts，添加 Apple Account。登录、双重认证由用户完成。
2. 选择账号下的 Personal Team，进入 Manage Certificates。
3. 创建 Apple Development 证书。最终创建动作需用户确认。
4. 在该 Mac 的钥匙串中确认有相应证书和配对私钥，不只是一份 `.cer` 文件。
5. 用下面的只读命令确认存在有效的代码签名身份：

```bash
security find-identity -v -p codesigning
```

Personal Team 的证书及描述文件由 Xcode 管理，适用于个人设备开发测试，相关配置存在有效期及设备数量限制。这不是让其他用户下载后获得 Gatekeeper 信任的免费方案。

## 本机验证

先在 Mac 完成 `npm ci`、`npm run build` 和 `bash scripts/package-mac.sh`，再把输出的应用复制为独立的个人测试副本。只对副本签名，不修改已经核验的公开发布包。

把下方 `IDENTITY` 替换为上一步查到的证书 SHA-1：

```bash
IDENTITY="YOUR_APPLE_DEVELOPMENT_IDENTITY_SHA1"
APP="release/mac/Mini Mark Personal.app"
ditto "release/mac/Mini Mark.app" "$APP"
codesign --force --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign --display --verbose=4 "$APP"
```

核对实际 Authority、TeamIdentifier 与签名验证结果。`codesign --verify` 通过仅说明代码签名验证通过，不代表通过公证或具备公开分发资质。以实际 Xcode 团队权限为准，不绕过系统安全提示。

## 官方资料

- [Apple Developer account overview](https://developer.apple.com/help/account/basics/developer-account-overview/)
- [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)

核对日期：2026-11-12。
