import { test, expect, type Page } from '@playwright/test';

interface DeleteMock {
  failDelete?: boolean;
  wrongResponse?: boolean;
  failRefresh?: boolean;
  failListAt?: number;
  opened?: boolean;
  delayed?: boolean;
}
const fileSha = 'a'.repeat(40);
const folderSha = 'b'.repeat(64);

async function mockDelete(page: Page, options: DeleteMock = {}) {
  await page.addInitScript(options => {
    let callback: (event: { data: unknown }) => void;
    const messages: any[] = [];
    let activeId = 'active', listings = 0, removed = false;
    const prefix = '资料/';
    const documents: any[] = [
      { id: 'active', name: '文档.md', text: 'Unsaved local draft', baseline: 'Original cloud text', revision: 3,
        cloud: options.opened ? { owner: 'example-user', path: `${prefix}文档.md`, sha: 'a'.repeat(40), baseline: 'Original cloud text' } : null },
      { id: 'nested', name: '配置.yaml', text: 'draft: true', baseline: 'draft: false', revision: 2,
        cloud: options.opened ? { owner: 'example-user', path: `${prefix}配置.yaml`, sha: 'c'.repeat(40), baseline: 'draft: false' } : null },
    ];
    let entries: any[] = [
      { name: '资料', path: '资料', type: 'dir', sha: 'b'.repeat(64) },
      { name: '说明.md', path: '说明.md', type: 'file', sha: 'a'.repeat(40), size: 88 },
      { name: '缺少版本.md', path: '缺少版本.md', type: 'file' },
      { name: '这个文件名很长用于检查删除按钮不会被文字挤出去.md', path: '这个文件名很长用于检查删除按钮不会被文字挤出去.md', type: 'file', sha: 'd'.repeat(40), size: 1024 },
      { name: '文档.md', path: '资料/文档.md', type: 'file', sha: 'a'.repeat(40), size: 88 },
      { name: '配置.yaml', path: '资料/配置.yaml', type: 'file', sha: 'c'.repeat(40), size: 20 },
    ];
    const emit = (data: unknown) => queueMicrotask(() => callback({ data }));
    const publish = () => emit({ type: 'workspace', tabs: documents.map(doc => ({ ...doc, dirty: doc.text !== doc.baseline })), document: { ...documents.find(doc => doc.id === activeId) } });
    localStorage.setItem('moye.updates.rev.v1', JSON.stringify({ auto: false }));
    Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
      addEventListener: (_: string, listener: typeof callback) => { callback = listener; },
      postMessage: (message: any) => {
        messages.push(message);
        if (message.type === 'ready') publish();
        if (message.type === 'activate') { activeId = message.targetId; publish(); emit({ type: 'operationComplete' }); }
        if (message.type !== 'cloudRequest') return;
        const respond = (data: unknown) => emit({ type: 'cloudResponse', requestId: message.requestId, data });
        if (message.action === 'status') respond({ authenticated: true, configured: true, login: 'example-user' });
        if (message.action === 'repository') respond({ exists: true, private: true });
        if (message.action === 'list') {
          listings++;
          if (options.failListAt === listings || options.failRefresh && removed) emit({ type: 'cloudResponse', requestId: message.requestId, error: '目录网络暂不可用。' });
          else respond({ entries: entries.filter(entry => entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/'))) === message.path) });
        }
        if (message.action === 'delete') {
          const complete = () => {
            if (options.failDelete) { emit({ type: 'cloudResponse', requestId: message.requestId, error: '仓库拒绝删除，请检查写入权限。' }); return; }
            if (options.wrongResponse) { respond({ path: 'wrong.md', type: message.entryType, deleted: true, commit: 'e'.repeat(40) }); return; }
            entries = entries.filter(entry => entry.path !== message.path && !(message.entryType === 'dir' && entry.path.startsWith(`${message.path}/`)));
            removed = true;
            for (const doc of documents) {
              if (doc.cloud?.owner === message.owner && (doc.cloud.path === message.path || message.entryType === 'dir' && doc.cloud.path.startsWith(`${message.path}/`))) doc.cloud = null;
            }
            publish();
            respond({ path: message.path, type: message.entryType, deleted: true, commit: 'e'.repeat(40) });
          };
          if (options.delayed) Object.assign(window, { __finishDelete: complete });
          else complete();
        }
      },
    } } });
    Object.assign(window, { __deleteMessages: messages });
  }, options);
  await page.goto('/');
  await expect(page.getByRole('tab', { name: '文档.md', exact: true })).toBeVisible();
  await page.locator('#cloud-documents').click();
  await expect(page.getByRole('button', { name: '删除文件夹 资料', exact: true })).toBeVisible();
}

