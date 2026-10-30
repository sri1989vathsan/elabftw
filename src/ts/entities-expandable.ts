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
// the category is in the tabs and the location in the opened row: no columns for them
const COLUMNS = ['ID', 'Title', 'Sequence', 'Quantity', 'Owner'];

// the sequence column is there when some entry of the list has a sequence file (the plasmids)
const columnsFor = (rows: Row[]): string[] => COLUMNS.filter(c => c !== 'Sequence' || rows.some(r => (r.sequence_files ?? []).length > 0));

function sortValue(row: Row, key: string): string | number {
  const locations = row.storage_locations ?? [];
  switch (key) {
  case 'ID': return row.id;
  case 'Title': return row.title ?? '';
  case 'Sequence': return (row.sequence_files ?? []).map(f => f.real_name).join(' ');
  case 'Quantity': return locations.length > 0 ? locations.reduce((sum, l) => sum + Number(l.qty_stored), 0) : '';
  default: return row.fullname ?? '';
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

function render(container: HTMLElement, allRows: Row[], sort: SortState | null, onSort: (sort: SortState) => void): void {
  container.replaceChildren();
  if (allRows.length === 0) {
    container.append(el('p', 'text-muted', 'Nothing to show.'));
    return;
  }
  const rows = sortRows(allRows, sort, sortValue);
  const table = el('table', 'table table-sm expandable-table');
  const head = el('tr');
  head.append(el('th', 'expandable-caret-cell'));
  const columns = columnsFor(allRows);
  columns.forEach(c => {
    const th = el('th', c === 'ID' ? 'id-cell' : '');
    sortableHeader(th, c, c, sort, onSort);
    head.append(th);
  });
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  rows.forEach(row => {
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
    // the ID stays in view when the table is scrolled sideways
    tr.append(el('td', 'id-cell', String(row.id)));
    const titleCell = el('td');
    const link = el('a', '', row.title);
    link.href = `?mode=view&id=${encodeURIComponent(String(row.id))}`;
    titleCell.append(link);
    tr.append(titleCell);
    if (columns.includes('Sequence')) {
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
    }
    tr.append(el('td', 'text-nowrap', locations.length > 0 ? totalStock(locations) : ''));
    tr.append(el('td', '', row.fullname ?? ''));
    body.append(tr);

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
      cell.colSpan = columns.length + 1;
      cell.append(buildDetail(row));
      detailRow.append(cell);
      tr.after(detailRow);
      icon.className = 'fas fa-fw fa-caret-down';
      caret.setAttribute('aria-expanded', 'true');
    });
  });
  table.append(thead, body);
  const wrap = el('div', 'table-responsive');
  wrap.append(table);
  container.append(wrap);
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
  const container = el('div');
  rootEl.replaceChildren(toolbar, container);
  let rows: Row[] = [];
  let tableSort: SortState | null = null;
  const onSort = (next: SortState): void => {
    tableSort = next;
    render(container, rows, tableSort, onSort);
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
      render(container, rows, tableSort, onSort);
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
