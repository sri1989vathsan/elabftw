/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

// Keyboard use of the "@" suggestion lists, for every box that has one (the
// comment and step boxes of entries, and the comment boxes of the to-do,
// project, orders and feedback boards): Up / Down move through the names,
// Tab takes the highlighted one (the first one if you have not moved), Escape
// leaves the list alone. One listener on the document, so it needs nothing from
// the individual components: it finds the list that sits next to the box, moves
// a highlight on it, and "clicks" the name exactly like the mouse does.

const LIST_SELECTOR = '.pm-mention-results, .orders-mention-results';
const ITEM_SELECTOR = '.pm-mention-result, .orders-resource-result';

const highlighted = new WeakMap<Element, { key: string; index: number }>();

function findList(field: Element): HTMLElement | null {
  let parent = field.parentElement;
  for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
    const list = parent.querySelector<HTMLElement>(LIST_SELECTOR);
    if (list && !list.hidden && list.querySelector(ITEM_SELECTOR)) {
      return list;
    }
  }
  return null;
}

function currentIndex(list: HTMLElement, items: HTMLElement[]): number {
  const key = items.map(item => item.textContent?.trim() ?? '').join('|');
  const state = highlighted.get(list);
  if (!state || state.key !== key) {
    highlighted.set(list, { key, index: 0 });
    return 0;
  }
  return Math.min(state.index, items.length - 1);
}

function paint(list: HTMLElement, items: HTMLElement[], index: number): void {
  items.forEach((item, i) => {
    item.classList.toggle('active', i === index);
    if (i === index) item.scrollIntoView({ block: 'nearest' });
  });
}

// typing starts the choice over: the first name is the one Tab takes again
document.addEventListener('input', event => {
  const field = event.target as Element;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  let parent = field.parentElement;
  for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
    parent.querySelectorAll<HTMLElement>(LIST_SELECTOR).forEach(list => highlighted.delete(list));
  }
});

document.addEventListener('keyup', event => {
  // after typing, show the first name as the one Tab would take
  const field = event.target as Element;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  if (['ArrowUp', 'ArrowDown', 'Tab', 'Shift'].includes(event.key)) return;
  // the list may appear a moment after the key (names are fetched first)
  [120, 500].forEach(delay => window.setTimeout(() => {
    const list = findList(field);
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    paint(list, items, currentIndex(list, items));
  }, delay));
});

document.addEventListener('keydown', event => {
  const field = event.target as Element;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  if (!['ArrowUp', 'ArrowDown', 'Tab'].includes(event.key) || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  const list = findList(field);
  if (!list) return;
  const items = Array.from(list.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
  let index = currentIndex(list, items);
  if (event.key === 'Tab') {
    event.preventDefault();
    const item = items[index];
    // the boards pick on click, the comment boxes of entries on mousedown
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    item.click();
    return;
  }
  event.preventDefault();
  index = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
  highlighted.set(list, { key: items.map(item => item.textContent?.trim() ?? '').join('|'), index });
  paint(list, items, index);
});
