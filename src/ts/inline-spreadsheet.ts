/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 *
 * Inline spreadsheet — embeds a jspreadsheet grid inside the TinyMCE body.
 * Raw values and formulas are stored as base64-encoded JSON on the table while
 * computed cell values remain ordinary HTML for viewing and exporting.
 */
import jspreadsheet from 'jspreadsheet-ce';
import 'jspreadsheet-ce/dist/jspreadsheet.css';
import 'jsuites/dist/jsuites.css';

type CellValue = string | number | boolean | null;
type AOA = CellValue[][];
type SpreadsheetKind = 'standard' | 'notebook' | 'well-plate';

// jspreadsheet-ce v5 types do not cover the runtime shape returned during setup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JssInstance = any;
type JssFactory = (element: HTMLDivElement, options: object) => JssInstance;

export interface SpreadsheetData {
  /** Array-of-arrays with raw values/formulas as entered by the user. */
  data: AOA;
  cols: number;
  rows: number;
  kind?: SpreadsheetKind;
  caption?: string;
  plateSize?: number;
}

interface WellPlatePreset {
  wells: number;
  rows: number;
  cols: number;
}

export const WELL_PLATE_PRESETS: WellPlatePreset[] = [
  { wells: 6, rows: 2, cols: 3 },
  { wells: 12, rows: 3, cols: 4 },
  { wells: 24, rows: 4, cols: 6 },
  { wells: 48, rows: 6, cols: 8 },
  { wells: 96, rows: 8, cols: 12 },
  { wells: 384, rows: 16, cols: 24 },
];

const DEFAULT_COLS = 6;
const DEFAULT_ROWS = 5;
const MAX_DIMENSION = 50;

export function encodeSpreadsheetData(sd: SpreadsheetData): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(sd))));
}

export function decodeSpreadsheetData(encoded: string): SpreadsheetData {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(encoded)))) as Partial<SpreadsheetData>;
    return normalizeSpreadsheetData(parsed);
  } catch {
    return emptySpreadsheetData();
  }
}

export function emptySpreadsheetData(
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
  kind: SpreadsheetKind = 'standard',
  caption = '',
): SpreadsheetData {
  const safeCols = clampDimension(cols, DEFAULT_COLS);
  const safeRows = clampDimension(rows, DEFAULT_ROWS);
  return {
    data: createEmptyData(safeRows, safeCols),
    cols: safeCols,
    rows: safeRows,
    kind,
    caption,
  };
}

export function createNotebookSpreadsheetData(): SpreadsheetData {
  const data = createEmptyData(9, 5);
  data[0] = ['Sample', 'Condition', 'Replicate', 'Result', 'Notes'];
  return {
    data,
    cols: 5,
    rows: 9,
    kind: 'notebook',
    caption: 'Untitled data table',
  };
}

export function createWellPlateSpreadsheetData(wells: number): SpreadsheetData {
  const preset = WELL_PLATE_PRESETS.find(candidate => candidate.wells === wells)
    ?? WELL_PLATE_PRESETS.find(candidate => candidate.wells === 96);
  return {
    ...emptySpreadsheetData(preset.cols, preset.rows, 'well-plate', `${preset.wells}-well plate`),
    plateSize: preset.wells,
  };
}

function normalizeSpreadsheetData(candidate: Partial<SpreadsheetData>): SpreadsheetData {
  const rows = clampDimension(candidate.rows, DEFAULT_ROWS);
  const cols = clampDimension(candidate.cols, DEFAULT_COLS);
  const kind: SpreadsheetKind = candidate.kind === 'notebook' || candidate.kind === 'well-plate'
    ? candidate.kind
    : 'standard';
  return {
    data: resizeData(Array.isArray(candidate.data) ? candidate.data : [[]], rows, cols),
    rows,
    cols,
    kind,
    caption: typeof candidate.caption === 'string' ? candidate.caption : '',
    plateSize: kind === 'well-plate' && Number.isInteger(candidate.plateSize)
      ? candidate.plateSize
      : undefined,
  };
}

