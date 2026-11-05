import { describe, expect, it } from 'vitest';
import { parseManifest, parseResult } from './model';

describe('user plugin boundary', () => {
  const command = { id: 'insert-date', title: '日期' };
  it('keeps only validated manifest fields and rejects duplicate commands', () => {
    expect(parseManifest({ id: 'test', name: '测试', version: '1', commands: [command], secret: 'ignored' })).toEqual({ id: 'test', name: '测试', version: '1', commands: [command] });
    expect(() => parseManifest({ id: 'test', name: '测试', version: '1', commands: [command, command] })).toThrow();
    expect(() => parseManifest({ id: '../escape', name: '测试', version: '1', commands: [command] })).toThrow();
  });
  it('rejects ambiguous edits, unsupported effects and oversized output', () => {
    expect(() => parseResult({ replaceSelection: '', replaceDocument: '' })).toThrow();
    expect(() => parseResult({ openExternal: 'https://example.com' })).toThrow();
    expect(() => parseResult({ replaceDocument: 'x'.repeat(2_000_001) })).toThrow();
    expect(() => parseResult({ state: 'x'.repeat(65537) })).toThrow();
  });
  it('copies JSON state and keeps result panels as plain strings', () => {
    const state = { count: 1 };
    const result = parseResult({ panel: { title: '<img>', text: '<script>' }, state, replaceSelection: '' });
    state.count = 2;
    expect(result.state).toEqual({ count: 1 });
    expect(result.panel?.text).toBe('<script>');
    expect(result.replaceSelection).toBe('');
  });
  it('rejects cyclic state without accepting partial edits', () => {
    const state: Record<string, unknown> = {};
    state.self = state;
    expect(() => parseResult({ replaceDocument: 'lost text', state })).toThrow();
  });
});
