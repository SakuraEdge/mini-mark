package com.sakuraedge.minimark.documents

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

internal const val MAX_TEXT = 20 * 1024 * 1024
internal const val MAX_BYTES = 20 * 1024 * 1024

internal data class DecodedDocument(val body: String, val crlf: Boolean, val bom: Boolean)

internal fun normalizeLines(body: String): String = body.replace("\r\n", "\n").replace('\r', '\n')

internal fun normalizeTextValue(value: TextFieldValue): TextFieldValue {
    if ('\r' !in value.text) return value
    fun offset(position: Int) = normalizeLines(value.text.substring(0, position)).length
    return TextFieldValue(
        normalizeLines(value.text),
        TextRange(offset(value.selection.start), offset(value.selection.end)),
        value.composition?.let { TextRange(offset(it.start), offset(it.end)) },
    )
}

internal fun decodeDocument(bytes: ByteArray): DecodedDocument {
    val decoded = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    val content = decoded.removePrefix("\uFEFF")
    require('\u0000' !in content) { "此文件不是 UTF-8 文本文档。" }
    return DecodedDocument(normalizeLines(content), content.contains("\r\n"), decoded.startsWith('\uFEFF'))
}

internal fun encodeDocument(body: String, crlf: Boolean, bom: Boolean): ByteArray {
    val normalized = normalizeLines(body)
    val content = (if (bom) "\uFEFF" else "") + if (crlf) normalized.replace("\n", "\r\n") else normalized
    val encoded = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(content))
    return ByteArray(encoded.remaining()).also { encoded.get(it) }
}

internal fun isMarkdown(name: String): Boolean =
    name.substringAfterLast('.', "").lowercase() in setOf("md", "markdown", "mdown")

internal fun isUntitledName(name: String): Boolean =
    Regex("^未命名(?: [1-9]\\d*)?\\.md$", RegexOption.IGNORE_CASE).matches(name)

internal fun validDocumentName(name: String): Boolean =
    name.isNotBlank() && name.codePointCount(0, name.length) <= 120 &&
        name.toByteArray(Charsets.UTF_8).size <= 240 &&
        name.none { it in "\\/:*?\"<>|" || it.isISOControl() } &&
        !name.endsWith('.') &&
        !Regex("^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)", RegexOption.IGNORE_CASE).containsMatchIn(name)

internal fun headingDocumentName(body: String): String? {
    val line = body.lineSequence().firstOrNull() ?: return null
    val match = Regex("^ {0,3}#[ \\t]+(.+)$").matchEntire(line) ?: return null
    var title = match.groupValues[1].replace(Regex("[ \\t]+#+[ \\t]*$"), "").trim()
    if (title.isEmpty() || title.all { it == '#' }) return null
    title = title.replace(Regex("[<>:\"/\\\\|?*\\u0000-\\u001f\\u007f-\\u009f]"), " ")
        .replace(Regex("\\s+"), " ").trim().trimEnd('.', ' ')
    if (title.isEmpty()) return null
    if (Regex("^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)", RegexOption.IGNORE_CASE).containsMatchIn(title)) title = "_$title"
    val short = StringBuilder()
    var points = 0
    var bytes = 0
    var offset = 0
    while (offset < title.length && points < 117) {
        val point = Character.codePointAt(title, offset)
        val text = String(Character.toChars(point))
        val count = text.toByteArray(Charsets.UTF_8).size
        if (bytes + count > 237) break
        short.append(text)
        points++
        bytes += count
        offset += Character.charCount(point)
    }
    return short.toString().trimEnd('.', ' ').takeIf { it.isNotEmpty() }?.plus(".md")
}
