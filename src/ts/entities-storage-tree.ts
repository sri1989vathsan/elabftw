/**
 * Storage browser for the resources: a searchable tree of the storage units on the left,
 * the contents of the selected location on the right, like the storage browser of an inventory system
 */
import { ApiC } from './api';
import { getEntityTypeFromPage } from './misc';

type Unit = { id: number; name: string; full_path: string; parent_id: number | null; children_count: number };
type StorageLocation = { storage_id: number; path: string; qty_stored: number; qty_unit: string };
type Row = {
  id: number;
  title: string;
  category_title: string | null;
  category_color: string | null;
  fullname: string;
  storage_locations?: StorageLocation[];
};
type Node = { unit: Unit; children: Node[]; own: Row[]; total: number };

const STATE_KEY = 'persistent_storage_tree_v1';

let rootEl: HTMLElement | null = null;
let onFiltersChanged: ((event: Event) => void) | null = null;
let requestId = 0;

type StoredState = { selected: number | null; collapsed: Record<string, boolean> };

function readState(): StoredState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (parsed) {
      return { selected: typeof parsed.selected === 'number' ? parsed.selected : null, collapsed: parsed.collapsed ?? {} };
    }
  } catch {
    // localStorage might be unavailable
  }
  return { selected: null, collapsed: {} };
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

function buildTree(units: Unit[], rows: Row[]): { roots: Node[]; byId: Map<number, Node> } {
  const byId = new Map<number, Node>();
  units.forEach(unit => byId.set(unit.id, { unit, children: [], own: [], total: 0 }));
  const roots: Node[] = [];
  byId.forEach(node => {
    const parent = node.unit.parent_id === null ? undefined : byId.get(node.unit.parent_id);
    (parent ? parent.children : roots).push(node);
  });
  rows.forEach(row => (row.storage_locations ?? []).forEach(l => byId.get(l.storage_id)?.own.push(row)));
  const sortNodes = (nodes: Node[]): void => {
    nodes.sort((a, b) => a.unit.name.localeCompare(b.unit.name));
    nodes.forEach(n => sortNodes(n.children));
  };
  sortNodes(roots);
  // the totals include the sub-locations
  const total = (node: Node): number => {
    node.total = node.own.length + node.children.reduce((sum, c) => sum + total(c), 0);
    return node.total;
  };
  roots.forEach(total);
  return { roots, byId };
}

