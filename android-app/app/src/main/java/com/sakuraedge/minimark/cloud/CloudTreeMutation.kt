package com.sakuraedge.minimark.cloud

import org.json.JSONArray
import org.json.JSONObject

internal class CloudTreeMutation(private val api: (String, String, JSONObject?) -> JSONObject) {
    private data class Level(val child: String, val entries: List<JSONObject>)
    fun mutate(repo: String, path: String, expectedSha: String, kind: String, rename: String? = null): String {
        CloudPaths.validate(path, true); CloudPaths.sha(expectedSha)
        require(kind in setOf("file", "dir")) { "云端条目类型无效。" }
        val parts = path.split('/')
        require(parts.size <= 16) { "文件夹层级超过 16 层。" }
        val repository = api("GET", repo, null)
        val branch = repository.getString("default_branch")
        require(branch.isNotEmpty() && branch.length <= 1024 && branch.none { it.isWhitespace() || it.isISOControl() || it in "\\:?*[~^" } &&
            ".." !in branch && "@{" !in branch && branch.split('/').none { it.isEmpty() || it.startsWith('.') || it.endsWith('.') || it.endsWith(".lock", true) }) { "GitHub 分支信息无效。" }
        val reference = "heads/${CloudPaths.encode(branch)}"
        val head = api("GET", "$repo/git/ref/$reference", null)
        val previous = readHead(head, branch)
        val commit = api("GET", "$repo/git/commits/$previous", null)
        check(CloudPaths.sha(commit.getString("sha")) == previous) { "GitHub 提交版本不一致。" }
        var treeSha = CloudPaths.sha(commit.getJSONObject("tree").getString("sha"))
        val levels = mutableListOf<Level>()
        parts.forEachIndexed { index, part ->
            val tree = api("GET", "$repo/git/trees/$treeSha", null)
            val entries = readTree(tree, treeSha)
            val target = entries.singleOrNull { it.getString("path") == part } ?: error("云端目标已删除或移动，请刷新目录。")
            levels.add(Level(part, entries))
            if (index < parts.lastIndex) {
                check(target.getString("type") == "tree" && target.getString("mode") == "040000") { "目录包含符号链接或其他特殊条目。" }
                treeSha = target.getString("sha")
            } else {
                val normal = if (kind == "dir") target.getString("type") == "tree" && target.getString("mode") == "040000"
                    else target.getString("type") == "blob" && target.getString("mode") in setOf("100644", "100755")
                check(normal && target.getString("sha").equals(expectedSha, true)) { "云端内容已变化，请刷新目录后重试。" }
                check(rename == null || entries.none { it.getString("path") == rename }) { "此目录已有同名文件。" }
            }
        }
        var rebuilt: String? = null
        for (index in levels.indices.reversed()) {
            val level = levels[index]
            val entries = JSONArray()
            level.entries.filter { it.getString("path") != level.child }.forEach { entries.put(it) }
            if (rename != null && index == levels.lastIndex) {
                val source = level.entries.single { it.getString("path") == level.child }
                entries.put(JSONObject(source.toString()).put("path", rename))
            }
            if (rebuilt != null) entries.put(JSONObject().put("path", level.child).put("mode", "040000").put("type", "tree").put("sha", rebuilt))
            if (entries.length() == 0) entries.put(JSONObject().put("path", ".gitkeep").put("mode", "100644").put("type", "blob").put("content", ""))
            rebuilt = CloudPaths.sha(api("POST", "$repo/git/trees", JSONObject().put("tree", entries)).getString("sha"))
        }
        val created = api("POST", "$repo/git/commits", JSONObject().put("message", if (rename == null) "Delete $path via Mini Mark" else "Rename $path via Mini Mark")
            .put("tree", rebuilt).put("parents", JSONArray().put(previous)))
        val next = CloudPaths.sha(created.getString("sha"))
        check(created.getJSONObject("tree").getString("sha") == rebuilt && created.getJSONArray("parents").length() == 1 && created.getJSONArray("parents").getJSONObject(0).getString("sha") == previous) { "GitHub 提交结果无效。" }
        check(readHead(api("GET", "$repo/git/ref/$reference", null), branch) == previous) { "云端分支已更新，请刷新目录后重试。" }
        try {
            check(readHead(api("PATCH", "$repo/git/refs/$reference", JSONObject().put("sha", next).put("force", false)), branch) == next) { "云端结果无法确认。" }
        } catch (failure: Exception) {
            throw java.io.IOException("操作结果尚未确认，请刷新云目录核对后再操作。", failure)
        }
        return next
    }
    private fun readHead(value: JSONObject, branch: String): String {
        check(value.getString("ref") == "refs/heads/$branch" && value.getJSONObject("object").getString("type") == "commit") { "GitHub 分支引用无效。" }
        return CloudPaths.sha(value.getJSONObject("object").getString("sha"))
    }
    private fun readTree(value: JSONObject, expected: String): List<JSONObject> {
        check(value.getString("sha") == expected && value.has("truncated") && !value.getBoolean("truncated")) { "云目录信息不完整，操作已停止。" }
        val list = value.getJSONArray("tree")
        val names = mutableSetOf<String>()
        return (0 until list.length()).map { index ->
            val row = list.getJSONObject(index)
            val name = row.getString("path"); val mode = row.getString("mode"); val kind = row.getString("type")
            check(name.isNotEmpty() && '/' !in name && '\u0000' !in name && name !in setOf(".", "..") && names.add(name) &&
                (kind == "tree" && mode == "040000" || kind == "blob" && mode in setOf("100644", "100755", "120000") || kind == "commit" && mode == "160000")) { "云目录条目无效。" }
            JSONObject().put("path", name).put("mode", mode).put("type", kind).put("sha", CloudPaths.sha(row.getString("sha")))
        }
    }
}
