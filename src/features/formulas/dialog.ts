import { MathfieldElement } from 'mathlive';
import { createIcons, X, Copy, Check, Undo2, Redo2, ArrowLeft, ArrowRight, Delete } from 'lucide';
import { renderMath } from '../../markdown/render';
import { copyEquation } from './clipboard';
import { equationData, validateFormula, MAX_FORMULA_LENGTH } from './equation';

MathfieldElement.fontsDirectory = new URL('vendor/mathlive/fonts', document.baseURI).href;
MathfieldElement.soundsDirectory = null;
MathfieldElement.locale = 'zh-CN';
MathfieldElement.computeEngine = null;

interface Options { latex: string; save(latex: string): void; close(): void }
const templates = [
  { label: '分数', preview: '\\frac{a}{b}', insert: '\\frac{#@}{#?}' },
  { label: '平方根', preview: '\\sqrt{x}', insert: '\\sqrt{#@}' },
  { label: 'n 次根', preview: '\\sqrt[n]{x}', insert: '\\sqrt[#?]{#@}' },
  { label: '上标', preview: 'x^{n}', insert: '#@^{#?}' },
  { label: '下标', preview: 'x_{n}', insert: '#@_{#?}' },
  { label: '求和', preview: '\\sum_{i=1}^{n}', insert: '\\sum_{#?}^{#?}#?' },
  { label: '积分', preview: '\\int_a^b', insert: '\\int_{#?}^{#?}#?' },
  { label: '极限', preview: '\\lim_{x\\to 0}', insert: '\\lim_{#?\\to #?}#?' },
  { label: '括号', preview: '\\left(x\\right)', insert: '\\left(#@\\right)' },
  { label: '绝对值', preview: '\\left|x\\right|', insert: '\\left|#@\\right|' },
  { label: '矩阵', preview: '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', insert: '\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}' },
  { label: '分段函数', preview: '\\begin{cases}a&x>0\\\\b&x\\leq0\\end{cases}', insert: '\\begin{cases}#?&#?\\\\#?&#?\\end{cases}' },
];
const symbols = ['+', '-', '=', '\\times', '\\div', '\\pm', '\\neq', '\\le', '\\ge', '\\infty', '\\pi', '\\theta', '\\alpha', '\\beta', '\\Delta', '\\in', '\\to', '\\sin', '\\cos', '\\log'];
let dialog: HTMLDialogElement | undefined;

export function openFormulaDialog(options: Options) {
  if (dialog?.open) return;
  dialog?.remove();
  const root = document.createElement('dialog');
  dialog = root;
  root.id = 'formula-dialog'; root.className = 'feature-dialog formula-dialog';
  root.setAttribute('aria-labelledby', 'formula-title');
  root.innerHTML = `<header><h2 id="formula-title">公式编辑器</h2><button class="icon-button" data-action="close" aria-label="关闭公式编辑器" title="关闭"><i data-lucide="x"></i></button></header>
    <div class="formula-templates" role="group" aria-label="公式结构"></div>
    <div class="formula-symbols" role="group" aria-label="数学符号"></div>
    <div class="formula-field-label"><label id="formula-field-label">公式</label><div class="formula-edit-tools"></div></div>
    <div class="formula-field-container"></div>
    <details class="formula-source"><summary>LaTeX 源码</summary><textarea id="formula-latex" aria-label="公式 LaTeX 源码" spellcheck="false" maxlength="${MAX_FORMULA_LENGTH}"></textarea></details>
    <div class="formula-preview" aria-label="公式预览"></div>
    <p id="formula-status" role="status"></p>
    <footer><button data-action="copy"><i data-lucide="copy"></i><span>复制到 Word / WPS</span></button><button class="primary" data-action="save"><i data-lucide="check"></i><span>写入 Markdown</span></button></footer>`;
  document.body.append(root);
  const field = new MathfieldElement();
  field.setAttribute('aria-labelledby', 'formula-field-label');
  field.mathVirtualKeyboardPolicy = 'manual';
  field.smartFence = true;
  field.value = options.latex;
  root.querySelector('.formula-field-container')!.append(field);
  field.menuItems = [];
  const source = root.querySelector<HTMLTextAreaElement>('#formula-latex')!;
  const status = root.querySelector<HTMLElement>('#formula-status')!;
  const preview = root.querySelector<HTMLElement>('.formula-preview')!;
  const save = root.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const copy = root.querySelector<HTMLButtonElement>('[data-action="copy"]')!;
  let sourceChanged = false, copying = false;
  const latex = () => sourceChanged ? source.value : field.value;
  function refresh() {
    const value = latex();
    if (!sourceChanged) source.value = value;
    status.textContent = '';
    save.disabled = !value.trim() || value.length > MAX_FORMULA_LENGTH;
    copy.disabled = save.disabled || copying;
    preview.innerHTML = value.length <= MAX_FORMULA_LENGTH && value.trim() ? renderMath(value) : '';
  }
  field.addEventListener('input', () => { sourceChanged = false; refresh(); });
  source.addEventListener('input', () => { sourceChanged = true; field.value = source.value; refresh(); });
  function insert(value: string) {
    field.focus(); field.insert(value, { selectionMode: 'placeholder' });
    sourceChanged = false; refresh();
  }
  for (const template of templates) {
    const button = document.createElement('button');
    button.type = 'button'; button.title = template.label; button.setAttribute('aria-label', template.label);
    button.innerHTML = renderMath(template.preview, false);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => insert(template.insert));
    root.querySelector('.formula-templates')!.append(button);
  }
  for (const symbol of symbols) {
    const button = document.createElement('button');
    button.type = 'button'; button.title = symbol; button.setAttribute('aria-label', `插入 ${symbol}`);
    button.innerHTML = renderMath(symbol, false);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => insert(`${symbol} `));
    root.querySelector('.formula-symbols')!.append(button);
  }
  const tools = [
    ['undo', 'undo-2', '撤销'], ['redo', 'redo-2', '重做'],
    ['moveToPreviousChar', 'arrow-left', '向左'], ['moveToNextChar', 'arrow-right', '向右'], ['deleteBackward', 'delete', '删除'],
  ] as const;
  for (const [command, glyph, label] of tools) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'icon-button'; button.title = label; button.setAttribute('aria-label', label);
    button.innerHTML = `<i data-lucide="${glyph}"></i>`;
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => { field.focus(); field.executeCommand(command); sourceChanged = false; refresh(); });
    root.querySelector('.formula-edit-tools')!.append(button);
  }
  createIcons({ icons: { X, Copy, Check, Undo2, Redo2, ArrowLeft, ArrowRight, Delete }, root });
  root.querySelector('[data-action="close"]')!.addEventListener('click', () => root.close());
  root.addEventListener('close', () => { root.remove(); options.close(); });
  save.addEventListener('click', () => {
    try {
      validateFormula(latex());
      options.save(latex()); root.close();
    } catch (error) { status.textContent = error instanceof Error ? error.message : '公式无法保存。'; }
  });
  copy.addEventListener('click', async () => {
    if (copying) return;
    copying = true; copy.disabled = true;
    try {
      await copyEquation(equationData(latex()));
      status.textContent = '已复制可编辑公式';
    } catch (error) { status.textContent = error instanceof Error ? error.message : '复制失败，请重试。'; }
    finally { copying = false; copy.disabled = !latex().trim(); }
  });
  refresh(); root.showModal(); field.focus();
}
