/** Lightweight table collapse behavior shared by TinyMCE and rendered entity bodies. */

export const EDITOR_COLLAPSED_ATTRIBUTE = 'data-mce-elabftw-collapsed';
export const VIEW_COLLAPSED_ATTRIBUTE = 'data-elabftw-collapsed';

function getCornerCell(table: HTMLTableElement): HTMLTableCellElement | null {
  const firstRow = table.tHead?.rows[0]
    ?? table.tBodies[0]?.rows[0]
    ?? table.tFoot?.rows[0]
    ?? table.rows[0];
  return firstRow?.cells[0] ?? null;
}

/**
 * Add a delegated collapse toggle to every table below root. The state is kept
 * in a transient attribute, so collapsing a table never rewrites its contents.
 */
export function installTableCollapse(
  root: HTMLElement,
  collapsedAttribute = VIEW_COLLAPSED_ATTRIBUTE,
  beforeToggle?: (table: HTMLTableElement) => void,
): () => void {
  const onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    const table = target?.closest?.('table') as HTMLTableElement | null;
    if (!table || !root.contains(table)) return;

    const cornerCell = getCornerCell(table);
    const bounds = cornerCell?.getBoundingClientRect();
    if (!bounds || !cornerCell?.contains(target)) return;
    const inToggle = event.clientX >= bounds.left
      && event.clientX <= bounds.left + 26
      && event.clientY >= bounds.top
      && event.clientY <= bounds.top + 26;
    if (!inToggle) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    beforeToggle?.(table);
    table.toggleAttribute(collapsedAttribute, !table.hasAttribute(collapsedAttribute));
  };

  root.addEventListener('mousedown', onMouseDown, true);
  return () => root.removeEventListener('mousedown', onMouseDown, true);
}

