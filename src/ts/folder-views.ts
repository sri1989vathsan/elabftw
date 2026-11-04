/**
 * Switchable views of the folders in the Folders side panel: the nested tree (as before), a flat list of every folder
 * with its path, and a details table (name, path, experiment and resource counts, description) that can be sorted.
 *
 * The flat views are built from the tree's own markup each time (see syncFolderView), so they always show the same
 * folders as the tree does: the "My folders / All folders" scope and the experiments / resources choice apply to them
 * too, and the links, bookmark stars and README buttons are the tree's own (they work through the same handlers).
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import i18next from './i18n';
import { on } from './handlers';

export type FolderView = 'tree' | 'list' | 'details';
export type FolderSortKey = 'name' | 'path' | 'experiments' | 'resources';

export interface FolderRow {
  id: string;
  name: string;
  path: string;
  href: string;
  experiments: number;
  resources: number;
  description: string;
  active: boolean;
  actions: HTMLElement[];
}

const VIEWS: readonly FolderView[] = ['tree', 'list', 'details'];

let sortKey: FolderSortKey = 'path';
let sortDirection: 1 | -1 = 1;
let filterText = '';

export function parseFolderView(value: string | null): FolderView {
  return VIEWS.find(view => view === value) ?? 'tree';
}

/** Rows sorted by a column; names and paths ignore case and compare numbers inside them naturally ("Plate 2" before "Plate 10"). */
export function sortFolderRows<T extends Pick<FolderRow, 'name' | 'path' | 'experiments' | 'resources'>>(rows: T[], key: FolderSortKey, direction: 1 | -1): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    const result = key === 'experiments' || key === 'resources'
      ? a[key] - b[key]
      : collator.compare(a[key], b[key]);
    return (result !== 0 ? result : collator.compare(a.path, b.path)) * (result !== 0 ? direction : 1);
  });
}

/** Rows whose name, path or description contain every word typed (any case). */
export function filterFolderRows<T extends Pick<FolderRow, 'name' | 'path' | 'description'>>(rows: T[], text: string): T[] {
  const words = text.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter(row => {
    const haystack = `${row.name} ${row.path} ${row.description}`.toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  });
}

function viewKey(): string {
  const userId = document.getElementById('experimentsFoldersSidebar')?.dataset.currentUserId ?? '';
  return `elabftw-folders-view-${userId}`;
}

export function currentFolderView(): FolderView {
  try {
    return parseFolderView(window.localStorage.getItem(viewKey()));
  } catch {
    return 'tree';
  }
}

