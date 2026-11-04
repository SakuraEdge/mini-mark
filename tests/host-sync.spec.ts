import { test, expect } from '@playwright/test';

test('a rejected snapshot resynchronizes once without echoing workspace messages', async ({ page }) => {
  await page.addInitScript(() => {
    let callback: (event: { data: unknown }) => void;
    let text = '# Windows note\r\n\r\nKeep this text.\r\n', rejectOnce = true, messages = 0;
    const tabs = [{ id: 'windows', name: 'Windows.md', dirty: false, revision: 0 }];
    localStorage.setItem('moye.updates.v1', JSON.stringify({ auto: false }));
    const publish = () => queueMicrotask(() => callback({ data: { type: 'workspace', tabs: [...tabs], document: { ...tabs[0], text, baseline: text } } }));
    Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
      addEventListener: (_: string, listener: typeof callback) => { callback = listener; },
      postMessage: (message: any) => {
        if (++messages > 40) throw new Error('Workspace feedback loop');
        if (message.type === 'ready') publish();
        if (message.type === 'new') {
          if (rejectOnce) { rejectOnce = false; text = text.replace(/\r\n/g, '\n'); publish(); return; }
          tabs.push({ id: 'new', name: 'New.md', dirty: false, revision: 0 }); publish();
        }
      },
    } } });
    Object.assign(window, { __messageCount: () => messages });
  });
  await page.goto('/');
  await expect(page.locator('#save-state')).toHaveText('草稿');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.locator('#app')).not.toHaveClass(/transition-pending/);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__messageCount())).toBeLessThan(10);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('Keep this text.');
});

test('external opening flushes newer text before leaving the active document', async ({ page }) => {
  await page.addInitScript(() => {
    let callback: (event: { data: unknown }) => void;
    const messages: any[] = [];
    const first = { id: 'first', name: 'First.md', text: '', baseline: '', revision: 0 };
    const second = { id: 'second', name: 'Second.md', text: 'External document', baseline: 'External document', revision: 0 };
    const emit = (document: typeof first) => callback({ data: { type: 'workspace', tabs: [first, second].map(doc => ({ id: doc.id, name: doc.name, dirty: false, revision: 0 })), document } });
    localStorage.setItem('moye.updates.v1', JSON.stringify({ auto: false }));
    Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
      addEventListener: (_: string, listener: typeof callback) => { callback = listener; },
      postMessage: (message: any) => { messages.push(message); if (message.type === 'ready') queueMicrotask(() => emit(first)); },
    } } });
    Object.assign(window, { __messages: messages, __openExternal: () => emit(second) });
  });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'First.md' })).toBeVisible();
  await page.clock.install();
  await page.getByRole('textbox', { name: 'Markdown 编辑器' }).fill('The final unsent input');
  expect(await page.evaluate(() => (window as any).__messages.filter((message: any) => message.type === 'edit'))).toHaveLength(0);
  await page.evaluate(() => (window as any).__openExternal());
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('External document');
  const edits = await page.evaluate(() => (window as any).__messages.filter((message: any) => message.type === 'edit'));
  expect(edits).toEqual([{ type: 'edit', documentId: 'first', revision: 1, text: 'The final unsent input' }]);
});

test('toolbar and shell buttons respond across editing and reading modes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown 编辑器' });
  await editor.fill('Button check');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await expect(editor).toHaveText('**Button check**');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).toHaveText('Button check');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(editor).toHaveText('**Button check**');
  for (const [name, value] of [['斜体', '*Button check*'], ['链接', '[Button check](https://)']]) {
    await editor.fill('Button check'); await page.keyboard.press('Control+a');
    await page.getByRole('button', { name, exact: true }).click();
    await expect(editor).toHaveText(value);
  }
  for (const [name, value] of [['代码块', '```cpp'], ['公式', '$$'], ['表格', '| 标题'], ['引用', '> ']]) {
    await editor.fill('');
    await page.getByRole('button', { name, exact: true }).click();
    await expect(editor).toContainText(value);
  }
  await page.getByRole('button', { name: '查找与替换', exact: true }).click();
  await expect(page.locator('.cm-search')).toBeVisible();
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await expect(page.locator('#app')).toHaveClass(/sidebar-hidden/);
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await page.getByRole('button', { name: '专注模式', exact: true }).click();
  await expect(page.locator('#app')).toHaveClass(/focus-mode/);
  await page.getByRole('button', { name: '专注模式', exact: true }).click();
  await page.getByRole('button', { name: '切换字号', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换字号', exact: true })).toHaveText('18 px');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(page.locator('#reading-view')).toBeVisible();
  await page.getByRole('button', { name: '查找与替换', exact: true }).click();
  await expect(editor).toBeVisible();
});
