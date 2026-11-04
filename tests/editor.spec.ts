import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function replace(page: Page, value: string) {
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown 编辑器' });
  await editor.click(); await page.keyboard.press('Control+a');
  await page.keyboard.insertText(value);
  return editor;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-editor')).toBeVisible();
});

test('renders math, readable code, headings, and theme', async ({ page }) => {
  await expect(page.locator('.math-block .katex')).toBeVisible();
  await expect(page.locator('.code-line').first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: '文档大纲' }).getByRole('button')).toHaveCount(4);
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(page.locator('#reading-view .katex')).toBeVisible();
  await expect(page.locator('#reading-view .hljs-keyword').first()).toBeVisible();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('/公式 inserts dollars and positions caret in formula', async ({ page }) => {
  const editor = await replace(page, '/公式');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Enter'); await page.keyboard.insertText('x^2');
  await expect(editor).toHaveText('$$x^2$$');
  const lines = await editor.locator('.cm-line').allTextContents();
  expect(lines).toEqual(['$$', 'x^2', '$$']);
});

test('IME confirmation does not execute slash command', async ({ page }) => {
  const editor = await replace(page, '/公式');
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '公式' }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
  });
  await expect(editor).toContainText('/公式');
  await page.waitForTimeout(160);
  await page.keyboard.press('Enter');
  await expect(editor).not.toContainText('/公式');
  expect(await editor.locator('.cm-line').allTextContents()).toEqual(['$$', '', '$$']);
});

test('Escape, navigation, and mouse selection', async ({ page }) => {
  const editor = await replace(page, '/');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toContainText('行内公式');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.keyboard.insertText('公式');
  await page.getByRole('option').filter({ hasText: 'LaTeX' }).click();
  expect(await editor.locator('.cm-line').allTextContents()).toEqual(['$$', '', '$$']);
});

test('does not offer commands inside code or URLs', async ({ page }) => {
  await replace(page, '```text\n/公式');
  await expect(page.getByRole('listbox')).toBeHidden();
  await replace(page, 'https://example.com/公式');
  await expect(page.getByRole('listbox')).toBeHidden();
});

test('new document has isolated undo history; draft survives reload', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await replace(page, '# 草稿\n测试中文内容');
  await page.waitForTimeout(200);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('测试中文内容');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown 编辑器' });
  await editor.click(); await page.keyboard.press('Control+z');
  await expect(editor).not.toContainText('草稿');
  await expect(editor.locator('.cm-placeholder')).toBeVisible();
});

test('untrusted Markdown cannot execute HTML or javascript links', async ({ page }) => {
  await replace(page, '<img src=x onerror="window.pwned=true">\n\n[bad](javascript:alert(1))\n\n$$\\href{javascript:alert(1)}{x}$$');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(page.locator('#reading-view img')).toHaveCount(0);
  await expect(page.locator('#reading-view a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { pwned?: boolean }).pwned)).toBeUndefined();
});

test('desktop and narrow viewports remain usable', async ({ page }) => {
  await page.screenshot({ path: 'test-results/desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/mobile.png' });
  await replace(page, '/公式');
  await expect(page.getByRole('listbox')).toBeInViewport();
  await page.screenshot({ path: 'test-results/slash-mobile.png' });
});

test('HTML export embeds math fonts and remains readable offline', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
  const download = await downloadPromise;
  const html = await readFile((await download.path())!, 'utf8');
  expect(html).toContain('data:');
  const fontUrls = [...html.matchAll(/url\("?([^")]+)"?\)/g)].map(match => match[1]);
  expect(fontUrls.length).toBeGreaterThan(10);
  expect(fontUrls.every(url => url.startsWith('data:'))).toBe(true);
  await page.setContent(html);
  await expect(page.locator('.katex').first()).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe('hidden');
});

test('native close flushes current text and stale save acknowledgements stay dirty', async ({ page }) => {
  await page.addInitScript(() => {
    const messages: Record<string, unknown>[] = [];
    let listener: (event: { data: unknown }) => void;
    const host = {
      addEventListener: (_: string, callback: typeof listener) => { listener = callback; },
      postMessage: (message: Record<string, unknown>) => {
        messages.push(message);
        if (message.type === 'ready') queueMicrotask(() => listener({ data: { type: 'document', documentId: 'test-document', document: { text: '# Native', baseline: '# Native', name: 'native.md', path: 'C:/native.md', saved: true } } }));
      },
    };
    Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: host } });
    Object.assign(window, { __testMessages: messages, __sendHost: (data: unknown) => listener({ data }) });
  });
  await page.reload();
  await replace(page, '# Latest unsaved text');
  await page.evaluate(() => (window as any).__sendHost({ type: 'saved', documentId: 'test-document', name: 'native.md', text: '# Native' }));
  await expect(page.locator('#save-state')).toHaveText('未保存');
  await page.evaluate(() => (window as any).__sendHost({ type: 'requestClosingText' }));
  const messages = await page.evaluate(() => (window as any).__testMessages);
  expect(messages.at(-1)).toEqual({ type: 'closingText', documentId: 'test-document', text: '# Latest unsaved text' });
});
