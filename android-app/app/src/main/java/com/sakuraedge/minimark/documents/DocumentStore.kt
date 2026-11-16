package com.sakuraedge.minimark.documents

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.provider.DocumentsContract
import android.util.AtomicFile
import androidx.compose.runtime.*
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.UUID

internal class LocalDocument(
    val id: String = UUID.randomUUID().toString(),
    name: String,
    body: String = "",
    uri: String? = null,
    savedBody: String? = null,
    var diskHash: String? = null,
    var crlf: Boolean = false,
    var bom: Boolean = false,
    var autoName: Boolean = uri == null && isUntitledName(name),
) {
    var name by mutableStateOf(name)
    var value by mutableStateOf(TextFieldValue(body))
    var uri by mutableStateOf(uri)
    var savedBody by mutableStateOf(savedBody)
    val undo = mutableStateListOf<TextFieldValue>()
    val redo = mutableStateListOf<TextFieldValue>()
    val dirty: Boolean get() = savedBody != value.text
}

internal class DocumentStore(application: Application) : AndroidViewModel(application) {
    val documents = mutableStateListOf<LocalDocument>()
    var activeId by mutableStateOf<String?>(null)
    var loaded by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    val active: LocalDocument? get() = documents.firstOrNull { it.id == activeId }
    private val resolver = application.contentResolver
    private val session = AtomicFile(File(application.filesDir, "documents.json"))
    private val drafts = Channel<DraftWrite>(Channel.CONFLATED)
    private val draftScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var healthy = true

    init {
        viewModelScope.launch {
            try {
                val restored = withContext(Dispatchers.IO) { readSession() }
                documents.addAll(restored.documents.map { it.toDocument() })
                activeId = restored.activeId?.takeIf { id -> documents.any { it.id == id } }
                    ?: documents.firstOrNull()?.id
            } catch (_: Exception) {
                healthy = false
                error = "草稿恢复失败。原草稿文件已保留；请将本次文档另存为文件。"
            } finally { loaded = true }
        }
        draftScope.launch {
            while (true) {
                var request = drafts.receiveCatching().getOrNull() ?: break
                while (!request.immediate) {
                    val next = withTimeoutOrNull(300) { drafts.receiveCatching() } ?: break
                    request = next.getOrNull() ?: break
                }
                var output: java.io.FileOutputStream? = null
                try {
                    val json = encodeSession(request.snapshot)
                    output = session.startWrite()
                    output.write(json.toByteArray(Charsets.UTF_8))
                    session.finishWrite(output)
                } catch (_: Exception) {
                    output?.let { session.failWrite(it) }
                    withContext(Dispatchers.Main) { error = "草稿暂存失败，请保存到本地文件。" }
                }
            }
        }.invokeOnCompletion { draftScope.cancel() }
    }

    fun newDocument() {
        if (!loaded) return
        var index = 1
        while (documents.any { it.name == "未命名 $index.md" }) index++
        val doc = LocalDocument(name = "未命名 $index.md")
        documents.add(doc)
        activeId = doc.id
        persist()
    }

    fun select(id: String) {
        if (documents.none { it.id == id }) return
        activeId = id
        persist()
    }

    fun edit(id: String, next: TextFieldValue) {
        val doc = documents.firstOrNull { it.id == id } ?: return
        if (next.text.length > MAX_TEXT) { error = "单个文档不能超过 2 百万字符。"; return }
        val changed = doc.value.text != next.text
        if (changed) {
            doc.undo.add(doc.value)
            while (doc.undo.size > 40 || doc.undo.sumOf { it.text.length } > MAX_TEXT * 2) doc.undo.removeAt(0)
            doc.redo.clear()
        }
        doc.value = next
        if (changed) {
            updateAutomaticName(doc)
            persist()
        }
    }

    fun insert(text: String) {
        val doc = active ?: return
        val range = doc.value.selection
        edit(doc.id, TextFieldValue(doc.value.text.replaceRange(range.min, range.max, text), TextRange(range.min + text.length)))
    }

    fun undo() {
        val doc = active ?: return
        if (doc.undo.isEmpty()) return
        doc.redo.add(doc.value)
        doc.value = doc.undo.removeAt(doc.undo.lastIndex)
        updateAutomaticName(doc)
        persist()
    }

    fun redo() {
        val doc = active ?: return
        if (doc.redo.isEmpty()) return
        doc.undo.add(doc.value)
        doc.value = doc.redo.removeAt(doc.redo.lastIndex)
        updateAutomaticName(doc)
        persist()
    }

