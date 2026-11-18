package com.sakuraedge.minimark.documents

import android.content.ContentResolver
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import com.sakuraedge.minimark.workspace.FolderWorkspace
import java.security.MessageDigest

internal class ImageAssets(private val resolver: ContentResolver, private val folders: FolderWorkspace) {
    fun embed(body: String, parent: String?): String {
        if (parent == null) return body
        val directory = Uri.parse(parent)
        val result = Regex("(!\\[[^\\]]*]\\()<?((?:\\./)?assets/[^)<>\\s]+)>?(\\))", RegexOption.IGNORE_CASE).replace(body) { match ->
            val path = Uri.decode(match.groupValues[2]).removePrefix("./")
            val uri = folders.resolveRelative(directory, path)
            val mime = resolver.getType(uri) ?: error("无法识别图片资源。")
            require(mime in setOf("image/png", "image/jpeg", "image/gif", "image/webp")) { "图片资源格式不支持。" }
            val output = java.io.ByteArrayOutputStream()
            resolver.openInputStream(uri)!!.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer); if (count < 0) break
                    check(output.size() + count <= 10 * 1024 * 1024) { "图片资源超过 10 MB。" }
                    output.write(buffer, 0, count)
                }
            }
            match.groupValues[1] + "data:" + mime + ";base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP) + match.groupValues[3]
        }
        require(result.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "内嵌图片会使文档超过 20 MB。" }
        return result
    }
    fun import(source: String, parent: String?): String {
        val prefix = Regex("^data:" + "image/(png|jpeg|gif|webp);base64,").find(source)?.value ?: error("图片格式不支持。")
        require(source.length <= 14 * 1024 * 1024) { "图片超过大小限制。" }
        val bytes = Base64.decode(source.substring(prefix.length), Base64.DEFAULT)
        require(bytes.isNotEmpty() && bytes.size <= 10 * 1024 * 1024) { "单张图片需在 10 MB 以内。" }
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        require(options.outWidth > 0 && options.outHeight > 0 && options.outWidth.toLong() * options.outHeight <= 40_000_000) { "图片像素尺寸过大或格式无效。" }
        if (parent == null) return source
        val base = Uri.parse(parent)
        val directory = runCatching { folders.resolveRelative(base, "assets") }.getOrElse {
            DocumentsContract.createDocument(resolver, base, DocumentsContract.Document.MIME_TYPE_DIR, "assets") ?: error("无法创建图片资源目录。")
        }
        val extension = prefix.substringAfter('/').substringBefore(';').let { if (it == "jpeg") "jpg" else it }
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val name = "mini-mark-$hash.$extension"
        val existing = runCatching { folders.resolveRelative(directory, name) }.getOrNull()
        if (existing != null) {
            val previous = resolver.openInputStream(existing)!!.use { it.readBytes() }
            check(previous.contentEquals(bytes)) { "已有图片资源已变化，请核对后重新插入。" }
            return "assets/$name"
        }
        val file = DocumentsContract.createDocument(resolver, directory, "image/${if (extension == "jpg") "jpeg" else extension}", name) ?: error("无法创建图片文件。")
        resolver.openOutputStream(file, "wt")!!.use { it.write(bytes); it.flush() }
        val written = resolver.openInputStream(file)!!.use { it.readBytes() }
        check(written.contentEquals(bytes)) { "图片资源保存不完整，请重试。" }
        return "assets/$name"
    }
}
