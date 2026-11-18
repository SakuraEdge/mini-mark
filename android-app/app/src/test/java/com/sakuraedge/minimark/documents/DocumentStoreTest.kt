package com.sakuraedge.minimark.documents

import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import java.io.File
import java.io.FileNotFoundException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@LooperMode(LooperMode.Mode.PAUSED)
class DocumentStoreTest {
    private lateinit var application: Application
    private lateinit var models: ViewModelStore
    private lateinit var store: DocumentStore
    private lateinit var provider: TestDocumentProvider
    private val uri = Uri.parse("content://minimark-test/note.md")

    @Before fun setUp() {
        application = RuntimeEnvironment.getApplication()
        File(application.filesDir, "documents.json").delete()
        File(application.filesDir, "documents.json.bak").delete()
        File(application.filesDir, "documents.json.new").delete()
        provider = TestDocumentProvider()
        provider.attachInfo(application, ProviderInfo().apply { authority = "minimark-test" })
        ShadowContentResolver.registerProviderInternal("minimark-test", provider)
        models = ViewModelStore()
        store = createStore(models)
        await { store.loaded }
    }

    @After fun tearDown() {
        provider.releaseWrite?.countDown()
        await { !store.busy }
        store.flushDrafts()
        val expected = store.documents.map { it.snapshot() }
        await {
            runCatching { decodeSession(File(application.filesDir, "documents.json").readText()).documents == expected }.getOrDefault(false)
        }
        models.clear()
        shadowOf(Looper.getMainLooper()).idle()
    }

    @Test fun headingRenameUndoAndManualNameAreIndependentOfOtherDocuments() {
        store.newDocument()
        val first = store.active!!
        store.edit(first.id, TextFieldValue("# 中文标题\r\n正文", TextRange(12)))
        assertEquals("中文标题.md", first.name)
        assertFalse(first.value.text.contains('\r'))
        store.undo()
        assertEquals("", first.value.text)
        store.redo()
        assertEquals("# 中文标题\n正文", first.value.text)
        assertTrue(store.renameDraft(first.id, "manual.md"))
        store.edit(first.id, TextFieldValue("# Another title"))
        assertEquals("manual.md", first.name)
        store.newDocument()
        assertEquals("未命名 1.md", store.active!!.name)
        assertEquals(2, store.documents.size)
        assertEquals("# Another title", first.value.text)
    }

    @Test fun selectionOnlyChangeDoesNotAddUndoHistory() {
        store.newDocument()
        val document = store.active!!
        store.edit(document.id, TextFieldValue("abc", TextRange(3)))
        val historySize = document.undo.size
        store.edit(document.id, TextFieldValue("abc", TextRange(1)))
        assertEquals(historySize, document.undo.size)
    }

    @Test fun repeatedOpenRetainsUnsavedText() {
        openDocument("original")
        val document = store.active!!
        store.edit(document.id, TextFieldValue("unsaved"))
        store.open(uri) {}
        assertEquals(1, store.documents.size)
        assertEquals("unsaved", store.active!!.value.text)
    }

    @Test fun externalChangeBlocksOverwriteAndKeepsLocalText() {
        openDocument("original")
        val document = store.active!!
        store.edit(document.id, TextFieldValue("local"))
        provider.file.writeText("external")
        store.save(document.id)
        await { !store.busy }
        assertEquals("external", provider.file.readText())
        assertEquals("local", document.value.text)
        assertTrue(document.dirty)
        assertTrue(store.error!!.contains("其他应用"))
    }

    @Test fun editingDuringSaveRetainsLaterTextAndSavedSnapshot() {
        openDocument("original")
        val document = store.active!!
        store.edit(document.id, TextFieldValue("saved snapshot"))
        provider.writeStarted = CountDownLatch(1)
        provider.releaseWrite = CountDownLatch(1)
        store.save(document.id)
        assertTrue(provider.writeStarted!!.await(10, TimeUnit.SECONDS))
        store.edit(document.id, TextFieldValue("later edit"))
        provider.releaseWrite!!.countDown()
        await { !store.busy }
        assertNull(store.error)
        assertEquals("saved snapshot", provider.file.readText())
        assertEquals("saved snapshot", document.savedBody)
        assertEquals("later edit", document.value.text)
        assertTrue(document.dirty)
    }

    @Test fun providerFailureKeepsTextAndBlocksBlindRetry() {
        openDocument("original")
        val document = store.active!!
        store.edit(document.id, TextFieldValue("local"))
        provider.failWrite = true
        store.save(document.id)
        await { !store.busy }
        assertEquals("local", document.value.text)
        assertTrue(document.writeFailed)
        assertTrue(document.dirty)
        provider.failWrite = false
        store.save(document.id)
        assertFalse(store.busy)
        assertTrue(store.error!!.contains("另存为"))
        assertEquals("", provider.file.readText())
    }

    @Test fun saveRoundTripRetainsBomAndCrLf() {
        openDocument("\uFEFF# 标题\r\n正文\r\n")
        val document = store.active!!
        store.edit(document.id, TextFieldValue("# 标题\n新正文\n"))
        store.save(document.id)
        await { !store.busy }
        assertNull(store.error)
        assertEquals("\uFEFF# 标题\r\n新正文\r\n", provider.file.readText())
        assertFalse(document.dirty)
    }

    @Test fun saveCannotTargetAnotherOpenDocument() {
        openDocument("original")
        store.newDocument()
        val draft = store.active!!
        store.edit(draft.id, TextFieldValue("draft"))
        store.save(draft.id, uri)
        assertFalse(store.busy)
        assertEquals("original", provider.file.readText())
        assertNull(draft.uri)
        assertTrue(store.error!!.contains("另一份文档"))
    }

