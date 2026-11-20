/**
 * "Wide tables" in print and PDF: what happens to a spreadsheet that is wider than the page.
 *   fit        Fit to page width (default): portrait, scaled to the page width (smaller text)
 *   landscape  Landscape page for wide tables: a landscape page when a portrait page would shrink the sheet below 70%
 *   split      Actual size, split across pages: no scaling, the columns that do not fit continue on the next page
 *              (first column, row numbers and header row repeated)
 *
 * The user is asked before a print or a PDF export starts, but only when the entry has such a table (askSheetsMode). The choice can be
 * remembered (localStorage, per browser); then the question is skipped and the choice is applied. Ctrl+P cannot be intercepted: it uses
 * the remembered choice, else "fit". The choice of one print is published as document.body.dataset.sheetsMode until the print is done;
 * the PDF request carries it as sheets=<mode>.
 */
import $ from 'jquery';

export type SheetsMode = 'landscape' | 'fit' | 'split';
export const DEFAULT_SHEETS_MODE: SheetsMode = 'fit';
// the printable width of an A4 portrait page in CSS pixels: a sheet wider than this does not fit at 100%
export const PRINT_PAGE_WIDTH = 700;
const MODE_KEY = 'elabftw-sheets-mode';
const REMEMBER_KEY = 'elabftw-sheets-mode-remembered';
const LABELS: Record<SheetsMode, string> = {
  fit: 'Fit to page width (smaller text)',
  landscape: 'Landscape page for wide tables',
  split: 'Actual size, split across pages (first column repeated)',
};

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* storage blocked: nothing is remembered */ }
}

/** True when the user ticked "Remember my choice" (the question is then not asked). */
export function isSheetsModeRemembered(): boolean {
  return readStorage(REMEMBER_KEY) === '1';
}

/** The remembered choice, else the default: what Ctrl+P and a skipped question use. */
export function getSheetsMode(): SheetsMode {
  const stored = readStorage(MODE_KEY);
  if (isSheetsModeRemembered() && (stored === 'landscape' || stored === 'split' || stored === 'fit')) return stored;
  return DEFAULT_SHEETS_MODE;
}

/** The mode of the print that is running (set by the question), else the remembered/default one. */
export function currentPrintMode(): SheetsMode {
  const set = document.body.dataset.sheetsMode;
  return set === 'landscape' || set === 'split' || set === 'fit' ? set : getSheetsMode();
}

/** Forgets the remembered choice: the question comes back. */
export function forgetSheetsMode(): void {
  writeStorage(REMEMBER_KEY, null);
  writeStorage(MODE_KEY, null);
  updateLabels();
}

function updateLabels(): void {
  document.querySelectorAll<HTMLElement>('[data-sheets-mode-label]').forEach(el => {
    el.textContent = isSheetsModeRemembered() ? LABELS[getSheetsMode()] : 'Ask me when a table is wider than the page';
  });
}

/** How many tables of the entry (as shown on the page, or in the editor) are wider than the page at 100%. */
export function wideSheetCount(root?: ParentNode | null): number {
  const editorBody = (window as unknown as { tinymce?: { activeEditor?: { getBody(): HTMLElement } } }).tinymce?.activeEditor?.getBody();
  const scope: ParentNode = root ?? document.getElementById('body_view') ?? editorBody ?? document;
  let count = 0;
  scope.querySelectorAll<HTMLElement>('.elabftw-spreadsheet-readonly-view, table.elabftw-spreadsheet').forEach(el => {
    if (el.closest('#tocPrintSelectionDocument')) return;
    if (el.parentElement?.closest('.elabftw-spreadsheet-readonly-view')) return;
    if (el.dataset.spreadsheetStyle === 'well-plate') return;
    const width = Number.parseFloat(el.dataset.viewModeWidth ?? '') || Number.parseFloat(el.style.width) || 0;
    if (width > PRINT_PAGE_WIDTH) count++;
  });
  return count;
}

