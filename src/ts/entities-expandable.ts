/**
 * Expandable table of the resources: one row per resource, opened to show its fields,
 * its storage with the total stock and its recent activity
 */
import { ApiC } from './api';
import { Action } from './interfaces';
import { getEntityTypeFromPage } from './misc';
import { el, fieldLabel, filterParams, linkify, plainText, sortableHeader, sortRows, storageUrl } from './entities-view-utils';
import type { SortState } from './entities-view-utils';

type ExtraField = { name: string; value: string };
type StorageLocation = { storage_id: number; is_primary?: boolean; comment?: string | null; position?: string | null; path: string; qty_stored: number; qty_unit: string };
type WebLink = { id: string; label: string; url: string };
type SequenceFile = { id: number; long_name: string; real_name: string; storage: number };
type InternalLink = { page: string; entityid: number; title: string; category_title: string | null; category_color: string | null };
type Row = {
  id: number;
  // the number of the entry in its module (plasmids, primers... each count on their own); the row number is only internal
  custom_id?: number | null;
  personal_id?: number | null;
  title: string;
  category?: number | null;
  category_title: string | null;
  category_color: string | null;
  fullname: string;
  storage_locations?: StorageLocation[];
  extra_fields?: ExtraField[];
  web_links?: WebLink[];
  sequence_files?: SequenceFile[];
};
type Change = { created_at: string; target: string; content: string | null; fullname: string | null };

const RECENT_CHANGES = 5;

type Column = { key: string; label: string; numeric: boolean; get: (row: Row) => string | number };

const quantityOf = (row: Row): number | '' => {
  const locations = row.storage_locations ?? [];
  return locations.length > 0 ? locations.reduce((sum, l) => sum + Number(l.qty_stored), 0) : '';
};
const gcOf = (bases: string): number | '' => bases === '' ? '' : Math.round(((bases.match(/[GC]/g) ?? []).length / bases.length) * 1000) / 10;
const numberOrEmpty = (value: string): number | '' => value !== '' && Number.isFinite(Number(value)) ? Number(value) : '';