function clampDimension(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(1, Math.min(MAX_DIMENSION, value));
}

function createEmptyData(rows: number, cols: number): AOA {
  return Array.from({ length: rows }, () => new Array(cols).fill(''));
}

function resizeData(data: AOA, rows: number, cols: number): AOA {
  return Array.from({ length: rows }, (_, rowIndex) => (
    Array.from({ length: cols }, (_, colIndex) => data[rowIndex]?.[colIndex] ?? '')
  ));
}

function getWorksheet(instance: JssInstance): JssInstance {
  return instance?.[0] ?? instance;
}

function getComputedDataFromDOM(container: HTMLElement): AOA {
  const result: AOA = [];
  const tbody = container.querySelector('.jss_worksheet tbody, table.jss tbody, table.jexcel tbody');
  if (!tbody) return result;
  tbody.querySelectorAll('tr').forEach(tr => {
    const row: CellValue[] = [];
    tr.querySelectorAll('td').forEach((td, index) => {
      if (index > 0) row.push(td.textContent?.trim() ?? '');
    });
    if (row.length > 0) result.push(row);
  });
  return result;
}

function createInput(type: string, value: string, label: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.className = 'form-control form-control-sm';
  input.setAttribute('aria-label', label);
  input.title = label;
  return input;
}

function createOverlay(initial: SpreadsheetData): {
  overlay: HTMLDivElement;
  sheetHost: HTMLDivElement;
  insertBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  addRowBtn: HTMLButtonElement;
  addColBtn: HTMLButtonElement;
  resizeBtn: HTMLButtonElement;
  rowsInput: HTMLInputElement;
  colsInput: HTMLInputElement;
  captionInput: HTMLInputElement;
  presetSelect: HTMLSelectElement;
  formulaButtons: NodeListOf<HTMLButtonElement>;
  formulaStatus: HTMLSpanElement;
} {
  const overlay = document.createElement('div');
  overlay.className = 'inline-spreadsheet-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'inline-spreadsheet-dialog';

  const title = document.createElement('h5');
  title.textContent = 'Edit spreadsheet';
  title.className = 'mb-2';
  dialog.appendChild(title);

  const settings = document.createElement('div');
  settings.className = 'inline-spreadsheet-settings';

  const presetSelect = document.createElement('select');
  presetSelect.className = 'form-control form-control-sm';
  presetSelect.setAttribute('aria-label', 'Spreadsheet layout');
  presetSelect.innerHTML = `
    <option value="custom">Custom spreadsheet</option>
    <option value="notebook">Benchling-style data table</option>
    ${WELL_PLATE_PRESETS.map(preset => `<option value="plate-${preset.wells}">${preset.wells}-well plate (${preset.rows} × ${preset.cols})</option>`).join('')}
  `;
  presetSelect.value = initial.kind === 'notebook'
    ? 'notebook'
    : (initial.kind === 'well-plate' ? `plate-${initial.plateSize ?? 96}` : 'custom');

  const rowsInput = createInput('number', String(initial.rows), 'Rows');
  rowsInput.min = '1';
  rowsInput.max = String(MAX_DIMENSION);
  const colsInput = createInput('number', String(initial.cols), 'Columns');
  colsInput.min = '1';
  colsInput.max = String(MAX_DIMENSION);
  const captionInput = createInput('text', initial.caption ?? '', 'Caption shown above the table');
  captionInput.placeholder = 'Caption (shown above the table)';
  captionInput.classList.add('inline-spreadsheet-caption-input');

  const resizeBtn = document.createElement('button');
  resizeBtn.type = 'button';
  resizeBtn.textContent = 'Apply size';
  resizeBtn.className = 'btn btn-sm btn-outline-secondary';

  settings.append(presetSelect, rowsInput, colsInput, resizeBtn, captionInput);
  dialog.appendChild(settings);

  const formulaBar = document.createElement('div');
  formulaBar.className = 'inline-spreadsheet-formula-bar';
  const formulaLabel = document.createElement('strong');
  formulaLabel.textContent = 'ƒx';
  formulaLabel.title = 'Formula builder';
  formulaBar.appendChild(formulaLabel);
  ['SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX'].forEach(formulaName => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-secondary';
    button.dataset.formula = formulaName;
    button.textContent = formulaName;
    button.title = `Apply ${formulaName} to the selected cell range`;
    formulaBar.appendChild(button);
  });
  const formulaStatus = document.createElement('span');
  formulaStatus.className = 'inline-spreadsheet-formula-status';
  formulaStatus.textContent = 'Select source cells, then choose a formula. The result is placed below the selection.';
  formulaBar.appendChild(formulaStatus);
  dialog.appendChild(formulaBar);

  const sheetHost = document.createElement('div');
  sheetHost.className = 'inline-spreadsheet-container';
  dialog.appendChild(sheetHost);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'inline-spreadsheet-actions';
  const leftButtons = document.createElement('div');
  leftButtons.className = 'd-flex';
  const addRowBtn = document.createElement('button');
  addRowBtn.type = 'button';
  addRowBtn.textContent = '+ Row';
  addRowBtn.className = 'btn btn-sm btn-outline-secondary mr-1';
  const addColBtn = document.createElement('button');
  addColBtn.type = 'button';
  addColBtn.textContent = '+ Column';
  addColBtn.className = 'btn btn-sm btn-outline-secondary';
  leftButtons.append(addRowBtn, addColBtn);

  const rightButtons = document.createElement('div');
  rightButtons.className = 'd-flex';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'btn btn-sm btn-secondary mr-1';
  const insertBtn = document.createElement('button');
  insertBtn.type = 'button';
  insertBtn.textContent = 'Insert / Update';
  insertBtn.className = 'btn btn-sm btn-primary';
  rightButtons.append(cancelBtn, insertBtn);
  buttonRow.append(leftButtons, rightButtons);
  dialog.appendChild(buttonRow);

  overlay.appendChild(dialog);
  dialog.addEventListener('click', event => event.stopPropagation());

  return {
    overlay,
    sheetHost,
    insertBtn,
    cancelBtn,
    addRowBtn,
    addColBtn,
    resizeBtn,
    rowsInput,
    colsInput,
    captionInput,
    presetSelect,
    formulaButtons: formulaBar.querySelectorAll<HTMLButtonElement>('[data-formula]'),
    formulaStatus,
  };
}

