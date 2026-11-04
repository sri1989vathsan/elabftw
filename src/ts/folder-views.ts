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
  /** the folder this one is inside, '' for a top-level folder */
  parentId: string;
  hasChildren: boolean;
  name: string;
  path: string;
  href: string;
  experiments: number;
  resources: number;
  description: string;
  active: boolean;
  /** bookmarked with the star */
  favorite: boolean;
  actions: HTMLElement[];
  /** the tree's Export / Edit / Delete buttons for this folder (hidden there until the three dots are pressed) */
  more: HTMLElement | null;
}

// how a folder's full path joins its ancestors' names
const PATH_SEPARATOR = ' > ';
const VIEWS: readonly FolderView[] = ['tree', 'list', 'details'];

let sortKey: FolderSortKey = 'path';
let sortDirection: 1 | -1 = 1;
let filterText = '';
// the folder whose subfolders the flat views list ('' = the top level), set from the folder being looked at the first time
let level = '';
let levelReady = false;

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

/** The folders directly inside `level` ('' = the top level). */
export function rowsAtLevel<T extends Pick<FolderRow, 'parentId'>>(rows: T[], level: string): T[] {
  return rows.filter(row => row.parentId === level);
}

/** The folders from the top level down to `id`, `id` last; empty when it is not among the rows. */
export function ancestorChain<T extends Pick<FolderRow, 'id' | 'parentId'>>(rows: T[], id: string): T[] {
  const chain: T[] = [];
  let current = rows.find(row => row.id === id);
  // the limit only guards against a broken parent chain
  for (let step = 0; current && step < 30; step++) {
    chain.unshift(current);
    const parentId = current.parentId;
    current = parentId === '' ? undefined : rows.find(row => row.id === parentId);
  }
  return chain;
}

/** Where the flat views start: inside the folder being looked at when it has subfolders, else beside it. */
export function initialFolderLevel<T extends Pick<FolderRow, 'id' | 'parentId' | 'hasChildren'>>(rows: T[], activeId: string | null): string {
  const active = activeId ? rows.find(row => row.id === activeId) : undefined;
  if (!active) return '';
  return active.hasChildren ? active.id : active.parentId;
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
      parentId: node.parentElement?.closest<HTMLElement>('.folder-node')?.dataset.folderId ?? '',
      hasChildren: node.querySelector(':scope > .folder-children > .folder-node') !== null,
      name: node.querySelector('.folder-name')?.textContent?.trim() ?? '',
      path: node.dataset.folderFullPath ?? '',
      href: link.getAttribute('href') ?? '#',
      experiments: Number(link.dataset.experimentsCount) || 0,
      resources: Number(link.dataset.resourcesCount) || 0,
      description: node.querySelector(':scope > .folder-description')?.textContent?.trim() ?? '',
      active: link.classList.contains('font-weight-bold'),
      favorite: node.querySelector(':scope > .folder-row .favorite-folder-star .fa-star.fas') !== null,
      actions,
      more: node.querySelector<HTMLElement>(':scope > .folder-more-actions'),
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
  // the three dots: Export / Edit / Delete, as in the tree
  if (row.more) {
    const dots = element('button', 'folder-action-btn hl-hover-gray rounded');
    dots.type = 'button';
    dots.dataset.action = 'toggle-folder-flat-more';
    dots.title = i18next.t('More');
    dots.setAttribute('aria-label', `${i18next.t('More folder actions')}: ${row.name}`);
    dots.setAttribute('aria-expanded', 'false');
    dots.append(element('i', 'fas fa-ellipsis-v fa-xs'));
    box.append(dots);
  }
  // a folder with subfolders can be stepped into without leaving the page
  if (row.hasChildren) {
    const enter = element('button', 'folder-action-btn hl-hover-gray rounded folder-enter-button');
    enter.type = 'button';
    enter.dataset.action = 'open-folder-level';
    enter.dataset.folderId = row.id;
    enter.title = i18next.t('Show the folders inside');
    enter.setAttribute('aria-label', `${i18next.t('Show the folders inside')}: ${row.name}`);
    enter.append(element('i', 'fas fa-chevron-right fa-xs'));
    box.append(enter);
  }
  return box;
}

/**
 * A copy of the tree's Export / Edit / Delete buttons of a folder, shown under its row when the three dots are pressed.
 * The buttons are handled by data-action like the tree's own. The copy is not marked as the tree's panel, so the tree's
 * three-dots handling leaves it alone (the flat views have their own, see initFolderViews).
 */
function morePanel(row: FolderRow): HTMLElement | null {
  if (!row.more) return null;
  const panel = row.more.cloneNode(true) as HTMLElement;
  panel.classList.remove('folder-more-actions');
  panel.classList.add('folder-flat-more-actions');
  panel.removeAttribute('data-folder-more-actions-for');
  panel.hidden = true;
  return panel;
}

