package com.sakuraedge.minimark.cloud

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class GitHubCloudTest {
    private val sha = "a".repeat(40)
    private val nextSha = "b".repeat(40)

    @Test fun pathsRejectTraversalAndNonDocuments() {
        for (path in listOf("../a.md", "a/../b.md", "a//b.md", "/a.md", "a\\b.md", ".git/a.md", "a.md?x", "a.bin")) {
            assertTrue(path, runCatching { CloudPaths.validate(path) }.isFailure)
        }
        assertEquals("笔记/中文.md", CloudPaths.validate("笔记/中文.md"))
        assertEquals("%E7%AC%94%E8%AE%B0/a%20b.md", CloudPaths.encode("笔记/a b.md"))
    }

    @Test fun configuredStatusDoesNotRequireNetworkWhenSignedOut() = runBlocking {
        val transport = FakeTransport { error("Signed-out status must stay local") }
        val cloud = GitHubCloud(MemoryStore(), { "public-client" }, transport)
        val response = cloud.execute(JSONObject().put("action", "status"))
        assertFalse(response.getBoolean("authenticated"))
        assertTrue(response.getBoolean("configured"))
        assertTrue(transport.requests.isEmpty())
    }

    @Test fun deviceAuthorizationOnlyReturnsPublicCodeAndCancellationInvalidatesCopy() = runBlocking {
        val transport = FakeTransport { request ->
            assertEquals("https://github.com/login/device/code", request.url)
            assertTrue(request.body!!.contains("scope=repo"))
            JSONObject().put("user_code", "ABCD-1234").put("device_code", "private-test-device-code")
                .put("verification_uri", "https://github.com/login/device").put("expires_in", 900).put("interval", 5)
        }
        val cloud = GitHubCloud(MemoryStore(), { "public-client" }, transport)
        val result = cloud.execute(JSONObject().put("action", "startLogin"))
        assertEquals("ABCD-1234", result.getString("userCode"))
        assertFalse(result.toString().contains("private-test"))
        assertEquals("ABCD-1234", cloud.authorizationCode("ABCD-1234"))
        assertTrue(runCatching { cloud.authorizationCode("ABCD") }.isFailure)
        cloud.cancelLogin()
        assertTrue(runCatching { cloud.authorizationCode("ABCD-1234") }.isFailure)
    }

    @Test fun readPinsBlobToMetadataShaAndNormalizesUtf8() = runBlocking {
        val transport = FakeTransport { request -> when {
            request.url.endsWith("/user") -> user()
            request.url.contains("/contents/") -> JSONObject().put("type", "file").put("size", 20).put("sha", sha)
            request.url.endsWith("/git/blobs/$sha") -> JSONObject().put("sha", sha).put("size", 20).put("encoding", "base64")
                .put("content", android.util.Base64.encodeToString("\uFEFF# 中文\r\n正文".toByteArray(), android.util.Base64.NO_WRAP))
            else -> error("Unexpected request")
        } }
        val cloud = GitHubCloud(MemoryStore(validCredential()), { "public-client" }, transport)
        val result = cloud.execute(JSONObject().put("action", "read").put("owner", "test-user").put("path", "note.md"))
        assertEquals("# 中文\n正文", result.getString("text"))
        assertEquals(sha, result.getString("sha"))
    }

    @Test fun conflictDoesNotRetryMutationOrChangeCredentials() = runBlocking {
        val credentials = MemoryStore(validCredential())
        val transport = FakeTransport { request ->
            if (request.url.endsWith("/user")) user() else throw CloudApiException(409, "conflict")
        }
        val cloud = GitHubCloud(credentials, { "public-client" }, transport)
        assertTrue(runCatching { cloud.execute(JSONObject().put("action", "write").put("owner", "test-user").put("path", "note.md").put("sha", sha).put("text", "local")) }.isFailure)
        assertEquals(1, transport.requests.count { it.method == "PUT" })
        assertEquals("test-token", credentials.value!!.getString("accessToken"))
    }

    @Test fun accountMismatchBlocksWriteBeforePut() = runBlocking {
        val transport = FakeTransport { user() }
        val cloud = GitHubCloud(MemoryStore(validCredential()), { "public-client" }, transport)
        assertTrue(runCatching { cloud.execute(JSONObject().put("action", "write").put("owner", "another-user").put("path", "note.md").put("text", "local")) }.isFailure)
        assertEquals(0, transport.requests.count { it.method == "PUT" })
    }

    @Test fun rotatedTokenPersistsBeforeAccountNetworkFailure() = runBlocking {
        val credentials = MemoryStore(validCredential().put("expires", 1).put("refreshToken", "old-refresh").put("refreshExpires", Long.MAX_VALUE))
        val transport = FakeTransport { request ->
            if (request.url.contains("access_token")) JSONObject().put("access_token", "next-token").put("refresh_token", "next-refresh").put("expires_in", 3600).put("refresh_token_expires_in", 7200)
            else { assertEquals("next-token", credentials.value!!.getString("accessToken")); throw IOException("offline") }
        }
        val cloud = GitHubCloud(credentials, { "public-client" }, transport)
        assertTrue(runCatching { cloud.execute(JSONObject().put("action", "status")) }.isFailure)
        assertEquals("next-refresh", credentials.value!!.getString("refreshToken"))
    }

    @Test fun logoutDuringRequestRejectsLateAccountResponse() = runBlocking {
        val credentials = MemoryStore(validCredential())
        lateinit var cloud: GitHubCloud
        val transport = FakeTransport { cloud.logout(); user() }
        cloud = GitHubCloud(credentials, { "public-client" }, transport)
        assertTrue(runCatching { cloud.execute(JSONObject().put("action", "status")) }.isFailure)
        assertNull(credentials.value)
    }

    @Test fun treeRenamePreservesSiblingShaAndDoesNotUploadText() {
        val root = "c".repeat(40); val head = "d".repeat(40); val treeResult = "e".repeat(40); val commitResult = "f".repeat(40)
        var sentTree: JSONArray? = null
        val mutation = CloudTreeMutation { method, url, payload -> when {
            url.endsWith("MiniMarkDisk") -> JSONObject().put("default_branch", "main")
            url.contains("/git/ref/") -> ref(head)
            url.endsWith("/git/commits/$head") -> JSONObject().put("sha", head).put("tree", JSONObject().put("sha", root))
            url.endsWith("/git/trees/$root") -> JSONObject().put("sha", root).put("truncated", false).put("tree", JSONArray()
                .put(entry("note.md", sha)).put(entry("keep.md", nextSha)))
            method == "POST" && url.endsWith("/git/trees") -> { sentTree = payload!!.getJSONArray("tree"); JSONObject().put("sha", treeResult) }
            method == "POST" && url.endsWith("/git/commits") -> JSONObject().put("sha", commitResult).put("tree", JSONObject().put("sha", treeResult)).put("parents", JSONArray().put(JSONObject().put("sha", head)))
            method == "PATCH" -> { assertFalse(payload!!.getBoolean("force")); ref(commitResult) }
            else -> error("Unexpected tree request")
        } }
        assertEquals(commitResult, mutation.mutate("repos/test-user/MiniMarkDisk", "note.md", sha, "file", "renamed.md"))
        val entries = (0 until sentTree!!.length()).map { sentTree!!.getJSONObject(it) }
        assertEquals(nextSha, entries.single { it.getString("path") == "keep.md" }.getString("sha"))
        assertEquals(sha, entries.single { it.getString("path") == "renamed.md" }.getString("sha"))
        assertTrue(entries.none { it.has("content") })
    }

    @Test fun truncatedTreeStopsBeforeAnyWrites() {
        var writes = 0
        val root = "c".repeat(40); val head = "d".repeat(40)
        val mutation = CloudTreeMutation { method, url, _ ->
            if (method != "GET") writes++
            when {
                url.endsWith("MiniMarkDisk") -> JSONObject().put("default_branch", "main")
                url.contains("/git/ref/") -> ref(head)
                url.contains("/git/commits/") -> JSONObject().put("sha", head).put("tree", JSONObject().put("sha", root))
                else -> JSONObject().put("sha", root).put("truncated", true).put("tree", JSONArray())
            }
        }
        assertTrue(runCatching { mutation.mutate("repos/test-user/MiniMarkDisk", "note.md", sha, "file") }.isFailure)
        assertEquals(0, writes)
    }

    private fun validCredential() = JSONObject().put("accessToken", "test-token").put("clientId", "public-client").put("account", "test-user")
    private fun user() = JSONObject().put("login", "test-user")
    private fun ref(sha: String) = JSONObject().put("ref", "refs/heads/main").put("object", JSONObject().put("type", "commit").put("sha", sha))
    private fun entry(name: String, sha: String) = JSONObject().put("path", name).put("mode", "100644").put("type", "blob").put("sha", sha)
    private class MemoryStore(var value: JSONObject? = null) : CloudCredentialStore {
        override fun read() = value?.let { JSONObject(it.toString()) }
        override fun write(value: JSONObject) { this.value = JSONObject(value.toString()) }
        override fun clear() { value = null }
    }
    private data class Call(val method: String, val url: String, val body: String?, val token: String?)
    private class FakeTransport(private val answer: (Call) -> Any) : CloudTransport {
        val requests = mutableListOf<Call>()
        override fun request(method: String, url: String, body: String?, token: String?, form: Boolean): Any {
            val call = Call(method, url, body, token); requests.add(call); return answer(call)
        }
    }
}
