/**
 * Shared accessibility helpers for the fork's hand-rolled dialogs and side
 * panels (none of which share a common base beyond SidePanel, and even that
 * doesn't cover the standalone overlay dialogs) -- focus trapping, focus
 * restoration, and reduced-motion detection, so each dialog/panel doesn't
 * have to reinvent them.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el === document.activeElement;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

/**
 * Call from a container's own 'keydown' listener. Keeps Tab/Shift+Tab
 * cycling within `container` instead of leaking focus to the page behind an
 * open dialog/panel.
 */
export function trapTabFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Snapshot the element to return focus to once a dialog/panel closes. */
export function captureFocus(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

/** Return focus to `target` if it's still attached, else no-op (never throws focus into the void). */
export function restoreFocus(target: HTMLElement | null): void {
  if (target && document.contains(target)) target.focus();
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
