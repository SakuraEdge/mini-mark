miniMark.register({
  id: 'writing-tools',
  name: '写作工具',
  version: '1.0.0',
  commands: [
    {
      id: 'insert-date',
      title: '插入当前日期',
      run() {
        const now = new Date();
        const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        return { replaceSelection: date };
      },
    },
    {
      id: 'quote-selection',
      title: '将选中文字转为引用',
      run(context) {
        if (!context.selectedText) return { message: '请先选中一段文字。' };
        return { replaceSelection: context.selectedText.split('\n').map(line => '> ' + line).join('\n') };
      },
    },
    {
      id: 'word-count',
      title: '统计当前文档',
      run(context) {
        return { panel: { title: context.name, text: '字符数：' + context.text.length + '\n行数：' + context.text.split('\n').length } };
      },
    },
  ],
});
