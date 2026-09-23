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
import { captureFocus, restoreFocus } from './a11y';
import { entity } from './getEntity';

type CellValue = string | number | boolean | null;
type AOA = CellValue[][];
type SpreadsheetKind = 'standard' | 'notebook' | 'well-plate';
type CellStyles = Record<string, string>;
type RowHeights = Record<string, number>;
type ColWidths = Record<string, number>;
type AppearanceScope = 'user' | 'notebook';
type CellRange = [number, number, number, number];

interface ClipboardTable {
  data: AOA;
  cellStyles?: CellStyles;
  rowHeights?: RowHeights;
}

export interface FlattenedClipboardSuggestion {
  cells: number;
  columns: number;
  rows: number;
}

interface ClipboardStyleRule {
  selectors: string[];
  declarations: string;
}

interface ClipboardTextStream {
  text: string;
  styles: Array<string | undefined>;
}

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
  /** Width of the fixed row-number/row-letter gutter in the spreadsheet grid. */
  rowIndexWidth: number;
  /** Height of the fixed column-letter/column-number header in the spreadsheet grid. */
  columnIndexHeight: number;
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
  /** Explicit data-row heights in pixels, keyed by zero-based row index. */
  rowHeights?: RowHeights;
  /** Explicit data-column widths in pixels, keyed by zero-based column index. */
  colWidths?: ColWidths;
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
const MIN_DATA_ROW_HEIGHT = 20;
const MAX_DATA_ROW_HEIGHT = 500;
const MIN_DATA_COL_WIDTH = 40;
const MAX_DATA_COL_WIDTH = 800;
const DEFAULT_DATA_COL_WIDTH = 100;
const MIN_ROW_INDEX_WIDTH = 28;
const MAX_ROW_INDEX_WIDTH = 120;
const MIN_COLUMN_INDEX_HEIGHT = 24;
const MAX_COLUMN_INDEX_HEIGHT = 80;
const PDF_PRIVATE_USE_ASCII_OFFSET = 0xFFFE3;
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
  rowIndexWidth: 42,
  columnIndexHeight: 30,
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
  // text-decoration is a shorthand -- CSSStyleDeclaration.item() (used by
  // sanitizeStyle below) enumerates it back as its own longhand
  // sub-properties, not the shorthand name itself, once it's been set via
  // style.setProperty('text-decoration', ...) (as updateQuickStyleProperty
  // does for the underline toggle). Without these also allow-listed,
  // sanitizeStyle silently dropped every one of them, stripping the
  // underline back out right after applying it -- bold/italic have no such
  // shorthand-vs-longhand split and were never affected.
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color',
  'text-decoration-thickness',
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
const PRESERVED_PDF_TEXT_STYLE_PROPERTIES = new Set([
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
  'line-height',
  'text-align',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color',
  'text-decoration-thickness',
  'vertical-align',
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
    '\'Times New Roman\', serif',
    '\'Courier New\', monospace',
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
    rowIndexWidth: normalizeInteger(
      candidate?.rowIndexWidth,
      DEFAULT_APPEARANCE.rowIndexWidth,
      MIN_ROW_INDEX_WIDTH,
      MAX_ROW_INDEX_WIDTH,
    ),
    columnIndexHeight: normalizeInteger(
      candidate?.columnIndexHeight,
      DEFAULT_APPEARANCE.columnIndexHeight,
      MIN_COLUMN_INDEX_HEIGHT,
      MAX_COLUMN_INDEX_HEIGHT,
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
  const candidateData = Array.isArray(candidate.data) ? candidate.data : [[]];
  const dataRows = candidateData.length;
  const dataCols = candidateData.reduce(
    (maximum, row) => Math.max(maximum, Array.isArray(row) ? row.length : 0),
    0,
  );
  // Prefer the actual grid dimensions when they are larger than stale stored
  // metadata. This can happen after jspreadsheet inserts rows or columns.
  const rows = clampDimension(Math.max(candidate.rows ?? 0, dataRows), DEFAULT_ROWS);
  const cols = clampDimension(Math.max(candidate.cols ?? 0, dataCols), DEFAULT_COLS);
  const kind: SpreadsheetKind = candidate.kind === 'notebook' || candidate.kind === 'well-plate'
    ? candidate.kind
    : 'standard';
  return {
    data: resizeData(candidateData, rows, cols),
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
    rowHeights: normalizeRowHeights(candidate.rowHeights, rows),
    colWidths: normalizeColWidths(candidate.colWidths, cols),
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

function normalizeRowHeights(
  candidate: RowHeights | undefined,
  rows: number,
): RowHeights | undefined {
  if (!candidate || typeof candidate !== 'object') return undefined;
  const normalized: RowHeights = {};
  Object.entries(candidate).forEach(([rowKey, value]) => {
    const row = Number.parseInt(rowKey, 10);
    const height = Number(value);
    if (!Number.isInteger(row) || row < 0 || row >= rows || !Number.isFinite(height)) return;
    normalized[String(row)] = Math.max(
      MIN_DATA_ROW_HEIGHT,
      Math.min(MAX_DATA_ROW_HEIGHT, Math.round(height)),
    );
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeColWidths(
  candidate: ColWidths | undefined,
  cols: number,
): ColWidths | undefined {
  if (!candidate || typeof candidate !== 'object') return undefined;
  const normalized: ColWidths = {};
  Object.entries(candidate).forEach(([colKey, value]) => {
    const col = Number.parseInt(colKey, 10);
    const width = Number(value);
    if (!Number.isInteger(col) || col < 0 || col >= cols || !Number.isFinite(width)) return;
    normalized[String(col)] = Math.max(
      MIN_DATA_COL_WIDTH,
      Math.min(MAX_DATA_COL_WIDTH, Math.round(width)),
    );
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
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

function parseDelimitedClipboard(text: string, delimiter: string): AOA {
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
      } else if (quoted) {
        quoted = false;
      } else if (value === '') {
        quoted = !quoted;
      } else {
        value += character;
      }
    } else if (character === delimiter && !quoted) {
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

function removeMarkdownSeparatorRow(rows: AOA): AOA {
  if (rows.length < 2) return rows;
  const isSeparator = rows[1].every(value => /^:?-{3,}:?$/.test(String(value).trim()));
  return isSeparator ? [rows[0], ...rows.slice(2)] : rows;
}

function normalizePipeDelimitedRows(rows: AOA): AOA {
  return rows.map(row => {
    const normalized = [...row];
    if (normalized[0] === '') normalized.shift();
    if (normalized.at(-1) === '') normalized.pop();
    return normalized;
  });
}

function isStructuredTable(rows: AOA, minimumRows = 2): boolean {
  const populatedRows = rows.filter(row => row.some(value => String(value).trim() !== ''));
  if (populatedRows.length < minimumRows) return false;
  const columnCounts = populatedRows.map(row => row.length);
  const firstCount = columnCounts[0];
  return firstCount >= 2 && columnCounts.every(count => count === firstCount);
}

function isPdfNumericValue(value: string): boolean {
  return /^[-+]?[$€£¥]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[%a-zµμ]+)?$/i.test(value);
}

/**
 * PDF viewers sometimes collapse every visual gap to one space. In that case
 * a multiword first column makes rows look ragged, but numeric result columns
 * at the right still provide a reliable boundary. Preserve the label as one
 * cell and split only the consistent numeric suffix.
 */
function parsePdfNumericSuffixTable(lines: string[]): AOA | null {
  if (lines.length < 3) return null;
  const tokenRows = lines.map(line => line.split(/\s+/).filter(Boolean));
  const suffixCounts = tokenRows.slice(1).map(row => {
    let count = 0;
    for (let index = row.length - 1; index >= 0; index--) {
      if (!isPdfNumericValue(row[index])) break;
      count++;
    }
    return count;
  });
  const frequencies = new Map<number, number>();
  suffixCounts.forEach(count => {
    if (count > 0) frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
  });
  const suffixWidth = Array.from(frequencies.entries())
    .sort(([leftWidth, leftCount], [rightWidth, rightCount]) => (
      rightCount - leftCount || rightWidth - leftWidth
    ))[0]?.[0] ?? 0;
  const matchingDataRows = suffixCounts.filter(count => count >= suffixWidth).length;
  if (suffixWidth === 0 || matchingDataRows < 2
    || matchingDataRows / suffixCounts.length < 0.75
  ) {
    return null;
  }

  const normalized = tokenRows.map(row => {
    if (row.length < suffixWidth) return null;
    const splitAt = row.length - suffixWidth;
    return [row.slice(0, splitAt).join(' '), ...row.slice(splitAt)];
  });
  if (normalized.some(row => row === null)) return null;
  return normalized as AOA;
}

/**
 * Some PDF generators omit a usable ToUnicode font map and put copied ASCII
 * characters in Unicode's supplementary private-use area instead. One common
 * encoding maps printable ASCII to U+100003..U+100061 using a fixed offset.
 *
 * Decode only when the clipboard is clearly dominated by that exact pattern;
 * this keeps legitimate private-use icons and all ordinary Unicode untouched.
 */
export function normalizePdfPrivateUseText(plainText: string): string {
  let encodedCharacters = 0;
  let visibleCharacters = 0;

  for (const character of plainText) {
    if (!/\s/u.test(character)) visibleCharacters++;
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const decodedCodePoint = codePoint - PDF_PRIVATE_USE_ASCII_OFFSET;
    if (decodedCodePoint >= 0x20 && decodedCodePoint <= 0x7E) encodedCharacters++;
  }

  if (encodedCharacters < 4
    || encodedCharacters / Math.max(1, visibleCharacters) < 0.6
  ) {
    return plainText;
  }

  return decodePdfPrivateUseCharacters(plainText);
}

function decodePdfPrivateUseCharacters(text: string): string {
  return Array.from(text, character => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return character;
    const decodedCodePoint = codePoint - PDF_PRIVATE_USE_ASCII_OFFSET;
    return decodedCodePoint >= 0x20 && decodedCodePoint <= 0x7E
      ? String.fromCodePoint(decodedCodePoint)
      : character;
  }).join('');
}

function getFlattenedClipboardValues(plainText: string): string[] | null {
  const values = normalizePdfPrivateUseText(plainText)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(value => value.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);
  if (values.length < 4 || values.some(value => value.length > 200)) return null;

  const cellLikeValues = values.filter(value => value.split(/\s+/).length <= 6);
  const numericValues = values.filter(value => isPdfNumericValue(value));
  const listItems = values.filter(value => /^(?:[-*•]|\d+[.)])\s+/.test(value));
  if (cellLikeValues.length / values.length < 0.8
    || listItems.length / values.length >= 0.5
    || (numericValues.length < 2 && values.length < 8)
  ) {
    return null;
  }
  return values;
}

function clipboardValueType(value: string): 'date' | 'number' | 'text' {
  if (isPdfNumericValue(value)) return 'number';
  if (/^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})$/.test(value)) {
    return 'date';
  }
  return 'text';
}

function suggestFlattenedClipboardColumns(values: string[]): number {
  const maximum = Math.min(12, Math.floor(values.length / 2));
  const candidates: Array<{ columns: number; score: number }> = [];
  for (let columns = 2; columns <= maximum; columns++) {
    const rows: string[][] = [];
    for (let index = 0; index < values.length; index += columns) {
      rows.push(values.slice(index, index + columns));
    }
    if (rows.length < 2) continue;
    const complete = values.length % columns === 0;
    const dataRows = rows.length >= 3 ? rows.slice(1) : rows;
    const fullDataRows = dataRows.filter(row => row.length === columns);
    if (fullDataRows.length === 0) continue;

    let columnConsistency = 0;
    for (let column = 0; column < columns; column++) {
      const counts = new Map<string, number>();
      fullDataRows.forEach(row => {
        const type = clipboardValueType(row[column]);
        counts.set(type, (counts.get(type) ?? 0) + 1);
      });
      columnConsistency += Math.max(...counts.values()) / fullDataRows.length;
    }
    columnConsistency /= columns;

    const signatures = fullDataRows.map(row => row.map(clipboardValueType).join('|'));
    const signatureCounts = new Map<string, number>();
    signatures.forEach(signature => {
      signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
    });
    const signatureConsistency = Math.max(...signatureCounts.values()) / signatures.length;
    const header = rows[0];
    const headerTextRatio = header.filter(value => clipboardValueType(value) === 'text').length
      / header.length;
    const dataValues = fullDataRows.flat();
    const dataNumericRatio = dataValues.filter(value => clipboardValueType(value) !== 'text').length
      / dataValues.length;
    const balance = Math.abs(Math.log(rows.length / columns));
    const score = (complete ? 2 : 0)
      + columnConsistency
      + (signatureConsistency * 1.5)
      + (headerTextRatio * dataNumericRatio * 1.5)
      - (balance * 0.1)
      - (columns > 8 ? (columns - 8) * 0.15 : 0);
    candidates.push({ columns, score });
  }
  candidates.sort((left, right) => right.score - left.score || left.columns - right.columns);
  return candidates[0]?.columns ?? 2;
}

/**
 * Detect PDF clipboard data where every cell was flattened onto its own line.
 * Because such clipboard text has no row delimiters, callers should let the
 * user confirm the suggested number of columns before inserting it.
 */
export function getFlattenedClipboardSuggestion(
  plainText: string,
): FlattenedClipboardSuggestion | null {
  const values = getFlattenedClipboardValues(plainText);
  if (!values) return null;
  const columns = suggestFlattenedClipboardColumns(values);
  return {
    cells: values.length,
    columns,
    rows: Math.ceil(values.length / columns),
  };
}

export function spreadsheetFromFlattenedClipboard(
  plainText: string,
  requestedColumns: number,
  html = '',
): SpreadsheetData | null {
  const values = getFlattenedClipboardValues(plainText);
  if (!values) return null;
  const columns = Math.min(MAX_DIMENSION, Math.max(2, Math.round(requestedColumns)));
  const rows = Math.min(MAX_DIMENSION, Math.ceil(values.length / columns));
  const data: AOA = Array.from({ length: rows }, (_, row) => (
    Array.from({ length: columns }, (_, column) => values[(row * columns) + column] ?? '')
  ));
  return {
    data,
    rows,
    cols: columns,
    kind: 'standard',
    caption: '',
    cellStyles: getClipboardRichTextStyles(html, data),
    appearance: getEffectiveAppearanceDefaults(),
  };
}

function parseStructuredPlainText(plainText: string): AOA | null {
  const text = plainText.replace(/^\uFEFF/, '');
  if (!text.trim()) return null;

  // Tabs are an explicit table signal used by Excel, LibreOffice and many PDF readers.
  if (text.includes('\t')) return parseDelimitedClipboard(text, '\t');

  const candidates = [',', ';', '|']
    .filter(delimiter => text.includes(delimiter))
    .map(delimiter => {
      let rows = parseDelimitedClipboard(text, delimiter);
      if (delimiter === '|') rows = removeMarkdownSeparatorRow(normalizePipeDelimitedRows(rows));
      return rows;
    })
    .filter(rows => isStructuredTable(rows));
  if (candidates.length > 0) {
    return candidates.reduce((best, candidate) => (
      candidate[0].length > best[0].length ? candidate : best
    ));
  }

  // PDF text extraction commonly represents column boundaries as repeated spaces.
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const spacedRows = lines.map(line => line.split(/\s{2,}/));
  if (isStructuredTable(spacedRows)) return spacedRows;

  // Blank cells and wrapped labels can make PDF rows slightly ragged even
  // when most rows retain repeated-space column separators. The spreadsheet
  // normalizer pads the shorter rows after this explicit whitespace signal.
  const spacedDataRows = spacedRows.filter(row => row.length >= 2);
  if (spacedDataRows.length >= 2 && spacedDataRows.length / spacedRows.length >= 0.75) {
    return spacedRows;
  }

  // Some PDF viewers collapse visual column gaps to a single space. Treat
  // consistently shaped, data-heavy lines as a table while avoiding ordinary
  // prose, which rarely has the same number of tokens on three or more lines.
  const singleSpaceRows = lines.map(line => line.split(/\s+/));
  if (isStructuredTable(singleSpaceRows, 3)) {
    const values = singleSpaceRows.flat();
    const numericValues = values.filter(value => isPdfNumericValue(value));
    if (numericValues.length / values.length >= 0.25) return singleSpaceRows;
  }
  return parsePdfNumericSuffixTable(lines);
}

function getClipboardStyleRules(clipboardDocument: Document): ClipboardStyleRule[] {
  const rules: ClipboardStyleRule[] = [];
  clipboardDocument.querySelectorAll('style').forEach(styleElement => {
    const css = (styleElement.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = rulePattern.exec(css)) !== null) {
      const selectors = match[1]
        .split(',')
        .map(selector => selector.trim())
        .filter(selector => selector !== '' && !selector.startsWith('@'));
      if (selectors.length > 0) {
        rules.push({ selectors, declarations: match[2] });
      }
    }
  });
  return rules;
}

function getClipboardElementCandidateStyle(
  element: Element,
  rules: ClipboardStyleRule[],
): CSSStyleDeclaration {
  const candidate = document.createElement('span').style;
  rules.forEach(rule => {
    const matches = rule.selectors.some(selector => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    });
    if (matches) candidate.cssText += `;${rule.declarations}`;
  });
  candidate.cssText += `;${element.getAttribute('style') ?? ''}`;
  if (element.tagName === 'FONT') {
    const color = element.getAttribute('color');
    const family = element.getAttribute('face');
    const size = element.getAttribute('size');
    if (color) candidate.color = color;
    if (family) candidate.fontFamily = family;
    if (size && /^\d+(?:\.\d+)?(?:pt|px|em|rem|%)$/i.test(size)) candidate.fontSize = size;
  }
  if (element.matches('b, strong')) candidate.fontWeight = 'bold';
  if (element.matches('i, em')) candidate.fontStyle = 'italic';
  if (element.matches('u')) candidate.textDecoration = 'underline';
  const backgroundAttribute = element.getAttribute('bgcolor');
  if (backgroundAttribute) candidate.backgroundColor = backgroundAttribute;
  const alignAttribute = element.getAttribute('align');
  if (alignAttribute && /^(?:left|center|right|justify)$/i.test(alignAttribute)) {
    candidate.textAlign = alignAttribute;
  }
  return candidate;
}

function getClipboardCellStyle(
  cell: HTMLTableCellElement,
  rules: ClipboardStyleRule[],
): string | undefined {
  const style = document.createElement('span').style;
  const inheritedProperties = [
    'color',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'text-align',
    'text-decoration',
    'vertical-align',
    'white-space',
  ];
  const applyElementStyle = (element: Element | null, inheritedOnly = false): void => {
    if (!element) return;
    const candidate = getClipboardElementCandidateStyle(element, rules);

    if (inheritedOnly) {
      inheritedProperties.forEach(property => {
        const value = candidate.getPropertyValue(property);
        if (value) style.setProperty(property, value);
      });
      return;
    }
    style.cssText += `;${candidate.cssText}`;
  };

  // Excel commonly declares its base font on body or a wrapper and overrides
  // only selected cells. Walk the complete cascade so cells without a local
  // font do not fall back to the notebook font and look inconsistent.
  const table = cell.closest('table');
  const ancestors: Element[] = [];
  let ancestor: Element | null = cell;
  while (ancestor) {
    ancestors.unshift(ancestor);
    ancestor = ancestor.parentElement;
  }
  ancestors.forEach(element => {
    const belongsToTable = Boolean(table && (element === table || table.contains(element)));
    applyElementStyle(element, !belongsToTable);
  });

  // A cell can contain several nested wrappers. Follow the first visible text
  // run from the cell towards the leaf so its effective font wins in the same
  // order as the browser's CSS cascade.
  const walker = cell.ownerDocument.createTreeWalker(cell, 4);
  let textNode = walker.nextNode();
  while (textNode && !textNode.textContent?.trim()) textNode = walker.nextNode();
  const nestedElements: Element[] = [];
  let nested = textNode?.parentElement ?? null;
  while (nested && nested !== cell) {
    nestedElements.unshift(nested);
    nested = nested.parentElement;
  }
  nestedElements.forEach(element => applyElementStyle(element));
  const declarations: string[] = [];
  const add = (property: string, value: string): void => {
    if (value) declarations.push(`${property}:${value}`);
  };
  add('background-color', style.backgroundColor);
  add('color', style.color);
  add('font-family', style.fontFamily);
  add('font-size', style.fontSize);
  add('font-style', style.fontStyle);
  add('font-weight', style.fontWeight);
  add('text-decoration', style.textDecoration);
  add('text-align', style.textAlign);
  add('vertical-align', style.verticalAlign);
  add('white-space', style.whiteSpace);
  add('width', style.width);
  add('height', style.height);
  add('padding', style.padding);
  ['top', 'right', 'bottom', 'left'].forEach(side => {
    const borderStyle = style.getPropertyValue(`border-${side}-style`);
    const borderWidth = style.getPropertyValue(`border-${side}-width`);
    const borderColor = style.getPropertyValue(`border-${side}-color`);
    if (borderStyle && borderStyle !== 'none' && borderWidth) {
      add(`border-${side}`, `${borderWidth} ${borderStyle} ${borderColor}`.trim());
    }
  });
  return sanitizeStyle(declarations.join(';'), PRESERVED_STYLE_PROPERTIES);
}

function getClipboardTextElementStyle(
  element: Element,
  rules: ClipboardStyleRule[],
): string | undefined {
  const style = document.createElement('span').style;
  const ancestors: Element[] = [];
  let ancestor: Element | null = element;
  while (ancestor) {
    ancestors.unshift(ancestor);
    ancestor = ancestor.parentElement;
  }
  ancestors.forEach(current => {
    const candidate = getClipboardElementCandidateStyle(current, rules);
    style.cssText += `;${candidate.cssText}`;
  });
  return sanitizeStyle(style.cssText, PRESERVED_PDF_TEXT_STYLE_PROPERTIES);
}

function getClipboardRichTextStream(html: string): ClipboardTextStream | null {
  if (!html.trim()) return null;
  const clipboardDocument = new DOMParser().parseFromString(html, 'text/html');
  const body = clipboardDocument.body;
  if (!body.textContent?.trim()) return null;
  const rules = getClipboardStyleRules(clipboardDocument);
  const decodePrivateUse = normalizePdfPrivateUseText(body.textContent) !== body.textContent;
  const characters: string[] = [];
  const styles: Array<string | undefined> = [];
  const blockElements = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'HEADER', 'H1', 'H2', 'H3', 'H4',
    'H5', 'H6', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
    'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
  ]);
  const appendSeparator = (): void => {
    if (characters.length > 0 && characters[characters.length - 1] !== ' ') {
      characters.push(' ');
      styles.push(undefined);
    }
  };
  const appendText = (value: string, style: string | undefined): void => {
    const decoded = decodePrivateUse ? decodePdfPrivateUseCharacters(value) : value;
    for (const character of decoded.replace(/\u00a0/g, ' ')) {
      if (/\s/u.test(character)) {
        appendSeparator();
      } else {
        characters.push(character);
        styles.push(style);
      }
    }
  };
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const parent = node.parentElement;
      if (parent && !parent.matches('script, style, noscript')) {
        appendText(node.textContent ?? '', getClipboardTextElementStyle(parent, rules));
      }
      return;
    }
    if (!(node instanceof Element) || node.matches('script, style, noscript')) return;
    if (node.tagName === 'BR') {
      appendSeparator();
      return;
    }
    const isBlock = blockElements.has(node.tagName);
    if (isBlock) appendSeparator();
    node.childNodes.forEach(visit);
    if (isBlock) appendSeparator();
  };
  body.childNodes.forEach(visit);

  while (characters[characters.length - 1] === ' ') {
    characters.pop();
    styles.pop();
  }
  return characters.length > 0 ? { text: characters.join(''), styles } : null;
}

function getClipboardRichTextStyles(html: string, data: AOA): CellStyles | undefined {
  // Real HTML tables are handled by parseClipboardHtmlTable, which also
  // preserves blank-cell backgrounds, spans, borders and merged cells.
  if (!html.trim() || /<table[\s>]/i.test(html)) return undefined;
  const stream = getClipboardRichTextStream(html);
  if (!stream) return undefined;

  const cellStyles: CellStyles = {};
  let searchFrom = 0;
  const findCellText = (needle: string): number => {
    let candidate = stream.text.indexOf(needle, searchFrom);
    const needsLeadingBoundary = /^\w/u.test(needle);
    const needsTrailingBoundary = /\w$/u.test(needle);
    while (candidate >= 0) {
      const before = candidate > 0 ? stream.text[candidate - 1] : '';
      const after = stream.text[candidate + needle.length] ?? '';
      if ((!needsLeadingBoundary || !/\w/u.test(before))
        && (!needsTrailingBoundary || !/\w/u.test(after))
      ) {
        return candidate;
      }
      candidate = stream.text.indexOf(needle, candidate + 1);
    }
    return -1;
  };
  data.forEach((row, rowIndex) => row.forEach((value, colIndex) => {
    const needle = normalizePdfPrivateUseText(String(value ?? ''))
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!needle) return;
    const start = findCellText(needle);
    if (start < 0) return;
    const end = start + needle.length;
    const styleCounts = new Map<string, number>();
    for (let index = start; index < end; index++) {
      const style = stream.styles[index];
      if (!style || stream.text[index] === ' ') continue;
      styleCounts.set(style, (styleCounts.get(style) ?? 0) + 1);
    }
    const dominantStyle = Array.from(styleCounts.entries())
      .sort((left, right) => right[1] - left[1])[0]?.[0];
    if (dominantStyle) cellStyles[`${colLabel(colIndex)}${rowIndex + 1}`] = dominantStyle;
    searchFrom = end;
  }));
  return Object.keys(cellStyles).length > 0 ? cellStyles : undefined;
}

function parseClipboardHtmlTable(html: string): ClipboardTable | null {
  if (!html.trim()) return null;
  const clipboardDocument = new DOMParser().parseFromString(html, 'text/html');
  const table = clipboardDocument.querySelector('table');
  if (!table) return null;

  const rows: AOA = [];
  const cellStyles: CellStyles = {};
  const rowHeights: RowHeights = {};
  const styleRules = getClipboardStyleRules(clipboardDocument);
  const isFormulaSpreadsheet = table.classList.contains('elabftw-spreadsheet');
  Array.from(table.rows).forEach(tableRow => {
    const sourceCells = Array.from(tableRow.cells).filter(cell => (
      !isFormulaSpreadsheet || !cell.classList.contains('spreadsheet-coordinate')
    ));
    if (sourceCells.length === 0) return;
    const rowIndex = rows.length;
    const rowHeight = Number.parseFloat(tableRow.style.height);
    if (Number.isFinite(rowHeight)) {
      rowHeights[String(rowIndex)] = Math.max(
        MIN_DATA_ROW_HEIGHT,
        Math.min(MAX_DATA_ROW_HEIGHT, Math.round(rowHeight)),
      );
    }
    rows[rowIndex] ??= [];
    let colIndex = 0;
    sourceCells.forEach(cell => {
      while (rows[rowIndex][colIndex] !== undefined) colIndex++;
      const colSpan = Math.max(1, cell.colSpan || 1);
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const cellValue = (cell.textContent ?? '').replace(/\u00a0/g, ' ').trim();
      const cellStyle = getClipboardCellStyle(cell, styleRules);
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset++) {
        const targetRow = rowIndex + rowOffset;
        rows[targetRow] ??= [];
        for (let colOffset = 0; colOffset < colSpan; colOffset++) {
          const targetCol = colIndex + colOffset;
          rows[targetRow][targetCol] = rowOffset === 0 && colOffset === 0
            ? cellValue
            : '';
          if (cellStyle) cellStyles[`${colLabel(targetCol)}${targetRow + 1}`] = cellStyle;
        }
      }
      colIndex += colSpan;
    });
  });
  const fontFamilies = new Map<string, { count: number; value: string }>();
  Object.values(cellStyles).forEach(cellStyle => {
    const parsedStyle = document.createElement('span').style;
    parsedStyle.cssText = cellStyle;
    const family = parsedStyle.fontFamily.trim();
    if (!family) return;
    const key = family.toLowerCase();
    const existing = fontFamilies.get(key);
    fontFamilies.set(key, { count: (existing?.count ?? 0) + 1, value: existing?.value ?? family });
  });
  const dominantFontFamily = Array.from(fontFamilies.values())
    .sort((left, right) => right.count - left.count)[0]?.value;
  if (dominantFontFamily) {
    rows.forEach((row, rowIndex) => row.forEach((_value, colIndex) => {
      const cellName = `${colLabel(colIndex)}${rowIndex + 1}`;
      const parsedStyle = document.createElement('span').style;
      parsedStyle.cssText = cellStyles[cellName] ?? '';
      parsedStyle.fontFamily = dominantFontFamily;
      const normalized = sanitizeStyle(parsedStyle.cssText, PRESERVED_STYLE_PROPERTIES);
      if (normalized) cellStyles[cellName] = normalized;
    }));
  }

  return {
    data: rows,
    cellStyles: Object.keys(cellStyles).length > 0 ? cellStyles : undefined,
    rowHeights: Object.keys(rowHeights).length > 0 ? rowHeights : undefined,
  };
}

