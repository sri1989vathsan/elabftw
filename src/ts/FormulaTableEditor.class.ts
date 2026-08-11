/**
 * @author eLabFTW contributors
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

import type { Editor } from 'tinymce/tinymce';
import FormulaTable from './FormulaTable.class';

export default class FormulaTableEditor {
  private currentCell: HTMLTableCellElement | null = null;
  private readonly evaluator = new FormulaTable();

  constructor(private readonly editor: Editor) {}

  init(): void {
    this.editor.on('init', () => {
      this.evaluator.evaluateAll(this.editor.getBody());
    });

    this.editor.on('click NodeChange', event => {
      const target = (event.element?.closest ? event.element : event.target) as Element | undefined;
      this.selectCell(target?.closest?.('td, th') as HTMLTableCellElement | null);
    });

    this.editor.on('input', () => {
      this.syncCurrentFormula();
    });

    this.editor.on('blur', () => {
      this.finishCurrentCell();
    });

    this.editor.on('BeforeGetContent', () => {
      this.syncCurrentFormula();
    });

    // Work on a detached copy so a save/autosave never replaces the formula
    // currently being edited with its displayed result.
    this.editor.on('GetContent', event => {
      if (!event.content.includes('data-formula')) {
        return;
      }
      const container = this.editor.getDoc().createElement('div');
      container.innerHTML = event.content;
      this.evaluator.evaluateAll(container);
      event.content = container.innerHTML;
    });
  }

  recalculateSelectedTable(): void {
    this.syncCurrentFormula();
    const table = this.currentCell?.closest('table')
      ?? this.editor.selection.getNode().closest?.('table');
    if (!table) {
      return;
    }
    this.evaluator.evaluate(table);
    this.currentCell = null;
    this.editor.nodeChanged();
    this.editor.focus();
  }

  private selectCell(cell: HTMLTableCellElement | null): void {
    if (cell === this.currentCell) {
      return;
    }
    this.finishCurrentCell();
    if (!cell) {
      return;
    }

    this.currentCell = cell;
    const formula = cell.getAttribute('data-formula');
    if (formula) {
      cell.textContent = formula;
      cell.removeAttribute('data-formula-state');
    }
  }

  private syncCurrentFormula(): void {
    if (!this.currentCell) {
      return;
    }
    const content = this.currentCell.textContent?.trim() ?? '';
    if (content.startsWith('=')) {
      this.currentCell.setAttribute('data-formula', content);
      this.currentCell.removeAttribute('data-formula-state');
      return;
    }
    this.currentCell.removeAttribute('data-formula');
    this.currentCell.removeAttribute('data-formula-state');
  }

  private finishCurrentCell(): void {
    if (!this.currentCell) {
      return;
    }
    const cell = this.currentCell;
    this.syncCurrentFormula();
    this.currentCell = null;
    const table = cell.closest('table');
    if (table) {
      this.evaluator.evaluate(table);
    }
  }
}
