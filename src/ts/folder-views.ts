/**
 * Views of the folders in the Folders side panel, built like a file explorer for a narrow strip beside the page:
 *  - tree: the nested tree, drawn by the template (unchanged)
 *  - list: one level at a time, its folders and its experiments / resources ("files"), with a preview of the selected file
 *  - cards: the same level, each file as a small card (name, status, age, tag)
 *
 * The flat views are built from the tree's own markup each time (see syncFolderView), so they always show the same
 * folders as the tree does: the "My folders / All folders" scope and the experiments / resources choice apply to them
 * too, and the bookmark stars and README buttons are the tree's own (they work through the same handlers).
 * Clicking a folder in a flat view steps into it; a file opens with a double click (list) or a click (cards).
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import i18next from './i18n';
import { on } from './handlers';
import { Api } from './Apiv2.class';

export type FolderView = 'tree' | 'list' | 'cards';
export type FolderSortKey = 'name' | 'path' | 'experiments' | 'resources' | 'modified';
export type FolderEntryType = 'experiments' | 'items';

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

/** An experiment or resource filed in a folder, as far as the explorer needs it. */
export interface FolderEntry {
  type: FolderEntryType;
  id: number;
  title: string;
  status: string;
  /** a CSS colour, '' when the status has none */
  statusColor: string;
  owner: string;
  /** when it last changed, in seconds since 1970 (0 = unknown) */
  changed: number;
  tags: string[];
}

interface PanelPrefs {
  favorites: boolean;
  files: boolean;
  counts: boolean;
  /** the Exp / Res / All switch: on "All" the files of both kinds are listed */
  allTypes: boolean;
}

// how a folder's full path joins its ancestors' names
const PATH_SEPARATOR = ' > ';
const VIEWS: readonly FolderView[] = ['tree', 'list', 'cards'];
const DEFAULT_PREFS: PanelPrefs = { favorites: true, files: true, counts: true, allTypes: false };

let filterText = '';
// the folder whose subfolders the flat views list ('' = the top level), set from the folder being looked at the first time
let level = '';
let levelReady = false;
// the file picked in the list view, as "type:id"
let selectedEntry = '';
let prefs: PanelPrefs | null = null;

const levelEntries = new Map<string, { at: number; entries: FolderEntry[] | null }>();
const ENTRY_CACHE_MS = 30000;
const ENTRY_LIMIT = 100;

