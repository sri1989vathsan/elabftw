/**
 * The "What's new" popup after login. The server decides whether to draw it at all (templates/whats-new-popup.html);
 * this opens it, keeps keyboard focus inside (Bootstrap's modal), and stores what the user has seen per user on the server.
 * Any way of closing it (Got it, X, Esc, a click outside) counts as seen. It has no dimming layer, so the floating
 * "Back to" button and the reminder chip stay usable; a click outside the dialog closes it.
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import $ from 'jquery';
import { Api } from './Apiv2.class';

const ApiC = new Api();

function save(key: string, value: string | null): Promise<unknown> {
  const body: Record<string, string | number> = { action: 'set_user_pref', key, notifOnSaved: 0, notifOnError: 0 };
  if (value !== null) body.value = value;
  return ApiC.patch('experiments_folders', body).catch(() => { /* shown again next login at worst */ });
}

/** The switch in the user's settings (Settings > Appearance): on removes the opt-out, off sets it. */
export function initWhatsNewSetting(): void {
  const toggle = document.querySelector<HTMLInputElement>('[data-whats-new-popup-switch]');
  toggle?.addEventListener('change', () => {
    void ApiC.patch('experiments_folders', toggle.checked
      ? { action: 'set_user_pref', key: 'whats-new-popup-off', notifOnSaved: 1, notifOnError: 1 }
      : { action: 'set_user_pref', key: 'whats-new-popup-off', value: '1', notifOnSaved: 1, notifOnError: 1 });
  });
}

export function initWhatsNewPopup(): void {
  initWhatsNewSetting();
  const popup = document.getElementById('whatsNewPopup');
  if (!popup) return;
  let stored = false;
  const markSeen = (): Promise<unknown> => {
    if (stored) return Promise.resolve();
    stored = true;
    return save('whats-new-seen', JSON.stringify({ id: popup.dataset.newestId ?? '', date: popup.dataset.newestDate ?? '' }));
  };

  // never on top of another dialog that is already open
  if (document.querySelector('.modal.show')) return;

  $(popup).on('hide.bs.modal', () => { void markSeen(); });
  $(popup).on('shown.bs.modal', () => popup.querySelector<HTMLElement>('[data-whats-new-got-it]')?.focus());
  $(popup).modal({ backdrop: false, keyboard: true, focus: true });

  // click outside the dialog (there is no backdrop to catch it); other dialogs and floating helpers do not count
  document.addEventListener('mousedown', (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!target || !popup.classList.contains('show')) return;
    if (popup.querySelector('.modal-content')?.contains(target)) return;
    if (target.closest('.modal, .elabftw-back-button, .reminder-chip, .reminder-banner')) return;
    $(popup).modal('hide');
  });

  popup.addEventListener('click', (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'whats-new-popup-off') {
      event.preventDefault();
      stored = true;
      void Promise.all([
        save('whats-new-popup-off', '1'),
        save('whats-new-seen', JSON.stringify({ id: popup.dataset.newestId ?? '', date: popup.dataset.newestDate ?? '' })),
      ]);
      $(popup).modal('hide');
    } else if (target.dataset.action === 'whats-new-popup-more') {
      event.preventDefault();
      const href = (target as HTMLAnchorElement).href;
      void markSeen().then(() => { window.location.assign(href); });
    }
  });
}
