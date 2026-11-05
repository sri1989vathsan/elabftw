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
import { Api } from './Apiv2.class';

export type FolderView = 'tree' | 'list' | 'details';
export type FolderSortKey = 'name' | 'path' | 'experiments' | 'resources' | 'modified';

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
  /** when the folder or anything filed in it last changed, in seconds since 1970 (0 = unknown) */
  modified: number;
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
// folders whose entries are shown under their row, and the entries fetched for them
const expandedFolders = new Set<string>();
// the switch above the list: every folder shows its entries (the arrows then collapse single folders)
let showAllEntries = false;
const collapsedFolders = new Set<string>();
const isOpen = (id: string): boolean => (showAllEntries ? !collapsedFolders.has(id) : expandedFolders.has(id));

interface FolderEntry { type: 'experiments' | 'items'; id: number; title: string }
const entryCache = new Map<string, { at: number; entries: FolderEntry[] | null }>();
const ENTRY_CACHE_MS = 30000;
const ENTRY_LIMIT = 100;

export function parseFolderView(value: string | null): FolderView {
  return VIEWS.find(view => view === value) ?? 'tree';
}

/** Rows sorted by a column; names and paths ignore case and compare numbers inside them naturally ("Plate 2" before "Plate 10"). */
export function sortFolderRows<T extends Pick<FolderRow, 'name' | 'path' | 'experiments' | 'resources' | 'modified'>>(rows: T[], key: FolderSortKey, direction: 1 | -1): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    const result = key === 'experiments' || key === 'resources' || key === 'modified'
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
      modified: Number(link.dataset.modifiedAt) || 0,
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
  } else {
    // keeps the buttons of folders with and without subfolders in line
    box.append(element('span', 'folder-enter-placeholder'));
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

/** The experiments and resources of a folder that the API lets this user read (it applies each entry's own permissions). */
async function loadFolderEntries(folderId: string): Promise<FolderEntry[]> {
  const ApiC = new Api();
  const fetchType = (type: FolderEntry['type']): Promise<FolderEntry[]> =>
    ApiC.getJson<Array<{ id: number; title: string }>>(`${type}?folder=${encodeURIComponent(folderId)}&scope=2&limit=${ENTRY_LIMIT}&order=lastchange&sort=desc`)
      .then(list => (Array.isArray(list) ? list : []).map(entry => ({ type, id: entry.id, title: entry.title })));
  const [experiments, resources] = await Promise.all([fetchType('experiments'), fetchType('items')]);
  return [...experiments, ...resources];
}

function entriesBlockOf(folderId: string): HTMLElement {
  const block = element('div', 'folder-entries');
  block.dataset.folderEntriesFor = folderId;
  fillEntriesBlock(block, folderId);
  return block;
}

function fillEntriesBlock(block: HTMLElement, folderId: string): void {
  const cached = entryCache.get(folderId);
  if (!cached || cached.entries === null) {
    block.replaceChildren(element('div', 'folder-entry-note small color-medium', i18next.t('Loading...')));
    return;
  }
  if (cached.entries.length === 0) {
    block.replaceChildren(element('div', 'folder-entry-note small color-medium', i18next.t('Nothing you can see in here.')));
    return;
  }
  block.replaceChildren(...cached.entries.map(entry => {
    const isResource = entry.type === 'items';
    const link = element('a', 'folder-entry text-decoration-none color-medium');
    link.href = `${isResource ? 'database' : 'experiments'}.php?mode=view&id=${entry.id}`;
    const icon = element('i', `fas ${isResource ? 'fa-boxes-stacked' : 'fa-flask'} fa-fw mr-1`);
    icon.title = i18next.t(isResource ? 'Resource' : 'Experiment');
    link.append(icon, element('span', 'folder-entry-title', entry.title));
    return link;
  }));
}

/** Fetches the entries of an expanded folder (unless fresh in the cache) and fills every block that shows them. */
function ensureEntries(folderId: string): void {
  const cached = entryCache.get(folderId);
  if (cached && (cached.entries === null || Date.now() - cached.at < ENTRY_CACHE_MS)) return;
  entryCache.set(folderId, { at: Date.now(), entries: null });
  loadFolderEntries(folderId)
    .then(entries => entryCache.set(folderId, { at: Date.now(), entries }))
    .catch(() => entryCache.set(folderId, { at: Date.now(), entries: [] }))
    .finally(() => document.querySelectorAll<HTMLElement>(`[data-folder-entries-for="${folderId}"]`).forEach(block => fillEntriesBlock(block, folderId)));
}

/** The arrow in front of a folder's name that shows or hides the entries filed in it (only folders that hold some). */
function entriesToggle(row: FolderRow): HTMLElement {
  if (row.experiments + row.resources === 0) return element('span', 'folder-entries-toggle-placeholder');
  const open = isOpen(row.id);
  const button = element('button', 'folder-action-btn hl-hover-gray rounded folder-entries-toggle');
  button.type = 'button';
  button.dataset.action = 'toggle-folder-entries';
  button.dataset.folderId = row.id;
  button.title = i18next.t('Show the experiments and resources in this folder');
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', `${i18next.t('Show the experiments and resources in this folder')}: ${row.name}`);
  button.append(element('i', `fas fa-chevron-${open ? 'down' : 'right'} fa-xs`));
  return button;
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
    linkBox.append(entriesToggle(row), folderLink(row, true, entityType === 'items' ? row.resources : row.experiments));
    line.append(linkBox, copyOfActions(row));
    item.append(line);
    const more = morePanel(row);
    if (more) item.append(more);
    if (row.experiments + row.resources > 0 && isOpen(row.id)) {
      ensureEntries(row.id);
      item.append(entriesBlockOf(row.id));
    }
    list.append(item);
  });
  return list;
}

