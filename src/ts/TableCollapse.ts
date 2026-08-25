/** Lightweight table collapse behavior shared by TinyMCE and rendered entity bodies. */

export const EDITOR_COLLAPSED_ATTRIBUTE = 'data-mce-elabftw-collapsed';
export const VIEW_COLLAPSED_ATTRIBUTE = 'data-elabftw-collapsed';
export const TABLE_COLLAPSE_BUTTON_CLASS = 'elabftw-table-collapse-toggle';

/**
 * Add a delegated collapse toggle to every table below root. The state is kept
 * in a transient attribute, so collapsing a table never rewrites its contents.
 */
export function installTableCollapse(
  root: HTMLElement,
  collapsedAttribute = VIEW_COLLAPSED_ATTRIBUTE,
  beforeToggle?: (table: HTMLTableElement) => void,
): () => void {
  const createButton = (table: HTMLTableElement): void => {
    const existing = table.previousElementSibling as HTMLElement | null;
    if (existing?.classList.contains(TABLE_COLLAPSE_BUTTON_CLASS)) return;

    const button = root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = TABLE_COLLAPSE_BUTTON_CLASS;
    button.contentEditable = 'false';
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-label', 'Collapse table');
    button.title = 'Collapse table';
    button.textContent = '▾';
    // TinyMCE excludes the control itself while retaining the adjacent table.
    if (collapsedAttribute === EDITOR_COLLAPSED_ATTRIBUTE) {
      button.setAttribute('data-mce-bogus', 'all');
    }
    table.before(button);
  };

  const ensureButtons = (): void => {
    root.querySelectorAll<HTMLTableElement>('table').forEach(createButton);
  };

  const getButton = (event: Event): HTMLButtonElement | null => {
    const target = event.target as Element | null;
    return target?.closest?.(`button.${TABLE_COLLAPSE_BUTTON_CLASS}`) as HTMLButtonElement | null;
  };

  const onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !getButton(event)) return;
    // Keep TinyMCE from turning a click on the transient control into a text
    // or table selection. The following click event performs the toggle.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const onClick = (event: MouseEvent): void => {
    const button = getButton(event);
    if (!button || !root.contains(button)) return;
    const table = button.nextElementSibling as HTMLTableElement | null;
    if (!table?.matches('table')) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    beforeToggle?.(table);
    // Legacy unwrapping can move the table; keep the transient control beside it.
    if (button.nextElementSibling !== table) table.before(button);
    const collapsed = !table.hasAttribute(collapsedAttribute);
    table.toggleAttribute(collapsedAttribute, collapsed);
    button.textContent = collapsed ? '▸' : '▾';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand table' : 'Collapse table');
    button.title = collapsed ? 'Expand table' : 'Collapse table';
  };

  ensureButtons();
  // TinyMCE tables live inside an iframe. Use that document's constructor so
  // table insertion and replacement are observed reliably in every browser.
  const MutationObserverConstructor = root.ownerDocument.defaultView?.MutationObserver
    ?? MutationObserver;
  const observer = new MutationObserverConstructor(ensureButtons);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener('mousedown', onMouseDown, true);
  root.addEventListener('click', onClick, true);
  return () => {
    observer.disconnect();
    root.removeEventListener('mousedown', onMouseDown, true);
    root.removeEventListener('click', onClick, true);
  };
}