export function parseFolderView(value: string | null): FolderView {
  // "details" was the name of the table view that the cards replaced
  if (value === 'details') return 'cards';
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

/** How long ago something changed, in a few characters: "today", "2d", "3w", "5mo", "1y" ('' when unknown). */
export function shortAge(seconds: number, nowSeconds: number = Date.now() / 1000): string {
  if (seconds <= 0) return '';
  const days = Math.floor(Math.max(0, nowSeconds - seconds) / 86400);
  if (days < 1) return i18next.t('today');
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** One entry of the API's experiment / resource list, reduced to what the explorer shows. */
export function entryFromApi(type: FolderEntryType, raw: Record<string, unknown>): FolderEntry {
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const color = text(raw.status_color);
  const changedText = text(raw.modified_at) || text(raw.lastchange) || text(raw.created_at);
  const changed = changedText ? Date.parse(changedText.replace(' ', 'T')) / 1000 : 0;
  const tagsValue = raw.tags;
  const tags = typeof tagsValue === 'string'
    ? tagsValue.split('|')
    : Array.isArray(tagsValue) ? tagsValue.map(tag => text(tag)) : [];
  return {
    type,
    id: Number(raw.id),
    title: text(raw.title),
    status: text(raw.status_title),
    statusColor: color === '' ? '' : (color.startsWith('#') ? color : `#${color}`),
    owner: text(raw.fullname),
    changed: Number.isFinite(changed) ? changed : 0,
    tags: tags.map(tag => tag.trim()).filter(tag => tag !== ''),
  };
}

function viewKey(): string {
  const userId = document.getElementById('experimentsFoldersSidebar')?.dataset.currentUserId ?? '';
  return `elabftw-folders-view-${userId}`;
}

function panelPrefs(): PanelPrefs {
  if (prefs) return prefs;
  const loaded: PanelPrefs = { ...DEFAULT_PREFS };
  try {
    const stored = JSON.parse(window.localStorage.getItem(`${viewKey()}-prefs`) ?? '{}') as Partial<PanelPrefs>;
    (Object.keys(DEFAULT_PREFS) as Array<keyof PanelPrefs>).forEach(key => {
      const value = stored[key];
      if (typeof value === 'boolean') loaded[key] = value;
    });
  } catch {
    // the defaults then
  }
  prefs = loaded;
  return loaded;
}

function setPanelPref(key: keyof PanelPrefs, value: boolean): void {
  panelPrefs()[key] = value;
  try {
    window.localStorage.setItem(`${viewKey()}-prefs`, JSON.stringify(panelPrefs()));
  } catch {
    // the choice then only lasts until the page is reloaded
  }
}

/** The folder the flat views are inside right now ('' = the top level), or null while the tree is shown. */
export function currentFlatFolderLevel(): string | null {
  return currentFolderView() === 'tree' ? null : level;
}

export function currentFolderView(): FolderView {
  try {
    return parseFolderView(window.localStorage.getItem(viewKey()));
  } catch {
    return 'tree';
  }
}

/** The page's own choice of experiments or resources (the select that the Exp / Res switch drives). */
function currentEntityType(): FolderEntryType {
  return (document.getElementById('folderEntityTypeSelect') as HTMLSelectElement | null)?.value === 'items' ? 'items' : 'experiments';
}

/** The kinds of file the list and cards show: both on "All", else the chosen one. */
function shownEntryTypes(): FolderEntryType[] {
  return panelPrefs().allTypes ? ['experiments', 'items'] : [currentEntityType()];
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

const entryPage = (type: FolderEntryType): string => (type === 'items' ? 'database' : 'experiments');
const entryHref = (entry: FolderEntry): string => `${entryPage(entry.type)}.php?mode=view&id=${entry.id}`;
const entryKey = (entry: FolderEntry): string => `${entry.type}:${entry.id}`;

/** The experiments and resources of a folder that the API lets this user read (it applies each entry's own permissions). */
async function loadFolderEntries(folderId: string): Promise<FolderEntry[]> {
  const ApiC = new Api();
  const fetchType = (type: FolderEntryType): Promise<FolderEntry[]> =>
    ApiC.getJson<Array<Record<string, unknown>>>(`${type}?folder=${encodeURIComponent(folderId)}&scope=2&limit=${ENTRY_LIMIT}&order=lastchange&sort=desc`)
      .then(list => (Array.isArray(list) ? list : []).map(raw => entryFromApi(type, raw)));
  const [experiments, resources] = await Promise.all([fetchType('experiments'), fetchType('items')]);
  return [...experiments, ...resources].sort((a, b) => b.changed - a.changed);
}

/** The files of a folder: null while they load (the view is drawn again when they arrive). */
function entriesOf(folderId: string): FolderEntry[] | null {
  const cached = levelEntries.get(folderId);
  if (cached && (cached.entries === null || Date.now() - cached.at < ENTRY_CACHE_MS)) return cached.entries;
  levelEntries.set(folderId, { at: Date.now(), entries: null });
  loadFolderEntries(folderId)
    .then(entries => levelEntries.set(folderId, { at: Date.now(), entries }))
    .catch(() => levelEntries.set(folderId, { at: Date.now(), entries: [] }))
    .finally(() => {
      if (level === folderId) syncFolderView();
    });
  return null;
}

/** Forget the files fetched so far, e.g. after something was moved, so the next view of a folder asks again. */
export function forgetFolderEntries(): void {
  levelEntries.clear();
}

function entityCountOf(row: FolderRow): number {
  const types = shownEntryTypes();
  return (types.includes('experiments') ? row.experiments : 0) + (types.includes('items') ? row.resources : 0);
}

/** A folder in the flat views: a click steps into it. */
function folderItem(row: FolderRow): HTMLElement {
  const item = element('div', 'folder-flat-item');
  const line = element('div', 'd-flex align-items-center folder-flat-row');
  line.draggable = true;
  line.dataset.dragKind = 'folder';
  line.dataset.dragId = row.id;
  line.dataset.dropFolder = row.id;
  const link = element('a', `text-decoration-none color-medium folder-flat-link${row.active ? ' font-weight-bold' : ''}`);
  link.href = row.href;
  link.title = row.description ? `${row.path}\n${row.description}` : row.path;
  link.dataset.action = 'open-folder-level';
  link.dataset.folderId = row.id;
  link.append(element('i', 'fas fa-folder fa-fw mr-1'), element('span', 'folder-name', row.name));
  const count = entityCountOf(row);
  if (count > 0) link.append(element('span', 'badge badge-secondary ml-1 folder-entity-count', String(count)));
  line.append(link, copyOfActions(row));
  item.append(line);
  const more = morePanel(row);
  if (more) item.append(more);
  return item;
}

/** A folder in the cards view: a card with its name and buttons, then how many experiments and resources it holds and when it last changed. */
function folderCard(row: FolderRow): HTMLElement {
  const card = element('div', `folder-flat-item folder-card${row.active ? ' is-active' : ''}`);
  card.draggable = true;
  card.dataset.dragKind = 'folder';
  card.dataset.dragId = row.id;
  card.dataset.dropFolder = row.id;
  const head = element('div', 'd-flex align-items-center');
  const link = element('a', 'text-decoration-none folder-flat-link folder-card-title');
  link.href = row.href;
  link.title = row.path;
  link.dataset.action = 'open-folder-level';
  link.dataset.folderId = row.id;
  link.append(element('i', 'fas fa-folder fa-fw mr-1'), element('span', 'folder-name', row.name));
  head.append(link, copyOfActions(row));
  card.append(head);
  const meta = element('div', 'folder-file-card-meta');
  const counts = element('span', 'folder-entity-count folder-card-counts');
  counts.append(
    element('i', 'fas fa-flask fa-fw'), document.createTextNode(String(row.experiments)),
    element('i', 'fas fa-boxes-stacked fa-fw ml-2'), document.createTextNode(String(row.resources)),
  );
  meta.append(counts);
  const age = shortAge(row.modified);
  if (age) meta.append(element('span', 'folder-file-card-when text-right', age));
  card.append(meta);
  if (row.description) card.append(element('div', 'folder-card-description', row.description));
  const more = morePanel(row);
  if (more) card.append(more);
  return card;
}

function entryIcon(entry: FolderEntry): HTMLElement {
  const icon = element('i', `fas ${entry.type === 'items' ? 'fa-boxes-stacked' : 'fa-flask'} fa-fw mr-1 folder-file-icon`);
  icon.title = i18next.t(entry.type === 'items' ? 'Resource' : 'Experiment');
  return icon;
}

function statusDot(entry: FolderEntry): HTMLElement {
  const dot = element('span', 'folder-status-dot');
  if (entry.statusColor) dot.style.background = entry.statusColor;
  return dot;
}

function dragAttributes(el: HTMLElement, entry: FolderEntry): void {
  el.draggable = true;
  el.dataset.dragKind = 'entry';
  el.dataset.dragType = entry.type;
  el.dataset.dragId = String(entry.id);
}

/** A file in the list view: a click picks it (its preview shows below), a double click or Enter opens it. */
function fileRow(entry: FolderEntry): HTMLElement {
  const row = element('div', `folder-file-row${selectedEntry === entryKey(entry) ? ' is-selected' : ''}`);
  row.tabIndex = 0;
  row.title = entry.title;
  row.dataset.action = 'select-folder-entry';
  row.dataset.entryKey = entryKey(entry);
  row.dataset.openHref = entryHref(entry);
  dragAttributes(row, entry);
  row.append(entryIcon(entry), element('span', 'folder-file-title', entry.title));
  return row;
}

/** A file in the cards view: name, then status, age and the first tag; a click opens it. */
function fileCard(entry: FolderEntry): HTMLAnchorElement {
  const card = element('a', 'folder-file-card text-decoration-none');
  card.href = entryHref(entry);
  card.title = entry.title;
  dragAttributes(card, entry);
  card.append(element('b', 'folder-file-card-title', entry.title));
  const meta = element('div', 'folder-file-card-meta');
  if (entry.type === 'items') meta.append(entryIcon(entry));
  else meta.append(statusDot(entry));
  const age = shortAge(entry.changed);
  meta.append(element('span', 'folder-file-card-when', [entry.status, age].filter(Boolean).join(' · ')));
  if (entry.tags.length > 0) meta.append(element('span', 'folder-file-tag', entry.tags[0]));
  card.append(meta);
  return card;
}

/** The picked file's details, under the list. */
function previewOf(entries: FolderEntry[] | null): HTMLElement {
  const box = element('div', 'folder-preview');
  const entry = entries?.find(candidate => entryKey(candidate) === selectedEntry);
  if (!entry) {
    box.append(element('div', 'folder-preview-empty', i18next.t('Pick a file to see its details here.')));
    return box;
  }
  const open = element('a', 'folder-preview-title', entry.title);
  open.href = entryHref(entry);
  open.title = i18next.t('Open');
  box.append(open);
  const line = (label: string, value: string | HTMLElement): void => {
    if (value === '') return;
    const row = element('div', 'folder-preview-row');
    row.append(element('span', 'folder-preview-label', label));
    const content = element('span', 'folder-preview-value');
    if (typeof value === 'string') content.textContent = value;
    else content.append(value);
    row.append(content);
    box.append(row);
  };
  line(i18next.t('Type'), i18next.t(entry.type === 'items' ? 'Resource' : 'Experiment'));
  if (entry.status) {
    const status = element('span');
    status.append(statusDot(entry), document.createTextNode(` ${entry.status}`));
    line(i18next.t('Status'), status);
  }
  line(i18next.t('Owner'), entry.owner);
  if (entry.changed > 0) line(i18next.t('Edited'), `${new Date(entry.changed * 1000).toLocaleDateString()} (${shortAge(entry.changed)})`);
  line(i18next.t('Tags'), entry.tags.join(', '));
  return box;
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

/** "..": back to the folder that holds the current level (or the top), and a link that lists this folder in the page. */
function upRow(all: FolderRow[]): HTMLElement {
  const chain = ancestorChain(all, level);
  const parent = chain.length > 1 ? chain[chain.length - 2] : null;
  const row = element('div', 'd-flex align-items-center folder-flat-row folder-up-row');
  // dropping something here moves it up one level (to the top level, folders stay folders and files become unfiled)
  row.dataset.dropFolder = parent ? parent.id : 'top';
  const button = levelButton('btn btn-link btn-sm p-0 folder-up-button color-medium', parent ? parent.id : '', '', i18next.t('Up one level'));
  button.replaceChildren(element('i', 'fas fa-level-up-alt fa-fw mr-1'), document.createTextNode(`.. ${parent ? parent.name : i18next.t('All folders')}`));
  row.append(button);
  const current = chain[chain.length - 1];
  if (current) {
    const show = element('a', 'folder-action-btn hl-hover-gray rounded ml-auto color-medium');
    show.href = current.href;
    show.title = i18next.t('Show this folder in the page');
    show.setAttribute('aria-label', show.title);
    show.append(element('i', 'fas fa-arrow-up-right-from-square fa-xs'));
    row.append(show);
  }
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
    // the chevron and the part after it stay together, so a wrapped line never starts with a lone chevron
    const group = element('span', 'folder-path-part');
    if (index > 0) group.append(element('i', 'fas fa-chevron-right folder-path-sep'));
    const last = index === crumbs.length - 1;
    const part = last
      ? element('span', 'folder-path-crumb')
      : levelButton('folder-path-crumb', crumb.id, '', crumb.name);
    if (last) part.setAttribute('aria-current', 'location');
    part.replaceChildren(element('i', `fas ${crumb.icon} fa-fw`), document.createTextNode(crumb.name));
    group.append(part);
    nav.append(group);
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
  const preview = element('div', 'folder-preview-holder');
  const bar = element('div', 'folder-level-bar-holder mt-2');
  flat.append(filter, body, preview, bar);
  tree.after(flat);
  return flat;
}

/**
 * The selected folder as a path under the tabs ("Vatsi › EV Project  ×"): each part opens that folder in the page, the x shows
 * everything again. Hidden when no folder is selected (or when the selection is "Unfiled", which has its own row).
 */
function syncFolderCrumb(entityType: string): void {
  const nav = document.getElementById('folderCrumb');
  if (!nav) return;
  const currentId = document.getElementById('experimentsFoldersSidebar')?.dataset.currentFolderId ?? '';
  const tree = document.getElementById('experimentsFoldersTree');
  const node = /^[1-9]\d*$/.test(currentId) ? tree?.querySelector<HTMLElement>(`.folder-node[data-folder-id="${currentId}"]`) ?? null : null;
  if (!node) {
    nav.hidden = true;
    nav.replaceChildren();
    return;
  }
  const chain: HTMLElement[] = [];
  for (let el: HTMLElement | null = node; el; el = el.parentElement?.closest<HTMLElement>('.folder-node') ?? null) chain.unshift(el);
  const parts: Node[] = [];
  chain.forEach((folder, index) => {
    const link = folder.querySelector<HTMLAnchorElement>(':scope > .folder-row [data-folder-entity-link]');
    const name = folder.querySelector(':scope > .folder-row .folder-name')?.textContent?.trim() ?? '';
    if (index > 0) parts.push(element('span', 'folder-crumb-sep', '›'));
    const part = element('a', `folder-crumb-part${index === chain.length - 1 ? ' is-current' : ''}`, name);
    part.href = link?.href ?? '#';
    part.title = folder.dataset.folderFullPath ?? name;
    parts.push(part);
  });
  const option = document.querySelector<HTMLOptionElement>('#folderQuickLinkSelect option[value="all"]');
  const clear = element('a', 'folder-crumb-clear', '×');
  clear.href = (entityType === 'items' ? option?.dataset.itemsHref : option?.dataset.experimentsHref) ?? 'experiments.php';
  clear.title = i18next.t('Show all folders');
  clear.setAttribute('aria-label', i18next.t('Show all folders'));
  nav.replaceChildren(...parts, clear);
  nav.hidden = false;
}

/** The parts of the panel that every view shares: the Exp / Res / All switch, the quick links, the option switches, the page classes. */
function syncPanelChrome(): void {
  const current = panelPrefs();
  const entityType = currentEntityType();
  const active = current.allTypes ? 'all' : entityType === 'items' ? 'items' : 'experiments';
  document.querySelectorAll<HTMLElement>('[data-action="select-folder-type"]').forEach(button => {
    const on = button.dataset.type === active;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  });
  // the quick links (All / Unfiled) follow the experiments / resources choice, as the select they replace did
  document.querySelectorAll<HTMLAnchorElement>('[data-folder-quick]').forEach(link => {
    const option = document.querySelector<HTMLOptionElement>(`#folderQuickLinkSelect option[value="${link.dataset.folderQuick}"]`);
    const href = entityType === 'items' ? option?.dataset.itemsHref : option?.dataset.experimentsHref;
    if (href) link.href = href;
    link.classList.toggle('font-weight-bold', option?.selected === true);
  });
  syncFolderCrumb(entityType);
  document.querySelectorAll<HTMLElement>('[data-folder-pref]').forEach(button => {
    const key = button.dataset.folderPref as keyof PanelPrefs;
    button.setAttribute('aria-checked', String(current[key]));
    button.classList.toggle('is-on', current[key]);
  });
  const panel = document.getElementById('foldersPanel');
  panel?.classList.toggle('folders-no-favorites', !current.favorites);
  panel?.classList.toggle('folders-no-counts', !current.counts);
}

/**
 * Show the chosen view. Call it whenever the tree changed (panel loaded, scope or experiments/resources switched):
 * the flat views are rebuilt from the tree as it is then.
 */
export function syncFolderView(): void {
  const tree = document.getElementById('experimentsFoldersTree');
  if (!tree) return;
  const view = currentFolderView();
  syncPanelChrome();
  document.querySelectorAll<HTMLElement>('[data-action="select-folder-view"]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  tree.hidden = view !== 'tree';
  // the tree keeps the original New folder form, the flat views the icon
  document.querySelectorAll<HTMLElement>('[data-folder-create]').forEach(box => { box.hidden = (box.dataset.folderCreate === 'tree') !== (view === 'tree'); });
  const existingFlat = document.getElementById('experimentsFoldersFlat');
  if (view === 'tree') {
    if (existingFlat) existingFlat.hidden = true;
    return;
  }
  const flat = ensureFlatContainer(tree);
  flat.hidden = false;
  const body = flat.querySelector<HTMLElement>('.folder-flat-body');
  if (!body) return;
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
  const rows = sortFolderRows(pool, 'name', 1);
  flat.querySelector<HTMLElement>('.folder-level-bar-holder')?.replaceChildren(levelPathBar(all));
  const parts: HTMLElement[] = [];
  if (level !== '' && !searching) parts.push(upRow(all));
  // the cards view draws folders as cards too, in the same stack as the file cards
  const cardsBox = view === 'cards' ? element('div', 'folder-file-cards') : null;
  if (cardsBox) {
    rows.forEach(row => cardsBox.append(folderCard(row)));
    parts.push(cardsBox);
  } else {
    rows.forEach(row => parts.push(folderItem(row)));
  }
  // the files of the folder we are in (the top level has none: its files are in the folders, or unfiled)
  let entries: FolderEntry[] | null = [];
  if (panelPrefs().files && level !== '' && !searching) {
    entries = entriesOf(level);
    const shown = (entries ?? []).filter(entry => shownEntryTypes().includes(entry.type));
    if (entries === null) parts.push(element('div', 'folder-entry-note small color-medium', i18next.t('Loading...')));
    else if (view === 'list') shown.forEach(entry => parts.push(fileRow(entry)));
    else if (cardsBox) shown.forEach(entry => cardsBox.append(fileCard(entry)));
    entries = shown;
  }
  if (parts.length === 0) {
    parts.push(element('div', 'small color-medium text-center border rounded p-3', i18next.t(all.length === 0 ? 'No folders to show.' : searching ? 'No folder matches.' : 'No folders in here.')));
  }
  body.replaceChildren(...parts);
  const previewHolder = flat.querySelector<HTMLElement>('.folder-preview-holder');
  if (previewHolder) {
    if (view === 'list' && panelPrefs().files && level !== '' && !searching) previewHolder.replaceChildren(previewOf(entries));
    else previewHolder.replaceChildren();
  }
}

function closePopovers(except: HTMLElement | null = null): void {
  document.querySelectorAll<HTMLElement>('.folder-popover').forEach(pop => {
    if (pop !== except) pop.hidden = true;
  });
  document.querySelectorAll<HTMLElement>('[data-action="toggle-folder-popover"]').forEach(button => {
    button.setAttribute('aria-expanded', String(!!except && button.dataset.popover === except.id));
  });
}

/** The bookmarked folders, as the list the star button opens. */
function fillFavoritesPopover(pop: HTMLElement): void {
  const tree = document.getElementById('experimentsFoldersTree');
  const favorites = tree ? sortFolderRows(collectRows(tree).filter(row => row.favorite), 'path', 1) : [];
  if (favorites.length === 0) {
    pop.replaceChildren(element('div', 'folder-popover-note', i18next.t('Star a folder to find it here.')));
    return;
  }
  pop.replaceChildren(
    element('div', 'folder-popover-label', i18next.t('Favourites')),
    ...favorites.map(row => {
      const link = element('a', 'folder-popover-item text-decoration-none');
      link.href = row.href;
      link.title = row.path;
      link.dataset.action = 'open-favorite-folder';
      link.dataset.folderId = row.id;
      link.append(element('i', 'fas fa-folder fa-fw mr-1'), element('span', 'folder-popover-text', row.name));
      return link;
    }),
  );
}

/** Wires the view buttons, the Exp / Res / All switch and the pop-up lists (delegated, so they survive the panel being replaced). */
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
    closePopovers();
    syncFolderView();
  });
  on('select-folder-type', (el: HTMLElement) => {
    const type = el.dataset.type;
    if (type === 'all') {
      setPanelPref('allTypes', true);
      syncFolderView();
      return;
    }
    if (type !== 'experiments' && type !== 'items') return;
    setPanelPref('allTypes', false);
    const select = document.getElementById('folderEntityTypeSelect') as HTMLSelectElement | null;
    if (select && select.value !== type) {
      // the select (kept out of sight) still drives the page's own handling of the choice
      select.value = type;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      syncFolderView();
    }
  });
  on('folder-pref', (el: HTMLElement) => {
    const key = el.dataset.folderPref as keyof PanelPrefs | undefined;
    if (!key || !(key in DEFAULT_PREFS) || key === 'allTypes') return;
    setPanelPref(key, !panelPrefs()[key]);
    syncFolderView();
  });
  on('toggle-folder-popover', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    const pop = document.getElementById(el.dataset.popover ?? '');
    if (!pop) return;
    const opening = pop.hidden;
    closePopovers(opening ? pop : null);
    if (!opening) return;
    if (pop.id === 'folderFavoritesMenu') fillFavoritesPopover(pop);
    pop.hidden = false;
  });
  on('open-favorite-folder', (el: HTMLElement, event: Event) => {
    // in the tree a favourite is a normal link (it lists the folder in the page); in the flat views it opens the folder here
    if (currentFolderView() === 'tree') return;
    if (event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    event.preventDefault();
    level = el.dataset.folderId ?? '';
    selectedEntry = '';
    filterText = '';
    closePopovers();
    syncFolderView();
  });
  on('toggle-folder-flat-more', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    const panel = el.closest('.folder-flat-item')?.querySelector<HTMLElement>('.folder-flat-more-actions');
    if (!panel) return;
    const open = panel.hidden;
    document.querySelectorAll<HTMLElement>('.folder-flat-more-actions').forEach(other => { other.hidden = other !== panel || !open; });
    document.querySelectorAll<HTMLElement>('[data-action="toggle-folder-flat-more"]').forEach(toggle => toggle.setAttribute('aria-expanded', 'false'));
    el.setAttribute('aria-expanded', String(open));
  });
  // a click anywhere else closes an open pop-up list or three-dots panel
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!(target as Element).closest?.('.folder-popover')) closePopovers();
    document.querySelectorAll<HTMLElement>('.folder-flat-more-actions').forEach(panel => {
      const container = panel.closest('.folder-flat-item');
      if (panel.hidden || container?.contains(target) && (panel.contains(target) || (target as Element).closest?.('[data-action="toggle-folder-flat-more"]'))) return;
      panel.hidden = true;
    });
  });
  on('select-folder-entry', (el: HTMLElement) => {
    selectedEntry = el.dataset.entryKey ?? '';
    syncFolderView();
  });
  // a double click, or Enter, opens the picked file
  document.addEventListener('dblclick', event => {
    const row = (event.target as Element | null)?.closest<HTMLElement>('#foldersPanel [data-open-href]');
    if (row?.dataset.openHref) window.location.href = row.dataset.openHref;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const row = (event.target as Element | null)?.closest<HTMLElement>('#foldersPanel [data-open-href]');
    if (row?.dataset.openHref) window.location.href = row.dataset.openHref;
  });
  on('open-folder-level', (el: HTMLElement, event: Event) => {
    // ctrl/cmd/shift/middle click on a folder keeps its normal meaning (list the folder in the page, in a new tab or window)
    if (event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    event.preventDefault();
    level = el.dataset.folderId ?? '';
    selectedEntry = '';
    // stepping to another level also leaves a search, which would otherwise keep listing every folder
    filterText = '';
    const filter = document.getElementById('folderFlatFilter') as HTMLInputElement | null;
    if (filter) filter.value = '';
    syncFolderView();
  });
}
