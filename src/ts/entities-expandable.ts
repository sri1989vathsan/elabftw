/**
 * Expandable table of the resources: one row per resource, opened to show its fields,
 * its storage with the total stock and its recent activity
 */
import { ApiC } from './api';
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
  title: string;
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
const fieldOf = (row: Row, pattern: RegExp): string => (row.extra_fields ?? []).find(f => pattern.test(f.name))?.value ?? '';
const isPrimerList = (rows: Row[]): boolean => rows.length > 0 && rows.every(r => /^(primers?|probes?)$/i.test(r.category_title ?? ''));
const basesOf = (row: Row): string => fieldOf(row, /^sequence/i).toUpperCase().replace(/[^A-Z]/g, '');
const gcOf = (bases: string): number | '' => bases === '' ? '' : Math.round(((bases.match(/[GC]/g) ?? []).length / bases.length) * 1000) / 10;
const numberOrEmpty = (value: string): number | '' => value !== '' && Number.isFinite(Number(value)) ? Number(value) : '';

// the category is in the tabs and the location in the opened row: no columns for them
function columnsFor(rows: Row[]): Column[] {
  const text = (key: string, label: string, get: (row: Row) => string | number): Column => ({ key, label, numeric: false, get });
  const num = (key: string, label: string, get: (row: Row) => string | number): Column => ({ key, label, numeric: true, get });
  const columns: Column[] = [num('ID', 'ID', r => r.id), text('Title', 'Title', r => r.title ?? '')];
  if (isPrimerList(rows)) {
    // the primers are looked at by their sequence, length, melting temperature and GC share
    columns.push(
      text('Sequence', "Sequence 5'-3'", basesOf),
      num('Length', 'Length', r => basesOf(r).length || ''),
      num('Tm', 'Tm (°C)', r => numberOrEmpty(fieldOf(r, /^tm/i))),
      num('GC', 'GC %', r => gcOf(basesOf(r))),
      text('Orientation', 'Orientation', r => fieldOf(r, /^orientation/i)),
      text('Target', 'Target', r => fieldOf(r, /^target/i)),
    );
  } else if (rows.some(r => (r.sequence_files ?? []).length > 0)) {
    // the sequence files of the plasmids, opened in the sequence editor
    columns.push(text('Files', 'Sequence', r => (r.sequence_files ?? []).map(f => f.real_name).join(' ')));
  }
  columns.push(num('Quantity', 'Quantity', quantityOf), text('Owner', 'Owner', r => r.fullname ?? ''));
  return columns;
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

  const fields = row.extra_fields ?? [];
  if (fields.length > 0) {
    const box = section('Details');
    const grid = el('div', 'expandable-fields');
    fields.forEach(f => {
      const cell = el('div', 'expandable-field');
      const value = el('div');
      value.append(linkify(f.value));
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
  const columns = columnsFor(allRows);
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
        tr.append(el('td', 'id-cell', String(row.id)));
        break;
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
      cell.colSpan = cols.length + 2;
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
  // the rows ticked can be sent to an order (the sequences of primers are written in its notes)
  const orderButton = el('button', 'btn btn-secondary btn-sm ml-3', 'Send selected to an order');
  orderButton.type = 'button';
  orderButton.hidden = true;
  toolbar.append(orderButton);
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
  void load().then(onLoaded);
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
