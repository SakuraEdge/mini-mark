import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const editor = (page: Page) => page.getByRole('textbox', { name: 'Markdown 编辑器' });
const picker = (page: Page) => page.getByRole('combobox', { name: '代码块语言' });

async function openMarkdown(page: Page, text: string) {
  await page.goto('/');
  const choosing = page.waitForEvent('filechooser');
  await page.locator('#open-file').click();
  await (await choosing).setFiles({ name: '交互回归.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  await expect(page.locator('#document-name')).toHaveText('交互回归.md');
  await page.getByRole('button', { name: '源码', exact: true }).click();
}

async function savedText(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.locator('#save-file').click();
  await page.locator('#save-markdown').click();
  return readFile((await (await downloading).path())!, 'utf8');
}

test('code select-all replaces just the body, then selects the entire document on a second press', async ({ page }) => {
  const oldCode = 'const a = 1;\nconst b = 2;';
  const original = '开头\n\n````javascript title\n' + oldCode + '\n````\n\n结尾';
  await openMarkdown(page, original);
  await editor(page).getByText('const a = 1;', { exact: false }).last().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('新代码');
  expect(await savedText(page)).toBe(original.replace(oldCode, '新代码'));
  await editor(page).locator('.cm-line').filter({ hasText: '新代码' }).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('新文档');
  expect(await savedText(page)).toBe('新文档');
});

test('rendered table selects local Markdown first, then all, while prose selects all at once', async ({ page }) => {
  const table = '| 名称 | 值 |\n| --- | --- |\n| A | B |';
  const original = '开头\n\n' + table + '\n\n结尾';
  await openMarkdown(page, original);
  await editor(page).press('Control+End');
  await page.getByRole('button', { name: '即时', exact: true }).click();
  await page.locator('.table-block').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('仅此表格');
  expect(await savedText(page)).toBe(original.replace(table, '仅此表格'));
  await editor(page).press('Control+z');
  await expect(editor(page)).toContainText('结尾');
  await editor(page).press('Control+End');
  await page.locator('.table-block').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('第一段\n\n第二段');
  expect(await savedText(page)).toBe('第一段\n\n第二段');
  await editor(page).locator('.cm-line').filter({ hasText: '第一段' }).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('从正文全选');
  expect(await savedText(page)).toBe('从正文全选');
});

test('changing a fence language preserves unknown tokens in other blocks and header metadata, with undo', async ({ page }) => {
  const original = '```unknown-mode extra=1\nkeep\n```\n\n~~~js show-lines\nvalue\n~~~\n';
  await openMarkdown(page, original);
  await expect(picker(page)).toHaveCount(2);
  await expect(picker(page).first()).toHaveValue('unknown-mode');
  expect(await savedText(page)).toBe(original);
  await picker(page).nth(1).selectOption('json');
  expect(await savedText(page)).toBe(original.replace('~~~js', '~~~json'));
  await editor(page).press('Control+z');
  expect(await savedText(page)).toBe(original);
});

test('a handwritten fence, toolbar and slash command reuse the last dropdown choice after reload', async ({ page }) => {
  await openMarkdown(page, '');
  await page.locator('#code').click();
  await expect(picker(page)).toHaveValue('cpp');
  await picker(page).selectOption('python');
  expect(await savedText(page)).toBe('```python\n\n```\n');
  await page.reload();
  await page.locator('#new-tab').click();
  await page.getByRole('button', { name: '即时', exact: true }).click();
  await editor(page).click();
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('print(1)');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  expect(await savedText(page)).toBe('```python\nprint(1)\n```\n');
  await picker(page).selectOption('json');
  await editor(page).press('Control+End');
  await page.keyboard.insertText('/代码');
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(2);
  await expect(picker(page).nth(1)).toHaveValue('json');
  await page.locator('#new-tab').click();
  await page.locator('#code').click();
  await expect(picker(page)).toHaveValue('json');
});

test('live rule appears on Enter, can be edited again and leaves Markdown, headings and code intact', async ({ page }) => {
  const before = '标题\n---\n\n```text\n---\n```\n\n';
  await openMarkdown(page, before);
  await page.getByRole('button', { name: '即时', exact: true }).click();
  await editor(page).press('Control+End');
  await page.keyboard.type('---');
  const rule = page.locator('.cm-content .live-rule hr');
  await expect(rule).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(rule).toBeVisible();
  await page.keyboard.insertText('下一段');
  await expect(rule).toHaveCount(1);
  expect(await savedText(page)).toBe(before + '---\n下一段');
  await rule.click();
  await expect(rule).toHaveCount(0);
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  expect(await savedText(page)).toBe(before + '--\n下一段');
});

test('Ctrl+F toggles from the search and replace fields, with Chinese options and working replacement', async ({ page }, info) => {
  await openMarkdown(page, '苹果 苹果');
  await editor(page).press('Control+f');
  const panel = page.locator('.cm-search');
  const find = panel.getByRole('textbox', { name: '查找', exact: true });
  await expect(find).toBeFocused();
  await find.press('Control+f');
  await expect(panel).toBeHidden();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Control+f');
  await find.fill('苹果');
  await find.press('End');
  const replacement = panel.getByRole('textbox', { name: '替换为' });
  await replacement.fill('梨');
  await replacement.press('End');
  for (const name of ['区分大小写', '正则表达式', '全词匹配']) await expect(panel.getByRole('checkbox', { name })).toBeVisible();
  for (const name of ['上一个', '下一个', '选中全部', '替换', '全部替换', '关闭']) await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('search-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('button', { name: '全部替换' })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('search-narrow.png') });
  await panel.getByRole('button', { name: '全部替换' }).click();
  await replacement.press('Control+f');
  await expect(panel).toBeHidden();
  await expect(editor(page)).toBeFocused();
  expect(await savedText(page)).toBe('梨 梨');
});