/**
 * Browsers may put a selected row or group of cells on the clipboard without
 * its surrounding table. Wrap those fragments so the regular HTML table
 * parser can retain their cell boundaries and formatting.
 */
function normalizeClipboardTableHtml(html: string): string {
  if (/<table[\s>]/i.test(html)) return html;
  if (/<tr[\s>]/i.test(html)) return `<table><tbody>${html}</tbody></table>`;
  if (/<(?:td|th)[\s>]/i.test(html)) return `<table><tbody><tr>${html}</tr></tbody></table>`;
  return html;
}

/**
 * Convert structured clipboard content to a formula-enabled data table.
 * Excel/LibreOffice HTML retains safe cell formatting; plain-text fallbacks
 * cover CSV, TSV, semicolon/pipe tables and PDF-style repeated-space columns.
 */
export function spreadsheetFromClipboard(html: string, plainText: string): SpreadsheetData | null {
  const normalizedHtml = normalizeClipboardTableHtml(html);
  const containsTable = /<table[\s>]/i.test(normalizedHtml);
  const clipboardTable = containsTable
    ? parseClipboardHtmlTable(normalizedHtml)
    : null;
  const parsed = clipboardTable?.data
    ?? parseStructuredPlainText(normalizePdfPrivateUseText(plainText));
  if (!parsed || parsed.length === 0) return null;
  const rows = Math.min(MAX_DIMENSION, parsed.length);
  const cols = Math.min(
    MAX_DIMENSION,
    parsed.reduce((maximum, row) => Math.max(maximum, row.length), 0),
  );
  if (cols === 0) return null;
  const richTextStyles = clipboardTable?.cellStyles
    ?? getClipboardRichTextStyles(normalizedHtml, parsed);
  const appearance = getEffectiveAppearanceDefaults();

  // Clipboard tables should keep the shape of their source instead of
  // inheriting a notebook/account default that can stretch every imported
  // table to 100% of the editor. Users can still set an explicit width later
  // from Table style or the spreadsheet appearance controls.
  appearance.tableWidth = 0;

  return {
    data: resizeData(parsed, rows, cols),
    rows,
    cols,
    kind: 'standard',
    caption: '',
    cellStyles: normalizeCellStyles(richTextStyles, rows, cols),
    rowHeights: normalizeRowHeights(clipboardTable?.rowHeights, rows),
    appearance,
  };
}

