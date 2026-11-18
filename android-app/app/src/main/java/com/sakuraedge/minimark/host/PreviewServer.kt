package com.sakuraedge.minimark.host

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import com.sakuraedge.minimark.workspace.FolderWorkspace
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.Executors

internal class PreviewServer(
    private val context: Context,
    private val folders: FolderWorkspace,
    private val html: String,
    private val parent: String?,
) : AutoCloseable {
    private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    private val token = UUID.randomUUID().toString()
    private val workers = Executors.newFixedThreadPool(2) { task -> Thread(task, "MiniMark preview resource").apply { isDaemon = true } }
    val url = "http://127.0.0.1:${server.localPort}/$token/index.html"
    init {
        Thread({
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                workers.execute { serve(socket) }
            }
        }, "MiniMark browser preview").apply { isDaemon = true; start() }
    }
    private fun serve(socket: Socket) {
        socket.use { client ->
            client.soTimeout = 5000
            try {
                val reader = client.getInputStream().bufferedReader(Charsets.US_ASCII)
                val first = reader.readLine()?.takeIf { it.length <= 8192 } ?: return
                var headers = 0
                while (true) {
                    val header = reader.readLine() ?: return
                    if (header.isEmpty()) break
                    headers += header.length
                    require(headers <= 16_384)
                }
                val parts = first.split(' ')
                require(parts.size == 3 && parts[0] == "GET")
                val path = Uri.parse(parts[1]).path.orEmpty()
                require(path.startsWith("/$token/"))
                val relative = path.removePrefix("/$token/")
                val bytes: ByteArray
                val mime: String
                if (relative == "index.html") { bytes = html.toByteArray(Charsets.UTF_8); mime = "text/html" }
                else {
                    val directory = parent?.let(Uri::parse) ?: error("No authorized resources")
                    val uri = folders.resolveRelative(directory, relative)
                    val output = java.io.ByteArrayOutputStream()
                    context.contentResolver.openInputStream(uri)!!.use { input ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = input.read(buffer); if (count < 0) break
                            check(output.size() + count <= 20 * 1024 * 1024)
                            output.write(buffer, 0, count)
                        }
                    }
                    bytes = output.toByteArray()
                    mime = when (relative.substringAfterLast('.').lowercase()) {
                        "js", "mjs" -> "text/javascript"
                        "css" -> "text/css"
                        else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(relative.substringAfterLast('.').lowercase()) ?: "application/octet-stream"
                    }
                }
                val output = client.getOutputStream()
                output.write(("HTTP/1.1 200 OK\r\nContent-Type: $mime; charset=utf-8\r\nContent-Length: ${bytes.size}\r\n" +
                    "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
                output.write(bytes); output.flush()
            } catch (_: Exception) {
                runCatching { client.getOutputStream().write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII)) }
            }
        }
    }
    override fun close() { server.close(); workers.shutdownNow() }
}
