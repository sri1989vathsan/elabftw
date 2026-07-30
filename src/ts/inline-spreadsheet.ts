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

export interface SpreadsheetCellDefaults {
  backgroundColor: string | null;
  borderColor: string;
  borderStyle: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  borderWidth: number;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textColor: string | null;
  textAlign: '' | 'left' | 'center' | 'right' | 'justify';
  verticalAlign: '' | 'top' | 'middle' | 'bottom';
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
  /** Optional account/notebook defaults taken from the cell-style toolbar. */
  cellStyle?: SpreadsheetCellDefaults;
}

// jspreadsheet-ce v5 types do not cover the runtime shape returned during setup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JssInstance = any;
type JssFactory = (element: HTMLDivElement, options: object) => JssInstance;

export interface SpreadsheetData {
  /** Array-of-arrays with raw values/formulas as entered by the user. */
  data: AOA;
  /**
   * Values last rendered into the main editor. This lets us distinguish a
   * computed formula result from a cell that was edited directly in TinyMCE.
   */
  displayData?: AOA;
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

function normalizeCellDefaults(
  candidate?: Partial<SpreadsheetCellDefaults>,
): SpreadsheetCellDefaults | undefined {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const borderStyles = new Set<SpreadsheetCellDefaults['borderStyle']>([
    'solid',
    'dashed',
    'dotted',
    'double',
    'none',
  ]);
  const fontFamilies = new Set([
    '',
    'Arial, sans-serif',
    'Verdana, sans-serif',
    'Georgia, serif',
    "'Times New Roman', serif",
    "'Courier New', monospace",
  ]);
  const textAlignments = new Set<SpreadsheetCellDefaults['textAlign']>([
    '',
    'left',
    'center',
    'right',
    'justify',
  ]);
  const verticalAlignments = new Set<SpreadsheetCellDefaults['verticalAlign']>([
    '',
    'top',
    'middle',
    'bottom',
  ]);
  return {
    backgroundColor: candidate.backgroundColor === null
      ? null
      : normalizeColor(candidate.backgroundColor, DEFAULT_APPEARANCE.cellColor),
    borderColor: normalizeColor(candidate.borderColor, DEFAULT_APPEARANCE.borderColor),
    borderStyle: candidate.borderStyle && borderStyles.has(candidate.borderStyle)
      ? candidate.borderStyle
      : 'solid',
    borderWidth: normalizeInteger(
      candidate.borderWidth,
      DEFAULT_APPEARANCE.borderWidth,
      0,
      MAX_TABLE_BORDER,
    ),
    fontFamily: typeof candidate.fontFamily === 'string'
      && fontFamilies.has(candidate.fontFamily)
      ? candidate.fontFamily
      : '',
    fontSize: normalizeInteger(candidate.fontSize, 12, 6, 72),
    bold: candidate.bold === true,
    italic: candidate.italic === true,
    underline: candidate.underline === true,
    textColor: candidate.textColor === null
      ? null
      : normalizeColor(candidate.textColor, '#212529'),
    textAlign: candidate.textAlign && textAlignments.has(candidate.textAlign)
      ? candidate.textAlign
      : '',
    verticalAlign: candidate.verticalAlign
      && verticalAlignments.has(candidate.verticalAlign)
      ? candidate.verticalAlign
      : '',
  };
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
    cellStyle: normalizeCellDefaults(candidate?.cellStyle),
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
    displayData: Array.isArray(candidate.displayData)
      ? resizeData(candidate.displayData, rows, cols)
      : undefined,
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

function parseTabDelimitedClipboard(text: string): AOA {
  const rows: AOA = [];
  let row: CellValue[] = [];
  let value = '';
  let quoted = false;

  const pushValue = (): void => {
    row.push(value);
    value = '';
  };
  const pushRow = (): void => {
    pushValue();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === '\t' && !quoted) {
      pushValue();
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      pushRow();
    } else {
      value += character;
    }
  }
  pushRow();

  while (rows.length > 1 && rows.at(-1)?.every(cell => cell === '')) rows.pop();
  return rows;
}

function parseClipboardHtmlTable(html: string): AOA {
  if (!html.trim()) return [];
  const clipboardDocument = new DOMParser().parseFromString(html, 'text/html');
  const table = clipboardDocument.querySelector('table');
  if (!table) return [];

  const rows: AOA = [];
  Array.from(table.rows).forEach((tableRow, rowIndex) => {
    rows[rowIndex] ??= [];
    let colIndex = 0;
    Array.from(tableRow.cells).forEach(cell => {
      while (rows[rowIndex][colIndex] !== undefined) colIndex++;
      const colSpan = Math.max(1, cell.colSpan || 1);
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const cellValue = (cell.textContent ?? '').replace(/\u00a0/g, ' ').trim();
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset++) {
        const targetRow = rowIndex + rowOffset;
        rows[targetRow] ??= [];
        for (let colOffset = 0; colOffset < colSpan; colOffset++) {
          rows[targetRow][colIndex + colOffset] = rowOffset === 0 && colOffset === 0
            ? cellValue
            : '';
        }
      }
      colIndex += colSpan;
    });
  });
  return rows;
}

/**
 * Convert an Excel-compatible clipboard payload to a formula-enabled data
 * table. Excel supplies tab-delimited text alongside its HTML table; the HTML
 * fallback also covers a copied single-column range and merged cells.
 */
