/**
 * What an HTML tool can send to the main text of the experiment being edited.
 *
 * The tools run in a sandboxed iframe (HtmlToolsPanel, no allow-same-origin), so they cannot touch the page or the
 * session; the only way out is window.parent.postMessage. A message is taken only when it comes from that iframe's
 * window and has the shape below; whatever it carries is rebuilt here (plain strings, colours checked) and inserted
 * through the editor's own spreadsheet command, so a tool can add content but not run anything on the page.
 *
 * Messages ({ elabftw: 1, type, ... }):
 *  - insert-plate   a well plate: { plateSize, caption?, wells: { A1: { label?, group? }, ... },
 *                   groups?: [{ name, color }], table?: { columns: string[], rows: { A1: string[] } } }
 *  - insert-table   a data table: { caption?, columns: string[], rows: string[][] }
 *  - insert-text    paragraphs of plain text: { text: string }
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import { Notification } from './Notifications.class';
import {
  createWellPlateSpreadsheetData,
  emptySpreadsheetData,
  SpreadsheetData,
  WELL_PLATE_PRESETS,
} from './inline-spreadsheet';
import { escapeHTML } from './misc';

const MAX_MESSAGE_CHARS = 1_000_000;
const MAX_TEXT_CHARS = 100_000;
const COLOR = /^#[0-9a-f]{3,8}$/i;

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 500): string => (typeof value === 'string' ? value : String(value ?? '')).slice(0, max);
const wellName = (row: number, col: number): string => `${String.fromCharCode(65 + row)}${col + 1}`;

/** A well plate from a message; null when the message is not usable. */
export function plateFromMessage(message: Raw): SpreadsheetData | null {
  const size = Number(message.plateSize);
  if (!WELL_PLATE_PRESETS.some(preset => preset.wells === size) || !isRecord(message.wells)) return null;
  const plate = createWellPlateSpreadsheetData(size);
  const wells = message.wells;
  const groupColors = new Map<string, string>();
  (Array.isArray(message.groups) ? message.groups : []).forEach(group => {
    if (isRecord(group) && typeof group.name === 'string' && COLOR.test(String(group.color))) {
      groupColors.set(group.name.slice(0, 80), String(group.color));
    }
  });
  const cellStyles: Record<string, string> = {};
  const usedGroups = new Map<string, string>();
  const tableRows: Record<string, string[]> = {};
  const columns = isRecord(message.table) && Array.isArray(message.table.columns)
    ? message.table.columns.map(column => text(column, 60)).slice(0, 20)
    : [];
  for (let row = 0; row < plate.rows; row++) {
    for (let col = 0; col < plate.cols; col++) {
      const name = wellName(row, col);
      const well = wells[name];
      if (!isRecord(well)) continue;
      plate.data[row][col] = text(well.label);
      const group = typeof well.group === 'string' ? well.group.slice(0, 80) : '';
      const color = COLOR.test(String(well.color)) ? String(well.color) : groupColors.get(group);
      if (color) {
        cellStyles[name] = `background-color:${color}`;
        if (group) usedGroups.set(group, color);
      }
      const tableRow = isRecord(message.table) && isRecord(message.table.rows) ? message.table.rows[name] : undefined;
      if (Array.isArray(tableRow)) tableRows[name] = tableRow.map(value => text(value)).slice(0, columns.length);
    }
  }
  const data: SpreadsheetData = {
    ...plate,
    displayData: undefined,
    caption: typeof message.caption === 'string' && message.caption !== '' ? message.caption.slice(0, 120) : plate.caption,
    cellStyles: Object.keys(cellStyles).length > 0 ? cellStyles : undefined,
    plateGroups: [...usedGroups].map(([name, color]) => ({ name, color })),
  };
  if (columns.length > 0) data.plateTable = { columns, rows: tableRows };
  return data;
}

/** A data table from a message; null when the message is not usable. */
export function tableFromMessage(message: Raw): SpreadsheetData | null {
  if (!Array.isArray(message.columns) || !Array.isArray(message.rows)) return null;
  const columns = message.columns.map(column => text(column, 120)).slice(0, 100);
  const rows = message.rows.slice(0, 399).map(row => (Array.isArray(row) ? row.map(cell => text(cell, 2000)).slice(0, 100) : []));
  const width = Math.max(columns.length, ...rows.map(row => row.length), 1);
  const sheet = emptySpreadsheetData(width, rows.length + 1, 'standard', typeof message.caption === 'string' ? message.caption.slice(0, 120) : '');
  sheet.data[0] = Array.from({ length: width }, (_, col) => columns[col] ?? '');
  rows.forEach((row, index) => {
    sheet.data[index + 1] = Array.from({ length: width }, (_, col) => row[col] ?? '');
  });
  return sheet;
}

function insertIntoEditor(message: Raw): string | null {
  const editor = (window as unknown as { tinymce?: { activeEditor?: { mode?: { isReadOnly?: () => boolean }; execCommand: (name: string, ui: boolean, value?: unknown) => void; focus: () => void; undoManager: { transact: (fn: () => void) => void } } } }).tinymce?.activeEditor;
  if (!editor || editor.mode?.isReadOnly?.()) return 'Open the entry in edit mode to insert from a tool.';
  switch (message.type) {
  case 'insert-plate': {
    const plate = plateFromMessage(message);
    if (!plate) return 'The tool sent a plate that cannot be inserted.';
    editor.undoManager.transact(() => editor.execCommand('elabftwInsertSpreadsheetData', false, plate));
    return null;
  }
  case 'insert-table': {
    const sheet = tableFromMessage(message);
    if (!sheet) return 'The tool sent a table that cannot be inserted.';
    editor.undoManager.transact(() => editor.execCommand('elabftwInsertSpreadsheetData', false, sheet));
    return null;
  }
  case 'insert-text': {
    const body = text(message.text, MAX_TEXT_CHARS).trim();
    if (body === '') return 'The tool sent no text.';
    const html = body.split(/\n{2,}/).map(paragraph => `<p>${escapeHTML(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
    editor.focus();
    editor.undoManager.transact(() => editor.execCommand('mceInsertContent', false, html));
    return null;
  }
  default:
    return 'The tool sent something eLabFTW does not know.';
  }
}

/** Listens for messages from the tool iframe; call once. */
export function listenForHtmlToolMessages(getFrameWindow: () => Window | null | undefined): void {
  window.addEventListener('message', event => {
    const frameWindow = getFrameWindow();
    // the sandboxed frame has an opaque origin ('null'), so the sender is identified by its window
    if (!frameWindow || event.source !== frameWindow) return;
    const message: unknown = event.data;
    if (!isRecord(message) || message.elabftw !== 1 || typeof message.type !== 'string') return;
    if (JSON.stringify(message).length > MAX_MESSAGE_CHARS) return;
    const notify = new Notification();
    let problem: string | null;
    try {
      problem = insertIntoEditor(message);
    } catch (error) {
      console.error(error);
      problem = 'Could not insert what the tool sent.';
    }
    if (problem) notify.error(problem);
    else notify.success('Inserted into the main text');
  });
}