const SORT_CHIPS: Array<{ key: FolderSortKey; label: string; icon?: string; title: string }> = [
  { key: 'name', label: 'Name', title: 'Sort by name' },
  { key: 'path', label: 'Path', title: 'Sort by path' },
  { key: 'experiments', label: '', icon: 'fa-flask', title: 'Sort by number of experiments' },
  { key: 'resources', label: '', icon: 'fa-boxes-stacked', title: 'Sort by number of resources' },
  { key: 'modified', label: 'Modified', title: 'Sort by last modified' },
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
/** The column headings: pressing one sorts by it (again to reverse). Path and description are columns of their own only when the panel is wide enough. */
function sortBarOf(): HTMLElement {
  const bar = element('div', 'folder-column-heads');
  const name = element('div', 'folder-column-head-name');
  name.append(sortChip(SORT_CHIPS[0]));
  // in a narrow panel the path is not a column: sorting by it stays reachable next to the name
  const narrowPath = sortChip(SORT_CHIPS[1]);
  narrowPath.classList.add('folder-col-narrow-only');
  const narrowModified = sortChip(SORT_CHIPS[4]);
  narrowModified.classList.add('folder-col-narrow-only');
  name.append(narrowPath, narrowModified);
  const widePath = element('div', 'folder-col-wide folder-col-path');
  widePath.append(sortChip(SORT_CHIPS[1]));
  const description = element('div', 'folder-col-wider folder-col-description');
  description.append(element('span', 'folder-sort-label', i18next.t('Description')));
  const wideModified = element('div', 'folder-col-wide folder-col-modified');
  wideModified.append(sortChip(SORT_CHIPS[4]));
  bar.append(name, widePath, description, sortChip(SORT_CHIPS[2]), sortChip(SORT_CHIPS[3]), wideModified, element('span'));
  return bar;
}

function countCell(count: number, title: string): HTMLElement {
  const cell = element('span', `folder-count-cell${count === 0 ? ' is-zero' : ''}`, count === 0 ? '\u2013' : String(count));
  cell.title = `${count} ${title}`;
  return cell;
}

function modifiedText(seconds: number): string {
  return seconds <= 0 ? '\u2013' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(seconds * 1000));
}

function modifiedCell(seconds: number): HTMLElement {
  const cell = element('span', `folder-modified-cell folder-col-wide${seconds <= 0 ? ' is-zero' : ''}`, modifiedText(seconds));
  if (seconds > 0) cell.title = new Date(seconds * 1000).toLocaleString();
  return cell;
}

/**
 * Each folder as a row of columns: name, (path, description), experiments, resources, last modified, and the buttons at the far
 * right. The path and description are columns only while the panel is wide enough; otherwise they sit under the name.
 */
