package com.sakuraedge.minimark

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.print.PrintDocumentAdapter
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.view.ViewGroup
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.sakuraedge.minimark.documents.DocumentStore
import com.sakuraedge.minimark.documents.LocalDocument
import com.sakuraedge.minimark.host.AndroidBridge
import com.sakuraedge.minimark.host.AndroidHostState
import com.sakuraedge.minimark.host.DocumentAccess
import com.sakuraedge.minimark.host.HostActions
import com.sakuraedge.minimark.host.WebResources
import com.sakuraedge.minimark.host.PreviewServer

internal class MainActivity : ComponentActivity(), HostActions {
    private val documents by viewModels<DocumentStore>()
    private val host by viewModels<AndroidHostState>()
    private lateinit var web: WebView
    private lateinit var bridge: AndroidBridge
    private lateinit var resources: WebResources
    private var webFileCallback: ValueCallback<Array<Uri>>? = null
    private var previewDialog: AlertDialog? = null
    private val printViews = mutableSetOf<WebView>()
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        bridge.pickerResult(if (result.resultCode == RESULT_OK) result.data?.data else null)
    }
    private val webPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uris = if (result.resultCode == RESULT_OK) {
            val data = result.data
            data?.clipData?.let { clip -> Array(clip.itemCount) { clip.getItemAt(it).uri } } ?: data?.data?.let { arrayOf(it) }
        } else null
        webFileCallback?.onReceiveValue(uris); webFileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        resources = host.resources
        host.actions = this
        bridge = AndroidBridge(applicationContext, documents, host)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            setContentView(TextView(this).apply { setText(R.string.webview_update_required); setPadding(32, 80, 32, 32) })
            return
        }
        val container = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
        web = WebView(this)
        configureWeb(web)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "MiniMarkNative", setOf(APP_ORIGIN)) { _, message, sourceOrigin, isMainFrame, reply ->
                if (!isMainFrame || sourceOrigin.toString() != APP_ORIGIN) return@addWebMessageListener
                host.emit = { value -> runOnUiThread {
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) reply.postMessage(value.toString())
                } }
                bridge.receive(message.data ?: "")
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = resources.respond(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                if (request.url.toString().startsWith("$APP_ORIGIN/") && request.url.path == "/index.html") return false
                openExternal(request.url.toString()); return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, parameters: FileChooserParams): Boolean {
                webFileCallback?.onReceiveValue(null); webFileCallback = callback
                return try {
                    val intent = parameters.createIntent().apply { addCategory(Intent.CATEGORY_OPENABLE) }
                    webPicker.launch(intent); true
                } catch (_: Exception) { callback.onReceiveValue(null); webFileCallback = null; false }
            }
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                if (!trusted(url)) { result.cancel(); return true }
                confirm(message, result::confirm, result::cancel); return true
            }
            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
                if (!trusted(url)) { result.cancel(); return true }
                AlertDialog.Builder(this@MainActivity).setTitle("Mini Mark").setMessage(message).setPositiveButton("确定") { _, _ -> result.confirm() }
                    .setOnCancelListener { result.cancel() }.show()
                return true
            }
            override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean {
                if (!trusted(url)) { result.cancel(); return true }
                val input = EditText(this@MainActivity).apply { setText(defaultValue.orEmpty()); isSingleLine = true }
                AlertDialog.Builder(this@MainActivity).setTitle(message).setView(input)
                    .setPositiveButton("确定") { _, _ -> result.confirm(input.text.toString()) }.setNegativeButton("取消") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }.show()
                return true
            }
        }
        container.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            insets
        }
        setContentView(container)
        web.loadUrl("$APP_ORIGIN/index.html")
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (previewDialog?.isShowing == true) { previewDialog?.dismiss(); return }
                web.evaluateJavascript("Boolean(window.miniMarkBack && window.miniMarkBack())") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })
    }
    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWeb(view: WebView) {
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.allowFileAccess = false
        view.settings.allowContentAccess = true
        view.settings.javaScriptCanOpenWindowsAutomatically = false
        view.settings.setSupportMultipleWindows(false)
        view.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        view.settings.mediaPlaybackRequiresUserGesture = true
    }
    override fun chooseFile() { filePicker.launch(Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
        .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/*", "application/yaml", "application/octet-stream"))) }
    override fun chooseFolder() { filePicker.launch(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)) }
    override fun createFile(name: String, mime: String) { filePicker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).setType(mime).addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, name)) }
    override fun appearance(dark: Boolean) {
        val color = if (dark) Color.rgb(35, 38, 43) else Color.WHITE
        (web.parent as? FrameLayout)?.setBackgroundColor(color)
        WindowInsetsControllerCompat(window, web).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
    override fun openExternal(url: String) {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
        if (uri.scheme !in setOf("https", "http") || uri.host.isNullOrBlank() || uri.userInfo != null) return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }.onFailure { android.widget.Toast.makeText(this, "没有可用的浏览器。", android.widget.Toast.LENGTH_SHORT).show() }
    }
    override fun confirm(message: String, accepted: () -> Unit, cancelled: () -> Unit) {
        AlertDialog.Builder(this).setTitle("Mini Mark").setMessage(message)
            .setPositiveButton("确定") { _, _ -> accepted() }.setNegativeButton("取消") { _, _ -> cancelled() }
            .setOnCancelListener { cancelled() }.show()
    }
    @SuppressLint("SetJavaScriptEnabled")
    override fun previewHtml(document: LocalDocument, browser: Boolean) {
        if (browser) {
            host.previewServer?.close()
            val server = PreviewServer(applicationContext, host.folders, document.value.text, document.parentUri)
            host.previewServer = server
            openExternal(server.url)
            return
        }
        previewDialog?.dismiss()
        val preview = WebView(this)
        configureWeb(preview)
        preview.settings.domStorageEnabled = false
        preview.settings.allowContentAccess = false
        val previewResources = WebResources(this, host.folders).apply {
            previewDocument = DocumentAccess(document.id, document.uri, document.parentUri)
            previewText = document.value.text
        }
        preview.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host == "app.minimark.local" || request.url.host == "document.moye.local") return previewResources.missing()
                return previewResources.respond(request.url, preview = true)
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == "preview.minimark.local") return false
                if (request.isForMainFrame) openExternal(request.url.toString())
                return request.isForMainFrame
            }
        }
        preview.loadUrl("https://preview.minimark.local/index.html")
        previewDialog = AlertDialog.Builder(this).setTitle(if (browser) "HTML 浏览器预览" else "HTML 运行预览")
            .setView(preview).setPositiveButton("返回编辑") { _, _ -> }.create().apply {
                setOnDismissListener { preview.stopLoading(); preview.destroy(); previewDialog = null }
                show(); window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            }
    }
    override fun printDocument(html: String, name: String, document: LocalDocument) {
        val printView = WebView(this)
        printViews.add(printView)
        configureWeb(printView)
        printView.settings.javaScriptEnabled = false
        printView.settings.domStorageEnabled = false
        val base = "https://document.moye.local/"
        val token = Uri.encode("${document.id}:${document.uri.orEmpty()}")
        val content = html.replace("</head>", "<style>@page{margin:16mm} @media print{body{padding:0;margin:0}}</style></head>").replace(Regex("(<img\\b[^>]*\\bsrc=[\"'])(?![a-z]+:|//)([^\"']+)", RegexOption.IGNORE_CASE)) { match ->
            match.groupValues[1] + base + match.groupValues[2] + "?document=" + token
        }
        printView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = resources.respond(request.url)
            override fun onPageFinished(view: WebView, url: String) {
                if (view.tag == true) return
                view.tag = true
                val manager = getSystemService(PRINT_SERVICE) as PrintManager
                val delegate = view.createPrintDocumentAdapter(name.substringBeforeLast('.'))
                val adapter = object : PrintDocumentAdapter() {
                    override fun onStart() { delegate.onStart() }
                    override fun onLayout(oldAttributes: PrintAttributes?, newAttributes: PrintAttributes?, cancellationSignal: CancellationSignal?, callback: LayoutResultCallback?, extras: Bundle?) {
                        delegate.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras)
                    }
                    override fun onWrite(pages: Array<out PageRange>?, destination: ParcelFileDescriptor?, cancellationSignal: CancellationSignal?, callback: WriteResultCallback?) {
                        delegate.onWrite(pages, destination, cancellationSignal, callback)
                    }
                    override fun onFinish() { delegate.onFinish(); printViews.remove(view); view.destroy() }
                }
                manager.print(name.substringBeforeLast('.'), adapter, PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setMinMargins(PrintAttributes.Margins(630, 630, 630, 630)).build())
            }
        }
        printView.loadDataWithBaseURL(APP_ORIGIN + "/", content, "text/html", "UTF-8", null)
    }
    override fun onStop() {
        if (::web.isInitialized) web.evaluateJavascript("window.miniMarkFlush?.()") { documents.flushDrafts() }
        documents.flushDrafts(); super.onStop()
    }
    override fun onDestroy() {
        if (host.actions === this) { host.actions = null; host.emit = null }
        webFileCallback?.onReceiveValue(null); webFileCallback = null
        previewDialog?.dismiss()
        printViews.toList().forEach { it.destroy() }; printViews.clear()
        if (::web.isInitialized) { web.stopLoading(); (web.parent as? ViewGroup)?.removeView(web); web.destroy() }
        super.onDestroy()
    }
    private fun trusted(url: String) = runCatching { Uri.parse(url).let { it.scheme == "https" && it.host == "app.minimark.local" } }.getOrDefault(false)
    companion object { const val APP_ORIGIN = "https://app.minimark.local" }
}
