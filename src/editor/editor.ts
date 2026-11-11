import { Compartment, EditorSelection, EditorState, Prec, RangeSetBuilder, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, highlightActiveLine, keymap, lineNumbers, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { yamlLanguage } from '@codemirror/lang-yaml';
import { html } from '@codemirror/lang-html';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { commands, imeBlocksCommand, matchingCommands, slashQuery, type SlashCommand } from './commands';
import { renderMarkdown, renderMath } from '../markdown/render';
import type { DocumentLanguage } from '../documents/formats';
import { createIcons, PencilLine, Sigma } from 'lucide';
import { EDIT_FORMULA_EVENT, mathBlocks } from './math-blocks';

export type EditorMode = 'live' | 'source' | 'read' | 'split';
export const modeCompartment = new Compartment();
const languageCompartment = new Compartment();
const fontCompartment = new Compartment();
const editableCompartment = new Compartment();

const colors = HighlightStyle.define([
  { tag: tags.heading1, class: 'syntax-h1' },
  { tag: tags.heading2, class: 'syntax-h2' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: 'syntax-h3' },
  { tag: tags.strong, fontWeight: '700', class: 'syntax-strong' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.url, tags.link], class: 'syntax-link' },
  { tag: tags.monospace, class: 'syntax-inline-code' },
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], class: 'syntax-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'syntax-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'syntax-number' },
  { tag: [tags.typeName, tags.className], class: 'syntax-type' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'syntax-function' },
  { tag: [tags.comment, tags.meta], class: 'syntax-comment' },
  { tag: tags.processingInstruction, class: 'syntax-keyword' },
  { tag: tags.tagName, class: 'syntax-keyword' },
  { tag: tags.attributeName, class: 'syntax-type' },
  { tag: tags.attributeValue, class: 'syntax-string' },
]);

function inCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (;;) {
    if (/^(FencedCode|CodeBlock|InlineCode)$/.test(node.name)) return true;
    if (!node.parent) return false;
    node = node.parent;
  }
}

class RenderedBlock extends WidgetType {
  constructor(readonly html: string, readonly position: number, readonly kind: string) { super(); }
  eq(other: RenderedBlock) { return this.html === other.html && this.position === other.position; }
  toDOM(view: EditorView) {
    const element = document.createElement('div');
    element.className = `rendered-block markdown-body ${this.kind}`;
    element.innerHTML = this.html;
    element.setAttribute('aria-label', this.kind === 'math-block' ? '数学公式，点击编辑' : this.kind === 'image-block' ? '图片，点击编辑' : '表格，点击编辑');
    for (const image of element.querySelectorAll('img')) {
      image.addEventListener('load', () => view.requestMeasure(), { once: true });
      image.addEventListener('error', () => {
        const message = document.createElement('span'); message.className = 'image-error';
        message.textContent = image.alt ? `图片无法加载：${image.alt}` : '图片无法加载';
        image.replaceWith(message); view.requestMeasure();
      }, { once: true });
    }
    element.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('a')) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.position }, scrollIntoView: true });
      view.focus();
    });
    return element;
  }
  ignoreEvent() { return false; }
}

class FormulaButton extends WidgetType {
  constructor(readonly position: number, readonly latex?: string) { super(); }
  eq(other: FormulaButton) { return this.position === other.position && this.latex === other.latex; }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = this.latex === undefined ? 'formula-entry' : 'rendered-block markdown-body math-block formula-rendered';
    button.setAttribute('aria-label', '公式编辑器');
    button.title = '编辑公式';
    button.innerHTML = this.latex?.trim() ? renderMath(this.latex) : '<i data-lucide="sigma"></i><span>公式编辑器</span><i data-lucide="pencil-line"></i>';
    createIcons({ icons: { Sigma, PencilLine }, root: button, attrs: { 'stroke-width': 1.65 } });
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      view.dom.dispatchEvent(new CustomEvent(EDIT_FORMULA_EVENT, { detail: this.position }));
    });
    return button;
  }
  ignoreEvent() { return true; }
}

const formulaEntries = StateField.define<DecorationSet>({
  create: formulaEntryDecorations,
  update: (_, transaction) => formulaEntryDecorations(transaction.state),
  provide: field => EditorView.decorations.from(field),
});

function formulaEntryDecorations(state: EditorState) {
  const block = mathBlocks(state).find(item => state.selection.main.head >= item.from && state.selection.main.head <= item.to);
  if (!block) return Decoration.none;
  const position = state.doc.lineAt(block.contentFrom).to;
  return Decoration.set([Decoration.widget({ widget: new FormulaButton(block.from), side: 1 }).range(position)]);
}