    @Test fun draftFlushRestoresTextNamesAndActiveDocument() {
        store.newDocument()
        val document = store.active!!
        store.edit(document.id, TextFieldValue("# retained\nbody"))
        store.flushDrafts()
        await {
            runCatching { decodeSession(File(application.filesDir, "documents.json").readText()).documents.single().body == document.value.text }.getOrDefault(false)
        }
        models.clear()
        models = ViewModelStore()
        store = createStore(models)
        await { store.loaded }
        assertEquals(document.id, store.activeId)
        assertEquals("retained.md", store.active!!.name)
        assertEquals("# retained\nbody", store.active!!.value.text)
        assertTrue(store.active!!.dirty)
    }

    @Test fun dirtyCloseRequiresConfirmation() {
        store.newDocument()
        val document = store.active!!
        store.edit(document.id, TextFieldValue("keep me"))
        assertFalse(store.forget(document.id))
        assertEquals("keep me", store.active!!.value.text)
        assertTrue(store.forget(document.id, discardChanges = true))
        assertTrue(store.documents.isEmpty())
    }

    @Test fun immediatelyReopenedStoreWaitsForPreviousFinalDraftWrite() {
        store.newDocument()
        val id = store.activeId!!
        store.edit(id, TextFieldValue("# final keystroke\nretained"))
        models.clear()
        models = ViewModelStore()
        store = createStore(models)
        await { store.loaded }
        assertNull(store.error)
        assertEquals(id, store.activeId)
        assertEquals("# final keystroke\nretained", store.active!!.value.text)
        assertEquals("final keystroke.md", store.active!!.name)
    }

    @Test fun cloudSaveBaselineKeepsLaterEditsAndOriginalLocalBaseline() {
        openDocument("local baseline")
        val doc = store.active!!
        store.webEdit(doc.id, "cloud snapshot", 1)
        store.webEdit(doc.id, "newer edit", 2)
        store.bindCloud(doc.id, "test-user", "notes/test.md", "a".repeat(40), "cloud snapshot")
        assertEquals("local baseline", doc.savedBody)
        assertEquals("cloud snapshot", doc.cloud!!.baseline)
        assertEquals("newer edit", doc.value.text)
        assertTrue(doc.dirty)
        store.detachCloud(doc.id)
        assertNull(doc.cloud)
        assertEquals("local baseline", doc.savedBody)
        assertTrue(doc.dirty)
    }

    @Test fun webSnapshotsRejectStaleAndMismatchedDocumentIds() {
        store.newDocument()
        val doc = store.active!!
        assertTrue(store.webEdit(doc.id, "new", 3))
        assertFalse(store.webEdit(doc.id, "old", 2))
        assertFalse(store.webEdit(doc.id, "different", 3))
        assertFalse(store.webEdit("closed-document", "bad", 10))
        assertEquals("new", doc.value.text)
        assertEquals(3L, doc.revision)
    }

    @Test fun reopeningCloudKeepsDraftAndRemoteCopyGetsSeparateIdentity() {
        val first = store.openCloud("test-user", "notes/a.md", "a".repeat(40), "remote")
        store.webEdit(first.id, "local edit", 1)
        assertEquals(first.id, store.openCloud("TEST-USER", "notes/a.md", "b".repeat(40), "new remote").id)
        assertEquals("local edit", first.value.text)
        val remote = store.openCloud("test-user", "notes/a.md", "b".repeat(40), "new remote", separate = true)
        assertNotEquals(first.id, remote.id)
        assertNull(first.cloud)
        assertEquals("local edit", first.value.text)
        assertEquals("new remote", remote.value.text)
    }

    @Test fun cloudFolderDeletionOnlyDetachesMatchingAccountAndDescendants() {
        val target = store.openCloud("test-user", "notes/a.md", "a".repeat(40), "a")
        val sibling = store.openCloud("test-user", "notebook/b.md", "b".repeat(40), "b")
        val other = store.openCloud("other-user", "notes/a.md", "c".repeat(40), "other")
        store.cloudDeleted("test-user", "notes", true)
        assertNull(target.cloud)
        assertNotNull(sibling.cloud)
        assertNotNull(other.cloud)
        assertEquals("a", target.value.text)
    }

    private fun createStore(models: ViewModelStore): DocumentStore =
        ViewModelProvider(models, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T = DocumentStore(application) as T
        })[DocumentStore::class.java]

    private fun openDocument(body: String) {
        provider.file.writeText(body)
        store.open(uri) {}
        await { !store.busy }
        assertNull(store.error)
        assertNotNull(store.active)
    }

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
        while (System.nanoTime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            if (condition()) return
            Thread.sleep(10)
        }
        assertTrue("Timed out waiting for document operation", condition())
    }
}

class TestDocumentProvider : ContentProvider() {
    lateinit var file: File
    var failWrite = false
    var writeStarted: CountDownLatch? = null
    var releaseWrite: CountDownLatch? = null

    override fun onCreate(): Boolean {
        file = File(context!!.cacheDir, "provider-note.md")
        file.writeText("")
        return true
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if ('w' in mode) {
            writeStarted?.countDown()
            check(releaseWrite?.await(10, TimeUnit.SECONDS) != false)
            if (failWrite) {
                file.writeText("")
                throw FileNotFoundException("Provider write failed")
            }
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.parseMode(mode))
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor =
        MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME)).apply { addRow(arrayOf("note.md")) }

    override fun getType(uri: Uri) = "text/plain"
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
