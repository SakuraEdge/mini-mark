import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

interface WorkspaceMock { remembered?: boolean; cancelChoose?: boolean; failNested?: boolean; delayedNested?: boolean; noRoot?: boolean; delayedRestore?: boolean; failChoose?: boolean }
async function workspaceHost(page: Page, options: WorkspaceMock = {}) {
  await page.addInitScript(options => {
    let callback: (event: { data: any }) => void;
    const messages: any[] = [];
    const root = { id: 'root-1', name: 'Project', path: 'D:/Project' };
    let connected = !options.noRoot, activeId = 'draft', failNested = options.failNested ?? false;
    const documents: any[] = [{ id: 'draft', name: 'Draft.md', text: 'Keep this draft', baseline: '', revision: 1, autoName: false }];
    const emit = (data: unknown) => queueMicrotask(() => callback({ data }));
    const publish = () => emit({ type: 'workspace', tabs: documents.map(doc => ({ ...doc, dirty: doc.text !== doc.baseline })), document: { ...documents.find(doc => doc.id === activeId) } });
    const entries = [
      { name: 'docs', path: 'docs', type: 'directory', supported: true },
      { name: '.gitignore', path: '.gitignore', type: 'file', supported: false },
      { name: 'image.png', path: 'image.png', type: 'file', supported: false },
      { name: 'linked.md', path: 'linked.md', type: 'file', supported: false, link: true },
      { name: 'web.html', path: 'web.html', type: 'file', supported: true },
    ];
    if (options.remembered && localStorage.getItem('mini-mark.sidebar-mode.v1') === null) localStorage.setItem('mini-mark.sidebar-mode.v1', 'workspace');
    localStorage.setItem('moye.updates.rev.v1', JSON.stringify({ auto: false }));
    Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
      addEventListener: (_: string, listener: typeof callback) => { callback = listener; },
      postMessage: (message: any) => {
        messages.push(message);
        if (message.type === 'ready') publish();
        if (message.type === 'folderRequest') {
          const respond = (data: unknown) => emit({ type: 'folderResponse', requestId: message.requestId, data });
          const listing = () => {
            if (!connected) return { root: null, path: '', entries: [] };
            const path = message.path ?? '';
            if (path === 'docs') return { root, path, entries: [{ name: 'guide.md', path: 'docs/guide.md', type: 'file', supported: true }], nextOffset: null };
            if (message.offset === 500) return { root, path: '', entries: [{ name: 'last.yaml', path: 'last.yaml', type: 'file', supported: true }] };
            return { root, path: '', entries, nextOffset: 500 };
          };
          if (message.action === 'choose') {
            if (options.failChoose) emit({ type: 'folderResponse', requestId: message.requestId, error: '所选目录不可用。' });
            else if (options.cancelChoose) respond({ cancelled: true });
            else { connected = true; respond(listing()); }
          }
          if (message.action === 'restore') {
            const result = listing();
            if (options.delayedRestore) Object.assign(window, { __finishRestore: () => respond(result) });
            else respond(result);
          }
          if (message.action === 'close') { connected = false; respond({ root: null, path: '', entries: [] }); }
          if (message.action === 'list') {
            if (message.path === 'docs' && failNested) { failNested = false; emit({ type: 'folderResponse', requestId: message.requestId, error: '目录暂时不可用。' }); }
            else if (message.path === 'docs' && options.delayedNested) Object.assign(window, { __finishFolder: () => respond(listing()) });
            else respond(listing());
          }
          return;
        }
        const current = documents.find(doc => doc.id === message.documentId);
        if (current && typeof message.text === 'string') { current.text = message.text; current.revision = message.revision; }
        if (message.type === 'openWorkspaceFile') {
          const existing = documents.find(doc => doc.path === `D:/Project/${message.path}`);
          if (existing) activeId = existing.id;
          else {
            const text = message.path.endsWith('.html') ? '<h1>Not executed</h1>' : '# Workspace guide';
            const document = { id: `file-${documents.length}`, name: message.path.split('/').at(-1), path: `D:/Project/${message.path}`, text, baseline: text, revision: 0, autoName: false };
            documents.push(document); activeId = document.id;
          }
          publish(); emit({ type: 'operationComplete' });
        }
        if (message.type === 'activate') { activeId = message.targetId; publish(); emit({ type: 'operationComplete' }); }
        if (message.type === 'save') { current.baseline = current.text; emit({ type: 'saved', documentId: current.id, name: current.name, path: current.path, text: current.text }); emit({ type: 'operationComplete' }); }
        if (message.type === 'renameDocument') {
          const target = documents.find(doc => doc.id === message.targetId)!;
          target.name = message.name; target.path = `D:/Project/${message.name}`; publish(); emit({ type: 'operationComplete' });
        }
      },
    } } });
    Object.assign(window, { __folderMessages: messages });
  }, options);
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Draft.md', exact: true })).toBeVisible();
}
const messages = (page: Page) => page.evaluate(() => (window as any).__folderMessages as any[]);

