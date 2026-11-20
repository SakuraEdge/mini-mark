import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

function blockAt(state: EditorState, from: number, to: number) {
  const tree = ensureSyntaxTree(state, to, 40) ?? syntaxTree(state);
  // Use the outer Markdown tree even when a fenced language has its own parser.
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolve(from, side); node; node = node.parent) {
      if (node.to < to) continue;
      if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'Table') return node;
    }
  }
  return null;
}

function contentRange(state: EditorState, node: SyntaxNode) {
  if (node.name !== 'FencedCode') return { from: node.from, to: node.to };
  const opening = state.doc.lineAt(node.from);
  const lastMark = node.getChildren('CodeMark').at(-1);
  const closed = lastMark && lastMark.from > opening.to;
  const from = Math.min(opening.to + 1, node.to);
  const to = closed ? state.doc.lineAt(lastMark.from).from - 1 : node.to;
  return { from, to: Math.max(from, to) };
}

const selectedBlock = StateEffect.define<number>();
const lastBlock = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(selectedBlock)) return effect.value;
    return transaction.docChanged || transaction.selection ? null : value;
  },
});

function selectBlock(view: EditorView) {
  const { state } = view;
  const selection = state.selection.main;
  if (state.selection.ranges.length !== 1 || (selection.from === 0 && selection.to === state.doc.length)) return false;
  const block = blockAt(state, selection.from, selection.to);
  if (!block || state.field(lastBlock) === block.from) return false;
  const { from, to } = contentRange(state, block);
  view.dispatch({ selection: { anchor: from, head: to }, effects: selectedBlock.of(block.from), userEvent: 'select' });
  return true;
}

export const blockSelection = [lastBlock, keymap.of([{ key: 'Mod-a', run: selectBlock }])];