export function spreadsheetFromClipboard(html: string, plainText: string): SpreadsheetData | null {
  const containsTable = /<table[\s>]/i.test(html);
  const hasSpreadsheetHtmlMarker = /(?:mso-|Microsoft Excel|urn:schemas-microsoft-com:office:excel|class=["'][^"']*\bxl\d|class=["'][^"']*\bwaffle\b)/i.test(html);
  const looksLikeSpreadsheet = plainText.includes('\t')
    || (containsTable && hasSpreadsheetHtmlMarker);
  if (!looksLikeSpreadsheet) return null;

  const parsed = containsTable
    ? parseClipboardHtmlTable(html)
    : parseTabDelimitedClipboard(plainText);
  if (parsed.length === 0) return null;
  const rows = Math.min(MAX_DIMENSION, parsed.length);
  const cols = Math.min(
    MAX_DIMENSION,
    parsed.reduce((maximum, row) => Math.max(maximum, row.length), 0),
  );
  if (cols === 0) return null;

  return {
    data: resizeData(parsed, rows, cols),
    rows,
    cols,
    kind: 'standard',
    caption: '',
    appearance: getEffectiveAppearanceDefaults(),
  };
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

function hasAlternateBackground(
  appearance: SpreadsheetAppearance,
  col: number,
  row: number,
): boolean {
  return (appearance.alternateRows && row % 2 === 1)
    || (appearance.alternateColumns && col % 2 === 1);
}

function getAppearanceCellStyle(
  appearance: SpreadsheetAppearance,
  col: number,
  row: number,
  includeBackground = true,
): string {
  const cellStyle = appearance.cellStyle;
  const declarations = [
    cellStyle
      ? (cellStyle.borderStyle === 'none' || cellStyle.borderWidth === 0
        ? 'border:none'
        : `border:${cellStyle.borderWidth}px ${cellStyle.borderStyle} ${cellStyle.borderColor}`)
      : `border:${appearance.borderWidth}px solid ${appearance.borderColor}`,
    `padding:${appearance.cellPadding}px`,
  ];
  if (includeBackground && hasAlternateBackground(appearance, col, row)) {
    declarations.push(`background-color:${getAppearanceBackground(appearance, col, row)}`);
  } else if (includeBackground && cellStyle?.backgroundColor) {
    declarations.push(`background-color:${cellStyle.backgroundColor}`);
  } else if (includeBackground && !cellStyle) {
    declarations.push(`background-color:${getAppearanceBackground(appearance, col, row)}`);
  }
  if (cellStyle) {
    if (cellStyle.fontFamily) declarations.push(`font-family:${cellStyle.fontFamily}`);
    declarations.push(
      `font-size:${cellStyle.fontSize}pt`,
      `font-weight:${cellStyle.bold ? 'bold' : 'normal'}`,
      `font-style:${cellStyle.italic ? 'italic' : 'normal'}`,
      `text-decoration:${cellStyle.underline ? 'underline' : 'none'}`,
    );
    if (cellStyle.textColor) declarations.push(`color:${cellStyle.textColor}`);
    if (cellStyle.textAlign) declarations.push(`text-align:${cellStyle.textAlign}`);
    if (cellStyle.verticalAlign) declarations.push(`vertical-align:${cellStyle.verticalAlign}`);
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
    const legacyBackground = document.createElement('span');
    if (hasAlternateBackground(appearance, coordinates.col, coordinates.row)
      && appearance.cellStyle?.backgroundColor
    ) {
      // Older spreadsheet renders applied the default cell fill to striped
      // rows. Treat that exact fill as generated rather than as an explicit
      // per-cell override when reopening those tables.
      legacyBackground.style.backgroundColor = appearance.cellStyle.backgroundColor;
    }
    for (let index = 0; index < generated.style.length; index++) {
      const property = generated.style.item(index);
      const actualValue = actual.style.getPropertyValue(property);
      const isLegacyStripedFill = property === 'background-color'
        && actualValue === legacyBackground.style.getPropertyValue(property);
      if (actualValue === generated.style.getPropertyValue(property) || isLegacyStripedFill) {
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

function evaluateArithmeticExpression(
  expression: string,
  resolveCell: (cellName: string) => number | undefined,
): number | undefined {
  const tokens: string[] = [];
  const trimmed = expression.trim();
  const tokenPattern = /\s*([()+*/-]|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|\$?[a-z]+\$?[1-9]\d*)/iy;
  let position = 0;
  while (position < trimmed.length) {
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(trimmed);
    if (!match) return undefined;
    tokens.push(match[1]);
    position = tokenPattern.lastIndex;
  }
  if (tokens.length === 0) return undefined;

  let index = 0;
  const parsePrimary = (): number | undefined => {
    const token = tokens[index];
    if (!token) return undefined;
    if (token === '(') {
      index++;
      const value = parseExpression();
      if (value === undefined || tokens[index] !== ')') return undefined;
      index++;
      return value;
    }
    if (/^\$?[a-z]+\$?[1-9]\d*$/i.test(token)) {
      index++;
      return resolveCell(token.replaceAll('$', ''));
    }
    const value = Number(token);
    if (!Number.isFinite(value)) return undefined;
    index++;
    return value;
  };
  const parseUnary = (): number | undefined => {
    const operator = tokens[index];
    if (operator !== '+' && operator !== '-') return parsePrimary();
    index++;
    const value = parseUnary();
    if (value === undefined) return undefined;
    return operator === '-' ? -value : value;
  };
  const parseTerm = (): number | undefined => {
    let value = parseUnary();
    if (value === undefined) return undefined;
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++];
      const right = parseUnary();
      if (right === undefined || (operator === '/' && right === 0)) return undefined;
      value = operator === '*' ? value * right : value / right;
    }
    return Number.isFinite(value) ? value : undefined;
  };
  const parseExpression = (): number | undefined => {
    let value = parseTerm();
    if (value === undefined) return undefined;
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++];
      const right = parseTerm();
      if (right === undefined) return undefined;
      value = operator === '+' ? value + right : value - right;
    }
    return Number.isFinite(value) ? value : undefined;
  };

  const result = parseExpression();
  return index === tokens.length ? result : undefined;
}

/**
 * Evaluate aggregate functions and ordinary arithmetic without using eval().
 * jspreadsheet formula parsing stays disabled because it can abort hydration
 * for a saved grid. This deterministic evaluator keeps both raw formulas and
 * their visible results stable through edit/save/reopen cycles.
 */
function evaluateFormula(
  formulaValue: string,
  data: AOA,
  formulaCol: number,
  formulaRow: number,
  resolving = new Set<string>(),
): number | undefined {
  if (!formulaValue.trimStart().startsWith('=')) return undefined;
  const formulaKey = `${formulaCol}:${formulaRow}`;
  if (resolving.has(formulaKey)) return undefined;
  resolving.add(formulaKey);
  const match = /^=\s*(SUM|AVERAGE|COUNT|MIN|MAX)\s*\((.*)\)\s*$/i.exec(formulaValue);

  if (!match) {
    const result = evaluateArithmeticExpression(
      formulaValue.trim().slice(1),
      cellName => {
        const coordinates = coordinatesFromCellName(cellName);
        if (!coordinates
          || coordinates.row >= data.length
          || coordinates.col >= (data[coordinates.row]?.length ?? 0)
        ) {
          return undefined;
        }
        const value = data[coordinates.row]?.[coordinates.col];
        if (typeof value === 'string' && value.trimStart().startsWith('=')) {
          return evaluateFormula(
            value,
            data,
            coordinates.col,
            coordinates.row,
            resolving,
          );
        }
        if (value === null || value === '' || value === false) return 0;
        if (value === true) return 1;
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? numericValue : undefined;
      },
    );
    resolving.delete(formulaKey);
    return result;
  }

  const numericValues: number[] = [];
  let invalidReference = false;
  const collectCell = (col: number, row: number): void => {
    if (col < 0 || row < 0 || row >= data.length || col >= (data[row]?.length ?? 0)) return;
    const value = data[row]?.[col];
    let resolvedValue: CellValue | undefined = value;
    if (typeof value === 'string' && value.trimStart().startsWith('=')) {
      resolvedValue = evaluateFormula(value, data, col, row, resolving);
      if (resolvedValue === undefined) {
        invalidReference = true;
        return;
      }
    }
    if (typeof resolvedValue === 'number' && Number.isFinite(resolvedValue)) {
      numericValues.push(resolvedValue);
      return;
    }
    if (typeof resolvedValue === 'string' && resolvedValue.trim() !== '') {
      const numericValue = Number(resolvedValue);
      if (Number.isFinite(numericValue)) numericValues.push(numericValue);
    }
  };

  const argumentsList = match[2].trim() === '' ? [] : match[2].split(/[;,]/);
  for (const argument of argumentsList) {
    const token = argument.trim().replaceAll('$', '');
    const [startToken, endToken] = token.split(':');
    const start = coordinatesFromCellName(startToken);
    const end = endToken ? coordinatesFromCellName(endToken) : null;
    if (start && end) {
      const startCol = Math.min(start.col, end.col);
      const endCol = Math.max(start.col, end.col);
      const startRow = Math.min(start.row, end.row);
      const endRow = Math.max(start.row, end.row);
      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) collectCell(col, row);
      }
    } else if (start) {
      collectCell(start.col, start.row);
    } else if (token !== '') {
      const numericValue = Number(token);
      if (Number.isFinite(numericValue)) numericValues.push(numericValue);
    }
  }
  resolving.delete(formulaKey);
  if (invalidReference) return undefined;

  const functionName = match[1].toUpperCase();
  if (functionName === 'COUNT') return numericValues.length;
  if (functionName === 'SUM') {
    return numericValues.reduce((sum, value) => sum + value, 0);
  }
  if (numericValues.length === 0) return 0;
  if (functionName === 'AVERAGE') {
    return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  }
  if (functionName === 'MIN') return Math.min(...numericValues);
  if (functionName === 'MAX') return Math.max(...numericValues);
  return undefined;
}

function renderFormulaResults(container: HTMLElement, data: AOA): void {
  data.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (typeof value !== 'string' || !value.trimStart().startsWith('=')) return;
      const result = evaluateFormula(value, data, colIndex, rowIndex);
      if (result === undefined) return;
      const cell = container.querySelector<HTMLElement>(
        `td[data-x="${colIndex}"][data-y="${rowIndex}"]`,
      );
      // jspreadsheet v5 can leave the `editor` class on a cell after Enter,
      // even though its input has already closed. The formula repaint only
      // runs after data/edition events, so updating the cell here does not
      // interfere with the active input and guarantees a visible result.
      if (cell) cell.textContent = String(result);
    });
  });
}

