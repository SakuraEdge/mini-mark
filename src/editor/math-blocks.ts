import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

export interface MathBlock { from: number; to: number; contentFrom: number; contentTo: number; latex: string }

export function mathBlocks(state: EditorState): MathBlock[] {
  const blocks: MathBlock[] = [];
  const text = state.doc.toString();
  const pattern = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*$|^ {0,3}\$\$([^\n]*?)\$\$[ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    let node = syntaxTree(state).resolveInner(match.index + 1, 1);
    let code = false;
    for (;;) {
      if (/^(FencedCode|CodeBlock|InlineCode)$/.test(node.name)) { code = true; break; }
      if (!node.parent) break;
      node = node.parent;
    }
    if (code) continue;
    const latex = match[1] ?? match[2];
    const contentFrom = match.index + (match[1] !== undefined ? match[0].indexOf('\n') + 1 : match[0].indexOf('$$') + 2);
    blocks.push({ from: match.index, to: match.index + match[0].length, contentFrom, contentTo: contentFrom + latex.length, latex });
  }
  return blocks;
}

export function mathBlockAt(state: EditorState, position: number) {
  return mathBlocks(state).find(block => position >= block.from && position <= block.to);
}

export const EDIT_FORMULA_EVENT = 'mini-mark-edit-formula';
