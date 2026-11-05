/**
 * A "Back" button for internal links: after following a link in the text of an entry (to another entry, or to
 * another place in the same one, e.g. through the table of contents), a button at the bottom left returns to the
 * place the link was clicked, with the page scrolled to where it was.
 *
 * The places are kept in sessionStorage (this tab only). A place is shown as the button only while the page is the
 * one the link led to; as soon as the user goes anywhere else the places are dropped, so the button never offers
 * a return from an unrelated page. Links opened in a new tab or window are not followed here and are ignored.
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import i18next from './i18n';

const STACK_KEY = 'elabftw-back-stack';
const RESTORE_KEY = 'elabftw-back-restore';
const MAX_PLACES = 10;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
// links in the menus and the footer are ordinary navigation; every other link (entry text, linked entries, steps,
// the table of contents, the project boards, lists, the to-do panel) leads somewhere the user may want to come back from
const NAVIGATION_AREAS = 'nav, footer, #sidepanel-buttons, .dropdown-menu, .modal, .pagination, #elabftwBackButton';

export interface Place {
  /** the page and position the link was clicked on (address without the hash) */
  url: string;
  y: number;
  label: string;
  /** where the link led: address without the hash */
  target: string;
  at: number;
}

/** The address without the part after #, so that two positions in one page compare equal. */
export function withoutHash(url: string, base: string): string {
  try {
    const parsed = new URL(url, base);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return '';
  }
}

/** A link that only changes a list's filter, sort or page (same page, same entry) is not a trip somewhere else. */
export function leadsToAnotherPlace(to: string, from: string): boolean {
  try {
    const a = new URL(to, from);
    const b = new URL(from);
    if (a.pathname !== b.pathname) return true;
    if (a.hash !== '' && a.hash !== b.hash) return true;
    return (a.searchParams.get('id') ?? '') !== (b.searchParams.get('id') ?? '');
  } catch {
    return false;
  }
}

/** Whether a click on this link leaves a place to come back to (same-site links only, ordinary clicks only). */
export function isFollowableLink(link: { href: string; target?: string; hasAttribute?: (name: string) => boolean }, page: string, event: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
  if (link.target && link.target !== '_self') return false;
  if (link.hasAttribute?.('download')) return false;
  try {
    const to = new URL(link.href, page);
    const from = new URL(page);
    if (to.origin !== from.origin || !/^https?:$/.test(to.protocol)) return false;
    // a bare "#" or javascript-style anchor does not go anywhere
    return !(to.pathname === from.pathname && to.search === from.search && to.hash === '');
  } catch {
    return false;
  }
}

/** The places still worth offering from this page: drops old ones, and everything when the page is not where the last link led. */
export function placesForPage(stack: Place[], page: string, now: number): Place[] {
  const fresh = stack.filter(place => now - place.at < MAX_AGE_MS).slice(-MAX_PLACES);
  const last = fresh[fresh.length - 1];
  return last && last.target === withoutHash(page, page) ? fresh : [];
}

function readStack(): Place[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(STACK_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((p): p is Place => typeof p?.url === 'string' && typeof p.y === 'number' && typeof p.target === 'string') : [];
  } catch {
    return [];
  }
}

function writeStack(stack: Place[]): void {
  try {
    if (stack.length === 0) window.sessionStorage.removeItem(STACK_KEY);
    else window.sessionStorage.setItem(STACK_KEY, JSON.stringify(stack.slice(-MAX_PLACES)));
  } catch {
    // storage may be unavailable; the button is then simply not offered
  }
}

function pageLabel(): string {
  // the entry's own title; the first h1 on the page is the name of the section ("Experiments")
  const heading = (document.getElementById('documentTitle') ?? document.querySelector('h1')) as HTMLElement | null;
  const raw = (heading?.innerText || document.title || '').replace(/\s+/g, ' ').trim();
  return (raw || window.location.pathname).slice(0, 60);
}

/** After arriving back on a page, put the scroll where it was; layout may still be growing, so try for a moment. */
function restoreScrollIfRequested(): void {
  let wanted: { url: string; y: number } | null = null;
  try {
    wanted = JSON.parse(window.sessionStorage.getItem(RESTORE_KEY) ?? 'null');
    window.sessionStorage.removeItem(RESTORE_KEY);
  } catch {
    wanted = null;
  }
  if (!wanted || wanted.url !== withoutHash(window.location.href, window.location.href)) return;
  const y = wanted.y;
  let tries = 0;
  const attempt = (): void => {
    window.scrollTo({ top: y });
    tries++;
    if (Math.abs(window.scrollY - y) > 4 && tries < 20) window.setTimeout(attempt, 100);
  };
  attempt();
}

function render(): void {
  document.getElementById('elabftwBackButton')?.remove();
  const here = window.location.href;
  const places = placesForPage(readStack(), here, Date.now());
  if (places.length === 0) {
    writeStack([]);
    return;
  }
  writeStack(places);
  const place = places[places.length - 1];
  const bar = document.createElement('div');
  bar.id = 'elabftwBackButton';
  bar.className = 'elabftw-back-button';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'elabftw-back-button-go';
  back.title = i18next.t('Back to the place you clicked the link');
  back.textContent = `← ${i18next.t('Back to {{name}}', { name: place.label })}`;
  back.addEventListener('click', () => {
    const rest = readStack().slice(0, -1);
    writeStack(rest);
    if (place.url === withoutHash(here, here)) {
      // same page: only the position changes
      window.scrollTo({ top: place.y });
      render();
      return;
    }
    try {
      window.sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ url: place.url, y: place.y }));
    } catch {
      // the page then opens at its top
    }
    window.location.assign(place.url);
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'elabftw-back-button-close';
  close.setAttribute('aria-label', i18next.t('Close'));
  close.title = i18next.t('Close');
  close.textContent = '×';
  close.addEventListener('click', () => {
    writeStack([]);
    bar.remove();
  });
  bar.append(back, close);
  document.body.appendChild(bar);
}

export function initBackToLink(): void {
  restoreScrollIfRequested();
  render();
  // before the click does anything, so the position is still the one the user was looking at
  document.addEventListener('click', event => {
    const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    // the table of contents entries are handled below
    if (!link || link.classList.contains('toc-link') || link.closest(NAVIGATION_AREAS) || !leadsToAnotherPlace(link.href, window.location.href) || !isFollowableLink(link, window.location.href, event)) return;
    const stack = readStack();
    const here = withoutHash(window.location.href, window.location.href);
    stack.push({ url: here, y: Math.round(window.scrollY), label: pageLabel(), target: withoutHash(link.href, window.location.href), at: Date.now() });
    writeStack(stack);
    // in-page links do not reload, so the button has to be drawn now
    if (withoutHash(link.href, window.location.href) === here) window.setTimeout(render, 0);
  }, true);
  // the table of contents scrolls the page without a link to follow
  document.addEventListener('click', event => {
    const toc = (event.target as Element | null)?.closest?.('.toc-link');
    if (!toc || event.button !== 0) return;
    const stack = readStack();
    const here = withoutHash(window.location.href, window.location.href);
    stack.push({ url: here, y: Math.round(window.scrollY), label: pageLabel(), target: here, at: Date.now() });
    writeStack(stack);
    window.setTimeout(render, 0);
  }, true);
}
