export interface TextDialogOptions {
  title: string;
  label: string;
  value: string;
  confirm: string;
  validate(value: string): string;
  submit(value: string): Promise<void>;
  closed?(): void;
}

export function createTextDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'feature-dialog text-input-dialog';
  dialog.setAttribute('aria-labelledby', 'text-dialog-title');
  dialog.innerHTML = `<form>
    <header><h2 id="text-dialog-title"></h2></header>
    <label for="text-dialog-input"></label><input id="text-dialog-input" autocomplete="off" spellcheck="false">
    <p id="text-dialog-status" role="status" aria-live="polite"></p>
    <footer><button type="button" data-action="cancel">取消</button><button type="submit" class="primary"></button></footer>
  </form>`;
  document.body.append(dialog);
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
  const status = dialog.querySelector('#text-dialog-status')!;
  let options: TextDialogOptions | undefined;
  let busy = false;
  function setBusy(value: boolean) { busy = value; input.disabled = value; submit.disabled = value; cancel.disabled = value; }
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { options?.closed?.(); options = undefined; });
  dialog.querySelector('form')!.onsubmit = async event => {
    event.preventDefault();
    if (!options || busy) return;
    try {
      const value = options.validate(input.value);
      setBusy(true); status.textContent = '正在重命名…';
      await options.submit(value);
      dialog.close();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '操作失败。';
      input.setAttribute('aria-invalid', 'true');
    } finally { setBusy(false); }
  };
  return {
    open(next: TextDialogOptions) {
      if (dialog.open) return;
      options = next; input.value = next.value; status.textContent = ''; input.removeAttribute('aria-invalid');
      dialog.querySelector('h2')!.textContent = next.title;
      dialog.querySelector('label')!.textContent = next.label;
      submit.textContent = next.confirm;
      setBusy(false); dialog.showModal(); input.focus();
      const dot = input.value.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    },
  };
}
