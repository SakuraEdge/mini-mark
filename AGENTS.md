# 项目维护约定

- 先读 `CODE_MAP.md`。`docs/code-map.json` 是可重新生成的文件索引；移动代码后运行 `npm run docs:map`。
- 按现有职责目录添加功能，保持 Windows 与 macOS 的共享消息协议一致。
- 内存中的正文和基线使用 LF，磁盘换行格式和 BOM 保留在元数据中。
- 不要在 `workspace` 接收回调中无条件发回 `edit`。版本冲突、重复消息和取消操作都必须能结束，不能锁死后续按钮。
- 存储或宿主协议修改需运行 `test:native`、`test:e2e`，并在 Windows 运行真实的 `test:native-ui`。平台改动依靠对应 Actions 验证。
- 测试使用隔离数据目录，不删除或覆盖用户草稿。安装升级需保持程序目录、数据和快捷方式一致。
