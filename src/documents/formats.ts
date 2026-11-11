export type DocumentLanguage = 'markdown' | 'yaml' | 'html';

export function documentLanguage(name: string): DocumentLanguage {
  return /\.(?:html|htm)$/i.test(name) ? 'html' : /\.(?:yaml|yml)$/i.test(name) ? 'yaml' : 'markdown';
}

export function formatLabel(name: string) {
  return { markdown: 'Markdown', yaml: 'YAML', html: 'HTML' }[documentLanguage(name)];
}
export function isYamlDocument(name: string) {
  return documentLanguage(name) === 'yaml';
}
