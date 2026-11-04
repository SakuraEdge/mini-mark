import { describe, expect, it } from 'vitest';
import { BrowserWorkspace } from './workspace';

describe('document workspace', () => {
  it('normalizes CRLF samples and legacy sessions without inventing edits', () => {
    const workspace = new BrowserWorkspace();
    const doc = workspace.add('# Title\r\nText\r', 'Windows.md', '# Title\nText\n');
    expect(workspace.tabs[0].dirty).toBe(false);
    expect(workspace.update(doc.id, '# Title\nText\n', 0)).toBe(true);
    const legacy = JSON.parse(workspace.serialize());
    legacy.documents[0].text = legacy.documents[0].baseline = '# Title\r\nText\r\n';
    const restored = BrowserWorkspace.restore(JSON.stringify(legacy))!;
    expect(restored.active.text).toBe('# Title\nText\n');
    expect(restored.tabs[0].dirty).toBe(false);
  });
  it('retains dirty text and unique names when adding a tab', () => {
    const workspace = new BrowserWorkspace();
    const a = workspace.add('未保存内容');
    const b = workspace.add();
    expect(workspace.documents).toHaveLength(2);
    expect(a.text).toBe('未保存内容');
    expect(a.name).not.toBe(b.name);
    workspace.activate(a.id);
    expect(workspace.active).toBe(a);
  });
  it('ignores stale and cross-tab revisions', () => {
    const workspace = new BrowserWorkspace();
    const a = workspace.add();
    const b = workspace.add();
    expect(workspace.update(a.id, '最新', 2)).toBe(true);
    expect(workspace.update(a.id, '过期', 1)).toBe(false);
    expect(workspace.update(a.id, '同版本冲突', 2)).toBe(false);
    expect(a.text).toBe('最新');
    expect(b.text).toBe('');
  });
  it('round trips ordered tabs, baselines and active selection', () => {
    const workspace = new BrowserWorkspace();
    const a = workspace.add('已保存', '中文.md', '已保存');
    const b = workspace.add('草稿');
    workspace.activate(a.id);
    const restored = BrowserWorkspace.restore(workspace.serialize())!;
    expect(restored.documents).toEqual([a, b]);
    expect(restored.activeId).toBe(a.id);
    expect(restored.tabs.map(tab => tab.dirty)).toEqual([false, true]);
  });
  it('closes only the requested tab and selects a neighbor', () => {
    const workspace = new BrowserWorkspace();
    const a = workspace.add('A');
    const b = workspace.add('B');
    const c = workspace.add('C');
    workspace.remove(b.id);
    expect(workspace.activeId).toBe(c.id);
    workspace.remove(c.id);
    expect(workspace.activeId).toBe(a.id);
    workspace.remove(a.id);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.active.text).toBe('');
  });
  it('does not accept duplicate identities or invalid sessions', () => {
    const workspace = new BrowserWorkspace();
    workspace.add('test');
    workspace.documents.push(workspace.active);
    expect(BrowserWorkspace.restore(workspace.serialize())).toBeNull();
    expect(BrowserWorkspace.restore('{broken')).toBeNull();
  });
});
