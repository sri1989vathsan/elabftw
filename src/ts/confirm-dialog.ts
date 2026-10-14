/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import i18next from './i18n';

/**
 * A confirmation drawn in the page, for places that used the browser's own
 * confirm() box: some browsers (including the one built into desktop apps)
 * block or auto-dismiss that box, which made "Delete" silently do nothing.
 */
export function askConfirm(message: string, confirmLabel = i18next.t('delete')): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog rounded border p-3';
    dialog.setAttribute('aria-label', message);
    const text = document.createElement('p');
    text.className = 'mb-3';
    text.textContent = message;
    const buttons = document.createElement('div');
    buttons.className = 'd-flex justify-content-end';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary mr-2';
    cancel.textContent = i18next.t('cancel');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn btn-danger';
    ok.textContent = confirmLabel;
    buttons.append(cancel, ok);
    dialog.append(text, buttons);
    document.body.append(dialog);
    const done = (answer: boolean): void => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    dialog.addEventListener('cancel', event => { event.preventDefault(); done(false); });
    dialog.showModal();
    cancel.focus();
  });
}