test('single mode avoids startup directory access and choosing a folder enters lazy workspace mode', async ({ page }) => {
  await workspaceHost(page);
  expect((await messages(page)).some(message => message.type === 'folderRequest')).toBe(false);
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.getByRole('button', { name: '工作区文档', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#workspace-root-name')).toHaveText('Project');
  await expect(page.getByRole('treeitem', { name: '文件夹 docs', exact: true })).toBeVisible();
  expect((await messages(page)).filter(message => message.type === 'folderRequest').map(message => message.action)).toEqual(['choose']);
  await expect(page.getByRole('treeitem', { name: '文件 .gitignore', exact: true })).toBeDisabled();
  await expect(page.getByRole('treeitem', { name: '文件 image.png', exact: true })).toBeDisabled();
  await expect(page.getByRole('treeitem', { name: '文件 linked.md', exact: true })).toBeDisabled();
  await page.getByRole('treeitem', { name: '文件夹 docs', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: '文件 guide.md', exact: true })).toBeVisible();
  expect((await messages(page)).filter(message => message.action === 'list')).toEqual([expect.objectContaining({ rootId: 'root-1', path: 'docs', offset: 0 })]);
  await page.getByRole('button', { name: '加载更多 Project', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: '文件 last.yaml', exact: true })).toBeVisible();
  expect((await messages(page)).find(message => message.offset === 500)?.path).toBe('');
});

