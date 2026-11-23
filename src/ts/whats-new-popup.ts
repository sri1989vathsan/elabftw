/**
 * The "What's new" popup after login. The server decides whether to draw it at all (templates/whats-new-popup.html);
 * this opens it, keeps keyboard focus inside (Bootstrap's modal), and stores what the user has seen per user on the server.
 * Any way of closing it (Got it, X, Esc, a click outside) counts as seen. It has no dimming layer, so the floating
 * "Back to" button and the reminder chip stay usable; a click outside the dialog closes it.
 * The "What's new" button of the navbar ([data-whats-new-open]) fetches the same popup on demand (whats-new.php?popup=1): unseen entries
 * first, then the latest seen ones. Opened that way, only "Got it" (with unseen entries on show) stores the seen state.
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

const hideDot = (): void => {
  document.querySelectorAll<HTMLElement>('[data-whats-new-dot]').forEach(dot => { dot.hidden = true; });
};

/** Pages side by side: swipe or scroll sideways (scroll snapping does the rest), or use the arrows, the dots or the left/right keys. */
function wirePager(popup: HTMLElement): void {
  const track = popup.querySelector<HTMLElement>('[data-whats-new-pages]');
  const nav = popup.querySelector<HTMLElement>('[data-whats-new-nav]');
  if (!track || !nav) return;
  const pages = Array.from(track.children) as HTMLElement[];
  const dots = Array.from(nav.querySelectorAll<HTMLElement>('[data-whats-new-dot-index]'));
  const prev = nav.querySelector<HTMLButtonElement>('[data-whats-new-prev]');
  const next = nav.querySelector<HTMLButtonElement>('[data-whats-new-next]');
  const counter = nav.querySelector<HTMLElement>('[data-whats-new-counter]');
  const current = (): number => Math.max(0, Math.min(pages.length - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
  const update = (): void => {
    const index = current();
    dots.forEach((dot, i) => { dot.classList.toggle('active', i === index); dot.setAttribute('aria-current', i === index ? 'true' : 'false'); });
    if (prev) prev.disabled = index === 0;
    if (next) next.disabled = index === pages.length - 1;
    if (counter) counter.textContent = `${index + 1} / ${pages.length}`;
    pages.forEach((page, i) => { page.toggleAttribute('inert', i !== index); });
  };
  const goTo = (index: number): void => {
    const target = Math.max(0, Math.min(pages.length - 1, index));
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left: target * track.clientWidth, behavior: calm ? 'auto' : 'smooth' });
  };
  track.addEventListener('scroll', () => { window.requestAnimationFrame(update); }, { passive: true });
  prev?.addEventListener('click', () => { goTo(current() - 1); });
  next?.addEventListener('click', () => { goTo(current() + 1); });
  dots.forEach((dot, i) => dot.addEventListener('click', () => { goTo(i); }));
  popup.addEventListener('keydown', (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey || target.closest('input, textarea, select')) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); goTo(current() + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(current() - 1); }
  });
  update();
}

function wirePopup(popup: HTMLElement): void {
  wirePager(popup);
  const onDemand = popup.dataset.onDemand === '1';
  let stored = false;
  const markSeen = (): Promise<unknown> => {
    if (stored) return Promise.resolve();
    stored = true;
    hideDot();
    return save('whats-new-seen', JSON.stringify({ id: popup.dataset.newestId ?? '', date: popup.dataset.newestDate ?? '' }));
  };

  if (onDemand) {
    popup.querySelector('[data-whats-new-got-it]')?.addEventListener('click', () => {
      if (Number(popup.dataset.unseen ?? 0) > 0) void markSeen();
    });
  } else {
    $(popup).on('hide.bs.modal', () => { void markSeen(); });
  }
  $(popup).on('shown.bs.modal', () => popup.querySelector<HTMLElement>('[data-whats-new-got-it]')?.focus());
  $(popup).on('hidden.bs.modal', () => { if (onDemand) popup.remove(); });
  $(popup).modal({ backdrop: false, keyboard: true, focus: true });

  popup.addEventListener('click', (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'whats-new-popup-off') {
      event.preventDefault();
      stored = true;
      hideDot();
      void Promise.all([
        save('whats-new-popup-off', '1'),
        save('whats-new-seen', JSON.stringify({ id: popup.dataset.newestId ?? '', date: popup.dataset.newestDate ?? '' })),
      ]);
      $(popup).modal('hide');
    } else if (target.dataset.action === 'whats-new-popup-more') {
      event.preventDefault();
      const href = (target as HTMLAnchorElement).href;
      // on demand the user may not have acknowledged anything: just open the list
      void (onDemand ? Promise.resolve() : markSeen()).then(() => { window.location.assign(href); });
    }
  });
}

/** The navbar button: draws the popup for the entries to show now, whatever was dismissed before. */
function initWhatsNewButton(): void {
  const buttons = document.querySelectorAll<HTMLElement>('[data-whats-new-open]');
  if (buttons.length === 0) return;
  let loading = false;
  const open = async (event: Event): Promise<void> => {
    event.preventDefault();
    const current = document.getElementById('whatsNewPopup');
    if (loading || document.querySelector('.modal.show')) {
      // already on screen: bring it to the front instead of stacking a second one
      current?.querySelector<HTMLElement>('[data-whats-new-got-it]')?.focus();
      return;
    }
    loading = true;
    try {
      const response = await fetch('whats-new.php?popup=1', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const html = response.ok ? await response.text() : '';
      if (html.trim() === '') {
        window.location.assign('whats-new.php');
        return;
      }
      current?.remove();
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const popup = holder.querySelector<HTMLElement>('#whatsNewPopup');
      if (!popup) return;
      document.body.appendChild(popup);
      wirePopup(popup);
    } catch {
      window.location.assign('whats-new.php');
    } finally {
      loading = false;
    }
  };
  buttons.forEach(button => button.addEventListener('click', event => { void open(event); }));
}

export function initWhatsNewPopup(): void {
  initWhatsNewSetting();
  initWhatsNewButton();

  // click outside the dialog (there is no backdrop to catch it); other dialogs and floating helpers do not count
  document.addEventListener('mousedown', (event: MouseEvent) => {
    const popup = document.getElementById('whatsNewPopup');
    const target = event.target as Element | null;
    if (!popup || !target || !popup.classList.contains('show')) return;
    if (popup.querySelector('.modal-content')?.contains(target)) return;
    if (target.closest('.modal, .elabftw-back-button, .reminder-chip, .reminder-banner, [data-whats-new-open]')) return;
    $(popup).modal('hide');
  });

  const popup = document.getElementById('whatsNewPopup');
  // never on top of another dialog that is already open
  if (!popup || document.querySelector('.modal.show')) return;
  wirePopup(popup);
}