function cardsOf(rows: FolderRow[]): HTMLElement {
  const list = element('div', 'folder-details-list');
  rows.forEach(row => {
    const card = element('div', `folder-details-card${row.active ? ' is-active' : ''}`);
    const main = element('div', 'folder-details-text');
    main.append(entriesToggle(row), folderLink(row, false, null));
    const pathColumn = element('div', 'folder-col-wide folder-col-path', row.path !== row.name ? row.path : '');
    pathColumn.title = row.path;
    const descriptionColumn = element('div', 'folder-col-wider folder-col-description', row.description);
    descriptionColumn.title = row.description;
    card.append(
      main,
      pathColumn,
      descriptionColumn,
      countCell(row.experiments, i18next.t('experiments')),
      countCell(row.resources, i18next.t('resources')),
      modifiedCell(row.modified),
      copyOfActions(row),
    );
    if (row.path !== row.name) card.append(element('div', 'folder-details-path folder-col-narrow-only', row.path));
    if (row.modified > 0) card.append(element('div', 'folder-details-path folder-col-narrow-only', `${i18next.t('Modified')} ${modifiedText(row.modified)}`));
    if (row.description) card.append(element('div', 'folder-details-description folder-col-narrow-only', row.description));
    const more = morePanel(row);
    if (more) card.append(more);
    if (row.experiments + row.resources > 0 && isOpen(row.id)) {
      ensureEntries(row.id);
      card.append(entriesBlockOf(row.id));
    }
    list.append(card);
  });
  return list;
}

/** The bookmarked folders as a block of their own above the folders of the current level. */
function favoritesSection(...content: HTMLElement[]): HTMLElement {
  const section = element('section', 'folder-flat-favorites');
  const label = element('div', 'folder-tree-section-label small font-weight-bold mb-1');
  label.append(element('i', 'fas fa-star fa-fw mr-1'), document.createTextNode(i18next.t('Bookmarked')));
  section.append(label, ...content);
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
  const allEntries = element('button', 'btn btn-sm btn-outline-secondary mb-2 folder-all-entries-toggle');
  allEntries.type = 'button';
  allEntries.dataset.action = 'toggle-folder-all-entries';
  allEntries.title = i18next.t('Show or hide the experiments and resources in every folder');
  const body = element('div', 'folder-flat-body');
  const bar = element('div', 'folder-level-bar-holder mt-2');
  flat.append(filter, allEntries, body, bar);
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
  const allButton = flat.querySelector<HTMLElement>('.folder-all-entries-toggle');
  if (allButton) {
    allButton.setAttribute('aria-pressed', String(showAllEntries));
    allButton.classList.toggle('active', showAllEntries);
    allButton.replaceChildren(element('i', `fas ${showAllEntries ? 'fa-eye-slash' : 'fa-eye'} fa-fw mr-1`), document.createTextNode(i18next.t(showAllEntries ? 'Hide experiments/resources' : 'Show experiments/resources')));
  }
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
  // the bookmarked folders follow the sort of the table below them and have their own column headings
  const favorites = searching ? [] : sortFolderRows(all.filter(row => row.favorite), view === 'list' ? 'path' : sortKey, view === 'list' ? 1 : sortDirection);
  const favoritesBlock = favorites.length > 0
    ? [favoritesSection(...(view === 'list' ? [listOf(favorites, entityType)] : [sortBarOf(), cardsOf(favorites)]))]
    : [];
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
  const ApiC = new Api();
  const remember = (view: FolderView): void => {
    try {
      window.localStorage.setItem(viewKey(), view);
    } catch {
      // the choice then only lasts until the panel is rebuilt
    }
  };
  // the choice belongs to the user, not to this browser: the saved one wins over what this browser remembers
  void ApiC.patch('experiments_folders', { action: 'get_folder_view' })
    .then(response => response.json())
    .then((data: { folder_view?: string | null }) => {
      if (!data.folder_view) return;
      const saved = parseFolderView(data.folder_view);
      if (saved === currentFolderView()) return;
      remember(saved);
      syncFolderView();
    })
    .catch(() => { /* the browser's own memory of the choice stays in use */ });
  on('select-folder-view', (el: HTMLElement) => {
    const view = parseFolderView(el.dataset.view ?? null);
    remember(view);
    void ApiC.patch('experiments_folders', { action: 'set_folder_view', view }).catch(() => { /* kept in this browser at least */ });
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
  on('toggle-folder-entries', (el: HTMLElement, event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = el.dataset.folderId ?? '';
    if (id === '') return;
    // a row can show up twice (bookmarked block and the level below it): both follow the same state
    if (isOpen(id)) {
      expandedFolders.delete(id);
      collapsedFolders.add(id);
    } else {
      expandedFolders.add(id);
      collapsedFolders.delete(id);
      // opening always shows fresh entries
      entryCache.delete(id);
    }
    syncFolderView();
  });
  on('toggle-folder-all-entries', () => {
    showAllEntries = !showAllEntries;
    expandedFolders.clear();
    collapsedFolders.clear();
    entryCache.clear();
    syncFolderView();
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
      sortDirection = key === 'experiments' || key === 'resources' || key === 'modified' ? -1 : 1;
    }
    syncFolderView();
  });
}
