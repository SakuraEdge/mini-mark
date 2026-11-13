import { test, expect, type Page } from '@playwright/test';

const REV_SETTINGS = 'moye.updates.rev.v1';
const rev = (releaseVersion: string, version = '9.0.0') => ({
  tag_name: `rev-v${releaseVersion}`, version, releaseVersion,
  name: `Mini Mark Rev v${releaseVersion}`, draft: false, prerelease: false,
});
interface UpdateMock {
  releases: unknown[];
  cacheNotice?: string;
  legacySettings?: Record<string, unknown>;
  subsequentReleases?: unknown[];
  subsequentCacheNotice?: string;
  delayed?: boolean;
}

async function mockUpdates(page: Page, options: UpdateMock) {
  await page.addInitScript(options => {
    let callback: (event: { data: unknown }) => void;
    let checks = 0;
    const messages: any[] = [];
    if (options.legacySettings && localStorage.getItem('moye.updates.v1') === null) localStorage.setItem('moye.updates.v1', JSON.stringify(options.legacySettings));
    Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
      addEventListener: (_: string, listener: typeof callback) => { callback = listener; },
      postMessage: (message: any) => {
        messages.push(message);
        const emit = (data: unknown) => queueMicrotask(() => callback({ data }));
        if (message.type === 'ready') emit({
          type: 'workspace', tabs: [{ id: 'doc', name: 'note.md', dirty: false, revision: 0 }],
          document: { id: 'doc', name: 'note.md', text: '# Keep writing', baseline: '# Keep writing', revision: 0 },
        });
        if (message.type === 'checkUpdates') {
          checks++;
          const respond = () => emit({
            type: 'updateResult', requestId: message.requestId, releases: checks > 1 ? options.subsequentReleases ?? options.releases : options.releases,
            cacheNotice: checks > 1 ? options.subsequentCacheNotice ?? options.cacheNotice : options.cacheNotice, installSupported: true,
          });
          if (options.delayed) Object.assign(window, { __finishUpdateCheck: respond });
          else respond();
        }
        if (message.type === 'installUpdate') emit({ type: 'updateInstallStatus', message: '正在下载更新… 30%', downloading: true });
        if (message.type === 'cancelUpdate') emit({ type: 'updateInstallStatus', message: '下载已取消或超时，可以重新尝试。', downloading: false });
      },
    } } });
    Object.assign(window, { __testMessages: messages });
  }, options);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('Keep writing');
}

async function openUpdates(page: Page) {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '检测更新', exact: true }).click();
  await expect(page.locator('#update-dialog')).toBeVisible();
}

async function finishAutomaticCheck(page: Page) {
  await page.bringToFront();
  await expect.poll(async () => page.evaluate(() => (window as any).__testMessages.some((message: any) => message.type === 'checkUpdates')), { timeout: 12000 }).toBe(true);
  await expect(page.locator('#update-status')).not.toHaveText('正在连接 GitHub…');
}