function applyFormulaResults(rawData: AOA, computedData: AOA): AOA {
  const rows = Math.max(rawData.length, computedData.length);
  const cols = Math.max(
    rawData.reduce((max, row) => Math.max(max, row.length), 0),
    computedData.reduce((max, row) => Math.max(max, row.length), 0),
  );
  const displayData = resizeData(computedData, rows, cols);
  rawData.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (typeof value !== 'string' || !value.trimStart().startsWith('=')) return;
      const result = evaluateFormula(value, rawData, colIndex, rowIndex);
      if (result !== undefined) displayData[rowIndex][colIndex] = result;
    });
  });
  return displayData;
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
  if (Array.isArray(instance)) return instance[0] ?? null;
  return instance ?? null;
}

function getMountedWorksheet(
  container: HTMLDivElement,
  instance?: JssInstance,
): JssInstance {
  const mountedContainer = container as HTMLDivElement & {
    jspreadsheet?: JssInstance;
    jssWorksheet?: JssInstance;
    spreadsheet?: { worksheets?: JssInstance[] };
  };
  return getWorksheet(instance)
    ?? getWorksheet(mountedContainer.spreadsheet?.worksheets)
    ?? mountedContainer.jspreadsheet
    ?? mountedContainer.jssWorksheet
    ?? null;
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
  defaultCellNoColorInput: HTMLInputElement;
  defaultCellBorderStyleSelect: HTMLSelectElement;
  defaultFontFamilySelect: HTMLSelectElement;
  defaultFontSizeInput: HTMLInputElement;
  defaultFontBoldInput: HTMLInputElement;
  defaultFontItalicInput: HTMLInputElement;
  defaultFontUnderlineInput: HTMLInputElement;
  defaultFontTextColorInput: HTMLInputElement;
  defaultFontNoTextColorInput: HTMLInputElement;
  defaultFontTextAlignSelect: HTMLSelectElement;
  defaultFontVerticalAlignSelect: HTMLSelectElement;
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

  const savedCellDefaults = appearance.cellStyle;
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
  const defaultCellNoColorInput = document.createElement('input');
  defaultCellNoColorInput.type = 'checkbox';
  defaultCellNoColorInput.checked = savedCellDefaults?.backgroundColor === null;
  defaultCellNoColorInput.setAttribute('aria-label', 'No default cell background color');
  cellColorInput.disabled = defaultCellNoColorInput.checked;
  const defaultCellBorderStyleSelect = document.createElement('select');
  defaultCellBorderStyleSelect.className = 'form-control form-control-sm';
  defaultCellBorderStyleSelect.setAttribute('aria-label', 'Default cell border style');
  defaultCellBorderStyleSelect.innerHTML = `
    <option value="solid">Solid</option>
    <option value="dashed">Dashed</option>
    <option value="dotted">Dotted</option>
    <option value="double">Double</option>
    <option value="none">No border</option>
  `;
  defaultCellBorderStyleSelect.value = savedCellDefaults?.borderStyle ?? 'solid';
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
    createLabeledControl('Border style', defaultCellBorderStyleSelect),
    createLabeledControl('Cell color', cellColorInput),
    createLabeledControl('No cell color', defaultCellNoColorInput),
    createLabeledControl('Alternate rows', alternateRowsInput),
    createLabeledControl('Row color', alternateRowColorInput),
    createLabeledControl('Alternate columns', alternateColumnsInput),
    createLabeledControl('Column color', alternateColumnColorInput),
  );
  appearancePanel.append(cellAppearanceLabel, appearanceGrid);

  const fontAppearanceLabel = document.createElement('strong');
  fontAppearanceLabel.textContent = 'Font defaults';
  const fontAppearanceGrid = document.createElement('div');
  fontAppearanceGrid.className = 'inline-spreadsheet-appearance-grid';
  const defaultFontFamilySelect = document.createElement('select');
  defaultFontFamilySelect.className = 'form-control form-control-sm';
  defaultFontFamilySelect.setAttribute('aria-label', 'Default cell font family');
  defaultFontFamilySelect.innerHTML = `
    <option value="">Default font</option>
    <option value="Arial, sans-serif">Arial</option>
    <option value="Verdana, sans-serif">Verdana</option>
    <option value="Georgia, serif">Georgia</option>
    <option value="'Times New Roman', serif">Times New Roman</option>
    <option value="'Courier New', monospace">Courier New</option>
  `;
  defaultFontFamilySelect.value = savedCellDefaults?.fontFamily ?? '';
  const defaultFontSizeInput = createInput(
    'number',
    String(savedCellDefaults?.fontSize ?? 12),
    'Default cell font size in points',
  );
  defaultFontSizeInput.min = '6';
  defaultFontSizeInput.max = '72';
  const defaultFontBoldInput = document.createElement('input');
  defaultFontBoldInput.type = 'checkbox';
  defaultFontBoldInput.checked = savedCellDefaults?.bold ?? false;
  defaultFontBoldInput.setAttribute('aria-label', 'Bold cells by default');
  const defaultFontItalicInput = document.createElement('input');
  defaultFontItalicInput.type = 'checkbox';
  defaultFontItalicInput.checked = savedCellDefaults?.italic ?? false;
  defaultFontItalicInput.setAttribute('aria-label', 'Italicize cells by default');
  const defaultFontUnderlineInput = document.createElement('input');
  defaultFontUnderlineInput.type = 'checkbox';
  defaultFontUnderlineInput.checked = savedCellDefaults?.underline ?? false;
  defaultFontUnderlineInput.setAttribute('aria-label', 'Underline cells by default');
  const defaultFontTextColorInput = createInput(
    'color',
    savedCellDefaults?.textColor ?? '#212529',
    'Default cell text color',
  );
  const defaultFontNoTextColorInput = document.createElement('input');
  defaultFontNoTextColorInput.type = 'checkbox';
  defaultFontNoTextColorInput.checked = savedCellDefaults?.textColor === null;
  defaultFontNoTextColorInput.setAttribute('aria-label', 'No default cell text color');
  defaultFontTextColorInput.disabled = defaultFontNoTextColorInput.checked;
  const defaultFontTextAlignSelect = document.createElement('select');
  defaultFontTextAlignSelect.className = 'form-control form-control-sm';
  defaultFontTextAlignSelect.setAttribute('aria-label', 'Default cell horizontal alignment');
  defaultFontTextAlignSelect.innerHTML = `
    <option value="">Default</option>
    <option value="left">Left</option>
    <option value="center">Center</option>
    <option value="right">Right</option>
    <option value="justify">Justify</option>
  `;
  defaultFontTextAlignSelect.value = savedCellDefaults?.textAlign ?? '';
  const defaultFontVerticalAlignSelect = document.createElement('select');
  defaultFontVerticalAlignSelect.className = 'form-control form-control-sm';
  defaultFontVerticalAlignSelect.setAttribute('aria-label', 'Default cell vertical alignment');
  defaultFontVerticalAlignSelect.innerHTML = `
    <option value="">Default</option>
    <option value="top">Top</option>
    <option value="middle">Middle</option>
    <option value="bottom">Bottom</option>
  `;
  defaultFontVerticalAlignSelect.value = savedCellDefaults?.verticalAlign ?? '';
  fontAppearanceGrid.append(
    createLabeledControl('Family', defaultFontFamilySelect),
    createLabeledControl('Size (pt)', defaultFontSizeInput),
    createLabeledControl('Bold', defaultFontBoldInput),
    createLabeledControl('Italic', defaultFontItalicInput),
    createLabeledControl('Underline', defaultFontUnderlineInput),
    createLabeledControl('Text color', defaultFontTextColorInput),
    createLabeledControl('No text color', defaultFontNoTextColorInput),
    createLabeledControl('Horizontal', defaultFontTextAlignSelect),
    createLabeledControl('Vertical', defaultFontVerticalAlignSelect),
  );
  appearancePanel.append(fontAppearanceLabel, fontAppearanceGrid);

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
  saveAppearanceDefaultBtn.textContent = 'Save everything as default';
  const appearanceStatus = document.createElement('span');
  appearanceStatus.className = 'inline-spreadsheet-appearance-status';
  appearanceStatus.textContent = 'Saves table, cell and font settings; notebook defaults override account defaults.';
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
    savedCellDefaults?.backgroundColor ?? appearance.cellColor,
    'Selected cell background color',
  );
  const cellFormatNoColorInput = document.createElement('input');
  cellFormatNoColorInput.type = 'checkbox';
  cellFormatNoColorInput.setAttribute('aria-label', 'Remove selected cell background color');
  cellFormatNoColorInput.checked = savedCellDefaults?.backgroundColor === null;
  cellFormatColorInput.disabled = cellFormatNoColorInput.checked;
  const cellFormatBorderColorInput = createInput(
    'color',
    savedCellDefaults?.borderColor ?? appearance.borderColor,
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
  cellFormatBorderStyleSelect.value = savedCellDefaults?.borderStyle ?? 'solid';
  const cellFormatBorderWidthInput = createInput(
    'number',
    String(savedCellDefaults?.borderWidth ?? appearance.borderWidth),
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
  cellFormatFontFamilySelect.value = savedCellDefaults?.fontFamily ?? '';
  const cellFormatFontSizeInput = createInput(
    'number',
    String(savedCellDefaults?.fontSize ?? 12),
    'Selected cell font size in points',
  );
  cellFormatFontSizeInput.min = '6';
  cellFormatFontSizeInput.max = '72';
  const cellFormatBoldInput = document.createElement('input');
  cellFormatBoldInput.type = 'checkbox';
  cellFormatBoldInput.setAttribute('aria-label', 'Bold selected cells');
  cellFormatBoldInput.checked = savedCellDefaults?.bold ?? false;
  const cellFormatItalicInput = document.createElement('input');
  cellFormatItalicInput.type = 'checkbox';
  cellFormatItalicInput.setAttribute('aria-label', 'Italicize selected cells');
  cellFormatItalicInput.checked = savedCellDefaults?.italic ?? false;
  const cellFormatUnderlineInput = document.createElement('input');
  cellFormatUnderlineInput.type = 'checkbox';
  cellFormatUnderlineInput.setAttribute('aria-label', 'Underline selected cells');
  cellFormatUnderlineInput.checked = savedCellDefaults?.underline ?? false;
  const cellFormatTextColorInput = createInput(
    'color',
    savedCellDefaults?.textColor ?? '#212529',
    'Selected cell text color',
  );
  const cellFormatNoTextColorInput = document.createElement('input');
  cellFormatNoTextColorInput.type = 'checkbox';
  cellFormatNoTextColorInput.setAttribute('aria-label', 'Remove selected cell text color');
  cellFormatNoTextColorInput.checked = savedCellDefaults?.textColor === null;
  cellFormatTextColorInput.disabled = cellFormatNoTextColorInput.checked;
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
  cellFormatTextAlignSelect.value = savedCellDefaults?.textAlign ?? '';
  const cellFormatVerticalAlignSelect = document.createElement('select');
  cellFormatVerticalAlignSelect.className = 'form-control form-control-sm';
  cellFormatVerticalAlignSelect.setAttribute('aria-label', 'Selected cell vertical alignment');
  cellFormatVerticalAlignSelect.innerHTML = `
    <option value="">Default</option>
    <option value="top">Top</option>
    <option value="middle">Middle</option>
    <option value="bottom">Bottom</option>
  `;
  cellFormatVerticalAlignSelect.value = savedCellDefaults?.verticalAlign ?? '';
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
  const formulaActions = [
    { value: 'SUM', label: 'SUM', title: 'Sum the selected cells' },
    { value: 'AVERAGE', label: 'AVERAGE', title: 'Average the selected cells' },
    { value: 'COUNT', label: 'COUNT', title: 'Count the selected numeric cells' },
    { value: 'MIN', label: 'MIN', title: 'Find the minimum selected value' },
    { value: 'MAX', label: 'MAX', title: 'Find the maximum selected value' },
    { value: '+', label: '+', title: 'Add the selected cells in reading order' },
    { value: '-', label: '−', title: 'Subtract each selected cell from the first' },
    { value: '*', label: '×', title: 'Multiply the selected cells' },
    { value: '/', label: '÷', title: 'Divide the first selected cell by each remaining cell' },
  ];
  formulaActions.forEach(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-secondary';
    button.dataset.formula = action.value;
    button.textContent = action.label;
    button.title = action.title;
    button.setAttribute('aria-label', action.title);
    formulaBar.appendChild(button);
  });
  const formulaStatus = document.createElement('span');
  formulaStatus.className = 'inline-spreadsheet-formula-status';
  formulaStatus.textContent = 'Select cells, then choose a function or arithmetic operation. You can also type formulas such as =A1*B1.';
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
    defaultCellNoColorInput,
    defaultCellBorderStyleSelect,
    defaultFontFamilySelect,
    defaultFontSizeInput,
    defaultFontBoldInput,
    defaultFontItalicInput,
    defaultFontUnderlineInput,
    defaultFontTextColorInput,
    defaultFontNoTextColorInput,
    defaultFontTextAlignSelect,
    defaultFontVerticalAlignSelect,
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
  cellStyle?: SpreadsheetCellDefaults,
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
    cellStyle,
  });
}

