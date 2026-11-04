import { describe, expect, it } from 'vitest';
import { commands, imeBlocksCommand, matchingCommands, slashQuery } from './commands';

describe('Chinese slash commands', () => {
  it('matches Chinese, pinyin and English prefixes', () => {
    expect(matchingCommands('公')[0].id).toBe('math');
    expect(matchingCommands('gong')[0].id).toBe('math');
    expect(matchingCommands('math')[0].id).toBe('math');
    expect(slashQuery('  /公式', 5)).toEqual({ query: '公式', from: 2, to: 5 });
  });
  it.each(['https://example.com/公式', '/usr/bin', '普通文本/公式', '/公式abc', '/公式/路径', '    /公式'])('does not trigger for %s', (line) => {
    expect(slashQuery(line, line.length)).toBeNull();
  });
  it('requires cursor at end', () => expect(slashQuery('/公式', 1)).toBeNull());
  it('inserts a block formula with caret on the blank line', () => {
    const command = commands.find((item) => item.id === 'math')!;
    expect(command.text).toBe('$$\n\n$$');
    expect(command.text.slice(0, command.cursor)).toBe('$$\n');
  });
  it('protects IME composition and the trailing confirm key', () => {
    expect(imeBlocksCommand({ key: 'Enter', keyCode: 229, isComposing: false }, false, 100, -Infinity)).toBe(true);
    expect(imeBlocksCommand({ key: 'Enter', keyCode: 13, isComposing: true }, false, 100, -Infinity)).toBe(true);
    expect(imeBlocksCommand({ key: 'Enter', keyCode: 13, isComposing: false }, false, 120, 100)).toBe(true);
    expect(imeBlocksCommand({ key: 'Enter', keyCode: 13, isComposing: false }, false, 200, 100)).toBe(false);
  });
});
