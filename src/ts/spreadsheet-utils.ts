/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @author Mouss <Deltablot>
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

import { read, utils, write } from '@e965/xlsx';
import type { WorkBook } from '@e965/xlsx';
import { FileType, Model } from './interfaces';
import { askFileName, getNewIdFromPostRequest } from './misc';
import { notify } from './notify';
import { getBookType, getMime, inferFileTypeFromName } from './spreadsheet-formats';

type Cell = string | number | boolean | null;
// save current spreadsheet as a new attachment
export async function saveAsAttachment(aoa: Cell[][], entityType: string, entityId: number, fileName?: string): Promise<{ id:number; name:string } | void> {
  const raw = fileName?.trim() || askFileName(FileType.Xlsx);
  if (!raw) return;
  return uploadAOA(aoa, ensureExtensionExists(raw), entityType, entityId);
}

// replace an existing attachment with current spreadsheet
export async function replaceAttachment(aoa: Cell[][], entityType: string, entityId: number, uploadId: number, currentName: string): Promise<{id:number; name:string} | void> {
  if (!uploadId || !currentName) return;
  return uploadAOA(aoa, currentName, entityType, entityId, uploadId);
}

// import file from computer: convert to spreadsheet
export async function fileToAOA(file: File): Promise<Cell[][]> {
  const buffer = await file.arrayBuffer();
  return parseFileToAOA(buffer);
}

function parseFileToAOA(buffer: ArrayBuffer): Cell[][] {
  const wb = read(buffer, { type: 'array', codepage: 65001 }); // UTF-8
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error('No sheets found in uploaded file.');
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) {
    throw new Error('Failed to load the first sheet from the file.');
  }
  // Walk cells manually instead of using utils.sheet_to_json(): that helper
  // only returns each cell's computed value, so formula cells collapse down
  // to a plain number/string and the formula itself is lost. Reading each
  // cell's `.f` property directly lets us keep "=SUM(A1:A3)" as text that
  // jspreadsheet's own formula engine can parse and evaluate client-side.
  const range = utils.decode_range(ws['!ref'] || 'A1:A1');
  const aoa: Cell[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: Cell[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[utils.encode_cell({ r, c })];
      if (!cell) {
        row.push('');
      } else if (cell.f) {
        row.push(`=${cell.f}`);
      } else {
        row.push((cell.v ?? '') as Cell);
      }
    }
    aoa.push(row);
  }
  return aoa;
}

export async function loadInSpreadsheetEditor(storage: string, path: string, name: string, uploadId: number): Promise<void> {
  try {
    const res = await fetch(`app/download.php?f=${encodeURIComponent(path)}&storage=${storage}`, {
      headers: new Headers({ 'cache-control': 'no-cache' }),
    });
    if (!res.ok) throw new Error('Failed to fetch uploaded file.');
    const buffer = await res.arrayBuffer();
    const aoa = parseFileToAOA(buffer);
    const iframe = document.getElementById('spreadsheetIframe') as HTMLIFrameElement;
    iframe.contentWindow.postMessage({ type: 'jss-load-aoa', detail: { aoa, name, uploadId } }, window.location.origin);
  } catch (e) {
    notify.error(e.message || 'Unexpected error while loading spreadsheet.');
  }
}

// helpers
async function postAndReturnId(file: File, url: string): Promise<number> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok) {
    const msg = `Upload failed (${res.status})`;
    notify.error(msg);
    throw new Error(msg);
  }
  notify.success();
  return getNewIdFromPostRequest(res);
}

// default to xlsx if extension missing
const ensureExtensionExists = (name: string): string => {
  return /\.[^./\\]+$/.test(name) ? name : `${name}.xlsx`;
};

const uploadUrl = (entityType: string, entityId: number, uploadId?: number): string => {
  const base = `api/v2/${entityType}/${entityId}/${Model.Upload}`;
  return uploadId ? `${base}/${uploadId}` : base;
};