test('Rev update links and installer use the real tag without displaying the internal version', async ({ page }) => {
  await mockUpdates(page, { releases: [rev('1.1.0', '9.1.0')], legacySettings: { auto: false } });
  await openUpdates(page);
  await expect(page.locator('.update-version')).toHaveText('当前版本 Rev v1.0.3');
  await expect(page.locator('#update-status')).toHaveText('发现新版本 Rev v1.1.0。');
  await expect(page.locator('#update-dialog')).not.toContainText('9.1.0');
  await page.getByRole('button', { name: '查看新版 / 下载' }).click();
  const install = page.getByRole('button', { name: '下载并覆盖更新' });
  await install.click();
  await expect(page.locator('#update-status')).toContainText('30%');
  await expect(install).toBeDisabled();
  await expect(page.locator('#update-check')).toBeDisabled();
  await page.getByRole('button', { name: '取消下载' }).click();
  await expect(install).toBeEnabled();
  await expect(page.locator('#update-status')).toContainText('下载已取消');
  const messages = await page.evaluate(() => (window as any).__testMessages);
  expect(messages.filter((message: any) => message.type === 'installUpdate')).toEqual([{ type: 'installUpdate', version: 'rev-v1.1.0' }]);
  expect(messages.find((message: any) => message.type === 'openExternal')?.url).toBe('https://github.com/SakuraEdge/mini-mark/releases/tag/rev-v1.1.0');
  await page.getByRole('button', { name: '关闭更新窗口' }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('Keep writing');
});

test('offline results disclose cache age without claiming current', async ({ page }) => {
  await mockUpdates(page, {
    releases: [rev('1.0.0', '4.0.0')], legacySettings: { auto: false },
    cacheNotice: '网络暂不可用，以下为 11-04 12:00 的检测记录。',
  });
  await openUpdates(page);
  await expect(page.locator('#update-status')).toContainText('11-04 12:00 的检测记录');
  await expect(page.locator('#update-status')).toContainText('缓存中没有高于当前版本的更新');
  await expect(page.locator('#update-status')).not.toContainText('已是最新');
  await expect(page.getByRole('button', { name: '下载并覆盖更新' })).not.toBeVisible();
});

test('same Rev major is available manually but does not open an automatic popup', async ({ page }) => {
  await mockUpdates(page, { releases: [rev('1.8.0')], legacySettings: { auto: true, promptedMajor: 4 } });
  await finishAutomaticCheck(page);
  await expect(page.locator('#update-dialog')).not.toBeVisible();
  await openUpdates(page);
  await expect(page.locator('#update-status')).toHaveText('发现新版本 Rev v1.8.0。');
});

test('new Rev major prompts independently of legacy major counts and opt-out persists', async ({ page }) => {
  await mockUpdates(page, { releases: [rev('2.0.0')], legacySettings: { auto: true, notifyMajor: true, promptedMajor: 4 } });
  await finishAutomaticCheck(page);
  await expect(page.locator('#update-dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: '发现大版本更新' })).toBeVisible();
  await expect(page.locator('#update-status')).toHaveText('发现大版本 Rev v2.0.0。');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).promptedMajor, REV_SETTINGS)).toBe(2);
  await page.getByLabel('不再弹出大版本更新提醒').check();
  await page.getByRole('button', { name: '关闭更新窗口' }).click();
  await page.evaluate(key => {
    const settings = JSON.parse(localStorage.getItem(key)!);
    settings.lastAttempt = 0; settings.promptedMajor = 0;
    localStorage.setItem(key, JSON.stringify(settings));
  }, REV_SETTINGS);
  await page.reload();
  await finishAutomaticCheck(page);
  await expect(page.locator('#update-dialog')).not.toBeVisible();
  await openUpdates(page);
  await expect(page.locator('#update-status')).toHaveText('发现大版本 Rev v2.0.0。');
  await expect(page.getByLabel('不再弹出大版本更新提醒')).toBeChecked();
  await expect(page.getByRole('button', { name: '查看新版 / 下载' })).toBeVisible();
});

test('legacy preferences survive migration and manual checks stay available', async ({ page }) => {
  await mockUpdates(page, { releases: [rev('2.0.0')], legacySettings: { auto: false, notifyMajor: false, lastAttempt: 1234, promptedMajor: 4 } });
  await openUpdates(page);
  await expect(page.getByLabel('自动检测更新')).not.toBeChecked();
  await expect(page.getByLabel('不再弹出大版本更新提醒')).toBeChecked();
  await expect(page.locator('#update-status')).toHaveText('发现大版本 Rev v2.0.0。');
  await page.getByLabel('自动检测更新').check();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), REV_SETTINGS)).toEqual({ auto: true, notifyMajor: false, lastAttempt: 1234, promptedMajor: 0 });
  await page.getByLabel('自动检测更新').uncheck();
  await page.reload();
  await openUpdates(page);
  await expect(page.getByLabel('自动检测更新')).not.toBeChecked();
  await expect(page.getByLabel('不再弹出大版本更新提醒')).toBeChecked();
});

test('cached Rev major does not trigger an automatic reminder', async ({ page }) => {
  await mockUpdates(page, { releases: [rev('2.0.0')], cacheNotice: '网络暂不可用，以下为缓存记录。' });
  await finishAutomaticCheck(page);
  await expect(page.locator('#update-dialog')).not.toBeVisible();
  await openUpdates(page);
  await expect(page.locator('#update-status')).toContainText('缓存记录');
  await expect(page.locator('#update-status')).toContainText('发现大版本 Rev v2.0.0。');
});

