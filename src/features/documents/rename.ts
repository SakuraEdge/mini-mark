import { PencilLine, createIcons } from 'lucide';
import { documentName } from '../../documents/naming';
import { createTextDialog } from '../../ui/text-dialog';
import '../../styles/document-actions.css';

interface Options {
  document(id: string): { name: string } | undefined;
  rename(id: string, name: string): Promise<void>;
  disabled(): boolean;
  restoreFocus(): void;
}

export function initializeRename(options: Options) {
  const menu = document.createElement('div');
  menu.className = 'popup-menu document-context-menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '文档操作');
  menu.innerHTML = '<button type="button" role="menuitem"><i data-lucide="pencil-line"></i><span>重命名</span></button>';
  document.body.append(menu);
  createIcons({ icons: { PencilLine }, root: menu });
  const rename = menu.querySelector<HTMLButtonElement>('button')!;
  const dialog = createTextDialog();
  let targetId = '';
  let restoreTarget: HTMLElement | undefined;
  function closeMenu(restore = false) {
    menu.hidden = true;
    if (restore) { if (restoreTarget?.isConnected) restoreTarget.focus(); else options.restoreFocus(); }
  }
  rename.onclick = () => {
    const target = options.document(targetId);
    if (!target || options.disabled()) { closeMenu(); return; }
    const id = targetId;
    closeMenu();
    dialog.open({
      title: '重命名文档', label: '新文件名', value: target.name, confirm: '重命名',
      validate: value => documentName(value, target.name),
      submit: value => options.rename(id, value),
      closed: () => options.restoreFocus(),
    });
  };
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); rename.focus(); }
    if (event.key === 'Tab') closeMenu();
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target as Node)) closeMenu(); });
  window.addEventListener('resize', () => closeMenu());
  function open(id: string, target: HTMLElement, x: number, y: number) {
    if (options.disabled() || !options.document(id) || document.querySelector('dialog[open]')) return;
    targetId = id; restoreTarget = target; menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    rename.focus();
  }
  return {
    bind(element: HTMLElement, id: () => string) {
      element.addEventListener('contextmenu', event => {
        event.preventDefault(); open(id(), element, event.clientX, event.clientY);
      });
      element.addEventListener('keydown', event => {
        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
        event.preventDefault();
        const rect = element.getBoundingClientRect(); open(id(), element, rect.left, rect.bottom);
      });
    },
  };
}