// TODO: later - handle multiple sheets
const wbFromAOA = (aoa: Cell[][]): WorkBook => {
  const ws = utils.aoa_to_sheet(aoa);
  // aoa_to_sheet() writes formula-looking strings (e.g. "=SUM(A1:A3)") as
  // plain text cells. Convert those back into real formula cells so the
  // exported file recalculates in Excel/LibreOffice instead of literally
  // displaying the "=..." text. The cached value is intentionally left
  // unset so the consuming application recomputes it on open.
  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < aoa[r].length; c++) {
      const value = aoa[r][c];
      if (typeof value === 'string' && value.length > 1 && value.startsWith('=')) {
        const cell = ws[utils.encode_cell({ r, c })];
        if (cell) {
          cell.f = value.slice(1);
          delete cell.v;
          delete cell.w;
        }
      }
    }
  }
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
};

const fileFromWB = (wb: WorkBook, name: string) => {
  const fileType = inferFileTypeFromName(name);
  const bookType = getBookType(fileType);
  const mime = getMime(fileType);
  const bin = write(wb, { bookType, type: 'array' });
  return new File([bin], name, { type: mime });
};

// upload to eLab as attachment (save/replace)
async function uploadAOA(aoa: Cell[][], name: string, entityType: string, entityId: number, uploadId?: number): Promise<{ id: number; name: string } | void> {
  if (!aoa?.length) return;
  const wb = wbFromAOA(aoa);
  const file = fileFromWB(wb, name);
  const url = uploadUrl(entityType, entityId, uploadId);
  const id = await postAndReturnId(file, url);
  return { id, name };
}

// PASTE FORMATTING (best-effort, CE-compatible)
// jspreadsheet-ce's own paste handling only carries over cell values, never
// styles (that's a Pro-only feature upstream). When copying from Excel/
// LibreOffice, the OS clipboard also carries a `text/html` payload with a
// <table> whose cells are styled either inline or via a <style> block
// (Excel commonly emits classes like "xl65" defined in <style>, not fully
// inline styles). This walks that HTML to recover a best-effort per-cell CSS
// string (background color, text color, bold, italic, underline) so callers
// can feed it into jspreadsheet's setStyle() after the normal value-only
// paste has already happened.

// grab the html clipboard payload from a native ClipboardEvent, if present
export function getHtmlClipboardTable(event: ClipboardEvent): string | null {
  return event.clipboardData?.getData('text/html') || null;
}

// parse a pasted <table> and return a same-shaped grid of CSS style strings
// (or null for cells with no notable formatting). Returns null entirely if
// no <table> could be found in the given HTML.
export function extractHtmlCellStyles(html: string): (string | null)[][] | null {
  if (!html) return null;
  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(html, 'text/html');
  const table = parsedDoc.querySelector('table');
  if (!table) return null;

  // render a hidden clone in the live document so getComputedStyle() resolves
  // any <style> block class rules, not just inline style="" attributes
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute; left:-99999px; top:-99999px; visibility:hidden;';
  const styleBlocks = Array.from(parsedDoc.querySelectorAll('style')).map((s) => s.outerHTML).join('');
  container.innerHTML = styleBlocks + table.outerHTML;
  document.body.appendChild(container);

  try {
    const liveTable = container.querySelector('table');
    if (!liveTable) return null;
    const rows = Array.from(liveTable.querySelectorAll('tr'));
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      return cells.map((cell) => cellComputedStyle(cell as HTMLElement));
    });
  } finally {
    document.body.removeChild(container);
  }
}

function cellComputedStyle(cell: HTMLElement): string | null {
  const computed = window.getComputedStyle(cell);
  const parts: string[] = [];

  const bg = computed.backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    parts.push(`background-color: ${bg}`);
  }
  const color = computed.color;
  // rgb(0, 0, 0) is the default/unset color, not worth carrying over
  if (color && color !== 'rgb(0, 0, 0)') {
    parts.push(`color: ${color}`);
  }
  const weight = computed.fontWeight;
  if (weight === 'bold' || (Number.isFinite(parseInt(weight, 10)) && parseInt(weight, 10) >= 600)) {
    parts.push('font-weight: bold');
  }
  if (computed.fontStyle === 'italic') {
    parts.push('font-style: italic');
  }
  if (computed.textDecorationLine?.includes('underline')) {
    parts.push('text-decoration: underline');
  }

  return parts.length ? `${parts.join('; ')};` : null;
}

// convert a 0-based column index to spreadsheet-style letters (0 -> "A", 26 -> "AA")
export function columnIndexToLetters(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
