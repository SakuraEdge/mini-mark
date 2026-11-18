package com.sakuraedge.minimark.documents

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.AtomicFile
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

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
    writeFailed: Boolean = false,
    var revision: Long = 0,
    cloud: CloudBinding? = null,
    var parentUri: String? = null,
) {
    var name by mutableStateOf(name)
    var value by mutableStateOf(TextFieldValue(normalizeLines(body)))
    var uri by mutableStateOf(uri)
    var savedBody by mutableStateOf(savedBody?.let(::normalizeLines))
    var writeFailed by mutableStateOf(writeFailed)
    var cloud by mutableStateOf(cloud)
    val undo = mutableStateListOf<TextFieldValue>()
    val redo = mutableStateListOf<TextFieldValue>()
    val dirty: Boolean get() = (cloud?.baseline ?: savedBody) != value.text || writeFailed

    fun snapshot() = DocumentSnapshot(
        id, name, value.text, uri, savedBody, diskHash, crlf, bom, autoName, writeFailed, revision, cloud, parentUri,
    )
}

internal class DocumentStore(application: Application) : AndroidViewModel(application) {
    val documents = mutableStateListOf<LocalDocument>()
    var activeId by mutableStateOf<String?>(null)
        private set
    var loaded by mutableStateOf(false)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
    val active: LocalDocument? get() = documents.firstOrNull { it.id == activeId }
    private val resolver = application.contentResolver
    private val session = AtomicFile(File(application.filesDir, "documents.json"))
    // Queue restoration immediately behind any final write from the previous activity.
    private val restoration = sessionExecutor.submit<SessionSnapshot> { readSession() }
    private var draftWrite: ScheduledFuture<*>? = null
    private var healthy = true
    private var draftErrorShown = false
    private var cleared = false

    init {
        viewModelScope.launch {
            try {
                val restored = withContext(Dispatchers.IO) { restoration.get() }
                documents.addAll(restored.documents.map { it.toDocument() })
                activeId = restored.activeId?.takeIf { id -> documents.any { it.id == id } }
                    ?: documents.firstOrNull()?.id
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                healthy = false
                error = "草稿恢复失败。原草稿文件已保留；请将本次文档另存为文件。"
            } finally {
                loaded = true
            }
        }
    }

    fun newDocument(name: String? = null, text: String = "") {
        if (!loaded || busy) return
        require(text.length <= MAX_TEXT) { "文档超过文本大小限制。" }
        var index = 1
        while (documents.any { it.name == "未命名 $index.md" }) index++
        val doc = LocalDocument(name = name ?: "未命名 $index.md", body = text)
        documents.add(doc)
        activeId = doc.id
        persist(immediate = true)
    }

    fun select(id: String) {
        if (documents.none { it.id == id }) return
        activeId = id
        persist()
    }

    fun edit(id: String, next: TextFieldValue) {
        val doc = documents.firstOrNull { it.id == id } ?: return
        val normalized = normalizeTextValue(next)
        if (normalized.text.length > MAX_TEXT) {
            error = "文档超过 20 MB 文本大小限制。"
            return
        }
        val changed = doc.value.text != normalized.text
        if (changed) {
            doc.revision++
            pushHistory(doc.undo, doc.value)
            doc.redo.clear()
        }
        doc.value = normalized
        if (changed) {
            updateAutomaticName(doc)
            persist()
        }
    }

    fun webEdit(id: String, text: String, revision: Long, autoTitle: String? = null): Boolean {
        val doc = documents.firstOrNull { it.id == id } ?: return false
        val normalized = normalizeLines(text)
        require(normalized.length <= MAX_TEXT) { "文档超过 20 MB 文本大小限制。" }
        if (revision < doc.revision || revision == doc.revision && normalized != doc.value.text) return false
        if (normalized == doc.value.text && revision == doc.revision) return true
        doc.value = TextFieldValue(normalized)
        doc.revision = revision
        updateAutomaticName(doc)
        if (doc.autoName && headingDocumentName(normalized) == null && autoTitle != null && validDocumentName(autoTitle)) doc.name = autoTitle
        persist()
        return true
    }

    fun openCloud(owner: String, path: String, sha: String, text: String, separate: Boolean = false): LocalDocument {
        val existing = documents.firstOrNull { it.cloud?.owner.equals(owner, true) && it.cloud?.path == path }
        if (existing != null && !separate) { select(existing.id); return existing }
        if (existing != null) { existing.cloud = null; existing.autoName = false }
        val doc = LocalDocument(name = path.substringAfterLast('/'), body = text, autoName = false,
            cloud = CloudBinding(owner, path, sha, text))
        documents.add(doc); activeId = doc.id; persist(immediate = true)
        return doc
    }

    fun bindCloud(id: String, owner: String, path: String, sha: String, savedText: String) {
        val doc = documents.firstOrNull { it.id == id } ?: return
        doc.cloud = CloudBinding(owner, path, sha, savedText)
        doc.name = path.substringAfterLast('/'); doc.autoName = false
        persist(immediate = true)
    }