function modalHtml(): string {
  const radio = (mode: SheetsMode, checked: boolean): string => `<div class='custom-control custom-radio'>
      <input type='radio' class='custom-control-input' name='sheetsModeChoice' id='sheetsModeChoice-${mode}' value='${mode}'${checked ? ' checked' : ''}>
      <label class='custom-control-label' for='sheetsModeChoice-${mode}'>${LABELS[mode]}</label></div>`;
  return `<div class='modal fade' id='sheetsModeModal' tabindex='-1' role='dialog' aria-labelledby='sheetsModeTitle'>
  <div class='modal-dialog' role='document'><div class='modal-content'>
    <div class='modal-header'><h5 class='modal-title' id='sheetsModeTitle'><i class='fas fa-fw fa-table mr-1'></i>Wide tables</h5>
      <button type='button' class='close' data-dismiss='modal' aria-label='Close'><span aria-hidden='true'>&times;</span></button></div>
    <div class='modal-body'>
      <p id='sheetsModeText'></p>
      ${radio('fit', true)}${radio('landscape', false)}${radio('split', false)}
      <div class='custom-control custom-checkbox mt-3'>
        <input type='checkbox' class='custom-control-input' id='sheetsModeRemember'>
        <label class='custom-control-label' for='sheetsModeRemember'>Remember my choice</label></div>
    </div>
    <div class='modal-footer'>
      <button type='button' class='btn btn-ghost' id='sheetsModeCancel' data-dismiss='modal'>Cancel</button>
      <button type='button' class='btn btn-primary' id='sheetsModeOk'></button>
    </div>
  </div></div></div>`;
}

/**
 * Shows the question ("Wide tables"). Resolves with the chosen mode, or null when the user cancelled.
 * `action` names the OK button: Print, Export (a PDF) or Save (the setting only, from "Change wide table setting").
 */
function showModal(action: 'Print' | 'Export' | 'Save', count: number): Promise<SheetsMode | null> {
  document.getElementById('sheetsModeModal')?.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml());
  const modal = document.getElementById('sheetsModeModal') as HTMLElement;
  const text = modal.querySelector('#sheetsModeText') as HTMLElement;
  text.textContent = count > 0
    ? `This entry has ${count} ${count === 1 ? 'table' : 'tables'} wider than the page. How should they be printed?`
    : 'How should tables that are wider than the page be printed?';
  (modal.querySelector('#sheetsModeOk') as HTMLElement).textContent = action;
  const remembered = isSheetsModeRemembered() ? getSheetsMode() : DEFAULT_SHEETS_MODE;
  const preselect = modal.querySelector<HTMLInputElement>(`#sheetsModeChoice-${remembered}`);
  if (preselect) preselect.checked = true;
  (modal.querySelector('#sheetsModeRemember') as HTMLInputElement).checked = isSheetsModeRemembered();
  return new Promise(resolve => {
    let chosen: SheetsMode | null = null;
    modal.querySelector('#sheetsModeOk')?.addEventListener('click', () => {
      const mode = (modal.querySelector<HTMLInputElement>('input[name="sheetsModeChoice"]:checked')?.value ?? DEFAULT_SHEETS_MODE) as SheetsMode;
      const remember = (modal.querySelector('#sheetsModeRemember') as HTMLInputElement).checked;
      writeStorage(MODE_KEY, mode);
      writeStorage(REMEMBER_KEY, remember ? '1' : null);
      updateLabels();
      chosen = mode;
      $(modal).modal('hide');
    });
    $(modal).on('hidden.bs.modal', () => { modal.remove(); resolve(chosen); });
    $(modal).modal('show');
  });
}

/**
 * Called before a print or a PDF export starts. Nothing is asked when no table is wider than the page, or when the choice was
 * remembered: the answer is then the remembered mode (or "fit"). Resolves with null when the user cancels.
 */
export async function askSheetsMode(action: 'Print' | 'Export', root?: ParentNode | null): Promise<SheetsMode | null> {
  const count = wideSheetCount(root);
  if (count === 0 || isSheetsModeRemembered()) return getSheetsMode();
  return showModal(action, count);
}

/** "Change wide table setting": opens the question without printing anything; the remembered choice is replaced. */
export function changeSheetsModeSetting(): void {
  void showModal('Save', wideSheetCount());
}

/**
 * Runs `print` once the wide tables have been dealt with: the mode of this print is published on the body for the copy that is
 * printed and for beforeprint, and removed again when the print is over.
 */
export function printWithSheetsChoice(print: () => void): void {
  void askSheetsMode('Print').then(mode => {
    if (mode === null) return;
    document.body.dataset.sheetsMode = mode;
    try {
      print();
    } finally {
      // the print itself runs on the next frame (print-main-text.ts): keep the mode until then
      window.setTimeout(() => { delete document.body.dataset.sheetsMode; }, 0);
    }
  });
}

/** Shows the current setting in every [data-sheets-mode-label] and makes every [data-action=sheets-mode-change] open the setting. */
export function bindSheetsModeSettings(): void {
  updateLabels();
  document.querySelectorAll<HTMLElement>('[data-action="sheets-mode-change"]').forEach(link => {
    if (link.dataset.sheetsModeBound) return;
    link.dataset.sheetsModeBound = '1';
    link.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); changeSheetsModeSetting(); });
  });
}