function folderLink(row: FolderRow, withPath: boolean, entityCount: number | null): HTMLAnchorElement {
  const link = element('a', `text-decoration-none color-medium folder-flat-link${row.active ? ' font-weight-bold' : ''}`);
  link.href = row.href;
  link.title = row.path;
  link.setAttribute('data-folder-flat-link', '');
  link.append(element('i', 'fas fa-folder fa-fw mr-1'), element('span', 'folder-name', row.name));
  if (withPath && row.path !== row.name) {
    const parent = row.path.includes(PATH_SEPARATOR) ? row.path.slice(0, row.path.lastIndexOf(PATH_SEPARATOR)) : '';
    if (parent !== '') link.append(element('small', 'color-medium ml-2 folder-flat-parent', parent));
  }
  if (entityCount !== null && entityCount > 0) link.append(element('span', 'badge badge-secondary ml-1', String(entityCount)));
  return link;
}

function listOf(rows: FolderRow[], entityType: string): HTMLElement {
  const list = element('div', 'folder-flat-list');
  rows.forEach(row => {
    const item = element('div', 'folder-flat-item');
    const line = element('div', 'd-flex align-items-center folder-flat-row');
    const linkBox = element('span', 'folder-flat-main');
    linkBox.append(folderLink(row, true, entityType === 'items' ? row.resources : row.experiments));
    line.append(linkBox, copyOfActions(row));
    item.append(line);
    const more = morePanel(row);
    if (more) item.append(more);
    list.append(item);
  });
  return list;
}

const SORT_CHIPS: Array<{ key: FolderSortKey; label: string; icon?: string; title: string }> = [
  { key: 'name', label: 'Name', title: 'Sort by name' },
  { key: 'path', label: 'Path', title: 'Sort by path' },
  { key: 'experiments', label: '', icon: 'fa-flask', title: 'Sort by number of experiments' },
  { key: 'resources', label: '', icon: 'fa-boxes-stacked', title: 'Sort by number of resources' },
];

function sortChip(chip: (typeof SORT_CHIPS)[number]): HTMLButtonElement {
  const active = sortKey === chip.key;
  const button = element('button', `folder-sort-chip${active ? ' active' : ''}`);
  button.type = 'button';
  button.dataset.action = 'sort-folder-details';
  button.dataset.sortKey = chip.key;
  button.title = i18next.t(chip.title);
  button.setAttribute('aria-pressed', String(active));
  if (chip.icon) button.append(element('i', `fas ${chip.icon} fa-fw`));
  if (chip.label) button.append(document.createTextNode(i18next.t(chip.label)));
  if (active) button.append(element('i', `fas fa-caret-${sortDirection === 1 ? 'up' : 'down'} fa-fw ml-1`));
  return button;
}

/** Each folder as a small card: name and buttons, then its path, description and how many experiments / resources it holds. */
/** The column headings: pressing one sorts by it (again to reverse); the first column sorts by name or by path. */
function sortBarOf(): HTMLElement {
  const bar = element('div', 'folder-column-heads');
  const first = element('div', 'folder-column-head-first');
  first.append(sortChip(SORT_CHIPS[0]), sortChip(SORT_CHIPS[1]));
  bar.append(first, sortChip(SORT_CHIPS[2]), sortChip(SORT_CHIPS[3]));
  return bar;
}

function countCell(count: number, title: string): HTMLElement {
  const cell = element('span', `folder-count-cell${count === 0 ? ' is-zero' : ''}`, count === 0 ? '\u2013' : String(count));
  cell.title = `${count} ${title}`;
  return cell;
}

/** Each folder as a row of columns: name and buttons, how many experiments and resources it holds; its path and description under the name. */
function cardsOf(rows: FolderRow[]): HTMLElement {
  const list = element('div', 'folder-details-list');
  rows.forEach(row => {
    const card = element('div', `folder-details-card${row.active ? ' is-active' : ''}`);
    const top = element('div', 'd-flex align-items-start folder-details-top');
    const main = element('div', 'folder-details-text');
    main.append(folderLink(row, false, null));
    top.append(main, copyOfActions(row));
    card.append(top, countCell(row.experiments, i18next.t('experiments')), countCell(row.resources, i18next.t('resources')));
    if (row.path !== row.name) card.append(element('div', 'folder-details-path', row.path));
    if (row.description) card.append(element('div', 'folder-details-description', row.description));
    const more = morePanel(row);
    if (more) card.append(more);
    list.append(card);
  });
  return list;
}

/** The bookmarked folders as a block of their own above the folders of the current level. */
function favoritesSection(content: HTMLElement): HTMLElement {
  const section = element('section', 'folder-flat-favorites');
  const label = element('div', 'folder-tree-section-label small font-weight-bold mb-1');
  label.append(element('i', 'fas fa-star fa-fw mr-1'), document.createTextNode(i18next.t('Bookmarked')));
  section.append(label, content);
  return section;
}

/** One button that moves the flat views to another level. */
function levelButton(className: string, folderId: string, label: string, title: string): HTMLButtonElement {
  const button = element('button', className);
  button.type = 'button';
  button.dataset.action = 'open-folder-level';
  button.dataset.folderId = folderId;
  button.title = title;
  button.append(element('span', '', label));
  return button;
}