// the dialog of a copy: in which folder of the database it goes (the folders are the ones of the folders panel); resolves to the
// the folder id (0 for no folder) and whether the copy goes to the Database, or null when the user cancels
function askCopyFolder(title: string): Promise<{ folder: number; toDatabase: boolean } | null> {
  return new Promise(resolve => {
    const back = el('div', 'copy-backdrop');
    const box = el('div', 'copy-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.append(el('h5', '', `Copy ${title}`));
    // a local copy stays with the user until it is registered; a copy to the Database is in All entries at once
    const where = el('div', 'mb-2');
    const choice = (value: string, text: string, checked: boolean): HTMLLabelElement => {
      const label = el('label', 'd-block');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'copy-where';
      radio.value = value;
      radio.checked = checked;
      label.append(radio, document.createTextNode(` ${text}`));
      return label;
    };
    where.append(
      choice('local', 'Copy for myself: in My entries, only you see it, no number until you register it', true),
      choice('database', 'Copy to the Database: in All entries now, registered with the next number of its module', false),
    );
    box.append(where);
    const label = el('label', '', 'Folder');
    const select = el('select', 'form-control form-control-sm');
    const none = el('option', '', 'No folder');
    none.value = '0';
    select.append(none);
    document.querySelectorAll<HTMLOptionElement>('#newFolderParent option').forEach(option => {
      if (!option.value) return;
      const own = el('option', '', option.textContent ?? '');
      own.value = option.value;
      select.append(own);
    });
    label.append(select);
    box.append(label);
    const buttons = el('div', 'copy-dialog-buttons');
    const cancel = el('button', 'btn btn-secondary btn-sm', 'Cancel');
    cancel.type = 'button';
    const ok = el('button', 'btn btn-primary btn-sm', 'Copy');
    ok.type = 'button';
    const done = (value: { folder: number; toDatabase: boolean } | null): void => {
      back.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => done(null));
    ok.addEventListener('click', () => done({ folder: parseInt(select.value, 10) || 0, toDatabase: (box.querySelector('input[name="copy-where"]:checked') as HTMLInputElement | null)?.value === 'database' }));
    back.addEventListener('click', event => {
      if (event.target === back) done(null);
    });
    buttons.append(cancel, ok);
    box.append(buttons);
    back.append(box);
    document.body.append(back);
    select.focus();
  });
}

// the rules of the modules, set by the admins (the Modules page): the columns of the list of a module and the field that holds its sequence
type ModuleSettings = { columns: { key: string; label: string }[]; sequence_field: string | null };
let moduleSettings = new Map<number, ModuleSettings>();

async function loadModuleSettings(): Promise<void> {
  try {
    const response = await fetch('registry-modules.php', { credentials: 'same-origin' });
    const body = await response.json() as { modules: { id: number; settings: ModuleSettings }[] };
    moduleSettings = new Map(body.modules.map((m): [number, ModuleSettings] => [m.id, m.settings]));
  } catch {
    // without the settings the lists have the default columns
    moduleSettings = new Map();
  }
}

// a field of an entry: by its name, or by the start of its name (a name can be written a little differently from one entry to another)
const fieldNamed = (row: Row, name: string): string => {
  const fields = row.extra_fields ?? [];
  const wanted = name.toLowerCase();
  return (fields.find(f => f.name === name) ?? fields.find(f => f.name.toLowerCase().startsWith(wanted)))?.value ?? '';
};

// the category is in the tabs and the location in the opened row: no columns for them. The columns of a list of one module are the ones
// its admin chose; a list that mixes modules has the ones that every module has
function columnsFor(rows: Row[], withExtra = true): Column[] {
  const columns = defaultColumnsFor(rows);
  if (!withExtra) {
    return columns;
  }
  // the fields the user chose to show besides the columns of the module, after them
  loadExtraColumns(moduleKeyOf(rows)).forEach(name => {
    if (!rows.some(r => (r.extra_fields ?? []).some(f => f.name === name))) {
      return;
    }
    const values = rows.map(r => fieldNamed(r, name)).filter(v => v !== '');
    const numeric = values.length > 0 && values.every(v => Number.isFinite(Number(v)));
    const key = `field:${name}`;
    columns.push(numeric ? { key, label: name, numeric: true, get: r => numberOrEmpty(fieldNamed(r, name)) } : { key, label: name, numeric: false, get: r => fieldNamed(r, name) });
  });
  return columns;
}

// the fields that entries have and the columns of the module do not show: the ones a user can add
function otherFieldsOf(rows: Row[]): string[] {
  const shown = columnsFor(rows, false).map(c => c.key).filter(k => k.startsWith('field:') || k === 'Sequence');
  const names = new Set<string>();
  rows.forEach(r => (r.extra_fields ?? []).forEach(f => names.add(f.name)));
  // the field that holds the sequence is the Sequence column
  const first = rows[0]?.category ?? null;
  const sequenceField = (first !== null && rows.every(r => r.category === first) ? moduleSettings.get(first)?.sequence_field : null) ?? null;
  return [...names].filter(name => !(sequenceField !== null && name.toLowerCase() === sequenceField.toLowerCase()) && !shown.some(k => k.startsWith('field:') && (name === k.slice(6) || name.toLowerCase().startsWith(k.slice(6).toLowerCase()))));
}

function defaultColumnsFor(rows: Row[]): Column[] {
  const text = (key: string, label: string, get: (row: Row) => string | number): Column => ({ key, label, numeric: false, get });
  const num = (key: string, label: string, get: (row: Row) => string | number): Column => ({ key, label, numeric: true, get });
  const columns: Column[] = [num('ID', 'ID', r => r.custom_id ?? 0), text('Title', 'Title', r => r.title ?? '')];
  // in My entries each entry has two numbers: the ID of the lab and the ID of its owner
  if (new URLSearchParams(window.location.search).get('planned') === '1') {
    columns.splice(1, 0, num('MyID', 'My ID', r => r.personal_id ?? 0));
  }
  const hasFiles = rows.some(r => (r.sequence_files ?? []).length > 0);
  const filesOf = (r: Row): string => (r.sequence_files ?? []).map(f => f.real_name).join(' ');
  const first = rows[0]?.category ?? null;
  const settings = first !== null && rows.every(r => r.category === first) ? moduleSettings.get(first) : undefined;
  if (!settings || settings.columns.length === 0) {
    if (hasFiles) {
      columns.push(text('Files', 'Sequence', filesOf));
    }
    columns.push(num('Quantity', 'Quantity', quantityOf), text('Owner', 'Owner', r => r.fullname ?? ''));
    return columns;
  }
  const sequenceOf = (r: Row): string => settings.sequence_field ? fieldNamed(r, settings.sequence_field).toUpperCase().replace(/[^A-Z]/g, '') : '';
  settings.columns.forEach(c => {
    if (c.key === 'files') {
      if (hasFiles) columns.push(text('Files', c.label, filesOf));
    } else if (c.key === 'quantity') {
      columns.push(num('Quantity', c.label, quantityOf));
    } else if (c.key === 'owner') {
      columns.push(text('Owner', c.label, r => r.fullname ?? ''));
    } else if (c.key === 'calc:length') {
      columns.push(num('Length', c.label, r => sequenceOf(r).length || ''));
    } else if (c.key === 'calc:gc') {
      columns.push(num('GC', c.label, r => gcOf(sequenceOf(r))));
    } else if (c.key.startsWith('field:')) {
      const name = c.key.slice(6);
      const values = rows.map(r => fieldNamed(r, name)).filter(v => v !== '');
      const numeric = values.length > 0 && values.every(v => Number.isFinite(Number(v)));
      // the field that holds the sequence is shown in the sequence style
      const isSequence = settings.sequence_field !== null && name.toLowerCase() === settings.sequence_field.toLowerCase();
      const key = isSequence ? 'Sequence' : c.key;
      columns.push(numeric ? num(key, c.label, r => numberOrEmpty(fieldNamed(r, name))) : text(key, c.label, r => fieldNamed(r, name)));
    }
  });
  return columns;
}

// the columns a user hides or adds, kept on the server for each user and module (a module key is the id of the module, or "mixed" for the
// lists that have several modules); what the browser kept before is sent to the server once
type ColumnChoice = { hidden: string[]; extra: string[] };
const HIDDEN_COLUMNS_KEY = 'registry_hidden_columns_v1';
const EXTRA_COLUMNS_KEY = 'registry_extra_columns_v1';
let columnChoices = new Map<string, ColumnChoice>();
const moduleKeyOf = (rows: Row[]): string => {
  const first = rows[0]?.category ?? null;
  return first !== null && rows.every(r => r.category === first) ? String(first) : 'mixed';
};
const csrfToken = (): string => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

function saveColumnChoice(moduleKey: string): void {
  const choice = columnChoices.get(moduleKey) ?? { hidden: [], extra: [] };
  void fetch('registry-columns.php', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrfToken() },
    body: JSON.stringify({ module_key: moduleKey, hidden: choice.hidden, extra: choice.extra }),
  }).catch(() => {
    // the choice stays for this visit, it is saved with the next change
  });
}

async function loadColumnChoices(): Promise<void> {
  try {
    const response = await fetch('registry-columns.php', { credentials: 'same-origin' });
    const body = await response.json() as { prefs: Record<string, ColumnChoice> };
    columnChoices = new Map(Object.entries(body.prefs));
  } catch {
    columnChoices = new Map();
    return;
  }
  // what this browser kept before the choices were on the server goes to the server, for the modules that have no choice there yet
  try {
    const oldHidden = JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? '{}') as Record<string, string[]>;
    const oldExtra = JSON.parse(localStorage.getItem(EXTRA_COLUMNS_KEY) ?? '{}') as Record<string, string[]>;
    new Set([...Object.keys(oldHidden), ...Object.keys(oldExtra)]).forEach(key => {
      if (!columnChoices.has(key)) {
        columnChoices.set(key, { hidden: oldHidden[key] ?? [], extra: oldExtra[key] ?? [] });
        saveColumnChoice(key);
      }
    });
    localStorage.removeItem(HIDDEN_COLUMNS_KEY);
    localStorage.removeItem(EXTRA_COLUMNS_KEY);
  } catch {
    // no browser storage: nothing to send
  }
}

