package com.sakuraedge.minimark.cloud

import android.util.Base64
import com.sakuraedge.minimark.documents.decodeDocument
import com.sakuraedge.minimark.documents.encodeDocument
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger

internal data class CloudFile(val path: String, val sha: String, val text: String)

internal class GitHubCloud(
    private val store: CloudCredentialStore,
    private val clientId: () -> String,
    private val transport: CloudTransport = GitHubTransport(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val gate = Mutex()
    private val authLock = Any()
    private val epoch = AtomicInteger()
    private var loaded = false
    private var credential: JSONObject? = null
    private var pendingPersistence = false
    private var verifiedAt = 0L
    private var pending: DeviceLogin? = null
    val generation: Int get() = epoch.get()
    private data class DeviceLogin(val id: String, val code: String, val userCode: String, val expires: Long, val interval: Int, val next: Long)

    fun cancelLogin() = synchronized(authLock) { epoch.incrementAndGet(); pending = null }
    fun logout() = synchronized(authLock) {
        epoch.incrementAndGet(); pending = null; credential = null; loaded = true; verifiedAt = 0; pendingPersistence = false
        store.clear()
    }
    fun authorizationCode(value: String): String = synchronized(authLock) {
        val login = pending ?: throw IOException("授权已取消，请重新登录。")
        check(login.expires > clock() && login.userCode == value) { "授权码已过期，请重新登录。" }
        login.userCode
    }
    fun checkGeneration(expected: Int) { check(expected == generation) { "登录状态已改变，请重新操作。" } }

    suspend fun execute(body: JSONObject): JSONObject {
        when (body.getString("action")) {
            "cancelLogin" -> { cancelLogin(); return JSONObject().put("cancelled", true) }
            "logout" -> { logout(); return statusValue(false) }
        }
        val requestedGeneration = generation
        return gate.withLock {
            val result = withContext(Dispatchers.IO) {
                checkGeneration(requestedGeneration)
                executeLocked(body)
            }
            val changedByLogin = body.getString("action") == "startLogin" || body.getString("action") == "pollLogin" && result.optBoolean("authenticated")
            checkGeneration(requestedGeneration + if (changedByLogin) 1 else 0)
            result
        }
    }

    private fun executeLocked(body: JSONObject): JSONObject {
        val stamp = generation
        if (body.getString("action") !in setOf("startLogin", "pollLogin")) load()
        fun value(key: String) = body.optString(key, "")
        return when (body.getString("action")) {
            "status" -> {
                if (credential == null) statusValue(false)
                else try { verifiedAt = 0; statusValue(true).put("login", account(stamp)) }
                catch (error: CloudApiException) { if (error.status == 401) statusValue(false) else throw error }
            }
            "startLogin" -> startLogin()
            "pollLogin" -> pollLogin(stamp)
            "repository" -> {
                val owner = account(stamp)
                try {
                    val repo = api("GET", repo(owner), stamp = stamp) as JSONObject
                    JSONObject().put("exists", true).put("owner", owner).put("defaultBranch", repo.getString("default_branch")).put("private", repo.getBoolean("private"))
                } catch (error: CloudApiException) {
                    if (error.status != 404) throw error
                    JSONObject().put("exists", false).put("owner", owner)
                }
            }
            "createRepository" -> {
                val owner = account(stamp)
                val result = api("POST", "user/repos", JSONObject().put("name", "MiniMarkDisk").put("private", true)
                    .put("auto_init", true).put("description", "Mini Mark documents"), stamp) as JSONObject
                JSONObject().put("exists", true).put("owner", owner).put("private", result.getBoolean("private"))
                    .put("defaultBranch", result.getString("default_branch"))
            }
            "list" -> list(account(stamp, value("owner")), value("path"), stamp)
            "read" -> {
                val file = read(account(stamp, value("owner")), value("path"), stamp)
                JSONObject().put("path", file.path).put("sha", file.sha).put("text", file.text)
            }
            "write" -> write(account(stamp, value("owner")), value("path"), value("text"), value("sha").ifEmpty { null }, stamp)
            "folder" -> {
                val owner = account(stamp, value("owner"))
                val path = CloudPaths.validate(value("path"), true)
                try {
                    api("GET", "${repo(owner)}/contents/${CloudPaths.encode(path)}", stamp = stamp)
                    throw IOException("此目录已经存在，请使用其他名称。")
                } catch (error: CloudApiException) { if (error.status != 404) throw error }
                val result = api("PUT", "${repo(owner)}/contents/${CloudPaths.encode(path)}/.gitkeep",
                    JSONObject().put("message", "Create folder $path").put("content", ""), stamp) as JSONObject
                JSONObject().put("path", path).put("sha", result.getJSONObject("content").getString("sha"))
            }
            "delete", "rename" -> {
                val owner = account(stamp, value("owner"))
                val tree = CloudTreeMutation { method, path, payload -> api(method, path, payload, stamp) as JSONObject }
                val path = CloudPaths.validate(value("path"), body.getString("action") == "delete")
                val sha = CloudPaths.sha(value("sha"))
                if (body.getString("action") == "delete") {
                    val kind = value("entryType")
                    val commit = tree.mutate(repo(owner), path, sha, kind)
                    JSONObject().put("path", path).put("type", kind).put("deleted", true).put("commit", commit)
                } else {
                    val name = value("name").trim()
                    require('/' !in name && name != path.substringAfterLast('/')) { "请输入新的文件名。" }
                    val target = path.substringBeforeLast('/', "").let { if (it.isEmpty()) name else "$it/$name" }
                    CloudPaths.validate(target)
                    val commit = tree.mutate(repo(owner), path, sha, "file", name)
                    JSONObject().put("path", target).put("previousPath", path).put("sha", sha).put("commit", commit)
                }
            }
            else -> throw IOException("未知的云文档操作。")
        }.also { if (body.getString("action") !in setOf("startLogin", "pollLogin")) checkGeneration(stamp) }
    }

    private fun statusValue(authenticated: Boolean) = JSONObject().put("authenticated", authenticated).put("configured", clientId().isNotBlank())
    private fun load() = synchronized(authLock) {
        if (!loaded) { credential = store.read(); loaded = true }
        if (pendingPersistence) { credential?.let(store::write); pendingPersistence = false }
    }
    private fun repo(owner: String) = "repos/${CloudPaths.encodePart(owner)}/MiniMarkDisk"
    private fun oauth(path: String, values: Map<String, String>): JSONObject {
        val form = values.entries.joinToString("&") { "${CloudPaths.encodePart(it.key)}=${CloudPaths.encodePart(it.value)}" }
        return transport.request("POST", "https://github.com/login/$path", form, form = true) as JSONObject
    }
    private fun startLogin(): JSONObject {
        val id = clientId().trim()
        check(id.isNotEmpty()) { "此安装包尚未配置 GitHub 登录。" }
        val stamp = synchronized(authLock) { pending = null; epoch.incrementAndGet() }
        val result = oauth("device/code", mapOf("client_id" to id, "scope" to "repo"))
        checkGeneration(stamp)
        check(!result.has("error")) { "GitHub 设备授权不可用。" }
        val url = java.net.URI(result.getString("verification_uri"))
        check(url.scheme == "https" && url.host == "github.com" && url.userInfo == null) { "GitHub 授权地址无效。" }
        val code = result.getString("user_code")
        check(Regex("[a-zA-Z0-9-]{1,32}").matches(code)) { "GitHub 授权码无效。" }
        val seconds = result.getInt("expires_in").coerceIn(1, 1800)
        val interval = result.optInt("interval", 5).coerceAtLeast(5)
        synchronized(authLock) {
            checkGeneration(stamp)
            pending = DeviceLogin(id, result.getString("device_code"), code, clock() + seconds * 1000L, interval, clock() + interval * 1000L)
        }
        return JSONObject().put("userCode", code).put("verificationUri", url.toString()).put("expiresIn", seconds).put("interval", interval)
    }
    private fun pollLogin(stamp: Int): JSONObject {
        val device = pending ?: throw IOException("登录已取消，请重新登录。")
        check(device.expires > clock()) { "授权码已过期，请重新登录。" }
        if (device.next > clock()) return JSONObject().put("pending", true).put("interval", device.interval)
        val result = oauth("oauth/access_token", mapOf("client_id" to device.id, "device_code" to device.code,
            "grant_type" to "urn:ietf:params:oauth:grant-type:device_code"))
        checkGeneration(stamp)
        if (result.has("error")) {
            val reason = result.getString("error")
            check(reason in setOf("authorization_pending", "slow_down")) { "GitHub 授权已拒绝或失效，请重新登录。" }
            val interval = device.interval + if (reason == "slow_down") 5 else 0
            synchronized(authLock) {
                checkGeneration(stamp)
                pending = device.copy(interval = interval, next = clock() + interval * 1000L)
            }
            return JSONObject().put("pending", true).put("interval", interval)
        }
        val next = credentialFrom(result, device.id)
        val user = transport.request("GET", "https://api.github.com/user", token = next.getString("accessToken")) as JSONObject
        val login = validLogin(user.getString("login"))
        next.put("account", login)
        synchronized(authLock) {
            checkGeneration(stamp)
            store.write(next); credential = next; loaded = true; pending = null; verifiedAt = clock(); epoch.incrementAndGet()
        }
        return statusValue(true).put("login", login)
    }
    private fun credentialFrom(result: JSONObject, id: String): JSONObject {
        val token = result.getString("access_token")
        check(token.isNotBlank() && token.length < 8192) { "GitHub 登录响应无效。" }
        val next = JSONObject().put("accessToken", token).put("clientId", id)
        if (result.has("expires_in")) next.put("expires", clock() + result.getLong("expires_in") * 1000)
        if (result.has("refresh_token")) next.put("refreshToken", result.getString("refresh_token"))
        if (result.has("refresh_token_expires_in")) next.put("refreshExpires", clock() + result.getLong("refresh_token_expires_in") * 1000)
        return next
    }
    private fun refresh(stamp: Int, rejected: Boolean = false): JSONObject {
        val current = credential ?: throw CloudApiException(401, "请先登录 GitHub。")
        if (!rejected && current.optLong("expires", Long.MAX_VALUE) > clock() + 60_000) return current
        val refresh = current.optString("refreshToken")
        if (refresh.isEmpty() || current.optLong("refreshExpires", Long.MAX_VALUE) <= clock()) {
            if (!rejected && current.optLong("expires", 0) > clock()) return current
            invalidate(stamp); throw CloudApiException(401, "GitHub 登录已过期，请重新登录。")
        }
        val result = oauth("oauth/access_token", mapOf("client_id" to current.optString("clientId", clientId()), "grant_type" to "refresh_token", "refresh_token" to refresh))
        checkGeneration(stamp)
        if (result.has("error")) {
            if (result.getString("error") in setOf("bad_refresh_token", "invalid_grant")) invalidate(stamp)
            throw IOException("GitHub 登录刷新失败，请稍后重试或重新登录。")
        }
        val next = credentialFrom(result, current.optString("clientId", clientId())).put("account", current.optString("account"))
        check(next.optString("refreshToken").isNotEmpty()) { "GitHub 登录刷新响应不完整。" }
        synchronized(authLock) {
            checkGeneration(stamp); credential = next; verifiedAt = 0; pendingPersistence = true
            store.write(next); pendingPersistence = false
        }
        val user = try { transport.request("GET", "https://api.github.com/user", token = next.getString("accessToken")) as JSONObject }
        catch (failure: CloudApiException) { if (failure.status == 401) invalidate(stamp); throw failure }
        val login = validLogin(user.getString("login"))
        val expected = current.optString("account")
        if (expected.isNotEmpty() && !expected.equals(login, true)) {
            invalidate(stamp); throw CloudApiException(401, "GitHub 账号已改变，请重新登录。")
        }
        synchronized(authLock) { checkGeneration(stamp); next.put("account", login); store.write(next); verifiedAt = clock() }
        return next
    }
    private fun invalidate(stamp: Int) = synchronized(authLock) {
        checkGeneration(stamp); credential = null; verifiedAt = 0; pendingPersistence = false; store.clear()
    }
    private fun api(method: String, path: String, body: JSONObject? = null, stamp: Int): Any {
        checkGeneration(stamp)
        val current = refresh(stamp)
        val result = try {
            transport.request(method, "https://api.github.com/$path", body?.toString(), current.getString("accessToken"))
        } catch (error: CloudApiException) {
            if (error.status != 401) throw error
            val updated = refresh(stamp, rejected = true)
            try { transport.request(method, "https://api.github.com/$path", body?.toString(), updated.getString("accessToken")) }
            catch (failure: CloudApiException) { if (failure.status == 401) invalidate(stamp); throw failure }
        }
        checkGeneration(stamp)
        return result
    }
    private fun account(stamp: Int, expected: String = ""): String {
        refresh(stamp)
        if (verifiedAt == 0L || clock() - verifiedAt > 60_000) {
            val user = api("GET", "user", stamp = stamp) as JSONObject
            val login = validLogin(user.getString("login"))
            val previous = credential?.optString("account").orEmpty()
            check(previous.isEmpty() || login.equals(previous, true)) { "GitHub 账号已改变，请重新登录。" }
            synchronized(authLock) {
                checkGeneration(stamp); credential!!.put("account", login); store.write(credential!!); verifiedAt = clock()
            }
        }
        val owner = credential!!.getString("account")
        check(expected.isEmpty() || expected.equals(owner, true)) { "此文档属于另一 GitHub 账号，请切换账号。" }
        return owner
    }
    private fun validLogin(value: String): String {
        check(Regex("[a-zA-Z0-9][a-zA-Z0-9-]{0,38}").matches(value)) { "GitHub 账号信息无效。" }
        return value
    }
    private fun list(owner: String, path: String, stamp: Int): JSONObject {
        if (path.isNotEmpty()) CloudPaths.validate(path, true)
        val result = try { api("GET", "${repo(owner)}/contents/${CloudPaths.encode(path)}", stamp = stamp) }
        catch (error: CloudApiException) {
            if (error.status != 404 || path.isNotEmpty()) throw error
            api("GET", repo(owner), stamp = stamp)
            JSONArray()
        }
        check(result is JSONArray) { "该路径不是文件夹。" }
        val entries = JSONArray()
        for (index in 0 until result.length()) {
            val row = result.getJSONObject(index)
            val kind = row.optString("type")
            if (row.optString("name") == ".gitkeep" || kind !in setOf("file", "dir")) continue
            if (kind == "file" && runCatching { CloudPaths.validate(row.getString("path")) }.isFailure) continue
            entries.put(JSONObject().put("name", row.getString("name")).put("path", row.getString("path"))
                .put("type", kind).put("sha", CloudPaths.sha(row.getString("sha"))).put("size", row.optLong("size")))
        }
        return JSONObject().put("entries", entries).put("path", path)
    }
    private fun read(owner: String, path: String, stamp: Int): CloudFile {
        CloudPaths.validate(path)
        val metadata = api("GET", "${repo(owner)}/contents/${CloudPaths.encode(path)}", stamp = stamp) as JSONObject
        check(metadata.getString("type") == "file" && !metadata.has("target") && !metadata.has("submodule_git_url") && metadata.getLong("size") <= CloudPaths.MAX_BYTES) { "只能打开不超过 5 MB 的普通文本文档。" }
        val sha = CloudPaths.sha(metadata.getString("sha"))
        val blob = api("GET", "${repo(owner)}/git/blobs/$sha", stamp = stamp) as JSONObject
        check(blob.getString("encoding") == "base64" && blob.getString("sha") == sha && blob.getLong("size") <= CloudPaths.MAX_BYTES) { "云端文档内容无效。" }
        val bytes = Base64.decode(blob.getString("content"), Base64.DEFAULT)
        check(bytes.size <= CloudPaths.MAX_BYTES) { "云文档超过 5 MB。" }
        val text = decodeDocument(bytes).body
        check('\u0000' !in text) { "只能打开 UTF-8 文本文档。" }
        return CloudFile(path, sha, text)
    }
    private fun write(owner: String, path: String, text: String, sha: String?, stamp: Int): JSONObject {
        CloudPaths.validate(path); if (sha != null) CloudPaths.sha(sha)
        val bytes = encodeDocument(text, false, false)
        check(bytes.size <= CloudPaths.MAX_BYTES && '\u0000' !in text) { "云文档必须为不超过 5 MB 的 UTF-8 文本。" }
        val payload = JSONObject().put("message", "Update $path via Mini Mark").put("content", Base64.encodeToString(bytes, Base64.NO_WRAP))
        if (sha != null) payload.put("sha", sha)
        val result = api("PUT", "${repo(owner)}/contents/${CloudPaths.encode(path)}", payload, stamp) as JSONObject
        return JSONObject().put("path", path).put("sha", CloudPaths.sha(result.getJSONObject("content").getString("sha")))
    }
}
