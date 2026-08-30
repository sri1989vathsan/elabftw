/** Fork-owned inline spreadsheet insertion, editing and clipboard handling. */
import { Editor } from 'tinymce/tinymce';
import {
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
      const html = spreadsheetToHTML(raw, computed);
      editor.focus();
      editor.selection.moveToBookmark(bookmark);
      if (existingTable) editor.selection.select(existingTable);
      editor.execCommand('mceInsertContent', false, html);
      editor.undoManager.add();
    }).catch(() => {
      // User cancelled.
    });
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
      const selectedTable = selectedNode.closest('table') as HTMLTableElement | null;
      const existingTable = selectedNode
        .closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
      const items = [];
      if (existingTable) {
        items.push({
          type: 'menuitem' as const,
          text: 'Edit selected spreadsheet…',
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
      }
      callback(items);
    },
  });

  editor.on('dblclick', event => {
    const target = (event.target as HTMLElement)
      .closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
    if (target) openInlineSpreadsheet(extractFromTable(target), target);
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