const messages = (page: Page) => page.evaluate(() => (window as any).__deleteMessages as any[]);

test('deleting a file requires full-path confirmation and cancel never sends a delete', async ({ page }) => {
  await mockDelete(page);
  let confirmation = '';
  page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.dismiss(); });
  await page.getByRole('button', { name: '删除文件 说明.md', exact: true }).click();
  expect(confirmation).toContain('example-user/MiniMarkDisk/说明.md');
  expect(confirmation).toContain('无法在应用内撤销');
  expect(confirmation).toContain('本地文档');
  expect((await messages(page)).filter(message => message.action === 'delete')).toHaveLength(0);
  await expect(page.getByRole('button', { name: '打开 说明.md', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '删除文件 说明.md', exact: true })).toBeEnabled();
});

test('file delete sends the listed SHA and refreshes without closing the dialog', async ({ page }) => {
  await mockDelete(page);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除文件 说明.md', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开 说明.md', exact: true })).toHaveCount(0);
  await expect(page.locator('#cloud-status')).toHaveText('已删除：说明.md');
  await expect(page.locator('#cloud-dialog')).toBeVisible();
  const requests = await messages(page);
  expect(requests.filter(message => message.action === 'delete')).toEqual([expect.objectContaining({
    type: 'cloudRequest', action: 'delete', owner: 'example-user', path: '说明.md', sha: fileSha, entryType: 'file',
  })]);
  expect(requests.filter(message => message.action === 'list')).toHaveLength(2);
});

