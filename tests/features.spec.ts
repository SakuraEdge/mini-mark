import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function editorText(page: Page, value: string) {
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown 编辑器' });
  await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(value);
  return editor;
}
async function plugins(page: Page) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '插件', exact: true }).click();
  return page.locator('#plugins-dialog');
}
async function install(page: Page, source: string) {
  const dialog = await plugins(page);
  await dialog.getByRole('button', { name: '新建', exact: true }).click();
  await dialog.getByRole('textbox', { name: '插件源码' }).fill(source);
  await dialog.getByRole('button', { name: '保存插件', exact: true }).click();
  await expect(dialog.locator('#plugin-status')).toHaveText('已保存', { timeout: 8000 });
  return dialog;
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-editor')).toBeVisible();
});

test('Mini Mark brand and theme transition stay readable and respect reduced motion', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.brand')).toHaveText('Mini Mark');
  await expect(page.locator('.brand img')).toHaveAttribute('src', './mini-mark.svg');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/theme-transition/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).not.toHaveClass(/theme-transition/);
  await page.screenshot({ path: info.outputPath('mini-mark-light.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/theme-transition/);
  await page.screenshot({ path: info.outputPath('mini-mark-dark.png') });
});

test('image insertion renders in live and reading modes and persists after reload', async ({ page }) => {
  const editor = await editorText(page, '图片笔记\n');
  await page.keyboard.press('Control+End');
  await page.getByRole('button', { name: '插入图片', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '选择本地图片', exact: true }).click();
  await (await chooser).setFiles('docs/branding/concepts/mini-mark-c.png');
  await expect(page.locator('#image-dialog')).not.toBeVisible();
  await expect(editor).toContainText('![mini-mark-c]');
  await page.getByRole('button', { name: '即时', exact: true }).click();
  await editor.click(); await page.keyboard.press('Control+End');
  const image = page.locator('.image-block img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(page.locator('#reading-view img')).toBeVisible();
  await page.waitForTimeout(250);
  await page.reload();
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect.poll(() => page.locator('#reading-view img').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
});

test('pasted and dropped images preserve the surrounding text', async ({ page }) => {
  const editor = await editorText(page, '开头\n结尾');
  await page.keyboard.press('Control+End');
  const base64 = (await readFile('docs/branding/concepts/mini-mark-c.png')).toString('base64');
  for (const type of ['paste', 'drop']) {
    await editor.evaluate((element, { base64, type }) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const data = new DataTransfer(); data.items.add(new File([bytes], `${type}.png`, { type: 'image/png' }));
      const event = type === 'paste' ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
    }, { base64, type });
    await expect(editor).toContainText(`![${type}]`);
  }
  await expect.poll(() => page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('moye.session.v2')!);
    return session.documents.find((doc: { id: string }) => doc.id === session.activeId).text;
  })).toContain('开头\n结尾');
});

test('custom plugin edits are undoable, retained, and disabled on demand', async ({ page }, info) => {
  const editor = await editorText(page, '原文');
  await page.keyboard.press('Control+End');
  const dialog = await install(page, `miniMark.register({id:'test-plugin',name:'自定义工具',version:'1.0',commands:[{id:'append',title:'添加署名',run(ctx){return {replaceSelection:'\\n作者：Mini Mark',state:{count:(ctx.state?.count||0)+1}}}}]});`);
  await dialog.getByRole('button', { name: '添加署名', exact: true }).click();
  await expect(dialog.locator('#plugin-status')).toHaveText('执行完成');
  await expect(editor).toContainText('作者：Mini Mark');
  await page.screenshot({ path: info.outputPath('mini-mark-plugins.png') });
  await dialog.getByRole('button', { name: '关闭插件窗口' }).click();
  await editor.click(); await page.keyboard.press('Control+z');
  await expect(editor).toHaveText('原文');
  await page.reload();
  const restored = await plugins(page);
  await expect(restored.locator('#plugin-name')).toHaveText('自定义工具');
  await restored.getByLabel('启用', { exact: true }).uncheck();
  await expect(restored.getByRole('button', { name: '添加署名', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minimark.plugins.v1')!)[0].state)).toEqual({ count: 1 });
});

test('plugin sandbox blocks network and unavailable browser APIs', async ({ page }) => {
  let requests = 0;
  await page.route('https://example.com/**', route => { requests++; return route.abort(); });
  const dialog = await install(page, `miniMark.register({id:'probe',name:'隔离检查',version:'1',commands:[{id:'check',title:'检查边界',async run(){let blocked=false;try{await fetch('https://example.com/probe')}catch{blocked=true}return {message:JSON.stringify({blocked,document:typeof document,chrome:typeof chrome})}}}]});`);
  await dialog.getByRole('button', { name: '检查边界', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('"blocked":true');
  await expect(page.locator('#toast')).toContainText('"document":"undefined"');
  await expect(page.locator('#toast')).toContainText('"chrome":"undefined"');
  expect(requests).toBe(0);
});

test('plugin timeouts leave the app usable and stale edits are rejected', async ({ page }) => {
  const editor = await editorText(page, '保留原文');
  const dialog = await install(page, `miniMark.register({id:'slow',name:'超时检查',version:'1',commands:[{id:'hang',title:'死循环',run(){while(true){}}},{id:'delay',title:'延迟替换',async run(){await new Promise(r=>setTimeout(r,1000));return {replaceDocument:'错误覆盖'}}}]});`);
  await dialog.getByRole('button', { name: '死循环', exact: true }).click();
  await expect(dialog.locator('#plugin-status')).toContainText('超时', { timeout: 7000 });
  await expect(page.locator('iframe.plugin-runtime')).toHaveCount(0);
  await dialog.getByRole('button', { name: '延迟替换', exact: true }).click();
  await dialog.evaluate((element: HTMLDialogElement) => element.close());
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('新编辑');
  await expect(dialog.locator('#plugin-status')).toContainText('文档已修改');
  await expect(editor).toContainText('保留原文');
  await expect(editor).not.toContainText('错误覆盖');
});
