package com.sakuraedge.minimark.documents

import org.json.JSONArray
import org.json.JSONObject

internal data class CloudBinding(val owner: String, val path: String, val sha: String, val baseline: String) {
    fun json() = JSONObject().put("owner", owner).put("path", path).put("sha", sha).put("baseline", baseline)
}

internal data class DocumentSnapshot(
    val id: String,
    val name: String,
    val body: String,
    val uri: String?,
    val savedBody: String?,
    val diskHash: String?,
    val crlf: Boolean,
    val bom: Boolean,
    val autoName: Boolean,
    val writeFailed: Boolean = false,
    val revision: Long = 0,
    val cloud: CloudBinding? = null,
    val parentUri: String? = null,
) {
    fun toDocument() = LocalDocument(
        id, name, normalizeLines(body), uri, savedBody?.let(::normalizeLines), diskHash,
        crlf, bom, autoName && uri == null && cloud == null && isMarkdown(name), writeFailed, revision, cloud, parentUri,
    )
}

internal data class SessionSnapshot(val activeId: String?, val documents: List<DocumentSnapshot>)

internal fun decodeSession(text: String): SessionSnapshot {
    val root = JSONObject(text)
    val array = root.getJSONArray("documents")
    val records = (0 until array.length()).map { index ->
        val row = array.getJSONObject(index)
        val name = row.getString("name")
        val uri = row.nullableString("uri")?.takeIf(String::isNotBlank)
        val body = normalizeLines(row.getString("body"))
        val savedBody = row.nullableString("savedBody")?.let(::normalizeLines)
        require(body.length <= MAX_TEXT && (savedBody?.length ?: 0) <= MAX_TEXT) { "草稿超过文档大小限制。" }
        DocumentSnapshot(
            row.getString("id").also { require(it.isNotBlank()) }, name, body, uri, savedBody,
            row.nullableString("diskHash")?.takeIf(String::isNotBlank), row.optBoolean("crlf"), row.optBoolean("bom"),
            row.optBoolean("autoName", uri == null && isUntitledName(name)), row.optBoolean("writeFailed"),
            row.optLong("revision", 0).coerceAtLeast(0), row.optJSONObject("cloud")?.let {
                CloudBinding(it.getString("owner"), it.getString("path"), it.getString("sha"), normalizeLines(it.getString("baseline")))
            }, row.nullableString("parentUri"),
        )
    }
    require(records.map { it.id }.distinct().size == records.size) { "草稿编号重复。" }
    return SessionSnapshot(root.nullableString("activeId"), records)
}

internal fun encodeSession(snapshot: SessionSnapshot): String {
    val array = JSONArray()
    snapshot.documents.forEach { doc ->
        array.put(JSONObject().put("id", doc.id).put("name", doc.name).put("body", doc.body)
            .put("uri", doc.uri).put("savedBody", doc.savedBody).put("diskHash", doc.diskHash)
            .put("crlf", doc.crlf).put("bom", doc.bom).put("autoName", doc.autoName)
            .put("writeFailed", doc.writeFailed).put("revision", doc.revision)
            .put("cloud", doc.cloud?.json()).put("parentUri", doc.parentUri))
    }
    return JSONObject().put("activeId", snapshot.activeId).put("documents", array).toString()
}

private fun JSONObject.nullableString(key: String): String? =
    if (isNull(key)) null else getString(key)
