import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function openFile(page: Page, buffer: Buffer, name = '旧稿.txt') {
  const next = page.waitForEvent('filechooser'); await page.locator('#open-file').click();
  await (await next).setFiles({ name, mimeType: 'text/plain', buffer });
}
const specimen = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 13, 10]);
test('GBK recovery, cancel, strict conversion, restored pending target and actual downloaded bytes', async ({ page }, info) => {
  await page.goto('/'); await openFile(page, specimen);
  const panel = page.locator('#encoding-panel'), apply = panel.locator('[data-apply]');
  await expect(panel).toBeVisible(); await page.locator('#encoding-target').selectOption('gbk');
  await expect(panel.locator('pre')).toHaveText('中文');
  await panel.locator('[data-cancel]').click(); await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await page.locator('#file-encoding').click(); await page.locator('#encoding-target').selectOption('gbk');
  await apply.click(); await expect(panel).toBeHidden(); await expect(page.locator('.cm-content')).toContainText('中文');
  await expect(page.locator('#file-encoding')).toHaveText('GBK');
  await page.locator('#file-encoding').click(); await panel.locator('[data-convert]').click();
  await page.locator('#encoding-target').selectOption('windows-1252'); await expect(panel.getByRole('status')).toContainText('无法完整'); await expect(apply).toBeDisabled();
  await page.locator('#encoding-target').selectOption('utf-16be'); await expect(apply).toBeEnabled();
  await page.screenshot({ path: info.outputPath('desktop-encoding.png') }); await apply.click();
  await expect(page.locator('#file-encoding')).toContainText('GBK → UTF-16 BE');
  await page.reload(); await expect(page.locator('#file-encoding')).toContainText('GBK → UTF-16 BE');
  const pending = page.waitForEvent('download'); await page.keyboard.press('Control+s');
  const downloaded = await pending; expect(downloaded.suggestedFilename()).toBe('旧稿.txt');
  expect(await readFile((await downloaded.path())!)).toEqual(Buffer.from([0xfe,0xff,0x4e,0x2d,0x65,0x87,0,13,0,10]));
  await expect(page.locator('#file-encoding')).toHaveText('UTF-16 BE');
});
test('dirty text blocks reinterpretation; narrow panel stays within the viewport', async ({ page }, info) => {
  await page.goto('/'); await openFile(page, Buffer.from('Hello'), 'draft.md');
  const editor = page.locator('.cm-content'); await expect(editor).toHaveText('Hello'); await editor.click(); await page.keyboard.press('End'); await page.keyboard.type('!');
  await page.setViewportSize({ width: 320, height: 580 }); await page.locator('#file-encoding').click();
  const panel = page.locator('#encoding-panel'); await expect(panel.getByRole('status')).toContainText('先保存'); await expect(panel.locator('[data-apply]')).toBeDisabled();
  await panel.locator('[data-convert]').click(); await page.locator('#encoding-target').selectOption('gbk'); await expect(panel.locator('pre')).toHaveText('Hello!');
  const bounds = (await panel.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: info.outputPath('narrow-encoding.png') }); await page.keyboard.press('Escape'); await expect(editor).toHaveText('Hello!');
});
