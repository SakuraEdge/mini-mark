export interface SlashCommand {
  id: string;
  label: string;
  aliases: string[];
  hint: string;
  icon: string;
  text: string;
  cursor: number;
}

export const commands: SlashCommand[] = [
  { id: 'math', label: '公式', aliases: ['gongshi', 'math', 'gs'], hint: 'LaTeX 块级公式', icon: 'sigma', text: '$$\n\n$$', cursor: 3 },
  { id: 'inline-math', label: '行内公式', aliases: ['inline', 'hangneigongshi'], hint: '段落中的数学表达式', icon: 'variable', text: '$ $', cursor: 1 },
  { id: 'code', label: '代码', aliases: ['code', 'daima', 'dm'], hint: '带语法高亮的代码块', icon: 'code-2', text: '```cpp\n\n```', cursor: 7 },
  { id: 'table', label: '表格', aliases: ['table', 'biaoge', 'bg'], hint: '两列 Markdown 表格', icon: 'table-2', text: '| 标题 | 内容 |\n| --- | --- |\n|  |  |', cursor: 2 },
  { id: 'todo', label: '待办', aliases: ['todo', 'daiban'], hint: '任务清单', icon: 'square-check', text: '- [ ] ', cursor: 6 },
  { id: 'quote', label: '引用', aliases: ['quote', 'yinyong'], hint: '引用段落', icon: 'quote', text: '> ', cursor: 2 },
  { id: 'h1', label: '一级标题', aliases: ['h1', 'title'], hint: '章节标题', icon: 'heading-1', text: '# ', cursor: 2 },
  { id: 'h2', label: '二级标题', aliases: ['h2', 'subtitle'], hint: '小节标题', icon: 'heading-2', text: '## ', cursor: 3 },
  { id: 'rule', label: '分割线', aliases: ['hr', 'line', 'fengexian'], hint: '段落分隔', icon: 'minus', text: '---\n\n', cursor: 5 },
];

export function matchingCommands(query: string): SlashCommand[] {
  const key = query.toLowerCase();
  return commands.filter((command) => command.label.startsWith(key) || command.aliases.some((alias) => alias.startsWith(key)));
}

export function slashQuery(line: string, offset: number): { query: string; from: number; to: number } | null {
  if (offset !== line.length || !/^ {0,3}\/[a-zA-Z\u3400-\u9fff]*$/.test(line)) return null;
  const from = line.indexOf('/');
  const query = line.slice(from + 1);
  return matchingCommands(query).length ? { query, from, to: line.length } : null;
}

export function imeBlocksCommand(
  event: Pick<KeyboardEvent, 'isComposing' | 'keyCode' | 'key'>,
  composing: boolean,
  now: number,
  lastCompositionEnd: number,
): boolean {
  return composing || event.isComposing || event.keyCode === 229 || event.key === 'Process' || now - lastCompositionEnd < 80;
}
