package com.sakuraedge.minimark.documents

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

internal const val MAX_TEXT = 20 * 1024 * 1024
internal const val MAX_BYTES = 20 * 1024 * 1024

internal data class DecodedDocument(val body: String, val crlf: Boolean, val bom: Boolean,
    val encoding: String = if (bom) "utf-8-bom" else "utf-8", val needsEncoding: Boolean = false)

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

private val preambles = mapOf(
    "utf-8-bom" to byteArrayOf(0xef.toByte(), 0xbb.toByte(), 0xbf.toByte()),
    "utf-16le" to byteArrayOf(0xff.toByte(), 0xfe.toByte()),
    "utf-16be" to byteArrayOf(0xfe.toByte(), 0xff.toByte()),
)
private fun charsetFor(name: String) = when (name) {
    "utf-8", "utf-8-bom" -> Charsets.UTF_8
    "utf-16le" -> Charsets.UTF_16LE
    "utf-16be" -> Charsets.UTF_16BE
    "gbk", "gb18030", "windows-1252" -> charset(name)
    else -> error("请选择支持的文件编码。")
}

internal fun decodeDocument(bytes: ByteArray, requested: String? = "utf-8", offerChoice: Boolean = false): DecodedDocument {
    require(bytes.size <= MAX_BYTES) { "文件超过 20 MB。" }
    val signature = preambles.entries.firstOrNull { (_, prefix) ->
        prefix.size <= bytes.size && prefix.indices.all { bytes[it] == prefix[it] }
    }?.key
    val name = requested ?: signature ?: "utf-8"
    val bom = signature == name || (name == "utf-8" && signature == "utf-8-bom")
    val start = if (bom) preambles.getValue(signature!!).size else 0
    val actual = if (name == "utf-8-bom" || name == "utf-8") (if (bom) "utf-8-bom" else "utf-8") else name
    val decoder = charsetFor(name).newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    val raw = try { decoder.decode(ByteBuffer.wrap(bytes, start, bytes.size - start)).toString() }
        catch (failure: java.nio.charset.CharacterCodingException) {
            if (offerChoice) return DecodedDocument("", false, bom, actual, true)
            throw failure
        }
    if (offerChoice && '\u0000' in raw) return DecodedDocument("", false, bom, actual, true)
    require('\u0000' !in raw) { "所选编码读出了空字符。" }
    return DecodedDocument(normalizeLines(raw), raw.contains("\r\n"), bom, actual)
}

internal fun encodeDocument(body: String, crlf: Boolean, bom: Boolean, name: String = if (bom) "utf-8-bom" else "utf-8"): ByteArray {
    val normalized = normalizeLines(body)
    require('\u0000' !in normalized) { "正文中包含空字符。" }
    val content = if (crlf) normalized.replace("\n", "\r\n") else normalized
    val codec = charsetFor(name)
    val encoded = codec.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(content))
    val prefix = if (name == "utf-8-bom" || bom) preambles[name] ?: byteArrayOf() else byteArrayOf()
    require(prefix.size + encoded.remaining() <= MAX_BYTES) { "编码后的文件超过 20 MB。" }
    require(codec.newDecoder().decode(encoded.asReadOnlyBuffer()).toString() == content) { "目标编码无法完整表示正文。" }
    return ByteArray(prefix.size + encoded.remaining()).also { bytes ->
        prefix.copyInto(bytes); encoded.get(bytes, prefix.size, encoded.remaining())
    }
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
