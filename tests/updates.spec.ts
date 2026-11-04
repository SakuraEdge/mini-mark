import { test, expect } from '@playwright/test';

for (const offline of [false, true]) {
  test(offline ? 'offline results disclose cache age without claiming current' : 'Windows upgrade downloads and cancels through the native host', async ({ page }) => {
    await page.addInitScript(({ offline }) => {
      let callback: (event: { data: unknown }) => void;
      const messages: any[] = [];
      localStorage.setItem('moye.updates.v1', JSON.stringify({ auto: false }));
      Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
        addEventListener: (_: string, listener: typeof callback) => { callback = listener; },
        postMessage: (message: any) => {
          messages.push(message);
          const emit = (data: unknown) => queueMicrotask(() => callback({ data }));
          if (message.type === 'ready') emit({ type: 'workspace', tabs: [{ id: 'doc', name: 'note.md', dirty: false, revision: 0 }], document: { id: 'doc', name: 'note.md', text: '# Keep writing', baseline: '# Keep writing', revision: 0 } });
          if (message.type === 'checkUpdates') emit({ type: 'updateResult', requestId: message.requestId, releases: [{ tag_name: offline ? 'v1.0.0' : 'v2.0.0' }], cacheNotice: offline ? '网络暂不可用，以下为 11-04 12:00 的检测记录。' : null, installSupported: true });
          if (message.type === 'installUpdate') emit({ type: 'updateInstallStatus', message: '正在下载更新… 30%', downloading: true });
          if (message.type === 'cancelUpdate') emit({ type: 'updateInstallStatus', message: '下载已取消或超时，可以重新尝试。', downloading: false });
        },
      } } });
      Object.assign(window, { __testMessages: messages });
    }, { offline });
    await page.goto('/');
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('button', { name: '检测更新', exact: true }).click();
    const install = page.getByRole('button', { name: '下载并覆盖更新' });
    if (offline) {
      await expect(page.locator('#update-status')).toContainText('11-04 12:00 的检测记录');
      await expect(page.locator('#update-status')).toContainText('缓存中没有高于当前版本的更新');
      await expect(page.locator('#update-status')).not.toContainText('已是最新');
      await expect(install).not.toBeVisible();
    } else {
      await install.click();
      await expect(page.locator('#update-status')).toContainText('30%');
      await expect(install).toBeDisabled();
      await expect(page.locator('#update-check')).toBeDisabled();
      await page.getByRole('button', { name: '取消下载' }).click();
      await expect(install).toBeEnabled();
      await expect(page.locator('#update-status')).toContainText('下载已取消');
      const messages = await page.evaluate(() => (window as any).__testMessages);
      expect(messages.filter((message: any) => message.type === 'installUpdate')).toEqual([{ type: 'installUpdate', version: 'v2.0.0' }]);
      expect(messages.some((message: any) => message.type === 'cancelUpdate')).toBe(true);
      await page.screenshot({ path: 'test-results/updates-v102.png' });
    }
    await page.getByRole('button', { name: '关闭更新窗口' }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('Keep writing');
  });
}

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
