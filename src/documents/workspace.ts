export interface DocumentData {
  id: string; text: string; name: string; path?: string; baseline: string; revision: number;
}
export interface TabData { id: string; name: string; path?: string; dirty: boolean; revision: number }
export interface BrowserSession { schemaVersion: 2; documents: DocumentData[]; activeId: string; nextUntitled: number }

export function normalizeText(text: string) { return text.replace(/\r\n?/g, '\n'); }

export class BrowserWorkspace {
  documents: DocumentData[] = [];
  activeId = '';
  nextUntitled = 1;
  get active() { return this.documents.find(document => document.id === this.activeId)!; }
  get tabs(): TabData[] { return this.documents.map(document => ({ id: document.id, name: document.name, path: document.path, dirty: document.text !== document.baseline, revision: document.revision })); }
  add(text = '', name?: string, baseline = '') {
    const document: DocumentData = { id: crypto.randomUUID(), text: normalizeText(text), name: name ?? this.nextUntitledName(), baseline: normalizeText(baseline), revision: 0 };
    this.documents.push(document); this.activeId = document.id; return document;
  }
  private nextUntitledName() {
    let number = 1;
    while (this.documents.some(document => document.name.toLowerCase() === `未命名 ${number}.md`)) number++;
    this.nextUntitled = number + 1;
    return `未命名 ${number}.md`;
  }
  update(id: string, text: string, revision: number) {
    text = normalizeText(text);
    const document = this.documents.find(item => item.id === id);
    if (!document || revision < document.revision || (revision === document.revision && text !== document.text)) return false;
    document.text = text; document.revision = revision; return true;
  }
  activate(id: string) { if (this.documents.some(document => document.id === id)) this.activeId = id; }
  remove(id: string) {
    const index = this.documents.findIndex(document => document.id === id);
    if (index < 0) return;
    this.documents.splice(index, 1);
    if (!this.documents.length) this.add();
    else if (this.activeId === id) this.activeId = this.documents[Math.min(index, this.documents.length - 1)].id;
  }
  serialize() { return JSON.stringify({ schemaVersion: 2, documents: this.documents, activeId: this.activeId, nextUntitled: this.nextUntitled } satisfies BrowserSession); }
  static restore(value: string | null): BrowserWorkspace | null {
    if (!value) return null;
    try {
      const session = JSON.parse(value) as BrowserSession;
      if (session.schemaVersion !== 2 || !Array.isArray(session.documents) || !session.documents.length || session.documents.some(document => !document.id || typeof document.text !== 'string' || typeof document.baseline !== 'string' || !Number.isSafeInteger(document.revision))) return null;
      if (new Set(session.documents.map(document => document.id)).size !== session.documents.length) return null;
      const workspace = new BrowserWorkspace();
      workspace.documents = session.documents.map(document => ({ ...document, text: normalizeText(document.text), baseline: normalizeText(document.baseline) }));
      workspace.activeId = session.documents.some(document => document.id === session.activeId) ? session.activeId : session.documents[0].id;
      // Untitled numbering is a per-launch convenience, not durable document state.
      workspace.nextUntitled = 1;
      return workspace;
    } catch { return null; }
  }
}