/** Paste a rectangular source grid into an existing formula spreadsheet. */
export function pasteSpreadsheetRange(
  targetData: SpreadsheetData,
  sourceData: SpreadsheetData,
  startCol: number,
  startRow: number,
): SpreadsheetData {
  const target = normalizeSpreadsheetData(targetData);
  const source = normalizeSpreadsheetData(sourceData);
  const safeStartCol = Math.max(0, Math.min(MAX_DIMENSION - 1, startCol));
  const safeStartRow = Math.max(0, Math.min(MAX_DIMENSION - 1, startRow));
  const rows = Math.min(MAX_DIMENSION, Math.max(target.rows, safeStartRow + source.rows));
  const cols = Math.min(MAX_DIMENSION, Math.max(target.cols, safeStartCol + source.cols));
  const data = resizeData(target.data, rows, cols);
  for (let row = 0; row < source.rows && safeStartRow + row < rows; row++) {
    for (let col = 0; col < source.cols && safeStartCol + col < cols; col++) {
      data[safeStartRow + row][safeStartCol + col] = source.data[row]?.[col] ?? '';
    }
  }

  const cellStyles: CellStyles = { ...(target.cellStyles ?? {}) };
  Object.entries(source.cellStyles ?? {}).forEach(([cellName, style]) => {
    const coordinates = coordinatesFromCellName(cellName);
    if (!coordinates) return;
    const targetCol = safeStartCol + coordinates.col;
    const targetRow = safeStartRow + coordinates.row;
    if (targetCol >= cols || targetRow >= rows) return;
    cellStyles[`${colLabel(targetCol)}${targetRow + 1}`] = style;
  });
  const rowHeights: RowHeights = { ...(target.rowHeights ?? {}) };
  Object.entries(source.rowHeights ?? {}).forEach(([rowKey, height]) => {
    const sourceRow = Number.parseInt(rowKey, 10);
    const targetRow = safeStartRow + sourceRow;
    if (!Number.isInteger(sourceRow) || targetRow < 0 || targetRow >= rows) return;
    rowHeights[String(targetRow)] = height;
  });

  const changedPlateSize = target.kind === 'well-plate'
    && (rows !== target.rows || cols !== target.cols);
  return normalizeSpreadsheetData({
    ...target,
    data,
    displayData: undefined,
    rows,
    cols,
    kind: changedPlateSize ? 'standard' : target.kind,
    plateSize: changedPlateSize ? undefined : target.plateSize,
    cellStyles: Object.keys(cellStyles).length > 0 ? cellStyles : undefined,
    rowHeights: Object.keys(rowHeights).length > 0 ? rowHeights : undefined,
  });
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

/**
 * "Apply appearance" is meant to make the table's/appearance's own colors
 * (including alternating-row striping) the single source of truth -- a
 * manually-set per-cell background color would otherwise keep winning over
 * it, since getCellStyleAttribute() concatenates the appearance-generated
 * style first and each cell's explicit style after, and a later CSS
 * declaration for the same property always wins. Drop just
 * background-color from each cell's explicit style before folding the
 * freshly-applied appearance back in, so its own background (the
 * alternating stripe or the plain default) actually takes effect; every
 * other per-cell override (alignment, font, borders, etc.) is untouched.
 */
function stripCellBackgroundOverrides(styles: CellStyles | undefined): CellStyles | undefined {
  if (!styles) return undefined;
  const result: CellStyles = {};
  Object.entries(styles).forEach(([cellName, style]) => {
    const element = document.createElement('span');
    element.setAttribute('style', style);
    element.style.removeProperty('background-color');
    if (element.getAttribute('style')) result[cellName] = element.getAttribute('style') as string;
  });
  return result;
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
    // Without this, the browser's default auto layout recomputes every
    // column's width from its cells' current content on each edit -- so
    // typing or deleting text in one cell can visibly resize *other*,
    // untouched columns as the table reflows. Fixed layout makes column
    // widths depend only on the colgroup (see getColGroupHtml(), which
    // gives every column an explicit width) and the table's own width,
    // never on cell content.
    'table-layout:fixed',
    `--spreadsheet-row-index-width:${appearance.rowIndexWidth}px`,
    `--spreadsheet-column-index-height:${appearance.columnIndexHeight}px`,
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
  // DEFAULT_TABLE_STYLE's own "min-width:25%" is only meant as a sensible
  // floor for a brand-new, unconfigured table -- it's never regenerated by
  // getAppearanceTableStyle() above, so the loop just above never touches
  // it. Once the user sets an explicit table width, that min-width lingers
  // in this same persisted style string forever, since nothing else ever
  // removes it -- and CSS min-width always wins over a smaller width, so
  // shrinking the table below 25% silently clamped back up to 25%. An
  // explicit width fully expresses the user's sizing intent; drop the floor
  // once they've set one.
  if (appearance.tableWidth > 0) actual.style.removeProperty('min-width');
  return sanitizeStyle(
    actual.getAttribute('style') ?? undefined,
    PRESERVED_TABLE_STYLE_PROPERTIES,
  );
}

/**
 * Spreadsheet row heights must determine the total table height. TinyMCE can
 * add an explicit outer height while object-resizing a table; browsers then
 * redistribute that fixed height across the remaining rows.
 */
function stripFixedTableHeight(style: string | undefined): string | undefined {
  if (!style) return undefined;
  const table = document.createElement('table');
  table.setAttribute('style', style);
  table.style.removeProperty('height');
  table.style.removeProperty('min-height');
  table.style.removeProperty('max-height');
  return sanitizeStyle(
    table.getAttribute('style') ?? undefined,
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
  const match = /^=\s*(SUM|AVERAGE|COUNT|MIN|MAX|MEDIAN|STDEV|ROUND)\s*\((.*)\)\s*$/i.exec(formulaValue);

  if (!match) {
    let arithmeticExpression = formulaValue.trim().slice(1);
    const aggregatePattern = /(SUM|AVERAGE|COUNT|MIN|MAX|MEDIAN|STDEV|ROUND)\s*\(([^()]*)\)/i;
    let aggregateMatch = aggregatePattern.exec(arithmeticExpression);
    while (aggregateMatch) {
      const nestedResolving = new Set(resolving);
      nestedResolving.delete(formulaKey);
      const aggregateValue = evaluateFormula(
        `=${aggregateMatch[0]}`,
        data,
        formulaCol,
        formulaRow,
        nestedResolving,
      );
      if (aggregateValue === undefined) {
        resolving.delete(formulaKey);
        return undefined;
      }
      arithmeticExpression = `${arithmeticExpression.slice(0, aggregateMatch.index)}${aggregateValue}${arithmeticExpression.slice(aggregateMatch.index + aggregateMatch[0].length)}`;
      aggregateMatch = aggregatePattern.exec(arithmeticExpression);
    }
    const result = evaluateArithmeticExpression(
      arithmeticExpression,
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
  if (functionName === 'ROUND') {
    if (numericValues.length !== 2) return undefined;
    const factor = 10 ** Math.max(0, Math.round(numericValues[1]));
    return Math.round(numericValues[0] * factor) / factor;
  }
  if (numericValues.length === 0) return 0;
  if (functionName === 'AVERAGE') {
    return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  }
  if (functionName === 'MIN') return Math.min(...numericValues);
  if (functionName === 'MAX') return Math.max(...numericValues);
  if (functionName === 'MEDIAN') {
    const sorted = [...numericValues].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
  if (functionName === 'STDEV') {
    if (numericValues.length < 2) return undefined;
    const mean = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
    const variance = numericValues.reduce((sum, value) => sum + (value - mean) ** 2, 0)
      / (numericValues.length - 1);
    return Math.sqrt(variance);
  }
  return undefined;
}

// Keep calculations at full JavaScript precision and round only what users
// see. Converting the fixed value back to a number removes unnecessary
// trailing zeroes (1.50 becomes 1.5) while capping noisy results at two
// decimal places.
const formatFormulaResult = (value: number): string => String(Number(value.toFixed(2)));

function renderFormulaResults(container: HTMLElement, data: AOA): void {
  data.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (typeof value !== 'string' || !value.trimStart().startsWith('=')) return;
      const result = evaluateFormula(value, data, colIndex, rowIndex);
      if (result === undefined) return;
      const cell = container.querySelector<HTMLElement>(
        `td[data-x="${colIndex}"][data-y="${rowIndex}"]`,
      );
      // Never replace an active editor. Formula repaints are deliberately
      // retried on timers, so one scheduled by an earlier change can run
      // while this (or another) formula cell is being edited; assigning
      // textContent then removes jspreadsheet's input from the DOM, loses
      // the cursor and lets the next key fall through to app shortcuts.
      // The `editor` class is unreliable after Enter in v5, but the actual
      // input/textarea is an unambiguous indication that editing is active.
      if (cell && !cell.querySelector('input, textarea, [contenteditable="true"]')) {
        cell.textContent = formatFormulaResult(result);
      }
    });
  });
}

function previewSpreadsheetCell(
  container: HTMLElement,
  data: AOA,
  col: number,
  row: number,
  value: CellValue,
): void {
  const cell = container.querySelector<HTMLElement>(
    `td[data-x="${col}"][data-y="${row}"]`,
  );
  if (!cell || cell.querySelector('input, textarea, [contenteditable="true"]')) return;
  if (typeof value === 'string' && value.trimStart().startsWith('=')) {
    const result = evaluateFormula(value, data, col, row);
    cell.textContent = result === undefined ? value : formatFormulaResult(result);
    return;
  }
  cell.textContent = String(value ?? '');
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
      if (result !== undefined) displayData[rowIndex][colIndex] = formatFormulaResult(result);
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

/**
 * jspreadsheet recreates its coordinate colgroup with a hard-coded 50 px
 * gutter whenever a worksheet is mounted. Apply the user's dimensions to the
 * layout elements themselves so row/column changes cannot reset them.
 */
function applyCoordinateHeaderDimensions(
  container: HTMLElement,
  appearance: SpreadsheetAppearance,
): void {
  const rowIndexWidth = `${appearance.rowIndexWidth}px`;
  const columnIndexHeight = `${appearance.columnIndexHeight}px`;

  container.querySelectorAll<HTMLTableColElement>(
    '.jss_worksheet > colgroup > col:first-child',
  ).forEach(col => {
    col.setAttribute('width', String(appearance.rowIndexWidth));
    col.style.width = rowIndexWidth;
    col.style.minWidth = rowIndexWidth;
    col.style.maxWidth = rowIndexWidth;
  });

  container.querySelectorAll<HTMLElement>('.jss_worksheet .jss_row, .jss_worksheet .jss_selectall')
    .forEach(cell => {
      cell.style.width = rowIndexWidth;
      cell.style.minWidth = rowIndexWidth;
      cell.style.maxWidth = rowIndexWidth;
    });

  container.querySelectorAll<HTMLElement>('.jss_worksheet .jss_selectall').forEach(selectAll => {
    const headerRow = selectAll.parentElement;
    if (!headerRow) return;
    headerRow.style.height = columnIndexHeight;
    headerRow.style.minHeight = columnIndexHeight;
    headerRow.style.maxHeight = columnIndexHeight;
    Array.from(headerRow.children).forEach(cell => {
      if (!(cell instanceof HTMLElement)) return;
      cell.style.height = columnIndexHeight;
      cell.style.minHeight = columnIndexHeight;
      cell.style.maxHeight = columnIndexHeight;
    });
  });
}

/**
 * jspreadsheet's own coordinate header (column letters, row numbers, the
 * corner cell) renders with its default skin -- none of the saved
 * appearance's header border/padding/font settings that
 * getCoordinateStyleAttribute() bakes into the static HTML's <th> cells.
 * Applies the same declarations here via setProperty() (not
 * setAttribute('style', ...), which would wipe out the width/height
 * declarations applyCoordinateHeaderDimensions() sets, regardless of call
 * order) so a read-only grid's header actually matches.
 */
function applyCoordinateHeaderStyle(container: HTMLElement, appearance: SpreadsheetAppearance): void {
  const declarations = getAppearanceCellStyle(appearance, 0, 0, false)
    .split(';')
    .map(declaration => declaration.split(':'))
    .filter((pair): pair is [string, string] => pair.length === 2 && pair[0].trim() !== '');
  container.querySelectorAll<HTMLElement>(
    '.jss_worksheet > thead > tr > *, .jss_worksheet .jss_row',
  ).forEach(cell => {
    declarations.forEach(([property, value]) => cell.style.setProperty(property.trim(), value.trim()));
  });
}

/**
 * Read each data row's *currently rendered* height straight from the DOM,
 * keyed by its current position -- the source-of-truth counterpart to
 * applySpreadsheetRowHeights() just below (that one pushes stored sizes
 * into the DOM; this one pulls the DOM's own sizes back out). Needed
 * anywhere a remount or an insert/delete is about to happen: stored
 * RowHeights/ColWidths are keyed by index, but inserting or deleting a row
 * shifts every later row's *position* without ever renumbering those
 * stored keys, and a resize the user just made via jspreadsheet's own
 * native drag handles may not have reached the stored data at all yet.
 * Reading directly from the DOM -- which jspreadsheet itself always keeps
 * correctly positioned -- sidesteps both problems at once instead of
 * needing each caller to reindex stored keys by hand.
 */
function readRenderedRowHeights(container: HTMLElement): RowHeights | undefined {
  const rowHeights: RowHeights = {};
  container.querySelectorAll<HTMLTableRowElement>('.jss_worksheet > tbody > tr')
    .forEach((row, rowIndex) => {
      const height = Number.parseFloat(row.style.height || row.getAttribute('height') || '');
      if (!Number.isFinite(height)) return;
      rowHeights[String(rowIndex)] = Math.max(
        MIN_DATA_ROW_HEIGHT,
        Math.min(MAX_DATA_ROW_HEIGHT, Math.round(height)),
      );
    });
  return Object.keys(rowHeights).length > 0 ? rowHeights : undefined;
}

/** Column-width counterpart of readRenderedRowHeights() just above. */
function readRenderedColWidths(container: HTMLElement): ColWidths | undefined {
  const dataCols = Array.from(
    container.querySelectorAll<HTMLTableColElement>('.jss_worksheet > colgroup > col'),
  ).slice(1);
  const colWidths: ColWidths = {};
  dataCols.forEach((col, colIndex) => {
    const width = Number.parseFloat(col.style.width || col.getAttribute('width') || '');
    if (!Number.isFinite(width)) return;
    colWidths[String(colIndex)] = Math.max(
      MIN_DATA_COL_WIDTH,
      Math.min(MAX_DATA_COL_WIDTH, Math.round(width)),
    );
  });
  return Object.keys(colWidths).length > 0 ? colWidths : undefined;
}

// Measures how wide a cell's own text actually is (canvas-based, so it
// doesn't depend on the cell's current layout at all) -- shared by
// openSpreadsheetModal's and buildReadOnlySpreadsheetHost's own double-
// click-a-column-border-to-autofit gesture, matching Excel/Sheets.
function measureNaturalCellWidth(cell: HTMLElement): number {
  const computedStyle = window.getComputedStyle(cell);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return cell.scrollWidth;
  context.font = [
    computedStyle.fontStyle,
    computedStyle.fontVariant,
    computedStyle.fontWeight,
    computedStyle.fontSize,
    computedStyle.fontFamily,
  ].join(' ');
  const textWidth = (cell.textContent ?? '')
    .split(/\r?\n/)
    .reduce((maximum, line) => Math.max(maximum, context.measureText(line).width), 0);
  const horizontalChrome = Number.parseFloat(computedStyle.paddingLeft)
    + Number.parseFloat(computedStyle.paddingRight)
    + Number.parseFloat(computedStyle.borderLeftWidth)
    + Number.parseFloat(computedStyle.borderRightWidth);
  // A little breathing room keeps the fitted value from touching the
  // resize handle and accommodates the header's own sort/menu affordance.
  return Math.ceil(textWidth + horizontalChrome + 12);
}

// Row-height equivalent of measureNaturalCellWidth() above: an offscreen
// probe laid out at the cell's own current width, since text height
// depends on where it wraps.
function measureNaturalCellHeight(cell: HTMLElement): number {
  const computedStyle = window.getComputedStyle(cell);
  const probe = document.createElement('div');
  probe.textContent = cell.textContent ?? '';
  Object.assign(probe.style, {
    position: 'fixed',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: '-10000px',
    top: '0',
    boxSizing: 'border-box',
    width: `${cell.getBoundingClientRect().width}px`,
    height: 'auto',
    minHeight: '0',
    padding: computedStyle.padding,
    border: computedStyle.border,
    font: computedStyle.font,
    lineHeight: computedStyle.lineHeight,
    letterSpacing: computedStyle.letterSpacing,
    whiteSpace: computedStyle.whiteSpace,
    overflowWrap: computedStyle.overflowWrap,
    wordBreak: computedStyle.wordBreak,
  });
  document.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.ceil(height);
}

/** Reapply saved data-row heights after jspreadsheet rebuilds its worksheet DOM. */
function applySpreadsheetRowHeights(
  container: HTMLElement,
  worksheet: JssInstance,
  rowHeights: RowHeights | undefined,
): void {
  if (!rowHeights) return;
  const bodyRows = Array.from(
    container.querySelectorAll<HTMLElement>('.jss_worksheet > tbody > tr'),
  );
  Object.entries(rowHeights).forEach(([rowKey, height]) => {
    const row = Number.parseInt(rowKey, 10);
    if (!Number.isInteger(row) || !Number.isFinite(height)) return;
    // Deliberately DOM-only: worksheet.setHeight() also pushes an undo-
    // history entry and dispatches onresizerow every time it runs, and this
    // function gets called repeatedly (mount, every hydration retry) purely
    // to *restore* a size, not to record a fresh user action. Going through
    // the stateful API there was disrupting jspreadsheet's own resize-drag
    // handling later -- writing the height directly leaves its internal
    // state untouched.
    if (bodyRows[row]) bodyRows[row].style.height = `${height}px`;
  });
}

/**
 * Reapply saved data-column widths after jspreadsheet rebuilds its worksheet
 * DOM -- the column-width equivalent of applySpreadsheetRowHeights() just
 * above. jspreadsheet renders its own <colgroup><col> inside .jss_worksheet;
 * the first <col> there is the row-index gutter (sized separately by
 * applyCoordinateHeaderDimensions()), so data columns start at index 1.
 */
function applySpreadsheetColWidths(
  container: HTMLElement,
  worksheet: JssInstance,
  colWidths: ColWidths | undefined,
): void {
  if (!colWidths) return;
  const dataCols = Array.from(
    container.querySelectorAll<HTMLTableColElement>('.jss_worksheet > colgroup > col'),
  ).slice(1);
  Object.entries(colWidths).forEach(([colKey, width]) => {
    const col = Number.parseInt(colKey, 10);
    if (!Number.isInteger(col) || !Number.isFinite(width)) return;
    const colElement = dataCols[col];
    if (!colElement) return;
    // Attribute-ONLY, deliberately no style.width. jspreadsheet-ce's own
    // setWidth() (used by the real mouse-drag) only ever does
    // colElement.setAttribute("width", ...) -- it never touches style.width.
    // A CSS width always wins over the legacy HTML width attribute for
    // rendering, so setting style.width here (as earlier versions of this
    // function did) permanently froze the column at that pixel size: every
    // later attribute-only update from a genuine user drag kept landing on
    // the DOM, but the browser kept rendering the stale CSS value forever,
    // making the drag look like it silently did nothing. No worksheet.
    // setWidth() call either -- that API also pushes an undo-history entry
    // and dispatches onresizecolumn every time it runs, and this function
    // is invoked repeatedly (mount, every hydration retry) purely to
    // *restore* a previously-saved size, not to record a fresh user action.
    colElement.setAttribute('width', String(width));
  });
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

// onIconClick is only passed for color swatches: clicking the swatch itself
// still opens the native color picker (the <label>'s default behavior for
// its wrapped <input>), but clicking the icon re-applies whatever color is
// already selected instead of also opening that picker -- preventDefault/
// stopPropagation here is what stops the label from forwarding the click
// to the input the way it normally would.
function createIconControl(
  icon: string,
  labelText: string,
  control: HTMLElement,
  onIconClick?: (event: MouseEvent) => void,
): HTMLLabelElement {
  const label = createLabeledControl('', control);
  label.classList.add('inline-spreadsheet-compact-control');
  label.title = labelText;
  if (onIconClick) {
    const iconButton = document.createElement('button');
    iconButton.type = 'button';
    iconButton.className = 'inline-spreadsheet-control-icon inline-spreadsheet-control-icon-button';
    iconButton.innerHTML = icon;
    iconButton.setAttribute('aria-label', labelText);
    iconButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onIconClick(event);
    });
    label.prepend(iconButton);
  } else {
    const iconElement = document.createElement('span');
    iconElement.className = 'inline-spreadsheet-control-icon';
    iconElement.innerHTML = icon;
    iconElement.setAttribute('aria-hidden', 'true');
    label.prepend(iconElement);
  }
  return label;
}

function createStepperControl(
  input: HTMLInputElement,
  labelText: string,
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'inline-spreadsheet-stepper';
  group.title = labelText;
  const decrease = document.createElement('button');
  decrease.type = 'button';
  decrease.className = 'inline-spreadsheet-icon-button';
  decrease.textContent = '−';
  decrease.setAttribute('aria-label', `Decrease ${labelText}`);
  const increase = document.createElement('button');
  increase.type = 'button';
  increase.className = 'inline-spreadsheet-icon-button';
  increase.textContent = '+';
  increase.setAttribute('aria-label', `Increase ${labelText}`);
  const step = (direction: number): void => {
    if (direction > 0) {
      input.stepUp();
    } else {
      input.stepDown();
    }
    input.dispatchEvent(new Event('change'));
  };
  decrease.addEventListener('click', () => step(-1));
  increase.addEventListener('click', () => step(1));
  group.append(decrease, input, increase);
  return group;
}

function createOverlay(initial: SpreadsheetData, isEditing: boolean): {
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
  formulaFunctionSelect: HTMLSelectElement;
  formulaCellLabel: HTMLSpanElement;
  formulaInput: HTMLInputElement;
  formulaStatus: HTMLSpanElement;
  formulaBar: HTMLDivElement;
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
  rowIndexWidthInput: HTMLInputElement;
  columnIndexHeightInput: HTMLInputElement;
  appearanceScopeSelect: HTMLSelectElement;
  applyAppearanceBtn: HTMLButtonElement;
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
  rowHeightInput: HTMLInputElement;
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
  title.textContent = isEditing ? 'Edit spreadsheet' : 'Insert spreadsheet';
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
  resizeBtn.innerHTML = '<i class="fas fa-expand-arrows-alt" aria-hidden="true"></i>';
  resizeBtn.title = 'Apply row and column count';
  resizeBtn.setAttribute('aria-label', 'Apply row and column count');
  resizeBtn.className = 'btn btn-sm btn-outline-secondary';

  const rowsControl = createLabeledControl('Rows', rowsInput);
  rowsControl.classList.add('inline-spreadsheet-size-control');
  const colsControl = createLabeledControl('Columns', colsInput);
  colsControl.classList.add('inline-spreadsheet-size-control');

  const sizeButtons = document.createElement('div');
  sizeButtons.className = 'inline-spreadsheet-size-actions';
  const addRowBtn = document.createElement('button');
  addRowBtn.type = 'button';
  addRowBtn.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> <i class="fas fa-grip-lines" aria-hidden="true"></i>';
  addRowBtn.title = 'Add one row at the bottom';
  addRowBtn.className = 'btn btn-sm btn-outline-secondary';
  const addColBtn = document.createElement('button');
  addColBtn.type = 'button';
  addColBtn.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> <i class="fas fa-columns" aria-hidden="true"></i>';
  addColBtn.title = 'Add one column on the right';
  addColBtn.className = 'btn btn-sm btn-outline-secondary';
  sizeButtons.appendChild(resizeBtn);

  settings.append(presetSelect, rowsControl, colsControl, sizeButtons, captionInput);
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
  const rowIndexWidthInput = createInput(
    'number',
    String(appearance.rowIndexWidth),
    'Width of the row-number or row-letter index column',
  );
  rowIndexWidthInput.min = String(MIN_ROW_INDEX_WIDTH);
  rowIndexWidthInput.max = String(MAX_ROW_INDEX_WIDTH);
  const columnIndexHeightInput = createInput(
    'number',
    String(appearance.columnIndexHeight),
    'Height of the column-letter or column-number index row',
  );
  columnIndexHeightInput.min = String(MIN_COLUMN_INDEX_HEIGHT);
  columnIndexHeightInput.max = String(MAX_COLUMN_INDEX_HEIGHT);
  tableAppearanceGrid.append(
    createIconControl('<i class="fas fa-arrows-alt-h"></i>', 'Table width (0 is automatic)', tableWidthInput),
    createIconControl('<i class="fas fa-align-center"></i>', 'Table alignment', tableAlignmentSelect),
    createIconControl('<i class="fas fa-border-all"></i>', 'Table border width', tableBorderWidthInput),
    createIconControl('<i class="fas fa-border-style"></i>', 'Table border style', tableBorderStyleSelect),
    createIconControl('<i class="fas fa-square"></i>', 'Table border color', tableBorderColorInput),
    createIconControl('<i class="fas fa-fill-drip"></i>', 'Table background', tableBackgroundColorInput),
    createIconControl('<i class="fas fa-ban"></i>', 'No table background', tableNoBackgroundInput),
    createIconControl('<i class="fas fa-th"></i>', 'Cell spacing', tableCellSpacingInput),
    createIconControl('<i class="fas fa-expand"></i>', 'Cell padding', cellPaddingInput),
    createIconControl('<i class="fas fa-arrows-alt-h"></i>', 'Row index width', rowIndexWidthInput),
    createIconControl('<i class="fas fa-arrows-alt-v"></i>', 'Column index height', columnIndexHeightInput),
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
    createIconControl('<i class="fas fa-border-all"></i>', 'Default cell border width', borderWidthInput),
    createIconControl('<i class="fas fa-square"></i>', 'Default cell border color', borderColorInput),
    createIconControl('<i class="fas fa-border-style"></i>', 'Default cell border style', defaultCellBorderStyleSelect),
    createIconControl(
      '<i class="fas fa-fill-drip"></i>',
      'Default cell color',
      cellColorInput,
      () => cellColorInput.dispatchEvent(new Event('change')),
    ),
    createIconControl('<i class="fas fa-ban"></i>', 'No default cell color', defaultCellNoColorInput),
    createIconControl('<i class="fas fa-grip-lines"></i>', 'Use alternating row color', alternateRowsInput),
    createIconControl('<i class="fas fa-fill-drip"></i>', 'Alternating row color', alternateRowColorInput),
    createIconControl('<i class="fas fa-columns"></i>', 'Use alternating column color', alternateColumnsInput),
    createIconControl('<i class="fas fa-fill-drip"></i>', 'Alternating column color', alternateColumnColorInput),
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
  defaultFontBoldInput.className = 'inline-spreadsheet-icon-toggle';
  defaultFontBoldInput.dataset.icon = 'B';
  const defaultFontItalicInput = document.createElement('input');
  defaultFontItalicInput.type = 'checkbox';
  defaultFontItalicInput.checked = savedCellDefaults?.italic ?? false;
  defaultFontItalicInput.setAttribute('aria-label', 'Italicize cells by default');
  defaultFontItalicInput.className = 'inline-spreadsheet-icon-toggle inline-spreadsheet-icon-italic';
  defaultFontItalicInput.dataset.icon = 'I';
  const defaultFontUnderlineInput = document.createElement('input');
  defaultFontUnderlineInput.type = 'checkbox';
  defaultFontUnderlineInput.checked = savedCellDefaults?.underline ?? false;
  defaultFontUnderlineInput.setAttribute('aria-label', 'Underline cells by default');
  defaultFontUnderlineInput.className = 'inline-spreadsheet-icon-toggle inline-spreadsheet-icon-underline';
  defaultFontUnderlineInput.dataset.icon = 'U';
  const defaultFontTextColorInput = createInput(
    'color',
    savedCellDefaults?.textColor ?? '#212529',
    'Default cell text color',
  );
  const defaultFontNoTextColorInput = document.createElement('input');
  defaultFontNoTextColorInput.type = 'checkbox';
  defaultFontNoTextColorInput.checked = savedCellDefaults?.textColor === null;
  defaultFontNoTextColorInput.setAttribute('aria-label', 'No default cell text color');
  defaultFontNoTextColorInput.className = 'inline-spreadsheet-icon-toggle';
  defaultFontNoTextColorInput.dataset.icon = '∅';
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
  const createAlignmentButtons = (
    select: HTMLSelectElement,
    options: Array<{ value: string; label: string; icon: string }>,
  ): HTMLDivElement => {
    const group = document.createElement('div');
    group.className = 'inline-spreadsheet-alignment-buttons';
    select.classList.add('d-none');
    group.appendChild(select);
    const buttons = options.map(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inline-spreadsheet-icon-button';
      button.title = option.label;
      button.setAttribute('aria-label', option.label);
      button.setAttribute('aria-pressed', String(select.value === option.value));
      button.innerHTML = option.icon;
      button.addEventListener('click', () => {
        select.value = option.value;
        buttons.forEach(candidate => candidate.setAttribute(
          'aria-pressed',
          String(candidate === button),
        ));
        select.dispatchEvent(new Event('change'));
      });
      return button;
    });
    group.append(...buttons);
    return group;
  };
  const defaultHorizontalAlignmentButtons = createAlignmentButtons(defaultFontTextAlignSelect, [
    { value: 'left', label: 'Align left', icon: '<i class="fas fa-align-left" aria-hidden="true"></i>' },
    { value: 'center', label: 'Align center', icon: '<i class="fas fa-align-center" aria-hidden="true"></i>' },
    { value: 'right', label: 'Align right', icon: '<i class="fas fa-align-right" aria-hidden="true"></i>' },
    { value: 'justify', label: 'Justify', icon: '<i class="fas fa-align-justify" aria-hidden="true"></i>' },
  ]);
  const defaultVerticalAlignmentButtons = createAlignmentButtons(defaultFontVerticalAlignSelect, [
    { value: 'top', label: 'Align top', icon: '<i class="fas fa-align-left fa-rotate-90" aria-hidden="true"></i>' },
    { value: 'middle', label: 'Align middle', icon: '<i class="fas fa-align-center fa-rotate-90" aria-hidden="true"></i>' },
    { value: 'bottom', label: 'Align bottom', icon: '<i class="fas fa-align-right fa-rotate-90" aria-hidden="true"></i>' },
  ]);
  fontAppearanceGrid.append(
    createIconControl('<i class="fas fa-font"></i>', 'Default font family', defaultFontFamilySelect),
    createStepperControl(defaultFontSizeInput, 'default font size'),
    // No icon glyph here: the checkbox itself (.inline-spreadsheet-icon-toggle,
    // data-icon="B"/"I"/"U") already renders its own B/I/U via CSS. Passing
    // the same letter as the icon-span's content duplicated it visually --
    // the empty string still gets its own icon-span (createIconControl()
    // always prepends one) purely to keep this row's grid-column alignment
    // consistent with every other row here, matching how the cell-level
    // format toolbar's equivalent controls already do this correctly.
    (() => {
      const boldControl = createIconControl('', 'Bold by default', defaultFontBoldInput);
      boldControl.classList.add('inline-spreadsheet-bold-italic-underline-control', 'ml-2');
      return boldControl;
    })(),
    (() => {
      const italicControl = createIconControl('', 'Italic by default', defaultFontItalicInput);
      italicControl.classList.add('inline-spreadsheet-bold-italic-underline-control');
      return italicControl;
    })(),
    (() => {
      const underlineControl = createIconControl('', 'Underline by default', defaultFontUnderlineInput);
      underlineControl.classList.add('inline-spreadsheet-bold-italic-underline-control');
      return underlineControl;
    })(),
    createIconControl(
      '<span class="inline-spreadsheet-text-color-icon">A</span>',
      'Default text color',
      defaultFontTextColorInput,
      () => defaultFontTextColorInput.dispatchEvent(new Event('change')),
    ),
    createIconControl(
      '<span class="inline-spreadsheet-text-color-icon">A</span>',
      'No default text color',
      defaultFontNoTextColorInput,
    ),
    defaultHorizontalAlignmentButtons,
    defaultVerticalAlignmentButtons,
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
  const applyAppearanceBtn = document.createElement('button');
  applyAppearanceBtn.type = 'button';
  applyAppearanceBtn.className = 'btn btn-sm btn-primary';
  applyAppearanceBtn.textContent = 'Apply appearance';
  applyAppearanceBtn.title = 'Apply all table, cell and font controls to this spreadsheet';
  const saveAppearanceDefaultBtn = document.createElement('button');
  saveAppearanceDefaultBtn.type = 'button';
  saveAppearanceDefaultBtn.className = 'btn btn-sm btn-outline-primary';
  saveAppearanceDefaultBtn.textContent = 'Save everything as default';
  const appearanceStatus = document.createElement('span');
  appearanceStatus.className = 'inline-spreadsheet-appearance-status';
  appearanceStatus.textContent = 'Apply changes to this spreadsheet. Saving makes them the notebook or account default.';
  appearanceDefaults.append(
    applyAppearanceBtn,
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
  const cellFormatColorInput = createInput(
    'color',
    savedCellDefaults?.backgroundColor ?? appearance.cellColor,
    'Selected cell background color',
  );
  const cellFormatNoColorInput = document.createElement('input');
  cellFormatNoColorInput.type = 'checkbox';
  cellFormatNoColorInput.setAttribute('aria-label', 'Remove selected cell background color');
  cellFormatNoColorInput.checked = savedCellDefaults?.backgroundColor === null;
  cellFormatNoColorInput.className = 'inline-spreadsheet-icon-toggle';
  cellFormatNoColorInput.dataset.icon = '∅';
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
  cellStyleRow.append(
    createIconControl(
      '<i class="fas fa-fill-drip"></i>',
      'Cell background color',
      cellFormatColorInput,
      () => cellFormatColorInput.dispatchEvent(new Event('change')),
    ),
    createIconControl('<i class="fas fa-fill-drip"></i>', 'Remove cell background color', cellFormatNoColorInput),
  );

  const fontStyleRow = cellStyleRow;
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
  cellFormatBoldInput.className = 'inline-spreadsheet-icon-toggle';
  cellFormatBoldInput.dataset.icon = 'B';
  const cellFormatItalicInput = document.createElement('input');
  cellFormatItalicInput.type = 'checkbox';
  cellFormatItalicInput.setAttribute('aria-label', 'Italicize selected cells');
  cellFormatItalicInput.checked = savedCellDefaults?.italic ?? false;
  cellFormatItalicInput.className = 'inline-spreadsheet-icon-toggle inline-spreadsheet-icon-italic';
  cellFormatItalicInput.dataset.icon = 'I';
  const cellFormatUnderlineInput = document.createElement('input');
  cellFormatUnderlineInput.type = 'checkbox';
  cellFormatUnderlineInput.setAttribute('aria-label', 'Underline selected cells');
  cellFormatUnderlineInput.checked = savedCellDefaults?.underline ?? false;
  cellFormatUnderlineInput.className = 'inline-spreadsheet-icon-toggle inline-spreadsheet-icon-underline';
  cellFormatUnderlineInput.dataset.icon = 'U';
  const cellFormatTextColorInput = createInput(
    'color',
    savedCellDefaults?.textColor ?? '#212529',
    'Selected cell text color',
  );
  const cellFormatNoTextColorInput = document.createElement('input');
  cellFormatNoTextColorInput.type = 'checkbox';
  cellFormatNoTextColorInput.setAttribute('aria-label', 'Remove selected cell text color');
  cellFormatNoTextColorInput.checked = savedCellDefaults?.textColor === null;
  cellFormatNoTextColorInput.className = 'inline-spreadsheet-icon-toggle';
  cellFormatNoTextColorInput.dataset.icon = '∅';
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
  const horizontalAlignmentButtons = createAlignmentButtons(cellFormatTextAlignSelect, [
    { value: 'left', label: 'Align left', icon: '<i class="fas fa-align-left" aria-hidden="true"></i>' },
    { value: 'center', label: 'Align center', icon: '<i class="fas fa-align-center" aria-hidden="true"></i>' },
    { value: 'right', label: 'Align right', icon: '<i class="fas fa-align-right" aria-hidden="true"></i>' },
    { value: 'justify', label: 'Justify', icon: '<i class="fas fa-align-justify" aria-hidden="true"></i>' },
  ]);
  const rowHeightInput = createInput(
    'number',
    String(MIN_DATA_ROW_HEIGHT),
    'Height of selected rows in pixels',
  );
  rowHeightInput.min = String(MIN_DATA_ROW_HEIGHT);
  rowHeightInput.max = String(MAX_DATA_ROW_HEIGHT);
  fontStyleRow.append(
    createIconControl('<i class="fas fa-font"></i>', 'Font family', cellFormatFontFamilySelect),
    createStepperControl(cellFormatFontSizeInput, 'font size'),
    createLabeledControl('', cellFormatBoldInput),
    createLabeledControl('', cellFormatItalicInput),
    createLabeledControl('', cellFormatUnderlineInput),
    createIconControl(
      '<span class="inline-spreadsheet-text-color-icon">A</span>',
      'Text color',
      cellFormatTextColorInput,
      () => cellFormatTextColorInput.dispatchEvent(new Event('change')),
    ),
    createIconControl(
      '<span class="inline-spreadsheet-text-color-icon">A</span>',
      'Remove text color',
      cellFormatNoTextColorInput,
    ),
    horizontalAlignmentButtons,
  );

  const clearCellFormatBtn = document.createElement('button');
  clearCellFormatBtn.type = 'button';
  clearCellFormatBtn.className = 'btn btn-sm btn-outline-secondary';
  clearCellFormatBtn.innerHTML = '<i class="fas fa-eraser" aria-hidden="true"></i>';
  clearCellFormatBtn.title = 'Clear all formatting from selected cells';
  clearCellFormatBtn.setAttribute('aria-label', 'Clear all formatting from selected cells');
  const autofitAllBtn = document.createElement('button');
  autofitAllBtn.type = 'button';
  autofitAllBtn.className = 'btn btn-sm btn-outline-secondary';
  autofitAllBtn.innerHTML = '<i class="fas fa-expand" aria-hidden="true"></i>';
  autofitAllBtn.title = 'Auto-fit every row and column to its content';
  autofitAllBtn.setAttribute('aria-label', 'Auto-fit every row and column to its content');
  const cellFormatStatus = document.createElement('span');
  cellFormatStatus.className = 'inline-spreadsheet-cell-format-status';
  cellFormatBar.append(
    cellStyleRow,
    clearCellFormatBtn,
    autofitAllBtn,
    cellFormatStatus,
  );
  dialog.appendChild(cellFormatBar);

  const formulaBar = document.createElement('div');
  formulaBar.className = 'inline-spreadsheet-formula-bar';
  const formulaLabel = document.createElement('strong');
  formulaLabel.textContent = 'ƒx';
  formulaLabel.title = 'Formula builder';
  formulaBar.appendChild(formulaLabel);
  const formulaCellLabel = document.createElement('span');
  formulaCellLabel.className = 'inline-spreadsheet-formula-cell';
  formulaCellLabel.textContent = '—';
  formulaCellLabel.title = 'Selected cell';
  const formulaInput = createInput('text', '', 'Selected cell value or formula');
  formulaInput.classList.add('inline-spreadsheet-formula-input');
  formulaInput.disabled = true;
  formulaInput.placeholder = 'Select a cell to view or edit its value/formula';
  formulaInput.spellcheck = false;
  formulaBar.append(formulaCellLabel, formulaInput);
  // Statistical functions grow over time (SUM/AVERAGE/... started at 5, now
  // 7) and read poorly as an ever-longer row of buttons and symbols. A single
  // dropdown scales without adding visual width; the four arithmetic
  // operators stay as buttons since they're compact single glyphs.
  const formulaFunctions = [
    { value: 'SUM', label: '∑ SUM', title: 'Sum the selected cells' },
    { value: 'AVERAGE', label: 'x̄ AVERAGE', title: 'Average the selected cells' },
    { value: 'COUNT', label: '# COUNT', title: 'Count the selected numeric cells' },
    { value: 'MIN', label: 'MIN', title: 'Find the minimum selected value' },
    { value: 'MAX', label: 'MAX', title: 'Find the maximum selected value' },
    { value: 'MEDIAN', label: 'x̃ MEDIAN', title: 'Find the median of the selected cells' },
    { value: 'STDEV', label: 'σ STDEV', title: 'Sample standard deviation of the selected cells' },
  ];
  const formulaFunctionSelect = document.createElement('select');
  formulaFunctionSelect.className = 'form-control form-control-sm inline-spreadsheet-formula-function-select';
  formulaFunctionSelect.setAttribute('aria-label', 'Insert a function applied to the selected cells');
  formulaFunctionSelect.title = 'Insert a function applied to the selected cells';
  const formulaFunctionPlaceholder = document.createElement('option');
  formulaFunctionPlaceholder.value = '';
  formulaFunctionPlaceholder.textContent = 'ƒ Insert function…';
  formulaFunctionSelect.appendChild(formulaFunctionPlaceholder);
  formulaFunctions.forEach(fn => {
    const option = document.createElement('option');
    option.value = fn.value;
    option.textContent = fn.label;
    option.title = fn.title;
    formulaFunctionSelect.appendChild(option);
  });
  formulaBar.appendChild(formulaFunctionSelect);

  const formulaActions = [
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
  formulaBar.appendChild(formulaStatus);
  dialog.appendChild(formulaBar);

  const sheetHost = document.createElement('div');
  sheetHost.className = 'inline-spreadsheet-container';
  // .inline-spreadsheet-container already has resize:both, so the editing
  // area is natively drag-resizable without a dedicated control bar.
  const defaultViewportHeight = Math.max(220, Math.min(1200, Math.round(window.innerHeight * 0.65)));
  sheetHost.style.height = `${defaultViewportHeight}px`;
  dialog.append(sheetHost);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'inline-spreadsheet-actions';
  const gridButtons = document.createElement('div');
  gridButtons.className = 'inline-spreadsheet-grid-actions';
  gridButtons.append(addRowBtn, addColBtn);
  const rightButtons = document.createElement('div');
  rightButtons.className = 'd-flex ml-auto';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'btn btn-sm btn-secondary mr-1';
  const insertBtn = document.createElement('button');
  insertBtn.type = 'button';
  insertBtn.textContent = isEditing ? 'Update' : 'Insert';
  insertBtn.className = 'btn btn-sm btn-primary';
  rightButtons.append(cancelBtn, insertBtn);
  buttonRow.append(gridButtons, rightButtons);
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
    formulaFunctionSelect,
    formulaCellLabel,
    formulaInput,
    formulaStatus,
    formulaBar,
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
    rowIndexWidthInput,
    columnIndexHeightInput,
    appearanceScopeSelect,
    applyAppearanceBtn,
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
    rowHeightInput,
    clearCellFormatBtn,
    autofitAllBtn,
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
    rowIndexWidth: parseInt(ui.rowIndexWidthInput.value, 10),
    columnIndexHeight: parseInt(ui.columnIndexHeightInput.value, 10),
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

function updateQuickStyleProperty(
  existingStyle: string | undefined,
  property: string,
  value: string,
): string | undefined {
  const element = document.createElement('span');
  if (existingStyle) element.setAttribute('style', existingStyle);

  if (value) {
    element.style.setProperty(property, value);
  } else {
    element.style.removeProperty(property);
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
export function openSpreadsheetModal(
  initialData: SpreadsheetData,
  isEditing = false,
): Promise<{ raw: SpreadsheetData; computed: AOA }> {
  return new Promise((resolve, reject) => {
    let working = normalizeSpreadsheetData({
      ...initialData,
      appearance: initialData.appearance ?? getEffectiveAppearanceDefaults(),
    });
    const ui = createOverlay(working, isEditing);
    let sheetContainer: HTMLDivElement | null = null;
    let worksheet: JssInstance = null;
    let hasChanges = false;
    let acceptsGridChanges = false;
    // jspreadsheet's formula engine can replace a raw formula with its
    // calculated value (or #ERROR) in getData(). Keep a separate source of
    // truth so rendering never destroys what the user entered.
    let rawDataMirror = resizeData(working.data, working.rows, working.cols);
    let selectedRange: CellRange | null = null;
    let formulaInputTarget: { col: number; row: number } | null = null;
    let lastCommittedFormulaValue: string | null = null;
    let formulaSelectionDrag: {
      input: HTMLInputElement | HTMLTextAreaElement;
      startRange: CellRange;
      insertionStart: number;
      insertionEnd: number;
      formulaCol: number;
      formulaRow: number;
      allowRange: boolean;
    } | null = null;
    let rowResizePointerActive = false;
    const openerFocus = captureFocus();
    document.body.appendChild(ui.overlay);
    ui.overlay.querySelector('.inline-spreadsheet-dialog')?.addEventListener('input', () => {
      hasChanges = true;
    });
    ui.overlay.querySelector('.inline-spreadsheet-dialog')?.addEventListener('change', () => {
      hasChanges = true;
    });

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

    const captureRenderedRowHeights = (): void => {
      if (!sheetContainer) return;
      const liveRowHeights = readRenderedRowHeights(sheetContainer);
      working = normalizeSpreadsheetData({
        ...working,
        data: readRawData(),
        rowHeights: { ...(working.rowHeights ?? {}), ...(liveRowHeights ?? {}) },
      });
    };

    const onRowResizePointerDown = (event: MouseEvent): void => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('.jss_row[data-y]')
        : null;
      if (!target || !ui.sheetHost.contains(target)) return;
      const bounds = target.getBoundingClientRect();
      const distanceFromBottom = bounds.bottom - event.clientY;
      rowResizePointerActive = distanceFromBottom >= 0 && distanceFromBottom <= 8;
    };

    const onRowResizePointerUp = (): void => {
      if (!rowResizePointerActive) return;
      rowResizePointerActive = false;
      // jspreadsheet finalizes its row DOM on this same mouseup. Read the
      // committed height just after its handler, even if onresizerow was lost.
      window.setTimeout(captureRenderedRowHeights, 0);
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

    const updateSelectionStatus = (range: CellRange, forceSyncFormulaBar = false): void => {
      const startCol = Math.min(range[0], range[2]);
      const startRow = Math.min(range[1], range[3]);
      const endCol = Math.max(range[0], range[2]);
      const endRow = Math.max(range[1], range[3]);
      const cellCount = (endCol - startCol + 1) * (endRow - startRow + 1);
      const rangeLabel = `${colLabel(startCol)}${startRow + 1}:${colLabel(endCol)}${endRow + 1}`;
      ui.cellFormatStatus.textContent = `${rangeLabel} selected (${cellCount} cell${cellCount === 1 ? '' : 's'}).`;
      // Also skip the overwrite below while the formula bar itself has an
      // uncommitted edit, not just during an active formula-reference drag:
      // clicking a different cell while typing an ordinary value there
      // still changes the grid's selected cell (via jspreadsheet's own
      // click handling, never intercepted for that case -- see
      // onFormulaSelectionStart's expectsCellReference check just below,
      // which only claims the click when a cell reference is actually
      // expected), which used to blow away whatever the user was mid-typing
      // by replacing it with the newly-clicked cell's own value. Focus by
      // itself is not enough to suppress the update: mouse selection fires
      // before blur, and treating that brief retained focus as an edit made
      // the first click leave formulaInputTarget on the previous cell.
      // Formula
      // building (expectsCellReference true) is unaffected: that path
      // already sets formulaSelectionDrag before this ever runs.
      // forceSyncFormulaBar overrides this for the one case that genuinely
      // wants the sync to happen despite focus never leaving the formula
      // bar: pressing Enter there to commit and advance to the next row
      // (see that handler) -- by that point the previous cell's value is
      // already committed, so there is nothing left to protect, and the bar
      // should reflect the newly-selected cell same as any other move.
      const formulaBarHasPendingEdit = document.activeElement === ui.formulaInput
        && ui.formulaInput.value !== lastCommittedFormulaValue;
      const selectingForFormulaBar = !forceSyncFormulaBar
        && (formulaSelectionDrag?.input === ui.formulaInput
          || formulaBarHasPendingEdit);
      if (!selectingForFormulaBar) {
        ui.formulaCellLabel.textContent = cellCount === 1
          ? `${colLabel(startCol)}${startRow + 1}`
          : rangeLabel;
        if (cellCount === 1) {
          formulaInputTarget = { col: startCol, row: startRow };
          ui.formulaInput.value = String(readRawData()[startRow]?.[startCol] ?? '');
          lastCommittedFormulaValue = ui.formulaInput.value;
          ui.formulaInput.disabled = false;
        } else {
          formulaInputTarget = null;
          ui.formulaInput.value = '';
          lastCommittedFormulaValue = null;
          ui.formulaInput.disabled = true;
          ui.formulaInput.placeholder = 'Select one cell to edit its value or formula';
        }
      }
      const selectedRowHeights = new Set<number>();
      for (let row = startRow; row <= endRow; row++) {
        selectedRowHeights.add(working.rowHeights?.[String(row)] ?? MIN_DATA_ROW_HEIGHT);
      }
      if (selectedRowHeights.size === 1) {
        ui.rowHeightInput.value = String([...selectedRowHeights][0]);
      }
      // Context-sensitive formula toolbar: arithmetic needs two source cells
      // (applyFormulaAction already refused with a status message otherwise --
      // disabling the buttons up front is the same rule, just visible before
      // the click instead of after), and a statistical function is only
      // meaningful once the selection actually contains a number.
      const selectionData = readRawData();
      let hasNumericCell = false;
      for (let row = startRow; row <= endRow && !hasNumericCell; row++) {
        for (let col = startCol; col <= endCol; col++) {
          const value = selectionData[row]?.[col];
          const isNumeric = typeof value === 'number'
            || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)));
          if (isNumeric) {
            hasNumericCell = true;
            break;
          }
        }
      }
      ui.formulaButtons.forEach(button => {
        button.disabled = cellCount < 2;
      });
      ui.formulaFunctionSelect.disabled = !hasNumericCell;
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
      let input = sheetContainer?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'td.editor[data-x][data-y] > input, td.editor[data-x][data-y] > textarea',
      );
      if (event.target === input) return;
      let formulaCol: number;
      let formulaRow: number;
      if (input) {
        const formulaCell = input.closest<HTMLElement>('td.editor[data-x][data-y]');
        formulaCol = Number.parseInt(formulaCell?.dataset.x ?? '', 10);
        formulaRow = Number.parseInt(formulaCell?.dataset.y ?? '', 10);
      } else if (document.activeElement === ui.formulaInput && formulaInputTarget) {
        input = ui.formulaInput;
        formulaCol = formulaInputTarget.col;
        formulaRow = formulaInputTarget.row;
      } else {
        return;
      }
      if (!Number.isInteger(formulaCol) || !Number.isInteger(formulaRow)) return;
      const startRange = getGridRangeFromTarget(event.target);
      if (!startRange) return;
      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? selectionStart;
      const formulaBeforeCaret = input.value.slice(0, selectionStart).trimStart();
      const expectsCellReference = /^=\s*$/.test(formulaBeforeCaret)
        || /[+\-*/(,;]\s*$/.test(formulaBeforeCaret);
      if (!expectsCellReference) return;
      const allowRange = /(SUM|AVERAGE|COUNT|MIN|MAX)\s*\([^)]*$/i.test(
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

    const onCellEditorKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter'
        || event.isComposing
        || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      const editor = event.target;
      const editedCell = editor.closest<HTMLElement>('td.editor[data-x][data-y]');
      if (!editedCell || typeof worksheet?.closeEditor !== 'function') return;
      const editedCol = Number.parseInt(editedCell.dataset.x ?? '', 10);
      const editedRow = Number.parseInt(editedCell.dataset.y ?? '', 10);
      if (!Number.isInteger(editedCol) || !Number.isInteger(editedRow)) return;
      if (!event.shiftKey && (event.altKey || event.ctrlKey || event.metaKey)) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.shiftKey) {
        const selectionStart = editor.selectionStart ?? editor.value.length;
        const selectionEnd = editor.selectionEnd ?? selectionStart;
        const multilineValue = `${editor.value.slice(0, selectionStart)}\n${editor.value.slice(selectionEnd)}`;
        if (editor instanceof HTMLTextAreaElement) {
          editor.value = multilineValue;
          const nextCaret = selectionStart + 1;
          editor.setSelectionRange(nextCaret, nextCaret);
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }

        // Some jspreadsheet text editors use a single-line input. Commit the
        // line break directly and leave the same cell selected; HTML inputs
        // cannot retain newline characters while they remain open.
        updateRawDataMirrorCell(editedCol, editedRow, multilineValue, false);
        worksheet.closeEditor(editedCell, false);
        worksheet.setValueFromCoords?.(editedCol, editedRow, multilineValue, true);
        updateRawDataMirrorCell(editedCol, editedRow, multilineValue, false);
        selectedRange = [editedCol, editedRow, editedCol, editedRow];
        worksheet.updateSelectionFromCoords?.(...selectedRange);
        scheduleFormulaResultRender();
        return;
      }

      const isFormula = editor.value.trimStart().startsWith('=');
      if (isFormula) {
        const missingParentheses = formulaParenthesisBalance(editor.value);
        if (missingParentheses > 0) editor.value += ')'.repeat(missingParentheses);
      }
      const editedValue = editor.value;
      updateRawDataMirrorCell(editedCol, editedRow, editedValue, false);
      worksheet.closeEditor(editedCell, true);
      const targetRow = Math.min(working.rows - 1, editedRow + 1);
      selectedRange = [editedCol, targetRow, editedCol, targetRow];
      worksheet.updateSelectionFromCoords?.(...selectedRange);
      scheduleFormulaResultRender();

      if (isFormula) {
        const result = evaluateFormula(editedValue, readRawData(), editedCol, editedRow);
        ui.formulaStatus.textContent = result === undefined
          ? `Formula applied in ${colLabel(editedCol)}${editedRow + 1}.`
          : `Formula applied in ${colLabel(editedCol)}${editedRow + 1}: ${result}.`;
      }
    };

    const onColumnBoundaryDoubleClick = (event: MouseEvent): void => {
      if (event.button !== 0 || !sheetContainer) return;
      const header = event.target instanceof Element
        ? event.target.closest<HTMLElement>('.jss_worksheet > thead [data-x]')
        : null;
      if (!header || !sheetContainer.contains(header)) return;
      const headerRect = header.getBoundingClientRect();
      const edgeTolerance = 7;
      const distanceFromLeft = event.clientX - headerRect.left;
      const distanceFromRight = headerRect.right - event.clientX;
      let col = Number.parseInt(header.dataset.x ?? '', 10);
      if (!Number.isInteger(col)) return;
      if (distanceFromLeft <= edgeTolerance) {
        col -= 1;
      } else if (distanceFromRight > edgeTolerance) {
        return;
      }
      if (col < 0 || col >= working.cols) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const cells = Array.from(sheetContainer.querySelectorAll<HTMLElement>(
        `.jss_worksheet > thead [data-x="${col}"], .jss_worksheet > tbody td[data-x="${col}"][data-y]`,
      ));
      const naturalWidth = cells.reduce(
        (maximum, cell) => Math.max(maximum, measureNaturalCellWidth(cell)),
        MIN_DATA_COL_WIDTH,
      );
      const fittedWidth = Math.max(
        MIN_DATA_COL_WIDTH,
        Math.min(MAX_DATA_COL_WIDTH, naturalWidth),
      );
      const colWidths: ColWidths = {
        ...(working.colWidths ?? {}),
        [String(col)]: fittedWidth,
      };
      working = normalizeSpreadsheetData({
        ...working,
        data: readRawData(),
        colWidths,
      });
      worksheet?.setWidth?.(col, fittedWidth);
      applySpreadsheetColWidths(sheetContainer, worksheet, colWidths);
      hasChanges = true;
    };

    const onRowBoundaryDoubleClick = (event: MouseEvent): void => {
      if (event.button !== 0 || !sheetContainer) return;
      const rowHeader = event.target instanceof Element
        ? event.target.closest<HTMLElement>('.jss_worksheet > tbody .jss_row[data-y]')
        : null;
      if (!rowHeader || !sheetContainer.contains(rowHeader)) return;
      const headerRect = rowHeader.getBoundingClientRect();
      const edgeTolerance = 7;
      const distanceFromTop = event.clientY - headerRect.top;
      const distanceFromBottom = headerRect.bottom - event.clientY;
      let row = Number.parseInt(rowHeader.dataset.y ?? '', 10);
      if (!Number.isInteger(row)) return;
      if (distanceFromTop <= edgeTolerance) {
        row -= 1;
      } else if (distanceFromBottom > edgeTolerance) {
        return;
      }
      if (row < 0 || row >= working.rows) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const cells = Array.from(sheetContainer.querySelectorAll<HTMLElement>(
        `.jss_worksheet > tbody td[data-y="${row}"]`,
      ));
      const naturalHeight = cells.reduce(
        (maximum, cell) => Math.max(maximum, measureNaturalCellHeight(cell)),
        MIN_DATA_ROW_HEIGHT,
      );
      const fittedHeight = Math.max(
        MIN_DATA_ROW_HEIGHT,
        Math.min(MAX_DATA_ROW_HEIGHT, Math.ceil(naturalHeight)),
      );
      const rowHeights: RowHeights = {
        ...(working.rowHeights ?? {}),
        [String(row)]: fittedHeight,
      };
      working = normalizeSpreadsheetData({
        ...working,
        data: readRawData(),
        rowHeights,
      });
      worksheet?.setHeight?.(row, fittedHeight);
      applySpreadsheetRowHeights(sheetContainer, worksheet, rowHeights, working.rows);
      hasChanges = true;
    };

    // Same fit-to-content measurement as the per-column/per-row double-click
    // shortcuts above, just applied to every column and row at once. DOM-
    // only (no worksheet.setWidth()/setHeight() calls in the loop) -- with
    // dozens of columns and rows that would mean dozens of separate
    // undo-history entries and resize events for what's really one action;
    // the DOM write alone is enough since jspreadsheet's own resize-drag
    // already reads the width attribute as its source of truth (see
    // applySpreadsheetColWidths()'s comment) and the saved data-spreadsheet
    // blob is read back from the live DOM on close regardless.
    const autofitAllColumnsAndRows = (): void => {
      if (!sheetContainer) return;
      const colWidths: ColWidths = { ...(working.colWidths ?? {}) };
      for (let col = 0; col < working.cols; col++) {
        const cells = Array.from(sheetContainer.querySelectorAll<HTMLElement>(
          `.jss_worksheet > thead [data-x="${col}"], .jss_worksheet > tbody td[data-x="${col}"][data-y]`,
        ));
        const naturalWidth = cells.reduce(
          (maximum, cell) => Math.max(maximum, measureNaturalCellWidth(cell)),
          MIN_DATA_COL_WIDTH,
        );
        colWidths[String(col)] = Math.max(MIN_DATA_COL_WIDTH, Math.min(MAX_DATA_COL_WIDTH, naturalWidth));
      }
      const rowHeights: RowHeights = { ...(working.rowHeights ?? {}) };
      for (let row = 0; row < working.rows; row++) {
        const cells = Array.from(sheetContainer.querySelectorAll<HTMLElement>(
          `.jss_worksheet > tbody td[data-y="${row}"]`,
        ));
        const naturalHeight = cells.reduce(
          (maximum, cell) => Math.max(maximum, measureNaturalCellHeight(cell)),
          MIN_DATA_ROW_HEIGHT,
        );
        rowHeights[String(row)] = Math.max(MIN_DATA_ROW_HEIGHT, Math.min(MAX_DATA_ROW_HEIGHT, Math.ceil(naturalHeight)));
      }
      working = normalizeSpreadsheetData({
        ...working,
        data: readRawData(),
        colWidths,
        rowHeights,
      });
      applySpreadsheetColWidths(sheetContainer, worksheet, colWidths);
      applySpreadsheetRowHeights(sheetContainer, worksheet, rowHeights, working.rows);
      hasChanges = true;
    };
    ui.autofitAllBtn.addEventListener('click', autofitAllColumnsAndRows);

    ui.sheetHost.addEventListener('mousedown', onFormulaSelectionStart, true);
    ui.sheetHost.addEventListener('keydown', onCellEditorKeydown, true);
    ui.sheetHost.addEventListener('dblclick', onColumnBoundaryDoubleClick, true);
    ui.sheetHost.addEventListener('dblclick', onRowBoundaryDoubleClick, true);

    const updateSizeControls = (rows: number, cols: number): void => {
      ui.rowsInput.value = String(rows);
      ui.colsInput.value = String(cols);
      const customOption = ui.presetSelect.querySelector<HTMLOptionElement>(
        'option[value="custom"]',
      );
      if (customOption) customOption.textContent = `Custom spreadsheet (${rows} × ${cols})`;
    };

    const mountSpreadsheet = (spreadsheet: SpreadsheetData): void => {
      if (sheetContainer) {
        // Every caller here (applying a font/fill/alignment change, table
        // appearance, dimensions, undo, ...) destroys and recreates the
        // whole jspreadsheet instance, passing only the fields it actually
        // means to change spread over the previous `working` -- but a
        // manual row/column resize the user just made via jspreadsheet's
        // own native drag handles doesn't necessarily reach `working` (see
        // onresizerow/onresizecolumn) before some *other* action triggers a
        // remount first, and the caller's own spread would otherwise
        // silently revert it back to whatever `working` had before that
        // drag. Reading current sizes straight from the about-to-be-
        // destroyed DOM -- the one place they're always still correct --
        // and folding them in here, once, covers every remount trigger
        // instead of each one needing its own resync.
        const liveRowHeights = readRenderedRowHeights(sheetContainer);
        const liveColWidths = readRenderedColWidths(sheetContainer);
        if (liveRowHeights || liveColWidths) {
          spreadsheet = {
            ...spreadsheet,
            rowHeights: { ...(spreadsheet.rowHeights ?? {}), ...(liveRowHeights ?? {}) },
            colWidths: { ...(spreadsheet.colWidths ?? {}), ...(liveColWidths ?? {}) },
          };
        }
        const destroy = (jspreadsheet as unknown as { destroy?: (element: HTMLElement) => void }).destroy;
        destroy?.(sheetContainer);
      }
      ui.sheetHost.replaceChildren();
      sheetContainer = document.createElement('div');
      ui.sheetHost.appendChild(sheetContainer);
      working = normalizeSpreadsheetData(spreadsheet);
      const mountedAppearance = normalizeAppearance(working.appearance);
      ui.sheetHost.style.setProperty(
        '--spreadsheet-row-index-width',
        `${mountedAppearance.rowIndexWidth}px`,
      );
      ui.sheetHost.style.setProperty(
        '--spreadsheet-column-index-height',
        `${mountedAppearance.columnIndexHeight}px`,
      );
      ui.sheetHost.setAttribute(
        'style',
        `${ui.sheetHost.getAttribute('style') ?? ''};${getAppearanceTableStyle(mountedAppearance)};max-width:100%`,
      );
      const mountedContainer = sheetContainer;
      const mountedRows = working.rows;
      const mountedCols = working.cols;
      const initialRowHeights = normalizeRowHeights(working.rowHeights, mountedRows);
      const initialColWidths = normalizeColWidths(working.colWidths, mountedCols);
      const mountedData = resizeData(working.data, mountedRows, mountedCols);
      rawDataMirror = resizeData(mountedData, mountedRows, mountedCols);
      const mountedStyles = mergeCellStyles(
        working.cellStyles,
        normalizeAppearance(working.appearance),
        mountedRows,
        mountedCols,
      );
      const enforceCoordinateDimensions = (): void => {
        if (sheetContainer !== mountedContainer) return;
        applyCoordinateHeaderDimensions(mountedContainer, mountedAppearance);
        applySpreadsheetRowHeights(
          mountedContainer,
          worksheet,
          normalizeRowHeights(working.rowHeights, mountedRows),
        );
        applySpreadsheetColWidths(
          mountedContainer,
          worksheet,
          normalizeColWidths(working.colWidths, mountedCols),
        );
      };
      const scheduleCoordinateDimensionEnforcement = (): void => {
        enforceCoordinateDimensions();
        window.requestAnimationFrame(enforceCoordinateDimensions);
        window.setTimeout(enforceCoordinateDimensions, 50);
      };
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
        scheduleCoordinateDimensionEnforcement();

        // An open native cell editor is definitive proof that the popup
        // worksheet finished mounting. Keep this sticky: once the user has
        // started editing, the representative saved-cell comparison below
        // can legitimately differ from mountedData. Treating that edit as
        // failed hydration made the retry loop call setData(oldData), which
        // removed the input as its text approached the column width and
        // restored the previous value. This is the popup counterpart of the
        // same guard used by buildReadOnlySpreadsheetHost().
        if (mountedContainer.querySelector(
          'td.editor input, td.editor textarea, td.editor [contenteditable="true"]',
        )) {
          hydrationComplete = true;
        }

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
      const syncMountedDimensions = (changedWorksheet?: JssInstance): void => {
        window.setTimeout(() => {
          if (sheetContainer !== mountedContainer) return;
          const currentWorksheet = getMountedWorksheet(mountedContainer, changedWorksheet);
          const currentData = currentWorksheet?.getData?.();
          if (!Array.isArray(currentData) || currentData.length === 0) return;
          const rows = clampDimension(currentData.length, mountedRows);
          const cols = clampDimension(
            currentData.reduce((maximum, row) => Math.max(maximum, row?.length ?? 0), 0),
            mountedCols,
          );
          worksheet = currentWorksheet;
          rawDataMirror = resizeData(currentData, rows, cols);
          const changedPlateSize = working.kind === 'well-plate'
            && (rows !== mountedRows || cols !== mountedCols);
          // Re-read sizes from the live DOM rather than trusting
          // working.rowHeights/colWidths's still-old-index-keyed values:
          // jspreadsheet has already correctly shifted every row/column
          // past the insertion/deletion point in its own DOM by the time
          // this callback runs, but the *stored* keys were never
          // renumbered to match. Reusing the stale, now-misaligned values
          // here would make scheduleCoordinateDimensionEnforcement() below
          // reapply what used to be row/column N's size onto whatever
          // row/column now sits at that same index -- visibly resizing
          // pre-existing rows/columns that were never touched.
          const liveRowHeights = readRenderedRowHeights(mountedContainer);
          const liveColWidths = readRenderedColWidths(mountedContainer);
          working = normalizeSpreadsheetData({
            ...working,
            data: rawDataMirror,
            rows,
            cols,
            kind: changedPlateSize ? 'standard' : working.kind,
            plateSize: changedPlateSize ? undefined : working.plateSize,
            cellStyles: readCellStyles(rows, cols),
            rowHeights: liveRowHeights ?? working.rowHeights,
            colWidths: liveColWidths ?? working.colWidths,
          });
          if (changedPlateSize) ui.presetSelect.value = 'custom';
          updateSizeControls(rows, cols);
          scheduleCoordinateDimensionEnforcement();
          scheduleFormulaResultRender();
        }, 0);
      };
      const instance = (jspreadsheet as unknown as JssFactory)(sheetContainer, {
        worksheets: [{
          data: mountedData,
          minDimensions: [mountedCols, mountedRows],
          rows: initialRowHeights
            ? Array.from({ length: mountedRows }, (_, row) => (
              initialRowHeights[String(row)]
                ? { height: initialRowHeights[String(row)] }
                : {}
            ))
            : undefined,
          columns: initialColWidths
            ? Array.from({ length: mountedCols }, (_, col) => (
              initialColWidths[String(col)]
                ? { width: initialColWidths[String(col)] }
                : {}
            ))
            : undefined,
          style: mountedStyles,
          tableOverflow: true,
          tableWidth: '100%',
          tableHeight: '100%',
          allowInsertRow: true,
          allowInsertColumn: true,
          allowDeleteRow: true,
          allowDeleteColumn: true,
          rowResize: true,
          columnSorting: false,
          selectionCopy: true,
          allowUndo: true,
        }],
        // Aggregate formulas are evaluated and painted by this module. Let
        // jspreadsheet retain the raw `=SUM(...)` text without executing its
        // formula engine: in v5 that parser can abort worksheet hydration when
        // a saved grid containing a formula is reopened.
        parseFormulas: false,
        onload: (spreadsheet: JssInstance): void => {
          bindAndHydrateWorksheet(spreadsheet?.worksheets ?? spreadsheet);
          window.requestAnimationFrame(() => { acceptsGridChanges = true; });
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
          if (acceptsGridChanges) hasChanges = true;
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
        oninsertrow: (changedWorksheet: JssInstance): void => {
          if (acceptsGridChanges) hasChanges = true;
          syncMountedDimensions(changedWorksheet);
        },
        oninsertcolumn: (changedWorksheet: JssInstance): void => {
          if (acceptsGridChanges) hasChanges = true;
          syncMountedDimensions(changedWorksheet);
        },
        ondeleterow: (changedWorksheet: JssInstance): void => {
          if (acceptsGridChanges) hasChanges = true;
          syncMountedDimensions(changedWorksheet);
        },
        ondeletecolumn: (changedWorksheet: JssInstance): void => {
          if (acceptsGridChanges) hasChanges = true;
          syncMountedDimensions(changedWorksheet);
        },
        onpaste: (changedWorksheet: JssInstance): void => {
          syncMountedDimensions(changedWorksheet);
        },
        onresizerow: (
          changedWorksheet: JssInstance,
          row: number | number[],
          height: number | number[],
        ): void => {
          const changedRows = Array.isArray(row) ? row : [row];
          const changedHeights = Array.isArray(height) ? height : [height];
          const rowHeights: RowHeights = { ...(working.rowHeights ?? {}) };
          changedRows.forEach((changedRow, index) => {
            const safeRow = Number(changedRow);
            const rawHeight = changedHeights[index] ?? changedHeights[0];
            const safeHeight = Math.max(
              MIN_DATA_ROW_HEIGHT,
              Math.min(MAX_DATA_ROW_HEIGHT, Math.round(Number(rawHeight))),
            );
            if (!Number.isInteger(safeRow)
              || safeRow < 0
              || safeRow >= working.rows
              || !Number.isFinite(safeHeight)
            ) {
              return;
            }
            rowHeights[String(safeRow)] = safeHeight;
          });
          worksheet = changedWorksheet;
          working = normalizeSpreadsheetData({
            ...working,
            data: readRawData(),
            rowHeights,
          });
        },
        // Column-width counterpart of onresizerow just above -- captures a
        // user's drag-resize of a data column (jspreadsheet's own native
        // resize handles already do this visually; nothing previously
        // persisted the result) into working.colWidths, the same shape
        // saveSpreadsheet() later encodes into the exported table's
        // colgroup (see getColGroupHtml()).
        onresizecolumn: (
          changedWorksheet: JssInstance,
          column: number | number[],
          width: number | number[],
        ): void => {
          const changedCols = Array.isArray(column) ? column : [column];
          const changedWidths = Array.isArray(width) ? width : [width];
          const colWidths: ColWidths = { ...(working.colWidths ?? {}) };
          changedCols.forEach((changedCol, index) => {
            const safeCol = Number(changedCol);
            const rawWidth = changedWidths[index] ?? changedWidths[0];
            const safeWidth = Math.max(
              MIN_DATA_COL_WIDTH,
              Math.min(MAX_DATA_COL_WIDTH, Math.round(Number(rawWidth))),
            );
            if (!Number.isInteger(safeCol)
              || safeCol < 0
              || safeCol >= working.cols
              || !Number.isFinite(safeWidth)
            ) {
              return;
            }
            colWidths[String(safeCol)] = safeWidth;
          });
          worksheet = changedWorksheet;
          working = normalizeSpreadsheetData({
            ...working,
            data: readRawData(),
            colWidths,
          });
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
      scheduleCoordinateDimensionEnforcement();
      updateSizeControls(working.rows, working.cols);
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

    const onSpreadsheetCopy = (event: ClipboardEvent): void => {
      if (!event.clipboardData
        || event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const selection = getSelectedRange();
      if (!selection) return;
      const startCol = Math.min(selection[0], selection[2]);
      const startRow = Math.min(selection[1], selection[3]);
      const endCol = Math.max(selection[0], selection[2]);
      const endRow = Math.max(selection[1], selection[3]);
      const rawData = readRawData();
      const appearance = normalizeAppearance(working.appearance);
      const copiedStyles = mergeCellStyles(
        readCellStyles(working.rows, working.cols),
        appearance,
        working.rows,
        working.cols,
      );
      const textRows: string[] = [];
      const htmlRows: string[] = [];
      const escapeTsv = (value: CellValue): string => {
        const text = String(value ?? '');
        return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      };
      for (let row = startRow; row <= endRow; row++) {
        const textCells: string[] = [];
        const htmlCells: string[] = [];
        for (let col = startCol; col <= endCol; col++) {
          const value = rawData[row]?.[col] ?? '';
          const style = copiedStyles[`${colLabel(col)}${row + 1}`];
          textCells.push(escapeTsv(value));
          htmlCells.push(
            `<td${style ? ` style="${escapeHTMLAttribute(style)}"` : ''}>${escapeHTML(String(value ?? ''))}</td>`,
          );
        }
        textRows.push(textCells.join('\t'));
        const copiedHeight = working.rowHeights?.[String(row)];
        htmlRows.push(
          `<tr${Number.isFinite(copiedHeight) ? ` style="height:${copiedHeight}px"` : ''}>${htmlCells.join('')}</tr>`,
        );
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      event.clipboardData.setData('text/plain', textRows.join('\n'));
      event.clipboardData.setData('text/html', `<table><tbody>${htmlRows.join('')}</tbody></table>`);
    };

    const onSpreadsheetPaste = (event: ClipboardEvent): void => {
      const clipboard = event.clipboardData;
      // jspreadsheet performs in-cell editing through an input/textarea. Do
      // not bypass structured clipboard handling for that active editor or a
      // copied Excel/HTML/TSV range is inserted into one cell as plain text.
      // Unstructured single-cell text still falls through to jspreadsheet.
      if (!clipboard) return;
      const plainText = clipboard.getData('text/plain');
      const normalizedPlainText = normalizePdfPrivateUseText(plainText);
      const richClipboardHtml = clipboard.getData('text/html');
      let pasted = spreadsheetFromClipboard(
        richClipboardHtml,
        normalizedPlainText,
      );
      if (!pasted) {
        const flattened = getFlattenedClipboardSuggestion(normalizedPlainText);
        if (!flattened) return;
        const selected = getSelectedRange();
        const selectedWidth = selected
          ? Math.abs(selected[2] - selected[0]) + 1
          : flattened.columns;
        const response = window.prompt(
          `The PDF clipboard contains ${flattened.cells} cells without column boundaries. How many columns should the table have?`,
          String(selectedWidth > 1 ? selectedWidth : flattened.columns),
        );
        if (response === null) return;
        const columns = parseInt(response, 10);
        if (!Number.isInteger(columns) || columns < 2 || columns > MAX_DIMENSION) {
          ui.cellFormatStatus.textContent = `Enter a column count between 2 and ${MAX_DIMENSION}.`;
          event.preventDefault();
          return;
        }
        pasted = spreadsheetFromFlattenedClipboard(
          normalizedPlainText,
          columns,
          richClipboardHtml,
        );
      }
      if (!pasted) return;

      const selection = getSelectedRange();
      const startCol = selection ? Math.min(selection[0], selection[2]) : 0;
      const startRow = selection ? Math.min(selection[1], selection[3]) : 0;
      const rows = Math.min(MAX_DIMENSION, Math.max(working.rows, startRow + pasted.rows));
      const cols = Math.min(MAX_DIMENSION, Math.max(working.cols, startCol + pasted.cols));
      const nextData = resizeData(readRawData(), rows, cols);
      for (let row = 0; row < pasted.rows && startRow + row < rows; row++) {
        for (let col = 0; col < pasted.cols && startCol + col < cols; col++) {
          nextData[startRow + row][startCol + col] = pasted.data[row]?.[col] ?? '';
        }
      }

      const nextStyles = readCellStyles(rows, cols) ?? {};
      Object.entries(pasted.cellStyles ?? {}).forEach(([cellName, style]) => {
        const coordinates = coordinatesFromCellName(cellName);
        if (!coordinates) return;
        const targetCol = startCol + coordinates.col;
        const targetRow = startRow + coordinates.row;
        if (targetCol >= cols || targetRow >= rows) return;
        nextStyles[`${colLabel(targetCol)}${targetRow + 1}`] = style;
      });
      const nextRowHeights: RowHeights = {
        ...(normalizeRowHeights(working.rowHeights, rows) ?? {}),
      };
      Object.entries(pasted.rowHeights ?? {}).forEach(([rowKey, height]) => {
        const sourceRow = Number.parseInt(rowKey, 10);
        const targetRow = startRow + sourceRow;
        if (!Number.isInteger(sourceRow) || targetRow < 0 || targetRow >= rows) return;
        nextRowHeights[String(targetRow)] = height;
      });

      event.preventDefault();
      event.stopImmediatePropagation();
      const changedPlateSize = working.kind === 'well-plate'
        && (rows !== working.rows || cols !== working.cols);
      if (changedPlateSize) ui.presetSelect.value = 'custom';
      selectedRange = [
        startCol,
        startRow,
        Math.min(cols - 1, startCol + pasted.cols - 1),
        Math.min(rows - 1, startRow + pasted.rows - 1),
      ];
      mountSpreadsheet({
        ...working,
        data: nextData,
        rows,
        cols,
        kind: changedPlateSize ? 'standard' : working.kind,
        plateSize: changedPlateSize ? undefined : working.plateSize,
        cellStyles: Object.keys(nextStyles).length > 0 ? nextStyles : undefined,
        rowHeights: Object.keys(nextRowHeights).length > 0 ? nextRowHeights : undefined,
      });
      ui.cellFormatStatus.textContent = pasted.cellStyles
        ? 'Pasted values and cell formatting.'
        : 'Pasted table values.';
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

    const resizeSpreadsheet = (rows: number, cols: number): void => {
      const changedPlateSize = working.kind === 'well-plate'
        && (rows !== working.rows || cols !== working.cols);
      const resized: SpreadsheetData = {
        ...working,
        data: resizeData(readRawData(), rows, cols),
        cellStyles: readCellStyles(rows, cols),
        rows,
        cols,
        kind: ui.presetSelect.value === 'custom' || changedPlateSize
          ? 'standard'
          : working.kind,
        plateSize: ui.presetSelect.value === 'custom' || changedPlateSize
          ? undefined
          : working.plateSize,
      };
      if (changedPlateSize) ui.presetSelect.value = 'custom';
      mountSpreadsheet(resized);
    };

    const applyDimensions = (): void => {
      const rows = clampDimension(parseInt(ui.rowsInput.value, 10), working.rows);
      const cols = clampDimension(parseInt(ui.colsInput.value, 10), working.cols);
      resizeSpreadsheet(rows, cols);
    };

    mountSpreadsheet(working);
    ui.sheetHost.addEventListener('mousedown', onRowResizePointerDown, true);
    document.addEventListener('mouseup', onRowResizePointerUp, true);
    ui.sheetHost.addEventListener('copy', onSpreadsheetCopy, true);
    ui.sheetHost.addEventListener('paste', onSpreadsheetPaste, true);

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
      ui.rowIndexWidthInput,
      ui.columnIndexHeightInput,
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
    ui.applyAppearanceBtn.addEventListener('click', () => {
      const appearance = appearanceFromControls(ui, defaultCellStyleFromControls(ui));
      const updated: SpreadsheetData = {
        ...working,
        data: resizeData(readRawData(), working.rows, working.cols),
        cellStyles: stripCellBackgroundOverrides(readCellStyles()),
        appearance,
      };
      mountSpreadsheet(updated);
      ui.appearanceStatus.textContent = 'Appearance applied to this spreadsheet. Use Insert / Update to save it.';
    });
    ui.saveAppearanceDefaultBtn.addEventListener('click', async () => {
      const appearance = appearanceFromControls(ui, defaultCellStyleFromControls(ui));
      const updated: SpreadsheetData = {
        ...working,
        data: resizeData(readRawData(), working.rows, working.cols),
        cellStyles: stripCellBackgroundOverrides(readCellStyles()),
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
    const applySelectedStyleProperty = (
      property: string,
      value: string,
      successMessage: string,
    ): void => {
      updateSelectedCells(
        style => updateQuickStyleProperty(style, property, value),
        successMessage,
      );
    };
    ui.cellFormatColorInput.addEventListener('change', () => {
      ui.cellFormatNoColorInput.checked = false;
      ui.cellFormatColorInput.disabled = false;
      applySelectedStyleProperty(
        'background-color',
        ui.cellFormatColorInput.value,
        'Applied fill to',
      );
    });
    ui.cellFormatNoColorInput.addEventListener('change', () => {
      ui.cellFormatColorInput.disabled = ui.cellFormatNoColorInput.checked;
      applySelectedStyleProperty(
        'background-color',
        ui.cellFormatNoColorInput.checked ? '' : ui.cellFormatColorInput.value,
        ui.cellFormatNoColorInput.checked ? 'Removed fill from' : 'Applied fill to',
      );
    });
    ui.cellFormatBorderColorInput.addEventListener('change', () => {
      applySelectedStyleProperty(
        'border-color',
        ui.cellFormatBorderColorInput.value,
        'Applied border color to',
      );
    });
    ui.cellFormatBorderStyleSelect.addEventListener('change', () => {
      applySelectedStyleProperty(
        'border-style',
        ui.cellFormatBorderStyleSelect.value,
        'Applied border style to',
      );
    });
    ui.cellFormatBorderWidthInput.addEventListener('change', () => {
      const borderWidth = Math.max(
        0,
        Math.min(MAX_TABLE_BORDER, parseInt(ui.cellFormatBorderWidthInput.value, 10) || 0),
      );
      ui.cellFormatBorderWidthInput.value = String(borderWidth);
      applySelectedStyleProperty('border-width', `${borderWidth}px`, 'Applied border width to');
    });
    ui.cellFormatFontFamilySelect.addEventListener('change', () => {
      applySelectedStyleProperty(
        'font-family',
        ui.cellFormatFontFamilySelect.value,
        'Applied font family to',
      );
    });
    ui.cellFormatFontSizeInput.addEventListener('change', () => {
      const fontSize = Math.max(
        6,
        Math.min(72, parseInt(ui.cellFormatFontSizeInput.value, 10) || 12),
      );
      ui.cellFormatFontSizeInput.value = String(fontSize);
      applySelectedStyleProperty('font-size', `${fontSize}pt`, 'Applied font size to');
    });
    ui.cellFormatBoldInput.addEventListener('change', () => {
      applySelectedStyleProperty(
        'font-weight',
        ui.cellFormatBoldInput.checked ? 'bold' : 'normal',
        'Applied bold setting to',
      );
    });
    ui.cellFormatItalicInput.addEventListener('change', () => {
      applySelectedStyleProperty(
        'font-style',
        ui.cellFormatItalicInput.checked ? 'italic' : 'normal',
        'Applied italic setting to',
      );
    });
    ui.cellFormatUnderlineInput.addEventListener('change', () => {
      applySelectedStyleProperty(
        'text-decoration',
        ui.cellFormatUnderlineInput.checked ? 'underline' : 'none',
        'Applied underline setting to',
      );
    });
    ui.cellFormatTextColorInput.addEventListener('change', () => {
      ui.cellFormatNoTextColorInput.checked = false;
      ui.cellFormatTextColorInput.disabled = false;
      applySelectedStyleProperty('color', ui.cellFormatTextColorInput.value, 'Applied text color to');
    });
    ui.cellFormatNoTextColorInput.addEventListener('change', () => {
      ui.cellFormatTextColorInput.disabled = ui.cellFormatNoTextColorInput.checked;
      applySelectedStyleProperty(
        'color',
        ui.cellFormatNoTextColorInput.checked ? '' : ui.cellFormatTextColorInput.value,
        ui.cellFormatNoTextColorInput.checked
          ? 'Removed text color from'
          : 'Applied text color to',
      );
    });
    ui.cellFormatTextAlignSelect.addEventListener('change', () => {
      applySelectedStyleProperty(
        'text-align',
        ui.cellFormatTextAlignSelect.value,
        'Applied horizontal alignment to',
      );
    });
    ui.cellFormatVerticalAlignSelect.addEventListener('change', () => {
      applySelectedStyleProperty(
        'vertical-align',
        ui.cellFormatVerticalAlignSelect.value,
        'Applied vertical alignment to',
      );
    });
    ui.rowHeightInput.addEventListener('change', () => {
      const selection = getSelectedRange();
      if (!selection) {
        ui.cellFormatStatus.textContent = 'Select one or more rows or cells first.';
        return;
      }
      const height = Math.max(
        MIN_DATA_ROW_HEIGHT,
        Math.min(MAX_DATA_ROW_HEIGHT, Math.round(Number(ui.rowHeightInput.value))),
      );
      if (!Number.isFinite(height)) return;
      ui.rowHeightInput.value = String(height);
      const startRow = Math.min(selection[1], selection[3]);
      const endRow = Math.max(selection[1], selection[3]);
      const rowHeights: RowHeights = { ...(working.rowHeights ?? {}) };
      for (let row = startRow; row <= endRow; row++) {
        rowHeights[String(row)] = height;
        worksheet?.setHeight?.(row, height);
      }
      working = normalizeSpreadsheetData({
        ...working,
        data: readRawData(),
        rowHeights,
      });
      applySpreadsheetRowHeights(sheetContainer, worksheet, rowHeights, working.rows);
      ui.cellFormatStatus.textContent = `Set rows ${startRow + 1}–${endRow + 1} to ${height}px.`;
    });
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
      resizeSpreadsheet(Math.min(MAX_DIMENSION, working.rows + 1), working.cols);
    });
    ui.addColBtn.addEventListener('click', () => {
      resizeSpreadsheet(working.rows, Math.min(MAX_DIMENSION, working.cols + 1));
    });

    const applyFormulaAction = (formulaName: string): void => {
      const selection = getSelectedRange();
      if (!selection) {
        ui.formulaStatus.textContent = 'Select one or more source cells first.';
        return;
      }
      const startCol = Math.min(selection[0], selection[2]);
      const startRow = Math.min(selection[1], selection[3]);
      const endCol = Math.max(selection[0], selection[2]);
      const endRow = Math.max(selection[1], selection[3]);
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
      formulaInputTarget = { col: targetCol, row: targetRow };
      ui.formulaCellLabel.textContent = `${colLabel(targetCol)}${targetRow + 1}`;
      ui.formulaInput.disabled = false;
      ui.formulaInput.value = formulaValue;
      ui.formulaStatus.textContent = result === undefined
        ? `${formulaDescription} → ${colLabel(targetCol)}${targetRow + 1}`
        : `${formulaDescription} → ${colLabel(targetCol)}${targetRow + 1} = ${formatFormulaResult(result)}`;
    };
    ui.formulaButtons.forEach(button => button.addEventListener('click', () => {
      const formulaName = button.dataset.formula;
      if (!formulaName) return;
      applyFormulaAction(formulaName);
    }));
    ui.formulaFunctionSelect.addEventListener('change', () => {
      const formulaName = ui.formulaFunctionSelect.value;
      if (!formulaName) return;
      applyFormulaAction(formulaName);
      // Reset to the placeholder so the select reads as a one-shot action,
      // consistent with the buttons it replaced, not a persistent choice.
      ui.formulaFunctionSelect.value = '';
    });
    const commitFormulaInput = (event?: Event): void => {
      // A mousedown that starts a column/row resize drag reaches this
      // capture-phase listener before jspreadsheet's own delegated resize
      // hit-test runs on the same event. Committing here calls
      // worksheet.setValueFromCoords(), which can re-render (replace) the
      // very <th>/<td> the user just pressed down on; jspreadsheet's resize
      // hit-test then measures a now-detached node's getBoundingClientRect()
      // (all zeroes), so the drag silently never starts. Resize handles
      // live in the header/gutter, never inside an editable data cell, so
      // skipping the commit there is safe -- the blur listener below still
      // catches the eventual focus loss.
      if (event?.target instanceof Element && event.target.closest('thead, .jss_worksheet > tbody > tr > td:first-child')) {
        return;
      }
      if (!formulaInputTarget) return;
      const { col, row } = formulaInputTarget;
      let value = ui.formulaInput.value;
      if (value === lastCommittedFormulaValue) return;
      if (value.trimStart().startsWith('=')) {
        const missingParentheses = formulaParenthesisBalance(value);
        if (missingParentheses > 0) value += ')'.repeat(missingParentheses);
      }
      ui.formulaInput.value = value;
      lastCommittedFormulaValue = value;
      updateRawDataMirrorCell(col, row, value, false);
      worksheet?.setValueFromCoords?.(col, row, value);
      selectedRange = [col, row, col, row];
      worksheet?.updateSelectionFromCoords?.(col, row, col, row);
      scheduleFormulaResultRender();
      const result = evaluateFormula(value, readRawData(), col, row);
      ui.formulaStatus.textContent = value.trimStart().startsWith('=') && result !== undefined
        ? `${ui.formulaCellLabel.textContent} = ${formatFormulaResult(result)}`
        : `${ui.formulaCellLabel.textContent} updated.`;
    };
    ui.formulaInput.addEventListener('input', () => {
      if (!formulaInputTarget || !sheetContainer) return;
      const { col, row } = formulaInputTarget;
      const value = ui.formulaInput.value;
      updateRawDataMirrorCell(col, row, value, false);
      previewSpreadsheetCell(sheetContainer, readRawData(), col, row, value);
    });
    ui.formulaInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (!formulaInputTarget) {
        ui.formulaStatus.textContent = 'Select one cell before editing its value or formula.';
        return;
      }
      event.preventDefault();
      const { col, row } = formulaInputTarget;
      commitFormulaInput();
      // Same row/column-advance convention as Excel/Sheets' own formula
      // bar: commit, then move down one row in the same column so entering
      // a column of values top-to-bottom doesn't need a click between each
      // one. commitFormulaInput() above already re-selects (col, row) --
      // this only overrides that when there's actually a next row to move
      // to (last row: no-op, matching those tools' own behavior of just
      // staying put rather than growing the sheet).
      const nextRow = Math.min(row + 1, working.rows - 1);
      if (nextRow !== row) {
        const nextRange: CellRange = [col, nextRow, col, nextRow];
        selectedRange = nextRange;
        worksheet?.updateSelectionFromCoords?.(col, nextRow, col, nextRow);
        updateSelectionStatus(nextRange, true);
        ui.formulaInput.focus();
      }
    });
    // Clicking a different cell (or any other control) blurs the formula
    // input without ever firing Enter. That alone isn't enough though: a
    // mousedown on a grid cell always runs jspreadsheet's own selection
    // handling — which repopulates this same input for the newly clicked
    // cell — before the browser gets around to firing blur on the old one.
    // By the time blur fires, formulaInputTarget and the input's value have
    // already moved on to the new cell, so committing there is too late and
    // silently drops the edit. A capture-phase listener on document runs
    // before any handler further down the tree (jspreadsheet's included),
    // so it can commit the pending edit while it's still addressed to the
    // right cell. Keep the blur listener too, for non-mousedown ways of
    // losing focus (Tab, clicking outside the document, etc).
    ui.formulaInput.addEventListener('blur', commitFormulaInput);
    document.addEventListener('mousedown', commitFormulaInput, true);

    const cleanup = (): void => {
      finishFormulaSelection();
      document.removeEventListener('mousedown', commitFormulaInput, true);
      ui.sheetHost.removeEventListener('mousedown', onFormulaSelectionStart, true);
      ui.sheetHost.removeEventListener('keydown', onCellEditorKeydown, true);
      ui.sheetHost.removeEventListener('mousedown', onRowResizePointerDown, true);
      document.removeEventListener('mouseup', onRowResizePointerUp, true);
      ui.sheetHost.removeEventListener('copy', onSpreadsheetCopy, true);
      ui.sheetHost.removeEventListener('paste', onSpreadsheetPaste, true);
      ui.sheetHost.removeEventListener('dblclick', onColumnBoundaryDoubleClick, true);
      ui.sheetHost.removeEventListener('dblclick', onRowBoundaryDoubleClick, true);
      document.removeEventListener('keydown', onKey, true);
      ui.overlay.remove();
      restoreFocus(openerFocus);
    };
    const cancel = (force = false): void => {
      if (!force && hasChanges && !window.confirm('Discard unsaved spreadsheet changes?')) return;
      cleanup();
      reject(new Error('cancelled'));
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // Escape is easy to hit out of habit. Unlike the explicit Cancel
        // button, guard it the same way backdrop clicks already are: don't
        // silently discard a fully-formatted spreadsheet.
        cancel();
        return;
      }
      // jspreadsheet's own Ctrl/Cmd+Z handling keys off a *global* "current
      // instance" reference that it resets to null on any mousedown outside
      // its own worksheet DOM. Our formula bar, toolbar and appearance
      // panel all live outside that DOM (they're siblings in this dialog,
      // not descendants of .jss_worksheet), so clicking any of them --
      // completely normal while formatting a sheet -- silently broke undo/
      // redo from then on. worksheet.undo()/redo() are plain instance
      // methods with no dependency on that global tracker; call them
      // directly using the worksheet reference this module already keeps
      // in sync, bypassing the broken global lookup entirely.
      const key = event.key.toLowerCase();
      if (!(event.ctrlKey || event.metaKey) || key !== 'z') return;
      // Our own formula/caption inputs are plain text fields, not
      // jspreadsheet's own cell editor -- let the browser's native text-undo
      // handle those rather than hijacking it into a grid-level undo.
      if (event.target === ui.formulaInput || event.target === ui.captionInput) return;
      event.preventDefault();
      // Registered on the capture phase specifically so this runs BEFORE
      // jspreadsheet's own bubble-phase document keydown listener gets a
      // chance to fire. Without stopping it here, both handlers process the
      // same keystroke whenever the library's global "current" happens to
      // still be valid (e.g. right after a plain cell click, with no
      // intervening click on our own chrome) -- undoing two steps for one
      // Ctrl+Z press instead of one.
      event.stopImmediatePropagation();
      if (event.shiftKey) {
        worksheet?.redo?.();
      } else {
        worksheet?.undo?.();
      }
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
        rowHeights: normalizeRowHeights(working.rowHeights, rows),
        colWidths: normalizeColWidths(working.colWidths, cols),
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

    ui.cancelBtn.addEventListener('click', () => cancel());
    ui.overlay.addEventListener('click', event => {
      if (event.target !== ui.overlay) return;
      // A backdrop click is easy to trigger while selecting or formatting a
      // large sheet. Keep the dialog open so it cannot silently discard work.
      ui.formulaStatus.textContent = 'Spreadsheet is still open. Use Insert / Update to save your changes, or Cancel to discard them.';
    });
    document.addEventListener('keydown', onKey, true);
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
  let tableStyle = stripFixedTableHeight(
    `${getAppearanceTableStyle(appearance)};${raw.tableStyle ?? DEFAULT_TABLE_STYLE}`,
  ) ?? DEFAULT_TABLE_STYLE;
  // CSS fixed table layout only becomes deterministic when the table has an
  // explicit width. A newly-created spreadsheet has no saved colWidths yet
  // and tableWidth=0, so it previously rendered with width:auto: typing or
  // backspacing in TinyMCE could still make the browser expand a column even
  // though table-layout:fixed was present. Give that untouched initial state
  // a natural pixel width matching the explicit default <col> widths emitted
  // below. User-resized/imported tables keep their own persisted width.
  if (appearance.tableWidth === 0
    && !/(?:^|;)\s*width\s*:/i.test(raw.tableStyle ?? '')
  ) {
    const coordinateWidth = kind === 'notebook' ? 0 : appearance.rowIndexWidth;
    const dataWidth = Array.from({ length: raw.cols }, (_, col) => (
      raw.colWidths?.[String(col)] ?? DEFAULT_DATA_COL_WIDTH
    )).reduce((sum, width) => sum + width, 0);
    tableStyle = `${tableStyle};width:${coordinateWidth + dataWidth}px`;
  }
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
  html += getColGroupHtml(raw.colWidths, kind, raw.cols, appearance.rowIndexWidth);

  if (kind === 'notebook') {
    html += `<thead><tr${getRowHeightAttribute(raw.rowHeights, 0)}>`;
    for (let col = 0; col < raw.cols; col++) {
      html += `<th${getCellStyleAttribute(raw.cellStyles, appearance, col, 0)}>${escapeHTML(String(displayData[0]?.[col] ?? ''))}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let row = 1; row < raw.rows; row++) {
      html += `<tr${getRowHeightAttribute(raw.rowHeights, row)}>`;
      for (let col = 0; col < raw.cols; col++) {
        html += `<td${getCellStyleAttribute(raw.cellStyles, appearance, col, row)}>${escapeHTML(String(displayData[row]?.[col] ?? ''))}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
  } else {
    html += `<thead><tr><th class="spreadsheet-coordinate"${getCoordinateStyleAttribute(appearance, 'corner')}></th>`;
    for (let col = 0; col < raw.cols; col++) {
      const label = kind === 'well-plate' ? String(col + 1) : colLabel(col);
      html += `<th class="spreadsheet-coordinate"${getCoordinateStyleAttribute(appearance, 'column')}>${label}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let row = 0; row < raw.rows; row++) {
      const rowLabel = kind === 'well-plate' ? colLabel(row) : String(row + 1);
      html += `<tr${getRowHeightAttribute(raw.rowHeights, row)}><th class="spreadsheet-coordinate"${getCoordinateStyleAttribute(appearance, 'row')}>${rowLabel}</th>`;
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
    const extractedRowHeights = extractRowHeights(tableElement, kind, rows);
    const extractedColWidths = extractColWidths(tableElement, kind, cols);
    const extractedTableStyle = stripFixedTableHeight(
      tableElement.getAttribute('style') ?? undefined,
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
      // The popup's own last-saved sizes (embedded in this data-spreadsheet
      // blob) are authoritative and take priority over the *rendered*
      // colgroup/rows, which reflect whatever the main TinyMCE table
      // currently looks like -- including a resize done natively in TinyMCE,
      // independent of the popup. Falling back to the rendered DOM only
      // when the blob has no sizes of its own (older spreadsheets saved
      // before colWidths/rowHeights existed) keeps the popup and the main
      // table's own resizing functionally separate, each conserving only
      // the changes made in that view.
      rowHeights: normalizeRowHeights(
        decoded.rowHeights && Object.keys(decoded.rowHeights).length > 0
          ? decoded.rowHeights
          : (extractedRowHeights ?? {}),
        rows,
      ),
      colWidths: normalizeColWidths(
        decoded.colWidths && Object.keys(decoded.colWidths).length > 0
          ? decoded.colWidths
          : (extractedColWidths ?? {}),
        cols,
      ),
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
    rowHeights: extractRowHeights(tableElement, kind, rows),
    colWidths: extractColWidths(tableElement, kind, cols),
    tableStyle: stripFixedTableHeight(
      tableElement.getAttribute('style') ?? undefined,
    ),
    captionStyle: sanitizeStyle(
      tableElement.querySelector('caption')?.getAttribute('style') ?? undefined,
      PRESERVED_STYLE_PROPERTIES,
    ),
    tableBorder: parseTableBorder(tableElement),
  });
}

/**
 * Build a standalone, read-only jspreadsheet-ce grid (a plain <div>, not yet
 * attached anywhere) from a saved spreadsheet's data -- so a view page
 * matches the editing popup's own rendering pixel-for-pixel (identical
 * column/row sizing, cell styling, fixed coordinate gutter) instead of a
 * second, hand-rolled CSS approximation that can drift out of sync with it.
 * The shared core behind activateLazySpreadsheetViews() (view pages: swaps
 * the table in and out of the document as it scrolls in and out of view
 * place) and the TinyMCE editor's own overlay (SpreadsheetExtension.ts:
 * mounts this in the main document on top of the -- otherwise untouched --
 * table inside the editor's iframe, so the live editor content never has to
 * be mutated).
 */
export interface SpreadsheetHostOptions {
  /** When true, the grid accepts edits (typing, insert/delete row/column, row/column resize) instead of being read-only. */
  editable?: boolean;
  /**
   * Called (debounced) after any edit, with the grid's current state --
   * used by the TinyMCE editor overlay to keep the real (hidden) table's
   * saved markup in sync with what's being typed here, without ever
   * rebuilding this grid itself (which would drop the user's focus/cursor
   * mid-edit). Ignored when `editable` is not set.
   */
  onChange?: (data: SpreadsheetData) => void;
  /**
   * When provided, adds a small button to the toggle bar that opens the
   * full popup editor (formulas, row/col insert, appearance panel) --
   * separate from `editable`'s own inline cell editing, since jspreadsheet
   * itself already uses double-click to start editing a cell in place.
   */
  onOpenFullEditor?: () => void;
  /**
   * When provided, adds a small delete button to the toggle bar -- the
   * real table sits hidden behind this overlay entirely (visibility:
   * hidden, see SpreadsheetExtension.ts), so there's otherwise no click
   * target for the normal "select the table as a block and press
   * Delete" gesture editors usually rely on.
   */
  onDelete?: () => void;
}

export interface SpreadsheetHostHandle {
  host: HTMLDivElement;
  /** Properly tears down the jspreadsheet-ce instance; call before discarding the host. */
  destroy: () => void;
  /**
   * Immediately commits any edit still waiting out the debounce below,
   * without tearing anything down. Call before reading the real table
   * this host stands in for from anywhere else (e.g. extractFromTable()
   * for the "open full editor" popup) -- otherwise a change made less
   * than 500ms ago can still be missing from it.
   */
  flush: () => void;
}

// The SpreadsheetData a mounted host was built from -- lets
// restoreStaticSpreadsheetsForPrint() (used before printing/copying a
// section, see TocPanel.class.ts) regenerate clean static markup for a
// *cloned* mounted grid, without depending on virtualization's own
// internal bookkeeping (activateLazySpreadsheetViews' own saved-HTML map
// is private to that function, and a clone's jspreadsheet DOM isn't a
// live instance getData() can be called on).
const spreadsheetHostData = new WeakMap<HTMLElement, SpreadsheetData>();

export function buildReadOnlySpreadsheetHost(
  extracted: SpreadsheetData,
  options: SpreadsheetHostOptions = {},
): SpreadsheetHostHandle {
  const editable = options.editable ?? false;
  const rows = Math.max(1, extracted.rows);
  const cols = Math.max(1, extracted.cols);
  const appearance = normalizeAppearance(extracted.appearance);
  // The values currently rendered in the HTML (formula results included) --
  // not the raw formulas themselves, which parseFormulas:false below would
  // otherwise show verbatim as "=SUM(...)" text instead of its result.
  const displayValues = resizeData(
    extracted.displayData && extracted.displayData.length > 0 ? extracted.displayData : extracted.data,
    rows,
    cols,
  );
  const styles = mergeCellStyles(extracted.cellStyles, appearance, rows, cols);
  const rowHeights = normalizeRowHeights(extracted.rowHeights, rows) ?? {};
  const colWidths = normalizeColWidths(extracted.colWidths, cols) ?? {};
  // jspreadsheet-ce can quietly replace a formula cell's own raw text with
  // its computed result inside its *internal* data model after the edit
  // that typed it commits (parseFormulas:false stops it from evaluating
  // the formula, not from this) -- getData() then returns that computed
  // value back, with the formula itself gone for good. openSpreadsheetModal
  // works around the very same thing with its own rawDataMirror; mirrored
  // here so a formula survives being edited live instead of only through
  // the popup.
  let rawDataMirror = resizeData(extracted.data, rows, cols);
  // How wide this table renders in view mode / the static HTML fallback
  // (spreadsheetToHTML's own colgroup width sum) -- exposed via a data
  // attribute so the TinyMCE editor overlay can cap its own width at this
  // (in addition to the editor's content column width), rather than
  // whatever width jspreadsheet-ce's live grid happens to render at,
  // which can differ from the saved column widths.
  const computeNaturalTableWidth = (
    forCols: number,
    forColWidths: Record<string, number>,
    rowIndexWidth: number,
  ): number => (extracted.kind === 'notebook' ? 0 : rowIndexWidth)
    + Array.from({ length: forCols }, (_, col) => forColWidths[String(col)] ?? DEFAULT_DATA_COL_WIDTH)
      .reduce((sum, width) => sum + width, 0);

  const naturalTableWidth = computeNaturalTableWidth(cols, colWidths, appearance.rowIndexWidth);
  const host = document.createElement('div');
  host.className = 'elabftw-spreadsheet-readonly-view';
  host.dataset.viewModeWidth = String(naturalTableWidth);
  spreadsheetHostData.set(host, extracted);
  // Only width/alignment carry over from the saved table style -- border,
  // background and table-layout are meaningless (or actively wrong: an
  // extra outer box on top of jspreadsheet's own cell borders) on this
  // wrapping <div>, unlike on the real <table> spreadsheetToHTML() builds.
  const alignmentStyle = appearance.tableAlignment === 'center'
    ? 'margin-left:auto;margin-right:auto'
    : appearance.tableAlignment === 'right'
      ? 'margin-left:auto;margin-right:0'
      : 'margin-left:0;margin-right:auto';
  // In view mode, appearance.tableWidth is frequently a leftover "fill the
  // editor" percentage (often 100%) rather than the table's own size --
  // trusting it here left the toggle bar and border box spanning the full
  // width of the surrounding text even when the actual grid content is
  // much narrower, i.e. the border box didn't match the table's own size.
  // The editable overlay ignores this entirely (its width/position are
  // driven every animation frame from the real table's own measured rect
  // in SpreadsheetExtension.ts), so this only needs to matter here.
  const widthStyle = editable
    ? (appearance.tableWidth > 0 ? `width:${appearance.tableWidth}%;` : '')
    : `width:${naturalTableWidth}px;`;
  // setProperty() below must come after this: setAttribute('style', ...)
  // replaces the whole attribute, which would otherwise wipe out the two
  // custom properties again.
  host.setAttribute('style', `${widthStyle}${alignmentStyle};max-width:100%`);
  host.style.setProperty('--spreadsheet-row-index-width', `${appearance.rowIndexWidth}px`);
  host.style.setProperty('--spreadsheet-column-index-height', `${appearance.columnIndexHeight}px`);

  // A small collapsible header bar -- lets a large spreadsheet be tucked
  // away without deleting it, matching the "collapse table" affordance the
  // static HTML table doesn't have a good equivalent for.
  // A <div>, not a <button>: it needs to contain the "open full editor"
  // button below, and a <button> cannot contain another interactive
  // <button> (invalid HTML -- browsers silently hoist it back out, breaking
  // the layout and the click target).
  const toggleBar = document.createElement('div');
  toggleBar.className = 'elabftw-spreadsheet-readonly-toggle';
  const toggleIcon = document.createElement('i');
  toggleIcon.setAttribute('aria-hidden', 'true');
  if (!editable) {
    // Collapsing only in view mode: attempts to also shrink the real
    // table's reserved space to match, for the TinyMCE editor overlay
    // case, haven't held up -- disabled there rather than risk the
    // "collapsing looks like the table vanished" bug resurfacing.
    toggleBar.setAttribute('role', 'button');
    toggleBar.setAttribute('tabindex', '0');
    toggleIcon.className = 'fas fa-chevron-down';
    toggleBar.appendChild(toggleIcon);
  }
  if (extracted.caption) {
    const captionLabel = document.createElement('span');
    captionLabel.textContent = extracted.caption;
    toggleBar.appendChild(captionLabel);
  }
  host.appendChild(toggleBar);

  if (options.onOpenFullEditor) {
    const openFullEditorButton = document.createElement('button');
    openFullEditorButton.type = 'button';
    openFullEditorButton.className = 'elabftw-spreadsheet-readonly-open-editor';
    openFullEditorButton.title = 'Open full editor (formulas, rows/columns, appearance)';
    openFullEditorButton.setAttribute('aria-label', 'Open full editor');
    const openFullEditorIcon = document.createElement('i');
    openFullEditorIcon.className = 'fas fa-up-right-and-down-left-from-center';
    openFullEditorIcon.setAttribute('aria-hidden', 'true');
    openFullEditorButton.appendChild(openFullEditorIcon);
    openFullEditorButton.addEventListener('click', event => {
      event.stopPropagation();
      options.onOpenFullEditor?.();
    });
    toggleBar.appendChild(openFullEditorButton);
  }

  if (options.onDelete) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'elabftw-spreadsheet-readonly-delete';
    deleteButton.title = 'Delete this spreadsheet';
    deleteButton.setAttribute('aria-label', 'Delete this spreadsheet');
    const deleteIcon = document.createElement('i');
    deleteIcon.className = 'fas fa-trash';
    deleteIcon.setAttribute('aria-hidden', 'true');
    deleteButton.appendChild(deleteIcon);
    deleteButton.addEventListener('click', event => {
      event.stopPropagation();
      if (window.confirm('Delete this spreadsheet? This cannot be undone.')) {
        options.onDelete?.();
      }
    });
    toggleBar.appendChild(deleteButton);
  }

  // A small formula bar, mirroring the popup's own (a separate input, not
  // jspreadsheet-ce's in-cell editor -- there's no documented way to
  // safely intercept clicks against that instead) -- select a cell to see
  // its value/formula here, then click other cells while this input has
  // focus to insert their reference at the cursor, same as the popup.
  let formulaInputEl: HTMLInputElement | null = null;
  let formulaEditingCell: { col: number; row: number } | null = null;
  let formulaInputDirty = false;
  let composingFormula = false;
  // jspreadsheet-ce's own document-level mousedown handler calls
  // resetSelection() on the worksheet whenever a click lands outside it
  // (see mouseDownControls in its source) -- clicking any formatting
  // toolbar button is exactly such a click, so by the time that button's
  // own handler ran, getSelection() already came back empty. Tracked
  // independently here via onselection below (already wired, for the
  // formula bar) instead of queried on demand.
  let lastKnownSelection: CellRange | null = null;
  // Tracks where in the input the most recently click/drag-inserted
  // reference sits, so a further click can replace it in place instead of
  // piling another reference on top -- both because a single drag fires
  // onselection once per cell it passes over (A1, then A1:A2, then
  // A1:A3, ...), and because clicking a *different* cell right after,
  // with nothing typed in between, means "no, I meant this cell" (as in
  // Excel/Sheets) rather than "also this cell too".
  let activeReferenceRange: { start: number; end: number } | null = null;
  // Sticky until the user actually types a character: a click/drag right
  // after a click/drag keeps replacing the same span above. Only genuine
  // typing (the 'input' listener below) breaks that chain, so the next
  // click after typing "," or "+" starts a fresh reference instead of
  // overwriting what was just typed.
  let awaitingReferenceReplacement = false;
  if (editable) {
    const formulaBarEl = document.createElement('div');
    formulaBarEl.className = 'elabftw-spreadsheet-formula-bar';
    const formulaLabel = document.createElement('span');
    formulaLabel.className = 'elabftw-spreadsheet-formula-bar-label';
    formulaLabel.textContent = 'fx';
    formulaLabel.setAttribute('aria-hidden', 'true');
    formulaInputEl = document.createElement('input');
    formulaInputEl.type = 'text';
    formulaInputEl.className = 'elabftw-spreadsheet-formula-bar-input';
    formulaInputEl.disabled = true;
    formulaInputEl.spellcheck = false;
    formulaInputEl.placeholder = 'Select a cell to view or edit its value/formula';
    formulaInputEl.setAttribute('aria-label', 'Selected cell value or formula');
    formulaBarEl.append(formulaLabel, formulaInputEl);
    host.appendChild(formulaBarEl);

    // Cell formatting toolbar, mirroring the popup's own cellFormatBar
    // (fill/text color, font family/size, bold/italic/underline, align,
    // clear formatting) -- reusing its exact style-mutation helpers
    // (updateQuickStyleProperty/updateQuickFontStyle, module-level) and
    // UI-control builders (createIconControl/createStepperControl,
    // likewise module-level), but applied live via jspreadsheet-ce's own
    // getSelection()/getStyle()/setStyle() instead of the popup's
    // mountSpreadsheet() full remount -- this host has no equivalent to
    // remount into, and doesn't need one: setStyle() alone already
    // repaints the affected cells.
    const applySelectedCellStyle = (
      updateStyle: (style: string | undefined) => string | undefined,
    ): void => {
      if (!lastKnownSelection) return;
      const [c1, r1, c2, r2] = lastKnownSelection;
      const startCol = Math.min(c1, c2);
      const startRow = Math.min(r1, r2);
      const endCol = Math.max(c1, c2);
      const endRow = Math.max(r1, r2);
      // Deliberately NOT worksheet.setStyle(): its object form re-applies
      // every property in the combined style string one at a time
      // internally, and its per-property setter toggles a property OFF
      // instead of setting it when the new value equals what's already on
      // the cell -- a second, unrelated property change (e.g. italic)
      // that happens to re-send an unchanged one from the first click
      // (e.g. bold, still "font-weight:bold") silently cleared that
      // first one right back off. Only the most recently *changed*
      // property ever stuck. Written straight to each cell's own style
      // attribute instead, bypassing that toggle entirely -- the same
      // "DOM-only" workaround applySpreadsheetColWidths() already uses
      // for an analogous jspreadsheet-ce quirk with setWidth().
      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          const cell = sheetContainer.querySelector<HTMLElement>(
            `td[data-x="${col}"][data-y="${row}"]`,
          );
          if (!cell) continue;
          const style = updateStyle(cell.getAttribute('style') ?? undefined);
          if (style) {
            cell.setAttribute('style', style);
          } else {
            cell.removeAttribute('style');
          }
        }
      }
      notifyFromMirror();
    };
    const applySelectedStyleProperty = (property: string, value: string): void => {
      applySelectedCellStyle(style => updateQuickStyleProperty(style, property, value));
    };

    const formatBarEl = document.createElement('div');
    formatBarEl.className = 'elabftw-spreadsheet-format-bar';

    const fillColorInput = createInput('color', '#ffffff', 'Selected cell background color');
    const noFillButton = document.createElement('button');
    noFillButton.type = 'button';
    noFillButton.className = 'elabftw-spreadsheet-format-bar-icon-btn';
    noFillButton.innerHTML = '<i class="fas fa-fill-drip"></i><span class="elabftw-spreadsheet-format-bar-none">∅</span>';
    noFillButton.title = 'Remove fill color';
    noFillButton.setAttribute('aria-label', 'Remove fill color');
    fillColorInput.addEventListener('input', () => applySelectedStyleProperty('background-color', fillColorInput.value));
    noFillButton.addEventListener('click', () => applySelectedStyleProperty('background-color', ''));

    const fontFamilySelect = document.createElement('select');
    fontFamilySelect.className = 'form-control form-control-sm elabftw-spreadsheet-format-bar-select';
    fontFamilySelect.setAttribute('aria-label', 'Selected cell font family');
    fontFamilySelect.innerHTML = `
      <option value="">Default font</option>
      <option value="Arial, sans-serif">Arial</option>
      <option value="Verdana, sans-serif">Verdana</option>
      <option value="Georgia, serif">Georgia</option>
      <option value="'Times New Roman', serif">Times New Roman</option>
      <option value="'Courier New', monospace">Courier New</option>
    `;
    fontFamilySelect.addEventListener('change', () => applySelectedStyleProperty('font-family', fontFamilySelect.value));

    const fontSizeInput = createInput('number', '12', 'Selected cell font size in points');
    fontSizeInput.min = '6';
    fontSizeInput.max = '72';
    const applyFontSize = (): void => {
      const size = Number.parseInt(fontSizeInput.value, 10);
      if (Number.isFinite(size) && size > 0) applySelectedStyleProperty('font-size', `${size}pt`);
    };
    fontSizeInput.addEventListener('change', applyFontSize);

    // Bold/italic/underline toggle off whatever the FIRST selected cell's
    // own current style already has, matching how a word processor's own
    // toolbar toggles read/write the active selection instead of tracking
    // a separate on/off state of their own.
    const currentStyleOfFirstSelectedCell = (): string | undefined => {
      if (!lastKnownSelection) return undefined;
      const [c1, r1, c2, r2] = lastKnownSelection;
      const cellName = `${colLabel(Math.min(c1, c2))}${Math.min(r1, r2) + 1}`;
      return (getMountedWorksheet(sheetContainer)?.getStyle?.() as CellStyles | undefined)?.[cellName];
    };
    const makeFontToggleButton = (
      icon: string,
      label: string,
      property: 'font-weight' | 'font-style' | 'text-decoration',
      activeValue: string,
    ): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'elabftw-spreadsheet-format-bar-icon-btn';
      button.innerHTML = icon;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => {
        const current = currentStyleOfFirstSelectedCell();
        const probe = document.createElement('span');
        if (current) probe.setAttribute('style', current);
        const isActive = probe.style.getPropertyValue(property) === activeValue;
        applySelectedStyleProperty(property, isActive ? '' : activeValue);
      });
      return button;
    };
    const boldButton = makeFontToggleButton('<b>B</b>', 'Bold', 'font-weight', 'bold');
    const italicButton = makeFontToggleButton('<i>I</i>', 'Italic', 'font-style', 'italic');
    const underlineButton = makeFontToggleButton('<u>U</u>', 'Underline', 'text-decoration', 'underline');

    const textColorInput = createInput('color', '#212529', 'Selected cell text color');
    const noTextColorButton = document.createElement('button');
    noTextColorButton.type = 'button';
    noTextColorButton.className = 'elabftw-spreadsheet-format-bar-icon-btn';
    noTextColorButton.innerHTML = '<span class="elabftw-spreadsheet-format-bar-text-a">A</span><span class="elabftw-spreadsheet-format-bar-none">∅</span>';
    noTextColorButton.title = 'Remove text color';
    noTextColorButton.setAttribute('aria-label', 'Remove text color');
    textColorInput.addEventListener('input', () => applySelectedStyleProperty('color', textColorInput.value));
    noTextColorButton.addEventListener('click', () => applySelectedStyleProperty('color', ''));

    const makeAlignButton = (icon: string, label: string, value: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'elabftw-spreadsheet-format-bar-icon-btn';
      button.innerHTML = icon;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => applySelectedStyleProperty('text-align', value));
      return button;
    };

    const clearFormatButton = document.createElement('button');
    clearFormatButton.type = 'button';
    clearFormatButton.className = 'elabftw-spreadsheet-format-bar-icon-btn';
    clearFormatButton.innerHTML = '<i class="fas fa-eraser" aria-hidden="true"></i>';
    clearFormatButton.title = 'Clear all formatting from selected cells';
    clearFormatButton.setAttribute('aria-label', 'Clear all formatting from selected cells');
    clearFormatButton.addEventListener('click', () => applySelectedCellStyle(() => undefined));

    const openFullEditorFromFormatBar = document.createElement('button');
    openFullEditorFromFormatBar.type = 'button';
    openFullEditorFromFormatBar.className = 'elabftw-spreadsheet-format-bar-icon-btn';
    openFullEditorFromFormatBar.innerHTML = '<i class="fas fa-up-right-and-down-left-from-center" aria-hidden="true"></i>';
    openFullEditorFromFormatBar.title = 'Open full editor';
    openFullEditorFromFormatBar.setAttribute('aria-label', 'Open full editor');
    openFullEditorFromFormatBar.addEventListener('click', () => options.onOpenFullEditor?.());

    formatBarEl.append(
      createIconControl('<i class="fas fa-fill-drip"></i>', 'Fill color', fillColorInput),
      noFillButton,
      fontFamilySelect,
      createStepperControl(fontSizeInput, 'font size'),
      boldButton,
      italicButton,
      underlineButton,
      createIconControl('<span class="elabftw-spreadsheet-format-bar-text-a">A</span>', 'Text color', textColorInput),
      noTextColorButton,
      makeAlignButton('<i class="fas fa-align-left" aria-hidden="true"></i>', 'Align left', 'left'),
      makeAlignButton('<i class="fas fa-align-center" aria-hidden="true"></i>', 'Align center', 'center'),
      makeAlignButton('<i class="fas fa-align-right" aria-hidden="true"></i>', 'Align right', 'right'),
      makeAlignButton('<i class="fas fa-align-justify" aria-hidden="true"></i>', 'Justify', 'justify'),
      clearFormatButton,
      openFullEditorFromFormatBar,
    );
    // Above the formula bar, not below it: formatBarEl was originally
    // built after formulaBarEl and just appended after it too, but the
    // formatting toolbar reads better as the first "actions" row, with
    // the formula bar (the one text input in this whole header) right
    // above the grid it edits into.
    host.insertBefore(formatBarEl, formulaBarEl);

    // One arrow collapses both chrome rows (formatting toolbar + formula
    // bar) at once, leaving the grid itself untouched -- distinct from the
    // view-mode toggleBar chevron above, which collapses the whole table
    // (grid included) and is deliberately disabled in editable mode (see
    // its own comment). Starts collapsed: most edits are a quick cell
    // tweak that never touches either bar, so showing them by default
    // spent header space most spreadsheets never needed.
    const optionsToggle = document.createElement('button');
    optionsToggle.type = 'button';
    optionsToggle.className = 'elabftw-spreadsheet-options-toggle';
    const optionsToggleIcon = document.createElement('i');
    optionsToggleIcon.setAttribute('aria-hidden', 'true');
    optionsToggle.appendChild(optionsToggleIcon);
    let optionsCollapsed = true;
    const applyOptionsCollapsed = (): void => {
      formatBarEl.hidden = optionsCollapsed;
      formulaBarEl.hidden = optionsCollapsed;
      optionsToggleIcon.className = optionsCollapsed ? 'fas fa-chevron-right fa-fw' : 'fas fa-chevron-down fa-fw';
      const label = optionsCollapsed ? 'Show formula and formatting bars' : 'Hide formula and formatting bars';
      optionsToggle.title = label;
      optionsToggle.setAttribute('aria-label', label);
    };
    applyOptionsCollapsed();
    optionsToggle.addEventListener('click', event => {
      event.stopPropagation();
      optionsCollapsed = !optionsCollapsed;
      applyOptionsCollapsed();
    });
    toggleBar.insertBefore(optionsToggle, toggleBar.firstChild);

    // Does NOT reset activeReferenceRange/awaitingReferenceReplacement --
    // reclaimFocusHandler below re-focuses this input every time
    // jspreadsheet steals it back (which it does on every single cell
    // click), and that refocus fires this same genuine 'focus' event.
    // Resetting the replacement-tracking state here undid it right after
    // every click, so only ever the "insert fresh" path ran and every
    // click appended a reference next to the last one instead of
    // replacing it. The correct place to reset is where a cell is newly
    // selected to browse/edit from scratch (see the "plain new selection"
    // branch below), not merely whenever this input receives focus.
    formulaInputEl.addEventListener('focus', () => {
      composingFormula = true;
    });
    formulaInputEl.addEventListener('blur', () => {
      composingFormula = false;
      commitFormulaInput();
    });
    // A genuine keystroke -- as opposed to the programmatic value changes
    // onselection makes below -- means the user has moved on from the
    // reference a click/drag just inserted (e.g. typed "," or "+" to add
    // another one), so the next click should insert fresh rather than
    // keep overwriting it. Setting .value in JS does not fire 'input'.
    formulaInputEl.addEventListener('input', () => {
      awaitingReferenceReplacement = false;
      formulaInputDirty = true;
      // Keep the selected cell in step with the formula bar while typing,
      // rather than waiting for Enter/blur. This also updates the raw-data
      // mirror immediately, so an overlay teardown cannot lose the latest
      // character even if jspreadsheet has not emitted onchange yet.
      if (!formulaEditingCell || !formulaInputEl) return;
      const { col, row } = formulaEditingCell;
      const value = formulaInputEl.value;
      updateRawDataMirrorCell(col, row, value, false);
      previewSpreadsheetCell(sheetContainer, rawDataMirror, col, row, value);
      // Persist the mirror continuously, but do not run the staggered
      // formula repaints on every partial keystroke. The final setValue on
      // blur/Enter triggers the normal repaint once editing is complete.
      notifyFromMirror(false);
    });
    formulaInputEl.addEventListener('keydown', event => {
      // jspreadsheet-ce listens for keydown on `document` itself (not the
      // grid container) to drive its own keyboard shortcuts and type-to-
      // edit-the-selected-cell behavior -- it still sees every keystroke
      // typed in this input as it bubbles up, selected-cell state and all,
      // and jumps in ahead of (i.e. instead of) this input's own default
      // typing behavior: a closing ")" while composing a formula was
      // landing in the grid's selected cell rather than in this input.
      // Stopping it from ever reaching document leaves the browser's
      // normal text-input behavior as the only thing handling the key.
      event.stopPropagation();
      if (event.key !== 'Enter') return;
      event.preventDefault();
      formulaInputEl?.blur();
    });
  }

  // Commits the formula bar's current value into whichever cell was
  // selected when it was last enabled -- called on Enter/blur.
  function commitFormulaInput(): void {
    if (!formulaEditingCell || !formulaInputEl || !formulaInputDirty) return;
    const targetWorksheet = getMountedWorksheet(sheetContainer);
    const cellName = `${colLabel(formulaEditingCell.col)}${formulaEditingCell.row + 1}`;
    targetWorksheet?.setValue?.(cellName, formulaInputEl.value);
    formulaInputDirty = false;
  }

  const sheetContainer = document.createElement('div');
  sheetContainer.className = 'elabftw-spreadsheet-readonly-grid';
  host.appendChild(sheetContainer);
  if (editable) {
    // Clicking a cell to insert its reference into the formula bar must
    // not steal focus away from it -- preventDefault() on mousedown blocks
    // the browser's default focus-shift while still letting jspreadsheet's
    // own click-driven selection (and the onselection callback below) run
    // normally, since this never calls stopPropagation().
    sheetContainer.addEventListener('mousedown', event => {
      if (composingFormula) event.preventDefault();
    });
    // Double-click a column/row border to fit it to its content, same
    // gesture (and same edge-tolerance/measurement code) as
    // openSpreadsheetModal's onColumnBoundaryDoubleClick/
    // onRowBoundaryDoubleClick -- capture phase, ahead of jspreadsheet's
    // own dblclick handling (which would otherwise start editing whatever
    // cell happens to be under the same pixels).
    sheetContainer.addEventListener('dblclick', event => {
      if (event.button !== 0) return;
      const header = event.target instanceof Element
        ? event.target.closest<HTMLElement>('.jss_worksheet > thead [data-x]')
        : null;
      if (!header) return;
      const headerRect = header.getBoundingClientRect();
      const edgeTolerance = 7;
      const distanceFromLeft = event.clientX - headerRect.left;
      const distanceFromRight = headerRect.right - event.clientX;
      let col = Number.parseInt(header.dataset.x ?? '', 10);
      if (!Number.isInteger(col)) return;
      if (distanceFromLeft <= edgeTolerance) {
        col -= 1;
      } else if (distanceFromRight > edgeTolerance) {
        return;
      }
      if (col < 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const cells = Array.from(sheetContainer.querySelectorAll<HTMLElement>(
        `.jss_worksheet > thead [data-x="${col}"], .jss_worksheet > tbody td[data-x="${col}"][data-y]`,
      ));
      const naturalWidth = cells.reduce(
        (maximum, cell) => Math.max(maximum, measureNaturalCellWidth(cell)),
        MIN_DATA_COL_WIDTH,
      );
      const fittedWidth = Math.max(MIN_DATA_COL_WIDTH, Math.min(MAX_DATA_COL_WIDTH, naturalWidth));
      const targetWorksheet = getMountedWorksheet(sheetContainer);
      targetWorksheet?.setWidth?.(col, fittedWidth);
      notifyStructuralChange(targetWorksheet);
    }, true);
    sheetContainer.addEventListener('dblclick', event => {
      if (event.button !== 0) return;
      const rowHeader = event.target instanceof Element
        ? event.target.closest<HTMLElement>('.jss_worksheet > tbody .jss_row[data-y]')
        : null;
      if (!rowHeader) return;
      const headerRect = rowHeader.getBoundingClientRect();
      const edgeTolerance = 7;
      const distanceFromTop = event.clientY - headerRect.top;
      const distanceFromBottom = headerRect.bottom - event.clientY;
      let row = Number.parseInt(rowHeader.dataset.y ?? '', 10);
      if (!Number.isInteger(row)) return;
      if (distanceFromTop <= edgeTolerance) {
        row -= 1;
      } else if (distanceFromBottom > edgeTolerance) {
        return;
      }
      if (row < 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const cells = Array.from(sheetContainer.querySelectorAll<HTMLElement>(
        `.jss_worksheet > tbody td[data-y="${row}"]`,
      ));
      const naturalHeight = cells.reduce(
        (maximum, cell) => Math.max(maximum, measureNaturalCellHeight(cell)),
        MIN_DATA_ROW_HEIGHT,
      );
      const fittedHeight = Math.max(MIN_DATA_ROW_HEIGHT, Math.min(MAX_DATA_ROW_HEIGHT, Math.ceil(naturalHeight)));
      const targetWorksheet = getMountedWorksheet(sheetContainer);
      targetWorksheet?.setHeight?.(row, fittedHeight);
      notifyStructuralChange(targetWorksheet);
    }, true);

    // Double-click a data cell to edit it -- intercepted ahead of
    // jspreadsheet's own dblclick-to-edit (capture phase, like the two
    // boundary-specific listeners just above, which stopImmediatePropagation
    // only when they actually handle the click, letting this one still run
    // otherwise) so jspreadsheet's own broken column-boundary editor never
    // opens in the first place. See openCellEditor()'s own comment.
    sheetContainer.addEventListener('dblclick', event => {
      if (event.button !== 0) return;
      const cell = event.target instanceof Element
        ? event.target.closest<HTMLElement>('.jss_worksheet > tbody td[data-x][data-y]')
        : null;
      if (!cell) return;
      const col = Number.parseInt(cell.dataset.x ?? '', 10);
      const row = Number.parseInt(cell.dataset.y ?? '', 10);
      if (!Number.isInteger(col) || !Number.isInteger(row)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const currentValue = rawDataMirror[row]?.[col];
      openCellEditor(col, row, currentValue === undefined || currentValue === null ? '' : String(currentValue), false);
    }, true);

    // Click-a-cell-to-insert-its-reference, ported from openSpreadsheetModal's
    // own onFormulaSelectionStart/Move/End -- the formula bar's own click-to-
    // insert (in the onselection handler below) only ever covers that one
    // input; typing "=SUM(" directly into a cell via jspreadsheet's own
    // native double-click editor is a completely separate, undocumented
    // internal element this module never had a hook into for the same
    // click-interception. This intercepts in the capture phase, ahead of
    // jspreadsheet's own click handling, so a click that would otherwise
    // just navigate away from the cell being edited inserts a reference
    // into it instead, whenever the cursor sits somewhere a formula
    // actually expects one (same expectsCellReference rule as the formula
    // bar).
    let formulaSelectionDrag: {
      input: HTMLInputElement | HTMLTextAreaElement;
      startRange: CellRange;
      insertionStart: number;
      insertionEnd: number;
      formulaCol: number;
      formulaRow: number;
      allowRange: boolean;
    } | null = null;

    const getGridRangeFromTarget = (target: EventTarget | null): CellRange | null => {
      if (!(target instanceof Element) || !sheetContainer.contains(target)) return null;
      const coordinateElement = target.closest<HTMLElement>('td[data-x][data-y]');
      if (!coordinateElement) return null;
      const col = Number.parseInt(coordinateElement.dataset.x ?? '', 10);
      const row = Number.parseInt(coordinateElement.dataset.y ?? '', 10);
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) return null;
      return [col, row, col, row];
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

    const updateFormulaDragSelection = (range: CellRange): void => {
      if (!formulaSelectionDrag) return;
      const label = rangeLabel(range);
      formulaSelectionDrag.input.setRangeText(
        label,
        formulaSelectionDrag.insertionStart,
        formulaSelectionDrag.insertionEnd,
        'end',
      );
      if (formulaSelectionDrag.input === formulaInputEl) {
        formulaInputDirty = true;
      } else if (formulaSelectionDrag.input === rescueInputEl
        && rescueInputCol !== null && rescueInputRow !== null
      ) {
        // setRangeText() does not emit an input event. Keep the cell's raw
        // value in sync explicitly so the selected reference survives a
        // later click/Enter commit just like ordinary typed characters.
        updateRawDataMirrorCell(
          rescueInputCol,
          rescueInputRow,
          formulaSelectionDrag.input.value,
          false,
        );
      }
      formulaSelectionDrag.insertionEnd = formulaSelectionDrag.insertionStart + label.length;
      const targetWorksheetForDrag = getMountedWorksheet(sheetContainer);
      targetWorksheetForDrag?.updateSelectionFromCoords?.(...range);
    };

    const finishFormulaDragSelection = (): void => {
      if (!formulaSelectionDrag) return;
      const { input, insertionEnd } = formulaSelectionDrag;
      formulaSelectionDrag = null;
      document.removeEventListener('mousemove', onFormulaDragMove, true);
      document.removeEventListener('mouseup', onFormulaDragEnd, true);
      window.setTimeout(() => {
        input.focus();
        input.setSelectionRange(insertionEnd, insertionEnd);
      }, 0);
    };

    function onFormulaDragMove(event: MouseEvent): void {
      if (!formulaSelectionDrag) return;
      const endRange = getGridRangeFromTarget(event.target);
      if (!endRange) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      updateFormulaDragSelection(formulaSelectionDrag.allowRange
        ? [formulaSelectionDrag.startRange[0], formulaSelectionDrag.startRange[1], endRange[2], endRange[3]]
        : endRange);
    }

    function onFormulaDragEnd(event: MouseEvent): void {
      if (!formulaSelectionDrag) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishFormulaDragSelection();
    }

    const onFormulaSelectionStart = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      // jspreadsheet's own native cell editor (td.editor > input/textarea)
      // is one possible source of a formula being composed directly in a
      // cell -- but cell editing normally goes through the rescue input
      // now (see openCellEditor()'s own comment on why), which lives
      // outside any <td> entirely, so it wouldn't otherwise match here at
      // all and "click a cell to insert its reference" while typing a
      // formula into a cell would silently do nothing.
      const nativeInput = sheetContainer.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'td.editor[data-x][data-y] > input, td.editor[data-x][data-y] > textarea',
      );
      const input = nativeInput
        ?? (rescueInputEl && rescueInputCol !== null && rescueInputRow !== null && !rescueInputEl.hidden
          ? rescueInputEl
          : null);
      if (!input || event.target === input) return;
      const formulaCell = nativeInput?.closest<HTMLElement>('td.editor[data-x][data-y]');
      const formulaCol = nativeInput ? Number.parseInt(formulaCell?.dataset.x ?? '', 10) : rescueInputCol;
      const formulaRow = nativeInput ? Number.parseInt(formulaCell?.dataset.y ?? '', 10) : rescueInputRow;
      if (!Number.isInteger(formulaCol) || !Number.isInteger(formulaRow)) return;
      const startRange = getGridRangeFromTarget(event.target);
      if (!startRange) return;
      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? selectionStart;
      const formulaBeforeCaret = input.value.slice(0, selectionStart).trimStart();
      const expectsCellReference = /^=\s*$/.test(formulaBeforeCaret)
        || /[+\-*/(,;]\s*$/.test(formulaBeforeCaret);
      if (!expectsCellReference) return;
      const allowRange = /(SUM|AVERAGE|COUNT|MIN|MAX)\s*\([^)]*$/i.test(formulaBeforeCaret);

      event.preventDefault();
      event.stopImmediatePropagation();
      formulaSelectionDrag = {
        input, startRange, insertionStart: selectionStart, insertionEnd: selectionEnd, formulaCol, formulaRow, allowRange,
      };
      updateFormulaDragSelection(startRange);
      document.addEventListener('mousemove', onFormulaDragMove, true);
      document.addEventListener('mouseup', onFormulaDragEnd, true);
    };
    sheetContainer.addEventListener('mousedown', onFormulaSelectionStart, true);
  }
  // jspreadsheet-ce grabs focus onto its own internal, hidden editing
  // element as part of handling a cell click/selection -- preventDefault()
  // on mousedown above stops the browser's *own* default focus-shift, but
  // not that programmatic grab, which still lands after onselection's own
  // formulaInputEl.focus() call above. Left alone, the next keystroke (e.g.
  // the ")" closing a SUM(...)) types into that cell instead of the
  // formula bar. Reassert focus on the input whenever it loses it while
  // still composing, regardless of what stole it or when.
  let reclaimFocusHandler: ((event: FocusEvent) => void) | null = null;
  // jspreadsheet-ce recreates its own internal cell-edit <input> as part of
  // re-rendering a cell while it's being typed into -- most visibly, right
  // as the typed content approaches filling the column's own width, which
  // seems to trigger a remeasure/rebuild of that input. The browser's only
  // fallback when the currently-focused element is removed from the DOM is
  // <body>, not anywhere useful: left alone, every keystroke after that
  // point reaches no input at all ("stops typing"), and since a keydown
  // targeting <body> is not excluded by keymaster's own spreadsheet-aware
  // filter (that filter only excludes based on where the event *target*
  // sits in the DOM, and <body> is never a descendant of the overlay it
  // checks for), a later keystroke can still fall through to a global
  // shortcut too. Tracked separately from composingFormula/the formula-bar
  // case above (that one only ever reclaims for the formula bar
  // specifically); this covers plain in-grid cell editing, the more
  // common case and the one actually reported.
  let lastFocusWasInGrid = false;
  // The most recent cell oncreateeditor started editing -- kept as a
  // fallback reclaim target for the case a live trace showed pickReclaim
  // Target()'s other selectors can't handle: jspreadsheet sometimes closes
  // a cell's editor at the column boundary (mouseDownControls -> closeEditor)
  // without recreating a replacement input at all, leaving no '.editor'
  // cell and no editor input anywhere in the document to find. Reselecting
  // this same cell by its own data-x/data-y coordinates still works in
  // that case -- jspreadsheet starts a fresh edit on the next keystroke a
  // selected cell receives -- and doesn't depend on any editor DOM still
  // existing.
  let lastEditingCol: number | null = null;
  let lastEditingRow: number | null = null;
  // Six separate live traces on this same bug (see git log for each one's
  // own findings) ruled out every way of coaxing jspreadsheet's own broken
  // recreate-at-the-column-boundary cycle back into a working state:
  // reclaiming focus onto whatever editor DOM exists (none, some traces),
  // forcing DOM focus + tabindex onto the reselected cell (focus genuinely
  // landed, typing still didn't resume), syncing jspreadsheet's own
  // internal selection state via updateSelectionFromCoords() (confirmed
  // correct, typing still didn't resume), and focusing jspreadsheet's own
  // shared '.jss_textarea' (also confirmed focused, still didn't work) --
  // and the same failure reproduces in the standalone popup editor too,
  // which shares none of the inline overlay's TinyMCE-specific code,
  // ruling that out as well. Rather than keep guessing at jspreadsheet-ce's
  // opaque internal state, take over entirely for this one case: a
  // dedicated, always-alive rescue <textarea> (never owned or recreated by
  // jspreadsheet, the same principle the formula bar above already relies
  // on to avoid this exact class of bug) positioned over the cell, wired
  // into the same rawDataMirror/notifyFromMirror pipeline that already
  // reliably persists every other kind of edit in this file.
  let rescueInputEl: HTMLTextAreaElement | null = null;
  let rescueInputCol: number | null = null;
  let rescueInputRow: number | null = null;
  const commitRescueInput = (): void => {
    if (!rescueInputEl || rescueInputCol === null || rescueInputRow === null) return;
    const col = rescueInputCol;
    const row = rescueInputRow;
    const value = rescueInputEl.value;
    rescueInputEl.hidden = true;
    rescueInputCol = null;
    rescueInputRow = null;
    // Do not call worksheet.setValue() while a pointer click is moving to
    // another cell. jspreadsheet redraws the old cell synchronously from
    // setValue(), which invalidates the click target before its own
    // selection handler runs. The raw mirror is the authoritative value for
    // these stable editors; update the visible cell directly and use the
    // normal debounced persistence path instead.
    updateRawDataMirrorCell(col, row, value, false);
    previewSpreadsheetCell(sheetContainer, rawDataMirror, col, row, value);
    notifyFromMirror();
    delete document.body.dataset.spreadsheetCellEditing;
    document.body.classList.remove('elabftw-spreadsheet-editing');
  };
  const ensureRescueInput = (): HTMLTextAreaElement => {
    if (rescueInputEl) return rescueInputEl;
    const el = document.createElement('textarea');
    el.className = 'elabftw-spreadsheet-rescue-input';
    el.spellcheck = false;
    el.style.position = 'fixed';
    el.style.zIndex = '2147483647';
    el.style.boxSizing = 'border-box';
    el.style.resize = 'none';
    el.style.font = 'inherit';
    el.style.padding = '2px 4px';
    el.style.border = '2px solid #4285f4';
    el.style.background = '#fff';
    el.style.overflow = 'hidden';
    el.hidden = true;
    el.addEventListener('input', () => {
      if (rescueInputCol === null || rescueInputRow === null) return;
      // Deliberately NOT notifyFromMirror() here, unlike every other write
      // path in this file -- that's what the formula bar above already
      // gets right and this didn't at first: notifyFromMirror() eventually
      // triggers a real write back into the table plus editor.setDirty()/
      // undoManager.add(), on every keystroke. With jspreadsheet's own
      // editor already in a broken state (why this rescue path exists at
      // all), that repeated write-and-react cycle turned into a visible
      // loop -- focus kept getting yanked back to <body> and the same
      // interrupted-edit crash kept re-firing every cycle. Track locally
      // only while typing, the same as formulaInputDirty above; a single
      // commitRescueInput() on blur/Enter is the only point this writes
      // out, mirroring commitFormulaInput()'s own commit-once pattern.
      updateRawDataMirrorCell(rescueInputCol, rescueInputRow, el.value, false);
      // Grow only the temporary editor, not the underlying column. This
      // keeps long text editable without making neighbouring saved cells
      // paint over one another.
      const viewportRoom = Math.max(60, window.innerWidth - el.getBoundingClientRect().left - 8);
      el.style.width = `${Math.min(viewportRoom, Math.max(60, el.scrollWidth + 6))}px`;
    });
    // Enter commits and hands focus back to jspreadsheet's own grid --
    // mirroring how a normal cell edit closes -- rather than inserting a
    // newline (a plain <textarea>'s own default for Enter).
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitRescueInput();
      } else if (event.key === 'Escape') {
        // Cancel, not commit -- standard spreadsheet convention, and now
        // that this is the primary editor (not just an emergency
        // fallback), the distinction actually matters.
        event.preventDefault();
        el.hidden = true;
        rescueInputCol = null;
        rescueInputRow = null;
        delete document.body.dataset.spreadsheetCellEditing;
        document.body.classList.remove('elabftw-spreadsheet-editing');
      }
    });
    el.addEventListener('blur', commitRescueInput);
    // document.body, deliberately not host: host is moved via a CSS
    // transform (see syncOverlayPositions's own comment, to avoid a
    // Firefox scroll-positioning quirk), and any element with `transform`
    // becomes the *containing block* for its own position:fixed
    // descendants -- so a position:fixed child of host is positioned
    // relative to host's own transformed box, not the viewport, no matter
    // what left/top it's given. cellRect below comes from
    // getBoundingClientRect(), which is always viewport-relative
    // regardless of any transform -- appending to body keeps this input in
    // that same coordinate space instead of a mismatched one.
    document.body.appendChild(el);
    rescueInputEl = el;
    return el;
  };
  // Per the user's own suggestion: rather than keep patching jspreadsheet's
  // own broken destroy/recreate-at-the-column-boundary cell editor (see
  // this whole section's history in git log), make ALL in-grid cell
  // editing go through the same stable, always-alive input the formula
  // bar already uses successfully -- the column-boundary bug never
  // reproduces there because jspreadsheet never owns or recreates it.
  // openCellEditor() is the single entry point both triggers below (double-
  // click, and typing directly over a selected cell) call into.
  const openCellEditor = (col: number, row: number, initialValue: string, selectAll: boolean): void => {
    // data-x/data-y are coordinates *within* one table, not page-unique --
    // with more than one spreadsheet on the page, a document-wide query can
    // match a different table's cell that happens to share the same
    // column/row index, positioned nowhere near this one. Scope to this
    // instance's own sheetContainer first; only fall back to a document-
    // wide search for the rarer case jspreadsheet has relocated this
    // table's own structure outside it (see pickReclaimTarget()'s comment).
    const cell = sheetContainer.querySelector<HTMLElement>(`td[data-x="${col}"][data-y="${row}"]`)
      ?? document.querySelector<HTMLElement>(`td[data-x="${col}"][data-y="${row}"]`);
    if (!cell) return;
    const rescue = ensureRescueInput();
    const cellRect = cell.getBoundingClientRect();
    rescue.style.left = `${cellRect.left}px`;
    rescue.style.top = `${cellRect.top}px`;
    rescue.style.width = `${Math.max(cellRect.width, 60)}px`;
    rescue.style.height = `${Math.max(cellRect.height, 20)}px`;
    rescue.hidden = false;
    rescueInputCol = col;
    rescueInputRow = row;
    rescue.value = initialValue;
    // Reset before measuring: otherwise a previous long edit leaves the
    // shared textarea unnecessarily wide for the next cell.
    rescue.style.width = `${Math.max(cellRect.width, 60)}px`;
    rescue.style.width = `${Math.min(
      Math.max(60, window.innerWidth - cellRect.left - 8),
      Math.max(cellRect.width, rescue.scrollWidth + 6, 60),
    )}px`;
    document.body.dataset.spreadsheetCellEditing = 'true';
    rescue.focus();
    if (selectAll) rescue.select();
    else rescue.setSelectionRange(rescue.value.length, rescue.value.length);
  };
  // A live trace caught this reclaiming focus onto jspreadsheet's own
  // hidden grid-level '.jss_textarea' (used for the grid's own keyboard/
  // clipboard handling across every cell, not for entering text into any
  // one cell) -- a plain '[tabindex]' query has no way to prefer a genuine
  // per-cell edit input over it. A second trace then showed that scoping
  // the search to sheetContainer (or even its own parent, host) doesn't
  // work either: recreating its editor at the column boundary rebuilds
  // jspreadsheet's *entire* internal tab/container structure
  // ('.jtabs-content' > '.jss_container' > ... > the cell's own <input>)
  // as a fresh tree that lands completely outside both -- confirmed by
  // that trace's full ancestor chain. Rather than chase wherever
  // jspreadsheet decides to place that structure, search the whole
  // document for the cell jspreadsheet itself marks as actively being
  // edited (its own 'editor' class on the <td>) -- a signal that doesn't
  // depend on DOM location at all.
  const pickReclaimTarget = (): HTMLElement | null => {
    // Scoped to sheetContainer first, same reasoning as openCellEditor()'s
    // own comment: data-x/data-y aren't page-unique with more than one
    // spreadsheet present.
    const editingCell = lastEditingCol !== null && lastEditingRow !== null
      ? sheetContainer.querySelector<HTMLElement>(`td[data-x="${lastEditingCol}"][data-y="${lastEditingRow}"]`)
        ?? document.querySelector<HTMLElement>(`td[data-x="${lastEditingCol}"][data-y="${lastEditingRow}"]`)
      : null;
    // A live trace showed this cell comes back with no classes and no
    // tabindex at all once jspreadsheet has fully closed its editor
    // (deselected, not just stopped editing) -- .focus() on a <td> with no
    // tabindex is a silent no-op, which is why activeElement stayed <body>
    // every time this fallback was actually reached. Force it focusable
    // first, the same way jspreadsheet marks a selected cell itself.
    let target = document.querySelector<HTMLElement>('td.editor input, td.editor textarea, td.editor [contenteditable="true"]')
      ?? sheetContainer.querySelector<HTMLElement>('input, textarea:not(.jss_textarea), [contenteditable="true"]');
    // Nothing left to reclaim into that jspreadsheet itself still owns --
    // take over with the dedicated rescue textarea instead (see its own
    // comment for the four separate approaches already ruled out here).
    if (!target && editingCell && lastEditingCol !== null && lastEditingRow !== null) {
      const rescue = ensureRescueInput();
      const cellRect = editingCell.getBoundingClientRect();
      rescue.style.left = `${cellRect.left}px`;
      rescue.style.top = `${cellRect.top}px`;
      rescue.style.width = `${Math.max(cellRect.width, 60)}px`;
      rescue.style.height = `${Math.max(cellRect.height, 20)}px`;
      rescue.hidden = false;
      rescueInputCol = lastEditingCol;
      rescueInputRow = lastEditingRow;
      // Seed with whatever was already typed (rawDataMirror already holds
      // it -- onbeforechange writes every keystroke there continuously,
      // not just on a clean commit) rather than jspreadsheet's own
      // possibly-stale visual value for this cell.
      rescue.value = String(rawDataMirror[lastEditingRow]?.[lastEditingCol] ?? '');
      target = rescue;
    }
    return target;
  };
  if (editable) {
    reclaimFocusHandler = (event: FocusEvent): void => {
      if (composingFormula && formulaInputEl && event.target !== formulaInputEl) {
        formulaInputEl.focus();
        return;
      }
      const target = event.target;
      if (target === document.body) {
        // Also covers the keystroke that lands on <body> in the single
        // frame before this handler gets a chance to reclaim it -- a plain
        // ancestry check (is event.target inside the overlay?) can never
        // catch that, since <body> is never a descendant of it. keymaster's
        // own filter checks this same flag as a fallback for exactly that
        // gap (see its own comment).
        document.body.classList.add('elabftw-spreadsheet-editing');
        if (lastFocusWasInGrid) pickReclaimTarget()?.focus();
        return;
      }
      // lastFocusWasInGrid is deliberately scoped to *this* overlay's own
      // sheetContainer (used just above to decide which grid to reclaim
      // focus into), but the shared body class below must not be: with
      // several spreadsheet tables on the same page, each one registers
      // its own copy of this same handler, and every one of them receives
      // every focusin event on the page regardless of which table it
      // actually landed in. Toggling the class off whenever *this*
      // instance's own containment check came back false -- even while
      // focus is genuinely still inside some *other* table's grid --
      // meant whichever instance's handler happened to run last on a
      // given event won the race, intermittently clearing a class another
      // instance had just correctly set. Checking ancestry against any
      // .elabftw-spreadsheet-readonly-grid (every table's own sheetContainer
      // carries that class) instead of just this one's own container gives
      // every instance's handler the same answer, so the class reflects
      // "some spreadsheet grid has focus" rather than "this one does".
      // Checking sheetContainer ancestry alone missed the same relocation
      // pickReclaimTarget()'s own comment describes: once jspreadsheet
      // rebuilds its tab/container structure outside sheetContainer, a
      // focusin landing on that relocated input left this false, so the
      // later reclaim (once focus fell to <body>) never ran at all. '.jss_
      // container' ancestry is jspreadsheet's own wrapper for that whole
      // structure and stays true regardless of where it's mounted.
      const inSpreadsheetStructure = target instanceof Element
        && (sheetContainer.contains(target) || target.closest('.jss_container') !== null);
      lastFocusWasInGrid = inSpreadsheetStructure;
      const inAnySpreadsheetGrid = target instanceof Element
        && (target.closest('.elabftw-spreadsheet-readonly-grid') !== null || inSpreadsheetStructure);
      document.body.classList.toggle('elabftw-spreadsheet-editing', inAnySpreadsheetGrid);
    };
    document.addEventListener('focusin', reclaimFocusHandler);
  }
  // Typing directly over a selected-but-not-editing cell used to also open
  // this editor here (Excel-style, no double-click needed), via a keydown
  // listener on window (capture phase, ahead of jspreadsheet's own keydown
  // handling on document -- see git log for why window specifically).
  // Removed: even preempting jspreadsheet's own handler that way still left
  // its click/selection handling broken afterward -- a live trace-free but
  // directly reported regression: single click could no longer select a
  // cell, or drag-select a range, at all once this had fired once. Double-
  // click to edit (below) doesn't have this problem -- it's scoped to
  // sheetContainer, a node deep enough that jspreadsheet can't register
  // anything above it in the capture chain, so it never even reaches
  // jspreadsheet's own handling in the first place, rather than trying to
  // outrace it. Selection and multi-select working reliably matters more
  // than typing being possible without a double-click first, so this
  // trade-off stands until a way to add it back without that collision is
  // found.
  if (editable) {
    // Commit the stable editor before jspreadsheet handles a click on a
    // different cell. Because commitRescueInput() no longer redraws the
    // worksheet, the original pointer event remains valid and jspreadsheet
    // can update its selection normally on the very first click.
    sheetContainer.addEventListener('pointerdown', event => {
      if (!rescueInputEl || rescueInputEl.hidden
        || rescueInputCol === null || rescueInputRow === null
        || !(event.target instanceof Element)) return;
      const targetCell = event.target.closest<HTMLElement>('td[data-x][data-y]');
      if (!targetCell) return;
      const targetCol = Number.parseInt(targetCell.dataset.x ?? '', 10);
      const targetRow = Number.parseInt(targetCell.dataset.y ?? '', 10);
      if (targetCol === rescueInputCol && targetRow === rescueInputRow) return;
      // A cell click while the caret follows `=`, an operator or an open
      // function is a formula-reference selection, not navigation away
      // from the editing cell. Leave the rescue editor open so the
      // mousedown formula-selection handler can insert/drag that range.
      const selectionStart = rescueInputEl.selectionStart ?? rescueInputEl.value.length;
      const formulaBeforeCaret = rescueInputEl.value.slice(0, selectionStart).trimStart();
      const expectsCellReference = /^=\s*$/.test(formulaBeforeCaret)
        || /[+\-*/(,;]\s*$/.test(formulaBeforeCaret);
      if (expectsCellReference) return;
      commitRescueInput();
    }, true);

    // The rescue input is positioned once, at open time, from the cell's
    // then-current getBoundingClientRect() -- it doesn't track scrolling
    // the way the (constantly re-synced) read-only overlay does, so it's
    // left visibly stranded at that stale position once the page, or the
    // table's own horizontal scrollbar, moves the actual cell out from
    // under it. Commit (not cancel, so nothing typed is lost) on any
    // scroll anywhere -- 'scroll' doesn't bubble, but a capture-phase
    // listener on window still sees one dispatched on any scrollable
    // descendant, same technique as the pointerdown commit above.
    window.addEventListener('scroll', () => {
      if (rescueInputCol === null) return;
      commitRescueInput();
    }, true);
  }
  // Belt-and-braces for the same gap: a live trace showed Firefox not
  // always dispatching a 'focusin' event at all for the implicit "focused
  // element was removed from the DOM, so focus falls back to <body>" case
  // -- when that happens, reclaimFocusHandler above (which only ever runs
  // *in response to* a focusin event) never fires, and focus is left on
  // <body> until the user happens to click something themselves. Polling
  // document.activeElement directly doesn't depend on that event firing at
  // all. A short interval, not a MutationObserver on the cell editor
  // specifically: jspreadsheet recreates that element under a new,
  // unpredictable reference each time, so there is no single stable node
  // to observe.
  let focusPollInterval: ReturnType<typeof setInterval> | null = null;
  if (editable) {
    focusPollInterval = setInterval(() => {
      if (!lastFocusWasInGrid || document.activeElement !== document.body) return;
      document.body.classList.add('elabftw-spreadsheet-editing');
      pickReclaimTarget()?.focus();
    }, 50);
  }
  if (!editable) {
    const toggleCollapsed = (): void => {
      const collapsed = sheetContainer.hidden = !sheetContainer.hidden;
      toggleIcon.className = collapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-down';
    };
    toggleBar.addEventListener('click', toggleCollapsed);
    toggleBar.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleCollapsed();
      }
    });
  } else {
    toggleBar.style.cursor = 'default';
  }

  // jspreadsheet-ce v5 creates worksheets asynchronously: onload can fire
  // before the `data` supplied above has actually been rendered into the
  // DOM (see the identical caveat/retry loop in openSpreadsheetModal's own
  // mount code). Without retrying, this grid can render fully empty --
  // visually indistinguishable from the table having just vanished.
  const firstValue = String(displayValues[0]?.[0] ?? '');
  let hydrationConfirmed = false;
  const looksHydrated = (): boolean => {
    if (!sheetContainer.isConnected) return true; // replaced/removed meanwhile -- stop retrying
    const bodyRows = sheetContainer.querySelectorAll('.jss_worksheet tbody tr').length;
    if (bodyRows < rows) return false;
    if (firstValue === '') return true;
    const firstCell = sheetContainer.querySelector('.jss_worksheet tbody tr td[data-x][data-y]');
    return (firstCell?.textContent ?? '') === firstValue;
  };
  // jspreadsheet-ce's own tableOverflow wrapper (.jss_content, used here
  // since view mode passes tableHeight/tableWidth: '100%') sets its own
  // max-height inline to that exact percentage -- with no allowance for a
  // horizontal scrollbar it ends up needing, which then renders over the
  // last row's own bottom edge rather than the box growing to fit it.
  // Converts that percentage into the equivalent pixel figure (via
  // getBoundingClientRect(), the actual rendered size) and grows it by
  // the scrollbar's own measured thickness -- a CSS-only fix (e.g. extra
  // padding) can't help here since max-height caps the *total*, silently
  // absorbing anything added alongside it.
  const reserveRoomForHorizontalScrollbar = (): void => {
    if (editable) return;
    const jssContent = sheetContainer.querySelector('.jss_content') as HTMLElement | null;
    if (!jssContent) return;
    const scrollbarHeight = jssContent.offsetHeight - jssContent.clientHeight;
    if (scrollbarHeight <= 0) return;
    const currentHeight = jssContent.getBoundingClientRect().height;
    jssContent.style.maxHeight = `${currentHeight + scrollbarHeight}px`;
  };

  const hydrateUntilReady = (worksheet: JssInstance, attempt = 0): void => {
    if (!sheetContainer.isConnected) return;
    // Reaching an interactive cell editor proves that jspreadsheet finished
    // mounting, even if the first-cell text comparison below differs (for
    // example because a formula is showing its computed result). Never let
    // a delayed initialization retry call setData() over a live edit: that
    // redraw removes the native input and makes typing appear to stop at an
    // arbitrary character/column boundary. Keep this confirmation sticky so
    // closing the editor cannot allow a later retry to restore stale initial
    // data over the value the user just entered.
    if (sheetContainer.querySelector('td.editor input, td.editor textarea, td.editor [contenteditable="true"]')) {
      hydrationConfirmed = true;
    }
    if (hydrationConfirmed || looksHydrated() || attempt >= 30) {
      hydrationConfirmed = true;
      applyCoordinateHeaderDimensions(sheetContainer, appearance);
      applyCoordinateHeaderStyle(sheetContainer, appearance);
      applySpreadsheetRowHeights(sheetContainer, worksheet, rowHeights);
      applySpreadsheetColWidths(sheetContainer, worksheet, colWidths);
      window.requestAnimationFrame(reserveRoomForHorizontalScrollbar);
      return;
    }
    try {
      worksheet?.setData?.(displayValues);
      worksheet?.setStyle?.(styles);
    } catch {
      // fall through to retry below
    }
    window.setTimeout(() => hydrateUntilReady(worksheet, attempt + 1), Math.min(250, 15 + (attempt * 10)));
  };

  // Debounced: onChange can fire on every keystroke (onchange) or drag
  // frame (onresizerow/onresizecolumn) -- only the settled result after a
  // short pause is worth reacting to (e.g. rewriting the real table). The
  // formula repaint below is NOT debounced -- jspreadsheet itself never
  // evaluates "=SUM(...)" (parseFormulas:false; this module computes
  // formulas itself elsewhere too, see spreadsheetToHTML), so without an
  // immediate repaint here a formula cell would just show its own raw
  // text while editing, only resolving to a value once the debounced
  // onChange eventually lands.
  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  // The most recently computed (not yet committed) state, so destroy()
  // below can flush it synchronously instead of just cancelling the
  // pending timeout -- otherwise scrolling away (tearing this grid down
  // for virtualization, see SpreadsheetExtension.ts) within the 500ms
  // debounce window would silently drop the last edit.
  let pendingChange: SpreadsheetData | null = null;
  // Mirrors openSpreadsheetModal's own updateRawDataMirrorCell(): jspreadsheet
  // reports a cell's change twice (onbeforechange with the value about to
  // be applied, then onchange after it's applied), and can quietly repaint
  // a formula cell to its own computed result shortly after -- which would
  // otherwise arrive here indistinguishable from a genuine edit replacing
  // the formula with that same plain value. preserveRenderedFormula skips
  // exactly that: a write that looks like nothing more than the current
  // formula's own computed result reappearing, while still a cell's
  // *first* value (typed while still in the "editor" class, before
  // anything could have been computed yet) or any value that doesn't match
  // go through untouched.
  const updateRawDataMirrorCell = (
    col: number,
    row: number,
    value: CellValue,
    preserveRenderedFormula = true,
  ): void => {
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) return;
    const mirrorRows = Math.max(rawDataMirror.length, row + 1);
    const mirrorCols = Math.max(
      rawDataMirror.reduce((max, r) => Math.max(max, r.length), 0),
      col + 1,
    );
    rawDataMirror = resizeData(rawDataMirror, mirrorRows, mirrorCols);
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

  const notifyFromMirror = (repaintFormulas = true): void => {
    const data = rawDataMirror;
    // jspreadsheet repaints the cell itself asynchronously after onchange
    // (e.g. when its own edit box closes) -- a single immediate repaint
    // here can get overwritten right back to the raw "=..." text by that
    // later repaint. Match openSpreadsheetModal's own staggered retries.
    if (repaintFormulas) {
      const repaint = (): void => renderFormulaResults(sheetContainer, data);
      window.requestAnimationFrame(() => {
        repaint();
        window.setTimeout(repaint, 0);
        window.setTimeout(repaint, 120);
        window.setTimeout(repaint, 400);
      });
    }
    if (!options.onChange) return;
    const nextRows = data.length;
    const nextCols = data.reduce((max: number, row: unknown[]) => Math.max(max, row?.length ?? 0), 0);
    const liveRowHeights = readRenderedRowHeights(sheetContainer);
    const liveColWidths = readRenderedColWidths(sheetContainer);
    // getStyle() is jspreadsheet-ce's own live cellName->style map, kept
    // up to date by the cell-format toolbar's setStyle() calls below --
    // without reading it back here, any of those changes would be
    // silently dropped from what actually gets committed/saved, since
    // this object would otherwise still only ever carry the *original*
    // cellStyles this host was first built with.
    const liveCellStyles = getMountedWorksheet(sheetContainer)?.getStyle?.() as CellStyles | undefined;
    const next = normalizeSpreadsheetData({
      ...extracted,
      data,
      displayData: applyFormulaResults(data, data),
      rows: nextRows,
      cols: nextCols,
      rowHeights: { ...(extracted.rowHeights ?? {}), ...(liveRowHeights ?? {}) },
      colWidths: { ...(extracted.colWidths ?? {}), ...(liveColWidths ?? {}) },
      cellStyles: liveCellStyles ?? extracted.cellStyles,
    });
    // The overlay's own width is capped at this on every animation frame
    // (see syncOverlayPositions in SpreadsheetExtension.ts) -- computed
    // once at mount from the *original* column count/widths, it never
    // grew to admit a column inserted afterward, capping the overlay back
    // down to its old width instead of "instantly" widening for it. Keep
    // it in step with whatever the grid's columns currently are.
    if (editable) {
      host.dataset.viewModeWidth = String(
        computeNaturalTableWidth(next.cols ?? nextCols, next.colWidths ?? {}, appearance.rowIndexWidth),
      );
    }
    pendingChange = next;
    if (changeTimer) window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => {
      changeTimer = null;
      pendingChange = null;
      options.onChange?.(next);
    }, 500);
  };

  // A cell commit: onbeforechange below has already run first (with the
  // *proposed* value, and the guard off while still actively editing) --
  // updateRawDataMirrorCell here (guard on, its default) is what actually
  // catches jspreadsheet reporting a formula's own computed result as if
  // it were a fresh edit replacing the formula.
  const notifyChange = (
    _changedWorksheet: JssInstance,
    _cell: HTMLElement,
    changedCol: number,
    changedRow: number,
    newValue: CellValue,
  ): void => {
    updateRawDataMirrorCell(changedCol, changedRow, newValue);
    notifyFromMirror();
  };
  // Row/column insert, delete and resize: no single cell/value to reconcile
  // against the mirror -- jspreadsheet's own model is trusted wholesale for
  // the new shape, same as openSpreadsheetModal's syncMountedDimensions.
  const notifyStructuralChange = (changedWorksheet: JssInstance): void => {
    const liveData = changedWorksheet?.getData?.();
    if (Array.isArray(liveData)) {
      const rows = liveData.length;
      const cols = liveData.reduce((max: number, row: unknown[]) => Math.max(max, row?.length ?? 0), 0);
      rawDataMirror = resizeData(liveData, rows, cols);
    }
    notifyFromMirror();
  };

  const activeEditorCellStyles = new WeakMap<HTMLElement, {
    overflow: string;
    position: string;
    zIndex: string;
  }>();

  (jspreadsheet as unknown as JssFactory)(sheetContainer, {
    worksheets: [{
      data: displayValues,
      minDimensions: [cols, rows],
      rows: Array.from({ length: rows }, (_, row) => (
        rowHeights[String(row)] ? { height: rowHeights[String(row)] } : {}
      )),
      columns: Array.from({ length: cols }, (_, col) => (
        colWidths[String(col)] ? { width: colWidths[String(col)] } : {}
      )),
      style: styles,
      // A read-only view (view page) fills whatever CSS space it's given --
      // '100%' of its container is correct there. An editable overlay
      // (TinyMCE editor) is sized *from* its own natural content instead
      // (see syncOverlayPositions in SpreadsheetExtension.ts, which reads
      // scrollWidth/scrollHeight every frame), so forcing a percentage
      // here would just have it fill whatever transient size the
      // container happened to have at mount, defeating that measurement.
      tableOverflow: !editable,
      ...(editable ? {} : { tableWidth: '100%', tableHeight: '100%' }),
      editable,
      allowInsertRow: editable,
      allowInsertColumn: editable,
      allowDeleteRow: editable,
      allowDeleteColumn: editable,
      rowResize: editable,
      columnSorting: false,
      selectionCopy: true,
      allowUndo: editable,
    }],
    parseFormulas: false,
    onload: (instance: JssInstance): void => {
      hydrateUntilReady(getMountedWorksheet(sheetContainer, instance));
    },
    ...(editable ? {
      onbeforechange: (
        changedWorksheet: JssInstance,
        cell: HTMLElement,
        changedCol: number,
        changedRow: number,
        value: CellValue,
      ): CellValue => {
        updateRawDataMirrorCell(changedCol, changedRow, value, !cell?.classList?.contains('editor'));
        // notifyFromMirror() (debounced internally, see its own comment)
        // was previously only called from onchange/oneditionend -- both
        // fire on a *clean* commit (Enter, Tab, clicking another cell).
        // jspreadsheet can instead abruptly destroy and recreate its own
        // cell-edit input while the user is still typing (most visibly as
        // content nears the column's own width -- see
        // reclaimFocusHandler's own comment), which never fires either:
        // the edit is simply abandoned rather than committed, and
        // whatever had only ever reached the in-memory mirror here (not
        // yet pushed out to the actually-saved content) was silently
        // lost. Calling it here too means every keystroke's value is
        // already on its way to being saved continuously, not just the
        // one a clean commit happens to catch.
        notifyFromMirror();
        // Confirmed via a live MutationObserver trace: the real table DOES
        // end up with the correct value (the write-back above works), but
        // jspreadsheet's own *visual* grid can still show the cell as
        // empty/stale -- returning `value` here is normally enough for
        // jspreadsheet to apply it to its own model itself, but that never
        // happens when the abrupt destroy-and-recreate above interrupts
        // its own commit sequence before it gets there. Explicitly setting
        // it on the worksheet too (deferred one tick, so this doesn't
        // recurse back into this same onbeforechange while it's still
        // running) keeps what's on screen in step with what's already
        // been correctly saved, the same fix already applied to the
        // formula bar's own live-update case above.
        // Never call setValue while jspreadsheet's native input is still in
        // this cell. setValue redraws the cell and removes that input from
        // the DOM, which made typing stop as soon as a mid-edit change took
        // this path (most visibly around the original column boundary).
        // onbeforechange has already copied the value into rawDataMirror and
        // queued persistence above; jspreadsheet applies the visual value on
        // its own clean close. Only repair a stale visual cell after its
        // editor has genuinely gone away.
        // Do not schedule a second setValue() repair here. The callback can
        // run after jspreadsheet has replaced its row records, causing the
        // stale `records[row]` crash and stealing focus/selection from the
        // next cell. onbeforechange already updated the authoritative raw
        // mirror and queued persistence; the grid owns its own visual
        // commit, while the stable rescue editor updates its cell directly.
        return value;
      },
      onchange: notifyChange,
      oneditionstart: (): void => {
        document.body.dataset.spreadsheetCellEditing = 'true';
      },
      oncreateeditor: (
        _editingWorksheet: JssInstance,
        cell: HTMLElement,
        editingCol: number,
        editingRow: number,
      ): void => {
        // Jspreadsheet can temporarily move/replace its editor while text
        // reaches a cell boundary. Mark the whole editing lifetime rather
        // than relying on the input's current DOM ancestry, so application
        // shortcuts remain disabled throughout.
        document.body.dataset.spreadsheetCellEditing = 'true';
        lastEditingCol = editingCol;
        lastEditingRow = editingRow;
        // jspreadsheet-ce 5 passes null as the documented `input` callback
        // argument even for its default text editor. It has already appended
        // the real control to the cell before dispatching oncreateeditor, so
        // resolve it from there instead.
        const editorControl = cell.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]');
        if (editorControl) {
          activeEditorCellStyles.set(cell, {
            overflow: cell.style.overflow,
            position: cell.style.position,
            zIndex: cell.style.zIndex,
          });
          const initialWidth = Math.max(1, cell.getBoundingClientRect().width - 2);
          cell.style.overflow = 'visible';
          cell.style.position = 'relative';
          cell.style.zIndex = '3';
          editorControl.style.boxSizing = 'border-box';
          editorControl.style.left = '0';
          editorControl.style.maxWidth = 'none';
          editorControl.style.position = 'absolute';
          editorControl.style.top = '0';
          editorControl.style.zIndex = '4';
          if (editorControl instanceof HTMLTextAreaElement) editorControl.wrap = 'off';

          // Let the temporary editor overlay adjacent cells as text grows,
          // like Excel, without changing the underlying column width. The
          // scrollWidth is the full text width even when the visible input
          // has reached the original cell boundary.
          const fitEditorToContent = (): void => {
            editorControl.style.width = `${Math.max(initialWidth, editorControl.scrollWidth + 4)}px`;
          };
          fitEditorToContent();
          editorControl.addEventListener('input', fitEditorToContent);
        }
        editorControl?.addEventListener('input', () => {
          const value = editorControl instanceof HTMLInputElement || editorControl instanceof HTMLTextAreaElement
            ? editorControl.value
            : editorControl.textContent ?? '';
          updateRawDataMirrorCell(editingCol, editingRow, value, false);
          if (formulaEditingCell?.col === editingCol && formulaEditingCell.row === editingRow && formulaInputEl) {
            formulaInputEl.value = value;
            // This reflects a grid edit in the bar, not a bar edit waiting
            // to be committed back over the grid.
            formulaInputDirty = false;
          }
        });
      },
      // openSpreadsheetModal wires this too, alongside onchange, not as a
      // pure duplicate: it's what fires when the native double-click-to-
      // edit-a-cell editor actually closes, an extra, later repaint pass
      // this needed just as much for a formula typed directly into a
      // cell (rather than through the formula bar's own setValue() call)
      // to reliably still show its computed result instead of the raw
      // "=..." text.
      oneditionend: (
        changedWorksheet: JssInstance,
        cell: HTMLElement,
        changedCol: number,
        changedRow: number,
        editorValue: CellValue,
      ): void => {
        delete document.body.dataset.spreadsheetCellEditing;
        const originalCellStyle = activeEditorCellStyles.get(cell);
        if (originalCellStyle) {
          cell.style.overflow = originalCellStyle.overflow;
          cell.style.position = originalCellStyle.position;
          cell.style.zIndex = originalCellStyle.zIndex;
          activeEditorCellStyles.delete(cell);
        }
        notifyChange(changedWorksheet, cell, changedCol, changedRow, editorValue);
      },
      oninsertrow: notifyStructuralChange,
      oninsertcolumn: notifyStructuralChange,
      ondeleterow: notifyStructuralChange,
      ondeletecolumn: notifyStructuralChange,
      onresizerow: notifyStructuralChange,
      onresizecolumn: notifyStructuralChange,
      onselection: (
        selectedWorksheet: JssInstance,
        startCol: number,
        startRow: number,
        endCol: number,
        endRow: number,
      ): void => {
        if ([startCol, startRow, endCol, endRow].every(Number.isInteger)) {
          lastKnownSelection = [startCol, startRow, endCol, endRow];
        }
        if (!formulaInputEl || ![startCol, startRow, endCol, endRow].every(Number.isInteger)) return;
        // Same rule openSpreadsheetModal's own onFormulaSelectionStart uses
        // to decide whether a click is even about inserting a cell
        // reference at all: only right after "=" itself, or right after
        // one of +-*/(,; -- i.e. only where a formula genuinely expects an
        // operand next. A click right after "=SUM(A1:A3)" (a *complete*
        // expression -- last character ")") no more expects a reference
        // there than a click made before any formula was started, and
        // falls through to the plain-selection branch below the same way.
        // awaitingReferenceReplacement is this module's own addition, not
        // the popup's: it lets a still-continuing drag (onselection firing
        // again for the same drag, cursor now sitting right after a digit
        // from the reference just inserted) keep replacing that reference
        // even though the character before the cursor no longer looks
        // like it's expecting one.
        const cursorPos = formulaInputEl.selectionStart ?? formulaInputEl.value.length;
        const formulaBeforeCaret = formulaInputEl.value.slice(0, cursorPos).trimStart();
        const expectsCellReference = /^=\s*$/.test(formulaBeforeCaret)
          || /[+\-*/(,;]\s*$/.test(formulaBeforeCaret);
        if (composingFormula && (awaitingReferenceReplacement || expectsCellReference)) {
          // Mid-composing: insert this selection's reference at the
          // cursor, then keep typing there -- the mousedown handler above
          // already stopped focus from actually leaving it. If the
          // previous action was itself a click/drag insertion with
          // nothing typed since, replace that same reference instead of
          // appending next to it (as in Excel/Sheets: clicking a
          // different cell means "this one instead", not "this one too",
          // until you type an operator).
          const reference = (startCol === endCol && startRow === endRow)
            ? `${colLabel(startCol)}${startRow + 1}`
            : `${colLabel(startCol)}${startRow + 1}:${colLabel(endCol)}${endRow + 1}`;
          const start = awaitingReferenceReplacement && activeReferenceRange
            ? activeReferenceRange.start
            : formulaInputEl.selectionStart ?? formulaInputEl.value.length;
          const end = awaitingReferenceReplacement && activeReferenceRange
            ? activeReferenceRange.end
            : formulaInputEl.selectionEnd ?? formulaInputEl.value.length;
          formulaInputEl.value = formulaInputEl.value.slice(0, start) + reference + formulaInputEl.value.slice(end);
          formulaInputDirty = true;
          const cursor = start + reference.length;
          formulaInputEl.setSelectionRange(cursor, cursor);
          formulaInputEl.focus();
          activeReferenceRange = { start, end: cursor };
          awaitingReferenceReplacement = true;
          return;
        }
        // Commit whatever's currently in the bar for the *previous* cell
        // before overwriting it below -- jspreadsheet fires this selection
        // callback synchronously on mousedown, well before the browser's
        // own blur event for this input (the one that normally calls
        // commitFormulaInput()) has any chance to run. Without this, typing
        // a change and then clicking straight to another cell (rather than
        // blurring some other way first) silently discarded that edit: the
        // value below overwrites formulaInputEl.value first, and by the
        // time blur finally does fire, there's nothing of the old edit
        // left to commit.
        commitFormulaInput();
        // A plain new selection: show that cell's current raw value/formula,
        // ready to edit here -- only for a single cell, matching the popup.
        // This is the actual "starting fresh" point -- any reference a
        // previous click/drag inserted is done being composed once the
        // bar shows a different cell's own value instead.
        activeReferenceRange = null;
        awaitingReferenceReplacement = false;
        if (startCol !== endCol || startRow !== endRow) {
          formulaEditingCell = null;
          formulaInputDirty = false;
          formulaInputEl.disabled = true;
          formulaInputEl.value = '';
          return;
        }
        formulaEditingCell = { col: startCol, row: startRow };
        // rawDataMirror, not selectedWorksheet.getData() directly -- by
        // the time a formula cell is re-selected, jspreadsheet's own
        // model may already hold its computed result instead of the
        // formula itself (see rawDataMirror's own comment above), which
        // would otherwise show up here in place of the formula it
        // actually is.
        const rawValue = rawDataMirror[startRow]?.[startCol];
        formulaInputEl.disabled = false;
        formulaInputEl.value = String(rawValue ?? '');
        formulaInputDirty = false;
      },
    } : {}),
  });

  const flush = (): void => {
    if (!changeTimer) return;
    window.clearTimeout(changeTimer);
    changeTimer = null;
    if (pendingChange) options.onChange?.(pendingChange);
    pendingChange = null;
  };

  return {
    host,
    flush,
    // Properly tears down the jspreadsheet-ce instance (not just removing
    // the DOM) -- needed by callers that mount/unmount this repeatedly as
    // a table scrolls in and out of view, rather than once per page load.
    destroy: (): void => {
      // Flush, don't just cancel: a pending edit not yet committed (still
      // inside the 500ms debounce above) would otherwise be silently lost
      // when this grid is torn down for virtualization -- e.g. scrolling
      // away immediately after typing into a cell.
      flush();
      delete document.body.dataset.spreadsheetCellEditing;
      if (reclaimFocusHandler) document.removeEventListener('focusin', reclaimFocusHandler);
      if (focusPollInterval !== null) clearInterval(focusPollInterval);
      rescueInputEl?.remove();
      (jspreadsheet as unknown as { destroy?: (element: HTMLElement) => void }).destroy?.(sheetContainer);
    },
  };
}


/**
 * Lazily upgrade every saved spreadsheet table under `root` (a view page's
 * rendered entity body, typically) to a real jspreadsheet-ce grid once it
 * scrolls into view, instead of mounting every one on page load -- a page
 * with many/large spreadsheets stays cheap until the reader actually
 * scrolls to one.
 */
export function activateLazySpreadsheetViews(root: ParentNode): void {
  const tables = root.querySelectorAll<HTMLTableElement>('table.elabftw-spreadsheet');
  if (tables.length === 0) return;
  // Keyed by whichever element is currently observed for a given
  // spreadsheet (the static <table> while unmounted, its live host while
  // mounted) -- lets a scroll back out of view tear the jspreadsheet-ce
  // instance down and restore the cheap static markup, instead of every
  // spreadsheet ever visited staying mounted (and costing memory/CPU) for
  // the rest of the page's life. A long document with many spreadsheets is
  // the case this matters for; scrolling back in re-mounts from the exact
  // same saved markup.
  const savedHtml = new WeakMap<HTMLElement, string>();
  const destroyers = new WeakMap<HTMLElement, () => void>();
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const el = entry.target as HTMLElement;
      if (entry.isIntersecting) {
        if (!(el instanceof HTMLTableElement)) return; // already mounted
        const html = el.outerHTML;
        const { host, destroy } = buildReadOnlySpreadsheetHost(extractFromTable(el));
        el.replaceWith(host);
        savedHtml.set(host, html);
        destroyers.set(host, destroy);
        observer.unobserve(el);
        observer.observe(host);
      } else {
        const html = savedHtml.get(el);
        if (html === undefined) return; // still the static table -- nothing mounted to tear down
        destroyers.get(el)?.();
        savedHtml.delete(el);
        destroyers.delete(el);
        const parsed = document.createElement('div');
        parsed.innerHTML = html;
        const table = parsed.querySelector('table.elabftw-spreadsheet');
        if (!table) return;
        el.replaceWith(table);
        observer.unobserve(el);
        observer.observe(table);
      }
    });
  }, { rootMargin: '400px 0px' });
  tables.forEach(table => observer.observe(table));
}

/**
 * Regenerates clean static <table> markup for any mounted spreadsheet grid
 * found in `clonedRoot`, using data stashed (spreadsheetHostData) when each
 * corresponding host in `originalRoot` was built -- needed before printing
 * or copying a cloned section (see TocPanel.class.ts): a mounted grid's own
 * scroll container only ever contains whatever rows/columns are currently
 * scrolled into view, so cloning it verbatim silently drops the rest.
 * `originalRoot` and `clonedRoot` must have identical structure (i.e.
 * `clonedRoot` came from `originalRoot.cloneNode(true)`), since hosts are
 * matched up by their position among all matches, not by identity --
 * cloneNode() produces new node objects the WeakMap was never keyed on.
 */
export function restoreStaticSpreadsheetsForPrint(originalRoot: ParentNode, clonedRoot: ParentNode): void {
  const originals = Array.from(originalRoot.querySelectorAll<HTMLElement>('.elabftw-spreadsheet-readonly-view'));
  const clones = Array.from(clonedRoot.querySelectorAll<HTMLElement>('.elabftw-spreadsheet-readonly-view'));
  originals.forEach((originalHost, index) => {
    const clone = clones[index];
    const extracted = spreadsheetHostData.get(originalHost);
    if (!clone || !extracted) return;
    // View-mode grids are read-only, so this never actually differs from
    // the stashed snapshot -- reading it live anyway keeps this correct
    // rather than relying on that always being true.
    const sheetContainer = originalHost.querySelector('.elabftw-spreadsheet-readonly-grid') as HTMLElement | null;
    const worksheet = sheetContainer ? getMountedWorksheet(sheetContainer) : null;
    const liveData = worksheet?.getData?.();
    const current = Array.isArray(liveData) ? { ...extracted, data: liveData, displayData: liveData } : extracted;
    const html = spreadsheetToHTML(current, current.displayData ?? current.data);
    const parsed = document.createElement('div');
    parsed.innerHTML = html;
    const table = parsed.querySelector<HTMLTableElement>('table.elabftw-spreadsheet');
    if (!table) return;
    // spreadsheetToHTML() sizes the table from the saved appearance, which
    // for many spreadsheets is a leftover "fill the editor" width (e.g.
    // 100%) rather than the compact size actually shown in view mode --
    // the view page's own CSS auto-fits the host to its content instead
    // of trusting that saved width. Match what print produces to what the
    // reader already saw on the page rather than the saved value.
    const viewModeWidth = Number.parseFloat(originalHost.dataset.viewModeWidth ?? '');
    if (Number.isFinite(viewModeWidth) && viewModeWidth > 0) {
      table.style.width = `${viewModeWidth}px`;
      table.style.maxWidth = '100%';
    }
    clone.replaceWith(table);
  });
}

function extractRowHeights(
  tableElement: HTMLTableElement,
  kind: SpreadsheetKind,
  rows: number,
): RowHeights | undefined {
  const tableRows = Array.from(tableElement.querySelectorAll<HTMLTableRowElement>('tr'));
  const dataRows = kind === 'notebook' ? tableRows : tableRows.slice(1);
  const rowHeights: RowHeights = {};
  dataRows.slice(0, rows).forEach((row, rowIndex) => {
    const height = Number.parseFloat(row.style.height);
    if (!Number.isFinite(height)) return;
    rowHeights[String(rowIndex)] = Math.max(
      MIN_DATA_ROW_HEIGHT,
      Math.min(MAX_DATA_ROW_HEIGHT, Math.round(height)),
    );
  });
  return Object.keys(rowHeights).length > 0 ? rowHeights : undefined;
}

// Column widths are stored as <col style="width:Xpx"> entries in a
// <colgroup> written by spreadsheetToHTML() -- unlike row heights (set
// directly on each <tr>), a plain HTML table has no per-row equivalent
// element to hang a per-column width off other than <col>. The kind's
// leading coordinate-gutter <col> (present for 'standard'/'well-plate',
// absent for 'notebook' -- see spreadsheetToHTML()) is skipped so indices
// line up with data columns, not the table's own raw column count.
function extractColWidths(
  tableElement: HTMLTableElement,
  kind: SpreadsheetKind,
  cols: number,
): ColWidths | undefined {
  const allCols = Array.from(tableElement.querySelectorAll<HTMLTableColElement>('colgroup > col'));
  const dataCols = kind === 'notebook' ? allCols : allCols.slice(1);
  const colWidths: ColWidths = {};
  dataCols.slice(0, cols).forEach((col, colIndex) => {
    const width = Number.parseFloat(col.style.width);
    if (!Number.isFinite(width)) return;
    colWidths[String(colIndex)] = Math.max(
      MIN_DATA_COL_WIDTH,
      Math.min(MAX_DATA_COL_WIDTH, Math.round(width)),
    );
  });
  return Object.keys(colWidths).length > 0 ? colWidths : undefined;
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

function getRowHeightAttribute(rowHeights: RowHeights | undefined, row: number): string {
  const height = rowHeights?.[String(row)];
  return Number.isFinite(height) ? ` style="height:${height}px"` : '';
}

// A plain HTML table has no per-column element equivalent to a <tr> to hang
// a width off (unlike rows, sized directly via getRowHeightAttribute()) --
// <colgroup><col> is the standard mechanism instead. Emit it even before a
// user resizes anything: fixed table layout needs concrete initial column
// widths to remain stable while text is edited in TinyMCE. It must cover
// every column the *table* actually has, including the leading coordinate
// gutter for 'standard'/'well-plate' (absent for 'notebook') -- see
// spreadsheetToHTML() -- or the browser would misalign data-column widths
// onto the wrong physical columns.
function getColGroupHtml(
  colWidths: ColWidths | undefined,
  kind: SpreadsheetKind,
  cols: number,
  rowIndexWidth: number,
): string {
  let html = '<colgroup>';
  if (kind !== 'notebook') html += `<col style="width:${rowIndexWidth}px">`;
  for (let col = 0; col < cols; col++) {
    const width = colWidths?.[String(col)] ?? DEFAULT_DATA_COL_WIDTH;
    html += `<col style="width:${width}px">`;
  }
  html += '</colgroup>';
  return html;
}

function getCoordinateStyleAttribute(
  appearance: SpreadsheetAppearance,
  axis: 'column' | 'corner' | 'row',
): string {
  const dimensions: string[] = [];
  if (axis === 'row' || axis === 'corner') {
    dimensions.push(
      `width:${appearance.rowIndexWidth}px`,
      `min-width:${appearance.rowIndexWidth}px`,
      `max-width:${appearance.rowIndexWidth}px`,
    );
  }
  if (axis === 'column' || axis === 'corner') {
    dimensions.push(
      `height:${appearance.columnIndexHeight}px`,
      `min-height:${appearance.columnIndexHeight}px`,
      `max-height:${appearance.columnIndexHeight}px`,
    );
  }
  const style = `${getAppearanceCellStyle(appearance, 0, 0, false)};${dimensions.join(';')}`;
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
