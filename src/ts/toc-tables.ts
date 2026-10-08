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

/**
 * Pictures placed in the text. Emoji, tiny icons, the editor's own placeholders
 * and anything inside a spreadsheet are not pictures of their own.
 */
export const IMAGE_TOC_SELECTOR = 'img';

export function isTocImage(element: Element): boolean {
  if (!element.matches('img')) return false;
  if (element.closest(`${SPREADSHEET_TOC_SELECTOR}, [data-mce-bogus], [data-mce-object], .mce-pagebreak, .emoji`)) {
    return false;
  }
  if (element.classList.contains('emoji') || element.hasAttribute('data-emoji')) return false;
  const image = element as HTMLImageElement;
  const width = image.naturalWidth || Number.parseInt(image.getAttribute('width') ?? '', 10) || 0;
  return !(width > 0 && width < 32);
}

/** Caption, then title, then alt text (unless it is just a file name), otherwise "Image <number>". */
export function getImageTocLabel(element: Element, number: number): string {
  const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
  const caption = clean(element.closest('figure')?.querySelector('figcaption')?.textContent);
  if (caption) return caption;
  const title = clean(element.getAttribute('title'));
  if (title) return title;
  const alt = clean(element.getAttribute('alt'));
  if (alt && !/\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?)$/i.test(alt)) return alt;
  return `Image ${number}`;
}

export function hasTocImage(root: ParentNode | null | undefined): boolean {
  return Array.from(root?.querySelectorAll(IMAGE_TOC_SELECTOR) ?? []).some(isTocImage);
}
