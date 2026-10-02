/** Preserve live spreadsheet nodes while TinyMCE restores only the prose. */
const sheetSelector = 'table.elabftw-spreadsheet';
const spacerSelector = '[data-elabftw-spreadsheet-spacer]';
const proseChildren = (parent: Element): Element[] => Array.from(parent.children)
  .filter(child => !child.matches(`${sheetSelector}, ${spacerSelector}`));

interface TablePosition {
  table: HTMLTableElement;
  parentPath: number[];
  index: number;
  previous: string | null;
  next: string | null;
}

export function captureSpreadsheetPositions(body: HTMLElement): TablePosition[] {
  return Array.from(body.querySelectorAll<HTMLTableElement>(sheetSelector)).map(table => {
    const parent = table.parentElement!;
    const siblings = proseChildren(parent);
    const index = Array.from(parent.children).slice(0, Array.from(parent.children).indexOf(table))
      .filter(child => siblings.includes(child)).length;
    const parentPath: number[] = [];
    let ancestor = parent;
    while (ancestor !== body && ancestor.parentElement) {
      parentPath.unshift(proseChildren(ancestor.parentElement).indexOf(ancestor));
      ancestor = ancestor.parentElement;
    }
    return {
      table, parentPath, index,
      previous: siblings[index - 1]?.outerHTML ?? null,
      next: siblings[index]?.outerHTML ?? null,
    };
  });
}

export function restoreSpreadsheetPositions(body: HTMLElement, positions: TablePosition[]): void {
  // Never union historical IDs with live IDs: snapshots may predate UID
  // assignment or contain tables explicitly deleted since that snapshot.
  body.querySelectorAll(`${sheetSelector}, ${spacerSelector}`).forEach(node => node.remove());
  // Resolve slots before inserting anything, so adjacent tables cannot
  // change one another's index. Inserting in document order preserves it.
  const slots = positions.map(position => {
    let parent: Element = body;
    for (const index of position.parentPath) {
      const child = proseChildren(parent)[index];
      if (!child) break;
      parent = child;
    }
    const children = proseChildren(parent);
    const uniqueMatch = (html: string | null): Element | undefined => {
      const matches = html === null ? [] : children.filter(child => child.outerHTML === html);
      return matches.length === 1 ? matches[0] : undefined;
    };
    const next = uniqueMatch(position.next);
    const previous = uniqueMatch(position.previous);
    const index = next ? children.indexOf(next)
      : previous ? children.indexOf(previous) + 1 : Math.min(position.index, children.length);
    return { parent, reference: children[index] ?? null, table: position.table };
  });
  slots.forEach(({ parent, reference, table }) => parent.insertBefore(table, reference));
}
