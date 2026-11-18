package com.sakuraedge.minimark.documents

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class DocumentSessionTest {
    @Test fun legacyBodyAndBaselineNormalizeTogether() {
        val session = decodeSession("""{"activeId":"one","documents":[{"id":"one","name":"未命名 1.md","body":"a\r\nb\r","savedBody":"a\r\nb\r","crlf":true,"bom":true}]}""")
        val document = session.documents.single().toDocument()
        assertEquals("a\nb\n", document.value.text)
        assertEquals(document.value.text, document.savedBody)
        assertFalse(document.dirty)
        assertTrue(document.crlf)
        assertTrue(document.bom)
        assertTrue(document.autoName)
    }

    @Test fun explicitNullFieldsRestoreAsNullAndEmptyBaselineRemainsEmpty() {
        val session = decodeSession("""{"documents":[{"id":"one","name":"draft.md","body":"","uri":null,"savedBody":"","diskHash":null}]}""")
        val document = session.documents.single().toDocument()
        assertNull(document.uri)
        assertNull(document.diskHash)
        assertEquals("", document.savedBody)
        assertFalse(document.dirty)
    }

    @Test fun connectedDocumentCannotRestoreAutoNaming() {
        val session = decodeSession("""{"documents":[{"id":"one","name":"未命名 1.md","body":"# title","uri":"content://test/doc","autoName":true}]}""")
        assertFalse(session.documents.single().toDocument().autoName)
    }

    @Test fun manualDraftNameDoesNotEnableLegacyAutoNaming() {
        val session = decodeSession("""{"documents":[{"id":"one","name":"笔记.md","body":""}]}""")
        assertFalse(session.documents.single().toDocument().autoName)
    }

    @Test fun failedWriteAndUnsavedContentSurviveSessionRoundTrip() {
        val document = LocalDocument(name = "note.md", body = "new", uri = "content://test/note", savedBody = "old", writeFailed = true)
        val snapshot = SessionSnapshot(document.id, listOf(document.snapshot()))
        val restored = decodeSession(encodeSession(snapshot))
        assertEquals(snapshot, restored)
        assertTrue(restored.documents.single().toDocument().dirty)
        assertTrue(restored.documents.single().toDocument().writeFailed)
    }

    @Test(expected = IllegalArgumentException::class)
    fun duplicateDocumentIdsAreRejected() {
        decodeSession("""{"documents":[{"id":"one","name":"a.md","body":"a"},{"id":"one","name":"b.md","body":"b"}]}""")
    }

    @Test fun cloudBindingAndSafParentSurviveSessionRoundTrip() {
        val doc = LocalDocument(name = "云笔记.md", body = "latest", savedBody = "local", revision = 7,
            cloud = CloudBinding("test-user", "notes/云笔记.md", "a".repeat(40), "cloud"), parentUri = "content://test/tree/root/document/root")
        val expected = SessionSnapshot(doc.id, listOf(doc.snapshot()))
        val restored = decodeSession(encodeSession(expected))
        assertEquals(expected, restored)
        assertEquals(7L, restored.documents.single().revision)
        assertFalse(restored.documents.single().toDocument().autoName)
    }
}
