/**
 * Activity log of the resources: who changed what and when, as a table (field edits, stock and storage changes)
 */
import { ApiC } from './api';
import { getEntityTypeFromPage } from './misc';

type Entry = {
  id: number;
  created_at: string;
  target: string;
  content: string | null;
  userid: number;
  fullname: string | null;
  entity_id: number;
  title: string | null;
  category: number | null;
  category_title: string | null;
  category_color: string | null;
};
type SortKey = 'created_at' | 'fullname' | 'category_title' | 'title' | 'target';

const PAGE_SIZE = 100;
const FETCH_LIMIT = 2000;

let rootEl: HTMLElement | null = null;
let onFiltersChanged: ((event: Event) => void) | null = null;
let requestId = 0;

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

// the content of a changelog entry may hold a link or markup: show only its text
function plainText(content: string | null): string {
  if (!content) {
    return '';
  }
  return new DOMParser().parseFromString(content, 'text/html').body.textContent?.trim() ?? '';
}

function fieldLabel(target: string): string {
  const labels: Record<string, string> = {
    title: 'Title',
    body: 'Main text',
    bodyappend: 'Main text',
    metadata: 'Custom fields',
    category: 'Category',
    status: 'Status',
    containers: 'Storage',
    container_created: 'Storage added',
    container_deleted: 'Storage removed',
    container_moved: 'Storage moved',
    container_qty_changed: 'Quantity',
    container_unit_changed: 'Unit',
    date: 'Date',
  };
  return labels[target] ?? target.charAt(0).toUpperCase() + target.slice(1).replace(/_/g, ' ');
}

export function mountActivityLog(rootElement: HTMLElement | null, onLoaded: () => void): void {
  if (!rootElement) {
    return;
  }
  unmountActivityLog();
  rootEl = rootElement;

  let entries: Entry[] = [];
  let sortKey: SortKey = 'created_at';
  let sortAsc = false;
  let shown = PAGE_SIZE;
  let query = '';
  let userFilter = '';

  const toolbar = el('div', 'd-flex flex-wrap align-items-center mb-2');
  const search = el('input', 'form-control form-control-sm w-auto mr-2 mb-1');
  search.type = 'search';
  search.placeholder = 'Filter the log';
  search.setAttribute('aria-label', 'Filter the log');
  const userSelect = el('select', 'form-control form-control-sm w-auto mr-2 mb-1');
  userSelect.setAttribute('aria-label', 'User');
  const count = el('span', 'color-medium small ml-auto mb-1');
  toolbar.append(search, userSelect, count);
  const tableWrap = el('div', 'table-responsive');
  const more = el('button', 'btn btn-secondary btn-sm mb-3', 'Show more');
  more.type = 'button';
  rootEl.replaceChildren(toolbar, tableWrap, more);

  const columns: { key: SortKey; head: string }[] = [
    { key: 'created_at', head: 'Date' },
    { key: 'fullname', head: 'User' },
    { key: 'category_title', head: 'Category' },
    { key: 'title', head: 'Record' },
    { key: 'target', head: 'Field' },
  ];

  const visible = (): Entry[] => {
    const needle = query.toLowerCase();
    return entries
      .filter(e => userFilter === '' || String(e.userid) === userFilter)
      .filter(e => needle === '' || [e.title, e.fullname, e.category_title, fieldLabel(e.target), plainText(e.content)]
        .some(v => (v ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => {
        const av = String(a[sortKey] ?? '');
        const bv = String(b[sortKey] ?? '');
        // entries of the same time keep the newest id first
        const cmp = av.localeCompare(bv) || a.id - b.id;
        return sortAsc ? cmp : -cmp;
      });
  };

  const render = (): void => {
    const rows = visible();
    count.textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`;
    const table = el('table', 'table table-sm table-hover activity-table');
    const head = el('tr');
    columns.forEach(c => {
      const th = el('th', 'activity-sortable');
      th.textContent = `${c.head}${sortKey === c.key ? (sortAsc ? ' ▲' : ' ▼') : ''}`;
      th.addEventListener('click', () => {
        sortAsc = sortKey === c.key ? !sortAsc : c.key !== 'created_at';
        sortKey = c.key;
        render();
      });
      head.append(th);
    });
    head.append(el('th', '', 'Details'));
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    rows.slice(0, shown).forEach(e => {
      const tr = el('tr');
      tr.append(el('td', 'text-nowrap', e.created_at));
      tr.append(el('td', '', e.fullname ?? ''));
      const catCell = el('td', 'text-nowrap');
      if (e.category_color) {
        const dot = el('span', 'category-nav-dot');
        dot.style.backgroundColor = `#${e.category_color}`;
        catCell.append(dot);
      }
      catCell.append(document.createTextNode(e.category_title ?? ''));
      tr.append(catCell);
      const recordCell = el('td');
      const link = el('a', '', e.title ?? '');
      link.href = `?mode=view&id=${encodeURIComponent(String(e.entity_id))}`;
      recordCell.append(link);
      tr.append(recordCell);
      tr.append(el('td', 'text-nowrap', fieldLabel(e.target)));
      tr.append(el('td', 'activity-details', plainText(e.content)));
      body.append(tr);
    });
    table.append(thead, body);
    tableWrap.replaceChildren(rows.length === 0 ? el('p', 'text-muted', 'Nothing to show.') : table);
    more.hidden = rows.length <= shown;
  };

  more.addEventListener('click', () => {
    shown += PAGE_SIZE;
    render();
  });
  search.addEventListener('input', () => {
    query = search.value.trim();
    shown = PAGE_SIZE;
    render();
  });
  userSelect.addEventListener('change', () => {
    userFilter = userSelect.value;
    shown = PAGE_SIZE;
    render();
  });

  const load = async (event?: Event): Promise<void> => {
    const current = ++requestId;
    const detail = (event as CustomEvent | undefined)?.detail;
    const params = detail instanceof URLSearchParams ? new URLSearchParams(detail) : new URLSearchParams(document.location.search);
    // only the category of the page filters on the server, the other filters are made on the fetched entries
    const query = new URLSearchParams({ limit: String(FETCH_LIMIT), type: getEntityTypeFromPage(window.location) });
    const category = (params.get('category') ?? '').split(',')[0] ?? '';
    if (/^\d+$/.test(category)) {
      query.set('category', category);
    }
    try {
      const loaded = await ApiC.getJson<Entry[]>(`activity?${query.toString()}`, { notifOnError: 0 });
      if (current !== requestId) {
        return;
      }
      entries = loaded;
      const users = new Map<number, string>();
      entries.forEach(e => users.set(e.userid, e.fullname ?? String(e.userid)));
      userSelect.replaceChildren(new Option('All users', ''));
      [...users.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => userSelect.append(new Option(name, String(id))));
      userSelect.value = userFilter;
      render();
    } catch (error) {
      console.error(`Could not load the activity log: ${error}`);
    }
  };
  onFiltersChanged = (event: Event): void => {
    void load(event);
  };
  window.addEventListener('entity-filters-changed', onFiltersChanged);
  void load().then(onLoaded);
}

export function unmountActivityLog(): void {
  if (onFiltersChanged) {
    window.removeEventListener('entity-filters-changed', onFiltersChanged);
    onFiltersChanged = null;
  }
  requestId++;
  rootEl?.replaceChildren();
  rootEl = null;
}
