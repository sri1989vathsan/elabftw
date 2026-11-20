/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 *
 * Printing or copying a section of an entry clones the main text; a mounted spreadsheet in it must be turned back into a plain table
 * first (restoreStaticSpreadsheetsForPrint in inline-spreadsheet.ts, which knows the data behind each mounted grid). That file is the
 * spreadsheet engine (about 600 KB) and is only loaded on pages that have a spreadsheet, so the Contents panel and the print code, which
 * are on every page, call it through this hook: the engine registers itself when it loads. On a page where it never loaded there is no
 * mounted grid to restore, and the only other thing the real function does (dropping the editor's spacer elements) is done here.
 */
type Restorer = (originalRoot: ParentNode, clonedRoot: ParentNode) => void;

let restorer: Restorer | null = null;

export function setSpreadsheetPrintRestorer(fn: Restorer): void {
  restorer = fn;
}

export function restoreStaticSpreadsheetsForPrint(originalRoot: ParentNode, clonedRoot: ParentNode): void {
  if (restorer) {
    restorer(originalRoot, clonedRoot);
    return;
  }
  clonedRoot.querySelectorAll('[data-elabftw-spreadsheet-spacer]').forEach(spacer => spacer.remove());
}
