import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('HTML opens as source, does not execute, saves unchanged, and runs only on request', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#open-file').click();
  const text = '<!doctype html><html><body><h1 id="value">Before</h1><script>document.getElementById("value").textContent="Running"; try { parent.document.body.dataset.compromised="yes" } catch {} </script></body></html>';
  await (await chooser).setFiles({ name: 'preview.HTM', mimeType: 'text/html', buffer: Buffer.from(text) });
  await expect(page.locator('#document-format')).toHaveText('HTML');
  await expect(page.locator('#surface')).toHaveAttribute('data-mode', 'source');
  await expect(page.locator('.cm-content .syntax-keyword').first()).toBeVisible();
  await expect(page.locator('.view-switch')).toBeHidden();
  await expect(page.locator('#html-preview-dialog')).toHaveCount(0);
  expect(await page.locator('body').getAttribute('data-compromised')).toBeNull();
  const download = page.waitForEvent('download');
  await page.locator('#save-file').click(); await page.locator('#save-markdown').click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('preview.HTM');
  expect(await readFile((await saved.path())!, 'utf8')).toBe(text);
  await page.locator('#run-html').click();
  await expect(page.frameLocator('#html-preview-dialog iframe').locator('#value')).toHaveText('Running');
  expect(await page.locator('body').getAttribute('data-compromised')).toBeNull();
  await expect(page.locator('#html-preview-dialog iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await page.getByRole('button', { name: '关闭预览' }).click();
  await page.locator('#chrome-html').click();
  await expect(page.locator('#toast')).toContainText('桌面版');
});

test('new HTML and markdown tabs keep modes and shortcuts independent', async ({ page }) => {
  await page.goto('/');
  await page.locator('#more').click(); await page.locator('#new-html').click();
  await expect(page.locator('#document-name')).toHaveText('未命名 1.html');
  const editor = page.getByRole('textbox', { name: 'Markdown 编辑器' });
  await editor.fill('<h1>HTML</h1>');
  await page.keyboard.press('Control+1');
  await expect(editor).toHaveText('<h1>HTML</h1>');
  await page.locator('#new-tab').click();
  await expect(page.locator('#document-format')).toHaveText('Markdown');
  await expect(page.locator('#html-tools')).toBeHidden();
  await page.getByRole('tab', { name: '未命名 1.html', exact: true }).click();
  await expect(page.locator('#document-format')).toHaveText('HTML');
  await expect(editor).toHaveText('<h1>HTML</h1>');
});

test('native run sends exact current HTML and releases controls on cancel or error', async ({ page }) => {
  await page.addInitScript(() => {
    const doc = { id: 'html', name: 'index.html', text: '<h1>original</h1>', baseline: '<h1>original</h1>', revision: 0 };
    let receive: (event: { data: unknown }) => void;
    Object.assign(window, { requests: [], chrome: { webview: {
      addEventListener: (_: string, callback: typeof receive) => { receive = callback; },
      postMessage: (message: Record<string, unknown>) => {
        if (message.type === 'ready') setTimeout(() => receive({ data: { type: 'workspace', tabs: [{ ...doc, dirty: false }], document: doc } }), 0);
        if (message.type === 'runHtml') {
          (window as unknown as { requests: unknown[] }).requests.push(message);
          setTimeout(() => receive({ data: { type: 'operationComplete' } }), 0);
        }
      },
    } } });
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Markdown 编辑器' }).fill('<h1>latest</h1>');
  await page.locator('#run-html').click(); await page.locator('#chrome-html').click();
  await expect(page.locator('#app')).not.toHaveClass(/transition-pending/);
  const requests = await page.evaluate(() => (window as unknown as { requests: Record<string, unknown>[] }).requests);
  expect(requests.map(item => [item.type, item.target, item.text])).toEqual([
    ['runHtml', 'builtin', '<h1>latest</h1>'], ['runHtml', 'chrome', '<h1>latest</h1>'],
  ]);
});

test('native selection covers Chinese, headings and code with contrasting colors in both themes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown 编辑器' });
  await editor.fill('# 中文标题\n\n普通文字选中范围\n\n```js\nconst selected = 123;\n```\n\n> 引用');
  await page.getByRole('button', { name: '即时', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme').click();
    await editor.click(); await page.keyboard.press('Control+a');
    expect(await page.evaluate(() => getSelection()?.toString())).toContain('const selected = 123;');
    const colors = await editor.evaluate(element => {
      const style = getComputedStyle(element, '::selection'); return [style.backgroundColor, style.color];
    });
    expect(colors).toEqual(theme === 'light' ? ['rgb(22, 95, 192)', 'rgb(255, 255, 255)'] : ['rgb(172, 210, 255)', 'rgb(16, 33, 58)']);
    await expect(page.locator('.cm-selectionLayer')).toHaveCount(0);
    await page.screenshot({ path: `test-results/selection-${theme}.png` });
  }
});