const loadHiddenColumns = (moduleKey: string): Set<string> => new Set(columnChoices.get(moduleKey)?.hidden ?? []);
const loadExtraColumns = (moduleKey: string): Set<string> => new Set(columnChoices.get(moduleKey)?.extra ?? []);
function saveHiddenColumns(moduleKey: string, hidden: Set<string>): void {
  columnChoices.set(moduleKey, { hidden: [...hidden], extra: columnChoices.get(moduleKey)?.extra ?? [] });
  saveColumnChoice(moduleKey);
}
function saveExtraColumns(moduleKey: string, extra: Set<string>): void {
  columnChoices.set(moduleKey, { hidden: columnChoices.get(moduleKey)?.hidden ?? [], extra: [...extra] });
  saveColumnChoice(moduleKey);
}

// a filter on a column: text is searched in the value, a number can be compared (">50", "<=60", "55-62")
function matchesFilter(value: string | number, filter: string, numeric: boolean): boolean {
  const f = filter.trim();
  if (f === '') {
    return true;
  }
  if (numeric) {
    const range = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/.exec(f);
    const compare = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(f);
    if (range || compare) {
      if (typeof value !== 'number') {
        return false;
      }
      if (range) {
        return value >= Number(range[1]) && value <= Number(range[2]);
      }
      const n = Number(compare?.[2]);
      switch (compare?.[1]) {
      case '>': return value > n;
      case '<': return value < n;
      case '>=': return value >= n;
      case '<=': return value <= n;
      default: return value === n || String(value).startsWith(String(n));
      }
    }
  }
  return String(value).toLowerCase().includes(f.toLowerCase());
}

type TableState = { filters: Map<string, string>; selected: Set<number>; onSelectionChange: () => void; page: number };

// how many entries one page of the table shows (0 is all of them): the same for every module, remembered in this browser
// the order of the table: the highest ID first, until the user clicks another column (the choice is remembered in this browser)
const SORT_KEY = 'registry_table_sort';
const DEFAULT_SORT: SortState = { key: 'ID', asc: false };

function loadSort(): SortState {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null') as SortState | null;
    if (saved && typeof saved.key === 'string' && typeof saved.asc === 'boolean') {
      return saved;
    }
  } catch {
    // localStorage might be unavailable
  }
  return { ...DEFAULT_SORT };
}

function saveSort(sort: SortState): void {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(sort));
  } catch {
    // localStorage might be unavailable
  }
}

const PAGE_SIZES = [25, 50, 100, 250, 0];
const PAGE_SIZE_KEY = 'registry_page_size';

function loadPageSize(): number {
  try {
    const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return localStorage.getItem(PAGE_SIZE_KEY) !== null && PAGE_SIZES.includes(saved) ? saved : 50;
  } catch {
    return 50;
  }
}

function savePageSize(size: number): void {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
  } catch {
    // localStorage might be unavailable
  }
}

let rootEl: HTMLElement | null = null;
let onFiltersChanged: ((event: Event) => void) | null = null;
let requestId = 0;

function totalStock(locations: StorageLocation[]): string {
  const sums = new Map<string, number>();
  locations.forEach(l => sums.set(l.qty_unit, (sums.get(l.qty_unit) ?? 0) + Number(l.qty_stored)));
  return [...sums.entries()].map(([unit, qty]) => `${Math.round(qty * 100) / 100} ${unit}`.trim()).join(', ');
}

function section(title: string): HTMLElement {
  const box = el('div', 'expandable-section');
  box.append(el('h5', '', title));
  return box;
}

function buildDetail(row: Row): HTMLElement {
  const detail = el('div', 'expandable-detail');

  // the Link of the entry comes first, so it is seen as soon as the row is opened
  const fields = [...(row.extra_fields ?? [])].sort((a, b) => Number(/^link$/i.test(b.name)) - Number(/^link$/i.test(a.name)));
  if (fields.length > 0) {
    const box = section('Details');
    const grid = el('div', 'expandable-fields');
    fields.forEach(f => {
      const cell = el('div', 'expandable-field');
      const value = el('div');
      value.append(f.value === '' && /^link$/i.test(f.name) ? document.createTextNode('–') : linkify(f.value));
      cell.append(el('div', 'expandable-field-label', f.name), value);
      grid.append(cell);
    });
    box.append(grid);
    detail.append(box);
  }

  const locations = row.storage_locations ?? [];
  const storage = section('Storage');
  if (locations.length === 0) {
    storage.append(el('p', 'text-muted mb-0', 'Not stored anywhere.'));
  } else {
    storage.append(el('p', 'mb-1', `Total stock: ${totalStock(locations)}`));
    // the tubes in one location are one line: the slots as chips, the quantity added up
    const byStorage = new Map<number, StorageLocation[]>();
    locations.forEach(l => byStorage.set(l.storage_id, [...(byStorage.get(l.storage_id) ?? []), l]));
    const list = el('ul', 'entity-storage-list');
    byStorage.forEach(tubes => {
      const li = el('li');
      const where = el('a', '', tubes[0].path);
      where.href = storageUrl(tubes[0].storage_id);
      const slots = el('span', 'storage-tube-slots');
      tubes.forEach(l => {
        if (l.position) {
          const chip = el('span', `storage-slot-chip ${l.is_primary ? 'is-primary' : 'is-secondary'}`, l.position);
          chip.title = l.comment ? `${l.is_primary ? 'Primary' : 'Secondary'}: ${l.comment}` : (l.is_primary ? 'Primary' : 'Secondary');
          slots.append(chip);
        }
      });
      const hasPrimary = tubes.some(l => l.is_primary);
      li.append(
        el('span', `storage-kind storage-kind-${hasPrimary ? 'primary' : 'secondary'}`, hasPrimary ? 'Primary' : 'Secondary'),
        where,
        slots,
        el('span', 'color-medium', tubes.length > 1 ? `${totalStock(tubes)} (${tubes.length} tubes)` : totalStock(tubes)),
      );
      list.append(li);
    });
    storage.append(list);
  }
  detail.append(storage);

  // external links of the resource are in the list, the internal ones are fetched with the activity
  const links = section('Links');
  const webLinks = row.web_links ?? [];
  webLinks.forEach(w => {
    const a = el('a', 'd-block', w.label || w.url);
    a.href = w.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = w.url;
    links.append(a);
  });
  const internal = el('div');
  links.append(internal);
  detail.append(links);

  const activity = section('Recent activity');
  activity.append(el('p', 'text-muted mb-0', 'Loading...'));
  detail.append(activity);
  // the changelog is not part of the list: fetch it when the row is opened
  void ApiC.getJson<{ changelog?: Change[]; items_links?: InternalLink[]; experiments_links?: InternalLink[] }>(`inventory/${row.id}`, { notifOnError: 0 }).then(item => {
    const internalLinks = [...(item.items_links ?? []), ...(item.experiments_links ?? [])];
    internalLinks.forEach(l => {
      const a = el('a', 'd-block');
      a.href = `${l.page}?mode=view&id=${encodeURIComponent(String(l.entityid))}`;
      a.append(el('i', 'fas fa-arrow-right fa-fw mr-1'), document.createTextNode(l.title));
      internal.append(a);
    });
    if (internalLinks.length === 0 && webLinks.length === 0) {
      links.append(el('p', 'text-muted mb-0', 'No links.'));
    }
    const changes = (item.changelog ?? []).slice(0, RECENT_CHANGES);
    activity.lastElementChild?.remove();
    if (changes.length === 0) {
      activity.append(el('p', 'text-muted mb-0', 'No activity yet.'));
      return;
    }
    const table = el('table', 'table table-sm mb-0');
    const tbody = el('tbody');
    changes.forEach(c => {
      const tr = el('tr');
      tr.append(el('td', 'text-nowrap', c.created_at), el('td', '', c.fullname ?? ''), el('td', 'text-nowrap', fieldLabel(c.target)), el('td', '', plainText(c.content)));
      tbody.append(tr);
    });
    table.append(tbody);
    activity.append(table);
  }).catch(() => {
    links.append(el('p', 'text-muted mb-0', 'The links could not be loaded.'));
    activity.lastElementChild?.remove();
    activity.append(el('p', 'text-muted mb-0', 'The activity could not be loaded.'));
  });

  const open = el('a', 'btn btn-secondary btn-sm', 'Open');
  open.href = `?mode=view&id=${encodeURIComponent(String(row.id))}`;
  detail.append(open);
  return detail;
}

