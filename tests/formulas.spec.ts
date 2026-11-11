import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

async function replace(page: Page, text: string) {
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown 编辑器' });
  await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(text);
  return editor;
}
async function setLatex(page: Page, latex: string) {
  await page.locator('.formula-source summary').click();
  await page.getByRole('textbox', { name: '公式 LaTeX 源码' }).fill(latex);
}
async function rawLines(page: Page) {
  return page.locator('.cm-line').evaluateAll(lines => lines.map(line => {
    const clone = line.cloneNode(true) as Element; clone.querySelectorAll('button').forEach(button => button.remove()); return clone.textContent;
  }));
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-editor')).toBeVisible();
});

test('slash formula exposes an editor, visual fraction writes back and undoes once', async ({ page }) => {
  await replace(page, '/公式');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '公式编辑器', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '公式编辑器' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '分数', exact: true }).click();
  await page.keyboard.insertText('1');
  await page.keyboard.press('Tab');
  await page.keyboard.insertText('2');
  await expect(page.locator('.formula-preview .katex')).toBeVisible();
  await dialog.getByRole('button', { name: '写入 Markdown' }).click();
  await expect(dialog).toBeHidden();
  expect((await rawLines(page)).join('\n')).toMatch(/\\frac(?:\{1\}|1)(?:\{2\}|2)/);
  await page.keyboard.press('Control+z');
  expect(await rawLines(page)).toEqual(['$$', '', '$$']);
});

test('edit an existing rendered formula without replacing surrounding prose', async ({ page }) => {
  await replace(page, 'Before\n\n$$\nx^2\n$$\n\nAfter');
  await page.getByRole('button', { name: '即时', exact: true }).click();
  await page.locator('.math-block').click();
  await setLatex(page, '\\frac{a}{b}+\\sqrt{x}');
  await page.getByRole('button', { name: '写入 Markdown' }).click();
  await expect(page.locator('.math-block .katex')).toBeVisible();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  expect((await rawLines(page)).join('\n')).toBe('Before\n\n$$\n\\frac{a}{b}+\\sqrt{x}\n$$\n\nAfter');
});

test('cancel does not insert a new formula, invalid formulas remain editable', async ({ page }) => {
  await replace(page, 'Keep me');
  await page.getByRole('button', { name: '公式', exact: true }).click();
  await setLatex(page, '\\frac{');
  await page.getByRole('button', { name: '写入 Markdown' }).click();
  await expect(page.locator('#formula-status')).not.toBeEmpty();
  await expect(page.locator('#formula-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await rawLines(page)).toEqual(['Keep me']);
});

test('copy sends structured math to the host, acknowledges failures, and leaves markdown unchanged', async ({ page }) => {
  await page.addInitScript(() => {
    const handlers: ((event: { data: unknown }) => void)[] = [];
    const document = { id: 'math-doc', name: 'test.md', text: 'unchanged', baseline: 'unchanged', revision: 0 };
    Object.assign(window, {
      equationRequests: [],
      chrome: { webview: {
        addEventListener: (_: string, callback: (event: { data: unknown }) => void) => handlers.push(callback),
        postMessage: (message: Record<string, unknown>) => {
          if (message.type === 'ready') setTimeout(() => handlers.forEach(callback => callback({ data: { type: 'workspace', tabs: [{ ...document, dirty: false }], document } })), 0);
          if (message.type === 'copyEquation') {
            (window as unknown as { equationRequests: unknown[] }).equationRequests.push(message);
            const attempt = (window as unknown as { equationRequests: unknown[] }).equationRequests.length;
            setTimeout(() => handlers.forEach(callback => callback({ data: { type: 'equationCopied', requestId: message.requestId, error: attempt === 1 ? '剪贴板占用' : undefined } })), 0);
          }
        },
      } },
    });
  });
  await page.reload();
  await page.getByRole('button', { name: '公式', exact: true }).click();
  await setLatex(page, '\\frac{1}{2}+\\sqrt{x}+\\alpha');
  await page.getByRole('button', { name: '复制到 Word / WPS' }).click();
  await expect(page.locator('#formula-status')).toHaveText('剪贴板占用');
  await page.getByRole('button', { name: '复制到 Word / WPS' }).click();
  await expect(page.locator('#formula-status')).toHaveText('已复制可编辑公式');
  const payload = await page.evaluate(() => (window as unknown as { equationRequests: { mathml: string; omml: string; html: string }[] }).equationRequests[1]);
  expect(payload.mathml).toContain('<mfrac>');
  expect(payload.mathml).not.toContain('annotation');
  expect(payload.omml).toContain('<m:f>');
  expect(payload.omml).toContain('<m:rad>');
  expect(payload.html).toContain('<!--StartFragment-->');
  expect(payload.html).not.toContain('katex');
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/equation-clipboard.json', JSON.stringify(payload));
  await page.keyboard.press('Escape');
  expect(await rawLines(page)).toEqual(['unchanged']);
});

test('formula controls do not appear in fenced code or YAML', async ({ page }) => {
  await replace(page, '```tex\n$$\nx\n$$\n```');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.formula-entry')).toHaveCount(0);
});

test('formula dialog fits desktop and mobile and uses local font assets', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173') && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.getByRole('button', { name: '公式', exact: true }).click();
  await setLatex(page, '\\sum_{i=1}^{n}\\frac{i^2}{\\sqrt{i+1}}');
  await expect(page.locator('math-field')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/formula-desktop.png' });
  for (const viewport of [{ width: 390, height: 844 }, { width: 720, height: 520 }]) {
    await page.setViewportSize(viewport);
    const metrics = await page.locator('#formula-dialog').evaluate(element => {
      const rect = element.getBoundingClientRect(); return { x: rect.x, right: rect.right, width: element.clientWidth, scroll: element.scrollWidth };
    });
    expect(metrics.x).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(viewport.width);
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/formula-mobile.png' });
  expect(external).toEqual([]);
});
