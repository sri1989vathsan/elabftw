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
function columnsFor(rows: Row[]): Column[] {
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

// the columns a user hides, kept in this browser for each module (and one list for the lists that mix modules)
const HIDDEN_COLUMNS_KEY = 'registry_hidden_columns_v1';
const moduleKeyOf = (rows: Row[]): string => {
  const first = rows[0]?.category ?? null;
  return first !== null && rows.every(r => r.category === first) ? String(first) : 'mixed';
};
function loadHiddenColumns(moduleKey: string): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? '{}') as Record<string, string[]>;
    return new Set(all[moduleKey] ?? []);
  } catch {
    return new Set();
  }
}
function saveHiddenColumns(moduleKey: string, hidden: Set<string>): void {
  try {
    const all = JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? '{}') as Record<string, string[]>;
    all[moduleKey] = [...hidden];
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(all));
  } catch {
    // localStorage might be unavailable: the columns come back at the next visit
  }
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

type TableState = { filters: Map<string, string>; selected: Set<number>; onSelectionChange: () => void };

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
  // the ID and the title stay; the other columns can be hidden by the user (button Columns)
  const hidden = loadHiddenColumns(moduleKeyOf(allRows));
  const columns = columnsFor(allRows).filter(c => c.key === 'ID' || c.key === 'Title' || !hidden.has(c.key));
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
  const count = el('span', 'text-muted small ml-2');
  columns.forEach(c => {
    const th = el('th', c.key === 'ID' ? 'id-cell' : '');
    const input = el('input', 'form-control form-control-sm expandable-filter');
    input.type = 'search';
    input.placeholder = c.numeric ? 'e.g. >50' : 'filter';
    input.value = ui.filters.get(c.key) ?? '';
    input.setAttribute('aria-label', `Filter ${c.label}`);
    input.addEventListener('input', () => {
      ui.filters.set(c.key, input.value);
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
    count.textContent = shown.length === allRows.length ? `${allRows.length} shown` : `${shown.length} of ${allRows.length} shown`;
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

  function fillBody(): void {
    body.replaceChildren();
    shown = sortRows(allRows, sort, valueOf).filter(row => columns.every(c => matchesFilter(c.get(row), ui.filters.get(c.key) ?? '', c.numeric)));
    shown.forEach(row => body.append(...buildRow(row, columns)));
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
    if (/^(antibod|reagent)/i.test(row.category_title ?? '')) {
      const order = el('button', 'btn btn-secondary btn-sm ml-1');
      order.type = 'button';
      const kind = /^antibod/i.test(row.category_title ?? '') ? 'antibody' : 'reagent';
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
  container.append(count, wrap);
}

export function mountExpandableTable(rootElement: HTMLElement | null, order: string, sort: string, onLoaded: () => void): void {
  if (!rootElement) {
    return;
  }
  unmountExpandableTable();
  rootEl = rootElement;

  const toolbar = el('div', 'mb-2');
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
  // the rows ticked can be sent to an order (the sequences of primers are written in its notes)
  const orderButton = el('button', 'btn btn-secondary btn-sm ml-3', 'Send selected to an order');
  orderButton.type = 'button';
  orderButton.hidden = true;
  toolbar.append(orderButton);
  // in My entries the rows ticked can be added to the lab Database
  const databaseButton = el('button', 'btn btn-primary btn-sm ml-2', 'Add selected to the Database');
  databaseButton.type = 'button';
  databaseButton.hidden = true;
  toolbar.append(databaseButton);
  type RegistryTools = { addToDatabase: (ids: number[], done: () => void) => Promise<void> };
  const registryTools = (): RegistryTools | undefined => (window as unknown as { RegistryTools?: RegistryTools }).RegistryTools;
  const inMyEntries = new URLSearchParams(window.location.search).get('planned') === '1';
  const container = el('div');
  rootEl.replaceChildren(toolbar, container);
  let rows: Row[] = [];
  let tableSort: SortState | null = null;
  const ui: TableState = {
    filters: new Map<string, string>(),
    selected: new Set<number>(),
    onSelectionChange: () => {
      const tools = (window as unknown as { PrimerTools?: { sendToOrder: (ids: number[], done?: () => void) => void } }).PrimerTools;
      orderButton.hidden = ui.selected.size === 0 || !tools;
      orderButton.textContent = `Send selected to an order (${ui.selected.size})`;
      databaseButton.hidden = ui.selected.size === 0 || !inMyEntries;
      databaseButton.textContent = `Add selected to the Database (${ui.selected.size})`;
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
    columnsFor(rows).filter(c => c.key !== 'ID' && c.key !== 'Title').forEach(c => {
      const label = el('label', 'd-block mb-1');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = !hidden.has(c.key);
      box.addEventListener('change', () => {
        if (box.checked) hidden.delete(c.key); else hidden.add(c.key);
        saveHiddenColumns(moduleKey, hidden);
        render(container, rows, tableSort, onSort, ui);
      });
      label.append(box, document.createTextNode(` ${c.label}`));
      columnsPanel.append(label);
    });
    const showAll = el('button', 'btn btn-link btn-sm p-0 mt-1', 'Show all');
    showAll.type = 'button';
    showAll.addEventListener('click', () => {
      saveHiddenColumns(moduleKey, new Set());
      render(container, rows, tableSort, onSort, ui);
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
  const onSort = (next: SortState): void => {
    tableSort = next;
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
  void loadModuleSettings().then(() => load()).then(onLoaded);
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
