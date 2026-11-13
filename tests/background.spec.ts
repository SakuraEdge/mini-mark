import { test, expect, type Page } from '@playwright/test';

async function settings(page: Page) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '主题背景', exact: true }).click();
  await expect(page.locator('#background-dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeEnabled();
}

async function importImage(page: Page) {
  await page.locator('#background-file-input').setInputFiles('docs/branding/concepts/mini-mark-c.png');
  await expect(page.locator('#background-status')).toHaveText('已保存');
  await expect(page.locator('#theme-background')).toBeVisible();
  await expect.poll(() => page.locator('#theme-background').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
}

test('custom background persists independently of documents and supports transparency, enable and remove', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const text = await page.locator('.cm-content').innerText();
  await settings(page);
  await importImage(page);
  await page.locator('#background-transparency').fill('35');
  await expect(page.locator('#background-value')).toHaveText('35%');
  await expect(page.locator('#theme-background')).toHaveCSS('opacity', '0.65');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  expect(await page.locator('.cm-content').innerText()).toBe(text);
  await expect(page.locator('#background-status')).toHaveText('已保存');
  await page.reload();
  await expect(page.locator('#theme-background')).toBeVisible();
  await expect(page.locator('#theme-background')).toHaveCSS('opacity', '0.65');
  await settings(page);
  await page.getByRole('checkbox', { name: '启用背景', exact: true }).uncheck();
  await expect(page.locator('#theme-background')).toBeHidden();
  await expect(page.locator('#background-status')).toHaveText('已保存');
  await page.reload(); await settings(page);
  await expect(page.getByRole('checkbox', { name: '启用背景', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: '启用背景', exact: true }).check();
  await expect(page.locator('#theme-background')).toBeVisible();
  await page.getByRole('button', { name: '移除背景', exact: true }).click();
  await expect(page.locator('#background-status')).toHaveText('已移除背景');
  await expect(page.locator('#theme-background')).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/has-theme-background/);
});

test('invalid background images do not replace the current image or affect editing', async ({ page }) => {
  await page.goto('/'); await settings(page); await importImage(page);
  const original = await page.locator('#theme-background').getAttribute('src');
  await page.locator('#background-file-input').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"/>') });
  await expect(page.locator('#background-status')).toContainText('格式无效');
  await expect(page.locator('#theme-background')).toHaveAttribute('src', original!);
  await page.locator('#background-file-input').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.locator('#background-status')).toContainText('10 MB');
  await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('textbox', { name: 'Markdown 编辑器' }).fill('背景失败后仍可编辑');
  await expect(page.locator('.cm-content')).toHaveText('背景失败后仍可编辑');
});

test('background settings fit narrow windows and text stays opaque in both themes', async ({ page }, info) => {
  await page.goto('/'); await settings(page); await importImage(page);
  for (const width of [1180, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator('#background-dialog').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    expect(bounds.right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`background-settings-${width}.png`) });
  }
  await page.locator('#background-transparency').fill('100');
  await expect(page.locator('#theme-background')).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.setViewportSize({ width: 1180, height: 844 });
  await expect(page.locator('.cm-content')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await settings(page); await page.locator('#background-transparency').fill('65');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '分屏', exact: true }).click();
  await expect(page.locator('#reading-view')).toHaveCSS('opacity', '1');
  await expect(page.locator('#theme-background')).toHaveCSS('opacity', '0.35');
  await page.screenshot({ path: info.outputPath('background-dark-split.png') });
});
