import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { EDIT_FORMULA_EVENT, mathBlockAt } from '../../editor/math-blocks';

interface Snapshot { documentId: string; revision: number; editable: boolean }
interface Options { view: EditorView; snapshot(): Snapshot; notice(message: string): void }

export function initializeFormulas({ view, snapshot, notice }: Options) {
  let opening = false;
  async function open(position = view.state.selection.main.head) {
    const context = snapshot();
    if (!context.editable || view.composing || opening) return;
    const block = mathBlockAt(view.state, position);
    const selection = view.state.selection.main;
    const from = block?.from ?? selection.from, to = block?.to ?? selection.to;
    const original = view.state.sliceDoc(from, to);
    opening = true;
    try {
      const { openFormulaDialog } = await import('./dialog');
      const current = snapshot();
      if (!current.editable || current.documentId !== context.documentId || current.revision !== context.revision) throw new Error('文档已修改，请重新打开公式编辑器。');
      openFormulaDialog({
        latex: block?.latex ?? '',
        save(latex) {
          const current = snapshot();
          if (!current.editable || current.documentId !== context.documentId || current.revision !== context.revision || view.composing || view.state.sliceDoc(from, to) !== original) {
            throw new Error('文档已修改或切换，公式未写入。可先复制公式，再重新打开。');
          }
          const prefix = from > 0 && view.state.sliceDoc(from - 1, from) !== '\n' ? '\n\n' : '';
          const suffix = view.state.sliceDoc(to, to + 1) === '\n' ? '' : '\n';
          const insert = `${prefix}$$\n${latex.trim()}\n$$${suffix}`;
          view.dispatch({
            changes: { from, to, insert }, selection: { anchor: from + insert.length + (suffix ? 0 : 1) },
            annotations: isolateHistory.of('full'), userEvent: 'input', scrollIntoView: true,
          });
        },
        close: () => view.focus(),
      });
    } catch (error) { notice(error instanceof Error ? error.message : '无法打开公式编辑器。'); }
    finally { opening = false; }
  }
  view.dom.addEventListener(EDIT_FORMULA_EVENT, event => { void open((event as CustomEvent<number>).detail); });
  return { open: () => void open() };
}
