/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2023 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

import { ApiC } from './api';
import { Action } from './interfaces';
import DiffMatchPatch from 'diff-match-patch';
import { notify } from './notify';
import DOMPurify from 'dompurify';
import { on } from './handlers';

interface CheckedRevision {
  id: number;
  revid: number;
}

interface DiffArr {
  0: DiffMatchPatch.DIFF_DELETE | DiffMatchPatch.DIFF_INSERT | DiffMatchPatch.DIFF_EQUAL;
  1: string;
}

interface SimpleSpreadsheetGrid {
  colHeaders: string[];
  rowHeaders: string[];
  cells: string[][];
}

function findSpreadsheetTable(html: string): HTMLTableElement | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('table.elabftw-spreadsheet');
}

// A lightweight, read-only extraction: just enough structure (row/column
// headers and cell text) to diff, independent of the full inline-spreadsheet
// editing engine so this page's bundle stays free of jspreadsheet-ce.
function extractSimpleSpreadsheetGrid(table: HTMLTableElement): SimpleSpreadsheetGrid {
  const kind = table.dataset.spreadsheetStyle ?? 'standard';
  const headerRow = table.querySelector('thead > tr');
  const bodyRows = Array.from(table.querySelectorAll('tbody > tr'));
  if (kind === 'notebook') {
    const colHeaders = headerRow
      ? Array.from(headerRow.children).map(cell => cell.textContent?.trim() ?? '')
      : [];
    const cells = bodyRows.map(row => Array.from(row.children).map(cell => cell.textContent?.trim() ?? ''));
    return { colHeaders, rowHeaders: bodyRows.map((_row, index) => String(index + 1)), cells };
  }
  // standard / well-plate: the header row's first cell is a blank corner,
  // and every data row's first cell is its own row label (number or letter).
  const headerCells = headerRow ? Array.from(headerRow.children) : [];
  const colHeaders = headerCells.slice(1).map(cell => cell.textContent?.trim() ?? '');
  const rowHeaders: string[] = [];
  const cells = bodyRows.map(row => {
    const rowCells = Array.from(row.children);
    rowHeaders.push(rowCells[0]?.textContent?.trim() ?? '');
    return rowCells.slice(1).map(cell => cell.textContent?.trim() ?? '');
  });
  return { colHeaders, rowHeaders, cells };
}

