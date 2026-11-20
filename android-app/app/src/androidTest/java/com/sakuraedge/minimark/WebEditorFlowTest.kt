package com.sakuraedge.minimark

import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiScrollable
import androidx.test.uiautomator.UiSelector
import androidx.test.uiautomator.Until
import com.sakuraedge.minimark.cloud.EncryptedCloudCredentials
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class WebEditorFlowTest {
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var activity: MainActivity
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val device get() = UiDevice.getInstance(instrumentation)

    @Before fun launch() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity = it }
        await { evaluate("Boolean(window.__MOYE_READY__)") == "true" }
        evaluate("document.querySelectorAll('dialog[open]').forEach(d=>d.close()); window.miniMarkBack?.(); true")
        await { evaluate("document.querySelector('#mobile-library').hidden") == "false" }
    }
    @After fun close() { scenario.close() }

    @Test fun navigationEditingHistorySearchAndRename() {
        val name = "中文验收-${System.nanoTime()}"
        newDocument()
        edit("# $name\n\n保留正文")
        await { text("#document-name") == "$name.md" }
        click("#undo")
        await { currentSessionDocument().getString("body").isEmpty() }
        click("#redo")
        await { text(".cm-content").contains("保留正文") }
        click("#more"); click("#mobile-menu-rename")
        val input = evaluate("document.querySelector('.text-input-dialog input').id")
        setInput("#${unquote(input)}", "固定名称.md")
        click(".text-input-dialog button[type=submit]")
        await { text("#document-name") == "固定名称.md" }
        click("#mobile-back")
        setInput("#mobile-search", "不存在的名称")
        await { text("#mobile-files").contains("没有匹配") }
        setInput("#mobile-search", "固定名称")
        await { text("#mobile-files").contains("固定名称.md") }
        click(".mobile-file")
        click("#more"); click("#mobile-menu-close")
        assertTrue(device.wait(Until.hasObject(By.text("取消")), 10_000))
        device.findObject(By.text("取消")).click()
        await { text(".cm-content").contains("保留正文") }
        capture("editor.png")
    }

    @Test fun markdownMathSplitRotationAndRecreation() {
        newDocument()
        val body = "# 阅读验收\n\n中文内容\n\n$$\nx^2+y^2=z^2\n$$\n\n| 名称 | 值 |\n| --- | --- |\n| 中文 | 42 |\n\n- [x] 完成"
        edit(body)
        click(".view-switch [data-mode=read]")
        await { evaluate("document.querySelectorAll('#reading-view .katex').length") == "1" }
        assertEquals("1", evaluate("document.querySelectorAll('#reading-view table').length"))
        assertEquals("true", evaluate("['undo','redo','math','image'].every(id=>document.getElementById(id).disabled)"))
        click(".view-switch [data-mode=split]")
        assertEquals("true", evaluate("(()=>{const a=document.querySelector('#editor').getBoundingClientRect(),b=document.querySelector('#reading-view').getBoundingClientRect();return a.bottom<=b.top+1})()"))
        capture("split-portrait.png")
        instrumentation.runOnMainSync { activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        await { evaluate("Boolean(window.__MOYE_READY__) && innerWidth>=600 && document.querySelector('#surface')?.dataset.mode==='split'") == "true" }
        assertEquals("true", evaluate("(()=>{const a=document.querySelector('#editor').getBoundingClientRect(),b=document.querySelector('#reading-view').getBoundingClientRect();return a.right<=b.left+1})()"))
        capture("split-landscape.png")
        scenario.recreate(); scenario.onActivity { activity = it }
        await { evaluate("Boolean(window.__MOYE_READY__)") == "true" }
        assertTrue(text(".cm-content").contains("阅读验收"))
        instrumentation.runOnMainSync { activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
        await { evaluate("Boolean(window.__MOYE_READY__) && innerWidth<600") == "true" }
    }

    @Test fun encodingPanelConvertsAndWritesGbkThroughSaf() {
        newDocument()
        val body = "# 编码验收-" + System.nanoTime() + "\n\n中文正文"
        edit(body)
        click("#more"); click("#mobile-menu-encoding")
        await { evaluate("document.getElementById('encoding-panel').open") == "true" }
        evaluate("(()=>{let s=document.getElementById('encoding-target');s.value='gbk';s.dispatchEvent(new Event('change'));return true})()")
        await { evaluate("document.querySelector('#encoding-panel [data-apply]').disabled") == "false" }
        click("#encoding-panel [data-apply]"); await { text("#file-encoding").contains("→ GBK") }
        click("#save-file"); click("#save-markdown"); finishPicker()
        await { text("#file-encoding") == "GBK" }
        val uri = android.net.Uri.parse(currentSessionDocument().getString("uri"))
        val bytes = instrumentation.targetContext.contentResolver.openInputStream(uri)!!.use { it.readBytes() }
        assertArrayEquals(body.toByteArray(charset("GBK")), bytes)
    }

    @Test fun systemSaveSaveAsCancelAndReopen() {
        newDocument()
        val title = "MiniMark-${System.nanoTime()}"
        val body = "# $title\n\n中文系统保存\n"
        edit(body)
        click("#save-file"); click("#save-markdown")
        finishPicker()
        await { text("#save-state") == "已保存" }
        val first = currentSessionDocument()
        assertEquals(body, first.getString("savedBody"))
        assertEquals(body, read(first.getString("uri")))
        click("#save-file"); click("#save-markdown-as")
        cancelPicker()
        await { evaluate("document.querySelector('#app').classList.contains('transition-pending')") == "false" }
        assertEquals(first.getString("uri"), currentSessionDocument().getString("uri"))
        click("#save-file"); click("#save-markdown-as")
        finishPicker()
        await { currentSessionDocument().optString("uri") != first.getString("uri") }
        assertTrue(currentSessionDocument().getString("name").endsWith(".md"))
        click("#mobile-back"); click("#open-file")
        assertTrue(device.wait(Until.hasObject(By.pkg("com.android.documentsui")), 10_000))
        assertTrue("Saved file must be selectable in the system picker", UiScrollable(UiSelector().resourceId("com.android.documentsui:id/dir_list"))
            .scrollIntoView(UiSelector().text("$title.md")))
        checkNotNull(device.wait(Until.findObject(By.text("$title.md")), 10_000)).click()
        await { text("#document-name") == "$title.md" }
        assertTrue(text(".cm-content").contains("中文系统保存"))
        assertEquals(body, read(first.getString("uri")))
        val reopenedId = currentSessionDocument().getString("id")
        click("#mobile-back"); click("#open-file")
        assertTrue(device.wait(Until.hasObject(By.pkg("com.android.documentsui")), 10_000))
        assertTrue(UiScrollable(UiSelector().resourceId("com.android.documentsui:id/dir_list"))
            .scrollIntoView(UiSelector().text("$title.md")))
        checkNotNull(device.wait(Until.findObject(By.text("$title.md")), 10_000)).click()
        await { evaluate("document.querySelector('#app').dataset.mobilePage") == "\"editor\"" }
        assertEquals(reopenedId, currentSessionDocument().getString("id"))
    }

    @Test fun filePickerResultSurvivesActivityRecreation() {
        newDocument()
        val body = "# Picker-${System.nanoTime()}\n\n选择文件时的草稿。"
        edit(body)
        click("#save-file"); click("#save-markdown")
        assertTrue(device.wait(Until.hasObject(By.pkg("com.android.documentsui")), 10_000))
        instrumentation.runOnMainSync { activity.recreate() }
        SystemClock.sleep(500)
        finishPicker()
        scenario.onActivity { activity = it }
        await { evaluate("Boolean(window.__MOYE_READY__)") == "true" }
        await { currentSessionDocument().optString("savedBody") == body }
        assertEquals(body, read(currentSessionDocument().getString("uri")))
    }

    @Test fun commandsFormulaPluginsAndCloudEntry() {
        newDocument(); edit("# 工具验收\n\n正文")
        click("#mobile-commands"); click("[data-command=math]")
        await { evaluate("Boolean(document.querySelector('#formula-dialog[open]'))") == "true" }
        click(".formula-source summary")
        setInput("#formula-latex", "\\frac{a}{b}")
        await { evaluate("document.querySelectorAll('.formula-preview .katex').length") == "1" }
        click("#formula-dialog [data-action=save]")
        await { text(".cm-content").contains("\\frac{a}{b}") }
        click("#more"); click("#manage-plugins")
        click("#plugins-dialog [data-action=new]")
        setInput("#plugin-source", "miniMark.register({id:'test-tools',name:'验收插件',version:'1.0.0',commands:[{id:'insert',title:'插入验收文字',run:()=>({replaceSelection:'插件成功'})}]});")
        click("#plugins-dialog [data-action=save]")
        await { text("#plugin-status") == "已保存" }
        click(".plugin-commands button")
        await { text("#plugin-status") == "执行完成" }
        click("#plugins-dialog [data-action=close]")
        assertTrue(text(".cm-content").contains("插件成功"))
        click("#mobile-back"); click("[data-mobile-page=cloud]")
        await { text("#cloud-status").contains("尚未登录") }
        assertEquals("false", evaluate("document.querySelector('#cloud-dialog [data-action=login]').disabled"))
        capture("cloud-signed-out.png")
        click("[data-mobile-page=settings]")
        assertEquals("false", evaluate("document.querySelector('#mobile-settings').hidden"))
    }

    @Test fun nativeBridgeIsUnavailableToUntrustedFramesAndCredentialsAreEncrypted() {
        val result = evaluate("new Promise(resolve=>{const f=document.createElement('iframe');f.sandbox='allow-scripts';f.src='/diagnostics/bridge-probe.html';const receive=e=>{if(e.source===f.contentWindow&&e.data.miniMarkBridgeProbe){removeEventListener('message',receive);f.remove();resolve(e.data.miniMarkBridgeProbe)}};addEventListener('message',receive);document.body.append(f)})", promise = true)
        assertEquals("undefined", unquote(result))
        val root = File(instrumentation.targetContext.cacheDir, "credential-test").apply { mkdirs() }
        val context = object : ContextWrapper(instrumentation.targetContext) { override fun getNoBackupFilesDir() = root }
        val credentials = EncryptedCloudCredentials(context)
        credentials.write(JSONObject().put("accessToken", "isolated-test-token"))
        assertFalse(File(root, "github-credential.bin").readBytes().toString(Charsets.UTF_8).contains("isolated-test-token"))
        assertEquals("isolated-test-token", credentials.read()!!.getString("accessToken"))
        credentials.clear()
    }

    @Test fun longDocumentKeyboardAndIndependentSplitScrolling() {
        newDocument()
        val body = "# 长文档验收\n\n" + (1..160).joinToString("\n\n") { "第 $it 段，中文长文档滚动与键盘操作。" }
        edit(body)
        evaluate("document.querySelector('.cm-content').focus();true")
        device.click(device.displayWidth / 2, device.displayHeight / 3)
        SystemClock.sleep(300)
        assertEquals("true", evaluate("(()=>{const r=document.querySelector('#mobile-editor-tools').getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height+1})()"))
        capture("keyboard.png")
        device.pressBack()
        click(".view-switch [data-mode=split]")
        val editorTop = evaluate("document.querySelector('#editor .cm-scroller').scrollTop")
        val modeTop = evaluate("document.querySelector('.toolbar').getBoundingClientRect().top")
        evaluate("document.querySelector('#reading-view').scrollTop=2000;true")
        assertEquals(editorTop, evaluate("document.querySelector('#editor .cm-scroller').scrollTop"))
        assertEquals(modeTop, evaluate("document.querySelector('.toolbar').getBoundingClientRect().top"))
        assertEquals("true", evaluate("(()=>{const r=document.querySelector('#reading-view').getBoundingClientRect(),f=document.querySelector('.statusbar').getBoundingClientRect();return r.bottom<=f.top+1})()"))
        capture("long-document.png")
    }

    private fun newDocument() {
        click("#mobile-new"); click("[data-new-kind=md]")
        await { evaluate("document.querySelector('#app').dataset.mobilePage") == "\"editor\"" }
        click(".view-switch [data-mode=source]")
        await { evaluate("(()=>{const tab=document.querySelector('.document-tab.active').getBoundingClientRect(),strip=document.querySelector('#tabs').getBoundingClientRect();return tab.left>=strip.left-1&&tab.right<=strip.right+1})()") == "true" }
    }
    private fun edit(text: String) {
        val value = JSONObject.quote(text)
        evaluate("(()=>{const e=document.querySelector('.cm-content');e.focus();document.execCommand('selectAll');document.execCommand('insertText',false,$value);return true})()")
        await { currentSessionDocument().getString("body") == text }
    }
    private fun setInput(selector: String, value: String) {
        evaluate("(()=>{const e=document.querySelector(${JSONObject.quote(selector)});e.value=${JSONObject.quote(value)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()")
    }
    private fun click(selector: String) {
        await { evaluate("Boolean(document.querySelector(${JSONObject.quote(selector)}) && !document.querySelector(${JSONObject.quote(selector)}).disabled)") == "true" }
        evaluate("document.querySelector(${JSONObject.quote(selector)}).click();true")
        SystemClock.sleep(90)
    }
    private fun text(selector: String) = unquote(evaluate("document.querySelector(${JSONObject.quote(selector)})?.textContent ?? ''"))
    private fun unquote(value: String) = runCatching { JSONTokener(value).nextValue().toString() }.getOrDefault(value)
    private fun evaluate(script: String, promise: Boolean = false): String {
        if (promise) {
            evaluate("window.__testResult=null;Promise.resolve($script).then(v=>window.__testResult=v);true")
            await { evaluate("window.__testResult!==null") == "true" }
            return evaluate("window.__testResult")
        }
        val latch = CountDownLatch(1)
        var result = "null"
        scenario.onActivity { activity = it }
        instrumentation.runOnMainSync {
            val web = findWeb(activity.window.decorView) ?: error("Editor WebView missing")
            web.evaluateJavascript(script) { value -> result = value; latch.countDown() }
        }
        check(latch.await(8, TimeUnit.SECONDS)) { "JavaScript result timed out" }
        return result
    }
    private fun findWeb(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) findWeb(view.getChildAt(index))?.let { return it }
        return null
    }
    private fun await(condition: () -> Boolean) {
        val end = SystemClock.uptimeMillis() + 15_000
        while (SystemClock.uptimeMillis() < end) {
            if (runCatching(condition).getOrDefault(false)) return
            SystemClock.sleep(50)
        }
        assertTrue("Timed out waiting for Android UI", condition())
    }
    private fun finishPicker() {
        assertTrue(device.wait(Until.hasObject(By.pkg("com.android.documentsui")), 10_000))
        checkNotNull(device.wait(Until.findObject(By.res("android:id/button1")), 10_000)).click()
        assertTrue(device.wait(Until.hasObject(By.pkg("com.sakuraedge.minimark")), 10_000))
    }
    private fun cancelPicker() {
        assertTrue(device.wait(Until.hasObject(By.pkg("com.android.documentsui")), 10_000))
        val deadline = SystemClock.uptimeMillis() + 10_000
        while (device.hasObject(By.pkg("com.android.documentsui")) && SystemClock.uptimeMillis() < deadline) {
            device.pressBack()
            device.wait(Until.hasObject(By.pkg("com.sakuraedge.minimark")), 500)
        }
        assertTrue(device.wait(Until.hasObject(By.pkg("com.sakuraedge.minimark")), 5_000))
    }
    private fun currentSessionDocument(): JSONObject {
        val root = JSONObject(File(instrumentation.targetContext.filesDir, "documents.json").readText())
        val docs = root.getJSONArray("documents")
        return (0 until docs.length()).map { docs.getJSONObject(it) }.single { it.getString("id") == root.getString("activeId") }
    }
    private fun read(uri: String) = instrumentation.targetContext.contentResolver.openInputStream(android.net.Uri.parse(uri))!!.bufferedReader().use { it.readText() }
    private fun capture(name: String) {
        SystemClock.sleep(350)
        val directory = File(InstrumentationRegistry.getArguments().getString("additionalTestOutputDir") ?: instrumentation.targetContext.getExternalFilesDir(null)!!.absolutePath, "screenshots").apply { mkdirs() }
        assertTrue(device.takeScreenshot(File(directory, name)))
    }
}
