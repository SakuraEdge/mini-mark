package com.sakuraedge.minimark.host

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import com.sakuraedge.minimark.cloud.EncryptedCloudCredentials
import com.sakuraedge.minimark.cloud.GitHubCloud
import com.sakuraedge.minimark.workspace.FolderWorkspace
import org.json.JSONObject

internal class AndroidHostState(application: Application, private val saved: SavedStateHandle) : AndroidViewModel(application) {
    val cloud = GitHubCloud(EncryptedCloudCredentials(application), {
        application.assets.open("web/github-oauth.json").bufferedReader().use { JSONObject(it.readText()).optString("clientId") }
    })
    val folders = FolderWorkspace(application)
    val resources = WebResources(application, folders)
    var actions: HostActions? = null
    var documentBusy = false
    var emit: ((JSONObject) -> Unit)? = null
    var pendingPicker: JSONObject?
        get() = saved.get<String>("picker")?.let(::JSONObject)
        set(value) { saved["picker"] = value?.toString() }
    var pendingExport: String? = null
    var pendingPdf: JSONObject? = null
    var previewServer: PreviewServer? = null
    fun send(message: JSONObject) { emit?.invoke(message) }
    override fun onCleared() { previewServer?.close(); super.onCleared() }
}
