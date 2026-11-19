/**
 * "Sheets in print and PDF": what happens to a spreadsheet wider than the page.
 *   landscape  Landscape when wide (default): a landscape page when a portrait page would shrink it below 70%
 *   fit        Fit to page width: always portrait, scaled to the page width
 *   split      Actual size, split across pages: no scaling, the columns that do not fit continue on the next page
 * The choice is remembered per browser (localStorage); the PDF request carries it as sheets=<mode> and the print code reads
 * document.body.dataset.sheetsMode in beforeprint. Every <select data-sheets-mode> on the page shows and sets it.
 */
export type SheetsMode = 'landscape' | 'fit' | 'split';
const KEY = 'elabftw-sheets-mode';

export function getSheetsMode(): SheetsMode {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'fit' || stored === 'split') return stored;
  } catch { /* storage blocked: the default */ }
  return 'landscape';
}

export function setSheetsMode(mode: SheetsMode): void {
  try { window.localStorage.setItem(KEY, mode); } catch { /* not remembered */ }
  document.body.dataset.sheetsMode = mode;
  document.querySelectorAll<HTMLSelectElement>('select[data-sheets-mode]').forEach(select => { select.value = mode; });
}

/** Shows the saved choice in every select of the page, keeps them in step and publishes it on the body for the print code. */
export function bindSheetsModeSelects(): void {
  document.body.dataset.sheetsMode = getSheetsMode();
  document.querySelectorAll<HTMLSelectElement>('select[data-sheets-mode]').forEach(select => {
    select.value = getSheetsMode();
    // a click in the Export menu must not close it
    select.addEventListener('click', event => event.stopPropagation());
    select.addEventListener('change', () => setSheetsMode(select.value as SheetsMode));
  });
}
