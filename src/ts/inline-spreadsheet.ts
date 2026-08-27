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
type RowHeights = Record<string, number>;
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
  const match = /^=\s*(SUM|AVERAGE|COUNT|MIN|MAX)\s*\((.*)\)\s*$/i.exec(formulaValue);

  if (!match) {
    let arithmeticExpression = formulaValue.trim().slice(1);
    const aggregatePattern = /(SUM|AVERAGE|COUNT|MIN|MAX)\s*\(([^()]*)\)/i;
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
    try {
      worksheet?.setHeight?.(row, height);
    } catch {
      // Keep the DOM fallback below for jspreadsheet builds without setHeight.
    }
    if (bodyRows[row]) bodyRows[row].style.height = `${height}px`;
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

function createIconControl(
  icon: string,
  labelText: string,
  control: HTMLElement,
): HTMLLabelElement {
  const label = createLabeledControl('', control);
  label.classList.add('inline-spreadsheet-compact-control');
  label.title = labelText;
  const iconElement = document.createElement('span');
  iconElement.className = 'inline-spreadsheet-control-icon';
  iconElement.innerHTML = icon;
  iconElement.setAttribute('aria-hidden', 'true');
  label.prepend(iconElement);
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
  formulaCellLabel: HTMLSpanElement;
  formulaInput: HTMLInputElement;
  formulaStatus: HTMLSpanElement;
  formulaBar: HTMLDivElement;
  formulaCollapseBtn: HTMLButtonElement;
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
  viewportHeightInput: HTMLInputElement;
  viewportFullWidthBtn: HTMLButtonElement;
  viewportFullHeightBtn: HTMLButtonElement;
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
    createIconControl('<i class="fas fa-fill-drip"></i>', 'Default cell color', cellColorInput),
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
  fontAppearanceGrid.append(
    createIconControl('<i class="fas fa-font"></i>', 'Default font family', defaultFontFamilySelect),
    createStepperControl(defaultFontSizeInput, 'default font size'),
    createIconControl('<b>B</b>', 'Bold by default', defaultFontBoldInput),
    createIconControl('<i>I</i>', 'Italic by default', defaultFontItalicInput),
    createIconControl('<u>U</u>', 'Underline by default', defaultFontUnderlineInput),
    createIconControl('<span class="inline-spreadsheet-text-color-icon">A</span>', 'Default text color', defaultFontTextColorInput),
    createIconControl('<i class="fas fa-ban"></i>', 'No default text color', defaultFontNoTextColorInput),
    createIconControl('<i class="fas fa-align-left"></i>', 'Default horizontal alignment', defaultFontTextAlignSelect),
    createIconControl('<i class="fas fa-arrows-alt-v"></i>', 'Default vertical alignment', defaultFontVerticalAlignSelect),
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
    createIconControl('<i class="fas fa-fill-drip"></i>', 'Cell background color', cellFormatColorInput),
    createIconControl('<i class="fas fa-ban"></i>', 'Remove cell background color', cellFormatNoColorInput),
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
    createIconControl('<span class="inline-spreadsheet-text-color-icon">A</span>', 'Text color', cellFormatTextColorInput),
    createIconControl('<i class="fas fa-ban"></i>', 'Remove text color', cellFormatNoTextColorInput),
    horizontalAlignmentButtons,
  );

  const clearCellFormatBtn = document.createElement('button');
  clearCellFormatBtn.type = 'button';
  clearCellFormatBtn.className = 'btn btn-sm btn-outline-secondary';
  clearCellFormatBtn.innerHTML = '<i class="fas fa-eraser" aria-hidden="true"></i>';
  clearCellFormatBtn.title = 'Clear all formatting from selected cells';
  clearCellFormatBtn.setAttribute('aria-label', 'Clear all formatting from selected cells');
  const cellFormatStatus = document.createElement('span');
  cellFormatStatus.className = 'inline-spreadsheet-cell-format-status';
  cellFormatStatus.textContent = 'Select cells, then change a property to apply it immediately.';
  cellFormatBar.append(
    cellStyleRow,
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
    button.textContent = action.value === 'SUM'
      ? '∑'
      : (action.value === 'AVERAGE'
        ? 'x̄'
        : (action.value === 'COUNT'
          ? '#'
          : action.label));
    button.title = action.title;
    button.setAttribute('aria-label', action.title);
    formulaBar.appendChild(button);
  });
  const formulaStatus = document.createElement('span');
  formulaStatus.className = 'inline-spreadsheet-formula-status';
  formulaStatus.textContent = 'Enter applies the value or formula to the selected cell.';
  formulaBar.appendChild(formulaStatus);
  const formulaCollapseBtn = document.createElement('button');
  formulaCollapseBtn.type = 'button';
  formulaCollapseBtn.className = 'inline-spreadsheet-icon-button ml-auto';
  formulaCollapseBtn.title = 'Collapse formula toolbar';
  formulaCollapseBtn.setAttribute('aria-label', 'Collapse formula toolbar');
  formulaCollapseBtn.setAttribute('aria-expanded', 'true');
  formulaCollapseBtn.innerHTML = '<i class="fas fa-chevron-up" aria-hidden="true"></i>';
  formulaBar.appendChild(formulaCollapseBtn);
  dialog.appendChild(formulaBar);

  const viewportBar = document.createElement('div');
  viewportBar.className = 'inline-spreadsheet-viewport-controls';
  const defaultViewportHeight = Math.max(220, Math.min(1200, Math.round(window.innerHeight * 0.65)));
  const viewportHeightInput = createInput(
    'number',
    String(defaultViewportHeight),
    'Spreadsheet editing area height',
  );
  viewportHeightInput.min = '220';
  viewportHeightInput.max = '1200';
  const viewportFullWidthBtn = document.createElement('button');
  viewportFullWidthBtn.type = 'button';
  viewportFullWidthBtn.className = 'btn btn-sm btn-outline-secondary';
  viewportFullWidthBtn.innerHTML = '<i class="fas fa-arrows-alt-h" aria-hidden="true"></i>';
  viewportFullWidthBtn.setAttribute('aria-label', 'Full width');
  viewportFullWidthBtn.title = 'Restore the editing area to the full dialog width';
  const viewportFullHeightBtn = document.createElement('button');
  viewportFullHeightBtn.type = 'button';
  viewportFullHeightBtn.className = 'btn btn-sm btn-outline-secondary';
  viewportFullHeightBtn.innerHTML = '<i class="fas fa-arrows-alt-v" aria-hidden="true"></i>';
  viewportFullHeightBtn.setAttribute('aria-label', 'Full height');
  viewportFullHeightBtn.title = 'Expand the editing area to the available screen height';
  viewportBar.append(
    createIconControl('<i class="fas fa-arrows-alt-v"></i>', 'Spreadsheet viewport height', viewportHeightInput),
    viewportFullWidthBtn,
    viewportFullHeightBtn,
  );

  const sheetHost = document.createElement('div');
  sheetHost.className = 'inline-spreadsheet-container';
  sheetHost.style.height = `${defaultViewportHeight}px`;
  dialog.append(viewportBar, sheetHost);

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
  insertBtn.textContent = 'Insert / Update';
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
    formulaCellLabel,
    formulaInput,
    formulaStatus,
    formulaBar,
    formulaCollapseBtn,
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
    cellFormatStatus,
    cellFormatNoColorInput,
    cellFormatNoTextColorInput,
    viewportHeightInput,
    viewportFullWidthBtn,
    viewportFullHeightBtn,
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
    let formulaInputTarget: { col: number; row: number } | null = null;
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

    const captureRenderedRowHeights = (): void => {
      if (!sheetContainer) return;
      const rowHeights: RowHeights = { ...(working.rowHeights ?? {}) };
      sheetContainer.querySelectorAll<HTMLTableRowElement>('.jss_worksheet > tbody > tr')
        .forEach((row, rowIndex) => {
          const height = Number.parseFloat(row.style.height || row.getAttribute('height') || '');
          if (!Number.isFinite(height)) return;
          rowHeights[String(rowIndex)] = Math.max(
            MIN_DATA_ROW_HEIGHT,
            Math.min(MAX_DATA_ROW_HEIGHT, Math.round(height)),
          );
        });
      working = normalizeSpreadsheetData({
        ...working,
        data: readRawData(),
        rowHeights,
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

    const updateSelectionStatus = (range: CellRange): void => {
      const startCol = Math.min(range[0], range[2]);
      const startRow = Math.min(range[1], range[3]);
      const endCol = Math.max(range[0], range[2]);
      const endRow = Math.max(range[1], range[3]);
      const cellCount = (endCol - startCol + 1) * (endRow - startRow + 1);
      const rangeLabel = `${colLabel(startCol)}${startRow + 1}:${colLabel(endCol)}${endRow + 1}`;
      ui.cellFormatStatus.textContent = `${rangeLabel} selected (${cellCount} cell${cellCount === 1 ? '' : 's'}).`;
      const selectingForFormulaBar = formulaSelectionDrag?.input === ui.formulaInput;
      if (!selectingForFormulaBar) {
        ui.formulaCellLabel.textContent = cellCount === 1
          ? `${colLabel(startCol)}${startRow + 1}`
          : rangeLabel;
        if (cellCount === 1) {
          formulaInputTarget = { col: startCol, row: startRow };
          ui.formulaInput.value = String(readRawData()[startRow]?.[startCol] ?? '');
          ui.formulaInput.disabled = false;
        } else {
          formulaInputTarget = null;
          ui.formulaInput.value = '';
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

    ui.sheetHost.addEventListener('mousedown', onFormulaSelectionStart, true);
    ui.sheetHost.addEventListener('keydown', onCellEditorKeydown, true);

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
          working = normalizeSpreadsheetData({
            ...working,
            data: rawDataMirror,
            rows,
            cols,
            kind: changedPlateSize ? 'standard' : working.kind,
            plateSize: changedPlateSize ? undefined : working.plateSize,
            cellStyles: readCellStyles(rows, cols),
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
        oninsertrow: (changedWorksheet: JssInstance): void => {
          syncMountedDimensions(changedWorksheet);
        },
        oninsertcolumn: (changedWorksheet: JssInstance): void => {
          syncMountedDimensions(changedWorksheet);
        },
        ondeleterow: (changedWorksheet: JssInstance): void => {
          syncMountedDimensions(changedWorksheet);
        },
        ondeletecolumn: (changedWorksheet: JssInstance): void => {
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
    const updateViewportHeight = (height: number): void => {
      if (!Number.isFinite(height)) return;
      const safeHeight = Math.max(220, Math.min(1200, Math.round(height)));
      ui.sheetHost.style.height = `${safeHeight}px`;
      ui.viewportHeightInput.value = String(safeHeight);
    };
    ui.viewportHeightInput.addEventListener('change', () => {
      updateViewportHeight(Number(ui.viewportHeightInput.value));
    });
    ui.viewportFullWidthBtn.addEventListener('click', () => {
      ui.sheetHost.style.width = '100%';
    });
    ui.viewportFullHeightBtn.addEventListener('click', () => {
      // Leave room for the popup title, controls and action buttons.
      updateViewportHeight(window.innerHeight * 0.65);
    });
    ui.formulaCollapseBtn.addEventListener('click', () => {
      const collapsed = ui.formulaBar.classList.toggle('is-collapsed');
      ui.formulaCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
      ui.formulaCollapseBtn.setAttribute(
        'aria-label',
        collapsed ? 'Expand formula toolbar' : 'Collapse formula toolbar',
      );
      ui.formulaCollapseBtn.title = collapsed
        ? 'Expand formula toolbar'
        : 'Collapse formula toolbar';
      ui.formulaCollapseBtn.innerHTML = collapsed
        ? '<i class="fas fa-chevron-down" aria-hidden="true"></i>'
        : '<i class="fas fa-chevron-up" aria-hidden="true"></i>';
    });
    const viewportResizeObserver = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height;
      if (height && Number.isFinite(height)) {
        ui.viewportHeightInput.value = String(Math.round(height));
      }
    });
    viewportResizeObserver.observe(ui.sheetHost);
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
        cellStyles: readCellStyles(),
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
      formulaInputTarget = { col: targetCol, row: targetRow };
      ui.formulaCellLabel.textContent = `${colLabel(targetCol)}${targetRow + 1}`;
      ui.formulaInput.disabled = false;
      ui.formulaInput.value = formulaValue;
      ui.formulaStatus.textContent = result === undefined
        ? `${formulaDescription} → ${colLabel(targetCol)}${targetRow + 1}`
        : `${formulaDescription} → ${colLabel(targetCol)}${targetRow + 1} = ${result}`;
    }));
    ui.formulaInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (!formulaInputTarget) {
        ui.formulaStatus.textContent = 'Select one cell before editing its value or formula.';
        return;
      }
      event.preventDefault();
      const { col, row } = formulaInputTarget;
      let value = ui.formulaInput.value;
      if (value.trimStart().startsWith('=')) {
        const missingParentheses = formulaParenthesisBalance(value);
        if (missingParentheses > 0) value += ')'.repeat(missingParentheses);
      }
      ui.formulaInput.value = value;
      updateRawDataMirrorCell(col, row, value, false);
      worksheet?.setValueFromCoords?.(col, row, value);
      selectedRange = [col, row, col, row];
      worksheet?.updateSelectionFromCoords?.(col, row, col, row);
      scheduleFormulaResultRender();
      const result = evaluateFormula(value, readRawData(), col, row);
      ui.formulaStatus.textContent = value.trimStart().startsWith('=') && result !== undefined
        ? `${ui.formulaCellLabel.textContent} = ${result}`
        : `${ui.formulaCellLabel.textContent} updated.`;
    });

    const cleanup = (): void => {
      finishFormulaSelection();
      viewportResizeObserver.disconnect();
      ui.sheetHost.removeEventListener('mousedown', onFormulaSelectionStart, true);
      ui.sheetHost.removeEventListener('keydown', onCellEditorKeydown, true);
      ui.sheetHost.removeEventListener('mousedown', onRowResizePointerDown, true);
      document.removeEventListener('mouseup', onRowResizePointerUp, true);
      ui.sheetHost.removeEventListener('copy', onSpreadsheetCopy, true);
      ui.sheetHost.removeEventListener('paste', onSpreadsheetPaste, true);
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
        rowHeights: normalizeRowHeights(working.rowHeights, rows),
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
    ui.overlay.addEventListener('click', event => {
      if (event.target !== ui.overlay) return;
      // A backdrop click is easy to trigger while selecting or formatting a
      // large sheet. Keep the dialog open so it cannot silently discard work.
      ui.formulaStatus.textContent = 'Spreadsheet is still open. Use Insert / Update to save your changes, or Cancel to discard them.';
    });
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
  let tableStyle = stripFixedTableHeight(
    `${getAppearanceTableStyle(appearance)};${raw.tableStyle ?? DEFAULT_TABLE_STYLE}`,
  ) ?? DEFAULT_TABLE_STYLE;
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
      rowHeights: normalizeRowHeights({
        ...(decoded.rowHeights ?? {}),
        ...(extractedRowHeights ?? {}),
      }, rows),
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
