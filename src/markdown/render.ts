import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import taskLists from 'markdown-it-task-lists';
import katex from 'katex';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import 'katex/dist/katex.min.css';

for (const [name, language] of Object.entries({ cpp, javascript, python, json, bash, css, xml, yaml })) hljs.registerLanguage(name, language);
hljs.registerAliases(['c', 'c++'], { languageName: 'cpp' });
hljs.registerAliases(['js', 'ts', 'typescript'], { languageName: 'javascript' });
hljs.registerAliases(['html'], { languageName: 'xml' });

export const md: InstanceType<typeof MarkdownIt> = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  highlight: (source, language): string => language && hljs.getLanguage(language)
    ? hljs.highlight(source, { language, ignoreIllegals: true }).value
    : md.utils.escapeHtml(source),
}).use(texmath, { engine: katex, delimiters: 'dollars', katexOptions: { throwOnError: false, trust: false, strict: 'ignore' } })
  .use(taskLists, { enabled: false, label: true });

export function renderMarkdown(text: string, resolveLocalImages = true): string {
  const html = DOMPurify.sanitize(md.render(text), { ADD_TAGS: ['eq', 'eqn'], ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'iframe', 'object', 'embed'] });
  if (!resolveLocalImages || !window.chrome?.webview) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? '';
    if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('//')) image.src = new URL(src, location.protocol === 'moye:' ? 'moye://document/' : 'https://document.moye.local/').href;
  }
  return template.innerHTML;
}

export function renderMath(text: string, displayMode = true): string {
  return katex.renderToString(text, { displayMode, throwOnError: false, trust: false, strict: 'ignore', output: 'html' });
}

export function renderYaml(text: string): string {
  const highlighted = hljs.highlight(text, { language: 'yaml', ignoreIllegals: true }).value;
  return DOMPurify.sanitize(`<pre class="yaml-preview"><code class="hljs language-yaml">${highlighted}</code></pre>`, {
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed'],
  });
}

export interface Heading { level: number; text: string; from: number }
export function headings(text: string): Heading[] {
  const lines = text.split('\n');
  const offsets: number[] = [];
  let position = 0;
  for (const line of lines) { offsets.push(position); position += line.length + 1; }
  const tokens = md.parse(text, {});
  const result: Heading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open' && token.map) {
      result.push({ level: Number(token.tag.slice(1)), text: tokens[i + 1]?.content ?? '', from: offsets[token.map[0]] });
    }
  }
  return result;
}

export function wordCount(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const words = text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + words;
}