test('remembered workspace restores root without recursively reading subfolders', async ({ page }) => {
  await workspaceHost(page, { remembered: true });
  await expect(page.locator('#workspace-root-name')).toHaveText('Project');
  expect((await messages(page)).filter(message => message.type === 'folderRequest').map(message => message.action)).toEqual(['restore']);
  await page.getByRole('button', { name: '单文档', exact: true }).click();
  await expect(page.locator('#single-document-panel')).toBeVisible();
  await expect(page.locator('#workspace-document-panel')).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '单文档', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('cancelled folder selection preserves the previous root and close preserves all document tabs', async ({ page }) => {
  await workspaceHost(page, { remembered: true, cancelChoose: true });
  await expect(page.locator('#workspace-root-name')).toHaveText('Project');
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.locator('#workspace-root-name')).toHaveText('Project');
  await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await expect(page.locator('#workspace-status')).toHaveText('尚未打开文件夹');
  await expect(page.getByRole('tab', { name: 'Draft.md', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('Keep this draft');
});

test('opening a workspace file carries unsent edits and HTML stays source-only', async ({ page }) => {
  await workspaceHost(page, { remembered: true });
  await page.clock.install();
  await page.getByRole('textbox', { name: 'Markdown 编辑器' }).fill('Latest unsent draft');
  await page.getByRole('treeitem', { name: '文件 web.html', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('#document-format')).toHaveText('HTML');
  expect((await messages(page)).find(message => message.type === 'openWorkspaceFile')).toMatchObject({ documentId: 'draft', text: 'Latest unsent draft', rootId: 'root-1', path: 'web.html' });
  expect((await messages(page)).some(message => message.type === 'runHtml')).toBe(false);
  await page.getByRole('tab', { name: 'Draft.md', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toHaveText('Latest unsent draft');
});

test('directory error retries without freezing edits and stale loads cannot reopen a closed root', async ({ page }) => {
  await workspaceHost(page, { remembered: true, failNested: true, delayedNested: true });
  await page.getByRole('treeitem', { name: '文件夹 docs', exact: true }).click();
  await expect(page.locator('#workspace-status')).toContainText('目录暂时不可用');
  await expect(page.locator('#app')).not.toHaveClass(/transition-pending/);
  await page.getByRole('textbox', { name: 'Markdown 编辑器' }).fill('Editing remains available');
  await page.getByRole('button', { name: '重新读取目录', exact: true }).click();
  await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await page.evaluate(() => (window as any).__finishFolder());
  await expect(page.locator('#workspace-status')).toHaveText('尚未打开文件夹');
  await expect(page.getByRole('treeitem')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toHaveText('Editing remains available');
});

test('save and rename refresh visible folders without changing the active document', async ({ page }) => {
  await workspaceHost(page, { remembered: true });
  await page.getByRole('treeitem', { name: '文件 web.html', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await messages(page)).filter(message => message.action === 'list').length).toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'web.html', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('新文件名', { exact: true }).fill('renamed');
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'renamed.html', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await messages(page)).filter(message => message.action === 'list').length).toBeGreaterThan(1);
});

test('browser folder picker lists selected files and opens only supported text', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/workspace-tree', import.meta.url)));
  await expect(page.locator('#workspace-root-name')).toHaveText('workspace-tree');
  await expect(page.getByRole('treeitem', { name: '文件 program.bin', exact: true })).toBeDisabled();
  await page.getByRole('treeitem', { name: '文件夹 docs', exact: true }).click();
  await page.getByRole('treeitem', { name: '文件 note.md', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'note.md', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Markdown 编辑器' })).toContainText('Browser folder note');
});

test('workspace tree and sidebar mode fit desktop and narrow overlay', async ({ page }, testInfo) => {
  await workspaceHost(page, { remembered: true });
  await page.getByRole('treeitem', { name: '文件夹 docs', exact: true }).click();
  for (const width of [1180, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 390) await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
    await expect(page.locator('#workspace-tree')).toBeVisible();
    const bounds = await page.locator('#sidebar').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width); expect(bounds.right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${width}.png`) });
  }
});

test('choosing and closing invalidate late startup restoration', async ({ page }) => {
  await workspaceHost(page, { remembered: true, delayedRestore: true });
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.locator('#workspace-root-name')).toHaveText('Project');
  await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await page.evaluate(() => (window as any).__finishRestore());
  await expect(page.locator('#workspace-status')).toHaveText('尚未打开文件夹');
  await expect(page.getByRole('treeitem')).toHaveCount(0);
});

test('manual refresh invalidates collapsed child caches and choose errors are visible in single mode', async ({ page }) => {
  await workspaceHost(page, { failChoose: true });
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('所选目录不可用。');
  await expect(page.getByRole('button', { name: '单文档', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '工作区文档', exact: true }).click();
  await page.getByRole('treeitem', { name: '文件夹 docs', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: '文件 guide.md', exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: '文件夹 docs', exact: true }).click();
  await page.getByRole('button', { name: '刷新工作区', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新工作区', exact: true })).toBeEnabled();
  await page.getByRole('treeitem', { name: '文件夹 docs', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: '文件 guide.md', exact: true })).toBeVisible();
  expect((await messages(page)).filter(message => message.action === 'list' && message.path === 'docs')).toHaveLength(2);
});
