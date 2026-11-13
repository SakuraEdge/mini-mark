import { test, expect, type Page } from '@playwright/test';

const editor = (page: Page) => page.getByRole('textbox', { name: 'Markdown 编辑器' });
async function renameFromTab(page: Page, name: string, next: string) {
  await page.getByRole('tab', { name, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByRole('dialog', { name: '重命名文档' }).getByLabel('新文件名', { exact: true }).fill(next);
  await page.getByRole('dialog', { name: '重命名文档' }).getByRole('button', { name: '重命名', exact: true }).click();
}

test('new draft title follows only first-line H1 immediately and freezes after manual rename', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.clock.install();
  await editor(page).fill('# 第一行标题\n正文');
  await expect(page.getByRole('tab', { name: '第一行标题.md', exact: true })).toBeVisible();
  await expect(page.locator('#sidebar-filename')).toHaveText('第一行标题.md');
  await expect(page.locator('#save-state')).toHaveText('未保存');
  await editor(page).fill('## 不是一级标题\n# 后面的标题');
  await expect(page.getByRole('tab', { name: '第一行标题.md', exact: true })).toBeVisible();
  await editor(page).fill('# 另一个 / 名称 ###\n正文');
  await expect(page.getByRole('tab', { name: '另一个 名称.md', exact: true })).toBeVisible();
  await renameFromTab(page, '另一个 名称.md', '固定名称');
  await expect(page.getByRole('tab', { name: '固定名称.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await editor(page).fill('# 后续标题\n正文');
  await expect(page.getByRole('tab', { name: '固定名称.md', exact: true })).toBeVisible();
  await expect(page.locator('.cm-line')).toHaveText(['# 后续标题', '正文']);
});

test('sidebar keyboard rename preserves dirty content, selection and undo history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await editor(page).fill('alpha beta');
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+ArrowLeft');
  await page.keyboard.press('Shift+End');
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  await page.locator('#current-file').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: '文档操作' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '重命名文档' })).toBeVisible();
  await page.getByLabel('新文件名', { exact: true }).fill('Rename');
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await expect(editor(page)).toHaveText('alpha beta');
  await expect(page.locator('#save-state')).toHaveText('未保存');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.cm-placeholder')).toBeVisible();
  await expect(page.locator('#word-count')).toHaveText('0 字');
  await expect(page.getByRole('tab', { name: 'Rename.md', exact: true })).toBeVisible();
});

test('browser-loaded unnamed file is never auto-renamed and manual collisions do not overwrite another tab', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await (await chooser).setFiles({ name: '未命名 7.md', mimeType: 'text/markdown', buffer: Buffer.from('# Loaded title') });
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await editor(page).fill('# New loaded title');
  await expect(page.getByRole('tab', { name: '未命名 7.md', exact: true })).toBeVisible();
  await renameFromTab(page, '未命名 7.md', '../escape.md');
  await expect(page.locator('#text-dialog-status')).toContainText('有效文件名');
  await expect(page.getByRole('tab', { name: '未命名 7.md', exact: true })).toBeVisible();
  await page.getByLabel('新文件名', { exact: true }).fill('随手记.md');
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await expect(page.locator('#text-dialog-status')).toContainText('已有同名文档');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(editor(page)).toHaveText('# New loaded title');
});

test('a quickly removed first H1 keeps its last automatic name across tab changes and save', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.clock.install();
  await editor(page).fill('# 短暂标题');
  await editor(page).fill('普通正文');
  await expect(page.getByRole('tab', { name: '短暂标题.md', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '随手记.md', exact: true }).click();
  await page.getByRole('tab', { name: '短暂标题.md', exact: true }).click();
  await expect(editor(page)).toHaveText('普通正文');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  expect((await download).suggestedFilename()).toBe('短暂标题.md');
  await expect(page.getByRole('tab', { name: '短暂标题.md', exact: true })).toBeVisible();
});

test('renaming a nonactive native tab carries the active latest snapshot without switching or saving it', async ({ page }) => {
  await page.addInitScript(() => {
    let callback: (event: { data: unknown }) => void;
    const messages: any[] = [];
    const first = { id: 'active', name: 'Current.md', path: 'D:/notes/Current.md', text: 'Original', baseline: 'Original', revision: 1, autoName: false };
    const second = { id: 'other', name: 'Other.yaml', path: 'D:/notes/Other.yaml', text: 'other: true', baseline: 'other: true', revision: 0, autoName: false };
    const docs = [first, second];
    const emit = (data: unknown) => queueMicrotask(() => callback({ data }));
    const publish = () => emit({ type: 'workspace', tabs: docs.map(doc => ({ ...doc, dirty: doc.text !== doc.baseline })), document: { ...first } });
    localStorage.setItem('moye.updates.rev.v1', JSON.stringify({ auto: false }));
    Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
      addEventListener: (_: string, listener: typeof callback) => { callback = listener; },
      postMessage: (message: any) => {
        messages.push(message);
        if (message.type === 'ready') publish();
        if (message.type === 'renameDocument') {
          first.text = message.text; first.revision = message.revision;
          const target = docs.find(doc => doc.id === message.targetId)!;
          target.name = message.name; target.path = `D:/notes/${message.name}`; publish(); emit({ type: 'operationComplete' });
        }
        if (message.type === 'save') {
          first.text = message.text; first.revision = message.revision; first.baseline = first.text;
          emit({ type: 'saved', documentId: first.id, name: first.name, path: first.path, text: first.text, autoName: false }); emit({ type: 'operationComplete' });
        }
      },
    } } });
    Object.assign(window, { __renameMessages: messages });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.clock.install();
  await editor(page).fill('Latest active edits');
  await renameFromTab(page, 'Other.yaml', 'Renamed');
  await expect(page.getByRole('tab', { name: 'Current.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Renamed.yaml', exact: true })).toBeVisible();
  await expect(editor(page)).toHaveText('Latest active edits');
  const renameMessages = await page.evaluate(() => (window as any).__renameMessages);
  expect(renameMessages.filter((message: any) => message.type === 'renameDocument')).toEqual([{
    type: 'renameDocument', targetId: 'other', name: 'Renamed.yaml', documentId: 'active', text: 'Latest active edits', revision: 2,
  }]);
  expect(renameMessages.some((message: any) => ['activate', 'save', 'saveAs'].includes(message.type))).toBe(false);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('已保存');
  await expect(page.getByRole('tab', { name: 'Current.md', exact: true })).toHaveAttribute('aria-description', 'D:/notes/Current.md');
});

test('rename menu and input dialog fit desktop and narrow windows', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const width of [1180, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('tab', { name: '随手记.md', exact: true }).click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '文档操作' });
    await expect(menu).toBeVisible();
    const menuBounds = await menu.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    expect(menuBounds.width).toBeLessThan(240);
    expect(menuBounds.left).toBeGreaterThanOrEqual(0);
    expect(menuBounds.right).toBeLessThanOrEqual(width);
    expect(menuBounds.top).toBeGreaterThanOrEqual(0);
    expect(menuBounds.bottom).toBeLessThanOrEqual(844);
    await page.screenshot({ path: testInfo.outputPath(`document-context-${width}.png`) });
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '重命名文档' });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth, right: element.getBoundingClientRect().right }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    expect(bounds.right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`document-rename-${width}.png`) });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
});
