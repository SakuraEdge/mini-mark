import { test, expect, type Page } from '@playwright/test';

interface MockOptions {
  authenticated?: boolean;
  configured?: boolean;
  repositoryExists?: boolean;
  cloud?: boolean;
  failListOnce?: boolean;
  failSaveOnce?: boolean;
  pendingLogin?: boolean;
}

async function mockHost(page: Page, options: MockOptions = {}) {
  await page.addInitScript(options => {
    let callback: (event: { data: any }) => void;
    let authenticated = options.authenticated ?? true;
    let repositoryExists = options.repositoryExists ?? true;
    let failList = options.failListOnce ?? false;
    let failSave = options.failSaveOnce ?? false;
    const messages: any[] = [];
    const documents: any[] = [{
      id: 'local', name: '随手记.md', text: 'Local draft', baseline: 'Local draft', revision: 0,
      cloud: options.cloud ? { owner: 'example-user', path: '随手记.md', sha: 'sha-initial', baseline: 'Local draft' } : null,
    }];
    let activeId = 'local';
    const entries: any[] = [
      { name: '笔记', path: '笔记', type: 'dir' },
      { name: '说明.md', path: '说明.md', type: 'file', sha: 'sha-readme', size: 256 },
      { name: '配置.yaml', path: '笔记/配置.yaml', type: 'file', sha: 'sha-yaml', size: 32 },
    ];
    const emit = (data: any) => queueMicrotask(() => callback({ data }));
    const publish = () => emit({
      type: 'workspace',
      tabs: documents.map(doc => ({ ...doc, dirty: doc.text !== doc.baseline })),
      document: { ...documents.find(doc => doc.id === activeId) },
    });
    localStorage.setItem('moye.updates.v1', JSON.stringify({ auto: false }));
    Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
      addEventListener: (_: string, listener: typeof callback) => { callback = listener; },
      postMessage: (message: any) => {
        messages.push(message);
        if (message.type === 'ready') { publish(); return; }
        if (message.type === 'cloudRequest') {
          const respond = (data: any) => emit({ type: 'cloudResponse', requestId: message.requestId, data });
          if (message.action === 'status') respond({ authenticated, configured: options.configured ?? true, login: authenticated ? 'example-user' : undefined });
          if (message.action === 'repository') respond({ exists: repositoryExists, private: true, login: 'example-user' });
          if (message.action === 'createRepository') { repositoryExists = true; respond({ exists: true, private: true, login: 'example-user' }); }
          if (message.action === 'startLogin') {
            if (options.configured === false) emit({ type: 'cloudResponse', requestId: message.requestId, error: '此版本尚未配置 GitHub 登录。' });
            else respond({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900 });
          }
          if (message.action === 'pollLogin') {
            if (options.pendingLogin) respond({ pending: true, interval: 10 });
            else { authenticated = true; respond({ authenticated: true, login: 'example-user' }); }
          }
          if (message.action === 'cancelLogin') respond({});
          if (message.action === 'logout') { authenticated = false; respond({}); }
          if (message.action === 'list') {
            if (failList) { failList = false; emit({ type: 'cloudResponse', requestId: message.requestId, error: 'GitHub 暂时无法连接。' }); }
            else respond({ entries: entries.filter(entry => entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/'))) === message.path) });
          }
          if (message.action === 'folder') {
            entries.push({ name: message.path.split('/').at(-1), path: message.path, type: 'dir' });
            respond({ path: message.path, sha: 'sha-folder' });
          }
          return;
        }
        const current = documents.find(doc => doc.id === message.documentId);
        if (current && typeof message.text === 'string') { current.text = message.text; current.revision = message.revision; }
        if (message.type === 'cloudOpen') {
          const text = message.cloudPath.endsWith('.yaml') ? 'enabled: true' : '# Cloud document';
          const document = { id: 'remote', name: message.cloudPath.split('/').at(-1), text, baseline: text, revision: 0, cloud: { owner: message.owner, path: message.cloudPath, sha: 'sha-remote', baseline: text } };
          documents.push(document); activeId = document.id; publish(); emit({ type: 'operationComplete' });
        }
        if (message.type === 'cloudBind' || message.type === 'save') {
          if (failSave) { failSave = false; emit({ type: 'error', message: '云端文件已修改，请先打开云端版本。' }); emit({ type: 'operationComplete' }); return; }
          if (message.type === 'cloudBind') current.cloud = { owner: message.owner, path: message.cloudPath, sha: 'sha-new', baseline: current.text };
          current.baseline = current.text;
          if (current.cloud) current.cloud.baseline = current.text;
          emit({ type: 'saved', documentId: current.id, name: current.name, text: current.text, cloud: current.cloud });
          emit({ type: 'operationComplete' });
        }
        if (message.type === 'cloudDetach') { current.cloud = null; publish(); emit({ type: 'operationComplete' }); }
      },
    } } });
    Object.assign(window, { __cloudMessages: messages });
  }, options);
  await page.goto('/');
  await expect(page.getByRole('tab', { name: '随手记.md', exact: true })).toBeVisible();
}