function render(container: HTMLElement, allRows: Row[], sort: SortState | null, onSort: (sort: SortState) => void, ui: TableState): void {
  container.replaceChildren();
  if (allRows.length === 0) {
    container.append(el('p', 'text-muted', 'Nothing to show.'));
    return;
  }
  // the ID stays (it opens the entry when the title is hidden); the other columns can be hidden by the user (button Columns)
  const hidden = loadHiddenColumns(moduleKeyOf(allRows));
  const columns = columnsFor(allRows).filter(c => c.key === 'ID' || !hidden.has(c.key));
  const mixedModules = new Set(allRows.map(r => r.category_title ?? '')).size > 1;
  const table = el('table', 'table table-sm expandable-table');
  const head = el('tr');
  head.append(el('th', 'expandable-caret-cell'));
  const selectAll = el('input');
  selectAll.type = 'checkbox';
  selectAll.setAttribute('aria-label', 'Select all the rows shown');
  const selectHead = el('th', 'expandable-select-cell');
  selectHead.append(selectAll);
  head.append(selectHead);
  columns.forEach(c => {
    const th = el('th', c.key === 'ID' ? 'id-cell' : '');
    sortableHeader(th, c.label, c.key, sort, onSort);
    head.append(th);
  });
  // the last column holds the copy button of each row
  head.append(el('th', 'expandable-actions-cell'));
  // a filter on each column, the rows shown are the ones that pass all of them
  const filterRow = el('tr', 'expandable-filter-row');
  filterRow.append(el('th'), el('th'));
  // the pager: the entries on each page, and the buttons to go to the previous and the next page (above and below the table)
  const pagers = [el('div', 'd-flex flex-wrap align-items-center mb-1'), el('div', 'd-flex flex-wrap align-items-center mt-1')];
  columns.forEach(c => {
    const th = el('th', c.key === 'ID' ? 'id-cell' : '');
    const input = el('input', 'form-control form-control-sm expandable-filter');
    input.type = 'search';
    input.placeholder = c.numeric ? 'e.g. >50' : 'filter';
    input.value = ui.filters.get(c.key) ?? '';
    input.setAttribute('aria-label', `Filter ${c.label}`);
    input.addEventListener('input', () => {
      ui.filters.set(c.key, input.value);
      ui.page = 0;
      fillBody();
    });
    th.append(input);
    filterRow.append(th);
  });
  filterRow.append(el('th', 'expandable-actions-cell'));
  const thead = el('thead');
  thead.append(head, filterRow);
  const body = el('tbody');
  const valueOf = (row: Row, key: string): string | number => columns.find(c => c.key === key)?.get(row) ?? '';
  let shown: Row[] = [];

  const syncSelectAll = (): void => {
    const selectedShown = shown.filter(r => ui.selected.has(r.id)).length;
    selectAll.checked = shown.length > 0 && selectedShown === shown.length;
    selectAll.indeterminate = selectedShown > 0 && selectedShown < shown.length;
  };
  selectAll.addEventListener('change', () => {
    shown.forEach(r => {
      if (selectAll.checked) {
        ui.selected.add(r.id);
      } else {
        ui.selected.delete(r.id);
      }
    });
    body.querySelectorAll<HTMLInputElement>('.expandable-select-cell input').forEach(box => {
      box.checked = selectAll.checked;
    });
    ui.onSelectionChange();
    syncSelectAll();
  });

  function drawPagers(total: number, from: number, to: number, pageSize: number): void {
    pagers.forEach(pager => {
      pager.replaceChildren();
      const text = el('span', 'text-muted small mr-3', total === allRows.length ? `${total === 0 ? 0 : from + 1}-${to} of ${total}` : `${total === 0 ? 0 : from + 1}-${to} of ${total} (${allRows.length} in all)`);
      pager.append(text);
      const previous = el('button', 'btn btn-transparent btn-sm', 'Previous');
      const next = el('button', 'btn btn-transparent btn-sm mr-3', 'Next');
      previous.type = next.type = 'button';
      previous.disabled = from === 0;
      next.disabled = pageSize === 0 || to >= total;
      previous.addEventListener('click', () => {
        ui.page = Math.max(0, ui.page - 1);
        fillBody();
      });
      next.addEventListener('click', () => {
        ui.page += 1;
        fillBody();
      });
      const choice = el('select', 'custom-select custom-select-sm w-auto');
      choice.setAttribute('aria-label', 'Entries per page');
      PAGE_SIZES.forEach(size => {
        const option = el('option', '', size === 0 ? 'All per page' : `${size} per page`);
        option.value = String(size);
        option.selected = size === pageSize;
        choice.append(option);
      });
      choice.addEventListener('change', () => {
        savePageSize(Number(choice.value));
        ui.page = 0;
        fillBody();
      });
      pager.append(previous, next, choice);
    });
  }

  function fillBody(): void {
    body.replaceChildren();
    const filtered = sortRows(allRows, sort, valueOf).filter(row => columns.every(c => matchesFilter(c.get(row), ui.filters.get(c.key) ?? '', c.numeric)));
    const pageSize = loadPageSize();
    const pages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
    ui.page = Math.min(ui.page, pages - 1);
    const from = pageSize === 0 ? 0 : ui.page * pageSize;
    const to = pageSize === 0 ? filtered.length : Math.min(filtered.length, from + pageSize);
    // the rows of this page: the ones that "select all" and the count are about
    shown = filtered.slice(from, to);
    shown.forEach(row => body.append(...buildRow(row, columns)));
    drawPagers(filtered.length, from, to, pageSize);
    syncSelectAll();
  }

  function buildRow(row: Row, cols: Column[]): HTMLElement[] {
    const locations = row.storage_locations ?? [];
    const tr = el('tr', 'expandable-row');
    const caretCell = el('td', 'expandable-caret-cell');
    const caret = el('button', 'btn btn-transparent btn-sm');
    caret.type = 'button';
    caret.setAttribute('aria-expanded', 'false');
    caret.setAttribute('aria-label', 'Expand');
    const icon = el('i', 'fas fa-fw fa-caret-right');
    caret.append(icon);
    caretCell.append(caret);
    tr.append(caretCell);
    const selectCell = el('td', 'expandable-select-cell');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = ui.selected.has(row.id);
    box.setAttribute('aria-label', `Select ${row.title}`);
    box.addEventListener('change', () => {
      if (box.checked) {
        ui.selected.add(row.id);
      } else {
        ui.selected.delete(row.id);
      }
      ui.onSelectionChange();
      syncSelectAll();
    });
    selectCell.append(box);
    tr.append(selectCell);
    cols.forEach(c => {
      switch (c.key) {
      case 'ID':
        // the ID stays in view when the table is scrolled sideways
        {
          // an entry without a number is not registered yet (an intermediate)
          const cell = el('td', 'id-cell', row.custom_id == null ? '–' : String(row.custom_id));
          if (row.custom_id == null) cell.title = 'Not registered: no number of the lab yet';
          // without the title column, the number opens the entry
          if (!cols.some(column => column.key === 'Title')) {
            const open = el('a', '', cell.textContent ?? '');
            open.href = `?mode=view&id=${encodeURIComponent(String(row.id))}`;
            open.title = row.title;
            cell.replaceChildren(open);
          }
          // modules count on their own: when the list mixes modules, the module is written under the number
          if (mixedModules && row.category_title) {
            const moduleName = el('span', 'id-module', row.category_title);
            moduleName.style.color = row.category_color ? `#${row.category_color}` : '';
            cell.append(moduleName);
          }
          tr.append(cell);
        }
        break;
      case 'MyID': {
        // the number of the owner in the module: it counts their entries from 1, and only My entries have the column
        const own = el('td', 'text-nowrap', row.personal_id == null ? '–' : String(row.personal_id));
        own.title = 'My ID: the number of its owner in this module';
        tr.append(own);
        break;
      }
      case 'Title': {
        const titleCell = el('td');
        const link = el('a', '', row.title);
        link.href = `?mode=view&id=${encodeURIComponent(String(row.id))}`;
        titleCell.append(link);
        tr.append(titleCell);
        break;
      }
      case 'Files': {
        // the sequence files of the entry open in the sequence editor, in a page of their own
        const sequenceCell = el('td', 'text-nowrap');
        (row.sequence_files ?? []).forEach(f => {
          const a = el('a', 'btn btn-secondary btn-sm mr-1');
          a.href = `sequence-viewer/index.php?entry=${row.id}&upload=${f.id}&f=${encodeURIComponent(f.long_name)}&name=${encodeURIComponent(f.real_name)}&storage=${f.storage}`;
          a.target = '_blank';
          a.rel = 'noopener';
          a.title = `Open ${f.real_name} in the sequence editor`;
          a.append(el('i', 'fas fa-dna fa-fw'));
          sequenceCell.append(a);
        });
        tr.append(sequenceCell);
        break;
      }
      case 'Quantity':
        tr.append(el('td', 'text-nowrap', locations.length > 0 ? totalStock(locations) : ''));
        break;
      case 'Sequence':
        tr.append(el('td', 'expandable-sequence', String(c.get(row))));
        break;
      default:
        tr.append(el('td', '', String(c.get(row))));
      }
    });

    // the actions of the row, at its right end: edit, copy (a copy of the entry with its files, opened to be edited) and print
    const actionCell = el('td', 'expandable-actions-cell text-nowrap text-right');
    const edit = el('a', 'btn btn-secondary btn-sm mr-1');
    edit.href = `?mode=edit&id=${encodeURIComponent(String(row.id))}`;
    edit.title = `Edit ${row.title}`;
    edit.setAttribute('aria-label', `Edit ${row.title}`);
    edit.append(el('i', 'fas fa-pencil-alt fa-fw'));
    const copy = el('button', 'btn btn-secondary btn-sm mr-1');
    copy.type = 'button';
    copy.title = `Make a copy of ${row.title}`;
    copy.setAttribute('aria-label', `Copy ${row.title}`);
    copy.append(el('i', 'fas fa-copy fa-fw'));
    copy.addEventListener('click', () => {
      // a copy goes to My entries (not registered, private, no number): the user says in which folder
      void askCopyFolder(row.title).then(choice => {
        if (choice === null) return;
        copy.disabled = true;
        const body: Record<string, unknown> = { action: Action.Duplicate, copyFiles: true, linkToOriginal: false };
        if (choice.folder > 0) body.folder_id = choice.folder;
        if (choice.toDatabase) body.registered = true;
        return ApiC.post2location(`inventory/${row.id}`, body)
          .then(id => {
            window.location.href = `?mode=edit&id=${id}`;
          })
          .catch(() => {
            copy.disabled = false;
          });
      });
    });
    // the label printing is not made yet: the button tells the page which entry was meant, and a handler can be added later
    const print = el('button', 'btn btn-secondary btn-sm');
    print.type = 'button';
    print.title = `Print a label for ${row.title}`;
    print.setAttribute('aria-label', `Print a label for ${row.title}`);
    print.append(el('i', 'fas fa-print fa-fw'));
    print.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('registry:print-label', { detail: { id: row.id, title: row.title } }));
    });
    actionCell.append(edit, copy, print);
    // antibodies and reagents are bought: the button makes an order of the entry, next to the label button
    if (/^(antibod|reagent|consumable)/i.test(row.category_title ?? '')) {
      const order = el('button', 'btn btn-secondary btn-sm ml-1');
      order.type = 'button';
      const kind = /^antibod/i.test(row.category_title ?? '') ? 'antibody' : (/^consumable/i.test(row.category_title ?? '') ? 'consumable' : 'reagent');
      order.title = `Order this ${kind}: ${row.title}`;
      order.setAttribute('aria-label', `Order this ${kind}: ${row.title}`);
      order.append(el('i', 'fas fa-cart-shopping fa-fw'));
      order.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('registry:order-entry', { detail: { id: row.id, title: row.title, category: row.category_title ?? '', fields: row.extra_fields ?? [] } }));
      });
      actionCell.append(order);
    }
    tr.append(actionCell);

    let detailRow: HTMLTableRowElement | null = null;
    caret.addEventListener('click', () => {
      if (detailRow) {
        detailRow.remove();
        detailRow = null;
        icon.className = 'fas fa-fw fa-caret-right';
        caret.setAttribute('aria-expanded', 'false');
        return;
      }
      detailRow = el('tr', 'expandable-detail-row');
      const cell = el('td');
      cell.colSpan = cols.length + 3;
      cell.append(buildDetail(row));
      detailRow.append(cell);
      tr.after(detailRow);
      icon.className = 'fas fa-fw fa-caret-down';
      caret.setAttribute('aria-expanded', 'true');
    });
    return [tr];
  }

  table.append(thead, body);
  fillBody();
  const wrap = el('div', 'table-responsive');
  wrap.append(table);
  container.append(pagers[0], wrap, pagers[1]);
}