    fun detachCloud(id: String) {
        val doc = documents.firstOrNull { it.id == id } ?: return
        doc.cloud = null; doc.autoName = false
        persist(immediate = true)
    }

    fun cloudDeleted(owner: String, path: String, folder: Boolean) {
        documents.filter { it.cloud?.owner.equals(owner, true) && (it.cloud?.path == path || folder && it.cloud?.path?.startsWith("$path/") == true) }
            .forEach { it.cloud = null; it.autoName = false }
        persist(immediate = true)
    }

    fun cloudRenamed(owner: String, oldPath: String, path: String, sha: String) {
        documents.filter { it.cloud?.owner.equals(owner, true) && it.cloud?.path == oldPath }.forEach { doc ->
            doc.cloud = doc.cloud!!.copy(path = path, sha = sha)
            doc.name = path.substringAfterLast('/'); doc.autoName = false
        }
        persist(immediate = true)
    }

    fun insert(text: String) {
        val doc = active ?: return
        val range = doc.value.selection
        edit(doc.id, TextFieldValue(
            doc.value.text.replaceRange(range.min, range.max, text), TextRange(range.min + text.length),
        ))
    }

    fun undo() {
        val doc = active ?: return
        if (doc.undo.isEmpty()) return
        pushHistory(doc.redo, doc.value)
        doc.value = doc.undo.removeAt(doc.undo.lastIndex)
        doc.revision++
        updateAutomaticName(doc)
        persist()
    }

    fun redo() {
        val doc = active ?: return
        if (doc.redo.isEmpty()) return
        pushHistory(doc.undo, doc.value)
        doc.value = doc.redo.removeAt(doc.redo.lastIndex)
        doc.revision++
        updateAutomaticName(doc)
        persist()
    }

