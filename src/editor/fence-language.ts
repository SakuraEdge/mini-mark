import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

const choices = new Map<string, string>([
  ['', '未指定'], ['text', '纯文本'], ['cpp', 'C++'], ['c', 'C'], ['csharp', 'C#'],
  ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['json', 'JSON'], ['python', 'Python'],
  ['html', 'HTML'], ['css', 'CSS'], ['yaml', 'YAML'], ['xml', 'XML'], ['bash', 'Bash'], ['sql', 'SQL'],
  ['java', 'Java'], ['kotlin', 'Kotlin'], ['swift', 'Swift'], ['go', 'Go'], ['rust', 'Rust'], ['markdown', 'Markdown'],
]);
const preferenceKey = 'minimark.editor.fence-language';
let recent = 'cpp';

export function preferredFenceLanguage() {
  try {
    const stored = localStorage.getItem(preferenceKey);
    if (stored !== null && choices.has(stored)) recent = stored;
  } catch { /* Use this session's preference when storage is unavailable. */ }
  return recent;
}

function remember(language: string) {
  recent = language;
  try { localStorage.setItem(preferenceKey, language); } catch { /* Session preference is still available. */ }
}

function header(state: EditorState, fence: SyntaxNode) {
  const mark = fence.firstChild;
  if (mark?.name !== 'CodeMark') return null;
  const info = fence.getChild('CodeInfo');
  const from = info?.from ?? mark.to;
  const language = info ? /^\S+/.exec(state.sliceDoc(from, info.to))?.[0] ?? '' : '';
  return { mark, from, to: from + language.length, language };
}

function openingFenceAt(state: EditorState, pos: number) {
  const tree = ensureSyntaxTree(state, pos, 30) ?? syntaxTree(state);
  const line = state.doc.lineAt(pos);
  for (let node: SyntaxNode | null = tree.resolve(pos, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' && node.from >= line.from) return node;
  }
  return null;
}

class LanguagePicker extends WidgetType {
  constructor(readonly opening: number, readonly language: string, readonly disabled: boolean) { super(); }
  eq(other: LanguagePicker) {
    return this.opening === other.opening && this.language === other.language && this.disabled === other.disabled;
  }
  toDOM(view: EditorView) {
    const select = document.createElement('select');
    select.className = 'fence-language';
    select.setAttribute('aria-label', '代码块语言');
    select.title = '代码块语言';
    select.disabled = this.disabled;
    const options = new Map(choices);
    if (!options.has(this.language)) options.set(this.language, this.language);
    for (const [value, label] of options) {
      // A native option label keeps picker labels out of the editor's plain text DOM.
      const option = document.createElement('option');
      option.value = value;
      option.label = label;
      select.add(option);
    }
    select.value = this.language;
    select.addEventListener('change', () => {
      if (!view.contentDOM.contains(select) || view.state.readOnly || !view.state.facet(EditorView.editable)) return;
      const language = select.value;
      const fence = openingFenceAt(view.state, view.posAtDOM(select));
      const current = fence && header(view.state, fence);
      if (!current || fence.from !== this.opening || current.language !== this.language || !choices.has(language)) return;
      // An explicit plain-text language keeps any remaining fence metadata unambiguous.
      const suffix = view.state.sliceDoc(current.to, view.state.doc.lineAt(current.to).to);
      const insert = !language && suffix.trim() ? 'text' : language;
      view.dispatch({ changes: { from: current.from, to: current.to, insert }, annotations: isolateHistory.of('full'), userEvent: 'input' });
      remember(insert);
      view.focus();
    });
    return select;
  }
}

function pickers(view: EditorView) {
  const items: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  const disabled = view.state.readOnly || !view.state.facet(EditorView.editable);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({ from, to, enter(node) {
      if (node.name !== 'FencedCode') return;
      const pos = view.state.doc.lineAt(node.from).to;
      if (pos >= from && pos <= to) {
        const info = header(view.state, node.node);
        if (info) items.push(Decoration.widget({ widget: new LanguagePicker(node.from, info.language, disabled), side: 1 }).range(pos));
      }
      return false;
    } });
  }
  return Decoration.set(items, true);
}

const pickerPlugin = ViewPlugin.fromClass(class {
  decorations: ReturnType<typeof pickers>;
  constructor(view: EditorView) { this.decorations = pickers(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState) ||
        update.state.facet(EditorView.editable) !== update.startState.facet(EditorView.editable) || update.state.readOnly !== update.startState.readOnly) {
      this.decorations = pickers(update.view);
    }
  }
}, { decorations: plugin => plugin.decorations });

// Extend the editor's own Enter transaction so indentation, IME and undo stay together.
const defaultOnNewline = EditorState.transactionFilter.of(tr => {
  const state = tr.startState;
  if (!tr.docChanged || !tr.isUserEvent('input') || tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop') ||
      tr.isUserEvent('input.complete') || !state.selection.main.empty || state.selection.ranges.length !== 1) return tr;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  if (pos !== line.to || !/(?:`{3,}|~{3,})[ \t]*$/.test(line.text)) return tr;
  let enters = false;
  tr.changes.iterChanges((a, b, _c, _d, inserted) => {
    if (a >= line.from && b === pos && inserted.lines === 2 && inserted.line(1).length === 0) enters = true;
  });
  if (!enters) return tr;
  const fence = openingFenceAt(state, pos);
  const info = fence && header(state, fence);
  if (!info || info.language || state.sliceDoc(info.mark.to, pos).trim()) return tr;
  const language = preferredFenceLanguage();
  return language ? [tr, { changes: { from: tr.changes.mapPos(info.mark.to, -1), insert: language }, sequential: true }] : tr;
});

export const fenceLanguages = [pickerPlugin, defaultOnNewline];