function liveDecorations(state: EditorState): DecorationSet {
  const decorations: { from: number; to: number; value: Decoration }[] = [];
  const covered: { from: number; to: number }[] = [];
  const selected = state.selection.ranges.map((range) => ({
    from: state.doc.lineAt(range.from).from, to: state.doc.lineAt(range.to).to,
  }));
  const active = (from: number, to: number) => selected.some((range) => range.from <= to && range.to >= from);
  const add = (from: number, to: number, value: Decoration) => decorations.push({ from, to, value });
  for (const { from, to, latex } of mathBlocks(state)) {
    if (!active(from, to)) {
      add(from, to, Decoration.replace({ widget: new FormulaButton(from, latex), block: true }));
      covered.push({ from, to });
    }
  }
  syntaxTree(state).iterate({
    enter(node) {
      if (covered.some((range) => node.from >= range.from && node.to <= range.to)) return false;
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        const fromLine = state.doc.lineAt(node.from).number;
        const toLine = state.doc.lineAt(node.to).number;
        for (let n = fromLine; n <= toLine; n++) {
          const line = state.doc.line(n);
          add(line.from, line.from, Decoration.line({ class: `code-line${n === fromLine ? ' code-first' : ''}${n === toLine ? ' code-last' : ''}` }));
        }
        return false;
      }
      if (node.name === 'Table' && !active(node.from, node.to)) {
        add(node.from, node.to, Decoration.replace({ widget: new RenderedBlock(renderMarkdown(state.sliceDoc(node.from, node.to)), node.from + 2, 'table-block'), block: true }));
        return false;
      }
      if (node.name === 'Image' && !active(node.from, node.to)) {
        const line = state.doc.lineAt(node.from);
        if (state.doc.lineAt(node.to).number === line.number && state.sliceDoc(line.from, node.from).trim() === '' && state.sliceDoc(node.to, line.to).trim() === '') {
          add(line.from, line.to, Decoration.replace({ widget: new RenderedBlock(renderMarkdown(line.text), node.from, 'image-block'), block: true }));
          return false;
        }
      }
      if (/^ATXHeading[1-6]$/.test(node.name)) {
        add(node.from, node.from, Decoration.line({ class: `heading-line heading-${node.name.slice(-1)}` }));
      }
      if (node.name === 'Blockquote') {
        const end = state.doc.lineAt(node.to).number;
        for (let n = state.doc.lineAt(node.from).number; n <= end; n++) add(state.doc.line(n).from, state.doc.line(n).from, Decoration.line({ class: 'quote-line' }));
      }
      if (!active(node.from, node.to) && /^(HeaderMark|EmphasisMark|CodeMark|StrikethroughMark|QuoteMark)$/.test(node.name)) {
        let to = node.to;
        if ((node.name === 'HeaderMark' || node.name === 'QuoteMark') && state.sliceDoc(to, to + 1) === ' ') to++;
        add(node.from, to, Decoration.replace({}));
      }
    },
  });
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.length && !covered.some((range) => line.from >= range.from && line.from < range.to)) {
      add(line.from, line.from, Decoration.line({ class: 'blank-line' }));
    }
  }
  decorations.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const item of decorations) builder.add(item.from, item.to, item.value);
  return builder.finish();
}

const liveField = StateField.define<DecorationSet>({
  create: liveDecorations,
  update: (_, transaction) => liveDecorations(transaction.state),
  provide: (field) => EditorView.decorations.from(field),
});