test('legacy schema releases remain comparable but never trigger a Rev major reminder', async ({ page }) => {
  await mockUpdates(page, { releases: [{ tag_name: 'v9.0.0', draft: false, prerelease: false }] });
  await finishAutomaticCheck(page);
  await expect(page.locator('#update-dialog')).not.toBeVisible();
  await openUpdates(page);
  await expect(page.locator('#update-status')).toHaveText('发现新版本 v9.0.0。');
  await page.getByRole('button', { name: '下载并覆盖更新' }).click();
  expect(await page.evaluate(() => (window as any).__testMessages.find((message: any) => message.type === 'installUpdate').version)).toBe('v9.0.0');
});

test('a deferred automatic reminder cannot reopen after a newer manual cached result', async ({ page }) => {
  await page.addInitScript(() => { document.hasFocus = () => false; });
  await mockUpdates(page, {
    releases: [rev('2.0.0')], subsequentReleases: [rev('3.0.0', '10.0.0')],
    subsequentCacheNotice: '网络暂不可用，以下为缓存记录。',
  });
  await finishAutomaticCheck(page);
  await expect(page.locator('#update-dialog')).not.toBeVisible();
  await openUpdates(page);
  await expect(page.locator('#update-status')).toContainText('缓存记录');
  await expect(page.locator('#update-status')).toContainText('Rev v3.0.0');
  await page.getByRole('button', { name: '关闭更新窗口' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#update-dialog')).not.toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).promptedMajor, REV_SETTINGS)).toBe(0);
});

test('brand opens the shared update dialog and shows bundled notes while checking', async ({ page }) => {
  await mockUpdates(page, { releases: [], delayed: true, legacySettings: { auto: false } });
  await page.getByRole('button', { name: 'Mini Mark 版本与更新', exact: true }).click();
  await expect(page.locator('#update-dialog')).toBeVisible();
  await expect(page.locator('#update-dialog')).toHaveAttribute('data-state', 'checking');
  await expect(page.locator('#update-dialog')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#update-notes-title')).toContainText('Rev v1.0.3');
  await expect(page.locator('#update-notes')).not.toBeEmpty();
  await page.evaluate(() => (window as any).__finishUpdateCheck());
  await expect(page.locator('#update-dialog')).toHaveAttribute('data-state', 'current');
  await page.getByRole('button', { name: '关闭更新窗口', exact: true }).click();
  await openUpdates(page);
  expect(await page.locator('#update-dialog').count()).toBe(1);
});

test('fresh candidate notes render as inert text and offline results return to bundled notes', async ({ page }) => {
  const dangerous = '<script>window.__unsafeNotes=true</script>\n- Added workspace support\n![image](https://example.com/tracker.png)';
  await mockUpdates(page, {
    releases: [{ ...rev('1.1.0'), notes: dangerous }], legacySettings: { auto: false },
    subsequentCacheNotice: '网络暂不可用，显示缓存。', subsequentReleases: [{ ...rev('1.1.0'), notes: 'Cached candidate notes' }],
  });
  await openUpdates(page);
  await expect(page.locator('#update-notes')).toHaveText(dangerous);
  expect(await page.locator('#update-notes script,#update-notes img').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__unsafeNotes)).toBeUndefined();
  await page.locator('#update-check').click();
  await expect(page.locator('#update-dialog')).toHaveAttribute('data-state', 'offline');
  await expect(page.locator('#update-notes-title')).toContainText('Rev v1.0.3');
  await expect(page.locator('#update-notes')).not.toContainText('Cached candidate notes');
});

test('update notes and controls remain scrollable and on screen across viewports', async ({ page }, testInfo) => {
  await mockUpdates(page, { releases: [{ ...rev('1.1.0'), notes: Array.from({ length: 60 }, (_, index) => `- 更新内容 ${index + 1}`).join('\n') }], legacySettings: { auto: false } });
  await openUpdates(page);
  for (const width of [1180, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator('#update-dialog').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { width: element.clientWidth, scroll: element.scrollWidth, right: rect.right, bottom: rect.bottom };
    });
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    expect(bounds.right).toBeLessThanOrEqual(width); expect(bounds.bottom).toBeLessThanOrEqual(844);
    expect(await page.locator('#update-notes').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(page.getByRole('button', { name: '下载并覆盖更新', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`updates-notes-${width}.png`) });
  }
});