const cloudMessages = (page: Page) => page.evaluate(() => (window as any).__cloudMessages as any[]);
async function openCloud(page: Page) { await page.locator('#cloud-documents').click(); await expect(page.getByRole('dialog', { name: '云文档', exact: true })).toBeVisible(); }

test('login requires authorization and creates a private repository only after confirmation', async ({ page }) => {
  await mockHost(page, { authenticated: false, repositoryExists: false });
  await page.clock.install();
  await openCloud(page);
  await page.getByRole('button', { name: '登录 GitHub', exact: true }).click();
  await expect(page.locator('#cloud-user-code')).toHaveText('ABCD-1234');
  expect((await cloudMessages(page)).find(message => message.type === 'openExternal')?.url).toBe('https://github.com/login/device');
  expect((await cloudMessages(page)).some(message => message.action === 'createRepository')).toBe(false);
  let confirmation = '';
  page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.accept(); });
  await page.clock.fastForward(5000);
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '文件夹 笔记', exact: true })).toBeVisible();
  expect(confirmation).toContain('example-user');
  expect(confirmation).toContain('私有仓库 MiniMarkDisk');
  expect((await cloudMessages(page)).filter(message => message.action === 'createRepository')).toHaveLength(1);
});

test('missing OAuth configuration is explicit and closing login stops polling', async ({ page }) => {
  await mockHost(page, { authenticated: false, configured: false });
  await openCloud(page);
  await expect(page.locator('#cloud-status')).toHaveText('此版本尚未配置 GitHub 登录。');
  await page.getByRole('button', { name: '登录 GitHub', exact: true }).click();
  await expect(page.locator('#cloud-status')).toHaveText('此版本尚未配置 GitHub 登录。');
  await expect(page.getByRole('button', { name: '登录 GitHub', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '关闭云文档窗口', exact: true }).click();
  await expect(page.locator('#app')).not.toHaveClass(/transition-pending/);
});

test('pending authorization honors slower polling and cancellation', async ({ page }) => {
  await mockHost(page, { authenticated: false, pendingLogin: true });
  await page.clock.install();
  await openCloud(page);
  await page.getByRole('button', { name: '登录 GitHub', exact: true }).click();
  await expect(page.locator('#cloud-user-code')).toHaveText('ABCD-1234');
  await page.clock.fastForward(5000);
  await expect.poll(async () => (await cloudMessages(page)).filter(message => message.action === 'pollLogin').length).toBe(1);
  await page.clock.fastForward(5000);
  expect((await cloudMessages(page)).filter(message => message.action === 'pollLogin')).toHaveLength(1);
  await page.getByRole('button', { name: '关闭云文档窗口', exact: true }).click();
  await page.clock.fastForward(20000);
  expect((await cloudMessages(page)).filter(message => message.action === 'pollLogin')).toHaveLength(1);
  expect((await cloudMessages(page)).some(message => message.action === 'cancelLogin')).toBe(true);
  await openCloud(page);
  await expect(page.getByRole('button', { name: '登录 GitHub', exact: true })).toBeEnabled();
});

test('browse nested directory and open cloud file without replacing the local tab', async ({ page }) => {
  await mockHost(page);
  await openCloud(page);
  await page.getByRole('button', { name: '文件夹 笔记', exact: true }).click();
  await expect(page.locator('#cloud-breadcrumb')).toContainText('笔记');
  await page.getByRole('button', { name: '打开 配置.yaml', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: '配置.yaml', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('enabled: true');
  await expect(page.locator('#save-state')).toHaveText('已同步');
  await expect(page.locator('#storage-mode')).toHaveText('云文档');
  await expect(page.getByRole('dialog', { name: '云文档', exact: true })).not.toBeVisible();
  expect((await cloudMessages(page)).find(message => message.type === 'cloudOpen')).toMatchObject({ owner: 'example-user', cloudPath: '笔记/配置.yaml' });
});

test('save locally by default then choose cloud folder, bind and detach', async ({ page }) => {
  await mockHost(page);
  await page.keyboard.press('Control+s');
  expect((await cloudMessages(page)).some(message => message.type === 'cloudRequest')).toBe(false);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('menuitem', { name: '保存至云文档…', exact: true }).click();
  await expect(page.getByLabel('保存至云文档', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '文件夹 笔记', exact: true }).click();
  await page.getByLabel('文件名', { exact: true }).fill('新文档.md');
  await page.getByRole('button', { name: '保存到此目录', exact: true }).click();
  await expect(page.locator('#storage-mode')).toHaveText('云文档');
  expect((await cloudMessages(page)).find(message => message.type === 'cloudBind')).toMatchObject({ owner: 'example-user', cloudPath: '笔记/新文档.md', text: 'Local draft' });
  await openCloud(page);
  await expect(page.getByRole('checkbox', { name: '云文档', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: '云文档', exact: true }).uncheck();
  await expect(page.locator('#storage-mode')).toHaveText('本地文档');
  await expect(page.getByRole('checkbox', { name: '云文档', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录 GitHub', exact: true })).toBeVisible();
  expect((await cloudMessages(page)).filter(message => message.type === 'cloudDetach')).toHaveLength(1);
});

test('new folders and errors recover without locking subsequent controls', async ({ page }) => {
  await mockHost(page, { failListOnce: true, failSaveOnce: true });
  await openCloud(page);
  await expect(page.locator('#cloud-status')).toHaveText('GitHub 暂时无法连接。');
  await page.getByRole('button', { name: '刷新云目录', exact: true }).click();
  await page.getByRole('button', { name: '新建云文件夹', exact: true }).click();
  await page.getByLabel('文件夹名称', { exact: true }).fill('../错误目录');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText('不能包含目录分隔符');
  await page.getByLabel('文件夹名称', { exact: true }).fill('归档');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('button', { name: '文件夹 归档', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存当前文档到云端', exact: true }).click();
  await page.getByLabel('文件名', { exact: true }).fill('说明.md');
  await page.getByRole('button', { name: '保存到此目录', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText('已有同名文档');
  await page.getByLabel('文件名', { exact: true }).fill('新的文档.md');
  await page.getByRole('button', { name: '保存到此目录', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText('云端文件已修改');
  await expect(page.locator('#app')).not.toHaveClass(/transition-pending/);
  await expect(page.getByRole('button', { name: '保存到此目录', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存到此目录', exact: true }).click();
  await expect(page.locator('#storage-mode')).toHaveText('云文档');
});

test('failed cloud save preserves unsynced text and permits detaching then local save', async ({ page }) => {
  await mockHost(page, { cloud: true, failSaveOnce: true });
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown 编辑器' });
  await editor.fill('Unsynced edits must survive a conflict.');
  await expect(page.locator('#save-state')).toHaveText('未同步');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#toast')).toContainText('云端文件已修改');
  await expect(editor).toHaveText('Unsynced edits must survive a conflict.');
  await expect(page.locator('#save-state')).toHaveText('未同步');
  await expect(page.locator('#app')).not.toHaveClass(/transition-pending/);
  await openCloud(page);
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: '云文档', exact: true }).uncheck();
  await expect(page.locator('#storage-mode')).toHaveText('本地文档');
  await page.getByRole('button', { name: '关闭云文档窗口', exact: true }).click();
  await expect(editor).toHaveText('Unsynced edits must survive a conflict.');
  await expect(page.locator('#save-state')).toHaveText('未保存');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('menuitem', { name: /保存 Markdown/ }).click();
  await expect(page.locator('#save-state')).not.toHaveText('未保存');
  const saves = (await cloudMessages(page)).filter(message => message.type === 'save');
  expect(saves).toHaveLength(2);
  expect(saves[1].text).toBe('Unsynced edits must survive a conflict.');
});

test('cloud dialog fits desktop, minimum desktop and narrow viewport', async ({ page }, testInfo) => {
  await mockHost(page);
  await openCloud(page);
  await page.getByRole('button', { name: '保存当前文档到云端', exact: true }).click();
  for (const viewport of [{ width: 1180, height: 840 }, { width: 720, height: 520 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: '保存到此目录', exact: true })).toBeVisible();
    const bounds = await page.locator('#cloud-dialog').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { width: element.clientWidth, scroll: element.scrollWidth, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: testInfo.outputPath(`cloud-${viewport.width}.png`) });
  }
});
