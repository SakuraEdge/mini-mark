package com.sakuraedge.minimark

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sakuraedge.minimark.updates.UpdateDialog
import com.sakuraedge.minimark.documents.DocumentStore
import com.sakuraedge.minimark.documents.LocalDocument
import io.noties.markwon.Markwon
import android.widget.ScrollView
import android.widget.TextView

private val Canvas = Color(0xFFF4F7FB)
private val Ink = Color(0xFF263246)
private val Muted = Color(0xFF6F7B8D)
private val Blue = Color(0xFF286BD6)

private enum class Page { Library, Editor }
private enum class Mode { Source, Reading, Split }

class MainActivity : ComponentActivity() {
    private val documents by viewModels<DocumentStore>()
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setContent { App(documents) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun App(store: DocumentStore) {
    var page by rememberSaveable { mutableStateOf(Page.Library) }
    var mode by rememberSaveable { mutableStateOf(Mode.Source) }
    var update by rememberSaveable { mutableStateOf(false) }
    var more by rememberSaveable { mutableStateOf(false) }
    var commands by rememberSaveable { mutableStateOf(false) }
    var saveTarget by rememberSaveable { mutableStateOf<String?>(null) }
    val current = store.active
    val open = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) store.open(uri) { page = Page.Editor }
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri: Uri? ->
        val id = saveTarget
        saveTarget = null
        if (uri != null && id != null) store.save(id, uri)
    }
    fun saveAs() {
        val doc = current ?: return
        saveTarget = doc.id
        save.launch(doc.name)
    }
    fun saveCurrent() {
        val doc = current ?: return
        if (doc.uri == null) saveAs() else store.save(doc.id)
    }
    MaterialTheme {
        Surface(Modifier.fillMaxSize(), color = Canvas) {
            if (page == Page.Library || current == null) Library(
                store.documents, store.loaded && !store.busy,
                { store.select(it); page = Page.Editor },
                { store.newDocument(); page = Page.Editor },
                { open.launch(arrayOf("text/*", "application/yaml", "application/x-yaml", "application/octet-stream")) },
                { update = true },
            )
            else Editor(
                current, mode, store.busy, { mode = it }, { store.edit(current.id, it) },
                { page = Page.Library }, ::saveCurrent, { more = true }, { commands = true },
                store::undo, store::redo, store::insert,
            )
            if (update) UpdateDialog { update = false }
            if (more) More(
                { more = false }, { more = false; mode = Mode.Split },
                { more = false; saveAs() }, { more = false; store.insert("| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n") },
            )
            if (commands) Commands({ commands = false }, store::insert)
            store.error?.let { AlertDialog(onDismissRequest = { store.error = null }, title = { Text("Mini Mark") }, text = { Text(it) }, confirmButton = { TextButton({ store.error = null }) { Text("确定") } }) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Library(docs: List<LocalDocument>, enabled: Boolean, open: (String) -> Unit, new: () -> Unit, openFile: () -> Unit, brand: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    Scaffold(containerColor = Canvas, topBar = { TopAppBar(title = { Brand(brand) }, actions = { IconButton(openFile, enabled = enabled) { Icon(Icons.Outlined.FolderOpen, "打开文件") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White)) }) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("搜索文档") }, leadingIcon = { Icon(Icons.Outlined.Search, null) })
                    Text("最近编辑", Modifier.padding(top = 16.dp), color = Muted, fontSize = 12.sp)
                }
                if (docs.isEmpty()) item { Text(if (enabled) "暂无文档" else "正在读取文档…", color = Muted) }
                items(docs.filter { it.name.contains(query, true) }, key = { it.id }) { doc -> Row(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(8.dp)).clickable(enabled) { open(doc.id) }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Description, null, tint = Blue); Column(Modifier.padding(start = 10.dp)) { Text(doc.name, color = Ink); Text(if (doc.uri == null) "本地草稿" else if (doc.dirty) "有未保存修改" else "本地文件", color = Muted, fontSize = 11.sp) } } }
            }
            Button(new, Modifier.align(Alignment.BottomEnd).padding(20.dp), enabled = enabled) { Icon(Icons.Outlined.Add, null); Text("新建") }
        }
    }
}

