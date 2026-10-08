/**
 * Spreadsheets in the table of contents. A spreadsheet is the saved
 * <table class="elabftw-spreadsheet"> (edit mode, and view mode before it
 * scrolls into view) or the live grid host that replaces it in view mode.
 */
export const SPREADSHEET_TOC_SELECTOR = 'table.elabftw-spreadsheet, .elabftw-spreadsheet-readonly-view';

/** Whether this match is a spreadsheet of its own and not something inside another one. */
export function isTocSpreadsheet(element: Element): boolean {
  return !element.parentElement?.closest(SPREADSHEET_TOC_SELECTOR);
}

/** The spreadsheet's title if it has one, otherwise "Table <number>". */
export function getSpreadsheetTocLabel(element: Element, number: number): string {
  const raw = element.matches('table')
    ? element.querySelector(':scope > caption')?.textContent
    : element.querySelector('.elabftw-spreadsheet-title')?.textContent;
  const title = (raw ?? '').replace(/\s+/g, ' ').trim();
  return title || `Table ${number}`;
}

export function hasTocSpreadsheet(root: ParentNode | null | undefined): boolean {
  return Array.from(root?.querySelectorAll(SPREADSHEET_TOC_SELECTOR) ?? []).some(isTocSpreadsheet);
}
