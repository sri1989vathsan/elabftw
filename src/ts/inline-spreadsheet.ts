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
import { ApiC } from './api';
import { entity } from './getEntity';

type CellValue = string | number | boolean | null;
type AOA = CellValue[][];
type SpreadsheetKind = 'standard' | 'notebook' | 'well-plate';
type CellStyles = Record<string, string>;
type AppearanceScope = 'user' | 'notebook';
type CellRange = [number, number, number, number];

interface CellFontFormat {
  color?: string;
  fontFamily?: string;
  fontSize?: string;
  fontStyle?: string;
  fontWeight?: string;
  textAlign?: string;
  textDecoration?: string;
  verticalAlign?: string;
}

export interface SpreadsheetAppearance {
  borderWidth: number;
  borderColor: string;
  cellColor: string;
  cellPadding: number;
  alternateRows: boolean;
  alternateRowColor: string;
  alternateColumns: boolean;
  alternateColumnColor: string;
  tableWidth: number;
  tableAlignment: 'left' | 'center' | 'right';
  tableBorderWidth: number;
  tableBorderStyle: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  tableBorderColor: string;
  tableBackgroundColor: string;
  tableNoBackground: boolean;
  tableCellSpacing: number;
}

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
  /** Inline styles keyed by spreadsheet coordinates such as A1 or C4. */
  cellStyles?: CellStyles;
  /** Preserved TinyMCE formatting on the generated table and caption. */
  tableStyle?: string;
  captionStyle?: string;
  tableBorder?: number;
  /** Appearance used by this table; explicit cellStyles always take precedence. */
  appearance?: SpreadsheetAppearance;
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
const MAX_TABLE_BORDER = 20;
const DEFAULT_TABLE_STYLE = 'min-width:25%';
const DEFAULT_APPEARANCE: SpreadsheetAppearance = {
  borderWidth: 1,
  borderColor: '#ced4da',
  cellColor: '#ffffff',
  cellPadding: 6,
  alternateRows: true,
  alternateRowColor: '#f6f7f8',
  alternateColumns: false,
  alternateColumnColor: '#eef6f7',
  tableWidth: 0,
  tableAlignment: 'left',
  tableBorderWidth: 1,
  tableBorderStyle: 'solid',
  tableBorderColor: '#ced4da',
  tableBackgroundColor: '#ffffff',
  tableNoBackground: true,
  tableCellSpacing: 0,
};
const PRESERVED_STYLE_PROPERTIES = new Set([
  'background-color',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-style',
  'border-bottom-width',
  'border-color',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-style',
  'border-top-width',
  'border-width',
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'height',
  'line-height',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'text-align',
  'text-decoration',
  'vertical-align',
  'white-space',
  'width',
]);
const PRESERVED_TABLE_STYLE_PROPERTIES = new Set([
  ...PRESERVED_STYLE_PROPERTIES,
  'border-collapse',
  'border-spacing',
  'margin-left',
  'margin-right',
  'min-width',
]);

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function normalizeAppearance(
  candidate?: Partial<SpreadsheetAppearance>,
): SpreadsheetAppearance {
  const borderWidth = normalizeInteger(
    candidate?.borderWidth,
    DEFAULT_APPEARANCE.borderWidth,
    0,
    MAX_TABLE_BORDER,
  );
  const tableAlignments = new Set<SpreadsheetAppearance['tableAlignment']>([
    'left',
    'center',
    'right',
  ]);
  const tableBorderStyles = new Set<SpreadsheetAppearance['tableBorderStyle']>([
    'solid',
    'dashed',
    'dotted',
    'double',
    'none',
  ]);
  return {
    borderWidth,
    borderColor: normalizeColor(candidate?.borderColor, DEFAULT_APPEARANCE.borderColor),
    cellColor: normalizeColor(candidate?.cellColor, DEFAULT_APPEARANCE.cellColor),
    cellPadding: normalizeInteger(
      candidate?.cellPadding,
      DEFAULT_APPEARANCE.cellPadding,
      0,
      50,
    ),
    alternateRows: typeof candidate?.alternateRows === 'boolean'
      ? candidate.alternateRows
      : DEFAULT_APPEARANCE.alternateRows,
    alternateRowColor: normalizeColor(
      candidate?.alternateRowColor,
      DEFAULT_APPEARANCE.alternateRowColor,
    ),
    alternateColumns: typeof candidate?.alternateColumns === 'boolean'
      ? candidate.alternateColumns
      : DEFAULT_APPEARANCE.alternateColumns,
    alternateColumnColor: normalizeColor(
      candidate?.alternateColumnColor,
      DEFAULT_APPEARANCE.alternateColumnColor,
    ),
    tableWidth: normalizeInteger(
      candidate?.tableWidth,
      DEFAULT_APPEARANCE.tableWidth,
      0,
      100,
    ),
    tableAlignment: candidate?.tableAlignment
      && tableAlignments.has(candidate.tableAlignment)
      ? candidate.tableAlignment
      : DEFAULT_APPEARANCE.tableAlignment,
    tableBorderWidth: normalizeInteger(
      candidate?.tableBorderWidth,
      candidate?.borderWidth ?? DEFAULT_APPEARANCE.tableBorderWidth,
      0,
      MAX_TABLE_BORDER,
    ),
    tableBorderStyle: candidate?.tableBorderStyle
      && tableBorderStyles.has(candidate.tableBorderStyle)
      ? candidate.tableBorderStyle
      : DEFAULT_APPEARANCE.tableBorderStyle,
    tableBorderColor: normalizeColor(
      candidate?.tableBorderColor,
      candidate?.borderColor ?? DEFAULT_APPEARANCE.tableBorderColor,
    ),
    tableBackgroundColor: normalizeColor(
      candidate?.tableBackgroundColor,
      DEFAULT_APPEARANCE.tableBackgroundColor,
    ),
    tableNoBackground: typeof candidate?.tableNoBackground === 'boolean'
      ? candidate.tableNoBackground
      : DEFAULT_APPEARANCE.tableNoBackground,
    tableCellSpacing: normalizeInteger(
      candidate?.tableCellSpacing,
      DEFAULT_APPEARANCE.tableCellSpacing,
      0,
      50,
    ),
  };
}

function parseStoredAppearance(value?: string): SpreadsheetAppearance | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<SpreadsheetAppearance>;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    return normalizeAppearance(candidate);
  } catch {
    return null;
  }
}

function getEffectiveAppearanceDefaults(): SpreadsheetAppearance {
  const defaultsElement = document.getElementById('spreadsheet-appearance-defaults');
  const notebookDefaults = parseStoredAppearance(defaultsElement?.dataset.notebook);
  if (notebookDefaults) return notebookDefaults;
  return parseStoredAppearance(defaultsElement?.dataset.user)
    ?? { ...DEFAULT_APPEARANCE };
}

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
    cellStyles: normalizeCellStyles(candidate.cellStyles, rows, cols),
    tableStyle: sanitizeStyle(candidate.tableStyle, PRESERVED_TABLE_STYLE_PROPERTIES),
    captionStyle: sanitizeStyle(candidate.captionStyle, PRESERVED_STYLE_PROPERTIES),
    tableBorder: Number.isInteger(candidate.tableBorder)
      ? Math.max(0, Math.min(MAX_TABLE_BORDER, candidate.tableBorder))
      : undefined,
    appearance: candidate.appearance
      ? normalizeAppearance(candidate.appearance)
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