/** The folders that are shown in the tree right now (scope applied), one row each. */
function collectRows(tree: HTMLElement): FolderRow[] {
  const rows = new Map<string, FolderRow>();
  tree.querySelectorAll<HTMLElement>('.folder-node').forEach(node => {
    const id = node.dataset.folderId ?? '';
    if (id === '' || rows.has(id) || node.hidden || node.closest('.folder-node[hidden]')) return;
    const link = node.querySelector<HTMLAnchorElement>(':scope > .folder-row > [data-folder-entity-link]');
    if (!link) return;
    const actions = Array.from(node.querySelectorAll<HTMLElement>(':scope > .folder-row .favorite-folder-star, :scope > .folder-row [data-action="open-folder-readme"]'));
    rows.set(id, {
      id,
      name: node.querySelector('.folder-name')?.textContent?.trim() ?? '',
      path: node.dataset.folderFullPath ?? '',
      href: link.getAttribute('href') ?? '#',
      experiments: Number(link.dataset.experimentsCount) || 0,
      resources: Number(link.dataset.resourcesCount) || 0,
      description: node.querySelector(':scope > .folder-description')?.textContent?.trim() ?? '',
      active: link.classList.contains('font-weight-bold'),
      actions,
    });
  });
  return Array.from(rows.values());
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** A copy of a tree button (bookmark star, README): the handlers are delegated by data-action, so the copy works too. */
function copyOfActions(row: FolderRow): HTMLElement {
  const box = element('span', 'folder-actions flex-shrink-0');
  row.actions.forEach(button => box.append(button.cloneNode(true)));
  return box;
}

function folderLink(row: FolderRow, withPath: boolean, entityCount: number | null): HTMLAnchorElement {
  const link = element('a', `text-decoration-none color-medium folder-flat-link${row.active ? ' font-weight-bold' : ''}`);
  link.href = row.href;
  link.title = row.path;
  link.setAttribute('data-folder-flat-link', '');
  link.append(element('i', 'fas fa-folder fa-fw mr-1'), element('span', 'folder-name', row.name));
  if (withPath && row.path !== row.name) {
    const parent = row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : '';
    if (parent !== '') link.append(element('small', 'color-medium ml-2 folder-flat-parent', parent));
  }
  if (entityCount !== null && entityCount > 0) link.append(element('span', 'badge badge-secondary ml-1', String(entityCount)));
  return link;
}

function renderList(body: HTMLElement, rows: FolderRow[], entityType: string): void {
  const list = element('div', 'folder-flat-list');
  rows.forEach(row => {
    const line = element('div', 'd-flex align-items-center folder-flat-row');
    const linkBox = element('span', 'folder-flat-main');
    linkBox.append(folderLink(row, true, entityType === 'items' ? row.resources : row.experiments));
    line.append(linkBox, copyOfActions(row));
    list.append(line);
  });
  body.replaceChildren(list);
}

const COLUMNS: Array<{ key: FolderSortKey | null; label: string; numeric?: boolean }> = [
  { key: 'name', label: 'Name' },
  { key: 'path', label: 'Path' },
  { key: 'experiments', label: 'Experiments', numeric: true },
  { key: 'resources', label: 'Resources', numeric: true },
  { key: null, label: 'Description' },
  { key: null, label: '' },
];

function renderDetails(body: HTMLElement, rows: FolderRow[]): void {
  const table = element('table', 'table table-sm folder-details-table mb-0');
  const head = element('tr');
  COLUMNS.forEach(column => {
    const cell = element('th', column.numeric ? 'text-right' : '');
    cell.scope = 'col';
    if (column.key) {
      const button = element('button', 'btn btn-link btn-sm p-0 folder-sort-button');
      button.type = 'button';
      button.dataset.action = 'sort-folder-details';
      button.dataset.sortKey = column.key;
      button.append(document.createTextNode(i18next.t(column.label)));
      if (sortKey === column.key) {
        button.append(element('i', `fas fa-caret-${sortDirection === 1 ? 'up' : 'down'} fa-fw ml-1`));
        cell.setAttribute('aria-sort', sortDirection === 1 ? 'ascending' : 'descending');
      }
      cell.append(button);
    } else {
      cell.textContent = column.label ? i18next.t(column.label) : '';
    }
    head.append(cell);
  });
  const thead = element('thead');
  thead.append(head);
  const tbody = element('tbody');
  rows.forEach(row => {
    const tr = element('tr');
    const nameCell = element('td', 'folder-details-name');
    nameCell.append(folderLink(row, false, null));
    tr.append(
      nameCell,
      element('td', 'small color-medium folder-details-path', row.path),
      element('td', 'text-right', row.experiments > 0 ? String(row.experiments) : '–'),
      element('td', 'text-right', row.resources > 0 ? String(row.resources) : '–'),
      element('td', 'small color-medium folder-details-description', row.description),
    );
    const actionCell = element('td', 'text-right');
    actionCell.append(copyOfActions(row));
    tr.append(actionCell);
    tbody.append(tr);
  });
  table.append(thead, tbody);
  const scroller = element('div', 'folder-details-scroll');
  scroller.append(table);
  body.replaceChildren(scroller);
}

function ensureFlatContainer(tree: HTMLElement): HTMLElement {
  let flat = document.getElementById('experimentsFoldersFlat');
  if (flat) return flat;
  flat = element('div', 'folder-flat');
  flat.id = 'experimentsFoldersFlat';
  const filter = element('input', 'form-control form-control-sm mb-2');
  filter.type = 'search';
  filter.id = 'folderFlatFilter';
  filter.placeholder = i18next.t('Filter folders');
  filter.setAttribute('aria-label', i18next.t('Filter folders'));
  filter.autocomplete = 'off';
  filter.value = filterText;
  filter.addEventListener('input', () => {
    filterText = filter.value;
    syncFolderView();
  });
  const body = element('div', 'folder-flat-body');
  flat.append(filter, body);
  tree.after(flat);
  return flat;
}

/**
 * Show the chosen view. Call it whenever the tree changed (panel loaded, scope or experiments/resources switched):
 * the flat views are rebuilt from the tree as it is then.
 */
export function syncFolderView(): void {
  const tree = document.getElementById('experimentsFoldersTree');
  if (!tree) return;
  const view = currentFolderView();
  document.querySelectorAll<HTMLElement>('[data-action="select-folder-view"]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const title = document.getElementById('folderViewTitle');
  if (title) title.textContent = i18next.t(view === 'tree' ? 'Folder tree' : view === 'list' ? 'Folder list' : 'Folder details');
  tree.hidden = view !== 'tree';
  const existingFlat = document.getElementById('experimentsFoldersFlat');
  if (view === 'tree') {
    if (existingFlat) existingFlat.hidden = true;
    return;
  }
  const flat = ensureFlatContainer(tree);
  flat.hidden = false;
  const body = flat.querySelector<HTMLElement>('.folder-flat-body');
  if (!body) return;
  const entityType = (document.getElementById('folderEntityTypeSelect') as HTMLSelectElement | null)?.value ?? 'experiments';
  const all = collectRows(tree);
  const rows = sortFolderRows(filterFolderRows(all, filterText), view === 'list' ? 'path' : sortKey, view === 'list' ? 1 : sortDirection);
  if (rows.length === 0) {
    body.replaceChildren(element('div', 'small color-medium text-center border rounded p-3', i18next.t(all.length === 0 ? 'No folders to show.' : 'No folder matches.')));
    return;
  }
  if (view === 'list') renderList(body, rows, entityType);
  else renderDetails(body, rows);
}

/** Wires the view buttons and the sortable column headers (delegated, so they survive the panel being replaced). */
export function initFolderViews(): void {
  on('select-folder-view', (el: HTMLElement) => {
    try {
      window.localStorage.setItem(viewKey(), parseFolderView(el.dataset.view ?? null));
    } catch {
      // the choice then only lasts until the panel is rebuilt
    }
    syncFolderView();
  });
  on('sort-folder-details', (el: HTMLElement) => {
    const key = el.dataset.sortKey as FolderSortKey | undefined;
    if (!key) return;
    if (sortKey === key) sortDirection = sortDirection === 1 ? -1 : 1;
    else {
      sortKey = key;
      // counts are most useful biggest first
      sortDirection = key === 'experiments' || key === 'resources' ? -1 : 1;
    }
    syncFolderView();
  });
}
