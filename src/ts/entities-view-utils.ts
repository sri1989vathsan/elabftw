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

// the locations of a resource as links to the storage browser, separated by a bar
export function appendLocationLinks(cell: HTMLElement, locations: { storage_id: number; path: string }[]): void {
  locations.forEach((l, i) => {
    if (i > 0) {
      cell.append(document.createTextNode(' | '));
    }
    const a = document.createElement('a');
    a.href = storageUrl(l.storage_id);
    a.textContent = l.path;
    cell.append(a);
  });
}
