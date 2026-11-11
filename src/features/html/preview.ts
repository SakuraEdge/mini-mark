import { createIcons, X, RotateCw } from 'lucide';

export const htmlTemplate = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>新页面</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 40px; }
  </style>
</head>
<body>
  <h1>新页面</h1>
</body>
</html>
`;

export function openBrowserPreview(text: string) {
  document.querySelector<HTMLDialogElement>('#html-preview-dialog')?.close();
  const dialog = document.createElement('dialog');
  dialog.id = 'html-preview-dialog'; dialog.className = 'feature-dialog html-preview-dialog';
  dialog.setAttribute('aria-label', 'HTML 运行预览');
  dialog.innerHTML = '<header><h2>HTML 运行预览</h2><button class="icon-button" title="重新运行" aria-label="重新运行"><i data-lucide="rotate-cw"></i></button><button class="icon-button" title="关闭预览" aria-label="关闭预览"><i data-lucide="x"></i></button></header>';
  const frame = document.createElement('iframe');
  frame.title = 'HTML 运行页面';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.referrerPolicy = 'no-referrer';
  // An opaque origin prevents scripts from reaching the editor, storage or native bridge.
  frame.srcdoc = text;
  dialog.append(frame); document.body.append(dialog);
  dialog.querySelector('[aria-label="重新运行"]')!.addEventListener('click', () => { frame.srcdoc = text; });
  dialog.querySelector('[aria-label="关闭预览"]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { frame.remove(); dialog.remove(); });
  createIcons({ icons: { X, RotateCw }, root: dialog });
  dialog.showModal();
}
