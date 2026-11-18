package com.sakuraedge.minimark.host

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import android.webkit.WebResourceResponse
import com.sakuraedge.minimark.workspace.FolderWorkspace
import java.io.ByteArrayInputStream

internal data class DocumentAccess(val id: String, val path: String?, val parent: String?)

internal class WebResources(private val context: Context, private val folders: FolderWorkspace) {
    @Volatile var documents: List<DocumentAccess> = emptyList()
    @Volatile var previewDocument: DocumentAccess? = null
    @Volatile var previewText: String? = null
    private val origin = "app.minimark.local"

    fun respond(uri: Uri, preview: Boolean = false): WebResourceResponse? {
        val host = uri.host.orEmpty()
        return try {
            when {
                host == origin -> {
                    val path = uri.path?.removePrefix("/").orEmpty().ifEmpty { "index.html" }
                    require(path.split('/').none { it == "." || it == ".." || '\\' in it })
                    val stream = context.assets.open("web/$path")
                    val headers = mutableMapOf("Cache-Control" to "no-cache", "X-Content-Type-Options" to "nosniff")
                    if (path == "index.html") headers["Content-Security-Policy"] =
                        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'"
                    WebResourceResponse(mime(path), "UTF-8", 200, "OK", headers, stream)
                }
                host == "document.moye.local" -> documentResource(uri)
                preview && host == "preview.minimark.local" -> {
                    if (uri.path == "/index.html") WebResourceResponse("text/html", "UTF-8", ByteArrayInputStream(previewText.orEmpty().toByteArray()))
                    else documentResource(uri, previewDocument)
                }
                else -> null
            }
        } catch (_: Exception) { missing() }
    }
    private fun documentResource(uri: Uri, selected: DocumentAccess? = null): WebResourceResponse {
        val access = selected ?: documents.singleOrNull { "${it.id}:${it.path.orEmpty()}" == uri.getQueryParameter("document") } ?: return missing()
        val parent = access.parent?.let(Uri::parse) ?: return missing()
        val path = uri.path.orEmpty().removePrefix("/")
        if (selected == null) require(path.substringAfterLast('.').lowercase() in setOf("png", "jpg", "jpeg", "webp", "gif", "svg"))
        val target = folders.resolveRelative(parent, path)
        val stream = context.contentResolver.openInputStream(target) ?: return missing()
        return WebResourceResponse(mime(path), "UTF-8", 200, "OK", mapOf("Access-Control-Allow-Origin" to "https://app.minimark.local", "X-Content-Type-Options" to "nosniff"), stream)
    }
    private fun mime(path: String): String = when (path.substringAfterLast('.').lowercase()) {
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "html" -> "text/html"
        "json" -> "application/json"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        "ttf" -> "font/ttf"
        "svg" -> "image/svg+xml"
        else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(path.substringAfterLast('.').lowercase()) ?: "application/octet-stream"
    }
    fun missing() = WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
}