test('folder delete warns about all children and keeps opened dirty tabs locally', async ({ page }) => {
  await mockDelete(page, { opened: true });
  let confirmation = '';
  page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.accept(); });
  await page.getByRole('button', { name: '删除文件夹 资料', exact: true }).click();
  await expect(page.locator('#cloud-status')).toHaveText('已删除：资料');
  expect(confirmation).toContain('example-user/MiniMarkDisk/资料');
  expect(confirmation).toContain('全部子内容');
  expect(confirmation).toContain('未显示的文件类型');
  expect((await messages(page)).find(message => message.action === 'delete')).toMatchObject({ path: '资料', sha: folderSha, entryType: 'dir' });
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('#storage-mode')).toHaveText('本地文档');
  await page.getByRole('button', { name: '关闭云文档窗口', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toHaveText('Unsaved local draft');
  await expect(page.locator('#save-state')).toHaveText('未保存');
  await page.getByRole('tab', { name: '配置.yaml', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toHaveText('draft: true');
  await expect(page.locator('#save-state')).toHaveText('未保存');
  await expect(page.locator('#storage-mode')).toHaveText('本地文档');
});

for (const scenario of ['denied', 'mismatched'] as const) {
  test(`${scenario} deletion keeps the file visible and requires a fresh listing`, async ({ page }) => {
    await mockDelete(page, { failDelete: scenario === 'denied', wrongResponse: scenario === 'mismatched' });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '删除文件 说明.md', exact: true }).click();
    await expect(page.locator('#cloud-status')).toContainText(scenario === 'denied' ? '仓库拒绝删除' : '删除结果无法确认');
    await expect(page.getByRole('button', { name: '打开 说明.md', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '删除文件 说明.md', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '刷新云目录', exact: true }).click();
    await expect(page.getByRole('button', { name: '删除文件 说明.md', exact: true })).toBeEnabled();
  });
}

test('delete success followed by refresh failure reports success and blocks more deletes', async ({ page }) => {
  await mockDelete(page, { failRefresh: true });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除文件 说明.md', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText('已删除：说明.md。目录刷新失败');
  await expect(page.locator('#cloud-status')).not.toContainText('删除失败');
  await expect(page.getByRole('button', { name: '打开 说明.md', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除文件夹 资料', exact: true })).toBeDisabled();
});

test('save intent, missing SHA, busy and failed listing disable deletion', async ({ page }) => {
  await mockDelete(page, { failListAt: 2 });
  await expect(page.getByRole('button', { name: '删除文件 缺少版本.md', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存当前文档到云端', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除文件 说明.md', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '删除文件夹 资料', exact: true }).dispatchEvent('click');
  expect((await messages(page)).filter(message => message.action === 'delete')).toHaveLength(0);
  await page.getByRole('button', { name: '关闭云文档窗口', exact: true }).click();
  await page.locator('#cloud-documents').click();
  await expect(page.locator('#cloud-status')).toContainText('目录网络暂不可用');
  await expect(page.locator('.cloud-delete')).toHaveCount(0);
});

test('closing during a pending delete never claims the submitted request was undone', async ({ page }) => {
  await mockDelete(page, { delayed: true });
  await page.clock.install();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除文件 说明.md', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除文件夹 资料', exact: true })).toBeDisabled();
  await page.clock.fastForward(46000);
  await expect(page.locator('#cloud-status')).toHaveText('正在删除 说明.md…');
  await page.getByRole('button', { name: '关闭云文档窗口', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('关闭窗口不会撤销');
  await page.evaluate(() => (window as any).__finishDelete());
  await expect(page.locator('#cloud-dialog')).not.toBeVisible();
  expect((await messages(page)).filter(message => message.action === 'delete')).toHaveLength(1);
});

test('late delete publication preserves newer edits and flushes them before the debounce', async ({ page }) => {
  await mockDelete(page, { delayed: true, opened: true });
  await page.clock.install();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除文件夹 资料', exact: true }).click();
  await expect.poll(async () => (await messages(page)).filter(message => message.action === 'delete').length).toBe(1);
  await page.getByRole('button', { name: '关闭云文档窗口', exact: true }).click();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown 编辑器' });
  const latest = 'New text entered while cloud deletion is still finishing.';
  await editor.fill(latest);
  expect((await messages(page)).filter(message => message.type === 'edit')).toHaveLength(0);
  await page.evaluate(() => (window as any).__finishDelete());
  await expect(editor).toHaveText(latest);
  await expect(page.locator('#storage-mode')).toHaveText('本地文档');
  await expect(page.locator('#save-state')).toHaveText('未保存');
  const edits = (await messages(page)).filter(message => message.type === 'edit');
  expect(edits).toEqual([{ type: 'edit', documentId: 'active', revision: 4, text: latest }]);
  await page.clock.fastForward(200);
  expect((await messages(page)).filter(message => message.type === 'edit')).toHaveLength(1);
});

test('deletion times out at 180 seconds with uncertain-result wording', async ({ page }) => {
  await mockDelete(page, { delayed: true });
  await page.clock.install();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除文件 说明.md', exact: true }).click();
  await page.clock.fastForward(179000);
  await expect(page.locator('#cloud-status')).toHaveText('正在删除 说明.md…');
  await page.clock.fastForward(1000);
  await expect(page.locator('#cloud-status')).toHaveText('删除结果尚未确认，请刷新云目录后核对。');
  await expect(page.getByRole('button', { name: '删除文件 说明.md', exact: true })).toBeDisabled();
});

test('delete buttons stay separate and visible in a narrow directory list', async ({ page }, testInfo) => {
  await mockDelete(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('#cloud-entries button button').count()).toBe(0);
  const rows = await page.locator('.cloud-entry-row').evaluateAll(rows => rows.map(row => {
    const name = row.querySelector('.cloud-entry')!.getBoundingClientRect();
    const remove = row.querySelector('.cloud-delete')!.getBoundingClientRect();
    return { overlap: name.right > remove.left, visible: remove.right <= innerWidth, width: remove.width };
  }));
  for (const row of rows) {
    expect(row.overlap).toBe(false); expect(row.visible).toBe(true); expect(row.width).toBe(32);
  }
  await page.screenshot({ path: testInfo.outputPath('cloud-delete-390.png') });
});