class SlashMenu {
  dom = document.createElement('div');
  options: SlashCommand[] = [];
  selected = 0;
  from = 0;
  to = 0;
  composing = false;
  compositionEnd = -Infinity;
  dismissed = '';
  signature = '';
  captureKey = (event: KeyboardEvent) => {
    if (!this.options.length || event.key !== 'Enter') return;
    if (event.isComposing || event.keyCode === 229 || this.composing || this.view.compositionStarted) {
      // Keep the IME's default commit, but do not let editor keymaps insert a newline.
      event.stopImmediatePropagation();
    } else if (performance.now() - this.compositionEnd < 80) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  constructor(readonly view: EditorView) {
    this.dom.className = 'slash-menu';
    this.dom.hidden = true;
    this.dom.setAttribute('role', 'listbox');
    this.dom.setAttribute('aria-label', '插入内容');
    document.body.append(this.dom);
    view.contentDOM.addEventListener('keydown', this.captureKey, true);
    this.refresh();
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.focusChanged) this.refresh();
    else if (update.geometryChanged && this.options.length) this.position();
  }
  refresh() {
    const { state } = this.view;
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    const query = slashQuery(line.text, pos - line.from);
    this.signature = `${line.from}:${line.text}`;
    if (!query || !state.selection.main.empty || state.selection.ranges.length !== 1 || inCode(state, pos) || this.signature === this.dismissed || !this.view.hasFocus) {
      this.options = []; this.dom.hidden = true; return;
    }
    this.from = line.from + query.from; this.to = line.from + query.to;
    this.options = matchingCommands(query.query);
    this.selected = Math.min(this.selected, this.options.length - 1);
    this.render();
  }
  render() {
    this.dom.hidden = !this.options.length;
    this.dom.replaceChildren();
    const title = document.createElement('div');
    title.className = 'slash-title'; title.textContent = '插入内容';
    this.dom.append(title);
    this.options.forEach((command, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `slash-option ${index === this.selected ? 'selected' : ''}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === this.selected));
      const symbol = document.createElement('span');
      symbol.className = 'slash-symbol';
      symbol.textContent = ({ math: '∑', 'inline-math': 'x', code: '</>', table: '▦', todo: '☑', quote: '❞', h1: 'H₁', h2: 'H₂', rule: '—' } as Record<string, string>)[command.id];
      const name = document.createElement('span'); name.className = 'slash-name'; name.textContent = command.label;
      const hint = document.createElement('small'); hint.textContent = command.hint; name.append(hint);
      button.append(symbol, name);
      button.addEventListener('mousedown', (event) => { event.preventDefault(); this.apply(command); });
      this.dom.append(button);
    });
    this.position();
  }
  position() {
    this.view.requestMeasure({
      key: this,
      read: () => this.view.coordsAtPos(this.view.state.selection.main.head),
      write: (coords) => {
        if (!coords || this.dom.hidden) return;
        const height = this.dom.getBoundingClientRect().height;
        this.dom.style.left = `${Math.max(8, Math.min(coords.left, window.innerWidth - 332))}px`;
        this.dom.style.top = `${coords.bottom + height + 14 < window.innerHeight ? coords.bottom + 8 : Math.max(8, coords.top - height - 8)}px`;
      },
    });
  }
  apply(command: SlashCommand) {
    if (this.composing || this.view.composing) return;
    this.view.dispatch({
      changes: { from: this.from, to: this.to, insert: command.text },
      selection: { anchor: this.from + command.cursor },
      userEvent: 'input.complete',
      scrollIntoView: true,
    });
    this.view.focus(); this.options = []; this.dom.hidden = true; this.selected = 0;
  }
  key(event: KeyboardEvent): boolean {
    if (!this.options.length) return false;
    if (imeBlocksCommand(event, this.composing || this.view.composing, performance.now(), this.compositionEnd)) {
      return !event.isComposing && event.keyCode !== 229 && !this.composing && !this.view.composing && event.key === 'Enter';
    }
    if (event.key === 'Escape') {
      this.dismissed = this.signature; this.options = []; this.dom.hidden = true; return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.selected = (this.selected + (event.key === 'ArrowDown' ? 1 : -1) + this.options.length) % this.options.length;
      this.render(); this.dom.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') { this.apply(this.options[this.selected]); return true; }
    return false;
  }
  destroy() { this.view.contentDOM.removeEventListener('keydown', this.captureKey, true); this.dom.remove(); }
}

const slashPlugin = ViewPlugin.fromClass(SlashMenu, {
  eventHandlers: {
    compositionstart() { this.composing = true; },
    compositionend() { this.composing = false; this.compositionEnd = performance.now(); },
    keydown(event) { return this.key(event); },
  },
});

export function modeExtensions(mode: EditorMode): Extension {
  return mode === 'live' ? [liveField] : [lineNumbers(), foldGutter(), highlightActiveLine()];
}

const listeners = new WeakMap<EditorView, (update: ViewUpdate) => void>();

function languageExtensions(language: DocumentLanguage): Extension {
  const parser = language === 'html' ? html() : language === 'yaml'
    ? yamlLanguage
    : markdown({ base: markdownLanguage, codeLanguages: languages });
  if (language !== 'markdown') {
    return [parser, keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab])];
  }
  return [
    parser,
    formulaEntries,
    Prec.highest(slashPlugin),
    keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  ];
}

function makeState(doc: string, onChange: (update: ViewUpdate) => void, mode: EditorMode, language: DocumentLanguage) {
  return EditorState.create({
      doc,
      extensions: [
        history(), indentOnInput(), bracketMatching(), highlightSelectionMatches(),
        languageCompartment.of(languageExtensions(language)),
        syntaxHighlighting(colors),
        search({ top: true }),
        placeholder('写点什么…'),
        EditorView.lineWrapping,
        EditorState.tabSize.of(4),
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown 编辑器', spellcheck: 'false' }),
        modeCompartment.of(modeExtensions(mode)),
        fontCompartment.of(EditorView.theme({ '.cm-content': { fontSize: '16px' } })),
        EditorView.updateListener.of(onChange),
        editableCompartment.of(EditorView.editable.of(true)),
      ],
  });
}

export function createEditor(parent: HTMLElement, onChange: (update: ViewUpdate) => void) {
  const view = new EditorView({ parent, state: makeState('', onChange, 'live', 'markdown') });
  listeners.set(view, onChange);
  return view;
}

export function replaceDocument(view: EditorView, text: string, mode: EditorMode, language: DocumentLanguage = 'markdown') {
  view.setState(makeState(text, listeners.get(view)!, mode, language));
}

export function setEditorLanguage(view: EditorView, language: DocumentLanguage) {
  view.dispatch({ effects: languageCompartment.reconfigure(languageExtensions(language)) });
}

export function setHeadingLevel(view: EditorView, level: number): boolean {
  if (level < 1 || level > 6 || !view.hasFocus || view.composing) return false;
  const state = view.state;
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number;
    const endPosition = range.empty ? range.to : Math.max(range.from, range.to - 1);
    const end = state.doc.lineAt(endPosition).number;
    for (let number = start; number <= end; number++) lines.add(number);
  }
  const editable: { from: number; to: number; match: RegExpExecArray | null; prefixFrom: number; contentStart: number; content: string }[] = [];
  for (const number of [...lines].sort((a, b) => a - b)) {
    const line = state.doc.line(number);
    if (!line.text.trim() || inCode(state, line.from)) continue;
    const match = /^([ \t]{0,3})(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line.text);
    if (match) {
      const content = match[3];
      editable.push({
        from: line.from,
        to: line.to,
        match,
        prefixFrom: line.from + match[1].length,
        contentStart: line.from + match[0].length - content.length,
        content,
      });
      continue;
    }
    const leading = /^[ \t]*/.exec(line.text)?.[0] ?? '';
    if (leading.length > 3) continue;
    editable.push({
      from: line.from,
      to: line.to,
      match: null,
      prefixFrom: line.from + leading.length,
      contentStart: line.from + leading.length,
      content: line.text.slice(leading.length),
    });
  }
  const toggleOff = editable.length > 0 && editable.every(item => item.match && item.match[2].length === level);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const item of editable) {
    if (toggleOff) {
      if (item.match) changes.push({ from: item.prefixFrom, to: item.contentStart, insert: '' });
      continue;
    }
    const prefix = `${'#'.repeat(level)}${item.content ? ' ' : ''}`;
    if (item.match) {
      if (state.sliceDoc(item.prefixFrom, item.contentStart) !== prefix) changes.push({ from: item.prefixFrom, to: item.contentStart, insert: prefix });
    } else {
      changes.push({ from: item.prefixFrom, to: item.contentStart, insert: prefix });
    }
  }
  if (!changes.length || view.composing) return false;
  view.dispatch({ changes, userEvent: 'input' });
  view.focus();
  return true;
}

export function setEditorFont(view: EditorView, size: number) {
  view.dispatch({ effects: fontCompartment.reconfigure(EditorView.theme({ '.cm-content': { fontSize: `${size}px` } })) });
}

export function setEditorEditable(view: EditorView, editable: boolean) {
  view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(editable)) });
}

export function surround(view: EditorView, before: string, after = before) {
  const selection = view.state.selection.main;
  const text = view.state.sliceDoc(selection.from, selection.to);
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: `${before}${text}${after}` },
    selection: EditorSelection.range(selection.from + before.length, selection.from + before.length + text.length),
    userEvent: 'input',
  });
  view.focus();
}

export function insertCommand(view: EditorView, id: string) {
  const command = commands.find((item) => item.id === id)!;
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const prefix = line.from !== selection.from ? '\n\n' : '';
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: prefix + command.text + '\n' },
    selection: { anchor: selection.from + prefix.length + command.cursor },
    userEvent: 'input',
    scrollIntoView: true,
  });
  view.focus();
}
