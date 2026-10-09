/** Fork-owned inline spreadsheet insertion, editing and clipboard handling. */
import { Editor } from 'tinymce/tinymce';
import {
  buildReadOnlySpreadsheetHost,
  buildSpreadsheetPreviewHost,
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
  SpreadsheetCellHistory,
  WELL_PLATE_PRESETS,
} from '../inline-spreadsheet';
import { escapeHTML } from '../misc';
import { RICH_SELECTION_ATTRIBUTE } from '../ClipboardContent';
import TableIndentation from '../TableIndentation.class';
import { isSortable } from '../TableSorting.class';
import { captureSpreadsheetPositions, restoreSpreadsheetPositions } from './SpreadsheetUndo';
import { createSpreadsheetLayoutGate, createSpreadsheetProfiler, createSpreadsheetSnapshotCache } from './SpreadsheetPerformance';

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

// Like autofitSpreadsheetRows above, but for every automatic reconciliation
// after a cell edit commits rather than the explicit "Autofit row heights"
// menu action -- that one is a deliberate, unconditional reset (the whole
// point of clicking it is "I don't care about old sizes, redo them all"),
// but resetting every row that unconditionally after every single edit
// would just as readily undo a row height the user dragged on purpose.
//
// manualRowHeights is the just-committed data's own rowHeights (pass
// data.rowHeights from commitOverlayChange) -- readRenderedRowHeights() in
// inline-spreadsheet.ts, what populates it, only ever records a row that
// has an *explicit* style.height/height attribute on the live overlay grid,
// which jspreadsheet only ever sets there from a genuine drag-resize, never
// merely from a cell's content wrapping onto more lines (ordinary browser
// table layout handles that without any explicit height at all). A row
// missing from it has therefore never been manually resized, and is free to
// shrink back to whatever its current content actually needs -- reported
// directly as a large gap left behind under a table whose rows had all
// gone back to looking normal, from a row still holding a taller entry's
// since-edited-or-deleted height.
function reconcileSpreadsheetRowHeights(table: HTMLTableElement, manualRowHeights: Record<string, number> | undefined): void {
  const kind = table.dataset.spreadsheetStyle;
  const rows = kind === 'notebook'
    ? Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
    : Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody > tr'));
  if (rows.length === 0) return;
  removeOuterTableHeight(table);
  // Separate layout writes from reads: measuring after each individual
  // height reset forces a new table layout for every row.
  rows.forEach(row => row.style.removeProperty('height'));
  const heights = rows.map((row, index) => {
    const manualHeight = manualRowHeights?.[String(index)];
    // A row present in manualRowHeights was genuinely drag-resized (see the
    // comment above) -- that choice wins outright, including shrinking
    // below the row's own natural content height (the same trade-off
    // Excel makes: a row can be dragged shorter than a line of text, which
    // then clips). Math.max(natural, manual) here used to win regardless,
    // which silently snapped any deliberate shrink straight back to
    // natural height in the same commit -- reported as not being able to
    // drag a row shorter than some floor. Only a row with NO manual entry
    // (never resized) falls back to natural height.
    return manualHeight === undefined
      ? Math.ceil(row.getBoundingClientRect().height)
      : Math.max(20, Math.round(manualHeight));
  });
  rows.forEach((row, index) => {
    row.style.height = `${heights[index]}px`;
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
  editor.ui.registry.addIcon('sort-amount-down-alt', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 12h8m-8-4h8m-8 8h8M6 7v10m0 0-3-3m3 3 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
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
  // Inserts a brand-new spreadsheet's HTML at the current selection -- the
  // same final step openInlineSpreadsheet's own modal-based insert uses
  // once it has raw/computed/history in hand, factored out so the grid-
  // picker fancymenuitem below (which never opens that modal at all, same
  // as "Table"'s own grid-picker skips its dialog) can reach it directly.
  const insertNewSpreadsheet = (
    data: SpreadsheetData,
    computed: SpreadsheetData['data'] = data.data,
    history: SpreadsheetCellHistory = { undo: [], redo: [] },
  ): void => {
    const bookmark = editor.selection.getBookmark(2, true);
    // A marker attribute (stripped right after) reliably identifies the
    // table this specific insert placed, regardless of where TinyMCE
    // leaves the selection afterward -- more robust than trying to read
    // it back from editor.selection.getNode().
    const html = spreadsheetToHTML(data, computed).replace(
      '<table class="elabftw-spreadsheet"',
      '<table class="elabftw-spreadsheet" data-just-inserted="1"',
    );
    editor.focus();
    editor.selection.moveToBookmark(bookmark);
    editor.execCommand('mceInsertContent', false, html);
    // A table with nothing after it leaves no click target below itself --
    // clicking in the empty space under a trailing table does nothing,
    // since there's no element there for the cursor to land in. A table
    // immediately followed by *another* table (or by anything else) has
    // the same problem in miniature: there's no gap to click into right
    // at the boundary, reported as not being able to insert text between
    // two tables placed one after another. Unconditional now -- always
    // give a freshly inserted table its own paragraph immediately after
    // it, rather than only guessing when one is "needed" from the next
    // sibling's tag, which didn't cover every case this was reported for.
    const insertedTable = editor.dom.select('table[data-just-inserted="1"]')[0] as
      | HTMLTableElement
      | undefined;
    if (insertedTable) {
      insertedTable.removeAttribute('data-just-inserted');
      const insertedUid = ensureSpreadsheetUid(insertedTable);
      tableCellHistories.set(insertedUid, history);
      latestTableContent.set(insertedUid, insertedTable.outerHTML);
      // Insertion may already have mounted an overlay with an empty
      // history. Rebind it to the history returned by the popup.
      refreshTableOverlay(insertedTable);
      const paragraph = editor.dom.create('p', {}, '<br data-mce-bogus="1">');
      insertedTable.parentNode?.insertBefore(paragraph, insertedTable.nextSibling);
      editor.selection.setCursorLocation(paragraph, 0);
    }
    editor.undoManager.add();
  };

  // Shared by the insert-data-table toolbar dropdown and the classic Insert
  // menu's own "Spreadsheet" entry (see tinymce.ts's menu.insert.items) so
  // the two can't drift apart. The grid-picker widget first -- reusing
  // TinyMCE's own built-in 'inserttable' fancymenuitem (a public,
  // documented type; its onAction receives the picked {numRows,
  // numColumns} regardless of what it inserts, so this only has to swap in
  // a spreadsheet instead of a plain table) -- gives size selection by
  // dragging over a grid of squares, exactly like "Table" already offers
  // right next to it. "Custom spreadsheet…" stays alongside it for sizes
  // the 10x10 grid can't reach, a caption, or a non-default kind.
  const buildSpreadsheetSubmenuItems = () => [
    {
      type: 'fancymenuitem' as const,
      fancytype: 'inserttable' as const,
      onAction: ({ numRows, numColumns }: { numRows: number; numColumns: number }) => {
        insertNewSpreadsheet(emptySpreadsheetData(numColumns, numRows));
      },
    },
    { type: 'separator' as const },
    {
      type: 'menuitem' as const,
      text: 'Custom spreadsheet…',
      icon: 'elabftw-spreadsheet-formula',
      onAction: () => openInlineSpreadsheet(emptySpreadsheetData()),
    },
    {
      type: 'menuitem' as const,
      text: 'Benchling-style data table',
      icon: 'elabftw-data-table',
      onAction: () => openInlineSpreadsheet(createNotebookSpreadsheetData()),
    },
  ];

  const openInlineSpreadsheet = (
    initial: SpreadsheetData,
    existingTable: HTMLTableElement | null = null,
  ): void => {
    // Every entry point (toolbar or overlay) must first finish inline edits.
    if (existingTable) spreadsheetOverlays.get(existingTable)?.flush();
    const uid = existingTable ? ensureSpreadsheetUid(existingTable) : null;
    if (uid && !tableCellHistories.has(uid)) tableCellHistories.set(uid, { undo: [], redo: [] });
    openSpreadsheetModal(
      existingTable ? extractFromTable(existingTable) : initial,
      existingTable !== null,
      uid ? tableCellHistories.get(uid) : undefined,
    ).then(({ raw, computed, history }) => {
      // Saving over a table that's already in the document: update that
      // SAME node in place (like the inline overlay's own edits do)
      // rather than replacing it with a freshly-parsed one. Replacing it
      // used to orphan the live overlay -- built and keyed on the old
      // node -- leaving it showing stale content indefinitely, since
      // nothing pointed it at the new node afterward.
      if (existingTable && existingTable.isConnected) {
        if (applySpreadsheetHtmlToTable(existingTable, spreadsheetToHTML(raw, computed))) {
          if (uid) {
            tableCellHistories.set(uid, history);
            latestTableContent.set(uid, existingTable.outerHTML);
          }
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
      insertNewSpreadsheet(raw, computed, history);
    }).catch(() => {
      // User cancelled -- the real table was never touched (the popup
      // only ever edits its own separate copy), but its inline overlay can
      // end up torn down while the popup was open (observed intermittently
      // in this exact flow, likely a timing race in the
      // visibility/geometry recheck machinery elsewhere in this file) with
      // nothing left to rebuild it, since only the success path above ever
      // did. The real table stays visibility:hidden by design -- its
      // overlay is the only visible representation -- so losing it reads
      // as the whole spreadsheet silently vanishing on Cancel, though the
      // data was never actually at risk. refreshTableOverlay() rebuilds
      // from the real table's own (untouched) content, so this is a safe,
      // idempotent no-op on the common case where the overlay was never
      // actually removed.
      if (!existingTable) return;
      // Firefox runs the "Discard unsaved changes?" confirm() with its own
      // blur/focus handling around it, and the overlay has been seen missing
      // after confirming. Rebuild now, then check again once focus and layout
      // have settled, and surface any error instead of swallowing it.
      const restoreOverlay = (): void => {
        if (!existingTable.isConnected || !editor.getBody().contains(existingTable)) return;
        try {
          const entry = spreadsheetOverlays.get(existingTable);
          if (!entry || !entry.el.isConnected) refreshTableOverlay(existingTable);
        } catch (error) {
          console.error('Could not restore the spreadsheet after Cancel', error);
        }
      };
      try {
        if (existingTable.isConnected) refreshTableOverlay(existingTable);
      } catch (error) {
        console.error('Could not restore the spreadsheet after Cancel', error);
      }
      window.requestAnimationFrame(restoreOverlay);
      window.setTimeout(restoreOverlay, 250);
      window.setTimeout(restoreOverlay, 1000);
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
        getSubmenuItems: buildSpreadsheetSubmenuItems,
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

  // Same "Spreadsheet" submenu as the insert-data-table toolbar button just
  // above, surfaced in TinyMCE's own classic Insert menu (File/Edit/View/
  // Insert/...) right alongside its native "Table" entry -- see tinymce.ts's
  // own menu.insert.items, where this item's name is placed right after
  // 'inserttable'. A plain menuitem rather than this file's own
  // openStandardTableDialog-style dialog: Custom spreadsheet/Benchling-style
  // need no dimensions upfront (openInlineSpreadsheet's own editor picks
  // that), and Table already has its own native dialog via 'inserttable'.
  editor.ui.registry.addNestedMenuItem('elabftw-insert-spreadsheet', {
    text: 'Spreadsheet',
    icon: 'elabftw-spreadsheet-formula',
    getSubmenuItems: () => [
      ...buildSpreadsheetSubmenuItems(),
      {
        type: 'nestedmenuitem',
        text: 'Well plate',
        icon: 'elabftw-well-plate',
        getSubmenuItems: () => WELL_PLATE_PRESETS.map(preset => ({
          type: 'menuitem',
          text: `${preset.wells}-well plate (${preset.rows} × ${preset.cols})`,
          onAction: () => openInlineSpreadsheet(createWellPlateSpreadsheetData(preset.wells)),
        })),
      },
    ],
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
  const spreadsheetOverlays = new Map<HTMLTableElement, {
    el: HTMLElement;
    destroy: (discardChanges?: boolean) => void;
    flush: (commitEditors?: boolean) => void;
    syncActiveEditor: () => void;
    /** Cheap static stand-in; upgraded to the real grid on first click. */
    isPreview?: boolean;
  }>();
  const enhancedTables = new WeakSet<HTMLTableElement>();
  let overlaySyncRunning = false;
  const layoutGate = createSpreadsheetLayoutGate();
  const profiler = createSpreadsheetProfiler();
  const invalidateSpreadsheetLayout = (): void => layoutGate.invalidate(performance.now());
  // Cmd/Ctrl+Z is a whole-document snapshot in TinyMCE, not a per-element
  // diff -- an undo level added for an ordinary main-text edit captures
  // the *entire* body as it stood at that moment, table content included.
  // Since a cell edit deliberately never adds its own level (see
  // commitOverlayChange's own comment), undoing back past an unrelated
  // later main-text edit reverted whatever the table looked like at that
  // earlier snapshot too -- reported directly as Ctrl+Z deleting the
  // table's own edits right along with the main-text change it was meant
  // to undo. Every enhanced table gets a stable id (persists through the
  // HTML round-trip an undo/redo replaces the body with, since it's a
  // real attribute, not a data-mce-bogus one) so its latest live content
  // can be tracked here and force-restored immediately after any Undo or
  // Redo, regardless of what that operation's own snapshot says the
  // table should look like. Stepping past insertion also preserves it:
  // spreadsheet lifetimes are independent of main-text history.
  const SPREADSHEET_UID_ATTR = 'data-elabftw-spreadsheet-uid';
  const latestTableContent = new Map<string, string>();
  const tableCellHistories = new Map<string, SpreadsheetCellHistory>();
  // Which table currently holds each id -- lets a colliding duplicate
  // (see ensureSpreadsheetUid's own comment) be told apart from the one
  // table that's genuinely always held it.
  const uidToTable = new Map<string, HTMLTableElement>();
  const generateSpreadsheetUid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const ensureSpreadsheetUid = (table: HTMLTableElement): string => {
    const existing = table.getAttribute(SPREADSHEET_UID_ATTR);
    // A fresh, internal rich copy of this exact table (see tinymce.ts'
    // paste_preprocess) preserves every attribute verbatim, id included --
    // two *different* tables sharing one id would let editing either one
    // force-restore content onto the other after an unrelated undo, so a
    // duplicate gets a new id of its own the moment it's enhanced (each
    // copy is its own independent table from here on, not a link back to
    // the original).
    // A holder that's no longer connected is a stale mapping, not a real
    // collision -- Undo/Redo (and ordinary re-enhancement after a table
    // is torn down and rebuilt) replace the DOM node wholesale while the
    // id attribute itself survives on the new node, so this is the normal
    // case right after either, not a duplicate.
    const holder = existing ? uidToTable.get(existing) : undefined;
    const isCollision = !!holder && holder !== table && holder.isConnected;
    const uid = existing && !isCollision ? existing : generateSpreadsheetUid();
    table.setAttribute(SPREADSHEET_UID_ATTR, uid);
    uidToTable.set(uid, table);
    return uid;
  };
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
  let autoResizePending = false;
  let spreadsheetInteractionActive = false;
  // commitOverlayChange() used to call editor.dispatch('keyup') unconditionally,
  // every debounced edit, to reset the editor's own autosave timer (see its
  // own comment). Dispatching a synthetic keyup directly on the editor also
  // feeds TinyMCE's *built-in* autoresize plugin, which has its own internal
  // keyup listener -- unconditional, and entirely outside the
  // spreadsheetInteractionActive guard below (that guard only wraps this
  // file's own explicit execCommand('mceAutoResize') calls). That plugin-
  // internal resize focuses the iframe as part of its layout work, exactly
  // like the guarded call does -- so it could still steal focus out of a
  // cell mid-edit (most visibly as content neared the column's width,
  // wherever the debounce happened to land), landing the next keystroke in
  // the editor body instead, right after the table. Defer the dispatch the
  // same way autoresize itself is deferred, so it fires once the user
  // actually leaves the overlay instead of while a cell is still live.
  let keyupDispatchPending = false;

  // spreadsheetInteractionActive only ever gets set from a pointerdown
  // targeting the overlay -- inline-spreadsheet.ts's own cell-edit overlay
  // (opened by typing directly over a selected cell, no click involved) is
  // a separate, later addition that never fires one. Without this, a cell
  // edit started that way was never recognized as "still interacting with
  // the spreadsheet" here, so a pending autoresize could still run mid-
  // edit -- shrinking/repositioning the iframe (and this overlay along
  // with it, via its own position-sync loop reading a mid-transition rect)
  // right while the user was typing, making the whole table appear to
  // vanish. document.body.dataset.spreadsheetCellEditing is set/cleared
  // reliably by that same overlay regardless of how the edit started.
  const spreadsheetInteractionOngoing = (): boolean =>
    spreadsheetInteractionActive || document.body.dataset.spreadsheetCellEditing === 'true';

  const runPendingAutoResize = (): void => {
    if (keyupDispatchPending && !spreadsheetInteractionOngoing()) {
      keyupDispatchPending = false;
      editor.dispatch('keyup');
    }
    if (!autoResizePending || spreadsheetInteractionOngoing()) return;
    autoResizePending = false;
    editor.execCommand('mceAutoResize');
  };

  const dispatchKeyupForAutosave = (): void => {
    if (spreadsheetInteractionOngoing()) {
      keyupDispatchPending = true;
      return;
    }
    editor.dispatch('keyup');
  };

  // Do not resize TinyMCE while jspreadsheet owns keyboard focus. TinyMCE's
  // autoresize command focuses its iframe as part of its layout work; when
  // the active grid is an overlay in the outer document, that steals focus
  // from the cell and scrolls back to TinyMCE's stale internal selection
  // (often the first spreadsheet). Keep one resize pending instead and run
  // it only after the user genuinely leaves every spreadsheet overlay.
  // Track that boundary from pointer interaction, not document.activeElement:
  // jspreadsheet transiently removes/replaces its internal input while
  // committing a keystroke, briefly making <body> active even though the
  // user has not left the grid. Treating that internal transition as a real
  // exit was what let autoresize steal the cursor mid-edit.
  const onSpreadsheetPointerDown = (event: PointerEvent): void => {
    spreadsheetInteractionActive = event.target instanceof Element
      && event.target.closest('.elabftw-spreadsheet-editor-overlay') !== null;
    if ((!autoResizePending && !keyupDispatchPending) || spreadsheetInteractionActive) return;
    window.requestAnimationFrame(runPendingAutoResize);
  };
  document.addEventListener('pointerdown', onSpreadsheetPointerDown, true);

  const getEditorIframe = (): HTMLIFrameElement | null =>
    document.getElementById(`${editor.id}_ifr`) as HTMLIFrameElement | null;

  // Tears down the jspreadsheet-ce instance and removes its overlay, but
  // leaves the table under intersectionObserver's watch (see below) so it
  // gets a fresh overlay again if scrolled back into view -- a long
  // document with many spreadsheets otherwise keeps every one of them
  // live (and re-measured every animation frame, see syncOverlayPositions)
  // for the rest of the editing session regardless of whether any of them
  // are still on screen.
  const removeOverlay = (table: HTMLTableElement, discardChanges = false): void => {
    const entry = spreadsheetOverlays.get(table);
    if (!entry) return;
    // A resize or edit settles through a 500ms debounce (see
    // notifyFromMirror in inline-spreadsheet.ts) before it's actually
    // written back to this real table -- scrolling this overlay out of
    // view (tearing it down here, e.g. right after dragging a row border
    // and immediately scrolling to check another table) used to destroy
    // it mid-debounce with no flush, silently discarding that pending
    // change. Reported as a resize "working" on whichever table the user
    // stayed on long enough for the debounce to fire, but not on others.
    // Only when the table itself is still actually in the document,
    // though (the scrolled-out-of-view case) -- this same function is
    // also the cleanup path for a table that's gone for good (deleted, or
    // undone right after being pasted), where flushing would write the
    // overlay's still-stale in-memory content back into a table nothing
    // should be resurrecting.
    const discard = discardChanges || !table.isConnected || !editor.getBody().contains(table);
    profiler.count(entry.isPreview ? 'preview destroyed' : 'grid destroyed');
    entry.destroy(discard);
    entry.el.remove();
    spreadsheetOverlays.delete(table);
    enhancedTables.delete(table);
  };

  const runOverlaySync = (): void => {
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
    //
    // The same was true, less obviously, of stopping the reschedule
    // whenever there was momentarily nothing to sync (no iframe yet, or
    // every overlay briefly removed from the map, e.g. a table that
    // spuriously failed its own isConnected check for one frame during an
    // unrelated TinyMCE operation): the very next frame is exactly what
    // would have caught and corrected that transient state, but skipping
    // the reschedule meant it never got the chance to. Nothing else calls
    // ensureSyncLoop() again afterward except a *different* table being
    // freshly enhanced, so an existing table's overlay could freeze --
    // including mid-hide, if its rect happened to read zero-size on the
    // frame the loop gave up -- until a reload re-ran the whole
    // enhancement pass from scratch. Reschedule unconditionally instead;
    // only the per-frame work below is skipped when there's nothing to do.
    try {
      if (!layoutGate.shouldMeasure(performance.now(), document.body.dataset.spreadsheetCellEditing === 'true')) {
        profiler.count('sync frames skipped by gate');
        return;
      }
      const iframe = getEditorIframe();
      if (!iframe || spreadsheetOverlays.size === 0) return;
      profiler.count('overlays positioned', spreadsheetOverlays.size);
      const iframeRect = iframe.getBoundingClientRect();
      const maxContentWidth = editor.getBody().getBoundingClientRect().width;
      Array.from(spreadsheetOverlays.entries()).forEach(([table, { el: overlay, syncActiveEditor }]) => {
        try {
          if (!table.isConnected || !editor.getBody().contains(table)) {
            removeOverlay(table);
            return;
          }
          const tableRect = table.getBoundingClientRect();
          // Positioned in PAGE coordinates (absolute), not viewport coordinates
          // (fixed): the browser then moves the layer together with the page while
          // scrolling, in step with the text. With fixed positioning the layer is
          // re-placed from script every frame, which trails the page's own scroll
          // by a frame or two -- seen as tables wiggling when scrolling.
          overlay.style.position = 'absolute';
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
          // Rounded to whole pixels -- getBoundingClientRect() is
          // sub-pixel, and translate()-ing by a fractional amount that
          // changes slightly every single rAF frame during a scroll makes
          // the renderer round the overlay's own grid-line borders
          // differently from one frame to the next, independently of the
          // rest of the (unmoving, already-pixel-aligned) page. The
          // result is every border in the grid visibly swimming/stretching
          // in place as you scroll (reported as a "jelly" wobble) even
          // though the overlay's actual position only ever changes by
          // whole scroll-wheel pixels. clipTop/clipBottom/clipLeft/
          // clipRight below are computed from these same rounded values
          // (via overlayTop/overlayLeft), so the clip-path stays in sync
          // with where the overlay is actually painted.
          const pageScrollX = window.scrollX;
          const pageScrollY = window.scrollY;
          const pageX = Math.round(iframeRect.left + tableRect.left + pageScrollX);
          const pageY = Math.round(iframeRect.top + tableRect.top + pageScrollY);
          overlay.style.transform = `translate(${pageX}px, ${pageY}px)`;
          // Viewport position, for the clip below.
          const translateX = pageX - pageScrollX;
          const translateY = pageY - pageScrollY;
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
          // The overlay lives outside the iframe, so native iframe clipping
          // does not apply. Keep its pixels and hit targets within the editor.
          const overlayTop = translateY;
          const overlayLeft = translateX;
          const overlayWidth = overlay.getBoundingClientRect().width;
          // Rounded for the same reason translateX/translateY are: a clip
          // inset that drifts by a fraction of a pixel every frame makes
          // the clipped edge itself shimmer independently of the border
          // jitter translateX/translateY already fix.
          const clipTop = Math.max(0, Math.round(iframeRect.top) - overlayTop);
          const clipBottom = Math.max(0, overlayTop + overlayHeight - Math.round(iframeRect.bottom));
          const clipLeft = Math.max(0, Math.round(iframeRect.left) - overlayLeft);
          const clipRight = Math.max(0, overlayLeft + overlayWidth - Math.round(iframeRect.right));
          overlay.style.clipPath = `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`;
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
            spacer = editor.dom.create('div', {
              'data-mce-bogus': 'all',
              'data-elabftw-spreadsheet-spacer': '1',
              contenteditable: 'false',
              'aria-hidden': 'true',
            });
            spreadsheetSpacers.set(table, spacer);
          }
          // This is layout-only space, never a place to type. A caret in
          // a zero-height/negative-margin spacer paints lines on top of
          // one another and the spacer is omitted from saved content.
          spacer.setAttribute('contenteditable', 'false');
          spacer.style.pointerEvents = 'none';
          // Always reposition, even when it was already the very next
          // sibling: .after() on a node already there is a no-op move,
          // cheap, and guarantees it can never drift or duplicate.
          if (table.nextSibling !== spacer) table.after(spacer);
          // The hidden HTML table can wrap into taller rows than the live
          // grid. Account for BOTH directions or its growing hidden height
          // pushes the following paragraph farther down on every edit.
          const heightDifference = Math.round(overlayHeight - tableRect.height);
          const spacerHeight = Math.max(0, heightDifference);
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
          if (spacer.dataset.lastHeight !== String(heightDifference)) {
            spacer.dataset.lastHeight = String(heightDifference);
            spacer.style.height = `${spacerHeight}px`;
            spacer.style.marginTop = `${Math.min(0, heightDifference)}px`;
            if (autoResizeDebounce !== null) clearTimeout(autoResizeDebounce);
            autoResizeDebounce = setTimeout(() => {
              autoResizeDebounce = null;
              autoResizePending = true;
              runPendingAutoResize();
            }, 200);
          }
          // A zero-size rect means the real table isn't actually visible right
          // now (e.g. inside a collapsed <details>) -- hide the overlay rather
          // than pin it to a stale, meaningless position.
          const shouldHide = tableRect.width === 0 && tableRect.height === 0;
          overlay.style.display = shouldHide ? 'none' : '';
          syncActiveEditor();
        } catch (error) {
          console.error('Failed to sync a spreadsheet overlay\'s position', error);
        }
      });
    } finally {
      // Only editor.on('remove') below turns this off -- everywhere else
      // (zero overlays, no iframe yet) the loop keeps rescheduling itself
      // regardless, so it's always there to catch the very next frame
      // where that's no longer true.
      if (overlaySyncRunning) window.requestAnimationFrame(syncOverlayPositions);
    }
  };

  // Frame time of one positioning pass over every overlay (measured frames
  // only; frames the gate skips are counted separately in runOverlaySync).
  const syncOverlayPositions = (): void => {
    const startedAt = profiler.start();
    runOverlaySync();
    profiler.end('sync frame (ms)', startedAt);
  };

  const ensureSyncLoop = (): void => {
    invalidateSpreadsheetLayout();
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
    // spreadsheetToHTML() has no notion of SPREADSHEET_UID_ATTR -- wiping
    // every existing attribute below and replacing them with only what it
    // generated would silently erase this table's stable id on every
    // single edit, breaking the Undo/Redo content protection that id
    // exists for (see its own comment). Preserved explicitly across the
    // wipe rather than taught to spreadsheetToHTML itself, since nothing
    // about this attribute is part of the spreadsheet's own saved shape.
    const existingUid = table.getAttribute(SPREADSHEET_UID_ATTR);
    // The table of contents anchors to this table by id; keep it as well.
    const existingId = table.getAttribute('id');
    const parsed = document.createElement('div');
    parsed.innerHTML = html;
    const freshTable = parsed.querySelector('table.elabftw-spreadsheet');
    if (!freshTable) return false;
    Array.from(table.attributes).forEach(attr => table.removeAttribute(attr.name));
    Array.from(freshTable.attributes).forEach(attr => table.setAttribute(attr.name, attr.value));
    table.innerHTML = freshTable.innerHTML;
    if (existingUid) table.setAttribute(SPREADSHEET_UID_ATTR, existingUid);
    if (existingId) table.setAttribute('id', existingId);
    return true;
  };

  // Writes an in-overlay edit back into the real (hidden) table, in place.
  // Only the table's own attributes/innerHTML are touched, which is exactly
  // what editor.getContent() serializes -- correct by construction.
  const commitOverlayChange = (table: HTMLTableElement, data: SpreadsheetData): void => {
    // A cell edit has its own, separate undo/redo inside the table's own
    // toolbar (performCellUndo/performCellRedo) -- it must never *also*
    // land in the main editor's own undo history, or Ctrl+Z from the main
    // text, after editing a table, undoes that edit instead of whatever
    // the user actually changed in the surrounding text (and takes as many
    // presses as there were edits to fully clear). Simply not calling
    // editor.undoManager.add() ourselves here turned out not to be enough:
    // dispatchKeyupForAutosave() below fires a real 'keyup' through
    // editor.dispatch() so the autosave timer notices this edit, and
    // TinyMCE's own UndoManager listens for that same event internally to
    // add levels automatically, independent of any explicit add() call of
    // ours. undoManager.ignore() is the one API that actually suppresses
    // every source of a new level -- ours and TinyMCE's own internal
    // triggers alike -- for everything that runs inside it. Leaving the
    // main editor's undo history untouched by cell edits means Ctrl+Z
    // there only ever affects the main text, or (via the table's own
    // insertion/deletion, each already its own explicit
    // undoManager.add() elsewhere in this file) the table as a whole --
    // e.g. undoing a table just pasted and not yet edited still deletes
    // it in one press.
    editor.undoManager.ignore(() => {
      if (!applySpreadsheetHtmlToTable(table, spreadsheetToHTML(data, data.displayData ?? data.data))) return;
      // The table's own rows just got rebuilt from data.rowHeights --
      // reconcile them now, right after this commit's markup is actually
      // in place, so a row that no longer needs the height an earlier,
      // since-edited-or-deleted entry gave it shrinks back down instead
      // of permanently reserving that space (reported directly: a large
      // gap left under a table whose cells all looked normal again). See
      // reconcileSpreadsheetRowHeights's own comment for why
      // data.rowHeights itself is what distinguishes that case from a
      // genuine manual resize.
      reconcileSpreadsheetRowHeights(table, data.rowHeights);
      // Keeps the Undo/Redo content-protection map (see its own comment,
      // near enhancedTables) current with every edit, not just the state
      // as of whenever the table was first enhanced.
      latestTableContent.set(ensureSpreadsheetUid(table), table.outerHTML);
      editor.setDirty(true);
      // The editor's own 7-second autosave (tinymce.ts) resets its timer
      // on native keyup/keydown against the editor body -- typing into
      // this overlay (outside that body entirely; a position:fixed div
      // in the main document, not the iframe) never fires those, so
      // autosave never saw this edit at all. 'keyup' is what that timer
      // actually listens for; dispatching it programmatically resets the
      // same timer as if this had been typed directly into the editor.
      // Routed through dispatchKeyupForAutosave() (not a direct call) --
      // see its own comment for why this can't just fire immediately
      // while a cell is still being edited.
      dispatchKeyupForAutosave();
    });
  };

  // Tears down and rebuilds the live overlay for a table whose underlying
  // data just changed from outside the overlay itself (the popup editor
  // saving over it) -- otherwise the overlay keeps showing whatever it had
  // extracted at mount time, silently stale until the table next scrolls
  // out and back into view (or the page reloads).
  // Parsing a table back into SpreadsheetData (base64 JSON, per-cell styles,
  // row/column sizes) was the dominant cost of mounting an overlay. The
  // result only changes when the table's DOM does, so it's cached per table
  // and dropped by a MutationObserver on the editor body.
  // nodeType, not `instanceof Element`: the table lives in TinyMCE's iframe,
  // a different realm whose Element constructor is not this window's.
  const owningSpreadsheetTable = (node: Node): HTMLTableElement | null => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    return element?.closest<HTMLTableElement>('table.elabftw-spreadsheet') ?? null;
  };
  const extractionCache = new WeakMap<HTMLTableElement, SpreadsheetData>();
  const invalidateExtractions = (records: MutationRecord[]): void => {
    records.forEach(record => {
      const table = owningSpreadsheetTable(record.target);
      if (table) extractionCache.delete(table);
    });
  };
  let extractionObserver: MutationObserver | null = null;
  const ensureExtractionObserver = (): MutationObserver | null => {
    const body = editor.getBody();
    if (!body) return null;
    if (!extractionObserver) {
      extractionObserver = new MutationObserver(invalidateExtractions);
      extractionObserver.observe(body, {
        subtree: true, childList: true, attributes: true, characterData: true,
      });
    }
    return extractionObserver;
  };
  editor.on('remove', () => {
    extractionObserver?.disconnect();
    extractionObserver = null;
  });
  const extractCached = (table: HTMLTableElement): SpreadsheetData => {
    const observer = ensureExtractionObserver();
    // Apply any mutations not yet delivered before trusting the cache.
    if (observer) invalidateExtractions(observer.takeRecords());
    const cached = extractionCache.get(table);
    if (cached) {
      profiler.count('extraction cache hit');
      return structuredClone(cached);
    }
    profiler.count('extraction cache miss');
    const extracted = extractFromTable(table);
    extractionCache.set(table, structuredClone(extracted));
    return extracted;
  };
  // Called after this file's own writes to a table whose extracted data is
  // known to be unchanged by them (row-height reconciliation), so they don't
  // throw the cache away.
  const keepExtraction = (table: HTMLTableElement, data: SpreadsheetData): void => {
    // Only this table's own just-made writes may be discarded; anything
    // that touched another table must still invalidate that table's cache.
    const records = ensureExtractionObserver()?.takeRecords() ?? [];
    invalidateExtractions(records.filter(record => {
      return owningSpreadsheetTable(record.target) !== table;
    }));
    extractionCache.set(table, structuredClone(data));
  };

  // Tables near the viewport first get only a static preview: a clone of the
  // real (hidden) table plus a placeholder bar the height of the real
  // overlay's toggle bar, so the swap to the full grid doesn't shift the
  // content. No jspreadsheet instance, no extraction -- cheap enough to
  // mount several per scroll tick. A press on it builds the real grid for
  // just that table and selects the cell that was clicked.
  const mountPreview = (table: HTMLTableElement): void => {
    if (!editor.getBody().contains(table)) return;
    if (spreadsheetOverlays.has(table)) return;
    const mountStartedAt = profiler.start();
    // Built from the grid's own markup and classes so it looks identical.
    // Notebook-style tables aren't mirrored there; they get a plain cloned
    // table under a placeholder bar instead.
    const gridPreview = buildSpreadsheetPreviewHost(table);
    const overlay: HTMLElement = gridPreview ?? document.createElement('div');
    if (!gridPreview) {
      const bar = document.createElement('div');
      bar.className = 'elabftw-spreadsheet-readonly-toggle';
      const caption = table.querySelector('caption')?.textContent?.trim();
      if (caption) {
        const label = document.createElement('span');
        label.textContent = caption;
        bar.appendChild(label);
      }
      overlay.appendChild(bar);
      const clone = table.cloneNode(true) as HTMLTableElement;
      Array.from(clone.attributes)
        .filter(attribute => attribute.name.startsWith('data-mce') || attribute.name === SPREADSHEET_UID_ATTR)
        .forEach(attribute => clone.removeAttribute(attribute.name));
      clone.querySelectorAll('caption').forEach(node => node.remove());
      const wrapper = document.createElement('div');
      wrapper.className = 'elabftw-spreadsheet-preview-body';
      wrapper.appendChild(clone);
      overlay.appendChild(wrapper);
    }
    overlay.classList.add('elabftw-spreadsheet-editor-overlay', 'elabftw-spreadsheet-preview');
    overlay.addEventListener('pointerdown', event => {
      if (!(event.target instanceof Element)) return;
      const cell = event.target.closest<HTMLElement>('td[data-x][data-y]');
      const selection = cell
        ? { col: Number(cell.dataset.x), row: Number(cell.dataset.y) }
        : undefined;
      event.preventDefault();
      activateTable(table, selection);
    });
    document.body.appendChild(overlay);
    spreadsheetOverlays.set(table, {
      el: overlay,
      destroy: () => undefined,
      flush: () => undefined,
      syncActiveEditor: () => undefined,
      isPreview: true,
    });
    ensureSyncLoop();
    profiler.end('preview built (ms)', mountStartedAt);
  };

  const activateTable = (table: HTMLTableElement, selection?: { col: number; row: number }): void => {
    const existing = spreadsheetOverlays.get(table);
    if (existing && !existing.isPreview) return;
    const activateStartedAt = profiler.start();
    removeOverlay(table, true);
    pendingInitialSelection.set(table, selection);
    enhanceTable(table);
    profiler.end('click to grid mounted (ms, grid cells appear a few frames later)', activateStartedAt);
    if (selection) selectCellWhenReady(table, selection);
    setActiveSpreadsheetTable(table);
    editor.dispatch('ElabftwSpreadsheetSelected', { table });
    tableIndentation.trackSelectedTable(table);
  };
  // The grid mounts while the mouse button is still down; jspreadsheet's own
  // document-level handlers then see the button's release (and the click that
  // follows) land outside any cell and clear the selection. Wait for the
  // release and for the cells to exist before selecting the clicked one.
  const selectCellWhenReady = (table: HTMLTableElement, cell: { col: number; row: number }): void => {
    let buttonDown = true;
    const released = (): void => { buttonDown = false; };
    window.addEventListener('pointerup', released, { capture: true, once: true });
    window.addEventListener('pointercancel', released, { capture: true, once: true });
    const attempt = (frame: number): void => {
      const entry = spreadsheetOverlays.get(table);
      if (!entry || entry.isPreview || frame > 180) return;
      const grid = entry.el.querySelector('.elabftw-spreadsheet-readonly-grid') as
        (HTMLElement & { spreadsheet?: { worksheets?: Array<{ updateSelectionFromCoords?: (...args: number[]) => void }> } }) | null;
      const worksheet = grid?.spreadsheet?.worksheets?.[0];
      if (!buttonDown && worksheet?.updateSelectionFromCoords && entry.el.querySelector('td[data-x][data-y]')) {
        window.setTimeout(() => worksheet.updateSelectionFromCoords?.(cell.col, cell.row, cell.col, cell.row), 80);
        return;
      }
      window.requestAnimationFrame(() => attempt(frame + 1));
    };
    window.requestAnimationFrame(() => attempt(0));
  };
  const pendingInitialSelection = new WeakMap<HTMLTableElement, { col: number; row: number } | undefined>();

  const refreshTableOverlay = (table: HTMLTableElement): void => {
    // The backing table already contains the replacement. Never flush the
    // outgoing grid's pending edit over it (including destroy's flush).
    removeOverlay(table, true);
    enhanceTable(table);
  };

  const enhanceTable = (table: HTMLTableElement): void => {
    if (!editor.getBody().contains(table)) return;
    if (enhancedTables.has(table)) return;
    if (spreadsheetOverlays.get(table)?.isPreview) removeOverlay(table, true);
    const tableUid = ensureSpreadsheetUid(table);
    if (!latestTableContent.has(tableUid)) latestTableContent.set(tableUid, table.outerHTML);
    if (!tableCellHistories.has(tableUid)) tableCellHistories.set(tableUid, { undo: [], redo: [] });
    const extractStartedAt = profiler.start();
    const extracted = extractCached(table);
    profiler.end('table extraction (ms)', extractStartedAt);
    const initialSelection = pendingInitialSelection.get(table);
    pendingInitialSelection.delete(table);
    // Reconciles this table's rows against its own saved rowHeights right
    // as it's mounted, not just after a future edit commits (see
    // commitOverlayChange's own call to this) -- a table whose height
    // already went stale before that fix existed, or one the user is only
    // viewing/scrolling past rather than actively editing right now,
    // otherwise keeps showing the same gap indefinitely, with nothing to
    // ever trigger the reconciliation that would fix it. Reported directly
    // as still there after the edit-time fix landed.
    reconcileSpreadsheetRowHeights(table, extracted.rowHeights);
    keepExtraction(table, extracted);
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
    const hostStartedAt = profiler.start();
    const {
      host: overlay, flush, destroy, syncActiveEditor,
    } = buildReadOnlySpreadsheetHost(extracted, {
      editable: true,
      initialSelection,
      cellHistory: tableCellHistories.get(tableUid),
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
        // A genuine, explicit deletion (unlike an ordinary scroll-out
        // teardown, which also calls removeOverlay but must NOT clear
        // this) -- Ctrl+Z restoring this exact table should bring back
        // its real pre-deletion content, not have the protection below
        // force-overwrite it with whatever was last captured.
        const uid = table.getAttribute(SPREADSHEET_UID_ATTR);
        if (uid) {
          latestTableContent.delete(uid);
          tableCellHistories.delete(uid);
          uidToTable.delete(uid);
        }
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
    profiler.end('grid host built (ms)', hostStartedAt);
    profiler.count('grid mounted');
    overlay.classList.add('elabftw-spreadsheet-editor-overlay');
    // Passive bookkeeping only (never steals focus, unlike editor.selection.
    // select() would) -- lets table-scoped actions like indent/outdent find
    // this table via lastActiveSpreadsheetTable above.
    overlay.addEventListener('mousedown', event => {
      setActiveSpreadsheetTable(table);
      editor.dispatch('ElabftwSpreadsheetSelected', { table });
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
    // jspreadsheet-ce/jSuites position their own right-click menu with
    // plain `style.left/top = event.clientX/clientY` -- correct only when
    // the menu's nearest positioned ancestor is the viewport itself. It
    // lives as a child of the worksheet's own root element, which for this
    // overlay sits inside a `position: fixed` + `transform` ancestor (see
    // syncOverlayPositions' own comment on why transform, not top/left, is
    // used to move it every frame) -- and a `transform` on an ancestor
    // makes IT the containing block for every fixed/absolute-positioned
    // descendant, per the CSS spec. The menu's clientX/clientY-based
    // coordinates then end up relative to the overlay's own on-screen
    // position instead of the viewport's origin, landing the menu however
    // far from the actual click as the overlay itself currently sits from
    // (0, 0) -- reported directly as the right-click menu opening far from
    // the mouse (or, scrolled further down the page, so far off-screen it
    // looked like right-click had stopped doing anything at all).
    // Reparenting to document.body puts it outside that transformed
    // ancestor's containing-block chain entirely, matching the plain-
    // viewport coordinates it was always computing -- but jspreadsheet-ce's
    // own factory creates and appends this element only after an internal
    // `await` (see its own createWorksheets() call), so it doesn't exist
    // yet at the exact synchronous instant this overlay mounts. Doing this
    // once at mount (as an earlier version of this fix did) ran before the
    // element existed and silently reparented nothing, every time.
    const reparentContextMenu = (): void => {
      const contextMenuEl = overlay.querySelector<HTMLElement>('.jss_contextmenu');
      if (contextMenuEl && contextMenuEl.parentElement !== document.body) {
        document.body.appendChild(contextMenuEl);
      }
    };
    // Retried for a few frames right after mount so the element is already
    // in document.body well before anyone actually right-clicks -- jspreadsheet-
    // ce's own async init reliably settles within one or two frames in
    // practice, and this loop costs nothing once reparentContextMenu finds
    // nothing left to do. Without this, the very same jSuites function that
    // positions the menu also computes whether to flip it upward (so it
    // doesn't run off the bottom of the viewport) from this same element's
    // OWN getBoundingClientRect() -- read while it's still nested several
    // levels inside this scrollable, clipped overlay on that very first
    // right-click, before the contextmenu handler's own reparenting (below)
    // has a chance to run. That stale geometry threw the flip decision off
    // on a first open near the bottom of the table specifically, reported
    // as the menu sometimes appearing below the table instead of flipping
    // above it like every later open (once the element is already sitting
    // in document.body throughout) correctly does.
    let contextMenuRetries = 0;
    const retryReparentContextMenu = (): void => {
      reparentContextMenu();
      if (overlay.querySelector('.jss_contextmenu')?.parentElement === document.body) return;
      if (++contextMenuRetries >= 30) return;
      window.requestAnimationFrame(retryReparentContextMenu);
    };
    retryReparentContextMenu();
    overlay.addEventListener('contextmenu', () => {
      openContextMenuOverlay = overlay;
      overlay.classList.add('has-open-context-menu');
      // Safety net for the rare case the retry loop above somehow hasn't
      // caught up yet (e.g. a very slow initial load) -- by the time this
      // macrotask runs, every synchronous listener for this same event,
      // including jspreadsheet's own (which creates/positions the menu in
      // the first place), has already finished.
      window.setTimeout(reparentContextMenu, 0);
    });
    document.body.appendChild(overlay);
    spreadsheetOverlays.set(table, {
      el: overlay, destroy, flush, syncActiveEditor,
    });
    enhancedTables.add(table);
    ensureSyncLoop();
    // jspreadsheet builds its cells a few frames after the host is attached
    // (its factory awaits internally). The layout gate only measures during
    // interaction bursts, and a click-activated grid has no scroll to keep
    // it open -- the overlay was sized once, while only the row-number column
    // existed, and stayed that width. Keep invalidating until the cells are
    // there, plus a few settling frames.
    let framesLeft = 120;
    let settled = 0;
    const keepMeasuring = (): void => {
      if (spreadsheetOverlays.get(table)?.el !== overlay || framesLeft-- <= 0) return;
      invalidateSpreadsheetLayout();
      if (overlay.querySelector('.jss_worksheet td[data-x][data-y]')) settled++;
      if (settled < 12) window.requestAnimationFrame(keepMeasuring);
    };
    window.requestAnimationFrame(keepMeasuring);
  };

  // Only tables actually near the viewport get a live overlay (and join
  // the per-frame position sync above) -- one that scrolls out gets torn
  // down (removeOverlay) rather than left running forever, so a long
  // document with many spreadsheets costs roughly what's on screen, not
  // what's in the whole document.
  const observedTables = new WeakSet<HTMLTableElement>();
  // entry.isIntersecting alone is unreliable for tearing an overlay down:
  // it's computed purely from the real (hidden) backing <table>'s own
  // rect, which can differ wildly from what's actually still visually
  // reserved for this spreadsheet -- the whole reason the spacer exists
  // (see its own comment) is that the backing table's row layout doesn't
  // necessarily match the live grid's pixel-for-pixel, and that mismatch
  // can transiently spike right when an edit rewrites the table's
  // innerHTML, or during a scroll-triggered reflow under this file's own
  // table-layout:fixed override. A backing table read as collapsed to a
  // few px at exactly that moment reports "400px+ out of view" even while
  // its spacer still reserves a large, genuinely on-screen block --
  // reported directly as a table (and a large chunk of blank space where
  // it should be) vanishing while scrolling, or while editing. Re-checked
  // here against the spacer's own rect too, not just the table's, before
  // actually destroying the live overlay.
  const isNearViewport = (
    table: HTMLTableElement,
    iframeTop = getEditorIframe()?.getBoundingClientRect().top ?? 0,
  ): boolean => {
    const margin = 400;
    const viewportTop = -margin;
    const viewportBottom = window.innerHeight + margin;
    const inRange = (rect: DOMRect): boolean => rect.bottom + iframeTop >= viewportTop && rect.top + iframeTop <= viewportBottom;
    if (inRange(table.getBoundingClientRect())) return true;
    const spacer = spreadsheetSpacers.get(table);
    return !!spacer?.isConnected && inRange(spacer.getBoundingClientRect());
  };
  // A single "out of view" reading can be a transient false negative --
  // isNearViewport's own comment already documents the backing table's
  // layout momentarily collapsing to a few px right when an edit rewrites
  // its innerHTML or during a scroll-triggered reflow, misreading a table
  // that's genuinely still on screen as 400px+ away. Also reproduced via
  // the full editor popup: opening/closing it can fire enough scroll/resize
  // events to catch this same transient collapse, tearing the overlay down
  // with nothing left to rebuild it (reported as the spreadsheet vanishing
  // after Cancel). Confirmed one more animation frame later instead of
  // acting on the very first reading -- a genuinely off-screen table still
  // reads the same way a frame later, so real teardown is barely delayed;
  // a transient collapse has almost always corrected itself by then.
  const pendingOverlayRemovals = new Set<HTMLTableElement>();
  const removeOverlayIfStillOutOfView = (table: HTMLTableElement): void => {
    if (!spreadsheetOverlays.has(table)) return;
    if (pendingOverlayRemovals.has(table)) return;
    pendingOverlayRemovals.add(table);
    window.requestAnimationFrame(() => {
      pendingOverlayRemovals.delete(table);
      if (isNearViewport(table)) return;
      // The table being edited stays mounted while scrolled away, so an
      // in-progress cell edit or pending change is never interrupted.
      const entry = spreadsheetOverlays.get(table);
      if (entry && !entry.isPreview && (lastActiveSpreadsheetTable === table
        || entry.el.contains(document.activeElement))) return;
      removeOverlay(table);
    });
  };
  const tableVisibility = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const table = entry.target as HTMLTableElement;
      if (entry.isIntersecting) {
        mountPreview(table);
      } else if (!isNearViewport(table)) {
        removeOverlayIfStillOutOfView(table);
      }
    });
  }, { rootMargin: '400px 0px' });

  // Each table owns exactly one layout spacer (see spreadsheetSpacers). When a
  // table node is replaced (undo, a rebuilt overlay), its old spacer is left
  // behind with nothing to resize or remove it: a blank, undeletable gap under
  // the table that stacks up with each such event.
  const removeOrphanSpacers = (): void => {
    const body = editor.getBody();
    if (!body) return;
    const owned = new Set<HTMLElement>();
    body.querySelectorAll<HTMLTableElement>('table.elabftw-spreadsheet').forEach(table => {
      const spacer = spreadsheetSpacers.get(table);
      if (spacer) owned.add(spacer);
    });
    body.querySelectorAll<HTMLElement>('[data-elabftw-spreadsheet-spacer]').forEach(spacer => {
      if (!owned.has(spacer)) spacer.remove();
    });
  };

  // While the spreadsheet popup is open, the page text behind it must not take
  // input. If keyboard focus ever stays in (or returns to) the editor, typing
  // over a selected table replaces it with the typed text. Block edits at the
  // editor document's capture phase, ahead of TinyMCE's own handlers.
  const popupIsOpen = (): boolean => document.querySelector('.inline-spreadsheet-dialog') !== null;
  const blockEditorInputWhilePopupOpen = (event: Event): void => {
    if (!popupIsOpen()) return;
    if (event instanceof KeyboardEvent) {
      // Copying is harmless and stays available.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') return;
      if (event.key === 'Tab' || event.key === 'Shift' || event.key === 'Control'
        || event.key === 'Meta' || event.key === 'Alt') return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const attachPopupInputGuard = (): void => {
    const doc = editor.getDoc();
    if (!doc) return;
    ['keydown', 'keypress', 'beforeinput', 'paste', 'cut', 'drop'].forEach(name => {
      doc.addEventListener(name, blockEditorInputWhilePopupOpen, true);
    });
  };
  if (editor.initialized) attachPopupInputGuard();
  else editor.on('init', attachPopupInputGuard);

  const enhanceAllTables = (): void => {
    removeOrphanSpacers();
    Array.from(editor.getBody().querySelectorAll<HTMLTableElement>('table.elabftw-spreadsheet'))
      .forEach(table => {
        if (observedTables.has(table)) return;
        observedTables.add(table);
        tableVisibility.observe(table);
      });
  };

  // A spacer can remain visible after its tiny backing table leaves the
  // observer's range. Recheck on scrolling so returning to that reserved
  // area mounts the grid even without a new table-intersection event.
  let visibilityFrame = 0;
  const recheckSpreadsheetVisibility = (): void => {
    if (visibilityFrame) return;
    visibilityFrame = window.requestAnimationFrame(() => {
      visibilityFrame = 0;
      // Read every position before mounting/removing anything. Interleaving
      // DOM construction with the next table's rect forces repeated layout
      // during a scroll, even when all overlays are only static previews.
      const iframeTop = getEditorIframe()?.getBoundingClientRect().top ?? 0;
      const visibility = Array.from(editor.getBody()?.querySelectorAll<HTMLTableElement>('table.elabftw-spreadsheet') ?? [])
        .map(table => ({ table, near: isNearViewport(table, iframeTop) }));
      visibility.forEach(({ table, near }) => {
        if (near) mountPreview(table);
        else removeOverlayIfStillOutOfView(table);
      });
    });
  };
  window.addEventListener('scroll', recheckSpreadsheetVisibility, true);
  window.addEventListener('resize', recheckSpreadsheetVisibility);
  editor.on('remove', () => {
    window.cancelAnimationFrame(visibilityFrame);
    window.removeEventListener('scroll', recheckSpreadsheetVisibility, true);
    window.removeEventListener('resize', recheckSpreadsheetVisibility);
  });

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

  // A cell edit reaches the real table only after a 500ms debounce. Saving (or an
  // autosave) inside that window would store the table without the last edit, which
  // then only shows up in the inline overlay. Write out anything still pending
  // before the editor reads its content.
  editor.on('BeforeGetContent', () => {
    spreadsheetOverlays.forEach(entry => entry.flush(false));
  });
  editor.on('SetContent NodeChange', enhanceAllTables);
  // Snapshot only the currently live tables, including their actual DOM
  // nodes. Reusing those nodes preserves overlay ownership and local undo.
  let pendingSpreadsheetPositions: ReturnType<typeof captureSpreadsheetPositions> | null = null;
  const capturePendingSpreadsheets = (): void => {
    spreadsheetOverlays.forEach(entry => entry.flush());
    pendingSpreadsheetPositions = captureSpreadsheetPositions(editor.getBody());
  };
  editor.on('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      capturePendingSpreadsheets();
    }
  }, true);
  editor.on('BeforeExecCommand', event => {
    if (['undo', 'redo'].includes(event.command.toLowerCase())) capturePendingSpreadsheets();
  });
  editor.on('Undo Redo', () => {
    const positions = pendingSpreadsheetPositions;
    pendingSpreadsheetPositions = null;
    if (!positions) return;
    const body = editor.getBody();
    const retained = new Set(positions.map(position => position.table));
    Array.from(spreadsheetOverlays.keys()).forEach(table => {
      if (!retained.has(table)) removeOverlay(table, true);
    });
    editor.undoManager.ignore(() => restoreSpreadsheetPositions(body, positions));
    positions.forEach(({ table }) => {
      const uid = table.getAttribute(SPREADSHEET_UID_ATTR);
      if (uid) uidToTable.set(uid, table);
      enhanceTable(table);
    });
  });
  // A spreadsheet-only snapshot should not consume a main-text Undo press.
  // Keep the native history for prose, but disregard tables and their
  // transient layout spacers when comparing two adjacent snapshots.
  const mainTextSnapshot = (html: string): string => {
    const fragment = editor.getDoc().createElement('div');
    fragment.innerHTML = html;
    fragment.querySelectorAll('table.elabftw-spreadsheet, [data-elabftw-spreadsheet-spacer]').forEach(node => node.remove());
    return fragment.innerHTML;
  };
  const cachedMainTextSnapshot = createSpreadsheetSnapshotCache(mainTextSnapshot);
  editor.on('BeforeAddUndo', event => {
    if (typeof event.level?.content !== 'string' || typeof event.lastLevel?.content !== 'string') return;
    if (cachedMainTextSnapshot(event.level) === cachedMainTextSnapshot(event.lastLevel)) {
      event.preventDefault();
    }
  });
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
  // Retain a 250ms safety check for layout changes not represented by an
  // editor event. Interaction/transition bursts keep the original frame
  // rate; idle frames skip all DOM geometry reads and style writes.
  const layoutEvents = ['scroll', 'resize', 'pointermove', 'pointerdown', 'input', 'transitionrun', 'transitionend', 'elabftw-spreadsheet-resync'];
  layoutEvents.forEach(name => window.addEventListener(name, invalidateSpreadsheetLayout, true));
  // Backgrounding the tab/window doesn't pause native scrolling (compositor
  // driven), but browsers deliberately throttle requestAnimationFrame for a
  // hidden document -- often to ~1fps or less -- to save battery/CPU. This
  // loop is entirely rAF-driven, so an overlay left mid-sync when the tab
  // went background only catches up a frame or two at a time once it's
  // visible again, lagging behind the (instantly correct) real scroll
  // position for a moment -- reported as spreadsheets responding slower to
  // scrolling than the rest of the page right after switching back.
  // ensureSyncLoop() itself (not a direct syncOverlayPositions() call,
  // which would start a second, permanently-doubled rAF chain on top of
  // whatever's already running) forces the gate open for the very next
  // frame without that risk.
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') ensureSyncLoop();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  editor.on('input keydown NodeChange SetContent Undo Redo ResizeEditor', invalidateSpreadsheetLayout);
  const layoutObserver = new ResizeObserver(invalidateSpreadsheetLayout);
  const observeEditorLayout = (): void => {
    if (editor.getBody()) layoutObserver.observe(editor.getBody());
    if (editor.getContainer()) layoutObserver.observe(editor.getContainer());
    invalidateSpreadsheetLayout();
  };
  observeEditorLayout();
  editor.on('init', observeEditorLayout);
  // Dispatched synchronously from performEntitySave() (misc.ts) right before
  // it reads editor.getContent(). notifyFromMirror() in inline-spreadsheet.ts
  // debounces its write-back to the real table by 500ms, so a cell edited
  // and then saved within that window would otherwise have its value read
  // out of the editor before the debounced write ever lands, losing the
  // edit silently. Flushing every open overlay here forces that pending
  // write to happen immediately, in step with the save.
  const flushAllOverlays = (): void => {
    spreadsheetOverlays.forEach(({ flush }) => flush());
  };
  window.addEventListener('elabftw-flush-spreadsheets', flushAllOverlays);
  editor.on('remove', () => {
    // syncOverlayPositions now reschedules itself unconditionally, even
    // with zero overlays (see its own comment for why) -- it no longer
    // self-stops once every overlay is gone, so this editor instance's
    // copy would otherwise keep rescheduling a no-op frame forever.
    overlaySyncRunning = false;
    layoutObserver.disconnect();
    layoutEvents.forEach(name => window.removeEventListener(name, invalidateSpreadsheetLayout, true));
    document.removeEventListener('visibilitychange', onVisibilityChange);
    tableVisibility.disconnect();
    Array.from(spreadsheetOverlays.keys()).forEach(table => removeOverlay(table));
    window.removeEventListener('elabftw-spreadsheet-resync', enhanceAllTables);
    window.removeEventListener('elabftw-flush-spreadsheets', flushAllOverlays);
    document.removeEventListener('pointerdown', onSpreadsheetPointerDown, true);
    // A pending debounced mceAutoResize (see syncOverlayPositions) has
    // nothing left to act on once the editor itself is gone -- calling
    // execCommand on a destroyed editor, or trying to refocus an element
    // that's since been torn down along with it, has no reason to run at
    // all at that point.
    if (autoResizeDebounce !== null) {
      clearTimeout(autoResizeDebounce);
      autoResizeDebounce = null;
    }
    autoResizePending = false;
    keyupDispatchPending = false;
    spreadsheetInteractionActive = false;
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
    // table-layout:fixed (below) needs no width of its own here: it applies
    // over whatever the table's own inline style already computed --
    // spreadsheetToHTML() sets that explicitly, to the sum of the column
    // widths, for exactly this (a table with no manually-set width, the
    // common case). A width:100% forcing every table to the full editor
    // body's width regardless of its actual column widths was tried here
    // and reverted: it stretched the real table (which reserves this
    // content's document-flow space) wider than the overlay standing in
    // for it ever visually shows, reachable by clicking/placing the cursor
    // well past the last visible column -- max-width still caps it from
    // growing past the viewport, just no longer forces it to fill one.
    hideSpreadsheetTablesStyle.textContent = `
      table.elabftw-spreadsheet {
        box-sizing: border-box;
        table-layout: fixed !important;
        visibility: hidden;
        max-width: 100%;
      }
      table.elabftw-spreadsheet td,
      table.elabftw-spreadsheet th {
        overflow-wrap: anywhere;
        word-break: break-word;
      }
    `;
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
    // Selecting a spreadsheet's header selects its backing table for copy.
    // TinyMCE's insertContent would replace that whole node on the next
    // table paste. Insert after a singly selected spreadsheet instead;
    // retain normal replacement for selections containing text or ranges.
    const insertPastedSpreadsheet = (html: string): void => {
      const range = editor.selection.getRng();
      if (range.startContainer === range.endContainer
        && range.endOffset === range.startOffset + 1) {
        const node = range.startContainer.childNodes[range.startOffset];
        if (node?.nodeType === 1
          && (node as Element).matches('table.elabftw-spreadsheet')) {
          range.setStartAfter(node);
          range.collapse(true);
          editor.selection.setRng(range);
        }
      }
      const body = editor.getBody();
      const tablesBefore = new Set(Array.from(body.querySelectorAll('table.elabftw-spreadsheet')));
      editor.insertContent(html);
      const insertedTable = Array.from(body.querySelectorAll('table.elabftw-spreadsheet'))
        .find(table => !tablesBefore.has(table));
      if (!insertedTable) return;
      // TinyMCE's own table-insert default otherwise leaves the cursor
      // inside the table's first cell, so the very next keystroke lands in
      // a cell instead of the surrounding text. Move it to a line of its
      // own right below the pasted table instead, creating one if nothing
      // suitable already follows.
      let next = insertedTable.nextElementSibling;
      if (!next || next.tagName === 'TABLE') {
        const p = body.ownerDocument.createElement('p');
        p.innerHTML = '<br data-mce-bogus="1">';
        insertedTable.after(p);
        next = p;
      }
      editor.selection.setCursorLocation(next, 0);
    };
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
          insertPastedSpreadsheet(spreadsheetToHTML(spreadsheet, spreadsheet.data));
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
            insertPastedSpreadsheet(spreadsheetToHTML(recovered, recovered.data));
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