function defaultCellStyleFromControls(
  ui: ReturnType<typeof createOverlay>,
): SpreadsheetCellDefaults {
  return normalizeCellDefaults({
    backgroundColor: ui.defaultCellNoColorInput.checked
      ? null
      : ui.cellColorInput.value,
    borderColor: ui.borderColorInput.value,
    borderStyle: ui.defaultCellBorderStyleSelect.value as SpreadsheetCellDefaults['borderStyle'],
    borderWidth: parseInt(ui.borderWidthInput.value, 10),
    fontFamily: ui.defaultFontFamilySelect.value,
    fontSize: parseInt(ui.defaultFontSizeInput.value, 10),
    bold: ui.defaultFontBoldInput.checked,
    italic: ui.defaultFontItalicInput.checked,
    underline: ui.defaultFontUnderlineInput.checked,
    textColor: ui.defaultFontNoTextColorInput.checked
      ? null
      : ui.defaultFontTextColorInput.value,
    textAlign: ui.defaultFontTextAlignSelect.value as SpreadsheetCellDefaults['textAlign'],
    verticalAlign: ui.defaultFontVerticalAlignSelect.value as SpreadsheetCellDefaults['verticalAlign'],
  })!;
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
    // jspreadsheet's formula engine can replace a raw formula with its
    // calculated value (or #ERROR) in getData(). Keep a separate source of
    // truth so rendering never destroys what the user entered.
    let rawDataMirror = resizeData(working.data, working.rows, working.cols);
    let selectedRange: CellRange | null = null;
    let formulaSelectionDrag: {
      input: HTMLInputElement | HTMLTextAreaElement;
      startRange: CellRange;
      insertionStart: number;
      insertionEnd: number;
      formulaCol: number;
      formulaRow: number;
      allowRange: boolean;
    } | null = null;
    const changedFontProperties = new Set<keyof CellFontFormat>();

    document.body.appendChild(ui.overlay);

    const readRawData = (): AOA => {
      const worksheetData = worksheet?.getData?.();
      if (!Array.isArray(worksheetData)) {
        return resizeData(rawDataMirror, working.rows, working.cols);
      }
      const rows = Math.max(working.rows, worksheetData.length, rawDataMirror.length);
      const cols = Math.max(
        working.cols,
        worksheetData.reduce((max, row) => Math.max(max, row?.length ?? 0), 0),
        rawDataMirror.reduce((max, row) => Math.max(max, row.length), 0),
      );
      const currentData = resizeData(worksheetData, rows, cols);
      const mirroredData = resizeData(rawDataMirror, rows, cols);
      const mergedData = currentData.map((row, rowIndex) => row.map((value, colIndex) => {
        const mirroredValue = mirroredData[rowIndex][colIndex];
        return typeof mirroredValue === 'string' && mirroredValue.trimStart().startsWith('=')
          ? mirroredValue
          : value;
      }));
      rawDataMirror = mergedData;
      return resizeData(mergedData, rows, cols);
    };

    const updateRawDataMirrorCell = (
      col: number,
      row: number,
      value: CellValue,
      preserveRenderedFormula = true,
    ): void => {
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) return;
      const rows = Math.max(working.rows, rawDataMirror.length, row + 1);
      const cols = Math.max(
        working.cols,
        rawDataMirror.reduce((max, currentRow) => Math.max(max, currentRow.length), 0),
        col + 1,
      );
      rawDataMirror = resizeData(rawDataMirror, rows, cols);
      const currentValue = rawDataMirror[row][col];
      if (preserveRenderedFormula
        && typeof currentValue === 'string'
        && currentValue.trimStart().startsWith('=')
        && !(typeof value === 'string' && value.trimStart().startsWith('='))
      ) {
        const result = evaluateFormula(currentValue, rawDataMirror, col, row);
        if (value === '#ERROR' || (result !== undefined && String(value) === String(result))) return;
      }
      rawDataMirror[row][col] = value;
    };

    const scheduleFormulaResultRender = (): void => {
      const render = (): void => {
        if (sheetContainer) renderFormulaResults(sheetContainer, readRawData());
      };
      // jspreadsheet paints the non-editing cell after closeEditor/onchange.
      // Repaint after each of its immediate and delayed formula updates.
      window.requestAnimationFrame(() => {
        render();
        window.setTimeout(render, 0);
        window.setTimeout(render, 120);
        window.setTimeout(render, 400);
      });
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

    const formulaParenthesisBalance = (value: string): number => {
      let balance = 0;
      for (const character of value) {
        if (character === '(') balance++;
        if (character === ')') balance = Math.max(0, balance - 1);
      }
      return balance;
    };

    const getGridRangeFromTarget = (target: EventTarget | null): CellRange | null => {
      if (!(target instanceof Element) || !sheetContainer?.contains(target)) return null;
      const coordinateElement = target.closest<HTMLElement>('td[data-x], td[data-y]');
      if (!coordinateElement || !sheetContainer.contains(coordinateElement)) return null;
      const col = Number.parseInt(coordinateElement.dataset.x ?? '', 10);
      const row = Number.parseInt(coordinateElement.dataset.y ?? '', 10);
      const hasCol = Number.isInteger(col) && col >= 0 && col < working.cols;
      const hasRow = Number.isInteger(row) && row >= 0 && row < working.rows;
      if (hasCol && hasRow) return [col, row, col, row];
      if (hasCol) return [col, 0, col, working.rows - 1];
      if (hasRow) return [0, row, working.cols - 1, row];
      return null;
    };

    const rangeLabel = (range: CellRange): string => {
      const startCol = Math.min(range[0], range[2]);
      const startRow = Math.min(range[1], range[3]);
      const endCol = Math.max(range[0], range[2]);
      const endRow = Math.max(range[1], range[3]);
      const start = `${colLabel(startCol)}${startRow + 1}`;
      const end = `${colLabel(endCol)}${endRow + 1}`;
      return start === end ? start : `${start}:${end}`;
    };

    const withoutFormulaCell = (
      range: CellRange,
      formulaCol: number,
      formulaRow: number,
    ): CellRange | null => {
      const startCol = Math.min(range[0], range[2]);
      const startRow = Math.min(range[1], range[3]);
      const endCol = Math.max(range[0], range[2]);
      const endRow = Math.max(range[1], range[3]);
      const containsFormulaCell = formulaCol >= startCol
        && formulaCol <= endCol
        && formulaRow >= startRow
        && formulaRow <= endRow;
      if (!containsFormulaCell) return range;

      // Selecting a whole column while writing its result immediately below
      // the source values is a common Excel workflow. Use the cells above the
      // formula instead of producing a circular reference and #ERROR.
      if (startRow === 0 && endRow === working.rows - 1) {
        if (formulaRow > 0) return [startCol, 0, endCol, formulaRow - 1];
        if (formulaRow < working.rows - 1) {
          return [startCol, formulaRow + 1, endCol, working.rows - 1];
        }
      }
      if (startCol === 0 && endCol === working.cols - 1) {
        if (formulaCol > 0) return [0, startRow, formulaCol - 1, endRow];
        if (formulaCol < working.cols - 1) {
          return [formulaCol + 1, startRow, working.cols - 1, endRow];
        }
      }
      return null;
    };

    const updateFormulaSelection = (range: CellRange): void => {
      if (!formulaSelectionDrag) return;
      const safeRange = withoutFormulaCell(
        range,
        formulaSelectionDrag.formulaCol,
        formulaSelectionDrag.formulaRow,
      );
      if (!safeRange) {
        ui.formulaStatus.textContent = 'The source range cannot include the formula result cell.';
        return;
      }
      const label = rangeLabel(safeRange);
      formulaSelectionDrag.input.setRangeText(
        label,
        formulaSelectionDrag.insertionStart,
        formulaSelectionDrag.insertionEnd,
        'end',
      );
      formulaSelectionDrag.insertionEnd = formulaSelectionDrag.insertionStart + label.length;
      worksheet?.updateSelectionFromCoords?.(...safeRange);
      ui.formulaStatus.textContent = `${label} added to the formula. Press Enter to apply it.`;
    };

    const finishFormulaSelection = (): void => {
      if (!formulaSelectionDrag) return;
      const { input, insertionEnd } = formulaSelectionDrag;
      formulaSelectionDrag = null;
      document.removeEventListener('mousemove', onFormulaSelectionMove, true);
      document.removeEventListener('mouseup', onFormulaSelectionEnd, true);
      window.setTimeout(() => {
        input.focus();
        input.setSelectionRange(insertionEnd, insertionEnd);
      }, 0);
    };

    const onFormulaSelectionMove = (event: MouseEvent): void => {
      if (!formulaSelectionDrag) return;
      const endRange = getGridRangeFromTarget(event.target);
      if (!endRange) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      updateFormulaSelection(formulaSelectionDrag.allowRange
        ? [
          formulaSelectionDrag.startRange[0],
          formulaSelectionDrag.startRange[1],
          endRange[2],
          endRange[3],
        ]
        : endRange);
    };

    const onFormulaSelectionEnd = (event: MouseEvent): void => {
      if (!formulaSelectionDrag) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishFormulaSelection();
    };

    const onFormulaSelectionStart = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      const input = sheetContainer?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'td.editor[data-x][data-y] > input, td.editor[data-x][data-y] > textarea',
      );
      if (!input || event.target === input) return;
      const formulaCell = input.closest<HTMLElement>('td.editor[data-x][data-y]');
      const formulaCol = Number.parseInt(formulaCell?.dataset.x ?? '', 10);
      const formulaRow = Number.parseInt(formulaCell?.dataset.y ?? '', 10);
      if (!Number.isInteger(formulaCol) || !Number.isInteger(formulaRow)) return;
      const startRange = getGridRangeFromTarget(event.target);
      if (!startRange) return;
      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? selectionStart;
      const formulaBeforeCaret = input.value.slice(0, selectionStart).trimStart();
      const expectsCellReference = /^=\s*$/.test(formulaBeforeCaret)
        || /[+\-*/(,;]\s*$/.test(formulaBeforeCaret);
      if (!expectsCellReference) return;
      const allowRange = /^=\s*(SUM|AVERAGE|COUNT|MIN|MAX)\s*\([^)]*$/i.test(
        formulaBeforeCaret,
      );

      event.preventDefault();
      event.stopImmediatePropagation();
      formulaSelectionDrag = {
        input,
        startRange,
        insertionStart: selectionStart,
        insertionEnd: selectionEnd,
        formulaCol,
        formulaRow,
        allowRange,
      };
      updateFormulaSelection(startRange);
      document.addEventListener('mousemove', onFormulaSelectionMove, true);
      document.addEventListener('mouseup', onFormulaSelectionEnd, true);
    };

    const onFormulaEditorKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter'
        || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        || !event.target.value.trimStart().startsWith('=')
      ) {
        return;
      }
      const formulaCell = event.target.closest<HTMLElement>('td.editor[data-x][data-y]');
      if (!formulaCell || typeof worksheet?.closeEditor !== 'function') return;
      const missingParentheses = formulaParenthesisBalance(event.target.value);
      if (missingParentheses > 0) {
        event.target.value += ')'.repeat(missingParentheses);
      }
      const formulaCol = Number.parseInt(formulaCell.dataset.x ?? '', 10);
      const formulaRow = Number.parseInt(formulaCell.dataset.y ?? '', 10);
      event.preventDefault();
      event.stopImmediatePropagation();
      const formulaValue = event.target.value;
      updateRawDataMirrorCell(formulaCol, formulaRow, formulaValue, false);
      worksheet.closeEditor(formulaCell, true);
      const rawData = readRawData();
      const result = evaluateFormula(formulaValue, rawData, formulaCol, formulaRow);
      scheduleFormulaResultRender();
      if (Number.isInteger(formulaCol) && Number.isInteger(formulaRow)) {
        selectedRange = [formulaCol, formulaRow, formulaCol, formulaRow];
        worksheet.updateSelectionFromCoords?.(...selectedRange);
        ui.formulaStatus.textContent = result === undefined
          ? `Formula applied in ${colLabel(formulaCol)}${formulaRow + 1}.`
          : `Formula applied in ${colLabel(formulaCol)}${formulaRow + 1}: ${result}.`;
      }
    };

    ui.sheetHost.addEventListener('mousedown', onFormulaSelectionStart, true);
    ui.sheetHost.addEventListener('keydown', onFormulaEditorKeydown, true);

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
      const mountedContainer = sheetContainer;
      const mountedRows = working.rows;
      const mountedCols = working.cols;
      const mountedData = resizeData(working.data, mountedRows, mountedCols);
      rawDataMirror = resizeData(mountedData, mountedRows, mountedCols);
      const mountedStyles = mergeCellStyles(
        working.cellStyles,
        normalizeAppearance(working.appearance),
        mountedRows,
        mountedCols,
      );
      let hydrationComplete = false;
      const savedCells = mountedData
        .flatMap((row, rowIndex) => row.map((value, colIndex) => ({ value, colIndex, rowIndex })))
        .filter(cell => cell.value !== '' && cell.value !== null && cell.value !== undefined);
      const firstSavedCell = savedCells.find(cell => (
        typeof cell.value !== 'string' || !cell.value.trimStart().startsWith('=')
      )) ?? savedCells[0];
      const worksheetContainsSavedData = (candidate: JssInstance): boolean => {
        const bodyRows = mountedContainer.querySelectorAll('.jss_worksheet tbody tr').length;
        if (bodyRows < mountedRows) return false;
        if (!firstSavedCell) return true;
        const candidateData = candidate?.getData?.();
        if (!Array.isArray(candidateData)) return false;
        return String(candidateData[firstSavedCell.rowIndex]?.[firstSavedCell.colIndex] ?? '')
          === String(firstSavedCell.value);
      };
      const bindAndHydrateWorksheet = (candidate?: JssInstance): boolean => {
        if (sheetContainer !== mountedContainer) return true;
        const mountedWorksheet = getMountedWorksheet(mountedContainer, candidate);
        if (!mountedWorksheet) return false;
        worksheet = mountedWorksheet;

        // jspreadsheet v5 creates worksheets asynchronously. A worksheet can
        // therefore exist with its headers/minDimensions but without the data
        // supplied in the original configuration. Reapply the saved raw data
        // until both its rows and a representative value are observable.
        if (!hydrationComplete && !worksheetContainsSavedData(mountedWorksheet)) {
          try {
            mountedWorksheet.setData?.(resizeData(mountedData, mountedRows, mountedCols));
            mountedWorksheet.setStyle?.(mountedStyles);
          } catch {
            return false;
          }
        }
        hydrationComplete = worksheetContainsSavedData(mountedWorksheet);
        scheduleFormulaResultRender();
        if (selectedRange) {
          worksheet?.updateSelectionFromCoords?.(...selectedRange);
          updateSelectionStatus(selectedRange);
        }
        return hydrationComplete;
      };
      const hydrateWorksheetUntilReady = (attempt = 0): void => {
        if (sheetContainer !== mountedContainer) return;
        if (bindAndHydrateWorksheet(instance) || attempt >= 30) return;
        window.setTimeout(
          () => hydrateWorksheetUntilReady(attempt + 1),
          Math.min(250, 15 + (attempt * 10)),
        );
      };
      const instance = (jspreadsheet as unknown as JssFactory)(sheetContainer, {
        worksheets: [{
          data: mountedData,
          minDimensions: [mountedCols, mountedRows],
          style: mountedStyles,
          tableOverflow: true,
          tableWidth: '100%',
          tableHeight: '400px',
          allowInsertRow: true,
          allowInsertColumn: true,
          allowDeleteRow: true,
          allowDeleteColumn: true,
          columnSorting: false,
          selectionCopy: true,
        }],
        // Aggregate formulas are evaluated and painted by this module. Let
        // jspreadsheet retain the raw `=SUM(...)` text without executing its
        // formula engine: in v5 that parser can abort worksheet hydration when
        // a saved grid containing a formula is reopened.
        parseFormulas: false,
        onload: (spreadsheet: JssInstance): void => {
          bindAndHydrateWorksheet(spreadsheet?.worksheets ?? spreadsheet);
        },
        onbeforechange: (
          _changedWorksheet: JssInstance,
          cell: HTMLElement,
          changedCol: number,
          changedRow: number,
          value: CellValue,
        ): CellValue => {
          updateRawDataMirrorCell(
            changedCol,
            changedRow,
            value,
            !cell?.classList?.contains('editor'),
          );
          return value;
        },
        onchange: (
          changedWorksheet: JssInstance,
          _cell: HTMLElement,
          changedCol: number,
          changedRow: number,
          newValue: CellValue,
        ): void => {
          worksheet = changedWorksheet;
          updateRawDataMirrorCell(changedCol, changedRow, newValue);
          scheduleFormulaResultRender();
        },
        oneditionend: (
          changedWorksheet: JssInstance,
          _cell: HTMLElement,
          changedCol: number,
          changedRow: number,
          value: CellValue,
        ): void => {
          worksheet = changedWorksheet;
          updateRawDataMirrorCell(changedCol, changedRow, value);
          scheduleFormulaResultRender();
        },
        onselection: (
          selectedWorksheet: JssInstance,
          startCol: number,
          startRow: number,
          endCol: number,
          endRow: number,
        ): void => {
          const range: CellRange = [startCol, startRow, endCol, endRow];
          if (range.every(value => Number.isInteger(value))) {
            worksheet = selectedWorksheet;
            selectedRange = range;
            updateSelectionStatus(range);
          }
        },
      });
      // jspreadsheet-ce v5 returns an initially empty array and populates it
      // asynchronously. Do not retain that array as the worksheet instance.
      worksheet = Array.isArray(instance) && instance.length === 0
        ? null
        : getWorksheet(instance);
      // The factory returns before its promise-backed initialization is
      // guaranteed to finish. Keep checking for a bounded interval even when
      // onload was delayed or skipped by an earlier render error.
      window.setTimeout(() => hydrateWorksheetUntilReady(), 0);
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
      const appearance = appearanceFromControls(ui, working.appearance?.cellStyle);
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
        appearance: appearanceFromControls(ui, working.appearance?.cellStyle),
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
    ui.defaultCellNoColorInput.addEventListener('change', () => {
      ui.cellColorInput.disabled = ui.defaultCellNoColorInput.checked;
    });
    ui.cellColorInput.addEventListener('change', () => {
      ui.defaultCellNoColorInput.checked = false;
      ui.cellColorInput.disabled = false;
    });
    ui.defaultFontNoTextColorInput.addEventListener('change', () => {
      ui.defaultFontTextColorInput.disabled = ui.defaultFontNoTextColorInput.checked;
    });
    ui.defaultFontTextColorInput.addEventListener('change', () => {
      ui.defaultFontNoTextColorInput.checked = false;
      ui.defaultFontTextColorInput.disabled = false;
    });
    ui.saveAppearanceDefaultBtn.addEventListener('click', async () => {
      const appearance = appearanceFromControls(ui, defaultCellStyleFromControls(ui));
      const updated: SpreadsheetData = {
        ...working,
        data: resizeData(readRawData(), working.rows, working.cols),
        cellStyles: readCellStyles(),
        appearance,
      };
      mountSpreadsheet(updated);
      const scope = ui.appearanceScopeSelect.value as AppearanceScope;
      ui.saveAppearanceDefaultBtn.disabled = true;
      ui.appearanceStatus.textContent = 'Saving…';
      try {
        await saveAppearanceDefault(scope, appearance);
        const notebookOverridesAccount = scope === 'user'
          && Boolean(document.getElementById('spreadsheet-appearance-defaults')?.dataset.notebook);
        ui.appearanceStatus.textContent = notebookOverridesAccount
          ? 'Account default saved. This notebook still uses its notebook override.'
          : (scope === 'user'
            ? 'Table, cell and font defaults saved for your account.'
            : 'Table, cell and font defaults saved for this notebook.');
      } catch (error) {
        ui.appearanceStatus.textContent = error instanceof Error
          ? error.message
          : 'Could not save the table, cell and font defaults.';
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
      const selectedCells: string[] = [];
      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          selectedCells.push(`${colLabel(col)}${row + 1}`);
        }
      }
      const isArithmetic = ['+', '-', '*', '/'].includes(formulaName);
      if (isArithmetic && selectedCells.length < 2) {
        ui.formulaStatus.textContent = 'Select at least two source cells for arithmetic.';
        return;
      }
      const targetCol = startCol;
      const targetRow = endRow + 1;
      const rowCount = readRawData().length;
      if (targetRow >= rowCount) {
        worksheet?.insertRow?.(1, endRow, 0);
        ui.rowsInput.value = String(Math.min(MAX_DIMENSION, rowCount + 1));
      }
      const formulaValue = isArithmetic
        ? `=${selectedCells.join(formulaName)}`
        : `=${formulaName}(${range})`;
      const formulaDescription = formulaValue.slice(1);
      updateRawDataMirrorCell(targetCol, targetRow, formulaValue, false);
      worksheet?.setValueFromCoords?.(targetCol, targetRow, formulaValue);
      const rawData = readRawData();
      const result = evaluateFormula(formulaValue, rawData, targetCol, targetRow);
      scheduleFormulaResultRender();
      worksheet?.updateSelectionFromCoords?.(targetCol, targetRow, targetCol, targetRow);
      ui.formulaStatus.textContent = result === undefined
        ? `${formulaDescription} → ${colLabel(targetCol)}${targetRow + 1}`
        : `${formulaDescription} → ${colLabel(targetCol)}${targetRow + 1} = ${result}`;
    }));

    const cleanup = (): void => {
      finishFormulaSelection();
      ui.sheetHost.removeEventListener('mousedown', onFormulaSelectionStart, true);
      ui.sheetHost.removeEventListener('keydown', onFormulaEditorKeydown, true);
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
  const kind = raw.kind ?? 'standard';
  const computedData = resizeData(computed.length > 0 ? computed : raw.data, raw.rows, raw.cols);
  const displayData = resizeData(
    applyFormulaResults(raw.data, computedData),
    raw.rows,
    raw.cols,
  );
  // Keep a snapshot of what the user sees in TinyMCE. If a visible cell is
  // changed outside the spreadsheet dialog, extractFromTable can merge that
  // edit without replacing unchanged formulas with their computed results.
  raw.displayData = displayData;
  const encoded = encodeSpreadsheetData(raw);
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
  const visibleData = extractVisibleTableData(tableElement, kind);
  if (encoded) {
    const decoded = decodeSpreadsheetData(encoded);
    const rows = clampDimension(visibleData.length || decoded.rows, decoded.rows);
    const cols = clampDimension(
      visibleData.reduce((max, row) => Math.max(max, row.length), 0) || decoded.cols,
      decoded.cols,
    );
    const savedData = resizeData(decoded.data, rows, cols);
    const previousDisplay = decoded.displayData
      ? resizeData(decoded.displayData, rows, cols)
      : undefined;
    const currentDisplay = resizeData(visibleData, rows, cols);
    const mergedData = currentDisplay.map((row, rowIndex) => row.map((visibleValue, colIndex) => {
      const savedValue = savedData[rowIndex][colIndex];
      if (previousDisplay) {
        return String(visibleValue) === String(previousDisplay[rowIndex][colIndex])
          ? savedValue
          : visibleValue;
      }
      // Older spreadsheets do not have a display snapshot. Their ordinary
      // cells can still be synchronized safely. Preserve formulas because the
      // visible HTML contains their result rather than the formula itself.
      return typeof savedValue === 'string' && savedValue.trimStart().startsWith('=')
        ? savedValue
        : visibleValue;
    }));
    const appearance = decoded.appearance
      ? normalizeAppearance(decoded.appearance)
      : undefined;
    const extractedCellStyles = extractCellStyles(
      tableElement,
      decoded.kind ?? kind,
      rows,
      cols,
    );
    const extractedTableStyle = sanitizeStyle(
      tableElement.getAttribute('style') ?? undefined,
      PRESERVED_TABLE_STYLE_PROPERTIES,
    );
    return normalizeSpreadsheetData({
      ...decoded,
      data: mergedData,
      displayData: currentDisplay,
      rows,
      cols,
      caption: tableElement.querySelector('caption')?.textContent?.trim() ?? decoded.caption,
      appearance,
      cellStyles: appearance
        ? stripAppearanceCellStyles(
          extractedCellStyles,
          appearance,
          rows,
          cols,
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

  const data = visibleData;
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

function extractVisibleTableData(
  tableElement: HTMLTableElement,
  kind: SpreadsheetKind,
): AOA {
  const data: AOA = [];
  tableElement.querySelectorAll('tr').forEach((row, rowIndex) => {
    if (kind !== 'notebook' && rowIndex === 0) return;
    const rowData: CellValue[] = [];
    row.querySelectorAll(':scope > th, :scope > td').forEach((cell, cellIndex) => {
      if (kind !== 'notebook' && cellIndex === 0) return;
      rowData.push(cell.textContent?.trim() ?? '');
    });
    if (rowData.length > 0) data.push(rowData);
  });
  return data;
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
