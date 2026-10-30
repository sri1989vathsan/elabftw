/**
 * Grouped view of the resources: one collapsible section per category (or per storage location),
 * each holding a small table with the columns of that group, like the modules of an inventory system
 */
import { ApiC } from './api';
import { getEntityTypeFromPage } from './misc';
import { appendLocationLinks, linkify, sortableHeader, sortRows } from './entities-view-utils';
import type { SortState } from './entities-view-utils';

type ExtraField = { name: string; value: string };
type StorageLocation = { storage_id: number; path: string; position?: string | null; qty_stored: number; qty_unit: string };
type Row = {
  id: number;
  title: string;
  category: number | null;
  category_title: string | null;
  category_color: string | null;
  fullname: string;
  storage_locations?: StorageLocation[];
  extra_fields?: ExtraField[];
};
type Group = { key: string; label: string; color: string | null; rows: Row[] };
type GroupBy = 'category' | 'storage';

const STATE_KEY = 'persistent_grouped_view_v1';
const NO_CATEGORY = 'No category';
const NO_STORAGE = 'No storage location';

let rootEl: HTMLElement | null = null;
let onFiltersChanged: ((event: Event) => void) | null = null;
let requestId = 0;

type StoredState = { groupBy: GroupBy; open: Record<string, boolean> };

function readState(): StoredState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (parsed && (parsed.groupBy === 'category' || parsed.groupBy === 'storage')) {
      return { groupBy: parsed.groupBy, open: parsed.open ?? {} };
    }
  } catch {
    // localStorage might be unavailable
  }
  return { groupBy: 'category', open: {} };
}

function writeState(state: StoredState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage might be unavailable
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text) {
    node.textContent = text;
  }
  return node;
}

function locationsOf(row: Row): StorageLocation[] {
  return row.storage_locations ?? [];
}

function quantityOf(row: Row): string {
  return locationsOf(row).map(l => `${l.qty_stored} ${l.qty_unit}`.trim()).join(' | ');
}

