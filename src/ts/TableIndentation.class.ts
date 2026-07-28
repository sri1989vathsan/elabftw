/**
 * @author eLabFTW contributors
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

import type { Editor } from 'tinymce/tinymce';

// Match the browser/TinyMCE list indentation step so tables line up with bullets.
const INDENT_STEP_REM = 2.5;
const MAX_INDENT_LEVEL = 8;
const INDENT_WRAPPER_CLASS = 'elabftw-table-indent';

function closestTable(node: Node | null | undefined): HTMLTableElement | null {
  // TinyMCE's editable body can live in an iframe, so avoid instanceof checks
  // against the parent window's Element constructor.
  const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
  return element?.closest('table') as HTMLTableElement | null;
}

function tableFromSelection(editor: Editor): HTMLTableElement | null {
  const range = editor.selection.getRng();
  const candidates = [
    editor.selection.getNode(),
    editor.selection.getStart(),
    editor.selection.getEnd(),
    range.commonAncestorContainer,
  ];
  for (const candidate of candidates) {
    const table = closestTable(candidate);
    if (table) return table;
  }

  // TinyMCE marks cells during a multi-cell selection. In that state the
  // selection's common ancestor can be tbody/table/body rather than a cell.
  const selectedCell = editor.getBody().querySelector(
    'td[data-mce-selected],th[data-mce-selected]',
  );
  return closestTable(selectedCell);
}

function indentWrapper(table: HTMLTableElement): HTMLDivElement | null {
  const wrapper = table.parentElement;
  return wrapper?.classList.contains(INDENT_WRAPPER_CLASS)
    ? wrapper as HTMLDivElement
    : null;
}

function rootFontSize(table: HTMLTableElement): number {
  const view = table.ownerDocument.defaultView;
  const root = table.ownerDocument.documentElement;
  return Number.parseFloat(view?.getComputedStyle(root).fontSize ?? '16') || 16;
}

function legacyIndentLevel(table: HTMLTableElement): number {
  const margin = table.style.marginLeft.trim();
  let indent = 0;
  if (margin.endsWith('rem')) {
    indent = Number.parseFloat(margin) || 0;
  } else if (margin.endsWith('px')) {
    indent = (Number.parseFloat(margin) || 0) / rootFontSize(table);
  }
  return Math.max(0, Math.min(MAX_INDENT_LEVEL, Math.round(indent / INDENT_STEP_REM)));
}

function currentIndentLevel(table: HTMLTableElement): number {
  const wrapper = indentWrapper(table);
  if (!wrapper) return legacyIndentLevel(table);
  const storedLevel = Number.parseInt(wrapper.dataset.indentLevel ?? '', 10);
  if (Number.isInteger(storedLevel)) {
    return Math.max(0, Math.min(MAX_INDENT_LEVEL, storedLevel));
  }
  return legacyIndentLevel(wrapper.querySelector('table') ?? table);
}

export default class TableIndentation {
  private lastSelectedTable: HTMLTableElement | null = null;

  constructor(private readonly editor: Editor) {}

  /**
   * Track NodeChange while the editor has focus so toolbar clicks can safely
   * act on the table that contained the selection immediately beforehand.
   */
  trackSelectedTable(node?: Node | null): HTMLTableElement | null {
    const table = node === undefined ? tableFromSelection(this.editor) : closestTable(node);
    this.lastSelectedTable = table;
    return table;
  }

  indentSelectedTable(): void {
    this.adjustSelectedTable(INDENT_STEP_REM);
  }

  outdentSelectedTable(): void {
    this.adjustSelectedTable(-INDENT_STEP_REM);
  }

  canOutdent(table: HTMLTableElement | null = this.getSelectedTable()): boolean {
    return Boolean(table && currentIndentLevel(table) > 0);
  }

  canIndent(table: HTMLTableElement | null = this.getSelectedTable()): boolean {
    return Boolean(table && currentIndentLevel(table) < MAX_INDENT_LEVEL);
  }

  private adjustSelectedTable(change: number): void {
    const table = this.getSelectedTable();
    if (!table) {
      return;
    }
    const direction = change > 0 ? 1 : -1;
    const previousLevel = currentIndentLevel(table);
    const level = Math.min(MAX_INDENT_LEVEL, Math.max(0, previousLevel + direction));
    if (level === previousLevel) {
      return;
    }

    const bookmark = this.editor.selection.getBookmark(2, true);
    this.editor.undoManager.transact(() => {
      let wrapper = indentWrapper(table);

      // Migrate tables indented by the previous implementation. The wrapper
      // owns layout from this point on, leaving table width/alignment untouched.
      if (!wrapper && level > 0) {
        wrapper = table.ownerDocument.createElement('div');
        wrapper.className = INDENT_WRAPPER_CLASS;
        table.parentNode?.insertBefore(wrapper, table);
        wrapper.append(table);
        if (legacyIndentLevel(table) > 0) {
          table.style.removeProperty('margin-left');
          if (!table.getAttribute('style')?.trim()) table.removeAttribute('style');
        }
      }

      if (level === 0 && wrapper) {
        wrapper.parentNode?.insertBefore(table, wrapper);
        wrapper.remove();
      } else if (wrapper) {
        wrapper.dataset.indentLevel = String(level);
        wrapper.style.marginLeft = `${level * INDENT_STEP_REM}rem`;
      }
    });
    this.editor.selection.moveToBookmark(bookmark);
    this.lastSelectedTable = table;
    this.editor.nodeChanged();
    this.editor.focus();
  }

  private getSelectedTable(): HTMLTableElement | null {
    const selected = tableFromSelection(this.editor);
    if (selected) {
      this.lastSelectedTable = selected;
      return selected;
    }
    if (this.lastSelectedTable && this.editor.getBody().contains(this.lastSelectedTable)) {
      return this.lastSelectedTable;
    }
    this.lastSelectedTable = null;
    return null;
  }
}
