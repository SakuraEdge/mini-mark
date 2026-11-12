# Mini Mark Rev v1.0.0

## 云文档

- 登录自己的 GitHub 账号，连接 `MiniMarkDisk`。没有仓库时，可确认创建私有仓库。
- 按文件夹浏览和打开云端文档，保存时同步到原位置。
- 本地文档可选择“保存至云文档”，指定目录和文件名；也可切回本地文档，停止上传。
- 云端文件发生变化时提示冲突，不覆盖其他设备的修改。网络失败时保留未同步内容。

## 文件图标

Markdown、YAML 和 HTML 使用独立文档图标。Windows 安装时可选择文件关联；HTML 不会被强制设为默认应用。

## 下载

- Windows 10 / 11 x64：Rev 安装器或便携 ZIP。
- macOS 13+：通用 DMG / ZIP，支持 Apple Silicon 和 Intel。

本地编辑不需要登录。云文档通过 GitHub OAuth 授权；私有仓库所需的 `repo` 权限范围由 GitHub 授权页面显示。单个云文档最大 5 MB，相对路径图片和 HTML 外部资源不会自动上传。

macOS 包采用 ad-hoc 签名，未使用 Apple Developer ID，也未公证。Windows 包未使用商业代码签名。请从本仓库下载并核对校验和，无需关闭系统安全保护。
