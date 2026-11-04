import { test, expect } from '@playwright/test';

test('major update popup opt-out persists while manual checking remains available', async ({ page }) => {
  await page.addInitScript(() => {
    let callback: (event: { data: unknown }) => void;
    const messages: unknown[] = [];
    Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
      addEventListener: (_: string, listener: typeof callback) => { callback = listener; },
      postMessage: (message: any) => {
        messages.push(message);
        if (message.type === 'ready') queueMicrotask(() => callback({ data: { type: 'workspace', tabs: [{ id: 'doc', name: '更新测试.md', dirty: false, revision: 0 }], document: { id: 'doc', name: '更新测试.md', text: '# 保留文档', baseline: '# 保留文档', revision: 0 } } }));
        if (message.type === 'checkUpdates') queueMicrotask(() => callback({ data: { type: 'updateResult', requestId: message.requestId, releases: [{ tag_name: 'v2.0.0', draft: false, prerelease: false }] } }));
      },
    } } });
    Object.assign(window, { __testMessages: messages });
  });
  await page.goto('/');
  await page.bringToFront();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 12000 });
  await expect(page.getByRole('heading', { name: '发现大版本更新' })).toBeVisible();
  await page.getByLabel('不再弹出大版本更新提醒').check();
  await page.getByRole('button', { name: '关闭更新窗口' }).click();
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('moye.updates.v1')!);
    settings.lastAttempt = 0; settings.promptedMajor = 0;
    localStorage.setItem('moye.updates.v1', JSON.stringify(settings));
  });
  await page.reload();
  await page.waitForTimeout(5800);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '检测更新', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#update-status')).toHaveText('发现大版本 v2.0.0。');
  await expect(page.getByLabel('不再弹出大版本更新提醒')).toBeChecked();
  await expect(page.getByRole('button', { name: '查看新版 / 下载' })).toBeVisible();
  await page.getByRole('button', { name: '关闭更新窗口' }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('保留文档');
});
