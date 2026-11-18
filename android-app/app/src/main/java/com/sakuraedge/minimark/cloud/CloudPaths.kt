package com.sakuraedge.minimark.cloud

import java.net.URLEncoder

internal object CloudPaths {
    const val MAX_BYTES = 5 * 1024 * 1024
    fun validate(path: String, folder: Boolean = false): String {
        require(path.isNotEmpty() && path.length <= 1024 && path.none { it.isISOControl() || it in "\\:?#" } &&
            path.split('/').none { it.isEmpty() || it == "." || it == ".." || it.equals(".git", true) }) { "云文档路径无效。" }
        require(folder || Regex("\\.(md|markdown|mdown|txt|yaml|yml|html|htm)$", RegexOption.IGNORE_CASE).containsMatchIn(path)) { "仅支持 Markdown、YAML、HTML 和 TXT 文档。" }
        return path
    }
    fun encode(path: String) = path.split('/').joinToString("/") { encodePart(it) }
    fun encodePart(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    fun sha(value: String): String {
        require(Regex("[a-fA-F0-9]{40}([a-fA-F0-9]{24})?").matches(value)) { "云文档版本无效。" }
        return value
    }
}