/** "..": back to the folder that holds the current level (or the top). */
function upRow(all: FolderRow[]): HTMLElement {
  const chain = ancestorChain(all, level);
  const parent = chain.length > 1 ? chain[chain.length - 2] : null;
  const row = element('div', 'd-flex align-items-center folder-flat-row folder-up-row');
  const button = levelButton('btn btn-link btn-sm p-0 folder-up-button color-medium', parent ? parent.id : '', '', i18next.t('Up one level'));
  button.replaceChildren(element('i', 'fas fa-level-up-alt fa-fw mr-1'), document.createTextNode(`.. ${parent ? parent.name : i18next.t('All folders')}`));
  row.append(button);
  return row;
}

/** Where the flat views are in the folder structure, as a path; each part moves there (the last is where we are). */
function levelPathBar(all: FolderRow[]): HTMLElement {
  const nav = element('nav', 'folder-path-bar folder-level-bar');
  nav.setAttribute('aria-label', i18next.t('Folder path'));
  const crumbs: Array<{ id: string; name: string; icon: string }> = [
    { id: '', name: i18next.t('All folders'), icon: 'fa-folder-tree' },
    ...ancestorChain(all, level).map(folder => ({ id: folder.id, name: folder.name, icon: 'fa-folder' })),
  ];
  crumbs.forEach((crumb, index) => {
    if (index > 0) nav.append(element('i', 'fas fa-chevron-right folder-path-sep'));
    const last = index === crumbs.length - 1;
    const part = last
      ? element('span', 'folder-path-crumb')
      : levelButton('folder-path-crumb', crumb.id, '', crumb.name);
    if (last) part.setAttribute('aria-current', 'location');
    part.replaceChildren(element('i', `fas ${crumb.icon} fa-fw`), document.createTextNode(crumb.name));
    nav.append(part);
  });
  return nav;
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
  const bar = element('div', 'folder-level-bar-holder mt-2');
  flat.append(filter, body, bar);
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
  if (!levelReady) {
    levelReady = true;
    const sidebar = document.getElementById('experimentsFoldersSidebar');
    const activeId = new URLSearchParams(window.location.search).get('folder') || sidebar?.dataset.currentFolderId || null;
    level = initialFolderLevel(all, activeId);
  }
  // a level that is no longer shown (another scope, a deleted folder) goes back to the top
  if (level !== '' && !all.some(row => row.id === level)) level = '';
  const searching = filterText.trim() !== '';
  // typing in the filter searches every folder; without it the folders inside the current level are listed
  const pool = searching ? filterFolderRows(all, filterText) : rowsAtLevel(all, level);
  const rows = sortFolderRows(pool, view === 'list' ? 'path' : sortKey, view === 'list' ? 1 : sortDirection);
  flat.querySelector<HTMLElement>('.folder-level-bar-holder')?.replaceChildren(levelPathBar(all));
  const favorites = searching ? [] : sortFolderRows(all.filter(row => row.favorite), 'path', 1);
  const favoritesBlock = favorites.length > 0 ? [favoritesSection(view === 'list' ? listOf(favorites, entityType) : cardsOf(favorites))] : [];
  if (rows.length === 0) {
    const empty = element('div', 'small color-medium text-center border rounded p-3', i18next.t(all.length === 0 ? 'No folders to show.' : searching ? 'No folder matches.' : 'No folders in here.'));
    body.replaceChildren(...favoritesBlock, ...(level !== '' && !searching ? [upRow(all), empty] : [empty]));
    return;
  }
  const parts: HTMLElement[] = [...favoritesBlock];
  if (view === 'details') parts.push(sortBarOf());
  const main = view === 'list' ? listOf(rows, entityType) : cardsOf(rows);
  if (level !== '' && !searching) main.prepend(upRow(all));
  parts.push(main);
  body.replaceChildren(...parts);
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
  on('toggle-folder-flat-more', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    const panel = el.closest('.folder-flat-item, .folder-details-card')?.querySelector<HTMLElement>('.folder-flat-more-actions');
    if (!panel) return;
    const open = panel.hidden;
    document.querySelectorAll<HTMLElement>('.folder-flat-more-actions').forEach(other => { other.hidden = other !== panel || !open; });
    document.querySelectorAll<HTMLElement>('[data-action="toggle-folder-flat-more"]').forEach(toggle => toggle.setAttribute('aria-expanded', 'false'));
    el.setAttribute('aria-expanded', String(open));
  });
  // a click anywhere else closes an open three-dots panel
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    document.querySelectorAll<HTMLElement>('.folder-flat-more-actions').forEach(panel => {
      const container = panel.closest('.folder-flat-item, .folder-details-card');
      if (panel.hidden || container?.contains(target) && (panel.contains(target) || (target as Element).closest?.('[data-action="toggle-folder-flat-more"]'))) return;
      panel.hidden = true;
    });
  });
  on('open-folder-level', (el: HTMLElement) => {
    level = el.dataset.folderId ?? '';
    // stepping to another level also leaves a search, which would otherwise keep listing every folder
    filterText = '';
    const filter = document.getElementById('folderFlatFilter') as HTMLInputElement | null;
    if (filter) filter.value = '';
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