function sanitizeStyle(
  candidate: string | undefined,
  allowedProperties: Set<string>,
): string | undefined {
  if (!candidate) return undefined;
  const element = document.createElement('span');
  element.setAttribute('style', candidate);
  const declarations: string[] = [];
  for (let index = 0; index < element.style.length; index++) {
    const property = element.style.item(index).toLowerCase();
    const value = element.style.getPropertyValue(property).trim();
    if (!allowedProperties.has(property) || !value || hasUnsafeCssValue(value)) continue;
    declarations.push(`${property}:${value}`);
  }
  return declarations.length > 0 ? declarations.join(';') : undefined;
}

function hasUnsafeCssValue(value: string): boolean {
  return /(?:expression\s*\(|javascript\s*:|url\s*\(|@import|behavior\s*:)/i.test(value);
}

function normalizeCellStyles(
  candidate: CellStyles | undefined,
  rows: number,
  cols: number,
): CellStyles | undefined {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const result: CellStyles = {};
  Object.entries(candidate).forEach(([cellName, style]) => {
    const coordinates = coordinatesFromCellName(cellName);
    if (!coordinates || coordinates.col >= cols || coordinates.row >= rows) return;
    const sanitized = sanitizeStyle(
      typeof style === 'string' ? style : undefined,
      PRESERVED_STYLE_PROPERTIES,
    );
    if (sanitized) result[cellName.toUpperCase()] = sanitized;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function getAppearanceBackground(
  appearance: SpreadsheetAppearance,
  col: number,
  row: number,
): string {
  let color = appearance.cellColor;
  if (appearance.alternateRows && row % 2 === 1) {
    color = appearance.alternateRowColor;
  }
  // Column striping intentionally wins at row/column intersections.
  if (appearance.alternateColumns && col % 2 === 1) {
    color = appearance.alternateColumnColor;
  }
  return color;
}

function getAppearanceCellStyle(
  appearance: SpreadsheetAppearance,
  col: number,
  row: number,
  includeBackground = true,
): string {
  const declarations = [
    `border:${appearance.borderWidth}px solid ${appearance.borderColor}`,
    `padding:${appearance.cellPadding}px`,
  ];
  if (includeBackground) {
    declarations.push(`background-color:${getAppearanceBackground(appearance, col, row)}`);
  }
  return declarations.join(';');
}

function getAppearanceTableStyle(appearance: SpreadsheetAppearance): string {
  const declarations = [
    appearance.tableBorderStyle === 'none' || appearance.tableBorderWidth === 0
      ? 'border:none'
      : `border:${appearance.tableBorderWidth}px ${appearance.tableBorderStyle} ${appearance.tableBorderColor}`,
    appearance.tableCellSpacing === 0
      ? 'border-collapse:collapse'
      : `border-collapse:separate;border-spacing:${appearance.tableCellSpacing}px`,
  ];
  if (appearance.tableWidth > 0) declarations.push(`width:${appearance.tableWidth}%`);
  if (!appearance.tableNoBackground) {
    declarations.push(`background-color:${appearance.tableBackgroundColor}`);
  }
  if (appearance.tableAlignment === 'center') {
    declarations.push('margin-left:auto', 'margin-right:auto');
  } else if (appearance.tableAlignment === 'right') {
    declarations.push('margin-left:auto', 'margin-right:0');
  } else {
    declarations.push('margin-left:0', 'margin-right:auto');
  }
  return declarations.join(';');
}

function mergeCellStyles(
  explicitStyles: CellStyles | undefined,
  appearance: SpreadsheetAppearance,
  rows: number,
  cols: number,
): CellStyles {
  const result: CellStyles = {};
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellName = `${colLabel(col)}${row + 1}`;
      const explicit = explicitStyles?.[cellName];
      result[cellName] = explicit
        ? `${getAppearanceCellStyle(appearance, col, row)};${explicit}`
        : getAppearanceCellStyle(appearance, col, row);
    }
  }
  return result;
}

/**
 * Remove declarations generated from appearance defaults while retaining
 * TinyMCE/jspreadsheet formatting that differs from those defaults.
 */
function stripAppearanceCellStyles(
  styles: CellStyles | undefined,
  appearance: SpreadsheetAppearance,
  rows: number,
  cols: number,
): CellStyles | undefined {
  if (!styles) return undefined;
  const result: CellStyles = {};
  Object.entries(styles).forEach(([cellName, style]) => {
    const coordinates = coordinatesFromCellName(cellName);
    if (!coordinates || coordinates.col >= cols || coordinates.row >= rows) return;
    const actual = document.createElement('span');
    actual.setAttribute('style', style);
    const generated = document.createElement('span');
    generated.setAttribute(
      'style',
      getAppearanceCellStyle(appearance, coordinates.col, coordinates.row),
    );
    for (let index = 0; index < generated.style.length; index++) {
      const property = generated.style.item(index);
      if (actual.style.getPropertyValue(property) === generated.style.getPropertyValue(property)) {
        actual.style.removeProperty(property);
      }
    }
    const remaining = sanitizeStyle(
      actual.getAttribute('style') ?? undefined,
      PRESERVED_STYLE_PROPERTIES,
    );
    if (remaining) result[cellName.toUpperCase()] = remaining;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function stripAppearanceTableStyle(
  style: string | undefined,
  appearance: SpreadsheetAppearance,
): string | undefined {
  if (!style) return undefined;
  const actual = document.createElement('span');
  actual.setAttribute('style', style);
  const generated = document.createElement('span');
  generated.setAttribute(
    'style',
    getAppearanceTableStyle(appearance),
  );
  for (let index = 0; index < generated.style.length; index++) {
    const property = generated.style.item(index);
    if (actual.style.getPropertyValue(property) === generated.style.getPropertyValue(property)) {
      actual.style.removeProperty(property);
    }
  }
  return sanitizeStyle(
    actual.getAttribute('style') ?? undefined,
    PRESERVED_TABLE_STYLE_PROPERTIES,
  );
}

function coordinatesFromCellName(cellName: string): { col: number; row: number } | null {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(cellName);
  if (!match) return null;
  let col = 0;
  for (const character of match[1].toUpperCase()) {
    col = (col * 26) + character.charCodeAt(0) - 64;
  }
  return { col: col - 1, row: parseInt(match[2], 10) - 1 };
}

function extractCellStyles(
  tableElement: HTMLTableElement,
  kind: SpreadsheetKind,
  rows: number,
  cols: number,
): CellStyles | undefined {
  const styles: CellStyles = {};
  const tableRows = Array.from(tableElement.querySelectorAll('tr'));
  const dataRows = kind === 'notebook' ? tableRows : tableRows.slice(1);
  dataRows.slice(0, rows).forEach((row, rowIndex) => {
    const rowCells = Array.from(row.querySelectorAll<HTMLElement>('th, td'));
    const dataCells = kind === 'notebook' ? rowCells : rowCells.slice(1);
    dataCells.slice(0, cols).forEach((cell, colIndex) => {
      const style = sanitizeStyle(cell.getAttribute('style') ?? undefined, PRESERVED_STYLE_PROPERTIES);
      if (style) styles[`${colLabel(colIndex)}${rowIndex + 1}`] = style;
    });
  });
  return Object.keys(styles).length > 0 ? styles : undefined;
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

function createLabeledControl(labelText: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'inline-spreadsheet-appearance-control';
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(text, control);
  return label;
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
  borderWidthInput: HTMLInputElement;
  borderColorInput: HTMLInputElement;
  cellColorInput: HTMLInputElement;
  alternateRowsInput: HTMLInputElement;
  alternateRowColorInput: HTMLInputElement;
  alternateColumnsInput: HTMLInputElement;
  alternateColumnColorInput: HTMLInputElement;
  tableWidthInput: HTMLInputElement;
  tableAlignmentSelect: HTMLSelectElement;
  tableBorderWidthInput: HTMLInputElement;
  tableBorderStyleSelect: HTMLSelectElement;
  tableBorderColorInput: HTMLInputElement;
  tableBackgroundColorInput: HTMLInputElement;
  tableNoBackgroundInput: HTMLInputElement;
  tableCellSpacingInput: HTMLInputElement;
  cellPaddingInput: HTMLInputElement;
  appearanceScopeSelect: HTMLSelectElement;
  saveAppearanceDefaultBtn: HTMLButtonElement;
  appearanceStatus: HTMLSpanElement;
  cellFormatColorInput: HTMLInputElement;
  cellFormatBorderColorInput: HTMLInputElement;
  cellFormatBorderStyleSelect: HTMLSelectElement;
  cellFormatBorderWidthInput: HTMLInputElement;
  cellFormatFontFamilySelect: HTMLSelectElement;
  cellFormatFontSizeInput: HTMLInputElement;
  cellFormatBoldInput: HTMLInputElement;
  cellFormatItalicInput: HTMLInputElement;
  cellFormatUnderlineInput: HTMLInputElement;
  cellFormatTextColorInput: HTMLInputElement;
  cellFormatTextAlignSelect: HTMLSelectElement;
  cellFormatVerticalAlignSelect: HTMLSelectElement;
  applyCellFormatBtn: HTMLButtonElement;
  applyFontFormatBtn: HTMLButtonElement;
  clearCellFormatBtn: HTMLButtonElement;
  cellFormatStatus: HTMLSpanElement;
  cellFormatNoColorInput: HTMLInputElement;
  cellFormatNoTextColorInput: HTMLInputElement;
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

  const appearance = normalizeAppearance(initial.appearance);
  const appearancePanel = document.createElement('details');
  appearancePanel.className = 'inline-spreadsheet-appearance';
  appearancePanel.open = true;
  const appearanceSummary = document.createElement('summary');
  appearanceSummary.textContent = 'Table and cell appearance';
  appearancePanel.appendChild(appearanceSummary);
  const tableAppearanceLabel = document.createElement('strong');
  tableAppearanceLabel.textContent = 'Table defaults';
  const tableAppearanceGrid = document.createElement('div');
  tableAppearanceGrid.className = 'inline-spreadsheet-appearance-grid';

  const tableWidthInput = createInput(
    'number',
    String(appearance.tableWidth),
    'Default table width in percent; zero uses automatic width',
  );
  tableWidthInput.min = '0';
  tableWidthInput.max = '100';
  const tableAlignmentSelect = document.createElement('select');
  tableAlignmentSelect.className = 'form-control form-control-sm';
  tableAlignmentSelect.setAttribute('aria-label', 'Default table alignment');
  tableAlignmentSelect.innerHTML = `
    <option value="left">Left</option>
    <option value="center">Center</option>
    <option value="right">Right</option>
  `;
  tableAlignmentSelect.value = appearance.tableAlignment;
  const tableBorderWidthInput = createInput(
    'number',
    String(appearance.tableBorderWidth),
    'Default table border width',
  );
  tableBorderWidthInput.min = '0';
  tableBorderWidthInput.max = String(MAX_TABLE_BORDER);
  const tableBorderStyleSelect = document.createElement('select');
  tableBorderStyleSelect.className = 'form-control form-control-sm';
  tableBorderStyleSelect.setAttribute('aria-label', 'Default table border style');
  tableBorderStyleSelect.innerHTML = `
    <option value="solid">Solid</option>
    <option value="dashed">Dashed</option>
    <option value="dotted">Dotted</option>
    <option value="double">Double</option>
    <option value="none">No border</option>
  `;
  tableBorderStyleSelect.value = appearance.tableBorderStyle;
  const tableBorderColorInput = createInput(
    'color',
    appearance.tableBorderColor,
    'Default table border color',
  );
  const tableBackgroundColorInput = createInput(
    'color',
    appearance.tableBackgroundColor,
    'Default table background color',
  );
  const tableNoBackgroundInput = document.createElement('input');
  tableNoBackgroundInput.type = 'checkbox';
  tableNoBackgroundInput.checked = appearance.tableNoBackground;
  tableNoBackgroundInput.setAttribute('aria-label', 'No default table background color');
  tableBackgroundColorInput.disabled = tableNoBackgroundInput.checked;
  const tableCellSpacingInput = createInput(
    'number',
    String(appearance.tableCellSpacing),
    'Default table cell spacing',
  );
  tableCellSpacingInput.min = '0';
  tableCellSpacingInput.max = '50';
  const cellPaddingInput = createInput(
    'number',
    String(appearance.cellPadding),
    'Default cell padding',
  );
  cellPaddingInput.min = '0';
  cellPaddingInput.max = '50';
  tableAppearanceGrid.append(
    createLabeledControl('Width % (0 = auto)', tableWidthInput),
    createLabeledControl('Alignment', tableAlignmentSelect),
    createLabeledControl('Border width', tableBorderWidthInput),
    createLabeledControl('Border style', tableBorderStyleSelect),
    createLabeledControl('Border color', tableBorderColorInput),
    createLabeledControl('Background', tableBackgroundColorInput),
    createLabeledControl('No background', tableNoBackgroundInput),
    createLabeledControl('Cell spacing', tableCellSpacingInput),
    createLabeledControl('Cell padding', cellPaddingInput),
  );
  appearancePanel.append(tableAppearanceLabel, tableAppearanceGrid);

  const cellAppearanceLabel = document.createElement('strong');
  cellAppearanceLabel.textContent = 'Cell defaults';
  const appearanceGrid = document.createElement('div');
  appearanceGrid.className = 'inline-spreadsheet-appearance-grid';

  const borderWidthInput = createInput(
    'number',
    String(appearance.borderWidth),
    'Default cell border width',
  );
  borderWidthInput.min = '0';
  borderWidthInput.max = String(MAX_TABLE_BORDER);
  const borderColorInput = createInput('color', appearance.borderColor, 'Default border color');
  const cellColorInput = createInput('color', appearance.cellColor, 'Default cell color');
  const alternateRowColorInput = createInput(
    'color',
    appearance.alternateRowColor,
    'Alternating row color',
  );
  const alternateColumnColorInput = createInput(
    'color',
    appearance.alternateColumnColor,
    'Alternating column color',
  );
  const alternateRowsInput = document.createElement('input');
  alternateRowsInput.type = 'checkbox';
  alternateRowsInput.checked = appearance.alternateRows;
  alternateRowsInput.setAttribute('aria-label', 'Use alternating row color');
  const alternateColumnsInput = document.createElement('input');
  alternateColumnsInput.type = 'checkbox';
  alternateColumnsInput.checked = appearance.alternateColumns;
  alternateColumnsInput.setAttribute('aria-label', 'Use alternating column color');

  appearanceGrid.append(
    createLabeledControl('Border size', borderWidthInput),
    createLabeledControl('Border color', borderColorInput),
    createLabeledControl('Cell color', cellColorInput),
    createLabeledControl('Alternate rows', alternateRowsInput),
    createLabeledControl('Row color', alternateRowColorInput),
    createLabeledControl('Alternate columns', alternateColumnsInput),
    createLabeledControl('Column color', alternateColumnColorInput),
  );
  appearancePanel.append(cellAppearanceLabel, appearanceGrid);

  const appearanceDefaults = document.createElement('div');
  appearanceDefaults.className = 'inline-spreadsheet-appearance-defaults';
  const appearanceScopeSelect = document.createElement('select');
  appearanceScopeSelect.className = 'form-control form-control-sm';
  appearanceScopeSelect.setAttribute('aria-label', 'Save appearance default for');
  appearanceScopeSelect.innerHTML = `
    <option value="notebook">This notebook</option>
    <option value="user">My account</option>
  `;
  const saveAppearanceDefaultBtn = document.createElement('button');
  saveAppearanceDefaultBtn.type = 'button';
  saveAppearanceDefaultBtn.className = 'btn btn-sm btn-outline-primary';
  saveAppearanceDefaultBtn.textContent = 'Save as default';
  const appearanceStatus = document.createElement('span');
  appearanceStatus.className = 'inline-spreadsheet-appearance-status';
  appearanceStatus.textContent = 'Notebook defaults override account defaults; direct table and cell formatting wins.';
  appearanceDefaults.append(
    appearanceScopeSelect,
    saveAppearanceDefaultBtn,
    appearanceStatus,
  );
  appearancePanel.appendChild(appearanceDefaults);
  dialog.appendChild(appearancePanel);

  const cellFormatBar = document.createElement('div');
  cellFormatBar.className = 'inline-spreadsheet-cell-format';
  const cellStyleRow = document.createElement('div');
  cellStyleRow.className = 'inline-spreadsheet-cell-format-row';
  const cellFormatLabel = document.createElement('strong');
  cellFormatLabel.textContent = 'Cell';
  const cellFormatColorInput = createInput(
    'color',
    appearance.cellColor,
    'Selected cell background color',
  );
  const cellFormatNoColorInput = document.createElement('input');
  cellFormatNoColorInput.type = 'checkbox';
  cellFormatNoColorInput.setAttribute('aria-label', 'Remove selected cell background color');
  const cellFormatBorderColorInput = createInput(
    'color',
    appearance.borderColor,
    'Selected cell border color',
  );
  const cellFormatBorderStyleSelect = document.createElement('select');
  cellFormatBorderStyleSelect.className = 'form-control form-control-sm';
  cellFormatBorderStyleSelect.setAttribute('aria-label', 'Selected cell border style');
  cellFormatBorderStyleSelect.innerHTML = `
    <option value="solid">Solid border</option>
    <option value="dashed">Dashed border</option>
    <option value="dotted">Dotted border</option>
    <option value="double">Double border</option>
    <option value="none">No border</option>
  `;
  const cellFormatBorderWidthInput = createInput(
    'number',
    String(appearance.borderWidth),
    'Selected cell border width',
  );
  cellFormatBorderWidthInput.min = '0';
  cellFormatBorderWidthInput.max = String(MAX_TABLE_BORDER);
  const applyCellFormatBtn = document.createElement('button');
  applyCellFormatBtn.type = 'button';
  applyCellFormatBtn.className = 'btn btn-sm btn-outline-primary';
  applyCellFormatBtn.textContent = 'Apply cell style';
  cellStyleRow.append(
    cellFormatLabel,
    createLabeledControl('Fill', cellFormatColorInput),
    createLabeledControl('No fill', cellFormatNoColorInput),
    createLabeledControl('Border color', cellFormatBorderColorInput),
    createLabeledControl('Border style', cellFormatBorderStyleSelect),
    createLabeledControl('Border width', cellFormatBorderWidthInput),
    applyCellFormatBtn,
  );

  const fontStyleRow = document.createElement('div');
  fontStyleRow.className = 'inline-spreadsheet-cell-format-row';
  const fontFormatLabel = document.createElement('strong');
  fontFormatLabel.textContent = 'Font';
  const cellFormatFontFamilySelect = document.createElement('select');
  cellFormatFontFamilySelect.className = 'form-control form-control-sm';
  cellFormatFontFamilySelect.setAttribute('aria-label', 'Selected cell font family');
  cellFormatFontFamilySelect.innerHTML = `
    <option value="">Default font</option>
    <option value="Arial, sans-serif">Arial</option>
    <option value="Verdana, sans-serif">Verdana</option>
    <option value="Georgia, serif">Georgia</option>
    <option value="'Times New Roman', serif">Times New Roman</option>
    <option value="'Courier New', monospace">Courier New</option>
  `;
  const cellFormatFontSizeInput = createInput(
    'number',
    '12',
    'Selected cell font size in points',
  );
  cellFormatFontSizeInput.min = '6';
  cellFormatFontSizeInput.max = '72';
  const cellFormatBoldInput = document.createElement('input');
  cellFormatBoldInput.type = 'checkbox';
  cellFormatBoldInput.setAttribute('aria-label', 'Bold selected cells');
  const cellFormatItalicInput = document.createElement('input');
  cellFormatItalicInput.type = 'checkbox';
  cellFormatItalicInput.setAttribute('aria-label', 'Italicize selected cells');
  const cellFormatUnderlineInput = document.createElement('input');
  cellFormatUnderlineInput.type = 'checkbox';
  cellFormatUnderlineInput.setAttribute('aria-label', 'Underline selected cells');
  const cellFormatTextColorInput = createInput(
    'color',
    '#212529',
    'Selected cell text color',
  );
  const cellFormatNoTextColorInput = document.createElement('input');
  cellFormatNoTextColorInput.type = 'checkbox';
  cellFormatNoTextColorInput.setAttribute('aria-label', 'Remove selected cell text color');
  const cellFormatTextAlignSelect = document.createElement('select');
  cellFormatTextAlignSelect.className = 'form-control form-control-sm';
  cellFormatTextAlignSelect.setAttribute('aria-label', 'Selected cell horizontal alignment');
  cellFormatTextAlignSelect.innerHTML = `
    <option value="">Default</option>
    <option value="left">Left</option>
    <option value="center">Center</option>
    <option value="right">Right</option>
    <option value="justify">Justify</option>
  `;
  const cellFormatVerticalAlignSelect = document.createElement('select');
  cellFormatVerticalAlignSelect.className = 'form-control form-control-sm';
  cellFormatVerticalAlignSelect.setAttribute('aria-label', 'Selected cell vertical alignment');
  cellFormatVerticalAlignSelect.innerHTML = `
    <option value="">Default</option>
    <option value="top">Top</option>
    <option value="middle">Middle</option>
    <option value="bottom">Bottom</option>
  `;
  const applyFontFormatBtn = document.createElement('button');
  applyFontFormatBtn.type = 'button';
  applyFontFormatBtn.className = 'btn btn-sm btn-outline-primary';
  applyFontFormatBtn.textContent = 'Apply font';
  fontStyleRow.append(
    fontFormatLabel,
    createLabeledControl('Family', cellFormatFontFamilySelect),
    createLabeledControl('Size (pt)', cellFormatFontSizeInput),
    createLabeledControl('Bold', cellFormatBoldInput),
    createLabeledControl('Italic', cellFormatItalicInput),
    createLabeledControl('Underline', cellFormatUnderlineInput),
    createLabeledControl('Text color', cellFormatTextColorInput),
    createLabeledControl('No text color', cellFormatNoTextColorInput),
    createLabeledControl('Horizontal', cellFormatTextAlignSelect),
    createLabeledControl('Vertical', cellFormatVerticalAlignSelect),
    applyFontFormatBtn,
  );

  const clearCellFormatBtn = document.createElement('button');
  clearCellFormatBtn.type = 'button';
  clearCellFormatBtn.className = 'btn btn-sm btn-outline-secondary';
  clearCellFormatBtn.textContent = 'Clear all cell formatting';
  const cellFormatStatus = document.createElement('span');
  cellFormatStatus.className = 'inline-spreadsheet-cell-format-status';
  cellFormatStatus.textContent = 'Select one or more cells, then apply cell or font properties.';
  cellFormatBar.append(
    cellStyleRow,
    fontStyleRow,
    clearCellFormatBtn,
    cellFormatStatus,
  );
  dialog.appendChild(cellFormatBar);

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
    borderWidthInput,
    borderColorInput,
    cellColorInput,
    alternateRowsInput,
    alternateRowColorInput,
    alternateColumnsInput,
    alternateColumnColorInput,
    tableWidthInput,
    tableAlignmentSelect,
    tableBorderWidthInput,
    tableBorderStyleSelect,
    tableBorderColorInput,
    tableBackgroundColorInput,
    tableNoBackgroundInput,
    tableCellSpacingInput,
    cellPaddingInput,
    appearanceScopeSelect,
    saveAppearanceDefaultBtn,
    appearanceStatus,
    cellFormatColorInput,
    cellFormatBorderColorInput,
    cellFormatBorderStyleSelect,
    cellFormatBorderWidthInput,
    cellFormatFontFamilySelect,
    cellFormatFontSizeInput,
    cellFormatBoldInput,
    cellFormatItalicInput,
    cellFormatUnderlineInput,
    cellFormatTextColorInput,
    cellFormatTextAlignSelect,
    cellFormatVerticalAlignSelect,
    applyCellFormatBtn,
    applyFontFormatBtn,
    clearCellFormatBtn,
    cellFormatStatus,
    cellFormatNoColorInput,
    cellFormatNoTextColorInput,
  };
}

function spreadsheetPresetFromValue(value: string): SpreadsheetData | null {
  if (value === 'notebook') return createNotebookSpreadsheetData();
  if (value.startsWith('plate-')) {
    return createWellPlateSpreadsheetData(parseInt(value.slice('plate-'.length), 10));
  }
  return null;
}

function appearanceFromControls(
  ui: ReturnType<typeof createOverlay>,
): SpreadsheetAppearance {
  return normalizeAppearance({
    borderWidth: parseInt(ui.borderWidthInput.value, 10),
    borderColor: ui.borderColorInput.value,
    cellColor: ui.cellColorInput.value,
    cellPadding: parseInt(ui.cellPaddingInput.value, 10),
    alternateRows: ui.alternateRowsInput.checked,
    alternateRowColor: ui.alternateRowColorInput.value,
    alternateColumns: ui.alternateColumnsInput.checked,
    alternateColumnColor: ui.alternateColumnColorInput.value,
    tableWidth: parseInt(ui.tableWidthInput.value, 10),
    tableAlignment: ui.tableAlignmentSelect.value as SpreadsheetAppearance['tableAlignment'],
    tableBorderWidth: parseInt(ui.tableBorderWidthInput.value, 10),
    tableBorderStyle: ui.tableBorderStyleSelect.value as SpreadsheetAppearance['tableBorderStyle'],
    tableBorderColor: ui.tableBorderColorInput.value,
    tableBackgroundColor: ui.tableBackgroundColorInput.value,
    tableNoBackground: ui.tableNoBackgroundInput.checked,
    tableCellSpacing: parseInt(ui.tableCellSpacingInput.value, 10),
  });
}

async function saveAppearanceDefault(
  scope: AppearanceScope,
  appearance: SpreadsheetAppearance,
): Promise<void> {
  const json = JSON.stringify(appearance);
  const defaultsElement = document.getElementById('spreadsheet-appearance-defaults');
  if (scope === 'user') {
    await ApiC.patch('users/me', { spreadsheet_defaults: json });
    if (defaultsElement) defaultsElement.dataset.user = json;
    return;
  }
  if (entity.id === null) {
    throw new Error('A notebook must be saved before it can have spreadsheet defaults.');
  }
  await ApiC.patch(`${entity.type}/${entity.id}`, { spreadsheet_defaults: json });
  if (defaultsElement) defaultsElement.dataset.notebook = json;
}

function updateQuickCellStyle(
  existingStyle: string | undefined,
  backgroundColor: string | null,
  borderColor: string,
  borderStyle: string,
  borderWidth: number,
  clear: boolean,
): string | undefined {
  const element = document.createElement('span');
  if (existingStyle) element.setAttribute('style', existingStyle);

  const borderProperties = Array.from(
    { length: element.style.length },
    (_, index) => element.style.item(index),
  ).filter(property => property.startsWith('border'));
  borderProperties.forEach(property => element.style.removeProperty(property));
  element.style.removeProperty('background-color');

  if (!clear) {
    if (backgroundColor !== null) {
      element.style.setProperty('background-color', backgroundColor);
    }
    element.style.setProperty(
      'border',
      borderStyle === 'none'
        ? 'none'
        : `${borderWidth}px ${borderStyle} ${borderColor}`,
    );
  }

  return sanitizeStyle(
    element.getAttribute('style') ?? undefined,
    PRESERVED_STYLE_PROPERTIES,
  );
}

function updateQuickFontStyle(
  existingStyle: string | undefined,
  format: CellFontFormat,
  clear: boolean,
): string | undefined {
  const element = document.createElement('span');
  if (existingStyle) element.setAttribute('style', existingStyle);

  const properties = [
    'color',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'text-align',
    'text-decoration',
    'vertical-align',
  ];
  if (clear) {
    properties.forEach(property => element.style.removeProperty(property));
  } else {
    Object.entries(format).forEach(([property, value]) => {
      const cssProperty = property.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
      if (value) {
        element.style.setProperty(cssProperty, value);
      } else {
        element.style.removeProperty(cssProperty);
      }
    });
  }

  return sanitizeStyle(
    element.getAttribute('style') ?? undefined,
    PRESERVED_STYLE_PROPERTIES,
  );
}

/**
 * Open the spreadsheet overlay and return the raw formula data plus computed
 * values when the user inserts or updates the table.
 */
export function openSpreadsheetModal(initialData: SpreadsheetData): Promise<{ raw: SpreadsheetData; computed: AOA }> {
  return new Promise((resolve, reject) => {
    let working = normalizeSpreadsheetData({
      ...initialData,
      appearance: initialData.appearance ?? getEffectiveAppearanceDefaults(),
    });
    const ui = createOverlay(working);
    let sheetContainer: HTMLDivElement | null = null;
    let worksheet: JssInstance = null;
    let selectedRange: CellRange | null = null;
    const changedFontProperties = new Set<keyof CellFontFormat>();

    document.body.appendChild(ui.overlay);

    const readRawData = (): AOA => {
      const data = worksheet?.getData?.();
      return Array.isArray(data) ? data : working.data;
    };

    const readCellStyles = (rows = working.rows, cols = working.cols): CellStyles | undefined => {
      const styles = worksheet?.getStyle?.();
      const normalized = normalizeCellStyles(
        styles && typeof styles === 'object' ? styles as CellStyles : working.cellStyles,
        rows,
        cols,
      );
      return stripAppearanceCellStyles(
        normalized,
        normalizeAppearance(working.appearance),
        rows,
        cols,
      );
    };

    const getSelectedRange = (): CellRange | null => {
      const current = worksheet?.getSelection?.();
      if (Array.isArray(current)
        && current.length >= 4
        && current.slice(0, 4).every(value => Number.isInteger(value))
      ) {
        selectedRange = current.slice(0, 4) as CellRange;
      }
      return selectedRange;
    };

    const updateSelectionStatus = (range: CellRange): void => {
      const startCol = Math.min(range[0], range[2]);
      const startRow = Math.min(range[1], range[3]);
      const endCol = Math.max(range[0], range[2]);
      const endRow = Math.max(range[1], range[3]);
      const cellCount = (endCol - startCol + 1) * (endRow - startRow + 1);
      const rangeLabel = `${colLabel(startCol)}${startRow + 1}:${colLabel(endCol)}${endRow + 1}`;
      ui.cellFormatStatus.textContent = `${rangeLabel} selected (${cellCount} cell${cellCount === 1 ? '' : 's'}).`;
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
      ui.sheetHost.setAttribute(
        'style',
        `${getAppearanceTableStyle(normalizeAppearance(working.appearance))};max-width:100%`,
      );
      const instance = (jspreadsheet as unknown as JssFactory)(sheetContainer, {
        worksheets: [{
          data: working.data,
          minDimensions: [working.cols, working.rows],
          style: mergeCellStyles(
            working.cellStyles,
            normalizeAppearance(working.appearance),
            working.rows,
            working.cols,
          ),
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
        onselection: (
          _worksheet: unknown,
          startCol: number,
          startRow: number,
          endCol: number,
          endRow: number,
        ): void => {
          const range: CellRange = [startCol, startRow, endCol, endRow];
          if (range.every(value => Number.isInteger(value))) {
            selectedRange = range;
            updateSelectionStatus(range);
          }
        },
      });
      worksheet = getWorksheet(instance);
      ui.rowsInput.value = String(working.rows);
      ui.colsInput.value = String(working.cols);
      if (selectedRange) {
        const maxCol = working.cols - 1;
        const maxRow = working.rows - 1;
        selectedRange = [
          Math.max(0, Math.min(maxCol, selectedRange[0])),
          Math.max(0, Math.min(maxRow, selectedRange[1])),
          Math.max(0, Math.min(maxCol, selectedRange[2])),
          Math.max(0, Math.min(maxRow, selectedRange[3])),
        ];
        worksheet?.updateSelectionFromCoords?.(...selectedRange);
        updateSelectionStatus(selectedRange);
      }
    };

    const applyAppearance = (): void => {
      const appearance = appearanceFromControls(ui);
      const updated: SpreadsheetData = {
        ...working,
        data: resizeData(readRawData(), working.rows, working.cols),
        cellStyles: readCellStyles(),
        appearance,
      };
      mountSpreadsheet(updated);
    };

    const applyDimensions = (): void => {
      const rows = clampDimension(parseInt(ui.rowsInput.value, 10), working.rows);
      const cols = clampDimension(parseInt(ui.colsInput.value, 10), working.cols);
      const resized: SpreadsheetData = {
        ...working,
        data: resizeData(readRawData(), rows, cols),
        cellStyles: readCellStyles(rows, cols),
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
      mountSpreadsheet({
        ...preset,
        appearance: appearanceFromControls(ui),
      });
    });

    ui.resizeBtn.addEventListener('click', applyDimensions);
    [
      ui.borderWidthInput,
      ui.borderColorInput,
      ui.cellColorInput,
      ui.alternateRowsInput,
      ui.alternateRowColorInput,
      ui.alternateColumnsInput,
      ui.alternateColumnColorInput,
      ui.tableWidthInput,
      ui.tableAlignmentSelect,
      ui.tableBorderWidthInput,
      ui.tableBorderStyleSelect,
      ui.tableBorderColorInput,
      ui.tableBackgroundColorInput,
      ui.tableNoBackgroundInput,
      ui.tableCellSpacingInput,
      ui.cellPaddingInput,
    ].forEach(input => input.addEventListener('change', applyAppearance));
    ui.tableBackgroundColorInput.addEventListener('change', () => {
      ui.tableNoBackgroundInput.checked = false;
      ui.tableBackgroundColorInput.disabled = false;
      applyAppearance();
    });
    ui.tableNoBackgroundInput.addEventListener('change', () => {
      ui.tableBackgroundColorInput.disabled = ui.tableNoBackgroundInput.checked;
    });
    ui.saveAppearanceDefaultBtn.addEventListener('click', async () => {
      applyAppearance();
      const scope = ui.appearanceScopeSelect.value as AppearanceScope;
      ui.saveAppearanceDefaultBtn.disabled = true;
      ui.appearanceStatus.textContent = 'Saving…';
      try {
        await saveAppearanceDefault(scope, normalizeAppearance(working.appearance));
        const notebookOverridesAccount = scope === 'user'
          && Boolean(document.getElementById('spreadsheet-appearance-defaults')?.dataset.notebook);
        ui.appearanceStatus.textContent = notebookOverridesAccount
          ? 'Account default saved. This notebook still uses its notebook override.'
          : (scope === 'user'
            ? 'Saved as your account default.'
            : 'Saved as the default for this notebook.');
      } catch (error) {
        ui.appearanceStatus.textContent = error instanceof Error
          ? error.message
          : 'Could not save the appearance default.';
      } finally {
        ui.saveAppearanceDefaultBtn.disabled = false;
      }
    });
    const updateSelectedCells = (
      updateStyle: (style: string | undefined) => string | undefined,
      successMessage: string,
    ): void => {
      const selection = getSelectedRange();
      if (!selection) {
        ui.cellFormatStatus.textContent = 'Select one or more cells first.';
        return;
      }
      const startCol = Math.min(selection[0], selection[2]);
      const startRow = Math.min(selection[1], selection[3]);
      const endCol = Math.max(selection[0], selection[2]);
      const endRow = Math.max(selection[1], selection[3]);
      const rawData = readRawData();
      const rows = clampDimension(rawData.length, working.rows);
      const cols = clampDimension(
        rawData.reduce((max, row) => Math.max(max, row.length), 0),
        working.cols,
      );
      const cellStyles = readCellStyles(rows, cols) ?? {};

      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          const cellName = `${colLabel(col)}${row + 1}`;
          const style = updateStyle(cellStyles[cellName]);
          if (style) {
            cellStyles[cellName] = style;
          } else {
            delete cellStyles[cellName];
          }
        }
      }

      mountSpreadsheet({
        ...working,
        data: resizeData(rawData, rows, cols),
        rows,
        cols,
        cellStyles: Object.keys(cellStyles).length > 0 ? cellStyles : undefined,
      });
      const cellCount = (endCol - startCol + 1) * (endRow - startRow + 1);
      ui.cellFormatStatus.textContent = `${successMessage} ${cellCount} cell${cellCount === 1 ? '' : 's'}.`;
    };
    const applyCellFormat = (): void => {
      const borderWidth = Math.max(
        0,
        Math.min(MAX_TABLE_BORDER, parseInt(ui.cellFormatBorderWidthInput.value, 10) || 0),
      );
      updateSelectedCells(
        style => updateQuickCellStyle(
          style,
          ui.cellFormatNoColorInput.checked ? null : ui.cellFormatColorInput.value,
          ui.cellFormatBorderColorInput.value,
          ui.cellFormatBorderStyleSelect.value,
          borderWidth,
          false,
        ),
        'Applied cell style to',
      );
    };
    const applyFontFormat = (): void => {
      if (changedFontProperties.size === 0) {
        ui.cellFormatStatus.textContent = 'Choose at least one font property first.';
        return;
      }
      const fontSize = Math.max(
        6,
        Math.min(72, parseInt(ui.cellFormatFontSizeInput.value, 10) || 12),
      );
      const format: CellFontFormat = {};
      if (changedFontProperties.has('fontFamily')) {
        format.fontFamily = ui.cellFormatFontFamilySelect.value;
      }
      if (changedFontProperties.has('fontSize')) format.fontSize = `${fontSize}pt`;
      if (changedFontProperties.has('fontWeight')) {
        format.fontWeight = ui.cellFormatBoldInput.checked ? 'bold' : 'normal';
      }
      if (changedFontProperties.has('fontStyle')) {
        format.fontStyle = ui.cellFormatItalicInput.checked ? 'italic' : 'normal';
      }
      if (changedFontProperties.has('textDecoration')) {
        format.textDecoration = ui.cellFormatUnderlineInput.checked ? 'underline' : 'none';
      }
      if (changedFontProperties.has('color')) {
        format.color = ui.cellFormatNoTextColorInput.checked
          ? ''
          : ui.cellFormatTextColorInput.value;
      }
      if (changedFontProperties.has('textAlign')) {
        format.textAlign = ui.cellFormatTextAlignSelect.value;
      }
      if (changedFontProperties.has('verticalAlign')) {
        format.verticalAlign = ui.cellFormatVerticalAlignSelect.value;
      }
      updateSelectedCells(
        style => updateQuickFontStyle(style, format, false),
        'Applied font properties to',
      );
    };
    const fontPropertyControls: Array<[HTMLElement, keyof CellFontFormat]> = [
      [ui.cellFormatFontFamilySelect, 'fontFamily'],
      [ui.cellFormatFontSizeInput, 'fontSize'],
      [ui.cellFormatBoldInput, 'fontWeight'],
      [ui.cellFormatItalicInput, 'fontStyle'],
      [ui.cellFormatUnderlineInput, 'textDecoration'],
      [ui.cellFormatTextColorInput, 'color'],
      [ui.cellFormatNoTextColorInput, 'color'],
      [ui.cellFormatTextAlignSelect, 'textAlign'],
      [ui.cellFormatVerticalAlignSelect, 'verticalAlign'],
    ];
    fontPropertyControls.forEach(([control, property]) => {
      control.addEventListener('change', () => changedFontProperties.add(property));
    });
    ui.cellFormatColorInput.addEventListener('change', () => {
      ui.cellFormatNoColorInput.checked = false;
    });
    ui.cellFormatNoColorInput.addEventListener('change', () => {
      ui.cellFormatColorInput.disabled = ui.cellFormatNoColorInput.checked;
    });
    ui.cellFormatTextColorInput.addEventListener('change', () => {
      ui.cellFormatNoTextColorInput.checked = false;
    });
    ui.cellFormatNoTextColorInput.addEventListener('change', () => {
      ui.cellFormatTextColorInput.disabled = ui.cellFormatNoTextColorInput.checked;
    });
    ui.applyCellFormatBtn.addEventListener('click', applyCellFormat);
    ui.applyFontFormatBtn.addEventListener('click', applyFontFormat);
    ui.clearCellFormatBtn.addEventListener('click', () => {
      updateSelectedCells(
        style => updateQuickFontStyle(
          updateQuickCellStyle(
            style,
            null,
            ui.cellFormatBorderColorInput.value,
            ui.cellFormatBorderStyleSelect.value,
            0,
            true,
          ),
          {},
          true,
        ),
        'Cleared formatting from',
      );
    });
    ui.addRowBtn.addEventListener('click', () => {
      worksheet?.insertRow?.();
      ui.rowsInput.value = String(Math.min(MAX_DIMENSION, parseInt(ui.rowsInput.value, 10) + 1));
    });
    ui.addColBtn.addEventListener('click', () => {
      worksheet?.insertColumn?.();
      ui.colsInput.value = String(Math.min(MAX_DIMENSION, parseInt(ui.colsInput.value, 10) + 1));
    });

    ui.formulaButtons.forEach(button => button.addEventListener('click', () => {
      const selection = getSelectedRange();
      if (!selection) {
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
        cellStyles: readCellStyles(rows, cols),
        tableStyle: working.tableStyle,
        captionStyle: working.captionStyle,
        tableBorder: working.tableBorder,
        appearance: normalizeAppearance(working.appearance),
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
  const appearance = normalizeAppearance(raw.appearance);
  raw.appearance = appearance;
  const encoded = encodeSpreadsheetData(raw);
  const kind = raw.kind ?? 'standard';
  const styleAttribute = ` data-spreadsheet-style="${kind}"`;
  const plateAttribute = kind === 'well-plate' && raw.plateSize
    ? ` data-well-plate="${raw.plateSize}"`
    : '';
  let tableStyle = `${getAppearanceTableStyle(appearance)};${raw.tableStyle ?? DEFAULT_TABLE_STYLE}`;
  if (raw.tableBorder !== undefined
    && !/(?:^|;)border(?!-(?:collapse|spacing)\b)(?:-[a-z-]+)?\s*:/i.test(raw.tableStyle ?? '')
  ) {
    tableStyle = `${tableStyle};border:${raw.tableBorder}px solid ${appearance.tableBorderColor}`;
  }
  let html = `<table class="elabftw-spreadsheet" data-spreadsheet="${encoded}"${styleAttribute}${plateAttribute} style="${escapeHTMLAttribute(tableStyle)}">`;
  if (raw.caption) {
    const captionStyle = raw.captionStyle
      ? ` style="${escapeHTMLAttribute(raw.captionStyle)}"`
      : '';
    html += `<caption${captionStyle}>${escapeHTML(raw.caption)}</caption>`;
  }

  const displayData = resizeData(computed.length > 0 ? computed : raw.data, raw.rows, raw.cols);
  if (kind === 'notebook') {
    html += '<thead><tr>';
    for (let col = 0; col < raw.cols; col++) {
      html += `<th${getCellStyleAttribute(raw.cellStyles, appearance, col, 0)}>${escapeHTML(String(displayData[0]?.[col] ?? ''))}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let row = 1; row < raw.rows; row++) {
      html += '<tr>';
      for (let col = 0; col < raw.cols; col++) {
        html += `<td${getCellStyleAttribute(raw.cellStyles, appearance, col, row)}>${escapeHTML(String(displayData[row]?.[col] ?? ''))}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
  } else {
    html += `<thead><tr><th class="spreadsheet-coordinate"${getCoordinateStyleAttribute(appearance)}></th>`;
    for (let col = 0; col < raw.cols; col++) {
      const label = kind === 'well-plate' ? String(col + 1) : colLabel(col);
      html += `<th class="spreadsheet-coordinate"${getCoordinateStyleAttribute(appearance)}>${label}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let row = 0; row < raw.rows; row++) {
      const rowLabel = kind === 'well-plate' ? colLabel(row) : String(row + 1);
      html += `<tr><th class="spreadsheet-coordinate"${getCoordinateStyleAttribute(appearance)}>${rowLabel}</th>`;
      for (let col = 0; col < raw.cols; col++) {
        html += `<td${getCellStyleAttribute(raw.cellStyles, appearance, col, row)}>${escapeHTML(String(displayData[row]?.[col] ?? ''))}</td>`;
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
  const spreadsheetStyle = tableElement.dataset.spreadsheetStyle;
  const kind: SpreadsheetKind = spreadsheetStyle === 'notebook' || spreadsheetStyle === 'well-plate'
    ? spreadsheetStyle
    : 'standard';
  if (encoded) {
    const decoded = decodeSpreadsheetData(encoded);
    const appearance = decoded.appearance
      ? normalizeAppearance(decoded.appearance)
      : undefined;
    const extractedCellStyles = extractCellStyles(
      tableElement,
      decoded.kind ?? kind,
      decoded.rows,
      decoded.cols,
    );
    const extractedTableStyle = sanitizeStyle(
      tableElement.getAttribute('style') ?? undefined,
      PRESERVED_TABLE_STYLE_PROPERTIES,
    );
    return normalizeSpreadsheetData({
      ...decoded,
      appearance,
      cellStyles: appearance
        ? stripAppearanceCellStyles(
          extractedCellStyles,
          appearance,
          decoded.rows,
          decoded.cols,
        )
        : extractedCellStyles,
      tableStyle: appearance
        ? stripAppearanceTableStyle(extractedTableStyle, appearance)
        : extractedTableStyle,
      captionStyle: sanitizeStyle(
        tableElement.querySelector('caption')?.getAttribute('style') ?? undefined,
        PRESERVED_STYLE_PROPERTIES,
      ),
      tableBorder: parseTableBorder(tableElement),
    });
  }

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
  return normalizeSpreadsheetData({
    data: resizeData(data, rows, cols),
    rows,
    cols,
    kind,
    caption: tableElement.querySelector('caption')?.textContent?.trim() ?? '',
    plateSize: kind === 'well-plate'
      ? parseInt(tableElement.dataset.wellPlate ?? '', 10) || undefined
      : undefined,
    cellStyles: extractCellStyles(tableElement, kind, rows, cols),
    tableStyle: sanitizeStyle(
      tableElement.getAttribute('style') ?? undefined,
      PRESERVED_TABLE_STYLE_PROPERTIES,
    ),
    captionStyle: sanitizeStyle(
      tableElement.querySelector('caption')?.getAttribute('style') ?? undefined,
      PRESERVED_STYLE_PROPERTIES,
    ),
    tableBorder: parseTableBorder(tableElement),
  });
}

function parseTableBorder(tableElement: HTMLTableElement): number | undefined {
  const border = parseInt(tableElement.getAttribute('border') ?? '', 10);
  return Number.isInteger(border) ? Math.max(0, Math.min(MAX_TABLE_BORDER, border)) : undefined;
}

function getCellStyleAttribute(
  styles: CellStyles | undefined,
  appearance: SpreadsheetAppearance,
  col: number,
  row: number,
): string {
  const explicitStyle = styles?.[`${colLabel(col)}${row + 1}`];
  const style = explicitStyle
    ? `${getAppearanceCellStyle(appearance, col, row)};${explicitStyle}`
    : getAppearanceCellStyle(appearance, col, row);
  return ` style="${escapeHTMLAttribute(style)}"`;
}

function getCoordinateStyleAttribute(appearance: SpreadsheetAppearance): string {
  const style = getAppearanceCellStyle(appearance, 0, 0, false);
  return ` style="${escapeHTMLAttribute(style)}"`;
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

function escapeHTMLAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
