package com.sakuraedge.minimark.host

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.lifecycle.viewModelScope
import com.sakuraedge.minimark.cloud.CloudApiException
import com.sakuraedge.minimark.documents.DocumentStore
import com.sakuraedge.minimark.documents.LocalDocument
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

internal interface HostActions {
    fun appearance(dark: Boolean)
    fun chooseFile()
    fun chooseFolder()
    fun createFile(name: String, mime: String)
    fun openExternal(url: String)
    fun confirm(message: String, accepted: () -> Unit, cancelled: () -> Unit)
    fun printDocument(html: String, name: String, document: LocalDocument)
    fun previewHtml(document: LocalDocument, browser: Boolean)
}

internal class AndroidBridge(
    private val context: Context,
    private val store: DocumentStore,
    private val state: AndroidHostState,
) {
    private val actions get() = checkNotNull(state.actions) { "界面正在恢复，请稍后重试。" }
    private val resources get() = state.resources
    private fun send(type: String, body: JSONObject = JSONObject()) { state.send(body.put("type", type)) }
    private fun reportError(message: String) = send("error", JSONObject().put("message", message))
    private fun complete() { state.documentBusy = false; send("operationComplete") }

    fun receive(message: String) {
        if (message.length > 64 * 1024 * 1024) { reportError("请求超过大小限制。"); return }
        val body = try { JSONObject(message) } catch (_: Exception) { return }
        state.viewModelScope.launch {
            try {
                while (!store.loaded) delay(10)
                dispatch(body)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                val text = failure.message ?: "操作失败，请重试。"
                val request = body.optString("requestId")
                when (body.optString("type")) {
                    "cloudRequest" -> send("cloudResponse", JSONObject().put("requestId", request).put("error", text))
                    "folderRequest" -> send("folderResponse", JSONObject().put("requestId", request).put("error", text))
                    "importImages" -> send("imagesImported", JSONObject().put("requestId", request).put("error", text))
                    "copyEquation" -> send("equationCopied", JSONObject().put("requestId", request).put("error", text))
                    else -> { reportError(text); complete() }
                }
            }
        }
    }
    private suspend fun dispatch(body: JSONObject) {
        val type = body.getString("type")
        if (type == "ready") {
            if (store.documents.isEmpty()) store.newDocument()
            publish()
            state.pendingPdf?.let { send("requestExportPdf", it) }
            store.error?.let { reportError(it); store.error = null }
            return
        }
        if (type == "rendered") return
        if (body.has("text") && body.has("revision") && body.has("documentId")) {
            store.webEdit(body.getString("documentId"), body.getString("text"), body.getLong("revision"), body.optString("autoTitle").ifBlank { null })
        }
        when (type) {
            "edit" -> return
            "appearance" -> { actions.appearance(body.optBoolean("dark")); return }
            "openExternal" -> { actions.openExternal(body.getString("url")); return }
            "cloudRequest" -> { cloudRequest(body); return }
            "folderRequest" -> { folderRequest(body); return }
            "checkUpdates" -> { checkUpdates(body); return }
            "copyEquation" -> {
                val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val math = body.getString("mathml"); val html = body.getString("html")
                check(math.length <= 500_000 && html.length <= 1_000_000) { "公式过大。" }
                manager.setPrimaryClip(ClipData.newHtmlText("Mini Mark 公式", math, html))
                send("equationCopied", JSONObject().put("requestId", body.getString("requestId"))); return
            }
            "importImages" -> { importImages(body); return }
            "pdfError" -> { state.pendingPdf = null; reportError(body.optString("message", "PDF 排版失败。")); complete(); return }
            "pdfHtml" -> {
                val pending = state.pendingPdf ?: return
                check(pending.getString("requestId") == body.getString("requestId") && pending.getString("documentId") == body.getString("documentId"))
                val doc = store.documents.firstOrNull { it.id == body.getString("documentId") } ?: error("文档已关闭。")
                actions.printDocument(body.getString("html"), doc.name, doc); state.pendingPdf = null; complete(); return
            }
        }
        if (state.documentBusy || store.busy || state.pendingPicker != null) { reportError("请等待当前文件操作完成。"); return }
        state.documentBusy = true
        val doc = if (body.has("documentId")) store.documents.firstOrNull { it.id == body.getString("documentId") }
            ?: error("目标文档已关闭，请重新选择文档。") else store.active
        when (type) {
            "new" -> { store.newDocument(body.optString("name").ifEmpty { null }, body.optString("initialText")); publish(); complete() }
            "activate" -> { store.select(body.getString("targetId")); publish(); complete() }
            "open" -> { state.pendingPicker = JSONObject().put("kind", "open"); actions.chooseFile() }
            "openWorkspaceFile" -> {
                val (uri, parent) = withContext(Dispatchers.IO) { state.folders.open(body.getString("rootId"), body.getString("path")) }
                openLocal(uri, parent.toString()); publish(); complete()
            }
            "save", "saveAs" -> {
                checkNotNull(doc)
                if (type == "save" && doc.cloud != null) { saveCloud(doc); complete() }
                else if (type == "saveAs" || doc.uri == null || doc.writeFailed) beginSave(doc)
                else { saveLocal(doc.id); complete() }
            }
            "closeTab" -> {
                val target = store.documents.firstOrNull { it.id == body.getString("targetId") }
                if (target == null) complete()
                else if (!target.dirty) closeDocument(target.id)
                else actions.confirm("“${target.name}”有未保存内容。丢弃修改并关闭？", { closeDocument(target.id) }, ::complete)
            }
            "renameDocument" -> {
                val target = store.documents.firstOrNull { it.id == body.getString("targetId") } ?: error("文档已关闭。")
                val cloud = target.cloud
                if (cloud != null) {
                    val result = state.cloud.execute(JSONObject().put("action", "rename").put("owner", cloud.owner).put("path", cloud.path).put("sha", cloud.sha).put("name", body.getString("name")))
                    store.cloudRenamed(cloud.owner, cloud.path, result.getString("path"), result.getString("sha"))
                } else store.renameLocal(target.id, body.getString("name"))
                publish(); complete()
            }
            "cloudOpen", "cloudOpenRemote" -> {
                val owner = body.getString("owner"); val path = body.getString("cloudPath")
                val existing = store.documents.firstOrNull { it.cloud?.owner.equals(owner, true) && it.cloud?.path == path }
                if (existing != null && type == "cloudOpen") { store.select(existing.id); publish(); complete(); return }
                val result = state.cloud.execute(JSONObject().put("action", "read").put("owner", owner).put("path", path))
                store.openCloud(owner, path, result.getString("sha"), result.getString("text"), type == "cloudOpenRemote")
                publish(); complete()
            }
            "cloudBind" -> {
                checkNotNull(doc)
                saveCloud(doc, body.getString("owner"), body.getString("cloudPath")); complete()
            }
            "cloudDetach" -> { checkNotNull(doc); store.detachCloud(doc.id); publish(); complete() }
            "exportHtml", "exportPlugin" -> {
                state.pendingExport = if (type == "exportHtml") body.getString("html") else body.getString("source")
                val name = if (type == "exportHtml") body.optString("name", doc?.name ?: "文档").substringBeforeLast('.') + ".html" else body.getString("name")
                state.pendingPicker = JSONObject().put("kind", "export").put("name", name)
                actions.createFile(name, if (type == "exportHtml") "text/html" else "text/javascript")
            }
            "exportPdf" -> {
                checkNotNull(doc)
                val request = JSONObject().put("requestId", java.util.UUID.randomUUID().toString()).put("documentId", doc.id).put("text", doc.value.text).put("name", doc.name)
                state.pendingPdf = request; send("requestExportPdf", request)
            }
            "runHtml" -> {
                checkNotNull(doc)
                if (doc.cloud != null) { saveCloud(doc); actions.previewHtml(doc, body.optString("target") == "chrome"); complete() }
                else if (doc.uri == null || doc.writeFailed) beginSave(doc, body.optString("target", "builtin"))
                else { saveLocal(doc.id); actions.previewHtml(doc, body.optString("target") == "chrome"); complete() }
            }
            else -> { complete(); reportError("当前操作尚不支持。") }
        }
    }
    private fun closeDocument(id: String) {
        store.forget(id, discardChanges = true)
        if (store.documents.isEmpty()) store.newDocument()
        publish(); complete()
    }
    private fun beginSave(doc: LocalDocument, run: String? = null) {
        state.pendingPicker = JSONObject().put("kind", "save").put("documentId", doc.id).put("run", run)
        val mime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(doc.name.substringAfterLast('.').lowercase()) ?: "application/octet-stream"
        actions.createFile(doc.name, mime)
    }
    fun pickerResult(uri: Uri?) {
        state.viewModelScope.launch {
            val pending = state.pendingPicker ?: return@launch
            try {
                while (!store.loaded) delay(10)
                if (uri == null) {
                    if (pending.optString("kind") == "folder") send("folderResponse", JSONObject().put("requestId", pending.getString("requestId")).put("data", JSONObject().put("cancelled", true).put("root", JSONObject.NULL).put("entries", JSONArray()).put("path", "")))
                    return@launch
                }
                when (pending.getString("kind")) {
                    "open" -> { openLocal(uri); publish() }
                    "save" -> {
                        val id = pending.getString("documentId")
                        val doc = store.documents.firstOrNull { it.id == id }
                        if (doc != null) embedAssets(doc)
                        saveLocal(id, uri); publish()
                        if (!pending.isNull("run") && doc != null) actions.previewHtml(doc, pending.optString("run") == "chrome")
                    }
                    "folder" -> {
                        val result = withContext(Dispatchers.IO) { state.folders.choose(uri) }
                        send("folderResponse", JSONObject().put("requestId", pending.getString("requestId")).put("data", result))
                    }
                    "export" -> {
                        val text = state.pendingExport ?: error("导出内容需要重新生成，请重试。")
                        withContext(Dispatchers.IO) {
                            context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                        }
                        send("notice", JSONObject().put("message", "文件已导出。"))
                    }
                }
            } catch (failure: Exception) {
                if (pending.optString("kind") == "folder") send("folderResponse", JSONObject().put("requestId", pending.getString("requestId")).put("error", failure.message ?: "无法访问文件夹。"))
                else reportError(failure.message ?: "文件操作失败。")
            } finally { state.pendingPicker = null; state.pendingExport = null; complete() }
        }
    }
    private suspend fun openLocal(uri: Uri, parent: String? = null) {
        store.error = null; store.open(uri, parent) {}
        while (store.busy) delay(10)
        store.error?.let { store.error = null; throw java.io.IOException(it) }
    }
    private suspend fun saveLocal(id: String, target: Uri? = null) {
        store.error = null; store.save(id, target)
        while (store.busy) delay(10)
        store.error?.let { store.error = null; throw java.io.IOException(it) }
        store.documents.firstOrNull { it.id == id }?.let(::saved)
        updateResources()
    }
    private suspend fun saveCloud(doc: LocalDocument, owner: String = doc.cloud!!.owner, path: String = doc.cloud!!.path) {
        val embedded = if (doc.cloud == null) embedAssets(doc) else false
        val text = doc.value.text
        val binding = doc.cloud?.takeIf { it.owner.equals(owner, true) && it.path == path }
        check(store.documents.none { it.id != doc.id && it.cloud?.owner.equals(owner, true) && it.cloud?.path == path }) { "此云文档已经在另一标签打开。" }
        try {
            val result = state.cloud.execute(JSONObject().put("action", "write").put("owner", owner).put("path", path).put("text", text).put("sha", binding?.sha))
            store.bindCloud(doc.id, owner, path, result.getString("sha"), text)
            saved(doc)
            if (embedded) publish()
        } catch (failure: CloudApiException) {
            if (failure.status in setOf(409, 422)) send("cloudConflict", JSONObject().put("documentId", doc.id).put("owner", owner).put("path", path))
            throw failure
        }
    }
    private suspend fun embedAssets(doc: LocalDocument): Boolean {
        val original = doc.value.text
        val parent = doc.parentUri
        val embedded = withContext(Dispatchers.IO) { com.sakuraedge.minimark.documents.ImageAssets(context.contentResolver, state.folders).embed(original, parent) }
        if (embedded == original) return false
        check(doc.value.text == original) { "正文已改变，请重新保存。" }
        store.webEdit(doc.id, embedded, doc.revision + 1)
        publish()
        return true
    }
    private suspend fun cloudRequest(body: JSONObject) {
        val action = body.getString("action")
        val result = if (action == "copyAuthorizationCode") {
            val code = state.cloud.authorizationCode(body.getString("code"))
            (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("GitHub 授权码", code))
            JSONObject().put("copied", true)
        } else {
            if (action in setOf("delete", "rename")) {
                check(!state.documentBusy && !store.busy) { "请等待文档保存完成。" }; state.documentBusy = true
            }
            try { state.cloud.execute(body) }
            finally { if (action in setOf("delete", "rename")) state.documentBusy = false }
        }
        if (action == "delete") { store.cloudDeleted(body.getString("owner"), body.getString("path"), body.getString("entryType") == "dir"); publish() }
        if (action == "rename") { store.cloudRenamed(body.getString("owner"), body.getString("path"), result.getString("path"), result.getString("sha")); publish() }
        send("cloudResponse", JSONObject().put("requestId", body.getString("requestId")).put("data", result))
    }
    private suspend fun folderRequest(body: JSONObject) {
        val action = body.getString("action")
        if (action == "choose") {
            check(state.pendingPicker == null) { "文件选择窗口已打开。" }
            state.pendingPicker = JSONObject().put("kind", "folder").put("requestId", body.getString("requestId")); actions.chooseFolder(); return
        }
        val result = withContext(Dispatchers.IO) { when (action) {
            "restore" -> state.folders.restore()
            "close" -> state.folders.close()
            "list" -> state.folders.list(body.getString("rootId"), body.optString("path"), body.optInt("offset"))
            else -> error("未知的工作区操作。")
        } }
        send("folderResponse", JSONObject().put("requestId", body.getString("requestId")).put("data", result))
    }
    private suspend fun importImages(body: JSONObject) {
        val doc = store.documents.firstOrNull { it.id == body.getString("documentId") } ?: error("文档已关闭。")
        val images = body.getJSONArray("images"); require(images.length() in 1..10)
        val sources = withContext(Dispatchers.IO) {
            JSONArray().also { result ->
                for (index in 0 until images.length()) {
                    val source = images.getJSONObject(index).getString("dataUrl")
                    val assets = com.sakuraedge.minimark.documents.ImageAssets(context.contentResolver, state.folders)
                    result.put(assets.import(source, if (doc.cloud == null) doc.parentUri else null))
                }
            }
        }
        check(store.documents.any { it.id == doc.id }) { "文档已关闭。" }
        send("imagesImported", JSONObject().put("requestId", body.getString("requestId")).put("sources", sources))
    }
    private suspend fun checkUpdates(body: JSONObject) {
        val result = JSONObject().put("requestId", body.getString("requestId")).put("installSupported", false)
        try {
            val releases = withContext(Dispatchers.IO) {
                com.sakuraedge.minimark.cloud.GitHubTransport().request("GET", "https://api.github.com/repos/SakuraEdge/mini-mark/releases?per_page=15") as JSONArray
            }
            val androidReleases = JSONArray()
            for (index in 0 until releases.length()) {
                val release = releases.getJSONObject(index)
                val tag = release.optString("tag_name")
                val version = tag.removePrefix("rev-v")
                val assets = release.optJSONArray("assets") ?: continue
                if (tag.startsWith("rev-v") && Regex("(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)").matches(version) && (0 until assets.length()).any { assets.getJSONObject(it).optString("name").endsWith(".apk") }) {
                    androidReleases.put(JSONObject().put("tag_name", tag).put("version", version)
                        .put("releaseVersion", version).put("draft", release.optBoolean("draft")).put("prerelease", release.optBoolean("prerelease")).put("notes", release.optString("body").take(16000)))
                }
            }
            result.put("releases", androidReleases)
            if (androidReleases.length() == 0) result.put("error", "当前仍使用 Android 开发构建，尚无正式 APK 更新附件。")
        } catch (_: Exception) { result.put("error", "暂时无法检测 Android 版本，请联网后重试。") }
        send("updateResult", result)
    }
    private fun jsonDocument(doc: LocalDocument) = JSONObject().put("id", doc.id).put("name", doc.name).put("text", doc.value.text)
        .put("baseline", doc.cloud?.baseline ?: doc.savedBody ?: "").put("revision", doc.revision).put("path", doc.uri)
        .put("cloud", doc.cloud?.json()).put("autoName", doc.autoName)
    fun publish() {
        val doc = store.active ?: return
        val tabs = JSONArray()
        store.documents.forEach { item -> tabs.put(JSONObject().put("id", item.id).put("name", item.name).put("path", item.uri)
            .put("dirty", item.dirty).put("revision", item.revision).put("cloud", item.cloud?.json()?.apply { remove("baseline") }).put("autoName", item.autoName)) }
        updateResources()
        send("workspace", JSONObject().put("tabs", tabs).put("document", jsonDocument(doc)))
    }
    private fun saved(doc: LocalDocument) { send("saved", JSONObject().put("documentId", doc.id).put("name", doc.name).put("path", doc.uri)
        .put("text", doc.cloud?.baseline ?: doc.savedBody ?: "").put("cloud", doc.cloud?.json()).put("autoName", false)) }
    private fun updateResources() { resources.documents = store.documents.map { DocumentAccess(it.id, it.uri, it.parentUri) } }
}
