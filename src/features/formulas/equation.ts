import katex from 'katex';
import { mml2omml } from 'mathml2omml-plus';
import type { EquationData } from './clipboard';

export const MAX_FORMULA_LENGTH = 12000;
export function validateFormula(latex: string) {
  if (!latex.trim()) throw new Error('请先输入公式。');
  if (latex.length > MAX_FORMULA_LENGTH) throw new Error('公式过长，请拆分为多个公式。');
  if (/\\placeholder\b/.test(latex)) throw new Error('请先填写公式中的空位。');
  return katex.renderToString(latex, { output: 'mathml', displayMode: true, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 50 });
}

export function equationData(latex: string): EquationData {
  const container = new DOMParser().parseFromString(validateFormula(latex), 'text/html');
  const math = container.querySelector('math')!;
  math.querySelectorAll('annotation').forEach(element => element.remove());
  const mathml = new XMLSerializer().serializeToString(math);
  const omml = mml2omml(mathml);
  const parsed = new DOMParser().parseFromString(omml, 'application/xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'oMath' || !parsed.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 't').length) {
    throw new Error('此公式暂时无法转换为 Office 公式。');
  }
  const html = `<html xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"><head><meta charset="utf-8"></head><body><!--StartFragment--><p>${omml.replaceAll('http://schemas.openxmlformats.org/officeDocument/2006/math', 'http://schemas.microsoft.com/office/2004/12/omml')}</p><!--EndFragment--></body></html>`;
  return { mathml, omml, html };
}