function spreadsheetPresetFromValue(value: string): SpreadsheetData | null {
  if (value === 'notebook') return createNotebookSpreadsheetData();
  if (value.startsWith('plate-')) {
    return createWellPlateSpreadsheetData(parseInt(value.slice('plate-'.length), 10));
  }
  return null;
}

/**
 * Open the spreadsheet overlay and return the raw formula data plus computed
 * values when the user inserts or updates the table.
 */
export function openSpreadsheetModal(initialData: SpreadsheetData): Promise<{ raw: SpreadsheetData; computed: AOA }> {
  return new Promise((resolve, reject) => {
    let working = normalizeSpreadsheetData(initialData);
    const ui = createOverlay(working);
    let sheetContainer: HTMLDivElement | null = null;
    let worksheet: JssInstance = null;

    document.body.appendChild(ui.overlay);

    const readRawData = (): AOA => {
      const data = worksheet?.getData?.();
      return Array.isArray(data) ? data : working.data;
    };

    const mountSpreadsheet = (spreadsheet: SpreadsheetData): void => {
      if (sheetContainer) {
        const destroy = (jspreadsheet as unknown as { destroy?: (element: HTMLElement) => void }).destroy;
        destroy?.(sheetContainer);
      }
      ui.sheetHost.replaceChildren();
      sheetContainer = document.createElement('div');
      ui.sheetHost.appendChild(sheetContainer);
      working = normalizeSpreadsheetData(spreadsheet);
      const instance = (jspreadsheet as unknown as JssFactory)(sheetContainer, {
        worksheets: [{
          data: working.data,
          minDimensions: [working.cols, working.rows],
        }],
        tableOverflow: true,
        tableWidth: '100%',
        tableHeight: '400px',
        allowInsertRow: true,
        allowInsertColumn: true,
        allowDeleteRow: true,
        allowDeleteColumn: true,
        columnSorting: false,
        selectionCopy: true,
      });
      worksheet = getWorksheet(instance);
      ui.rowsInput.value = String(working.rows);
      ui.colsInput.value = String(working.cols);
    };

    const applyDimensions = (): void => {
      const rows = clampDimension(parseInt(ui.rowsInput.value, 10), working.rows);
      const cols = clampDimension(parseInt(ui.colsInput.value, 10), working.cols);
      const resized: SpreadsheetData = {
        ...working,
        data: resizeData(readRawData(), rows, cols),
        rows,
        cols,
        kind: ui.presetSelect.value === 'custom' ? 'standard' : working.kind,
        plateSize: ui.presetSelect.value === 'custom' ? undefined : working.plateSize,
      };
      mountSpreadsheet(resized);
    };

    mountSpreadsheet(working);

    ui.presetSelect.addEventListener('change', () => {
      const preset = spreadsheetPresetFromValue(ui.presetSelect.value);
      if (!preset) {
        working.kind = 'standard';
        working.plateSize = undefined;
        return;
      }
      ui.captionInput.value = preset.caption ?? '';
      mountSpreadsheet(preset);
    });

    ui.resizeBtn.addEventListener('click', applyDimensions);
    ui.addRowBtn.addEventListener('click', () => {
      worksheet?.insertRow?.();
      ui.rowsInput.value = String(Math.min(MAX_DIMENSION, parseInt(ui.rowsInput.value, 10) + 1));
    });
    ui.addColBtn.addEventListener('click', () => {
      worksheet?.insertColumn?.();
      ui.colsInput.value = String(Math.min(MAX_DIMENSION, parseInt(ui.colsInput.value, 10) + 1));
    });

    ui.formulaButtons.forEach(button => button.addEventListener('click', () => {
      const selection = worksheet?.getSelection?.() as [number, number, number, number] | undefined;
      if (!selection || selection.some(value => !Number.isInteger(value))) {
        ui.formulaStatus.textContent = 'Select one or more source cells first.';
        return;
      }
      const startCol = Math.min(selection[0], selection[2]);
      const startRow = Math.min(selection[1], selection[3]);
      const endCol = Math.max(selection[0], selection[2]);
      const endRow = Math.max(selection[1], selection[3]);
      const formulaName = button.dataset.formula;
      if (!formulaName) return;
      const range = `${colLabel(startCol)}${startRow + 1}:${colLabel(endCol)}${endRow + 1}`;
      const targetCol = startCol;
      const targetRow = endRow + 1;
      const rowCount = readRawData().length;
      if (targetRow >= rowCount) {
        worksheet?.insertRow?.(1, endRow, 0);
        ui.rowsInput.value = String(Math.min(MAX_DIMENSION, rowCount + 1));
      }
      worksheet?.setValueFromCoords?.(targetCol, targetRow, `=${formulaName}(${range})`);
      worksheet?.updateSelectionFromCoords?.(targetCol, targetRow, targetCol, targetRow);
      ui.formulaStatus.textContent = `${formulaName}(${range}) → ${colLabel(targetCol)}${targetRow + 1}`;
    }));

    const cleanup = (): void => {
      document.removeEventListener('keydown', onKey);
      ui.overlay.remove();
    };
    const cancel = (): void => {
      cleanup();
      reject(new Error('cancelled'));
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel();
    };

    ui.insertBtn.addEventListener('click', () => {
      const rawData = readRawData();
      const rows = clampDimension(rawData.length, working.rows);
      const cols = clampDimension(
        rawData.reduce((max, row) => Math.max(max, row.length), 0),
        working.cols,
      );
      const result: SpreadsheetData = {
        data: resizeData(rawData, rows, cols),
        rows,
        cols,
        kind: working.kind,
        caption: ui.captionInput.value.trim(),
        plateSize: working.kind === 'well-plate' ? working.plateSize : undefined,
      };
      const computed = sheetContainer
        ? resizeData(getComputedDataFromDOM(sheetContainer), rows, cols)
        : result.data;
      cleanup();
      resolve({ raw: result, computed });
    });

    ui.cancelBtn.addEventListener('click', cancel);
    ui.overlay.addEventListener('click', cancel);
    document.addEventListener('keydown', onKey);
  });
}

