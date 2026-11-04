import katexCss from 'katex/dist/katex.min.css?inline';
import { renderMarkdown } from './markdown';

let embeddedCss: Promise<string> | undefined;
async function embedMathFonts(): Promise<string> {
  const fonts = new Map<string, string>();
  const urls = [...katexCss.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1].replace(/^["']|["']$/g, ''));
  await Promise.all([...new Set(urls)].map(async (url) => {
    if (url.startsWith('data:')) return;
    const response = await fetch(url);
    if (!response.ok) throw new Error('无法读取公式字体，请重试导出。');
    const data = await response.blob();
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(data);
    });
    fonts.set(url, encoded);
  }));
  return katexCss.replace(/url\(([^)]+)\)/g, (match, raw: string) => {
    const url = raw.replace(/^["']|["']$/g, '');
    return fonts.has(url) ? `url("${fonts.get(url)}")` : match;
  });
}

export async function exportHtml(text: string, name: string): Promise<string> {
  embeddedCss ??= embedMathFonts().catch((error) => { embeddedCss = undefined; throw error; });
  const css = await embeddedCss;
  const title = name.replace(/[<>&"]/g, '');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
${css}
body{max-width:820px;margin:48px auto;padding:0 24px;font:17px/1.8 system-ui,sans-serif;color:#252b28;background:white;overflow-wrap:anywhere}h1{font-size:30px}h2{font-size:23px;margin-top:28px}pre{background:#f2f4f3;padding:20px;border-radius:5px;overflow:auto}code{font-family:Consolas,monospace}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d6ddd9;padding:8px 12px}th{text-align:left;background:#f2f4f3}blockquote{border-left:3px solid #8aa899;margin-left:0;padding-left:20px;color:#65736c}img{max-width:100%;height:auto}a{color:#22745b}.hljs-keyword{color:#94518a}.hljs-string{color:#2f7652}.hljs-number{color:#b35e35}.hljs-title{color:#3d69b0}.hljs-comment{color:#7a877f}eqn{display:block;overflow:auto}.task-list-item{list-style:none}@media print{body{margin:0;max-width:none}pre,blockquote,table{break-inside:avoid}}
</style></head><body>${renderMarkdown(text, false)}</body></html>`;
}