    fun open(uri: Uri, done: () -> Unit) {
        if (busy || !loaded) return
        documents.firstOrNull { it.uri?.let(Uri::parse)?.let(::uriIdentity) == uriIdentity(uri) }
            ?.let { select(it.id); done(); return }
        busy = true
        viewModelScope.launch {
            try {
                val record = withContext(Dispatchers.IO) {
                    keepPermission(uri)
                    val bytes = readBytes(uri)
                    val decoded = decodeDocument(bytes)
                    require(decoded.body.length <= MAX_TEXT) { "文档超过 2 百万字符。" }
                    DocumentSnapshot(UUID.randomUUID().toString(), displayName(uri), decoded.body, uri.toString(),
                        decoded.body, digest(bytes), decoded.crlf, decoded.bom, false)
                }
                documents.add(record.toDocument())
                activeId = record.id
                persist()
                done()
            } catch (failure: Exception) { error = "打开失败：${failure.message ?: "无法读取 UTF-8 文档"}" }
            finally { busy = false }
        }
    }

    fun save(id: String, target: Uri? = null) {
        val doc = documents.firstOrNull { it.id == id } ?: return
        val uri = target ?: doc.uri?.let(Uri::parse) ?: return
        if (busy || !loaded) return
        val targetIdentity = uriIdentity(uri)
        if (documents.any { it.id != id && it.uri?.let(Uri::parse)?.let(::uriIdentity) == targetIdentity }) {
            error = "该文件已在另一份文档中打开，请切换到对应文档，或另存为其他文件。"
            return
        }
        val body = doc.value.text
        val previousHash = if (doc.uri?.let(Uri::parse)?.let(::uriIdentity) == targetIdentity) doc.diskHash else null
        val crlf = doc.crlf
        val bom = doc.bom
        val fallbackName = doc.name
        busy = true
        viewModelScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    check(previousHash == null || digest(readBytes(uri)) == previousHash) { "文件已被其他应用修改，请另存为以保留双方内容。" }
                    val bytes = encodeDocument(body, crlf, bom)
                    check(bytes.size <= MAX_BYTES) { "文档超过 8 MB。" }
                    val name = runCatching { displayName(uri) }.getOrDefault(fallbackName)
                    val stream = resolver.openOutputStream(uri, "wt") ?: throw IllegalStateException("文件不可写。")
                    stream.use { it.write(bytes); it.flush() }
                    keepPermission(uri)
                    name to digest(bytes)
                }
                doc.uri = uri.toString()
                doc.name = result.first
                doc.savedBody = body
                doc.diskHash = result.second
                doc.autoName = false
                persist(immediate = true)
            } catch (failure: Exception) { error = "保存失败：${failure.message ?: "无法写入文件"}" }
            finally { busy = false }
        }
    }

    fun renameDraft(id: String, name: String) {
        val doc = documents.firstOrNull { it.id == id } ?: return
        if (doc.uri != null) { error = "已有文件请通过“另存为”使用新名称。"; return }
        val clean = name.trim()
        if (clean.isBlank() || clean.length > 120 || clean.any { it in "\\/:*?\"<>|\n\r" }) { error = "请输入 1–120 个字符的有效文件名。"; return }
        doc.name = clean
        doc.autoName = false
        persist()
    }

    fun forget(id: String, discardChanges: Boolean = false): Boolean {
        if (busy) { error = "请等待当前文件操作结束。"; return false }
        val doc = documents.firstOrNull { it.id == id } ?: return false
        if (doc.dirty && !discardChanges) {
            error = "文档有未保存修改，请先保存，或确认放弃修改后再关闭。"
            return false
        }
        documents.removeAll { it.id == id }
        if (activeId == id) activeId = documents.firstOrNull()?.id
        persist(immediate = true)
        return true
    }

    fun flushDrafts() = persist(immediate = true)

    override fun onCleared() {
        flushDrafts()
        drafts.close()
        super.onCleared()
    }

    private fun updateAutomaticName(doc: LocalDocument) {
        if (doc.autoName && doc.uri == null && doc.name.endsWith(".md", true)) {
            headingDocumentName(doc.value.text)?.let { doc.name = it }
        }
    }

    private fun persist(immediate: Boolean = false) {
        if (!loaded || !healthy) return
        // Only immutable references are copied on the UI thread; encoding and writes are serialized on IO.
        val snapshot = SessionSnapshot(activeId, documents.map { doc ->
            DocumentSnapshot(doc.id, doc.name, doc.value.text, doc.uri, doc.savedBody, doc.diskHash, doc.crlf, doc.bom, doc.autoName)
        })
        drafts.trySend(DraftWrite(snapshot, immediate))
    }

    private fun readSession(): SessionSnapshot {
        if (!session.baseFile.exists() && !File(session.baseFile.path + ".bak").exists()) return SessionSnapshot(null, emptyList())
        val root = JSONObject(session.openRead().bufferedReader().use { it.readText() })
        val array = root.getJSONArray("documents")
        val records = (0 until array.length()).map { index ->
            val row = array.getJSONObject(index)
            val name = row.getString("name")
            val uri = row.optString("uri").takeIf { it.isNotEmpty() }
            DocumentSnapshot(row.getString("id"), name, row.getString("body"), uri,
                row.optString("savedBody").takeIf { row.has("savedBody") },
                row.optString("diskHash").takeIf { it.isNotEmpty() },
                row.optBoolean("crlf"), row.optBoolean("bom"),
                row.optBoolean("autoName", uri == null && isUntitledName(name)))
        }
        require(records.map { it.id }.distinct().size == records.size) { "草稿编号重复。" }
        return SessionSnapshot(root.optString("activeId").takeIf { it.isNotEmpty() }, records)
    }

    private fun uriIdentity(uri: Uri): String {
        return runCatching {
            if (uri.scheme == "content") "${uri.authority}:${DocumentsContract.getDocumentId(uri)}"
            else uri.normalizeScheme().toString()
        }.getOrElse { uri.normalizeScheme().toString() }
    }

    private fun keepPermission(uri: Uri) {
        runCatching { resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
    }

    private fun readBytes(uri: Uri): ByteArray {
        return (resolver.openInputStream(uri) ?: throw IllegalStateException("文件不可读。")).use {
            val output = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            while (true) {
                val count = it.read(chunk)
                if (count < 0) break
                check(output.size() + count <= MAX_BYTES) { "文档超过 8 MB。" }
                output.write(chunk, 0, count)
            }
            output.toByteArray()
        }
    }

    private fun displayName(uri: Uri): String =
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "文档.md"

    private fun digest(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    companion object {
        private const val MAX_BYTES = 8 * 1024 * 1024
        private const val MAX_TEXT = 2_000_000
    }
}

private data class DocumentSnapshot(
    val id: String,
    val name: String,
    val body: String,
    val uri: String?,
    val savedBody: String?,
    val diskHash: String?,
    val crlf: Boolean,
    val bom: Boolean,
    val autoName: Boolean,
) {
    fun toDocument() = LocalDocument(id, name, body, uri, savedBody, diskHash, crlf, bom, autoName)
}

private data class SessionSnapshot(val activeId: String?, val documents: List<DocumentSnapshot>)
private data class DraftWrite(val snapshot: SessionSnapshot, val immediate: Boolean)

private fun encodeSession(snapshot: SessionSnapshot): String {
    val array = JSONArray()
    snapshot.documents.forEach { doc ->
        array.put(JSONObject().put("id", doc.id).put("name", doc.name).put("body", doc.body)
            .put("uri", doc.uri).put("savedBody", doc.savedBody).put("diskHash", doc.diskHash)
            .put("crlf", doc.crlf).put("bom", doc.bom).put("autoName", doc.autoName))
    }
    return JSONObject().put("activeId", snapshot.activeId).put("documents", array).toString()
}

internal data class DecodedDocument(val body: String, val crlf: Boolean, val bom: Boolean)

internal fun decodeDocument(bytes: ByteArray): DecodedDocument {
    val decoded = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    val content = decoded.removePrefix("\uFEFF")
    return DecodedDocument(content.replace("\r\n", "\n").replace('\r', '\n'), content.contains("\r\n"), decoded.startsWith('\uFEFF'))
}

internal fun encodeDocument(body: String, crlf: Boolean, bom: Boolean): ByteArray =
    ((if (bom) "\uFEFF" else "") + (if (crlf) body.replace("\n", "\r\n") else body)).toByteArray(Charsets.UTF_8)

internal fun isUntitledName(name: String): Boolean =
    Regex("^未命名(?: [1-9]\\d*)?\\.md$", RegexOption.IGNORE_CASE).matches(name)

internal fun headingDocumentName(body: String): String? {
    val line = body.lineSequence().firstOrNull() ?: return null
    val match = Regex("^ {0,3}#[ \\t]+(.+)$").matchEntire(line) ?: return null
    var title = match.groupValues[1].replace(Regex("[ \\t]+#+[ \\t]*$"), "").trim()
    if (title.isEmpty() || title.all { it == '#' }) return null
    title = title.replace(Regex("[<>:\"/\\\\|?*\\u0000-\\u001f\\u007f-\\u009f]"), " ")
        .replace(Regex("\\s+"), " ").trim().trimEnd('.', ' ')
    if (title.isEmpty()) return null
    if (Regex("^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)", RegexOption.IGNORE_CASE).containsMatchIn(title)) title = "_$title"
    val short = StringBuilder()
    var points = 0
    var bytes = 0
    var offset = 0
    while (offset < title.length && points < 117) {
        val point = Character.codePointAt(title, offset)
        val text = String(Character.toChars(point))
        val count = text.toByteArray(Charsets.UTF_8).size
        if (bytes + count > 237) break
        short.append(text)
        points++
        bytes += count
        offset += Character.charCount(point)
    }
    return short.toString().trimEnd('.', ' ').takeIf { it.isNotEmpty() }?.plus(".md")
}
