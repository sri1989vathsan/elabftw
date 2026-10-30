/**
 * Small helpers shared by the resource views (grouped, storage browser, activity log, expandable table)
 */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text) {
    node.textContent = text;
  }
  return node;
}

// the content of a changelog entry may hold a link or markup: keep only its text
export function plainText(content: string | null): string {
  if (!content) {
    return '';
  }
  return new DOMParser().parseFromString(content, 'text/html').body.textContent?.trim() ?? '';
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  body: 'Main text',
  bodyappend: 'Main text',
  metadata: 'Custom fields',
  category: 'Category',
  status: 'Status',
  date: 'Date',
  containers: 'Storage',
  container_created: 'Storage added',
  container_deleted: 'Storage removed',
  container_moved: 'Storage moved',
  container_qty_changed: 'Quantity',
  container_unit_changed: 'Unit',
};

export function fieldLabel(target: string): string {
  return FIELD_LABELS[target] ?? target.charAt(0).toUpperCase() + target.slice(1).replace(/_/g, ' ');
}

// the filters of the page (search, category, owner...) as parameters for the API, with the preferred order
export function filterParams(event?: Event, order = 'date', sort = 'desc'): URLSearchParams {
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

const URL_RE = /^https?:\/\/\S+$/i;

// a value that is a web address becomes a link to it, anything else stays text
export function linkify(value: string): Node {
  if (!URL_RE.test(value)) {
    return document.createTextNode(value);
  }
  const a = document.createElement('a');
  a.href = value;
  a.textContent = value;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

// the storage browser, opened on a location
export function storageUrl(storageId: number): string {
  return `?storage_unit=${encodeURIComponent(String(storageId))}`;
}

// the locations of a resource as links to the storage browser, each with its slot in the box, separated by a bar
export function appendLocationLinks(cell: HTMLElement, locations: { storage_id: number; path: string; position?: string | null }[]): void {
  locations.forEach((l, i) => {
    if (i > 0) {
      cell.append(document.createTextNode(' | '));
    }
    const a = document.createElement('a');
    a.href = storageUrl(l.storage_id);
    a.textContent = l.path;
    cell.append(a);
    if (l.position) {
      const slot = document.createElement('span');
      slot.className = 'color-medium';
      slot.textContent = ` · ${l.position}`;
      cell.append(slot);
    }
  });
}

export type SortState = { key: string; asc: boolean };

// numbers compare as numbers, text in natural order ("Box 2" before "Box 10"), empty values stay last in both directions
export function sortRows<T>(rows: T[], sort: SortState | null, valueOf: (row: T, key: string) => string | number): T[] {
  if (sort === null) {
    return rows;
  }
  const direction = sort.asc ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = valueOf(a, sort.key);
    const bv = valueOf(b, sort.key);
    if (av === '' || bv === '') {
      return av === bv ? 0 : (av === '' ? 1 : -1);
    }
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * direction;
    }
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * direction;
  });
}

// a column header that sorts its table when clicked, with an arrow on the sorted column
export function sortableHeader(th: HTMLElement, label: string, key: string, sort: SortState | null, onSort: (sort: SortState) => void): void {
  const active = sort?.key === key;
  th.classList.add('sortable-th');
  th.tabIndex = 0;
  th.setAttribute('role', 'button');
  th.setAttribute('aria-sort', active ? (sort.asc ? 'ascending' : 'descending') : 'none');
  th.textContent = `${label}${active ? (sort.asc ? ' ▲' : ' ▼') : ''}`;
  const activate = (): void => onSort({ key, asc: active ? !sort.asc : true });
  th.addEventListener('click', activate);
  th.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });
}