export function mountExpandableTable(rootElement: HTMLElement | null, order: string, sort: string, onLoaded: () => void): void {
  if (!rootElement) {
    return;
  }
  unmountExpandableTable();
  rootEl = rootElement;

  const toolbar = el('div', 'mb-2 d-flex flex-wrap align-items-center');
  const expandAll = el('button', 'btn btn-transparent btn-sm', 'Expand all');
  const collapseAll = el('button', 'btn btn-transparent btn-sm', 'Collapse all');
  expandAll.type = collapseAll.type = 'button';
  toolbar.append(expandAll, collapseAll);
  // the columns the user sees: a button with the list of the columns to tick or untick, remembered for each module
  toolbar.style.position = 'relative';
  const columnsButton = el('button', 'btn btn-transparent btn-sm ml-2');
  columnsButton.type = 'button';
  columnsButton.append(el('i', 'fas fa-table-columns fa-fw mr-1'), document.createTextNode('Columns'));
  columnsButton.title = 'Choose the columns of the table';
  const columnsPanel = el('div', 'columns-panel');
  columnsPanel.hidden = true;
  toolbar.append(columnsButton, columnsPanel);
  // on the right: export (all of the module, or only the rows ticked) and import of entries as files
  const transferGroup = el('div', 'ml-auto d-flex');
  const exportButton = el('button', 'btn btn-secondary btn-sm mr-2');
  exportButton.type = 'button';
  const exportMenu = el('div', 'columns-panel');
  exportMenu.style.left = 'auto';
  exportMenu.style.right = '0';
  exportMenu.hidden = true;
  const importButton = el('button', 'btn btn-secondary btn-sm');
  importButton.type = 'button';
  importButton.append(el('i', 'fas fa-file-import fa-fw mr-1'), document.createTextNode('Import'));
  importButton.title = 'Add many entries at once from a CSV file or a ZIP with files';
  transferGroup.append(exportButton, importButton);
  toolbar.append(transferGroup, exportMenu);
  // the rows ticked can be sent to an order (the sequences of primers are written in its notes)
  // what can be done with the ticked rows: one menu, "Actions on selected", that appears when rows are ticked
  const selectionBar = el('div');
  selectionBar.style.position = 'relative';
  selectionBar.className = 'ml-3';
  selectionBar.hidden = true;
  const actionsButton = el('button', 'btn btn-primary btn-sm');
  actionsButton.type = 'button';
  const actionsMenu = el('div', 'columns-panel');
  actionsMenu.hidden = true;
  actionsMenu.style.minWidth = '17rem';
  actionsMenu.style.padding = '0.35rem';
  actionsButton.addEventListener('click', () => {
    actionsMenu.hidden = !actionsMenu.hidden;
  });
  document.addEventListener('click', event => {
    if (!actionsMenu.hidden && !selectionBar.contains(event.target as Node)) {
      actionsMenu.hidden = true;
    }
  });
  selectionBar.append(actionsButton, actionsMenu);
  toolbar.append(selectionBar);
  const menuItem = (button: HTMLButtonElement): void => {
    button.className = 'btn btn-transparent btn-sm d-block w-100 text-left';
    actionsMenu.append(button);
  };
  const orderButton = el('button', 'btn btn-secondary btn-sm', 'Send selected to an order');
  orderButton.type = 'button';
  orderButton.hidden = true;
  menuItem(orderButton);
  // in My entries the rows ticked can be added to the lab Database
  const databaseButton = el('button', 'btn btn-primary btn-sm', 'Add selected to the Database');
  databaseButton.type = 'button';
  databaseButton.hidden = true;
  menuItem(databaseButton);
  type RegistryTools = { addToDatabase: (ids: number[], done: () => void) => Promise<void>; assignOwner: (ids: number[], done: () => void) => Promise<void> };
  const registryTools = (): RegistryTools | undefined => (window as unknown as { RegistryTools?: RegistryTools }).RegistryTools;
  // the rows ticked can get another owner (an admin chooses it in the dialog)
  const ownerButton = el('button', 'btn btn-secondary btn-sm', 'Assign owner');
  ownerButton.type = 'button';
  ownerButton.hidden = true;
  menuItem(ownerButton);
  // the rows ticked move to another folder (or to none); the entries need the right to edit them
  const folderButton = el('button', 'btn btn-secondary btn-sm', 'Move to folder');
  folderButton.type = 'button';
  folderButton.hidden = true;
  const folderPanel = el('div', 'columns-panel');
  folderPanel.hidden = true;
  folderPanel.style.minWidth = '18rem';
  // the panel opens right under its button
  folderPanel.style.position = 'static';
  folderPanel.style.boxShadow = 'none';
  folderPanel.style.border = '0';
  folderPanel.style.padding = '0.4rem 0.6rem';
  folderPanel.style.minWidth = '0';
  menuItem(folderButton);
  actionsMenu.append(folderPanel);
  const csrfToken = (): string => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
  folderButton.addEventListener('click', () => {
    if (!folderPanel.hidden) {
      folderPanel.hidden = true;
      return;
    }
    folderPanel.replaceChildren(el('div', 'small text-muted', 'Loading the folders...'));
    folderPanel.hidden = false;
    void fetch('registry-transfer.php?folders=1', { credentials: 'same-origin' }).then(r => r.json()).then((body: { folders: { id: number; path: string; owner: number }[]; me: number }) => {
      const choice = el('select', 'form-control form-control-sm mb-2');
      choice.setAttribute('aria-label', 'Folder');
      // my folders, the folders of the lab Database, or all of them
      const scopes: [string, string, (f: { path: string; owner: number }) => boolean][] = [
        ['My folders', 'mine', f => f.owner === body.me],
        ['Database folders', 'database', f => /^Database items( >|$)/.test(f.path)],
        ['All folders', 'all', () => true],
      ];
      let scope = 'database';
      const fill = (): void => {
        choice.replaceChildren();
        const none = el('option', '', 'No folder (Unfiled)');
        none.value = '0';
        choice.append(none);
        const keep = scopes.find(([, key]) => key === scope)![2];
        body.folders.filter(keep).forEach(f => {
          const option = el('option', '', f.path);
          option.value = String(f.id);
          choice.append(option);
        });
      };
      const tabs = el('div', 'btn-group btn-group-sm d-flex mb-2');
      scopes.forEach(([label, key]) => {
        const tab = el('button', `btn btn-outline-secondary flex-fill${key === scope ? ' active' : ''}`, label);
        tab.type = 'button';
        tab.addEventListener('click', () => {
          scope = key;
          tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === tab));
          fill();
        });
        tabs.append(tab);
      });
      fill();
      const go = el('button', 'btn btn-primary btn-sm', `Move ${ui.selected.size} entries`);
      go.type = 'button';
      const note = el('div', 'small mt-1');
      go.addEventListener('click', () => {
        go.disabled = true;
        void fetch('registry-transfer.php', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrfToken() },
          body: JSON.stringify({ action: 'move_to_folder', ids: [...ui.selected], folder_id: Number(choice.value) }),
        }).then(r => r.json()).then((result: { moved?: number; refused?: number[]; error?: string }) => {
          if (result.error) {
            throw new Error(result.error);
          }
          const refused = result.refused?.length ?? 0;
          note.className = refused > 0 ? 'small mt-1 text-danger' : 'small mt-1 text-success';
          note.textContent = `${result.moved ?? 0} moved` + (refused > 0 ? `, ${refused} not moved (you cannot edit them)` : '');
          window.setTimeout(() => window.location.reload(), refused > 0 ? 2500 : 700);
        }).catch(error => {
          go.disabled = false;
          note.className = 'small mt-1 text-danger';
          note.textContent = error instanceof Error ? error.message : String(error);
        });
      });
      folderPanel.replaceChildren(tabs, choice, go, note);
    }).catch(() => {
      folderPanel.replaceChildren(el('div', 'small text-danger', 'The folders could not be loaded.'));
    });
  });
  const inMyEntries = new URLSearchParams(window.location.search).get('planned') === '1';
  const container = el('div');
  rootEl.replaceChildren(toolbar, container);
  let rows: Row[] = [];
  let tableSort: SortState | null = loadSort();
  const ui: TableState = {
    filters: new Map<string, string>(),
    selected: new Set<number>(),
    page: 0,
    onSelectionChange: () => {
      const tools = (window as unknown as { PrimerTools?: { sendToOrder: (ids: number[], done?: () => void) => void } }).PrimerTools;
      orderButton.hidden = ui.selected.size === 0 || !tools;
      databaseButton.hidden = ui.selected.size === 0 || !inMyEntries;
      ownerButton.hidden = ui.selected.size === 0;
      folderButton.hidden = ui.selected.size === 0;
      selectionBar.hidden = ui.selected.size === 0;
      actionsButton.textContent = `Actions on selected (${ui.selected.size}) ▾`;
      folderButton.textContent = 'Move to folder';
      orderButton.textContent = 'Send to an order';
      databaseButton.textContent = 'Add to the Database';
      ownerButton.textContent = 'Assign owner';
      if (ui.selected.size === 0) {
        folderPanel.hidden = true;
        actionsMenu.hidden = true;
      }
      refreshExportButton();
    },
  };
  orderButton.addEventListener('click', () => {
    const tools = (window as unknown as { PrimerTools?: { sendToOrder: (ids: number[], done?: () => void) => void } }).PrimerTools;
    tools?.sendToOrder([...ui.selected], () => {
      ui.selected.clear();
      ui.onSelectionChange();
      render(container, rows, tableSort, onSort, ui);
    });
  });
  databaseButton.addEventListener('click', () => {
    void registryTools()?.addToDatabase([...ui.selected], () => {
      ui.selected.clear();
      ui.onSelectionChange();
      window.location.reload();
    });
  });
  const fillColumnsPanel = (): void => {
    columnsPanel.replaceChildren();
    const moduleKey = moduleKeyOf(rows);
    const hidden = loadHiddenColumns(moduleKey);
    const extra = loadExtraColumns(moduleKey);
    const redraw = (): void => {
      render(container, rows, tableSort, onSort, ui);
    };
    columnsFor(rows, false).filter(c => c.key !== 'ID').forEach(c => {
      const label = el('label', 'd-block mb-1');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = !hidden.has(c.key);
      box.addEventListener('change', () => {
        if (box.checked) hidden.delete(c.key); else hidden.add(c.key);
        saveHiddenColumns(moduleKey, hidden);
        redraw();
      });
      label.append(box, document.createTextNode(` ${c.label}`));
      columnsPanel.append(label);
    });
    // the other fields the entries have: shown when the user wants them
    const others = otherFieldsOf(rows);
    if (others.length > 0) {
      columnsPanel.append(el('div', 'small text-muted mt-2 mb-1', 'More fields of these entries'));
      others.forEach(name => {
        const label = el('label', 'd-block mb-1');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = extra.has(name);
        box.addEventListener('change', () => {
          if (box.checked) extra.add(name); else extra.delete(name);
          saveExtraColumns(moduleKey, extra);
          redraw();
        });
        label.append(box, document.createTextNode(` ${name}`));
        columnsPanel.append(label);
      });
    }
    const showAll = el('button', 'btn btn-link btn-sm p-0 mt-1', 'Show the module columns again');
    showAll.type = 'button';
    showAll.addEventListener('click', () => {
      saveHiddenColumns(moduleKey, new Set());
      saveExtraColumns(moduleKey, new Set());
      redraw();
      fillColumnsPanel();
    });
    columnsPanel.append(showAll);
  };
  columnsButton.addEventListener('click', event => {
    event.stopPropagation();
    columnsPanel.hidden = !columnsPanel.hidden;
    if (!columnsPanel.hidden) fillColumnsPanel();
  });
  // a click elsewhere closes the panel
  document.addEventListener('click', event => {
    if (!columnsPanel.hidden && !columnsPanel.contains(event.target as Node)) columnsPanel.hidden = true;
  });
  // the module of the list, when the list is of one module (an entry can only be exported with others of its module)
  const openModule = (): number | null => {
    const key = moduleKeyOf(rows);
    return key === 'mixed' ? null : Number(key);
  };
  const refreshExportButton = (): void => {
    exportButton.replaceChildren(el('i', 'fas fa-file-export fa-fw mr-1'), document.createTextNode(ui.selected.size > 0 ? `Export selected (${ui.selected.size})` : 'Export'));
    exportButton.title = ui.selected.size > 0 ? 'Download only the rows ticked' : 'Download the entries of this module';
  };
  const exportAs = (format: 'csv' | 'zip'): void => {
    const mine = new URLSearchParams(window.location.search).get('planned') === '1';
    const module = openModule();
    let url = `registry-transfer.php?export=1&format=${format}`;
    if (ui.selected.size > 0) {
      url += `&ids=${[...ui.selected].join(',')}`;
    } else if (module !== null) {
      url += `&category=${module}&scope=${mine ? 'mine' : 'lab'}`;
    } else {
      return;
    }
    window.location.href = url;
  };
  exportButton.addEventListener('click', event => {
    event.stopPropagation();
    if (ui.selected.size === 0 && openModule() === null) {
      exportMenu.replaceChildren(el('div', 'small text-muted', 'Open a module, or tick rows of one module, to export.'));
    } else {
      exportMenu.replaceChildren();
      ([['csv', 'CSV: a spreadsheet, the fields only'], ['zip', 'ZIP with files: the CSV and the attached files']] as ['csv' | 'zip', string][]).forEach(([format, label]) => {
        const item = el('button', 'btn btn-link btn-sm d-block text-left p-1', label);
        item.type = 'button';
        item.addEventListener('click', () => {
          exportMenu.hidden = true;
          exportAs(format);
        });
        exportMenu.append(item);
      });
    }
    exportMenu.hidden = !exportMenu.hidden;
  });
  importButton.addEventListener('click', () => {
    const module = openModule();
    if (module === null) {
      exportMenu.replaceChildren(el('div', 'small text-muted', 'Open a module to import entries into it.'));
      exportMenu.hidden = false;
      return;
    }
    (window as unknown as { RegistryTools?: { importDialog: (category: number) => void } }).RegistryTools?.importDialog(module);
  });
  document.addEventListener('click', event => {
    if (!exportMenu.hidden && !exportMenu.contains(event.target as Node)) exportMenu.hidden = true;
  });
  refreshExportButton();
  ownerButton.addEventListener('click', () => {
    void registryTools()?.assignOwner([...ui.selected], () => {
      ui.selected.clear();
      ui.onSelectionChange();
      window.location.reload();
    });
  });
  const onSort = (next: SortState): void => {
    tableSort = next;
    saveSort(next);
    ui.page = 0;
    render(container, rows, tableSort, onSort, ui);
  };

  // the carets own the open or closed state of their row: drive them instead of duplicating it
  const setAll = (open: boolean): void => {
    container.querySelectorAll<HTMLButtonElement>('.expandable-caret-cell button').forEach(b => {
      if ((b.getAttribute('aria-expanded') === 'true') !== open) {
        b.click();
      }
    });
  };
  expandAll.addEventListener('click', () => setAll(true));
  collapseAll.addEventListener('click', () => setAll(false));

  const load = async (event?: Event): Promise<void> => {
    const current = ++requestId;
    const params = filterParams(event, order, sort);
    try {
      const endpoint = getEntityTypeFromPage(window.location);
      const loaded = await ApiC.getJson<Row[]>(`${endpoint}?${params.toString()}`, { notifOnError: 0 });
      // a later filter change may have started another request in the meantime
      if (current !== requestId) {
        return;
      }
      rows = loaded;
      // what was selected stays selected when the list is loaded again, if it is still there
      const ids = new Set(rows.map(r => r.id));
      ui.selected.forEach(id => ids.has(id) || ui.selected.delete(id));
      ui.onSelectionChange();
      render(container, rows, tableSort, onSort, ui);
    } catch (error) {
      console.error(`Could not load the resources: ${error}`);
    }
  };
  onFiltersChanged = (event: Event): void => {
    void load(event);
  };
  window.addEventListener('entity-filters-changed', onFiltersChanged);
  void Promise.all([loadModuleSettings(), loadColumnChoices()]).then(() => load()).then(onLoaded);
}

export function unmountExpandableTable(): void {
  if (onFiltersChanged) {
    window.removeEventListener('entity-filters-changed', onFiltersChanged);
    onFiltersChanged = null;
  }
  requestId++;
  rootEl?.replaceChildren();
  rootEl = null;
}
