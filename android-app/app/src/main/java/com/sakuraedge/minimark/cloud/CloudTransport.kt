package com.sakuraedge.minimark.cloud

import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URL
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

internal class CloudApiException(val status: Int, message: String) : IOException(message)

internal interface CloudTransport {
    fun request(method: String, url: String, body: String? = null, token: String? = null, form: Boolean = false): Any
}

internal class GitHubTransport : CloudTransport {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(40, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
    override fun request(method: String, url: String, body: String?, token: String?, form: Boolean): Any {
        val address = URL(url)
        require(address.protocol == "https" && address.host in setOf("github.com", "api.github.com") && address.userInfo == null)
        val request = Request.Builder().url(url).header("User-Agent", "MiniMark-Android/1.0.3")
            .header("Accept", if (form) "application/json" else "application/vnd.github+json")
        if (token != null) {
            request.header("Authorization", "Bearer $token")
            request.header("X-GitHub-Api-Version", "2022-11-28")
        }
        val media = (if (form) "application/x-www-form-urlencoded" else "application/json").toMediaType()
        request.method(method, body?.toRequestBody(media))
        client.newCall(request.build()).execute().use { response ->
            val status = response.code
            val oauthError = form && status in setOf(400, 401)
            if (status !in 200..299 && !oauthError) throw CloudApiException(status, when (status) {
                401 -> "GitHub 登录已失效，请重新登录。"
                403, 429 -> "GitHub 暂时拒绝访问，请检查仓库权限或稍后重试。"
                404 -> "云端文件或仓库不存在，或当前账号没有访问权限。"
                409, 422 -> "云端内容已改变或已有同名文件，请打开云端版本核对，或另存一份。"
                else -> "GitHub 请求失败（$status），请稍后重试。"
            })
            val input = response.body?.byteStream()
            val output = ByteArrayOutputStream()
            input.use { stream ->
                checkNotNull(stream) { "GitHub 返回了空响应。" }
                val buffer = ByteArray(8192)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    check(output.size() + count <= 8 * 1024 * 1024) { "GitHub 响应超过大小限制。" }
                    output.write(buffer, 0, count)
                }
            }
            return JSONTokener(output.toString("UTF-8")).nextValue()
        }
    }
}
