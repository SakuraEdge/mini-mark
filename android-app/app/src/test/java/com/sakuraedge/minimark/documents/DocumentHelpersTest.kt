package com.sakuraedge.minimark.documents

import org.junit.Assert.*
import org.junit.Test
import java.nio.charset.CharacterCodingException

class DocumentHelpersTest {
    @Test fun firstLineHeadingNamesDraft() {
        assertEquals("中文笔记.md", headingDocumentName("# 中文笔记\n后续正文"))
        assertEquals("另一个标题.md", headingDocumentName("   # 另一个标题 ###"))
    }

    @Test fun otherLinesAndHeadingLevelsDoNotName() {
        assertNull(headingDocumentName("正文\n# 不是第一行"))
        assertNull(headingDocumentName("\n# 不是第一行"))
        assertNull(headingDocumentName("## 二级标题"))
        assertNull(headingDocumentName("    # 代码块"))
        assertNull(headingDocumentName("#没有空格"))
    }

    @Test fun emptyHeadingDoesNotName() {
        assertNull(headingDocumentName("# "))
        assertNull(headingDocumentName("# ###"))
        assertNull(headingDocumentName("# <>:\"/\\|?*"))
        assertNull(headingDocumentName("# ..."))
    }

    @Test fun headingNameIsPortable() {
        assertEquals("我 的 草稿.md", headingDocumentName("# 我/的:*草稿..."))
        assertEquals("_CON.md", headingDocumentName("# CON"))
        assertEquals("_LPT1.txt.md", headingDocumentName("# LPT1.txt"))
        assertEquals("hello world.md", headingDocumentName("# hello\tworld"))
    }

    @Test fun headingLengthCountsCodePointsAndUtf8Bytes() {
        val chinese = headingDocumentName("# " + "文".repeat(100))!!
        assertEquals("文".repeat(79) + ".md", chinese)
        assertTrue(chinese.toByteArray(Charsets.UTF_8).size <= 240)
        val emoji = headingDocumentName("# " + "\uD83D\uDE00".repeat(100))!!
        assertEquals("\uD83D\uDE00".repeat(59) + ".md", emoji)
        assertFalse(emoji.contains('\uFFFD'))
        assertEquals("a".repeat(117) + ".md", headingDocumentName("# " + "a".repeat(150)))
    }

    @Test fun legacyAutoNamingOnlyRecognizesUntitledMarkdown() {
        assertTrue(isUntitledName("未命名 1.md"))
        assertTrue(isUntitledName("未命名.md"))
        assertTrue(isUntitledName("未命名 37.MD"))
        assertFalse(isUntitledName("未命名 0.md"))
        assertFalse(isUntitledName("未命名 01.md"))
        assertFalse(isUntitledName("我的文件.md"))
        assertFalse(isUntitledName("未命名 1.yaml"))
    }

    @Test fun utf8ChinesePreservesBytes() {
        val bytes = "# 中文\n正文\n".toByteArray(Charsets.UTF_8)
        val result = decodeDocument(bytes)
        assertEquals("# 中文\n正文\n", result.body)
        assertFalse(result.bom)
        assertFalse(result.crlf)
        assertArrayEquals(bytes, encodeDocument(result.body, result.crlf, result.bom))
    }

    @Test fun bomCrLfRoundTrip() {
        val bytes = "\uFEFF# 标题\r\n\r\n正文\r\n".toByteArray(Charsets.UTF_8)
        val result = decodeDocument(bytes)
        assertEquals("# 标题\n\n正文\n", result.body)
        assertTrue(result.bom)
        assertTrue(result.crlf)
        assertArrayEquals(bytes, encodeDocument(result.body, result.crlf, result.bom))
    }

    @Test fun emptyAndLoneCrDecode() {
        assertEquals(DecodedDocument("", false, false), decodeDocument(byteArrayOf()))
        assertEquals(DecodedDocument("", false, true), decodeDocument("\uFEFF".toByteArray(Charsets.UTF_8)))
        assertEquals("a\nb\nc", decodeDocument("a\rb\r\nc".toByteArray(Charsets.UTF_8)).body)
    }

    @Test(expected = CharacterCodingException::class)
    fun invalidUtf8IsRejectedInsteadOfReplacingText() {
        decodeDocument(byteArrayOf(0xc3.toByte(), 0x28))
    }
}
