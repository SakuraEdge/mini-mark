export type DocumentLanguage = 'markdown' | 'yaml';

export function documentLanguage(name: string): DocumentLanguage {
  return /\.(?:yaml|yml)$/i.test(name) ? 'yaml' : 'markdown';
}

export function isYamlDocument(name: string) {
  return documentLanguage(name) === 'yaml';
}