// Renders a cell-level diff when both revisions contain a spreadsheet table,
// instead of the character-level diff-match-patch view, which reads as
// near-unreadable noise for a table (every style attribute recalculated on
// resize looks like a change even when no cell value did). Returns null to
// fall back to the normal diff when either side has no spreadsheet, so every
// other kind of content is completely unaffected.
//
// Known limitation: only the first spreadsheet in the body is compared, and
// cells are aligned by row/column position, so inserting a column in the
// middle will show everything after it as changed rather than shifted.
function renderSpreadsheetDiff(oldHtml: string, newHtml: string): HTMLElement | null {
  const oldTable = findSpreadsheetTable(oldHtml);
  const newTable = findSpreadsheetTable(newHtml);
  if (!oldTable || !newTable) return null;

  const oldGrid = extractSimpleSpreadsheetGrid(oldTable);
  const newGrid = extractSimpleSpreadsheetGrid(newTable);
  const rows = Math.max(oldGrid.cells.length, newGrid.cells.length);
  const cols = Math.max(oldGrid.colHeaders.length, newGrid.colHeaders.length);

  const wrapper = document.createElement('div');
  const legend = document.createElement('p');
  legend.className = 'text-muted';
  legend.style.fontSize = '0.85rem';
  legend.textContent = 'Cell-level changes to this spreadsheet. Strikethrough red is the previous '
    + 'value, green is the new one; unchanged cells are shown as-is.';
  wrapper.appendChild(legend);

  const table = document.createElement('table');
  table.className = 'table table-bordered table-sm';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  for (let col = 0; col < cols; col++) {
    const th = document.createElement('th');
    th.textContent = newGrid.colHeaders[col] ?? oldGrid.colHeaders[col] ?? '';
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let changedCount = 0;
  for (let row = 0; row < rows; row++) {
    const tr = document.createElement('tr');
    const rowHeaderCell = document.createElement('th');
    rowHeaderCell.textContent = newGrid.rowHeaders[row] ?? oldGrid.rowHeaders[row] ?? String(row + 1);
    tr.appendChild(rowHeaderCell);
    for (let col = 0; col < cols; col++) {
      const oldValue = oldGrid.cells[row]?.[col] ?? '';
      const newValue = newGrid.cells[row]?.[col] ?? '';
      const td = document.createElement('td');
      if (oldValue === newValue) {
        td.textContent = newValue;
      } else {
        changedCount += 1;
        td.style.backgroundColor = 'rgba(255, 214, 0, 0.15)';
        if (oldValue) {
          const removed = document.createElement('span');
          removed.style.color = '#dd1e00';
          removed.style.textDecoration = 'line-through';
          removed.textContent = oldValue;
          td.appendChild(removed);
          if (newValue) td.appendChild(document.createElement('br'));
        }
        if (newValue) {
          const added = document.createElement('span');
          added.style.color = '#54aa08';
          added.textContent = newValue;
          td.appendChild(added);
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);

  if (changedCount === 0) {
    const note = document.createElement('p');
    note.className = 'text-muted';
    note.textContent = 'No cell values changed between these two revisions '
      + '(only formatting or other body content may differ).';
    wrapper.appendChild(note);
  }
  return wrapper;
}

// count number of checked revisions
function getCheckedBoxes(): Array<CheckedRevision> {
  const checkedBoxes = [];
  document.querySelectorAll('input[type=checkbox]:checked').forEach((box: HTMLInputElement) => {
    checkedBoxes.push({
      id: parseInt(box.dataset.id),
      revid: parseInt(box.dataset.revid),
    });
  });
  // sort the array so we get correct colors for newest vs oldest
  return checkedBoxes.sort((a, b) => a.revid - b.revid);
}

// CHECKBOX REVISION
on('checkbox-revision', (el: HTMLElement) => {
  // background color for selected entities
  const bgColor = '#c4f9ff';
  document.getElementById('compareRevisionsDiv').removeAttribute('hidden');
  if ((el as HTMLInputElement).checked) {
    (el.closest('.list-group-item') as HTMLElement).style.backgroundColor = bgColor;
  } else {
    (el.closest('.list-group-item') as HTMLElement).style.backgroundColor = '';
  }
  const checkedBoxes = getCheckedBoxes();
  if (checkedBoxes.length === 2) {
    document.getElementById('compareRevisionsButton').removeAttribute('disabled');
  } else {
    document.getElementById('compareRevisionsButton').setAttribute('disabled', 'disabled');
  }
});

on('compare-revisions', async (el: HTMLElement) => {
  const checkedBoxes = getCheckedBoxes();
  if (checkedBoxes.length !== 2) {
    notify.error('revisions-error');
    return;
  }
  const json0 = await ApiC.getJson(`${el.dataset.type}/${checkedBoxes[0].id}/revisions/${checkedBoxes[0].revid}`);
  const json1 = await ApiC.getJson(`${el.dataset.type}/${checkedBoxes[1].id}/revisions/${checkedBoxes[1].revid}`);
  const diffDiv = document.getElementById('compareRevisionsDiffDiv');
  diffDiv.replaceChildren();

  const spreadsheetDiff = renderSpreadsheetDiff(json0.body, json1.body);
  if (spreadsheetDiff) {
    diffDiv.appendChild(spreadsheetDiff);
    return;
  }

  const dmp = new DiffMatchPatch();
  const diff = dmp.diff_main(json0.body, json1.body);
  diff.forEach((part: DiffArr) => {
    let color = '';
    const res = part[0];
    if (res === DiffMatchPatch.DIFF_DELETE) {
      color = '#dd1e00';
    }
    if (res === DiffMatchPatch.DIFF_INSERT) {
      color = '#54aa08';
    }
    const span = document.createElement('span');
    span.style.color = color;
    const html = DOMPurify.sanitize(part[1], { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'script', 'iframe', 'form'] });
    span.innerHTML = html;
    diffDiv.appendChild(span);
  });
});

on('restore-revision', (el: HTMLElement) => {
  ApiC.patch(`${el.dataset.type}/${el.dataset.id}/revisions/${el.dataset.revid}`, {'action': Action.Replace});
});
