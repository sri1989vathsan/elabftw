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
 *  - insert-text    paragraphs of plain text: { text: string }. [[item:ID|label]] in the text becomes a link to that inventory
 *                   entry (database.php?mode=view&id=ID) and the entry is added to the experiment's linked resources.
 *  - search-items   asks for inventory entries: { requestId, query, category?, limit? }; the answer, posted back to the
 *                   tool, is { elabftw: 1, type: 'items', requestId, items: [{ id, title, category, url, fields }] }
 *                   or { type: 'items-error', requestId, message }. The page searches with the user's own session, so a
 *                   tool sees only what that user may read, and nothing is ever written by a search.
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
import { ApiC } from './api';
import { entity } from './getEntity';
import { escapeExtendedQuery, escapeHTML, reloadElements } from './misc';

const MAX_MESSAGE_CHARS = 1_000_000;
const MAX_TEXT_CHARS = 100_000;
const COLOR = /^#[0-9a-f]{3,8}$/i;
const ITEM_TOKEN = /\[\[item:(\d{1,9})\|([^\]]{1,200})\]\]/g;
const MAX_ITEM_LINKS = 50;

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

/** The inventory entries a tool put in the text also become linked resources of the entry being edited. */
async function linkItemsOfEntry(ids: number[]): Promise<void> {
  if (ids.length === 0 || !entity.id) return;
  await Promise.allSettled(ids.map(id => ApiC.post(`${entity.type}/${entity.id}/items_links/${id}`)));
  reloadElements(['linksDiv']);
}

interface FoundItem {
  id: number;
  title: string;
  category: string;
  url: string;
  fields: Record<string, string>;
}

/** Extra fields of an entry as plain name: value text (what a tool shows, e.g. a concentration). */
function extraFields(metadata: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  try {
    const parsed: unknown = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    const extra = isRecord(parsed) && isRecord(parsed.extra_fields) ? parsed.extra_fields : {};
    Object.entries(extra).slice(0, 30).forEach(([name, field]) => {
      if (isRecord(field)) fields[text(name, 80)] = text(Array.isArray(field.value) ? field.value.join(', ') : field.value, 300);
    });
  } catch {
    // no usable metadata
  }
  return fields;
}

async function searchItems(message: Raw): Promise<FoundItem[]> {
  const query = escapeExtendedQuery(text(message.query, 100).trim());
  const category = text(message.category, 100).trim().toLocaleLowerCase();
  const limit = Math.min(Math.max(Number(message.limit) || 20, 1), 50);
  const rows = await ApiC.getJson<Raw[]>(`items?limit=${category ? 100 : limit}&scope=3&fastq=${encodeURIComponent(query)}`);
  const found = rows
    .filter(row => category === '' || text(row.category_title, 100).toLocaleLowerCase() === category)
    .slice(0, limit);
  // the list leaves out the extra fields (concentration, volume, ...), so each match is read on its own
  return Promise.all(found.map(async row => {
    const id = Number(row.id);
    const fields = await ApiC.getJson<Raw>(`items/${id}`).then(one => extraFields(one.metadata)).catch(() => ({}));
    return { id, title: text(row.title, 200), category: text(row.category_title, 100), url: `database.php?mode=view&id=${id}`, fields };
  }));
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
    // only the [[item:ID|label]] form becomes a link; everything else is escaped text
    const html = body.split(/\n{2,}/).map(paragraph => (
      `<p>${escapeHTML(paragraph).replace(ITEM_TOKEN, (_all, id: string, label: string) => `<a href="database.php?mode=view&id=${id}">${label}</a>`).replaceAll('\n', '<br>')}</p>`
    )).join('');
    editor.focus();
    editor.undoManager.transact(() => editor.execCommand('mceInsertContent', false, html));
    void linkItemsOfEntry([...new Set([...body.matchAll(ITEM_TOKEN)].map(match => Number(match[1])))].slice(0, MAX_ITEM_LINKS));
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
    if (message.type === 'search-items') {
      const requestId = text(message.requestId, 64);
      const reply = (answer: Raw): void => frameWindow.postMessage({ elabftw: 1, requestId, ...answer }, '*');
      searchItems(message)
        .then(items => reply({ type: 'items', items }))
        .catch(() => reply({ type: 'items-error', message: 'The inventory could not be searched.' }));
      return;
    }
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
