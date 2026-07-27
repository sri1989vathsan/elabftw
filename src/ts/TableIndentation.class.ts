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
const MAX_INDENT_REM = 20;
const WIDTH_STEP_PERCENT = 5;

function selectedTable(editor: Editor): HTMLTableElement | null {
  return editor.selection.getNode().closest?.('table') as HTMLTableElement | null;
}

function rootFontSize(table: HTMLTableElement): number {
  const view = table.ownerDocument.defaultView;
  const root = table.ownerDocument.documentElement;
  return Number.parseFloat(view?.getComputedStyle(root).fontSize ?? '16') || 16;
}

function currentIndent(table: HTMLTableElement): number {
  const margin = table.style.marginLeft.trim();
  if (margin.endsWith('rem')) {
    return Number.parseFloat(margin) || 0;
  }
  if (margin.endsWith('px')) {
    return (Number.parseFloat(margin) || 0) / rootFontSize(table);
  }
  return 0;
}

export default class TableIndentation {
  constructor(private readonly editor: Editor) {}

  indentSelectedTable(): void {
    this.adjustSelectedTable(INDENT_STEP_REM);
  }

  outdentSelectedTable(): void {
    this.adjustSelectedTable(-INDENT_STEP_REM);
  }

  canOutdent(table: HTMLTableElement | null = selectedTable(this.editor)): boolean {
    return Boolean(table && currentIndent(table) > 0);
  }

  canIndent(table: HTMLTableElement | null = selectedTable(this.editor)): boolean {
    return Boolean(table && currentIndent(table) < MAX_INDENT_REM);
  }

  private adjustSelectedTable(change: number): void {
    const table = selectedTable(this.editor);
    if (!table) {
      return;
    }
    const previousIndent = currentIndent(table);
    const indent = Math.min(MAX_INDENT_REM, Math.max(0, previousIndent + change));
    const actualChange = indent - previousIndent;
    if (actualChange === 0) {
      return;
    }

    this.editor.undoManager.transact(() => {
      if (indent === 0) {
        table.style.removeProperty('margin-left');
      } else {
        table.style.marginLeft = `${indent}rem`;
        if (table.style.marginRight === 'auto') {
          table.style.removeProperty('margin-right');
        }
      }

      const width = table.style.width.trim();
      if (width.endsWith('%')) {
        const widthPercent = Number.parseFloat(width);
        if (Number.isFinite(widthPercent)) {
          const widthChange = -(actualChange / INDENT_STEP_REM) * WIDTH_STEP_PERCENT;
          table.style.width = `${Math.min(100, Math.max(10, widthPercent + widthChange))}%`;
        }
      }
      if (!table.getAttribute('style')?.trim()) {
        table.removeAttribute('style');
      }
    });
    this.editor.nodeChanged();
    this.editor.focus();
  }
}