/**
 * Convert SpreadsheetData to an HTML table containing computed values.
 */
export function spreadsheetToHTML(rawData: SpreadsheetData, computed: AOA): string {
  const raw = normalizeSpreadsheetData(rawData);
  const encoded = encodeSpreadsheetData(raw);
  const kind = raw.kind ?? 'standard';
  const styleAttribute = ` data-spreadsheet-style="${kind}"`;
  const plateAttribute = kind === 'well-plate' && raw.plateSize
    ? ` data-well-plate="${raw.plateSize}"`
    : '';
  let html = `<table class="elabftw-spreadsheet" data-spreadsheet="${encoded}"${styleAttribute}${plateAttribute} border="1" style="border-collapse:collapse;min-width:25%">`;
  if (raw.caption) {
    html += `<caption>${escapeHTML(raw.caption)}</caption>`;
  }

  const displayData = resizeData(computed.length > 0 ? computed : raw.data, raw.rows, raw.cols);
  if (kind === 'notebook') {
    html += '<thead><tr>';
    for (let col = 0; col < raw.cols; col++) {
      html += `<th>${escapeHTML(String(displayData[0]?.[col] ?? ''))}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let row = 1; row < raw.rows; row++) {
      html += '<tr>';
      for (let col = 0; col < raw.cols; col++) {
        html += `<td>${escapeHTML(String(displayData[row]?.[col] ?? ''))}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
  } else {
    html += '<thead><tr><th class="spreadsheet-coordinate"></th>';
    for (let col = 0; col < raw.cols; col++) {
      const label = kind === 'well-plate' ? String(col + 1) : colLabel(col);
      html += `<th class="spreadsheet-coordinate">${label}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let row = 0; row < raw.rows; row++) {
      const rowLabel = kind === 'well-plate' ? colLabel(row) : String(row + 1);
      html += `<tr><th class="spreadsheet-coordinate">${rowLabel}</th>`;
      for (let col = 0; col < raw.cols; col++) {
        html += `<td>${escapeHTML(String(displayData[row]?.[col] ?? ''))}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
  }
  html += '</table>';
  return html;
}

export function extractFromTable(tableElement: HTMLTableElement): SpreadsheetData {
  const encoded = tableElement.dataset.spreadsheet;
  if (encoded) return decodeSpreadsheetData(encoded);

  const spreadsheetStyle = tableElement.dataset.spreadsheetStyle;
  const kind: SpreadsheetKind = spreadsheetStyle === 'notebook' || spreadsheetStyle === 'well-plate'
    ? spreadsheetStyle
    : 'standard';
  const data: AOA = [];
  tableElement.querySelectorAll('tr').forEach((row, rowIndex) => {
    if (kind !== 'notebook' && rowIndex === 0) return;
    const rowData: CellValue[] = [];
    row.querySelectorAll('th, td').forEach((cell, cellIndex) => {
      if (kind !== 'notebook' && cellIndex === 0) return;
      rowData.push(cell.textContent?.trim() ?? '');
    });
    if (rowData.length > 0) data.push(rowData);
  });
  const rows = Math.max(data.length, 1);
  const cols = Math.max(data.reduce((max, row) => Math.max(max, row.length), 0), 1);
  return {
    data: resizeData(data, rows, cols),
    rows,
    cols,
    kind,
    caption: tableElement.querySelector('caption')?.textContent?.trim() ?? '',
    plateSize: kind === 'well-plate'
      ? parseInt(tableElement.dataset.wellPlate ?? '', 10) || undefined
      : undefined,
  };
}

/** Convert column index to letter label (0=A, 25=Z, 26=AA). */
function colLabel(index: number): string {
  let label = '';
  let current = index;
  do {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return label;
}

function escapeHTML(value: string): string {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}