function collect(node: Node, withChildren: boolean): { row: Row; location: StorageLocation }[] {
  const out: { row: Row; location: StorageLocation }[] = [];
  const visit = (n: Node): void => {
    n.own.forEach(row => {
      const location = (row.storage_locations ?? []).find(l => l.storage_id === n.unit.id);
      if (location) {
        out.push({ row, location });
      }
    });
    if (withChildren) {
      n.children.forEach(visit);
    }
  };
  visit(node);
  return out;
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

export function mountStorageTree(rootElement: HTMLElement | null, order: string, sort: string, onLoaded: () => void): void {
  if (!rootElement) {
    return;
  }
  unmountStorageTree();
  rootEl = rootElement;
  const state = readState();
  let includeChildren = true;
  let query = '';
  let tree: { roots: Node[]; byId: Map<number, Node> } = { roots: [], byId: new Map() };

  const layout = el('div', 'storage-tree-layout');
  const side = el('div', 'storage-tree-side');
  const main = el('div', 'storage-tree-main');
  layout.append(side, main);
  rootEl.replaceChildren(layout);

  const tools = el('div', 'mb-2');
  const search = el('input', 'form-control form-control-sm mb-2');
  search.type = 'search';
  search.placeholder = 'Search storage';
  search.setAttribute('aria-label', 'Search storage');
  const expandAll = el('button', 'btn btn-transparent btn-sm', 'Expand all');
  const collapseAll = el('button', 'btn btn-transparent btn-sm', 'Collapse all');
  expandAll.type = collapseAll.type = 'button';
  tools.append(search, expandAll, collapseAll);
  const treeBox = el('div', 'storage-tree');
  side.append(tools, treeBox);

  const matches = (node: Node): boolean =>
    node.unit.name.toLowerCase().includes(query) || node.children.some(matches);

  const select = (id: number): void => {
    state.selected = id;
    writeState(state);
    renderTree();
    renderMain();
  };

  const renderNode = (node: Node, depth: number): HTMLElement => {
    const li = el('li', 'storage-tree-node');
    const row = el('div', `storage-tree-row${state.selected === node.unit.id ? ' selected' : ''}`);
    row.style.paddingLeft = `${depth * 1}rem`;
    const hasChildren = node.children.length > 0;
    const key = String(node.unit.id);
    const collapsed = query === '' && (state.collapsed[key] ?? false);
    const caret = el('button', 'storage-tree-caret btn btn-transparent btn-sm');
    caret.type = 'button';
    caret.setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');
    caret.append(el('i', hasChildren ? `fas fa-fw ${collapsed ? 'fa-caret-right' : 'fa-caret-down'}` : 'fas fa-fw'));
    caret.disabled = !hasChildren;
    caret.addEventListener('click', () => {
      state.collapsed[key] = !collapsed;
      writeState(state);
      renderTree();
    });
    const label = el('button', 'storage-tree-label btn btn-transparent btn-sm');
    label.type = 'button';
    label.append(el('i', 'fas fa-fw fa-location-dot mr-1'), el('span', '', node.unit.name), el('span', 'grouped-section-count', String(node.total)));
    label.addEventListener('click', () => select(node.unit.id));
    row.append(caret, label);
    li.append(row);
    if (hasChildren && !collapsed) {
      const ul = el('ul', 'storage-tree-list');
      node.children.filter(c => query === '' || matches(c)).forEach(c => ul.append(renderNode(c, depth + 1)));
      li.append(ul);
    }
    return li;
  };

  const renderTree = (): void => {
    const ul = el('ul', 'storage-tree-list');
    tree.roots.filter(r => query === '' || matches(r)).forEach(r => ul.append(renderNode(r, 0)));
    treeBox.replaceChildren(ul);
  };

  const renderMain = (): void => {
    main.replaceChildren();
    const node = state.selected === null ? undefined : tree.byId.get(state.selected);
    if (!node) {
      main.append(el('p', 'text-muted', 'Select a storage location in the tree.'));
      return;
    }
    main.append(el('h4', '', node.unit.full_path));
    const opt = el('label', 'd-block mb-2');
    const box = el('input', 'mr-1');
    box.type = 'checkbox';
    box.checked = includeChildren;
    box.addEventListener('change', () => {
      includeChildren = box.checked;
      renderMain();
    });
    opt.append(box, document.createTextNode('Include sub-locations'));
    main.append(opt);

    if (node.children.length > 0) {
      const subs = el('div', 'mb-3');
      node.children.forEach(c => {
        const chip = el('button', 'btn btn-sm btn-secondary mr-1 mb-1', `${c.unit.name} (${c.total})`);
        chip.type = 'button';
        chip.addEventListener('click', () => select(c.unit.id));
        subs.append(chip);
      });
      main.append(subs);
    }

    const entries = collect(node, includeChildren);
    if (entries.length === 0) {
      main.append(el('p', 'text-muted', 'This location does not contain any resource.'));
      return;
    }
    const table = el('table', 'table table-sm table-hover');
    const head = el('tr');
    ['Title', 'Category', 'Quantity', 'Location', 'Owner'].forEach(h => head.append(el('th', '', h)));
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    entries.forEach(({ row, location }) => {
      const tr = el('tr');
      const titleCell = el('td');
      const link = el('a', '', row.title);
      link.href = `?mode=view&id=${encodeURIComponent(String(row.id))}`;
      titleCell.append(link);
      tr.append(titleCell);
      [row.category_title ?? '', `${location.qty_stored} ${location.qty_unit}`.trim(), location.path, row.fullname ?? '']
        .forEach(text => tr.append(el('td', '', text)));
      body.append(tr);
    });
    table.append(thead, body);
    const wrap = el('div', 'table-responsive');
    wrap.append(table);
    main.append(wrap);
  };

  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderTree();
  });
  const setAll = (collapsed: boolean): void => {
    tree.byId.forEach(node => {
      state.collapsed[String(node.unit.id)] = collapsed;
    });
    writeState(state);
    renderTree();
  };
  expandAll.addEventListener('click', () => setAll(false));
  collapseAll.addEventListener('click', () => setAll(true));

  const load = async (event?: Event): Promise<void> => {
    const current = ++requestId;
    const params = filterParams(event, order, sort);
    try {
      const endpoint = getEntityTypeFromPage(window.location);
      const [units, rows] = await Promise.all([
        ApiC.getJson<Unit[]>('storage_units?hierarchy=1', { notifOnError: 0 }),
        ApiC.getJson<Row[]>(`${endpoint}?${params.toString()}`, { notifOnError: 0 }),
      ]);
      // a later filter change may have started another request in the meantime
      if (current !== requestId) {
        return;
      }
      tree = buildTree(units, rows);
      renderTree();
      renderMain();
    } catch (error) {
      console.error(`Could not load the storage browser: ${error}`);
    }
  };
  onFiltersChanged = (event: Event): void => {
    void load(event);
  };
  window.addEventListener('entity-filters-changed', onFiltersChanged);
  void load().then(onLoaded);
}

export function unmountStorageTree(): void {
  if (onFiltersChanged) {
    window.removeEventListener('entity-filters-changed', onFiltersChanged);
    onFiltersChanged = null;
  }
  requestId++;
  rootEl?.replaceChildren();
  rootEl = null;
}
