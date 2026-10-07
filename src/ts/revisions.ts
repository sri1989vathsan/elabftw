/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2023 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

import { ApiC } from './api';
import { Action, EntityType } from './interfaces';
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

interface TemplateVersionDoc {
  label: string;
  notes: string;
}

interface TemplateMetadata {
  elabftw?: {
    template_version_docs?: Record<string, TemplateVersionDoc>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
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
  // Scoped to this page's own revision checkboxes (data-action
  // 'checkbox-revision') -- a bare 'input[type=checkbox]:checked' matched
  // any already-checked checkbox anywhere on the page (e.g. a todolist
  // task in the side panel), which has no data-id/data-revid of its own
  // and so counted as an extra, bogus selection: checking a single real
  // revision box already looked like 2 selections were made (enabling
  // Compare too early), and checking 2 looked like 3 (leaving it disabled).
  document.querySelectorAll('input[data-action="checkbox-revision"]:checked').forEach((box: HTMLInputElement) => {
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

// Templates: the two sides' bodies are already embedded in the page (see
// revisions.html, id='templateVersionBody_<versionRowId>'), since
// readAllForEntity() already had them in hand at render time -- no need to
// hit an API at all, let alone the wrong one (core revisions, which these
// ids don't belong to).
function getTemplateVersionBody(revid: number): string {
  return document.querySelector(`#templateVersionBody_${revid} > div`)?.innerHTML ?? '';
}

on('compare-revisions', async (el: HTMLElement) => {
  const checkedBoxes = getCheckedBoxes();
  if (checkedBoxes.length !== 2) {
    notify.error('revisions-error');
    return;
  }
  const isTemplate = el.dataset.type === 'experiments_templates' || el.dataset.type === 'items_types';
  const body0 = isTemplate
    ? getTemplateVersionBody(checkedBoxes[0].revid)
    : (await ApiC.getJson(`${el.dataset.type}/${checkedBoxes[0].id}/revisions/${checkedBoxes[0].revid}`)).body;
  const body1 = isTemplate
    ? getTemplateVersionBody(checkedBoxes[1].revid)
    : (await ApiC.getJson(`${el.dataset.type}/${checkedBoxes[1].id}/revisions/${checkedBoxes[1].revid}`)).body;
  const diffDiv = document.getElementById('compareRevisionsDiffDiv');
  diffDiv.replaceChildren();

  const spreadsheetDiff = renderSpreadsheetDiff(body0, body1);
  if (spreadsheetDiff) {
    diffDiv.appendChild(spreadsheetDiff);
    return;
  }

  const dmp = new DiffMatchPatch();
  const diff = dmp.diff_main(body0, body1);
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

// This page (revisions.php) only ever shows a version's history -- it has
// no "edit" mode of its own to redirect back into. A relative
// `?mode=edit&id=...` stayed on this same page, landing on
// revisions.php?mode=edit&id=... instead of the entity's own editor: that
// page's own controller requires `type`/`item_id`, not `mode`/`id`, so the
// request threw before rendering anything -- a blank page, though the
// restore itself (the PATCH above, already awaited by the time this runs)
// had already succeeded and is not lost by that broken redirect or by
// reloading afterward. Matches EntityType::toPage() on the PHP side --
// each entity type (plus the two template kinds, each edited on their own
// separate page) needs its own mapping, not one shared page name.
function entityEditUrl(entityType: string, id: string): string {
  const pages: Record<string, string> = {
    [EntityType.Experiment]: 'experiments.php',
    [EntityType.Item]: 'database.php',
    [EntityType.Template]: 'templates.php',
    [EntityType.ItemType]: 'resources-templates.php',
  };
  const page = pages[entityType] ?? 'experiments.php';
  return `${page}?mode=edit&id=${id}`;
}

// This page is also loaded inside an <iframe> (the "Version history" popup
// on the edit page's own toolbar, see view-edit-toolbar.html) -- navigating
// plain `window` there would redirect the iframe itself to the full edit
// page, rendering its entire toolbar/editor squeezed inside the small
// popup instead of the real page underneath. window.top is that real,
// top-level page in both cases (itself, when this page isn't embedded at
// all), so navigating it both reaches the right page and discards the
// iframe/popup along with it, closing the popup as a side effect.
function topWindow(): Window {
  return window.top ?? window;
}

on('restore-revision', (el: HTMLElement) => {
  if (!confirm('Restore this revision? This replaces the current content.')) return;
  ApiC.patch(`${el.dataset.type}/${el.dataset.id}/revisions/${el.dataset.revid}`, {'action': Action.Replace})
    .then(() => topWindow().location.href = entityEditUrl(el.dataset.type, el.dataset.id))
    .catch(error => notify.error(error));
});

on('restore-template-version', (el: HTMLElement) => {
  if (!confirm(`Restore version ${el.dataset.version}? This replaces the current draft content and unlocks the template.`)) return;
  ApiC.patch(`${el.dataset.type}/${el.dataset.id}`, {
    action: Action.RestoreTemplateVersion,
    version_id: parseInt(el.dataset.versionid, 10),
  })
    .then(() => topWindow().location.href = entityEditUrl(el.dataset.type, el.dataset.id))
    .catch(error => notify.error(error));
});

function setTemplateVersionDocsEditMode(revisionId: string, editing: boolean): void {
  const container = document.getElementById(`templateVersionDocs_${revisionId}`);
  if (!container) return;
  container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    .forEach(field => field.disabled = !editing);
  const editButton = container.querySelector<HTMLElement>('[data-action="edit-template-version-docs"]');
  const saveButton = container.querySelector<HTMLElement>('[data-action="save-template-version-docs"]');
  const cancelButton = container.querySelector<HTMLElement>('[data-action="cancel-template-version-docs"]');
  if (!editButton || !saveButton || !cancelButton) return;
  editButton.hidden = editing;
  saveButton.hidden = !editing;
  cancelButton.hidden = !editing;
  if (editing) {
    container.querySelector<HTMLInputElement>('input')?.focus();
  }
}

on('edit-template-version-docs', (el: HTMLElement) => {
  setTemplateVersionDocsEditMode(el.dataset.revid, true);
});

on('cancel-template-version-docs', (el: HTMLElement) => {
  const container = document.getElementById(`templateVersionDocs_${el.dataset.revid}`);
  container?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    .forEach(field => field.value = field.defaultValue);
  setTemplateVersionDocsEditMode(el.dataset.revid, false);
});

on('save-template-version-docs', async (el: HTMLElement) => {
  const label = (document.getElementById(`templateVersionLabel_${el.dataset.revid}`) as HTMLInputElement).value.trim();
  const notes = (document.getElementById(`templateVersionNotes_${el.dataset.revid}`) as HTMLTextAreaElement).value.trim();
  try {
    const entity = await ApiC.getJson(`${el.dataset.type}/${el.dataset.id}`);
    let metadata: TemplateMetadata = {};
    if (entity.metadata) {
      metadata = typeof entity.metadata === 'string' ? JSON.parse(entity.metadata) : entity.metadata;
    }
    metadata.elabftw ??= {};
    metadata.elabftw.template_version_docs ??= {};
    if (label || notes) {
      metadata.elabftw.template_version_docs[el.dataset.revid] = {label, notes};
    } else {
      delete metadata.elabftw.template_version_docs[el.dataset.revid];
      if (Object.keys(metadata.elabftw.template_version_docs).length === 0) {
        delete metadata.elabftw.template_version_docs;
      }
    }
    await ApiC.patch(`${el.dataset.type}/${el.dataset.id}`, {metadata: JSON.stringify(metadata)});
    const container = document.getElementById(`templateVersionDocs_${el.dataset.revid}`);
    container?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
      .forEach(field => field.defaultValue = field.value);
    setTemplateVersionDocsEditMode(el.dataset.revid, false);
    notify.success('Template version documentation saved.');
  } catch (error) {
    notify.error(error);
  }
});