function buildGroups(rows: Row[], groupBy: GroupBy): Group[] {
  const groups = new Map<string, Group>();
  const add = (key: string, label: string, color: string | null, row: Row): void => {
    if (!groups.has(key)) {
      groups.set(key, { key, label, color, rows: [] });
    }
    groups.get(key)!.rows.push(row);
  };
  rows.forEach(row => {
    if (groupBy === 'category') {
      add(`c:${row.category ?? 'none'}`, row.category_title ?? NO_CATEGORY, row.category_color, row);
      return;
    }
    const locations = locationsOf(row);
    if (locations.length === 0) {
      add('s:none', NO_STORAGE, null, row);
    }
    // an item stored in several places is listed under each of them
    locations.forEach(l => add(`s:${l.path}`, l.path, null, row));
  });
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildTable(group: Group, groupBy: GroupBy, sort: SortState | null, onSort: (sort: SortState) => void): HTMLTableElement {
  const table = el('table', 'table table-sm table-hover mb-0');
  // what the cell shows, and what the column sorts on
  type Column = { head: string; cell: (row: Row) => string | Node; value: (row: Row) => string | number };
  const columns: Column[] = [];
  const locationText = (row: Row): string => locationsOf(row).map(l => `${l.path} ${l.position ?? ''}`.trim()).join(' | ');
  const totalQuantity = (row: Row): string | number => locationsOf(row).length > 0
    ? locationsOf(row).reduce((sum, l) => sum + Number(l.qty_stored), 0)
    : '';
  if (groupBy === 'category') {
    // the fields of this category, in the order they were defined
    const names: string[] = [];
    group.rows.forEach(row => (row.extra_fields ?? []).forEach(f => {
      if (!names.includes(f.name)) {
        names.push(f.name);
      }
    }));
    names.forEach(name => columns.push({
      head: name,
      cell: row => linkify((row.extra_fields ?? []).find(f => f.name === name)?.value ?? ''),
      value: row => (row.extra_fields ?? []).find(f => f.name === name)?.value ?? '',
    }));
    columns.push({
      head: 'Location',
      cell: row => {
        const span = el('span');
        appendLocationLinks(span, locationsOf(row));
        return span;
      },
      value: locationText,
    });
  } else {
    columns.push({ head: 'Category', cell: row => row.category_title ?? '', value: row => row.category_title ?? '' });
  }
  columns.push({ head: 'Quantity', cell: quantityOf, value: totalQuantity });
  columns.push({ head: 'Owner', cell: row => row.fullname ?? '', value: row => row.fullname ?? '' });

  const sortColumns: { head: string; value: (row: Row) => string | number }[] = [
    { head: 'ID', value: row => row.id },
    { head: 'Title', value: row => row.title ?? '' },
    ...columns,
  ];
  const headRow = el('tr');
  sortColumns.forEach(c => {
    const th = el('th', c.head === 'ID' ? 'id-cell' : '');
    sortableHeader(th, c.head, c.head, sort, onSort);
    headRow.append(th);
  });
  const thead = el('thead');
  thead.append(headRow);
  table.append(thead);

  const body = el('tbody');
  sortRows(group.rows, sort, (row, key) => sortColumns.find(c => c.head === key)?.value(row) ?? '').forEach(row => {
    const tr = el('tr');
    const link = el('a', '', row.title);
    link.href = `?mode=view&id=${encodeURIComponent(String(row.id))}`;
    tr.append(el('td', 'id-cell', String(row.id)));
    const titleCell = el('td');
    titleCell.append(link);
    tr.append(titleCell);
    columns.forEach(c => {
      const td = el('td');
      td.append(c.cell(row));
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(body);
  return table;
}

function render(container: HTMLElement, rows: Row[], state: StoredState, sort: SortState | null, onSort: (sort: SortState) => void): void {
  container.replaceChildren();
  if (rows.length === 0) {
    container.append(el('p', 'text-muted', 'Nothing to show.'));
    return;
  }
  buildGroups(rows, state.groupBy).forEach(group => {
    const details = el('details', 'grouped-section');
    const stateKey = `${state.groupBy}|${group.key}`;
    details.open = state.open[stateKey] ?? false;
    details.addEventListener('toggle', () => {
      state.open[stateKey] = details.open;
      writeState(state);
    });
    const summary = el('summary', 'grouped-section-title');
    if (group.color) {
      const dot = el('span', 'category-nav-dot');
      dot.style.backgroundColor = `#${group.color}`;
      summary.append(dot);
    }
    summary.append(el('span', '', group.label), el('span', 'grouped-section-count', String(group.rows.length)));
    details.append(summary);
    const wrap = el('div', 'table-responsive');
    wrap.append(buildTable(group, state.groupBy, sort, onSort));
    details.append(wrap);
    container.append(details);
  });
}

function filterParams(event?: Event, order = 'date', sort = 'desc'): URLSearchParams {
  const detail = (event as CustomEvent | undefined)?.detail;
  const params = detail instanceof URLSearchParams
    ? new URLSearchParams(detail)
    : new URLSearchParams(document.location.search);
  if (!params.has('order')) {
    params.set('order', order);
  }
  if (!params.has('sort')) {
    params.set('sort', sort);
  }
  return params;
}

export function mountGroupedEntities(rootElement: HTMLElement | null, order: string, sort: string, onLoaded: () => void): void {
  if (!rootElement) {
    return;
  }
  unmountGroupedEntities();
  rootEl = rootElement;
  const state = readState();

  const toolbar = el('div', 'd-flex flex-wrap align-items-center mb-2');
  const groupLabel = el('label', 'mr-2 mb-0', 'Group by');
  const groupSelect = el('select', 'form-control form-control-sm w-auto mr-3');
  groupLabel.htmlFor = groupSelect.id = 'groupedViewGroupBy';
  [['category', 'Category'], ['storage', 'Storage location']].forEach(([value, label]) => {
    const option = el('option', '', label);
    option.value = value;
    groupSelect.append(option);
  });
  groupSelect.value = state.groupBy;
  const expandAll = el('button', 'btn btn-transparent btn-sm', 'Expand all');
  const collapseAll = el('button', 'btn btn-transparent btn-sm', 'Collapse all');
  expandAll.type = collapseAll.type = 'button';
  toolbar.append(groupLabel, groupSelect, expandAll, collapseAll);
  const container = el('div');
  rootEl.replaceChildren(toolbar, container);

  let rows: Row[] = [];
  let tableSort: SortState | null = null;
  const onSort = (next: SortState): void => {
    tableSort = next;
    render(container, rows, state, tableSort, onSort);
  };
  const setAll = (open: boolean): void => {
    container.querySelectorAll('details').forEach(d => {
      d.open = open;
    });
  };
  expandAll.addEventListener('click', () => setAll(true));
  collapseAll.addEventListener('click', () => setAll(false));
  groupSelect.addEventListener('change', () => {
    state.groupBy = groupSelect.value as GroupBy;
    writeState(state);
    render(container, rows, state, tableSort, onSort);
  });

  const load = async (event?: Event): Promise<void> => {
    const current = ++requestId;
    const params = filterParams(event, order, sort);
    try {
      const endpoint = getEntityTypeFromPage(window.location);
      const loaded = await ApiC.getJson(`${endpoint}?${params.toString()}`, { notifOnError: 0 });
      // a later filter change may have started another request in the meantime
      if (current !== requestId) {
        return;
      }
      rows = loaded as Row[];
      render(container, rows, state, tableSort, onSort);
    } catch (error) {
      console.error(`Could not load entities: ${error}`);
    }
  };
  onFiltersChanged = (event: Event): void => {
    void load(event);
  };
  window.addEventListener('entity-filters-changed', onFiltersChanged);
  void load().then(onLoaded);
}

export function unmountGroupedEntities(): void {
  if (onFiltersChanged) {
    window.removeEventListener('entity-filters-changed', onFiltersChanged);
    onFiltersChanged = null;
  }
  requestId++;
  rootEl?.replaceChildren();
  rootEl = null;
}
