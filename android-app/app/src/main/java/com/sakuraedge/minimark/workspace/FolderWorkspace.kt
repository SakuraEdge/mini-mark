package com.sakuraedge.minimark.workspace

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

internal class FolderWorkspace(private val context: Context) {
    private val resolver = context.contentResolver
    private val preferences = context.getSharedPreferences("workspace", Context.MODE_PRIVATE)
    private var tree: Uri? = null
    private var rootId = UUID.randomUUID().toString()
    private var rootName = ""
    private data class Entry(val id: String, val name: String, val mime: String, val flags: Int)

    @Synchronized fun choose(uri: Uri): JSONObject {
        resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        val root = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
        val detail = metadata(root)
        check(detail.mime == DocumentsContract.Document.MIME_TYPE_DIR) { "请选择文件夹。" }
        tree = uri; rootName = detail.name; rootId = UUID.randomUUID().toString()
        check(preferences.edit().putString("uri", uri.toString()).commit()) { "无法保存文件夹授权。" }
        return list(rootId, "", 0)
    }

    @Synchronized fun restore(): JSONObject {
        if (tree == null) {
            val saved = preferences.getString("uri", null) ?: return empty()
            val uri = Uri.parse(saved)
            check(resolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }) { "文件夹授权已失效，请重新选择。" }
            val root = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
            rootName = metadata(root).name; tree = uri
        }
        return list(rootId, "", 0)
    }

    @Synchronized fun close(): JSONObject {
        // Open documents may share the tree grant, so revoke workspace access in our registry.
        tree = null; rootName = ""; rootId = UUID.randomUUID().toString()
        check(preferences.edit().remove("uri").commit()) { "无法关闭工作区。" }
        return empty()
    }

    @Synchronized fun list(expectedRoot: String, path: String, offset: Int): JSONObject {
        check(expectedRoot == rootId) { "工作区授权已改变。" }
        require(offset >= 0) { "目录分页无效。" }
        val directory = resolve(path)
        check(metadata(directory).mime == DocumentsContract.Document.MIME_TYPE_DIR) { "该路径不是文件夹。" }
        val children = children(directory).sortedWith(compareBy<Entry> { it.mime != DocumentsContract.Document.MIME_TYPE_DIR }.thenBy { it.name.lowercase() })
        val result = JSONArray()
        children.drop(offset).take(500).forEach { entry ->
            val folder = entry.mime == DocumentsContract.Document.MIME_TYPE_DIR
            val virtual = entry.flags and DocumentsContract.Document.FLAG_VIRTUAL_DOCUMENT != 0
            val valid = validSegment(entry.name) && !virtual
            val supported = valid && (folder || supported(entry.name))
            result.put(JSONObject().put("name", entry.name).put("path", if (path.isEmpty()) entry.name else "$path/${entry.name}")
                .put("type", if (folder) "directory" else "file").put("supported", supported).put("link", virtual))
        }
        return JSONObject().put("root", root()).put("path", path).put("entries", result)
            .put("nextOffset", if (offset + 500 < children.size) offset + 500 else JSONObject.NULL)
    }

    @Synchronized fun open(expectedRoot: String, path: String): Pair<Uri, Uri> {
        check(expectedRoot == rootId) { "工作区授权已改变。" }
        check(supported(path)) { "此格式暂不支持编辑。" }
        val uri = resolve(path)
        val detail = metadata(uri)
        check(detail.mime != DocumentsContract.Document.MIME_TYPE_DIR && detail.flags and DocumentsContract.Document.FLAG_VIRTUAL_DOCUMENT == 0) { "只能打开普通文件。" }
        return uri to resolve(path.substringBeforeLast('/', ""))
    }

    fun resolveRelative(parent: Uri, path: String): Uri {
        require(path.isNotEmpty()) { "资源路径为空。" }
        var current = parent
        path.split('/').forEach { part ->
            require(validSegment(part)) { "资源路径越出授权目录。" }
            val child = children(current).singleOrNull { it.name == part } ?: error("资源不存在。")
            check(child.flags and DocumentsContract.Document.FLAG_VIRTUAL_DOCUMENT == 0) { "不支持虚拟资源。" }
            val next = DocumentsContract.buildDocumentUriUsingTree(parent, child.id)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                check(DocumentsContract.isChildDocument(resolver, current, next)) { "资源超出授权文件夹。" }
            }
            current = next
        }
        return current
    }
    private fun resolve(path: String): Uri {
        val selected = tree ?: error("尚未打开工作区。")
        val root = DocumentsContract.buildDocumentUriUsingTree(selected, DocumentsContract.getTreeDocumentId(selected))
        return if (path.isEmpty()) root else resolveRelative(root, path)
    }
    private fun children(parent: Uri): List<Entry> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(parent, DocumentsContract.getDocumentId(parent))
        val result = mutableListOf<Entry>()
        resolver.query(uri, columns, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) result.add(Entry(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getInt(3)))
        } ?: error("无法读取文件夹。")
        return result
    }
    private fun metadata(uri: Uri): Entry = resolver.query(uri, columns, null, null, null)?.use { cursor ->
        check(cursor.moveToFirst()) { "文件夹或文件已失效。" }
        Entry(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getInt(3))
    } ?: error("无法读取文件信息。")
    private fun root() = JSONObject().put("id", rootId).put("name", rootName).put("path", rootName)
    private fun empty() = JSONObject().put("root", JSONObject.NULL).put("entries", JSONArray()).put("path", "")
    companion object {
        private val columns = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_FLAGS)
        fun validSegment(value: String): Boolean = value.isNotBlank() && value !in setOf(".", "..") && value.none { it.isISOControl() || it in "/\\" }
        fun supported(name: String) = Regex("\\.(md|markdown|mdown|txt|yaml|yml|html|htm)$", RegexOption.IGNORE_CASE).containsMatchIn(name)
    }
}