    fun open(uri: Uri, parentUri: String? = null, done: () -> Unit) {
        if (busy || !loaded) return
        documents.firstOrNull { it.uri?.let(Uri::parse)?.let(::uriIdentity) == uriIdentity(uri) }
            ?.let {
                if (parentUri != null) it.parentUri = parentUri
                select(it.id); done(); return
            }
        busy = true
        viewModelScope.launch {
            try {
                val record = withContext(Dispatchers.IO) {
                    keepPermission(uri)
                    val bytes = readBytes(uri)
                    val decoded = decodeDocument(bytes)
                    require(decoded.body.length <= MAX_TEXT) { "文档超过 20 MB 文本大小限制。" }
                    DocumentSnapshot(
                        UUID.randomUUID().toString(), displayName(uri), decoded.body, uri.toString(),
                        decoded.body, digest(bytes), decoded.crlf, decoded.bom, false, parentUri = parentUri,
                    )
                }
                documents.add(record.toDocument())
                activeId = record.id
                persist(immediate = true)
                done()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                error = "打开失败：${failure.message ?: "无法读取 UTF-8 文档"}"
            } finally {
                busy = false
            }
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
        val sameTarget = doc.uri?.let(Uri::parse)?.let(::uriIdentity) == targetIdentity
        if (sameTarget && (doc.writeFailed || doc.diskHash == null)) {
            error = "原文件的写入状态需要确认，请另存为新的文件以保留正文。"
            return
        }
        val snapshot = doc.snapshot()
        var writing = false
        busy = true
        viewModelScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    if (sameTarget) {
                        check(digest(readBytes(uri)) == snapshot.diskHash) {
                            "文件已被其他应用修改，请另存为以保留双方内容。"
                        }
                    }
                    val bytes = encodeDocument(snapshot.body, snapshot.crlf, snapshot.bom)
                    check(bytes.size <= MAX_BYTES) { "文档超过 20 MB。" }
                    val name = runCatching { displayName(uri) }.getOrDefault(snapshot.name)
                    // SAF providers do not offer atomic replacement. A failed write requires a fresh target.
                    writing = true
                    val stream = resolver.openOutputStream(uri, "wt") ?: throw java.io.IOException("文件不可写。")
                    stream.use { it.write(bytes); it.flush() }
                    val hash = digest(bytes)
                    check(digest(readBytes(uri)) == hash) { "文件提供者未完整保存内容。" }
                    keepPermission(uri)
                    name to hash
                }
                doc.uri = uri.toString()
                if (!sameTarget) doc.parentUri = null
                doc.name = result.first
                doc.savedBody = snapshot.body
                doc.diskHash = result.second
                doc.writeFailed = false
                doc.autoName = false
                doc.cloud = null
                persist(immediate = true)
            } catch (cancelled: CancellationException) {
                if (writing && sameTarget) doc.writeFailed = true
                persist(immediate = true)
                throw cancelled
            } catch (failure: Exception) {
                if (writing && sameTarget) doc.writeFailed = true
                persist(immediate = true)
                error = "保存失败：${failure.message ?: "无法写入文件"}" +
                    if (writing) "\n正文已保留在编辑器中，请另存为新的文件。" else ""
            } finally {
                busy = false
            }
        }
    }

    suspend fun renameLocal(id: String, requested: String) {
        check(!busy) { "请等待当前操作完成。" }
        val doc = documents.firstOrNull { it.id == id } ?: error("文档已关闭。")
        require(validDocumentName(requested)) { "文件名无效。" }
        check(doc.cloud == null) { "请通过云端重命名此文档。" }
        if (doc.uri == null) { check(renameDraft(id, requested)); return }
        val original = Uri.parse(doc.uri)
        busy = true
        try {
            val renamed = withContext(Dispatchers.IO) {
                val parent = doc.parentUri?.let(Uri::parse) ?: error("请先通过工作区打开文件夹，再重命名此文件，或使用另存为。")
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(parent, DocumentsContract.getDocumentId(parent))
                resolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { cursor ->
                    while (cursor.moveToNext()) check(cursor.getString(0) != requested) { "同一目录已有此名称。" }
                }
                DocumentsContract.renameDocument(resolver, original, requested) ?: error("文件提供者无法重命名。")
            }
            doc.uri = renamed.toString(); doc.name = requested; doc.autoName = false; persist(immediate = true)
        } finally { busy = false }
    }

    fun renameDraft(id: String, name: String): Boolean {
        val doc = documents.firstOrNull { it.id == id } ?: return false
        if (busy) return false
        if (doc.uri != null) {
            error = "已有文件请通过“另存为”使用新名称。"
            return false
        }
        val clean = name.trim()
        if (!validDocumentName(clean)) {
            error = "请输入有效文件名，最多 120 个字符、240 字节。"
            return false
        }
        doc.name = clean
        doc.autoName = false
        persist(immediate = true)
        return true
    }

    fun forget(id: String, discardChanges: Boolean = false): Boolean {
        if (busy) {
            error = "请等待当前文件操作结束。"
            return false
        }
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
        cleared = true
        super.onCleared()
    }

    private fun updateAutomaticName(doc: LocalDocument) {
        if (doc.autoName && doc.uri == null && doc.cloud == null && isMarkdown(doc.name)) {
            headingDocumentName(doc.value.text)?.let { doc.name = it }
        }
    }

    private fun persist(immediate: Boolean = false) {
        if (!loaded || !healthy || cleared) return
        val snapshot = SessionSnapshot(activeId, documents.map { it.snapshot() })
        draftWrite?.cancel(false)
        draftWrite = sessionExecutor.schedule({
            try {
                val bytes = encodeSession(snapshot).toByteArray(Charsets.UTF_8)
                val output = session.startWrite()
                try {
                    output.write(bytes)
                    session.finishWrite(output)
                } catch (failure: Exception) {
                    session.failWrite(output)
                    throw failure
                }
                viewModelScope.launch { draftErrorShown = false }
            } catch (_: Exception) {
                viewModelScope.launch {
                    if (!draftErrorShown) error = "草稿暂存失败，请保存到本地文件。"
                    draftErrorShown = true
                }
            }
        }, if (immediate) 0 else 300, TimeUnit.MILLISECONDS)
    }

    private fun readSession(): SessionSnapshot =
        if (!session.baseFile.exists() && !File(session.baseFile.path + ".bak").exists()) {
            SessionSnapshot(null, emptyList())
        } else {
            session.openRead().bufferedReader(Charsets.UTF_8).use { decodeSession(it.readText()) }
        }

    private fun uriIdentity(uri: Uri): String = runCatching {
        if (uri.scheme == "content") "${uri.authority}:${DocumentsContract.getDocumentId(uri)}"
        else uri.normalizeScheme().toString()
    }.getOrElse { uri.normalizeScheme().toString() }

    private fun keepPermission(uri: Uri) {
        runCatching {
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }.recoverCatching {
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun readBytes(uri: Uri): ByteArray =
        (resolver.openInputStream(uri) ?: throw java.io.IOException("文件不可读。")).use { input ->
            val output = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            while (true) {
                val count = input.read(chunk)
                if (count < 0) break
                check(output.size() + count <= MAX_BYTES) { "文档超过 20 MB。" }
                output.write(chunk, 0, count)
            }
            output.toByteArray()
        }

    private fun displayName(uri: Uri): String =
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0)?.takeIf(String::isNotBlank) else null
        } ?: "文档.md"

    private fun digest(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    companion object {
        // Reads and writes share one ordered queue across ViewModel lifetimes.
        private val sessionExecutor = ScheduledThreadPoolExecutor(1) { task ->
            Thread(task, "MiniMark drafts").apply { isDaemon = true }
        }.apply { removeOnCancelPolicy = true }
    }
}

private fun pushHistory(history: MutableList<TextFieldValue>, value: TextFieldValue) {
    history.add(value.copy(composition = null))
    var size = history.sumOf { it.text.length }
    while (history.size > 40 || size > MAX_TEXT * 2) {
        size -= history.removeAt(0).text.length
    }
}