@Composable
private fun Brand(click: () -> Unit) {
    Row(Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = "版本与更新", onClick = click), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(28.dp).background(Color(0xFF4476DD), RoundedCornerShape(7.dp)), contentAlignment = Alignment.Center) { Text("MM", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold) }
        Text("Mini Mark", color = Ink, fontWeight = FontWeight.Medium)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Editor(doc: LocalDocument, mode: Mode, busy: Boolean, changeMode: (Mode) -> Unit, edit: (TextFieldValue) -> Unit, back: () -> Unit, save: () -> Unit, more: () -> Unit, commands: () -> Unit, undo: () -> Unit, redo: () -> Unit, insert: (String) -> Unit) {
    Scaffold(topBar = { TopAppBar(navigationIcon = { IconButton(back) { Icon(Icons.Outlined.ArrowBack, "返回") } }, title = { Column { Text(doc.name, color = Ink, fontSize = 15.sp); Text(if (busy) "正在保存…" else if (doc.dirty) "有未保存修改" else "已保存", color = Muted, fontSize = 11.sp) } }, actions = { IconButton(save, enabled = !busy) { Icon(Icons.Outlined.Save, "保存") }; IconButton(more) { Icon(Icons.Outlined.MoreVert, "更多") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White)) }, bottomBar = { BottomAppBar(containerColor = Color.White) { IconButton(undo, enabled = !busy) { Icon(Icons.Outlined.Undo, "撤销") }; IconButton(redo, enabled = !busy) { Icon(Icons.Outlined.Redo, "重做") }; IconButton({ insert("\n# ") }) { Icon(Icons.Outlined.Code, "标题") }; IconButton({ insert("\n![图片](图片地址)") }) { Icon(Icons.Outlined.Image, "图片") }; IconButton(commands) { Text("/?") }; IconButton(more) { Icon(Icons.Outlined.MoreHoriz, "更多") } } }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            ModeSelector(mode, changeMode)
            when (mode) {
                Mode.Reading -> Preview(doc.value.text)
                Mode.Split -> Row(Modifier.fillMaxSize().weight(1f).padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(doc.value, edit, Modifier.weight(1f).fillMaxHeight(), textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace, lineHeight = 24.sp), placeholder = { Text("源码") })
                    Preview(doc.value.text, Modifier.weight(1f))
                }
                Mode.Source -> OutlinedTextField(doc.value, edit, Modifier.fillMaxSize().weight(1f).padding(top = 14.dp), textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace, lineHeight = 24.sp), placeholder = { Text("开始输入 Markdown…") })
            }
        }
    }
}

@Composable
private fun ModeSelector(mode: Mode, set: (Mode) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        listOf(Mode.Source to "源码", Mode.Reading to "阅读", Mode.Split to "分屏").forEachIndexed { i, pair -> SegmentedButton(pair.first == mode, { set(pair.first) }, shape = SegmentedButtonDefaults.itemShape(i, 3)) { Text(pair.second, fontSize = 12.sp) } }
    }
}

@Composable
private fun Preview(body: String, modifier: Modifier = Modifier) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val markwon = remember(context) { Markwon.create(context) }
    AndroidView(
        modifier = modifier.fillMaxSize().padding(top = 14.dp),
        factory = { viewContext ->
            ScrollView(viewContext).apply {
                addView(TextView(viewContext).apply {
                    textSize = 16f
                    setTextColor(android.graphics.Color.rgb(38, 50, 70))
                    setTextIsSelectable(true)
                    setLineSpacing(4f, 1.2f)
                })
            }
        },
        update = { markwon.setMarkdown(it.getChildAt(0) as TextView, body) },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun More(close: () -> Unit, reading: () -> Unit, saveAs: () -> Unit, table: () -> Unit) {
    ModalBottomSheet(onDismissRequest = close) { Column(Modifier.padding(20.dp).navigationBarsPadding()) { Text("更多功能", fontSize = 18.sp, fontWeight = FontWeight.Medium); TextButton(reading, Modifier.fillMaxWidth()) { Text("分屏阅读") }; TextButton(saveAs, Modifier.fillMaxWidth()) { Text("另存为") }; TextButton(table, Modifier.fillMaxWidth()) { Text("插入表格") }; Spacer(Modifier.height(8.dp)) } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Commands(close: () -> Unit, insert: (String) -> Unit) {
    ModalBottomSheet(onDismissRequest = close) { Column(Modifier.padding(20.dp).navigationBarsPadding()) { Text("快捷指令", fontSize = 18.sp, fontWeight = FontWeight.Medium); listOf("/公式\n$$\n\n$$", "/图片\n![图片](图片地址)", "/表格\n|列|值|\n|---|---|", "/代码\n```text\n\n```").forEach { command -> TextButton({ insert(command.substringAfter('\n')); close() }, Modifier.fillMaxWidth()) { Text(command.substringBefore('\n'), Modifier.fillMaxWidth()) } } }
}
