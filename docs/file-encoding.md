# 本地文档编码

正文与保存基线统一用 LF。每份文档单独记录查看编码、BOM、CRLF 和待保存编码。初次打开按 BOM 识别 UTF-8/UTF-16，无 BOM 默认 UTF-8。无法解码时进入只读状态。用户试读成功后恢复编辑。云端正文使用 UTF-8。

`encodingRequest` 携带 `requestId`、`documentId`、`revision`、`text`、`action`、`encoding`。`previewRead` 和 `switch` 读取原始字节，要求本地正文已保存且文件指纹匹配。`previewConvert` 和 `convert` 检查整篇正文可往返编码。目标编码 ID 为 `utf-8`、`utf-8-bom`、`utf-16le`、`utf-16be`、`gbk`、`gb18030`、`windows-1252`。转换为 UTF-16 时写入对应 BOM，原样保存既有 UTF-16 时保留 BOM 状态。

宿主在应用选择后先发 `workspace`，再发带两种 ID 及 `preview` 或 `error` 的 `encodingResponse`。工作区与本地保存回执携带 `encoding`、`pendingEncoding`、`needsEncoding`、`canReinterpret`，缺失的旧字段按 UTF-8 与无待转换处理。只有真实编辑递增 revision。面板忽略过期回执，关闭取消试读。持久化的待保存编码使标签保持未保存状态。完成本地写入后清除待保存编码。

浏览器的本地文件选择器与文件夹共用编解码器。IndexedDB 按快照 ID 保留原始字节以供重载后试读。浏览器保存通过下载副本完成。Android 在打开 SAF 输出流前校验完整编码，写完后读取并验证哈希。Windows 使用原子替换，macOS 使用 Foundation 处理 GB18030 四字节字符，其他旧编码交给系统 iconv，再原子写入。
