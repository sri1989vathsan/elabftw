/**
 * Wheel / trackpad / touch scrolling over a popup never moves the page behind it, even when the popup cannot scroll or has
 * reached its end. Outside a popup the page scrolls as usual (the body is NOT locked). One capture-phase listener on the
 * document: if the pointer is inside a popup root (POPUP_ROOTS, the one place that lists them) and nothing between the pointer
 * and that root can still scroll in the wheel's direction, the event is cancelled. CSS `overscroll-behavior: contain` on the
 * same roots (main.scss) covers the scrolling case without a script. The sidebar has its own lock (SidePanel.lockWheel).
 * A same-origin iframe inside a popup has its own document: wheel events there do not reach this listener.
 */
export const POPUP_ROOTS = [
  '.modal', '.dropdown-menu', '.popover', '.ui-autocomplete', '.ui-menu', '.ts-dropdown', '.tippy-box',
  '.tox-dialog', '.tox-menu', '.tox-pop', '.tox-collection', '.tox-silver-sink .tox-tooltip',
  '.jcontextmenu', '.jss_contextmenu', '.jdropdown-container', '.jpicker', '.jdropdown-content',
  '.inline-spreadsheet-overlay', '.elabftw-spreadsheet-editor-overlay', '.wp-dialog', '.wp-tooltip',
  '.pm-overlay', '.date-reference-overlay', '.command-palette-overlay', '.todo-detail-overlay',
  '.cal-modal-backdrop', '.cal-modal', '.cal-menu-panel', '.cal-menu',
  '.folder-popover', '.suggested-tags-popover', '.show-more-filters-popover', '.favorite-filter-overlay', '.filter-menu',
  '.toc-row-menu', '.shortcuts-dialog', '.pm-more-menu', '.orders-more-menu', '.pm-link-cards-menu', '.pmc-popup',
  '.html-tool-workspace', '.full-screen-overlay', '.cs-modal', '[data-popup-root]',
].join(',');

function canScroll(el: HTMLElement, vertical: boolean, delta: number): boolean {
  // cheap rejections first: no overflow room, no layout-reading style lookup
  if (vertical ? el.scrollHeight <= el.clientHeight + 1 : el.scrollWidth <= el.clientWidth + 1) return false;
  const style = getComputedStyle(el);
  const overflow = vertical ? style.overflowY : style.overflowX;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  return vertical
    ? (delta < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    : (delta < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
}

/** true when something from the target up to the popup root can still scroll that way */
function somethingScrolls(target: Element, root: Element, vertical: boolean, delta: number): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el instanceof HTMLElement && canScroll(el, vertical, delta)) return true;
    if (el === root) break;
  }
  return false;
}

let touchStart: { x: number; y: number } | null = null;

export function installPopupWheelLock(): void {
  document.addEventListener('wheel', (event: WheelEvent) => {
    // ctrl + wheel is browser zoom
    if (event.ctrlKey || (event.deltaX === 0 && event.deltaY === 0) || !(event.target instanceof Element)) return;
    const root = event.target.closest(POPUP_ROOTS);
    if (!root) return;
    const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
    if (somethingScrolls(event.target, root, vertical, vertical ? event.deltaY : event.deltaX)) return;
    // a popup inside a popup (a menu in a modal): the outer one may still scroll
    const outer = root.parentElement?.closest(POPUP_ROOTS);
    if (outer && somethingScrolls(root.parentElement as Element, outer, vertical, vertical ? event.deltaY : event.deltaX)) return;
    event.preventDefault();
  }, { passive: false, capture: true });

  document.addEventListener('touchstart', (event: TouchEvent) => {
    const t = event.touches[0];
    touchStart = event.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', (event: TouchEvent) => {
    const t = event.touches[0];
    if (!touchStart || event.touches.length !== 1 || !t || !(event.target instanceof Element)) return;
    const root = event.target.closest(POPUP_ROOTS);
    if (!root) return;
    const dx = touchStart.x - t.clientX;
    const dy = touchStart.y - t.clientY;
    if (dx === 0 && dy === 0) return;
    const vertical = Math.abs(dy) >= Math.abs(dx);
    if (somethingScrolls(event.target, root, vertical, vertical ? dy : dx)) return;
    if (event.cancelable) event.preventDefault();
  }, { passive: false, capture: true });
}
