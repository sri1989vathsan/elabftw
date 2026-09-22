/** Fork-owned inline spreadsheet insertion, editing and clipboard handling. */
import { Editor } from 'tinymce/tinymce';
import {
  buildReadOnlySpreadsheetHost,
  createNotebookSpreadsheetData,
  createWellPlateSpreadsheetData,
  emptySpreadsheetData,
  extractFromTable,
  getFlattenedClipboardSuggestion,
  normalizePdfPrivateUseText,
  openSpreadsheetModal,
  pasteSpreadsheetRange,
  spreadsheetFromClipboard,
  spreadsheetFromFlattenedClipboard,
  spreadsheetToHTML,
  SpreadsheetData,
  WELL_PLATE_PRESETS,
} from '../inline-spreadsheet';
import { escapeHTML } from '../misc';
import { RICH_SELECTION_ATTRIBUTE } from '../ClipboardContent';
import TableIndentation from '../TableIndentation.class';
import { isSortable } from '../TableSorting.class';

interface PdfTableDialogData {
  columns: string;
}

function spreadsheetColumnLabel(index: number): string {
  let label = '';
  let current = index;
  do {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return label;
}

function getFormulaSpreadsheetCoordinates(
  table: HTMLTableElement,
  cell: HTMLTableCellElement,
): { col: number; row: number } | null {
  const visualRow = Array.from(table.rows).indexOf(cell.parentElement as HTMLTableRowElement);
  const kind = table.dataset.spreadsheetStyle;
  const row = kind === 'notebook' ? visualRow : visualRow - 1;
  const col = kind === 'notebook' ? cell.cellIndex : cell.cellIndex - 1;
  return row >= 0 && col >= 0 ? { col, row } : null;
}

function replaceFormulaSpreadsheetRange(
  editor: Editor,
  table: HTMLTableElement,
  cell: HTMLTableCellElement,
  source: SpreadsheetData,
): boolean {
  const coordinates = getFormulaSpreadsheetCoordinates(table, cell);
  if (!coordinates) return false;
  const updated = pasteSpreadsheetRange(
    extractFromTable(table),
    source,
    coordinates.col,
    coordinates.row,
  );
  const container = editor.getDoc().createElement('div');
  container.innerHTML = spreadsheetToHTML(updated, updated.data);
  const replacement = container.firstElementChild as HTMLTableElement | null;
  if (!replacement) return false;
  table.replaceWith(replacement);

  const visualRow = coordinates.row + (updated.kind === 'notebook' ? 0 : 1);
  const visualCol = coordinates.col + (updated.kind === 'notebook' ? 0 : 1);
  const replacementCell = replacement.rows[visualRow]?.cells[visualCol];
  if (replacementCell) editor.selection.setCursorLocation(replacementCell, 0);
  return true;
}

function tableHasMergedCells(table: HTMLTableElement): boolean {
  return Array.from(table.querySelectorAll<HTMLTableCellElement>('td, th')).some(cell => (
    cell.colSpan > 1 || cell.rowSpan > 1
  ));
}

function createDestinationCell(
  row: HTMLTableRowElement,
  tagName: 'TD' | 'TH',
): HTMLTableCellElement {
  const cell = row.ownerDocument.createElement(tagName.toLowerCase()) as HTMLTableCellElement;
  row.appendChild(cell);
  return cell;
}

function pasteIntoHtmlTable(
  targetTable: HTMLTableElement,
  targetCell: HTMLTableCellElement,
  source: SpreadsheetData,
): HTMLTableCellElement | null {
  if (tableHasMergedCells(targetTable)) return null;
  const targetRow = targetCell.parentElement as HTMLTableRowElement | null;
  const targetSection = targetRow?.parentElement;
  if (!targetRow || !targetSection) return null;
  const sectionRows = Array.from(targetSection.children)
    .filter((element): element is HTMLTableRowElement => element.tagName === 'TR');
  const startRow = sectionRows.indexOf(targetRow);
  const startCol = targetCell.cellIndex;
  if (startRow < 0 || startCol < 0) return null;
  const newCellTag = targetCell.tagName === 'TH' ? 'TH' : 'TD';
  let lastCell: HTMLTableCellElement | null = targetCell;

  for (let rowOffset = 0; rowOffset < source.rows; rowOffset++) {
    let destinationRow = sectionRows[startRow + rowOffset];
    if (!destinationRow) {
      destinationRow = targetRow.ownerDocument.createElement('tr');
      targetSection.appendChild(destinationRow);
      sectionRows.push(destinationRow);
    }
    while (destinationRow.cells.length < startCol + source.cols) {
      createDestinationCell(destinationRow, newCellTag);
    }
    for (let colOffset = 0; colOffset < source.cols; colOffset++) {
      const destinationCell = destinationRow.cells[startCol + colOffset];
      const value = String(source.data[rowOffset]?.[colOffset] ?? '');
      destinationCell.innerHTML = escapeHTML(value).replace(/\r?\n/g, '<br>');
      const style = source.cellStyles?.[
        `${spreadsheetColumnLabel(colOffset)}${rowOffset + 1}`
      ];
      if (style) destinationCell.setAttribute('style', style);
      lastCell = destinationCell;
    }
  }
  return lastCell;
}

/**
 * Return true only when the rich clipboard payload represents one table by
 * itself. Mixed selections (paragraph + table + paragraph, for example) must
 * be left to TinyMCE so all selected content and formatting are retained.
 */
function isStandaloneClipboardTable(html: string): boolean {
  if (!/<table[\s>]/i.test(html)) return false;
  const clipboardDocument = new DOMParser().parseFromString(html, 'text/html');
  const body = clipboardDocument.body;
  const tables = body.querySelectorAll('table');
  if (tables.length !== 1) return false;

  const table = tables[0];
  let current: Element = table;
  while (current.parentElement && current.parentElement !== body) {
    const parent = current.parentElement;
    const hasMeaningfulSibling = Array.from(parent.childNodes).some(node => {
      if (node === current) return false;
      if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
      return node.nodeType === Node.ELEMENT_NODE
        && !['META', 'STYLE'].includes((node as Element).tagName);
    });
    if (hasMeaningfulSibling) return false;
    current = parent;
  }

  return !Array.from(body.childNodes).some(node => {
    if (node === current) return false;
    if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
    return node.nodeType === Node.ELEMENT_NODE
      && !['META', 'STYLE'].includes((node as Element).tagName);
  });
}

function distributeTableHeight(
  currentHeights: number[],
  minimumHeights: number[],
  requestedTotal: number,
): number[] {
  const minimumTotal = minimumHeights.reduce((sum, height) => sum + height, 0);
  const target = Math.max(minimumTotal, requestedTotal);
  const currentTotal = currentHeights.reduce((sum, height) => sum + height, 0);
  if (currentTotal <= 0) return minimumHeights;
  if (target >= currentTotal) {
    const scale = target / currentTotal;
    return currentHeights.map((height, index) => Math.max(minimumHeights[index], height * scale));
  }

  const result = [...minimumHeights];
  let remainingTarget = target;
  let adjustable = currentHeights.map((_height, index) => index);
  while (adjustable.length > 0) {
    const adjustableCurrent = adjustable.reduce((sum, index) => sum + currentHeights[index], 0);
    if (adjustableCurrent <= 0) break;
    const scale = remainingTarget / adjustableCurrent;
    const clamped = adjustable.filter(index => currentHeights[index] * scale <= minimumHeights[index]);
    if (clamped.length === 0) {
      adjustable.forEach(index => { result[index] = currentHeights[index] * scale; });
      break;
    }
    clamped.forEach(index => { remainingTarget -= minimumHeights[index]; });
    const clampedSet = new Set(clamped);
    adjustable = adjustable.filter(index => !clampedSet.has(index));
  }
  return result;
}

function removeOuterTableHeight(table: HTMLTableElement): void {
  table.removeAttribute('height');
  table.style.removeProperty('height');
  table.style.removeProperty('min-height');
  table.style.removeProperty('max-height');
  const internalStyle = table.getAttribute('data-mce-style');
  if (!internalStyle) return;
  const styleProbe = table.ownerDocument.createElement('table');
  styleProbe.setAttribute('style', internalStyle);
  styleProbe.style.removeProperty('height');
  styleProbe.style.removeProperty('min-height');
  styleProbe.style.removeProperty('max-height');
  const normalized = styleProbe.getAttribute('style')?.trim();
  if (normalized) {
    table.setAttribute('data-mce-style', normalized);
  } else {
    table.removeAttribute('data-mce-style');
  }
}

// Unlike height, DEFAULT_TABLE_STYLE persists a real min-width:25% that must
// survive a resize, so only the width/max-width a drag itself would have set
// are stripped here.
function removeOuterTableWidth(table: HTMLTableElement): void {
  table.removeAttribute('width');
  table.style.removeProperty('width');
  table.style.removeProperty('max-width');
  const internalStyle = table.getAttribute('data-mce-style');
  if (!internalStyle) return;
  const styleProbe = table.ownerDocument.createElement('table');
  styleProbe.setAttribute('style', internalStyle);
  styleProbe.style.removeProperty('width');
  styleProbe.style.removeProperty('max-width');
  const normalized = styleProbe.getAttribute('style')?.trim();
  if (normalized) {
    table.setAttribute('data-mce-style', normalized);
  } else {
    table.removeAttribute('data-mce-style');
  }
}

function resizeSpreadsheetRowsFromTableHeight(
  table: HTMLTableElement,
  requestedHeight: number,
): void {
  if (!Number.isFinite(requestedHeight) || requestedHeight <= 0) return;
  const kind = table.dataset.spreadsheetStyle;
  const rows = kind === 'notebook'
    ? Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
    : Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody > tr'));
  if (rows.length === 0) return;

  // Rows may not carry an explicit height of their own yet (a freshly
  // inserted spreadsheet with no saved row heights). Reading their live
  // rendered height in that case just inherits whatever the browser's
  // content-based auto-layout picked — usually uneven when cell content
  // lengths differ — and scaling proportionally from that lets one row grow
  // disproportionately. Start every row equal until we've explicitly pinned
  // heights of our own on a previous resize. Notebook tables are exempt: row
  // 0 there is a real title/header row that's expected to differ in height
  // from ordinary data rows, not an artifact to flatten.
  const explicitHeights = rows.map(row => {
    const parsed = Number.parseFloat(row.style.height);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const hasExplicitHeights = explicitHeights.some(height => height !== null);

  removeOuterTableHeight(table);
  const currentHeights = kind !== 'notebook' && !hasExplicitHeights
    ? rows.map(() => 30)
    : explicitHeights.map((height, index) => height ?? Math.max(20, rows[index].getBoundingClientRect().height));
  const previousInlineHeights = rows.map(row => row.style.height);
  rows.forEach(row => row.style.removeProperty('height'));
  const minimumHeights = rows.map(row => Math.max(20, Math.ceil(row.getBoundingClientRect().height)));
  const naturalTableHeight = table.getBoundingClientRect().height;
  const naturalRowsHeight = minimumHeights.reduce((sum, height) => sum + height, 0);
  const fixedHeight = Math.max(0, naturalTableHeight - naturalRowsHeight);
  rows.forEach((row, index) => { row.style.height = previousInlineHeights[index]; });

  const targetRowsHeight = Math.max(0, requestedHeight - fixedHeight);
  const distributed = distributeTableHeight(currentHeights, minimumHeights, targetRowsHeight);
  rows.forEach((row, index) => {
    row.style.height = `${Math.max(minimumHeights[index], Math.round(distributed[index]))}px`;
    const serializedStyle = row.getAttribute('style')?.trim();
    if (serializedStyle) row.setAttribute('data-mce-style', serializedStyle);
  });
  removeOuterTableHeight(table);
}

// Mirrors resizeSpreadsheetRowsFromTableHeight for the horizontal axis. The
// row-index/well-plate coordinate column (the first cell of every row) is
// deliberately kept at a fixed width instead of scaling with the rest: only
// data columns absorb width added or removed by the drag.
function resizeSpreadsheetColumnsFromTableWidth(
  table: HTMLTableElement,
  requestedWidth: number,
): void {
  if (!Number.isFinite(requestedWidth) || requestedWidth <= 0) return;
  const headerRow = table.querySelector<HTMLTableRowElement>('thead > tr');
  if (!headerRow) return;
  const headerCells = Array.from(headerRow.children) as HTMLTableCellElement[];
  const coordinateHeaderCell = headerCells.find(cell => cell.classList.contains('spreadsheet-coordinate')) ?? null;
  const dataHeaderCells = headerCells.filter(cell => cell !== coordinateHeaderCell);
  if (dataHeaderCells.length === 0) return;

  // Read the configured row-index width from the table's own saved data
  // instead of measuring the live DOM: mid-drag the browser may already have
  // stretched that cell before this handler runs, and trusting a live
  // measurement would let that drift compound on every subsequent resize.
  const savedRowIndexWidth = extractFromTable(table).appearance?.rowIndexWidth;
  const indexWidth = coordinateHeaderCell
    ? Math.max(20, Math.round(savedRowIndexWidth ?? coordinateHeaderCell.getBoundingClientRect().width))
    : 0;

  // Data columns carry no explicit width of their own until a resize sets
  // one (unlike rows, which already have one from creation). Reading their
  // live rendered width here as the "current" proportions would just inherit
  // whatever the browser's own auto-layout happened to pick — commonly
  // dumping most of the slack into a single column. Start every column equal
  // until we've explicitly pinned widths of our own on a previous resize.
  const explicitWidths = dataHeaderCells.map(cell => {
    const parsed = Number.parseFloat(cell.style.width);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const hasExplicitWidths = explicitWidths.some(width => width !== null);
  const currentWidths = hasExplicitWidths
    ? explicitWidths.map((width, index) => width ?? Math.max(20, dataHeaderCells[index].getBoundingClientRect().width))
    : dataHeaderCells.map(() => 100);

  removeOuterTableWidth(table);
  const previousInlineWidths = dataHeaderCells.map(cell => cell.style.width);
  dataHeaderCells.forEach(cell => cell.style.removeProperty('width'));
  const minimumWidths = dataHeaderCells.map(cell => Math.max(20, Math.ceil(cell.getBoundingClientRect().width)));
  dataHeaderCells.forEach((cell, index) => { cell.style.width = previousInlineWidths[index]; });

  const targetColumnsWidth = Math.max(0, requestedWidth - indexWidth);
  const distributed = distributeTableHeight(currentWidths, minimumWidths, targetColumnsWidth);

  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('thead > tr, tbody > tr'));
  rows.forEach(row => {
    const cells = Array.from(row.children) as HTMLTableCellElement[];
    const rowCoordinateCell = cells.find(cell => cell.classList.contains('spreadsheet-coordinate')) ?? null;
    if (rowCoordinateCell) {
      rowCoordinateCell.style.width = `${indexWidth}px`;
      rowCoordinateCell.style.minWidth = `${indexWidth}px`;
      rowCoordinateCell.style.maxWidth = `${indexWidth}px`;
      const serializedIndexStyle = rowCoordinateCell.getAttribute('style')?.trim();
      if (serializedIndexStyle) rowCoordinateCell.setAttribute('data-mce-style', serializedIndexStyle);
    }
    const rowDataCells = cells.filter(cell => cell !== rowCoordinateCell);
    rowDataCells.forEach((cell, index) => {
      const width = distributed[index];
      if (width === undefined) return;
      cell.style.width = `${Math.max(minimumWidths[index] ?? 20, Math.round(width))}px`;
      const serializedStyle = cell.getAttribute('style')?.trim();
      if (serializedStyle) cell.setAttribute('data-mce-style', serializedStyle);
    });
  });
}

const MAX_AUTOFIT_COLUMN_WIDTH = 400;

// Measures how wide a cell would need to be to show its content on one line,
// same as double-clicking a column border in Excel/Sheets: it does not
// widen to fit a whole wrapped paragraph, only the longest unwrapped line.
function measureNaturalCellWidth(cell: HTMLTableCellElement): number {
  const previousWhiteSpace = cell.style.whiteSpace;
  const previousWidth = cell.style.width;
  cell.style.whiteSpace = 'nowrap';
  cell.style.removeProperty('width');
  const width = Math.max(20, Math.ceil(cell.getBoundingClientRect().width));
  cell.style.whiteSpace = previousWhiteSpace;
  cell.style.width = previousWidth;
  return width;
}

// On-demand "autofit column widths": size every data column to its own
// longest single line of content, across every row (not just the header).
function autofitSpreadsheetColumns(table: HTMLTableElement): void {
  const headerRow = table.querySelector<HTMLTableRowElement>('thead > tr');
  if (!headerRow) return;
  const headerCells = Array.from(headerRow.children) as HTMLTableCellElement[];
  const coordinateHeaderCell = headerCells.find(cell => cell.classList.contains('spreadsheet-coordinate')) ?? null;
  const columnCount = headerCells.length - (coordinateHeaderCell ? 1 : 0);
  if (columnCount === 0) return;

  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('thead > tr, tbody > tr'));
  const naturalWidths = new Array<number>(columnCount).fill(20);

  removeOuterTableWidth(table);
  rows.forEach(row => {
    const cells = Array.from(row.children) as HTMLTableCellElement[];
    const rowCoordinateCell = cells.find(cell => cell.classList.contains('spreadsheet-coordinate')) ?? null;
    const rowDataCells = cells.filter(cell => cell !== rowCoordinateCell);
    rowDataCells.forEach((cell, index) => {
      const width = Math.min(MAX_AUTOFIT_COLUMN_WIDTH, measureNaturalCellWidth(cell));
      if (width > naturalWidths[index]) naturalWidths[index] = width;
    });
  });

  rows.forEach(row => {
    const cells = Array.from(row.children) as HTMLTableCellElement[];
    const rowCoordinateCell = cells.find(cell => cell.classList.contains('spreadsheet-coordinate')) ?? null;
    const rowDataCells = cells.filter(cell => cell !== rowCoordinateCell);
    rowDataCells.forEach((cell, index) => {
      const width = naturalWidths[index];
      if (width === undefined) return;
      cell.style.width = `${width}px`;
      const serializedStyle = cell.getAttribute('style')?.trim();
      if (serializedStyle) cell.setAttribute('data-mce-style', serializedStyle);
    });
  });
}

// On-demand "autofit row heights": every row (other than a notebook table's
// real header row) goes back to exactly the height its own content needs.
function autofitSpreadsheetRows(table: HTMLTableElement): void {
  const kind = table.dataset.spreadsheetStyle;
  const rows = kind === 'notebook'
    ? Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
    : Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody > tr'));
  if (rows.length === 0) return;

  removeOuterTableHeight(table);
  const previousInlineHeights = rows.map(row => row.style.height);
  rows.forEach(row => row.style.removeProperty('height'));
  const naturalHeights = rows.map(row => Math.max(20, Math.ceil(row.getBoundingClientRect().height)));
  previousInlineHeights.forEach((_height, index) => { rows[index].style.removeProperty('height'); });
  rows.forEach((row, index) => {
    row.style.height = `${naturalHeights[index]}px`;
    const serializedStyle = row.getAttribute('style')?.trim();
    if (serializedStyle) row.setAttribute('data-mce-style', serializedStyle);
  });
  removeOuterTableHeight(table);
}

// Grows (never auto-shrinks, so it never fights a size you set on purpose) a
// row to fit whatever was just typed into one of its cells, the same way
// Excel keeps row height following wrapped content without any explicit
// resize action.
function growSpreadsheetRowToFitContent(row: HTMLTableRowElement): void {
  const previousHeight = row.style.height;
  const currentHeight = previousHeight ? Number.parseFloat(previousHeight) : 0;
  row.style.removeProperty('height');
  const naturalHeight = Math.ceil(row.getBoundingClientRect().height);
  row.style.height = `${Math.max(naturalHeight, currentHeight)}px`;
  const serializedStyle = row.getAttribute('style')?.trim();
  if (serializedStyle) row.setAttribute('data-mce-style', serializedStyle);
}

// Same idea for the column the edited cell is in: only ever widens, and
// widens every cell in that column together (not just the one being typed
// into) so the whole column agrees on one width, matching what a manual
// column-width drag already does. The row-index/well-plate coordinate
// column is excluded — that one stays a fixed, deliberately-set width.
function growSpreadsheetColumnToFitCell(cell: HTMLTableCellElement): void {
  if (cell.classList.contains('spreadsheet-coordinate')) return;
  const table = cell.closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
  const row = cell.closest('tr');
  if (!table || !row) return;
  const cellIndex = Array.from(row.children).indexOf(cell);
  if (cellIndex === -1) return;

  const previousWidth = cell.style.width;
  const currentWidth = previousWidth ? Number.parseFloat(previousWidth) : 0;
  const naturalWidth = Math.min(MAX_AUTOFIT_COLUMN_WIDTH, measureNaturalCellWidth(cell));
  if (naturalWidth <= currentWidth) return;

  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('thead > tr, tbody > tr'));
  rows.forEach(otherRow => {
    const targetCell = otherRow.children[cellIndex] as HTMLTableCellElement | undefined;
    if (!targetCell || targetCell.classList.contains('spreadsheet-coordinate')) return;
    targetCell.style.width = `${naturalWidth}px`;
    const serializedStyle = targetCell.getAttribute('style')?.trim();
    if (serializedStyle) targetCell.setAttribute('data-mce-style', serializedStyle);
  });
}

export function registerSpreadsheetExtension(editor: Editor): void {
  const tableIndentation = new TableIndentation(editor);
  // sort down icon from COLLECTION: Dazzle Line Icons LICENSE: CC Attribution License AUTHOR: Dazzle UI
  editor.ui.registry.addIcon('sort-amount-down-alt', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 12h8m-8-4h8m-8 8h8M6 7v10m0 0-3-3m3 3 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'); // eslint-disable-line
  editor.ui.registry.addIcon(
    'elabftw-spreadsheet-formula',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 4v16M15 4v16M3 9.5h18M3 14.5h18" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M16.3 11.3h3.2M16.3 12.9h3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  );
  editor.ui.registry.addIcon(
    'elabftw-data-table',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3.9" y="4.9" width="16.2" height="3.6" fill="currentColor"/><path d="M3 13h18M9 8.5v11.5M15 8.5v11.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  );
  editor.ui.registry.addIcon(
    'elabftw-well-plate',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7.5" cy="8" r="1.3" fill="currentColor"/><circle cx="12" cy="8" r="1.3" fill="currentColor"/><circle cx="16.5" cy="8" r="1.3" fill="currentColor"/><circle cx="7.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="16.5" cy="12" r="1.3" fill="currentColor"/><circle cx="7.5" cy="16" r="1.3" fill="currentColor"/><circle cx="12" cy="16" r="1.3" fill="currentColor"/><circle cx="16.5" cy="16" r="1.3" fill="currentColor"/></svg>',
  );
  const resizeStartHeights = new WeakMap<Element, number>();
  const resizeStartWidths = new WeakMap<Element, number>();
  // The spreadsheet table the user last interacted with via its editor
  // overlay (see enhanceTable() below). Clicking/typing there happens in
  // the main document, outside TinyMCE's iframe, so editor.selection never
  // naturally points at that (hidden) table the way it would for an
  // ordinary table -- table-scoped actions like indent/outdent that derive
  // their target from editor.selection.getNode() fall back to this instead.
  let lastActiveSpreadsheetTable: HTMLTableElement | null = null;
  // The real table has no visible selected-state of its own to show (it's
  // hidden entirely behind its overlay) -- toggled onto whichever
  // overlay's table is now lastActiveSpreadsheetTable, so clicking a
  // spreadsheet's own toggle bar or grid gives some visible sign of which
  // one a toolbar action or keystroke will actually affect, the way
  // clicking an ordinary table would visibly select it.
  const setActiveSpreadsheetTable = (table: HTMLTableElement | null): void => {
    lastActiveSpreadsheetTable = table;
    spreadsheetOverlays.forEach(({ el }, otherTable) => {
      el.classList.toggle('is-active-table', otherTable === table);
    });
  };
  // jspreadsheet-ce appends its context menu as a child of its own root
  // element -- itself nested inside .elabftw-spreadsheet-editor-overlay,
  // which is deliberately kept *below* TinyMCE's sticky toolbar
  // (z-index:1 vs .tox-editor-header's 2) so a table scrolled up near it
  // renders behind it, not on top. That overlay is its own stacking
  // context, though: no z-index on the menu itself, however high, can
  // ever escape above an element outside that context -- the menu was
  // stuck behind the toolbar right along with it. Bumped only while a
  // menu is actually open, on whichever overlay it belongs to.
  let openContextMenuOverlay: HTMLElement | null = null;
  const closeAnyOpenContextMenuOverlay = (): void => {
    openContextMenuOverlay?.classList.remove('has-open-context-menu');
    openContextMenuOverlay = null;
  };
  const openStandardTableDialog = (): void => {
    editor.windowManager.open({
      title: 'Insert table',
      body: {
        type: 'panel',
        items: [
          { type: 'input', name: 'rows', label: 'Rows', inputMode: 'numeric' },
          { type: 'input', name: 'columns', label: 'Columns', inputMode: 'numeric' },
        ],
      },
      initialData: { rows: '3', columns: '3' },
      buttons: [
        { type: 'cancel', text: 'Cancel' },
        { type: 'submit', text: 'Insert', buttonType: 'primary' },
      ],
      onSubmit: api => {
        const data = api.getData();
        const rows = Math.max(1, Math.min(100, Number.parseInt(data.rows, 10) || 3));
        const columns = Math.max(1, Math.min(100, Number.parseInt(data.columns, 10) || 3));
        editor.execCommand('mceInsertTable', false, { rows, columns });
        api.close();
      },
    });
  };
  const openInlineSpreadsheet = (
    initial: SpreadsheetData,
    existingTable: HTMLTableElement | null = null,
  ): void => {
    const bookmark = editor.selection.getBookmark(2, true);
    openSpreadsheetModal(initial, existingTable !== null).then(({ raw, computed }) => {
      // Saving over a table that's already in the document: update that
      // SAME node in place (like the inline overlay's own edits do)
      // rather than replacing it with a freshly-parsed one. Replacing it
      // used to orphan the live overlay -- built and keyed on the old
      // node -- leaving it showing stale content indefinitely, since
      // nothing pointed it at the new node afterward.
      if (existingTable && existingTable.isConnected) {
        if (applySpreadsheetHtmlToTable(existingTable, spreadsheetToHTML(raw, computed))) {
          editor.undoManager.add();
          editor.setDirty(true);
          // See the identical comment on commitOverlayChange -- the popup
          // is also outside the editor body, so this save needs to reset
          // the same autosave timer itself.
          editor.dispatch('keyup');
          refreshTableOverlay(existingTable);
        }
        return;
      }
      // A marker attribute (stripped right after) reliably identifies the
      // table this specific insert placed, regardless of where TinyMCE
      // leaves the selection afterward -- more robust than trying to read
      // it back from editor.selection.getNode().
      const html = spreadsheetToHTML(raw, computed).replace(
        '<table class="elabftw-spreadsheet"',
        '<table class="elabftw-spreadsheet" data-just-inserted="1"',
      );
      editor.focus();
      editor.selection.moveToBookmark(bookmark);
      editor.execCommand('mceInsertContent', false, html);
      // A table with nothing after it leaves no click target below itself --
      // clicking in the empty space under a trailing table does nothing,
      // since there's no element there for the cursor to land in. Only when
      // it has no following sibling, add an empty paragraph after it so a
      // click there always has somewhere to put the cursor.
      const insertedTable = editor.dom.select('table[data-just-inserted="1"]')[0] as
        | HTMLTableElement
        | undefined;
      if (insertedTable) {
        insertedTable.removeAttribute('data-just-inserted');
        if (!insertedTable.nextElementSibling) {
          const paragraph = editor.dom.create('p', {}, '<br data-mce-bogus="1">');
          insertedTable.parentNode?.insertBefore(paragraph, insertedTable.nextSibling);
        }
      }
      editor.undoManager.add();
    }).catch(() => {
      // User cancelled.
    });
  };

  // Send a table already in the main text to the standalone Spreadsheet
  // Editor iframe (spreadsheet-editor.html), reusing the same
  // 'jss-load-workbook' message the "load an uploaded file" path already
  // sends (see loadInSpreadsheetEditor in spreadsheet-utils.ts). Unlike that
  // path, there's no upload behind this yet, so uploadId stays null -- the
  // editor's own Save button creates a new attachment on first save.
  const openInStandaloneSpreadsheetEditor = (table: HTMLTableElement): void => {
    const iframe = document.getElementById('spreadsheetIframe') as HTMLIFrameElement | null;
    if (!iframe?.contentWindow) return;
    const extracted = extractFromTable(table);
    const worksheets = [{ name: extracted.caption || 'Sheet1', data: extracted.data }];
    const panelBody = document.getElementById('spreadsheetEditorDiv');
    if (panelBody?.hasAttribute('hidden')) {
      document.querySelector<HTMLElement>('[data-toggle-target="spreadsheetEditorDiv"]')?.click();
    }
    iframe.contentWindow.postMessage(
      { type: 'jss-load-workbook', detail: { worksheets, name: null, uploadId: null } },
      window.location.origin,
    );
    iframe.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  editor.ui.registry.addMenuButton('inline-sheet', {
    icon: 'elabftw-spreadsheet-formula',
    tooltip: 'Insert or edit a formula spreadsheet',
    fetch: callback => {
      const existingTable = editor.selection.getNode()
        .closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
      const items = [];
      if (existingTable) {
        items.push({
          type: 'menuitem' as const,
          text: 'Edit selected spreadsheet',
          icon: 'edit-block',
          onAction: () => openInlineSpreadsheet(extractFromTable(existingTable), existingTable),
        });
        items.push({
          type: 'menuitem' as const,
          text: 'Autofit column widths',
          onAction: () => {
            autofitSpreadsheetColumns(existingTable);
            editor.nodeChanged();
          },
        });
        items.push({
          type: 'menuitem' as const,
          text: 'Autofit row heights',
          onAction: () => {
            autofitSpreadsheetRows(existingTable);
            editor.nodeChanged();
          },
        });
        items.push({ type: 'separator' as const });
      }

      items.push(
        {
          type: 'menuitem' as const,
          text: 'Custom size…',
          icon: 'elabftw-spreadsheet-formula',
          onAction: () => openInlineSpreadsheet(emptySpreadsheetData(), existingTable),
        },
        {
          type: 'menuitem' as const,
          text: 'Benchling-style data table',
          icon: 'elabftw-data-table',
          onAction: () => openInlineSpreadsheet(createNotebookSpreadsheetData(), existingTable),
        },
        {
          type: 'nestedmenuitem' as const,
          text: 'Well plate',
          icon: 'elabftw-well-plate',
          getSubmenuItems: () => WELL_PLATE_PRESETS.map(preset => ({
            type: 'menuitem' as const,
            text: `${preset.wells}-well plate (${preset.rows} × ${preset.cols})`,
            onAction: () => openInlineSpreadsheet(
              createWellPlateSpreadsheetData(preset.wells),
              existingTable,
            ),
          })),
        },
      );
      callback(items);
    },
  });

  // Named command so the command palette can jump straight to the table
  // dialog instead of locating this menu button by its (English,
  // wording-dependent) tooltip/aria-label and merely opening its dropdown --
  // see CommandPalette.class.ts.
  editor.addCommand('elabftwInsertTable', openStandardTableDialog);

  editor.ui.registry.addMenuButton('insert-data-table', {
    icon: 'table',
    tooltip: 'Insert a table, spreadsheet or well plate',
    fetch: callback => {
      const selectedNode = editor.selection.getNode();
      const selectedCell = selectedNode.closest('td,th') as HTMLTableCellElement | null;
      const activeSpreadsheetTable = lastActiveSpreadsheetTable && editor.getBody().contains(lastActiveSpreadsheetTable)
        ? lastActiveSpreadsheetTable
        : null;
      const selectedTable = (selectedNode.closest('table') as HTMLTableElement | null) ?? activeSpreadsheetTable;
      const existingTable = (selectedNode.closest('table.elabftw-spreadsheet') as HTMLTableElement | null)
        ?? activeSpreadsheetTable;
      const items = [];
      if (existingTable) {
        items.push({
          type: 'menuitem' as const,
          text: 'Edit selected spreadsheet…',
          icon: 'edit-block',
          onAction: () => openInlineSpreadsheet(extractFromTable(existingTable), existingTable),
        });
        // The standalone Spreadsheet Editor panel only exists on the edit
        // page (see spreadsheet-editor.html); hidden entirely elsewhere.
        if (document.getElementById('spreadsheetIframe')) {
          items.push({
            type: 'menuitem' as const,
            text: 'Open in Spreadsheet Editor…',
            icon: 'table',
            onAction: () => openInStandaloneSpreadsheetEditor(existingTable),
          });
        }
        items.push({
          type: 'menuitem' as const,
          text: 'Autofit column widths',
          onAction: () => {
            autofitSpreadsheetColumns(existingTable);
            editor.nodeChanged();
          },
        });
        items.push({
          type: 'menuitem' as const,
          text: 'Autofit row heights',
          onAction: () => {
            autofitSpreadsheetRows(existingTable);
            editor.nodeChanged();
          },
        });
        items.push({ type: 'separator' as const });
      }
      items.push({
        type: 'menuitem',
        text: 'Table…',
        icon: 'table',
        onAction: openStandardTableDialog,
      },
      {
        type: 'nestedmenuitem',
        text: 'Spreadsheet',
        icon: 'elabftw-spreadsheet-formula',
        getSubmenuItems: () => [
          {
            type: 'menuitem',
            text: 'Custom spreadsheet…',
            icon: 'elabftw-spreadsheet-formula',
            onAction: () => openInlineSpreadsheet(emptySpreadsheetData()),
          },
          {
            type: 'menuitem',
            text: 'Benchling-style data table',
            icon: 'elabftw-data-table',
            onAction: () => openInlineSpreadsheet(createNotebookSpreadsheetData()),
          },
        ],
      },
      {
        type: 'nestedmenuitem',
        text: 'Well plate',
        icon: 'elabftw-well-plate',
        getSubmenuItems: () => WELL_PLATE_PRESETS.map(preset => ({
          type: 'menuitem',
          text: `${preset.wells}-well plate (${preset.rows} × ${preset.cols})`,
          onAction: () => openInlineSpreadsheet(createWellPlateSpreadsheetData(preset.wells)),
        })),
      });
      if (selectedTable) {
        items.push(
          { type: 'separator' as const },
          {
            type: 'menuitem' as const,
            text: 'Table style…',
            onAction: () => editor.execCommand('mceTableProps'),
          },
        );
        if (selectedCell) {
          items.push({
            type: 'menuitem' as const,
            text: 'Cell style…',
            onAction: () => editor.execCommand('mceTableCellProps'),
          });
        }
        if (tableIndentation.canOutdent(selectedTable)) {
          items.push({
            type: 'menuitem' as const,
            text: 'Outdent table',
            icon: 'outdent',
            onAction: () => tableIndentation.outdentSelectedTable(),
          });
        }
        if (tableIndentation.canIndent(selectedTable)) {
          items.push({
            type: 'menuitem' as const,
            text: 'Indent table to align with nested bullets',
            icon: 'indent',
            onAction: () => tableIndentation.indentSelectedTable(),
          });
        }
        const tableIsSortable = selectedTable.dataset.tableSort === 'true';
        items.push({
          type: 'menuitem' as const,
          text: tableIsSortable ? 'Remove table sorting' : 'Make table sortable',
          icon: 'sort-amount-down-alt',
          onAction: () => {
            if (tableIsSortable) {
              delete selectedTable.dataset.tableSort;
            } else {
              if (!isSortable(selectedTable, true)) {
                editor.focus();
                return;
              }
              selectedTable.dataset.tableSort = 'true';
            }
            editor.undoManager.add();
            editor.focus();
          },
        });
      }
      callback(items);
    },
  });

  editor.on('dblclick', event => {
    const target = (event.target as HTMLElement)
      .closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
    if (target) openInlineSpreadsheet(extractFromTable(target), target);
  });

  // Read-only jspreadsheet-ce overlay for spreadsheet tables while editing --
  // matches activateLazySpreadsheetViews()'s fix to the view page, but the
  // table living inside TinyMCE's content can never be replaced or mutated
  // directly here: whatever is in that DOM is exactly what editor.getContent()
  // serializes and saves. So the real table is left completely untouched
  // (only hidden via a stylesheet rule scoped to the editor's own iframe
  // document, never touching the table's own attributes) while a live,
  // read-only grid renders as a plain overlay positioned in the MAIN
  // document, tracked to the table's on-screen rect every animation frame.
  // Double-clicking the overlay opens the same edit modal as the dblclick
  // handler above -- it needs its own listener for that (see enhanceTable()).
  const spreadsheetOverlays = new Map<HTMLTableElement, { el: HTMLElement; destroy: () => void }>();
  const enhancedTables = new WeakSet<HTMLTableElement>();
  let overlaySyncRunning = false;
  // One persistent spacer per table, reserving room below it for the
  // overlay's own extra chrome (see syncOverlayPositions). Tracked here
  // instead of re-detected each frame by "is my next sibling already a
  // spacer": typing a new paragraph (e.g. pressing Enter) right after the
  // table inserts it *between* the table and that spacer, so the next
  // frame's sibling check no longer found it, created a whole new one
  // in its place, and never cleaned up the original -- now orphaned,
  // sitting wherever it ended up, permanently taking up space. Each one
  // more Enter press added another. Node.after() on an element already
  // in the DOM *moves* it rather than duplicating it, so reusing the
  // same tracked node and just repositioning it every frame is self-
  // healing regardless of what got typed around it.
  const spreadsheetSpacers = new WeakMap<HTMLTableElement, HTMLElement>();
  // mceAutoResize actually resizes the iframe synchronously -- calling it
  // every single time the spacer's measured height changes by even a
  // sub-pixel (routine float jitter from one rAF frame to the next, not
  // just genuine settling) turned typing into a resize storm: every
  // keystroke forced a full iframe reflow, which visibly scrolled the
  // page away from the table the user was typing into and dropped
  // keystrokes outright. Debounced instead -- the spacer's own height
  // (cheap, just a style write) still updates every frame for the
  // position sync above, but the expensive resize call only actually
  // runs once height has stopped changing for a short moment.
  let autoResizeDebounce: ReturnType<typeof setTimeout> | null = null;

  const getEditorIframe = (): HTMLIFrameElement | null =>
    document.getElementById(`${editor.id}_ifr`) as HTMLIFrameElement | null;

  // Tears down the jspreadsheet-ce instance and removes its overlay, but
  // leaves the table under intersectionObserver's watch (see below) so it
  // gets a fresh overlay again if scrolled back into view -- a long
  // document with many spreadsheets otherwise keeps every one of them
  // live (and re-measured every animation frame, see syncOverlayPositions)
  // for the rest of the editing session regardless of whether any of them
  // are still on screen.
  const removeOverlay = (table: HTMLTableElement): void => {
    const entry = spreadsheetOverlays.get(table);
    if (!entry) return;
    entry.destroy();
    entry.el.remove();
    spreadsheetOverlays.delete(table);
    enhancedTables.delete(table);
  };

  const syncOverlayPositions = (): void => {
    const iframe = getEditorIframe();
    if (!iframe || spreadsheetOverlays.size === 0) {
      overlaySyncRunning = false;
      return;
    }
    // The requestAnimationFrame reschedule below is in a `finally` so this
    // loop can never permanently die from one bad frame -- previously, any
    // uncaught exception here (e.g. a transient zero-size/detached rect
    // right when a table sits at an awkward scroll position) broke the
    // self-scheduling chain for good, since nothing else ever calls
    // ensureSyncLoop() again for tables that are already enhanced.
    // overlaySyncRunning would stay stuck at true forever too, blocking
    // ensureSyncLoop()'s own guard from ever restarting it -- every
    // existing overlay on the page would freeze in whatever position it
    // last had, unresponsive to further scrolling or resizing, exactly as
    // reported.
    try {
      const iframeRect = iframe.getBoundingClientRect();
      Array.from(spreadsheetOverlays.entries()).forEach(([table, { el: overlay }]) => {
        try {
          if (!table.isConnected || !editor.getBody().contains(table)) {
            removeOverlay(table);
            return;
          }
          const tableRect = table.getBoundingClientRect();
          overlay.style.position = 'fixed';
          // Moved via `transform`, not `top`/`left` -- Firefox treats a
          // fixed-position element whose top/left are rewritten every
          // rAF frame as a "scroll-linked positioning effect" (it warns
          // about this in the console) and can defer actually repainting
          // it at its new spot until a discrete interaction (a click)
          // forces a main-thread/compositor resync -- the inline style
          // (and everything computed from it, like this overlay's own
          // getBoundingClientRect()) is already correct in the meantime,
          // it just isn't painted there yet, exactly matching "the table
          // appears outside until I click, then it goes back inside".
          // `transform` moves are compositor-driven and don't trigger
          // that heuristic.
          overlay.style.left = '0';
          overlay.style.top = '0';
          overlay.style.transform = `translate(${iframeRect.left + tableRect.left}px, ${iframeRect.top + tableRect.top}px)`;
          // Height follows the grid's own current content (rows/columns can
          // change live as the user edits, well before the debounced commit
          // catches the -- until then stale -- real table's own rect up) --
          // width is capped at the editor's readable content column, so a
          // wide table scrolls horizontally instead of overflowing it.
          const worksheetEl = overlay.querySelector('.jss_worksheet') as HTMLElement | null;
          const toggleBarEl = overlay.querySelector('.elabftw-spreadsheet-readonly-toggle') as HTMLElement | null;
          const formulaBarEl = overlay.querySelector('.elabftw-spreadsheet-formula-bar') as HTMLElement | null;
          const formatBarEl = overlay.querySelector('.elabftw-spreadsheet-format-bar') as HTMLElement | null;
          const gridEl = overlay.querySelector('.elabftw-spreadsheet-readonly-grid') as HTMLElement | null;
          // Just the grid's own live scrollWidth, capped only by the editor's
          // content column below -- dragging a column border to widen it
          // updates scrollWidth continuously during the drag itself, well
          // before notifyChange's onresizecolumn (and the dataset cap it
          // used to keep in step) ever fires. Capping at that stale, commit-
          // only value here as well as there clipped the drag's own live
          // feedback: widening a column past whatever the cap still
          // remembered visibly did nothing until well after mouseup, if at
          // all -- looking like the resize simply didn't work.
          const naturalContentWidth = worksheetEl?.scrollWidth ?? tableRect.width;
          const maxContentWidth = editor.getBody().getBoundingClientRect().width;
          // A narrow table (few/short columns) can be narrower than the
          // toolbar bars above it -- formatBarEl has many controls and
          // wraps onto a second line once its own container is narrower
          // than its natural single-line width, which grows the overlay's
          // *height* unexpectedly (measured further below, after this
          // width is applied) and, worse, can leave the wrapped-in row of
          // controls visually overlapping whatever sits below this table
          // in the document. Measured with flex-wrap temporarily forced
          // off (its natural, unwrapped width) so the overlay is never
          // narrower than that, same as maxContentWidth is still an upper
          // bound -- a toolbar wider than the editor's own content column
          // still wraps, but that's the editor's real width limit, not a
          // layout bug.
          const measureUnwrappedWidth = (el: HTMLElement | null): number => {
            if (!el) return 0;
            const previousWrap = el.style.flexWrap;
            el.style.flexWrap = 'nowrap';
            const width = el.scrollWidth;
            el.style.flexWrap = previousWrap;
            return width;
          };
          const toolbarMinWidth = Math.max(
            measureUnwrappedWidth(formatBarEl),
            measureUnwrappedWidth(formulaBarEl),
          );
          overlay.style.width = `${Math.min(Math.max(naturalContentWidth, toolbarMinWidth), maxContentWidth)}px`;
          // Read AFTER the width above is applied, not before: setting a
          // narrower width can itself toggle the horizontal scrollbar on,
          // which changes both of these -- reading naturalContentHeight
          // beforehand measured the *previous* frame's layout while
          // scrollbarHeight already reflected the new one, occasionally
          // under-counting the scrollbar's own height by a frame and
          // leaving it overlapping the last row.
          const naturalContentHeight = worksheetEl?.scrollHeight ?? tableRect.height;
          // A horizontal scrollbar (overflow-x:auto on the grid area, needed
          // whenever the table is wider than maxContentWidth) takes up its own
          // slice of vertical space that scrollHeight above doesn't know
          // about -- measured directly (0 when no scrollbar is showing)
          // rather than guessed, since its thickness varies by OS/browser.
          // Forces a reflow, but only once per frame and only for spreadsheet
          // overlays, so the cost is negligible.
          const scrollbarHeight = gridEl ? gridEl.offsetHeight - gridEl.clientHeight : 0;
          // toggleBarEl, formulaBarEl and formatBarEl are all fixed-height
          // flex items in the same column as gridEl (flex:1 1 auto, taking
          // whatever is left over) -- this total was written before the
          // formula bar existed and never grew to include it (nor, now,
          // the cell-formatting toolbar), so gridEl's actual share of the
          // box was short by exactly their own height, cutting off that
          // much content: hiding the first row (scrolled area starting
          // short) and leaving the horizontal scrollbar overlapping the
          // last one (visible area ending short), at once.
          const overlayHeight = naturalContentHeight + scrollbarHeight
            + (toggleBarEl?.offsetHeight ?? 0) + (formulaBarEl?.offsetHeight ?? 0) + (formatBarEl?.offsetHeight ?? 0);
          overlay.style.height = `${overlayHeight}px`;
          // The real table -- hidden, but still in normal document flow --
          // only ever reserves space for its own rows; it has no idea the
          // overlay standing in for it is taller by the toggle/formula/
          // format bars' combined height. Whatever follows the table in
          // the document (the next paragraph, a date heading) sat right
          // where the table's own flow ended, which the overlay's own
          // extra chrome then visibly overlapped.
          //
          // Fixed with a dedicated spacer element instead of a margin on
          // the table itself: the table is what editor.getContent()
          // actually serializes on save, so a style set directly on it
          // would get saved as part of the entry's own content. This
          // spacer is data-mce-bogus="1" -- TinyMCE's own marker for "in
          // the DOM, never in saved output" -- the same technique already
          // used just below for the empty paragraph after a trailing
          // table, reused here for the same reason.
          //
          // Sized as (overlay height - the real table's own current flow
          // height), not just the three bars' combined height on its own:
          // the real table's own row rendering doesn't necessarily match
          // jspreadsheet's grid pixel-for-pixel (different cell padding/
          // font metrics), so assuming its flow height equals the grid's
          // naturalContentHeight alone double-counted that mismatch on top
          // of the bars, reserving more than was actually needed.
          let spacer = spreadsheetSpacers.get(table);
          if (!spacer || !spacer.isConnected) {
            spacer = editor.dom.create('div', { 'data-mce-bogus': '1', 'data-elabftw-spreadsheet-spacer': '1' });
            spreadsheetSpacers.set(table, spacer);
          }
          // Always reposition, even when it was already the very next
          // sibling: .after() on a node already there is a no-op move,
          // cheap, and guarantees it can never drift or duplicate.
          table.after(spacer);
          const spacerHeight = Math.max(0, overlayHeight - tableRect.height);
          // mceAutoResize (the iframe's own outer box height) is only
          // force-called from tinymce.ts at a few fixed checkpoints after
          // init (a short setTimeout, a requestAnimationFrame, and once web
          // fonts are ready) -- if this spacer's real height (which is what
          // actually needs to be reflected in the iframe's own resize, not
          // just the real table's un-chromed one) isn't done changing by
          // the last of those checkpoints -- e.g. jspreadsheet's own grid
          // still settling its rows/columns, or a spreadsheet inserted
          // live well after those checkpoints already fired once -- the
          // iframe stays permanently too short: not a one-frame flash, a
          // lasting misalignment, exactly as reported ("still doesn't work
          // ... doesn't extend to the height of the table"). Forcing the
          // resize here too, right whenever this spacer's own height
          // actually changes, means it keeps re-firing for as long as the
          // spacer is still settling, with no dependency on fixed timing
          // elsewhere -- and is a no-op call otherwise (skipped whenever
          // the height is already correct), so it doesn't run every frame.
          if (spacer.dataset.lastHeight !== String(spacerHeight)) {
            spacer.dataset.lastHeight = String(spacerHeight);
            spacer.style.height = `${spacerHeight}px`;
            if (autoResizeDebounce !== null) clearTimeout(autoResizeDebounce);
            autoResizeDebounce = setTimeout(() => {
              autoResizeDebounce = null;
              // mceAutoResize can drag the page's scroll position back
              // toward wherever TinyMCE's own internal selection/cursor
              // last actually sat -- typing into this overlay's cell never
              // moves that (the overlay is a plain input outside TinyMCE's
              // own contenteditable entirely), so if the user last clicked
              // into the real editor body near an earlier table, every
              // resize this debounce fires while editing a *later* one
              // visibly yanked the page back toward that stale spot ("it
              // takes me to the first table"). Restoring the scroll
              // position right after the call neutralizes that regardless
              // of the exact internal reason, without needing to fight
              // TinyMCE's own selection handling directly.
              // Also restores whatever actually had focus (almost always
              // the overlay's own cell input while this fires) -- losing
              // that to TinyMCE's own body is worse than the scroll jump
              // on its own: with focus no longer in any text input, the
              // very next keystroke can fall through to a global keyboard
              // shortcut instead of the cell (e.g. toggling the sidebar
              // shut, if that shortcut's key is what got typed next).
              const scrollX = window.scrollX;
              const scrollY = window.scrollY;
              const focused = document.activeElement as HTMLElement | null;
              editor.execCommand('mceAutoResize');
              window.scrollTo(scrollX, scrollY);
              if (focused && document.activeElement !== focused && document.contains(focused)) {
                focused.focus();
              }
            }, 200);
          }
          // A zero-size rect means the real table isn't actually visible right
          // now (e.g. inside a collapsed <details>) -- hide the overlay rather
          // than pin it to a stale, meaningless position.
          overlay.style.display = (tableRect.width === 0 && tableRect.height === 0) ? 'none' : '';
        } catch (error) {
          console.error('Failed to sync a spreadsheet overlay\'s position', error);
        }
      });
    } finally {
      window.requestAnimationFrame(syncOverlayPositions);
    }
  };

  const ensureSyncLoop = (): void => {
    if (overlaySyncRunning) return;
    overlaySyncRunning = true;
    window.requestAnimationFrame(syncOverlayPositions);
  };

  // Applies freshly-generated spreadsheet HTML onto an existing table node
  // in place (attributes + innerHTML only, never replacing the node
  // itself), so neither the table's identity nor anything keyed on it
  // (the overlay tracking Maps, a closure capturing this exact element)
  // needs to change -- used by both the inline overlay's own edits and
  // the popup editor's save, so the two paths can never drift apart from
  // writing the same logical table two different ways.
  const applySpreadsheetHtmlToTable = (table: HTMLTableElement, html: string): boolean => {
    const parsed = document.createElement('div');
    parsed.innerHTML = html;
    const freshTable = parsed.querySelector('table.elabftw-spreadsheet');
    if (!freshTable) return false;
    Array.from(table.attributes).forEach(attr => table.removeAttribute(attr.name));
    Array.from(freshTable.attributes).forEach(attr => table.setAttribute(attr.name, attr.value));
    table.innerHTML = freshTable.innerHTML;
    return true;
  };

  // Writes an in-overlay edit back into the real (hidden) table, in place.
  // Only the table's own attributes/innerHTML are touched, which is exactly
  // what editor.getContent() serializes -- correct by construction.
  const commitOverlayChange = (table: HTMLTableElement, data: SpreadsheetData): void => {
    if (!applySpreadsheetHtmlToTable(table, spreadsheetToHTML(data, data.displayData ?? data.data))) return;
    editor.undoManager.add();
    editor.setDirty(true);
    // The editor's own 7-second autosave (tinymce.ts) resets its timer on
    // native keyup/keydown against the editor body -- typing into this
    // overlay (outside that body entirely; a position:fixed div in the
    // main document, not the iframe) never fires those, so autosave never
    // saw this edit at all. 'keyup' is what that timer actually listens
    // for; dispatching it programmatically resets the same timer as if
    // this had been typed directly into the editor.
    editor.dispatch('keyup');
  };

  // Tears down and rebuilds the live overlay for a table whose underlying
  // data just changed from outside the overlay itself (the popup editor
  // saving over it) -- otherwise the overlay keeps showing whatever it had
  // extracted at mount time, silently stale until the table next scrolls
  // out and back into view (or the page reloads).
  const refreshTableOverlay = (table: HTMLTableElement): void => {
    removeOverlay(table);
    enhanceTable(table);
  };

  const enhanceTable = (table: HTMLTableElement): void => {
    if (enhancedTables.has(table)) return;
    enhancedTables.add(table);
    // Editable in place (typing, insert/delete row/column, drag-resize a
    // column/row border) -- the same jspreadsheet-ce engine and event
    // hooks the popup itself uses, just live instead of commit-on-close.
    // Double-click is left to jspreadsheet's own default (start editing
    // the cell under the cursor) rather than opening the popup, which
    // would conflict with it -- the popup (formulas, appearance panel,
    // whole-row/column tools) is reachable via the small icon in the
    // toggle bar instead.
    // Set once buildReadOnlySpreadsheetHost returns below -- referenced
    // from inside onOpenFullEditor, one of the very options passed to it.
    let flushOverlay: (() => void) | null = null;
    const { host: overlay, flush, destroy } = buildReadOnlySpreadsheetHost(extractFromTable(table), {
      editable: true,
      onChange: data => commitOverlayChange(table, data),
      onOpenFullEditor: () => {
        // A cell committed less than 500ms ago can still be waiting out
        // notifyChange's debounce -- extractFromTable(table) below reads
        // the real table this overlay stands in for, which that debounce
        // hasn't written to yet, silently dropping whatever was just
        // typed (e.g. a formula) from what the popup opens with.
        flushOverlay?.();
        openInlineSpreadsheet(extractFromTable(table), table);
      },
      onDelete: () => {
        if (lastActiveSpreadsheetTable === table) setActiveSpreadsheetTable(null);
        removeOverlay(table);
        // The spacer reserving room below this table for its overlay's
        // chrome has no purpose once the table itself is gone -- unlike
        // the overlay div, it isn't rebuilt from scratch next time
        // (there won't be one), so it has to be removed explicitly here.
        spreadsheetSpacers.get(table)?.remove();
        // Undo needs the real removal to go through the editor's own
        // dom/undo manager, not a plain table.remove() -- otherwise Ctrl+Z
        // has nothing of its own to restore.
        editor.dom.remove(table);
        editor.undoManager.add();
        editor.setDirty(true);
        editor.dispatch('keyup');
      },
    });
    flushOverlay = flush;
    overlay.classList.add('elabftw-spreadsheet-editor-overlay');
    // Passive bookkeeping only (never steals focus, unlike editor.selection.
    // select() would) -- lets table-scoped actions like indent/outdent find
    // this table via lastActiveSpreadsheetTable above.
    overlay.addEventListener('mousedown', event => {
      setActiveSpreadsheetTable(table);
      // indentSelectedTable()/outdentSelectedTable() (below) read their own
      // separate internal lastSelectedTable, not the menu-display check
      // above -- both need tracking, or the menu item can show while
      // clicking it still silently does nothing.
      tableIndentation.trackSelectedTable(table);
      // Clicking the toggle bar itself (not a cell in the grid, which
      // needs its own click to reach jspreadsheet/the formula bar
      // untouched) also selects the real table in the editor's own
      // selection model -- invisible along with the table, but real as
      // far as copy/paste is concerned, so Ctrl+C now has something to
      // actually copy while the is-active-table outline is showing,
      // matching how selecting an ordinary table or image works.
      if (event.target instanceof Element && event.target.closest('.elabftw-spreadsheet-readonly-toggle')) {
        editor.selection.select(table);
        // The click landed on the overlay (outside the iframe entirely),
        // so nothing moved the browser's own focus into the editor body --
        // without it, Ctrl+C copies from wherever focus already was
        // (nothing selectable, most likely) rather than this selection.
        editor.focus();
      }
    });
    overlay.addEventListener('contextmenu', () => {
      openContextMenuOverlay = overlay;
      overlay.classList.add('has-open-context-menu');
    });
    document.body.appendChild(overlay);
    spreadsheetOverlays.set(table, { el: overlay, destroy });
    ensureSyncLoop();
  };

  // Only tables actually near the viewport get a live overlay (and join
  // the per-frame position sync above) -- one that scrolls out gets torn
  // down (removeOverlay) rather than left running forever, so a long
  // document with many spreadsheets costs roughly what's on screen, not
  // what's in the whole document.
  const observedTables = new WeakSet<HTMLTableElement>();
  const tableVisibility = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const table = entry.target as HTMLTableElement;
      if (entry.isIntersecting) {
        enhanceTable(table);
      } else {
        removeOverlay(table);
      }
    });
  }, { rootMargin: '400px 0px' });

  const enhanceAllTables = (): void => {
    Array.from(editor.getBody().querySelectorAll<HTMLTableElement>('table.elabftw-spreadsheet'))
      .forEach(table => {
        if (observedTables.has(table)) return;
        observedTables.add(table);
        tableVisibility.observe(table);
      });
  };

  // Same trailing-paragraph safeguard newInlineSpreadsheet() applies right
  // after inserting a table (see its own comment above), but for content
  // that already exists when the editor loads it (e.g. an experiment saved
  // before that safeguard existed, or from any other path that can leave a
  // table as the very last element). A spreadsheet table with nothing after
  // it is exactly the case where the editor's own auto-resize has the
  // furthest to grow once this table's overlay is measured -- the bigger
  // that jump, the more visible the moment where the overlay is still
  // positioned for the old, unresized layout. Giving it a paragraph to grow
  // into instead removes that jump at the source, rather than trying to
  // chase it with tighter position-sync timing. Bound to 'SetContent' only
  // (not 'NodeChange' too, unlike enhanceAllTables below) since this only
  // ever needs to run when content is first loaded, not on every keystroke.
  editor.on('SetContent', () => {
    Array.from(editor.getBody().querySelectorAll<HTMLTableElement>('table.elabftw-spreadsheet'))
      .forEach(table => {
        if (!table.nextElementSibling) {
          const paragraph = editor.dom.create('p', {}, '<br data-mce-bogus="1">');
          table.parentNode?.insertBefore(paragraph, table.nextSibling);
        }
      });
  });

  editor.on('SetContent NodeChange', enhanceAllTables);
  // Dispatched from tinymce.ts at the same "layout has actually settled"
  // checkpoints it uses to force an extra mceAutoResize (a short setTimeout,
  // a requestAnimationFrame, and once web fonts are ready). Once any
  // overlay exists, the continuous per-frame loop below (syncOverlayPositions
  // rescheduling itself via requestAnimationFrame) already re-measures fresh
  // every frame, so its very next tick already reflects whatever the
  // settling checkpoint just corrected -- no need to force a second,
  // parallel sync pass here (calling syncOverlayPositions() directly would
  // just spawn a second self-rescheduling rAF chain alongside the existing
  // one, doubling the sync rate for good rather than fixing anything). The
  // gap this actually closes is enhanceTable() itself never having run yet
  // (gated on IntersectionObserver visibility, which can land before the
  // surrounding chrome has settled) -- re-scanning for not-yet-enhanced
  // tables here covers that.
  window.addEventListener('elabftw-spreadsheet-resync', enhanceAllTables);
  editor.on('remove', () => {
    tableVisibility.disconnect();
    Array.from(spreadsheetOverlays.keys()).forEach(removeOverlay);
    window.removeEventListener('elabftw-spreadsheet-resync', enhanceAllTables);
    // A pending debounced mceAutoResize (see syncOverlayPositions) has
    // nothing left to act on once the editor itself is gone -- calling
    // execCommand on a destroyed editor, or trying to refocus an element
    // that's since been torn down along with it, has no reason to run at
    // all at that point.
    if (autoResizeDebounce !== null) {
      clearTimeout(autoResizeDebounce);
      autoResizeDebounce = null;
    }
  });

  editor.on('ObjectResizeStart', event => {
    const resizing = event as unknown as { height?: number; width?: number; target?: Element };
    if (resizing.target && Number.isFinite(resizing.height)) {
      resizeStartHeights.set(resizing.target, resizing.height as number);
    }
    if (resizing.target && Number.isFinite(resizing.width)) {
      resizeStartWidths.set(resizing.target, resizing.width as number);
    }
  });

  editor.on('ObjectResized', event => {
    const resized = event as unknown as { height?: number; width?: number; target?: Element };
    const table = resized.target?.closest?.('table.elabftw-spreadsheet') as HTMLTableElement | null;
    if (!table) return;

    const startHeight = resizeStartHeights.get(table);
    const startWidth = resizeStartWidths.get(table);
    resizeStartHeights.delete(table);
    resizeStartWidths.delete(table);

    // Not restricted to corner-origin drags: a pure edge drag (width or
    // height only) deserves the same redistribution as a corner drag.
    let changed = false;
    if (Number.isFinite(resized.height)
      && (!Number.isFinite(startHeight) || Math.abs((resized.height as number) - (startHeight as number)) >= 1)
    ) {
      resizeSpreadsheetRowsFromTableHeight(table, resized.height as number);
      changed = true;
    }
    if (Number.isFinite(resized.width)
      && (!Number.isFinite(startWidth) || Math.abs((resized.width as number) - (startWidth as number)) >= 1)
    ) {
      resizeSpreadsheetColumnsFromTableWidth(table, resized.width as number);
      changed = true;
    }
    if (changed) editor.nodeChanged();
  });

  // Keep a row's height, and the edited cell's column width, following
  // content as you type, the same way Excel does without any explicit
  // resize action. rAF-deferred: the DOM hasn't reflowed to the new content
  // yet at the moment 'input' fires.
  editor.on('input', () => {
    const node = editor.selection.getNode();
    const row = node.closest('table.elabftw-spreadsheet tr') as HTMLTableRowElement | null;
    if (!row) return;
    const cell = node.closest('table.elabftw-spreadsheet td, table.elabftw-spreadsheet th') as HTMLTableCellElement | null;
    window.requestAnimationFrame(() => {
      growSpreadsheetRowToFitContent(row);
      if (cell) growSpreadsheetColumnToFitCell(cell);
    });
  });

  editor.on('init', () => {
    const editorDocument = editor.getDoc();
    // Hides the real table this editor overlay stands in for -- a
    // stylesheet rule scoped to the iframe's own document, so it never
    // touches the table's own class/style attributes (which would
    // otherwise get serialized into the saved content).
    const hideSpreadsheetTablesStyle = editorDocument.createElement('style');
    // max-width too, not just visibility: hidden -- a many-column table
    // still lays out at its own full natural width even while invisible,
    // which can push the editor body (and the outer page around it) wider
    // than the viewport on its own, well past what the visible overlay
    // (capped to the content column's own width, see maxContentWidth in
    // syncOverlayPositions) ever shows. That extra page-level horizontal
    // scroll room is what let TinyMCE's own sticky toolbar -- positioned
    // to track the editor's live horizontal offset -- visibly drift off
    // to one side while scrolling, instead of the editor simply staying
    // put because there was nothing wider than the viewport to scroll to.
    hideSpreadsheetTablesStyle.textContent = 'table.elabftw-spreadsheet { visibility: hidden; max-width: 100%; }';
    editorDocument.head.appendChild(hideSpreadsheetTablesStyle);
    editor.on('remove', () => hideSpreadsheetTablesStyle.remove());
    // jspreadsheet-ce closes its own context menu (and clears its own
    // selection) on mousedown against `document` -- but that's the
    // *outer* page document the overlay itself lives in, not this
    // editor's own iframe document, which is a separate document object
    // with its own independent event propagation. A click on the main
    // text inside the editor never reaches that outer listener, so a
    // context menu opened on an overlay's grid stayed open forever once
    // the user clicked back into the text. Relay it manually.
    const relayMousedownToCloseMenus = (): void => {
      // Dispatched on document.body, not `document` itself: jspreadsheet-
      // ce's own mouseDownControls reads e.target.classList without
      // checking it exists first, and a Document object (which is what
      // e.target becomes for an event dispatched directly on `document`)
      // has no classList at all -- throwing a TypeError on every single
      // relay (every click in the main text, every scroll event on either
      // side) that corrupted jspreadsheet's own mouse-tracking state
      // machine partway through, symptoms including an overlay frozen in
      // place no longer responding to further scrolling or resizing.
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    };
    editorDocument.addEventListener('mousedown', relayMousedownToCloseMenus);
    // jspreadsheet-ce also tracks an active column/row resize drag via its
    // own mousemove/mouseup listeners on that same outer `document` (see
    // mouseMoveControls/mouseUpControls in jspreadsheet-ce's source) --
    // dragging a column border wider is a drag that starts on the overlay
    // (outer document) but, since the overlay's own width only grows to
    // fit *after* the fact (see syncOverlayPositions), a fast drag can
    // outrun it and cross onto the iframe surface sitting right behind/
    // around the overlay. From there the mousemove fires in this iframe's
    // own separate document and never reaches jspreadsheet's listener at
    // all, silently ending the drag -- reported as widening a column past
    // wherever the overlay's edge still was simply stopping.
    // clientX/Y in an iframe's own event are relative to *that* document;
    // translating by the iframe's current rect is what jspreadsheet's own
    // e.pageX-based resize math actually needs from the outer document's
    // perspective.
    const relayMouseMoveForActiveDrag = (event: MouseEvent): void => {
      if (event.buttons === 0) return;
      const iframeRect = getEditorIframe()?.getBoundingClientRect();
      if (!iframeRect) return;
      // Same document.body target as relayMousedownToCloseMenus above, and
      // for the same reason -- dispatching directly on `document` gives
      // jspreadsheet-ce's own mouseMoveControls/mouseUpControls a Document
      // as e.target, which has no classList.
      document.body.dispatchEvent(new MouseEvent(event.type, {
        bubbles: true,
        clientX: iframeRect.left + event.clientX,
        clientY: iframeRect.top + event.clientY,
        buttons: event.buttons,
      }));
    };
    editorDocument.addEventListener('mousemove', relayMouseMoveForActiveDrag);
    editorDocument.addEventListener('mouseup', relayMouseMoveForActiveDrag);
    // jspreadsheet-ce's context menu is positioned once, at the viewport
    // coordinates of the click that opened it -- it has no reason to know
    // about the *table's* own position updating every frame in
    // syncOverlayPositions as the page scrolls (the menu isn't part of
    // that table's own overlay positioning, it's appended standalone), so
    // a scroll leaves the menu visually pinned to where the cursor *was*
    // relative to the content that has since moved underneath it, i.e.
    // it looks like it's tracking the mouse across the scrolled page.
    // Simplest correct behavior: just close it, same as any other
    // "something happened elsewhere" dismissal already wired above.
    window.addEventListener('scroll', relayMousedownToCloseMenus, { capture: true, passive: true });
    editorDocument.addEventListener('scroll', relayMousedownToCloseMenus, { capture: true, passive: true });
    // Drops the z-index bump (see closeAnyOpenContextMenuOverlay's own
    // comment) on every one of the same "close the menu" triggers above --
    // the synthetic mousedown relayMousedownToCloseMenus dispatches on
    // `document` reaches this too, so a click in the main text or a
    // scroll on either side already covers it without extra wiring.
    document.addEventListener('mousedown', closeAnyOpenContextMenuOverlay);
    // The is-active-table outline (see setActiveSpreadsheetTable) only
    // ever gets turned ON, by a table's own overlay's mousedown handler --
    // nothing turned it back off for a click that lands anywhere else,
    // including the relayed synthetic mousedown above for a click in the
    // main text, so it stayed showing on whichever table was clicked last
    // no matter where the user clicked afterward. Re-derives "was this
    // actually on a spreadsheet overlay" itself rather than depending on
    // event ordering against the overlay's own listener.
    const clearActiveTableUnlessClickedOnOne = (event: MouseEvent): void => {
      const clickedOverlay = event.target instanceof Element
        && !!event.target.closest('.elabftw-spreadsheet-editor-overlay');
      if (!clickedOverlay) setActiveSpreadsheetTable(null);
    };
    document.addEventListener('mousedown', clearActiveTableUnlessClickedOnOne);
    editor.on('remove', () => {
      editorDocument.removeEventListener('mousedown', relayMousedownToCloseMenus);
      editorDocument.removeEventListener('mousemove', relayMouseMoveForActiveDrag);
      editorDocument.removeEventListener('mouseup', relayMouseMoveForActiveDrag);
      window.removeEventListener('scroll', relayMousedownToCloseMenus, { capture: true });
      editorDocument.removeEventListener('scroll', relayMousedownToCloseMenus, { capture: true });
      document.removeEventListener('mousedown', clearActiveTableUnlessClickedOnOne);
      document.removeEventListener('mousedown', closeAnyOpenContextMenuOverlay);
    });
    const spreadsheetPasteHandler = (event: ClipboardEvent): void => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const plainText = clipboard.getData('text/plain');
      const normalizedPlainText = normalizePdfPrivateUseText(plainText);
      const richClipboardHtml = clipboard.getData('text/html');
      const selectedCell = editor.selection.getNode()
        .closest('td, th') as HTMLTableCellElement | null;
      const isRichSelection = richClipboardHtml.includes(RICH_SELECTION_ATTRIBUTE);
      if (isRichSelection && (!selectedCell || !isStandaloneClipboardTable(richClipboardHtml))) {
        return;
      }
      // A mixed rich copy belongs to TinyMCE. Converting it here would retain
      // only its first table and silently discard the surrounding content.
      const containsHtmlTable = /<table[\s>]/i.test(richClipboardHtml);
      if (containsHtmlTable && !isStandaloneClipboardTable(richClipboardHtml)) return;

      const spreadsheet = spreadsheetFromClipboard(richClipboardHtml, normalizedPlainText);
      if (spreadsheet) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (selectedCell) {
          const selectedTable = selectedCell.closest('table') as HTMLTableElement | null;
          if (!selectedTable) return;
          let pastedIntoTable = false;
          editor.undoManager.transact(() => {
            if (selectedTable.classList.contains('elabftw-spreadsheet')) {
              pastedIntoTable = replaceFormulaSpreadsheetRange(
                editor,
                selectedTable,
                selectedCell,
                spreadsheet,
              );
              return;
            }
            const lastCell = pasteIntoHtmlTable(selectedTable, selectedCell, spreadsheet);
            if (lastCell) {
              editor.selection.setCursorLocation(lastCell, lastCell.childNodes.length);
              pastedIntoTable = true;
            }
          });
          if (!pastedIntoTable) {
            editor.notificationManager.open({
              text: tableHasMergedCells(selectedTable)
                ? 'Pasting a cell range into a table with merged cells is not supported.'
                : 'The copied cells could not be pasted at this table position.',
              type: 'warning',
              timeout: 3500,
            });
          }
          return;
        }
        editor.undoManager.transact(() => {
          editor.insertContent(spreadsheetToHTML(spreadsheet, spreadsheet.data));
        });
        return;
      }

      const flattened = getFlattenedClipboardSuggestion(normalizedPlainText);
      if (!flattened) {
        if (normalizedPlainText === plainText) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        editor.undoManager.transact(() => {
          editor.insertContent(escapeHTML(normalizedPlainText).replace(/\r?\n/g, '<br>'));
        });
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      const bookmark = editor.selection.getBookmark(2, true);
      editor.windowManager.open({
        title: 'Paste PDF table',
        size: 'normal',
        body: {
          type: 'panel',
          items: [{
            type: 'input',
            name: 'columns',
            label: `${flattened.cells} clipboard cells — number of columns`,
          }],
        },
        initialData: { columns: String(flattened.columns) },
        buttons: [
          { type: 'cancel', text: 'Cancel' },
          { type: 'submit', text: 'Paste table', primary: true },
        ],
        onSubmit: api => {
          const data = api.getData() as PdfTableDialogData;
          const columns = parseInt(data.columns, 10);
          if (!Number.isInteger(columns) || columns < 2 || columns > 100) {
            editor.notificationManager.open({
              text: 'Enter a column count between 2 and 100.',
              type: 'error',
              timeout: 2500,
            });
            return;
          }
          const recovered = spreadsheetFromFlattenedClipboard(
            normalizedPlainText,
            columns,
            richClipboardHtml,
          );
          if (!recovered) return;
          editor.focus();
          editor.selection.moveToBookmark(bookmark);
          editor.undoManager.transact(() => {
            editor.insertContent(spreadsheetToHTML(recovered, recovered.data));
          });
          api.close();
        },
      });
    };
    editorDocument.addEventListener('paste', spreadsheetPasteHandler, true);
    editor.on('remove', () => {
      editorDocument.removeEventListener('paste', spreadsheetPasteHandler, true);
    });
  });
}
