/**
 * Storage browser for the resources: a searchable tree of the storage units on the left,
 * the contents of the selected location on the right, like the storage browser of an inventory system
 */
import { ApiC } from './api';
import { getEntityTypeFromPage } from './misc';
import { askConfirm } from './confirm-dialog';
import { capColourName, capDot } from './cap-colours';

type Unit = { id: number; name: string; full_path: string; parent_id: number | null; children_count: number; box_rows: number | null; box_cols: number | null; position?: number | null; kind?: string | null; temperature?: number | null; capacity?: number | null; child_capacity?: number | null; comment?: string | null };
type StorageLocation = { storage_id: number; container_id: number; is_primary?: boolean; comment?: string | null; position: string | null; path: string; qty_stored: number; qty_unit: string; stored_at?: string | null; cap_colour?: string | null };
type Row = {
  id: number;
  title: string;
  category_title: string | null;
  category_color: string | null;
  fullname: string;
  storage_locations?: StorageLocation[];
  extra_fields?: { name: string; value: string }[];
  web_links?: { url: string; label: string }[];
  description?: string;
};
type Node = { unit: Unit; children: Node[]; own: Row[]; total: number };
type Tube = { row: Row; location: StorageLocation };

// the fields shown on the card of a tube, per category (lower case names)
const CARD_FIELDS: Record<string, string[]> = {
  plasmids: ['backbone', 'resistance'],
  antibodies: ['target', 'antibody type', 'host species', 'conjugate'],
  'cells & strains': ['kind', 'species / organism'],
  probes: ['target', 'label'],
  primers: ['target gene', 'orientation'],
  reagents: ['supplier', 'catalog number'],
  samples: ['sample type', 'concentration'],
};

// the details of a tube, shown while the pointer is over it
let tubeCard: HTMLElement | null = null;

function hideTubeCard(): void {
  tubeCard?.remove();
  tubeCard = null;
}

function fillTubeCard(card: HTMLElement, tube: Tube, linked: boolean): void {
  card.replaceChildren();
  if (linked) {
    // the pinned card: the title leads to the entry
    const link = el('a', 'tube-card-title', tube.row.title);
    link.href = `?mode=view&id=${encodeURIComponent(String(tube.row.id))}`;
    card.append(link);
  } else {
    card.append(el('div', 'tube-card-title', tube.row.title));
  }
  const meta = el('div', 'tube-card-meta');
  if (tube.row.category_color) {
    const dot = el('span', 'category-nav-dot');
    dot.style.backgroundColor = `#${tube.row.category_color}`;
    meta.append(dot);
  }
  meta.append(document.createTextNode(`#${tube.row.id}${tube.row.category_title ? ` · ${tube.row.category_title}` : ''}`));
  card.append(meta);
  const line = (label: string, value: string): void => {
    if (value === '') {
      return;
    }
    const row = el('div', 'tube-card-row');
    row.append(el('span', 'tube-card-label', label), el('span', '', value));
    card.append(row);
  };
  line('Slot', tube.location.position ?? '');
  line('Storage', tube.location.is_primary ? 'Primary' : 'Secondary');
  line('Quantity', `${tube.location.qty_stored} ${tube.location.qty_unit}`.trim());
  line('Stored on', (tube.location.stored_at ?? '').slice(0, 10));
  if (tube.location.cap_colour) {
    const capRow = el('div', 'tube-card-row');
    const dot = capDot(tube.location.cap_colour);
    capRow.append(el('span', 'tube-card-label', 'Cap'), el('span', '', capColourName(tube.location.cap_colour)));
    if (dot) {
      capRow.lastElementChild?.prepend(dot);
    }
    card.append(capRow);
  }
  line('Comment', tube.location.comment ?? '');
  // the fields that identify an entry of its category, when they are filled
  const shown = CARD_FIELDS[(tube.row.category_title ?? '').toLowerCase()] ?? [];
  shown.forEach(name => {
    const field = (tube.row.extra_fields ?? []).find(f => f.name.toLowerCase() === name);
    line(field?.name ?? name, field?.value ?? '');
  });
  line('Owner', tube.row.fullname ?? '');
  const benchling = benchlingUrl(tube.row);
  if (benchling !== '') {
    const row = el('div', 'tube-card-row');
    row.append(el('span', 'tube-card-label', 'Benchling'));
    if (linked) {
      const link = el('a', 'tube-card-text', 'Open the Benchling entry');
      link.href = benchling;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link);
    } else {
      row.append(el('span', 'tube-card-text', benchling.replace(/^https?:\/\//i, '')));
    }
    card.append(row);
  }
  if (tube.row.description) {
    const row = el('div', 'tube-card-row');
    row.append(el('span', 'tube-card-label', 'About'), el('span', 'tube-card-text tube-card-description', tube.row.description));
    card.append(row);
  }
}

// the address of the Benchling entry: the field of that name, else a web link to Benchling
function benchlingUrl(row: Row): string {
  const field = (row.extra_fields ?? []).find(f => /benchling/i.test(f.name) && /^https?:\/\//i.test(f.value));
  if (field) {
    return field.value;
  }
  return (row.web_links ?? []).find(l => /benchling/i.test(l.url))?.url ?? '';
}

// the moment the page last scrolled: tubes that slide under a still pointer while scrolling do not open their card
let lastScroll = 0;

function showTubeCard(tube: Tube, event: MouseEvent): void {
  if (pinnedCard || Date.now() - lastScroll < 300) {
    return;
  }
  if (!tubeCard) {
    tubeCard = el('div', 'tube-card');
    tubeCard.setAttribute('role', 'tooltip');
    document.body.append(tubeCard);
  }
  fillTubeCard(tubeCard, tube, false);
  moveTubeCard(event);
}

// the card kept open by a click on a tube: a link to the entry and what can be done with the tube
let pinnedCard: HTMLElement | null = null;

function closePinnedCard(): void {
  pinnedCard?.remove();
  pinnedCard = null;
}

function pinTubeCard(tube: Tube, anchor: HTMLElement, actions: { label: string; run: () => void }[]): void {
  closePinnedCard();
  hideTubeCard();
  const card = el('div', 'tube-card pinned');
  card.setAttribute('role', 'dialog');
  fillTubeCard(card, tube, true);
  const bar = el('div', 'tube-card-actions');
  const open = el('a', 'btn btn-primary btn-sm', 'Open entry');
  open.href = `?mode=view&id=${encodeURIComponent(String(tube.row.id))}`;
  bar.append(open);
  actions.forEach(a => {
    const button = el('button', 'btn btn-secondary btn-sm', a.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      closePinnedCard();
      a.run();
    });
    bar.append(button);
  });
  const close = el('button', 'btn btn-transparent btn-sm', 'Close');
  close.type = 'button';
  close.addEventListener('click', closePinnedCard);
  bar.append(close);
  card.append(bar);
  document.body.append(card);
  pinnedCard = card;
  // under the tube, kept inside the window
  const box = anchor.getBoundingClientRect();
  const x = Math.min(box.left, window.innerWidth - card.offsetWidth - 8);
  const y = box.bottom + 6 + card.offsetHeight > window.innerHeight ? box.top - card.offsetHeight - 6 : box.bottom + 6;
  card.style.left = `${Math.max(8, x)}px`;
  card.style.top = `${Math.max(8, y)}px`;
}

document.addEventListener('mousedown', event => {
  if (pinnedCard && !pinnedCard.contains(event.target as Node)) {
    closePinnedCard();
  }
});
// a card is fixed to the window: when the page (or a list in it) scrolls the tube moves away, so the card goes
document.addEventListener('scroll', event => {
  lastScroll = Date.now();
  if (pinnedCard && !pinnedCard.contains(event.target as Node)) {
    closePinnedCard();
  }
  hideTubeCard();
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closePinnedCard();
  }
});

function moveTubeCard(event: MouseEvent): void {
  if (!tubeCard) {
    return;
  }
  const width = tubeCard.offsetWidth;
  const height = tubeCard.offsetHeight;
  // beside the pointer, kept inside the window
  const x = Math.min(event.clientX + 14, window.innerWidth - width - 8);
  const y = event.clientY + 16 + height > window.innerHeight ? event.clientY - height - 12 : event.clientY + 16;
  tubeCard.style.left = `${Math.max(8, x)}px`;
  tubeCard.style.top = `${Math.max(8, y)}px`;
}

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
    // in order: by the position of the place when it has one, then alphabetically
    nodes.sort((a, b) => {
      // the position given to a place decides first; the places without one follow
      const ap = a.unit.position ?? null;
      const bp = b.unit.position ?? null;
      if (ap !== null || bp !== null) {
        if (ap === null) {
          return 1;
        }
        if (bp === null) {
          return -1;
        }
        if (ap !== bp) {
          return ap - bp;
        }
      }
      // then alphabetically, numbers read as numbers ("Box 2" before "Box 10")
      return a.unit.name.localeCompare(b.unit.name, undefined, { numeric: true, sensitivity: 'base' });
    });
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

// the kinds of places: the five that exist from the start and the ones an admin made; each behaves like a location, a cooler (a fridge or a
// freezer), a rack or a box
type KindInfo = { name: string; behaves_like: string; default_temperature: number | null; built_in: boolean };
let kindList: KindInfo[] = [
  { name: 'location', behaves_like: 'location', default_temperature: null, built_in: true },
  { name: 'freezer', behaves_like: 'cooler', default_temperature: -20, built_in: true },
  { name: 'fridge', behaves_like: 'cooler', default_temperature: 4, built_in: true },
  { name: 'rack', behaves_like: 'rack', default_temperature: null, built_in: true },
  { name: 'box', behaves_like: 'box', default_temperature: null, built_in: true },
];
let isAdminUser = false;
const behaves = (kind?: string | null): string | null => (kind ? (kindList.find(k => k.name === kind)?.behaves_like ?? null) : null);
const kindLabel = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

// the tag beside the name of a place: the temperature of a fridge, a freezer or another cooler, or what it is
function kindTag(unit: Unit): HTMLElement | null {
  if (behaves(unit.kind) !== 'cooler' || !unit.kind) {
    return null;
  }
  const tone = unit.kind === 'freezer' ? 'freezer' : (unit.kind === 'fridge' ? 'fridge' : 'other');
  const tag = el('span', `storage-kind-tag ml-1 storage-kind-tag-${tone}`, unit.temperature === null || unit.temperature === undefined ? unit.kind : `${unit.temperature} °C`);
  tag.title = kindLabel(unit.kind);
  return tag;
}

// how many places fit in a place: its own number, else what its fridge or freezer says about each rack
const capacityOf = (node: Node, byId: Map<number, Node>): number => {
  const parent = node.unit.parent_id === null ? undefined : byId.get(node.unit.parent_id);
  return node.unit.capacity ?? parent?.unit.child_capacity ?? 0;
};

// racks and boxes are drawn inside the fridge or freezer they are in, not in the tree of locations
const inTree = (node: Node): boolean => behaves(node.unit.kind) !== 'rack' && behaves(node.unit.kind) !== 'box';

function collect(node: Node, withChildren: boolean): { row: Row; location: StorageLocation }[] {
  const out: { row: Row; location: StorageLocation }[] = [];
  const visit = (n: Node): void => {
    // an entry with several tubes in the unit is listed once per tube in own: take every tube of it once
    new Set(n.own).forEach(row => {
      (row.storage_locations ?? []).filter(l => l.storage_id === n.unit.id).forEach(location => out.push({ row, location }));
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
  // what was loaded last: a move of a tube is shown at once on it, before the server has answered and the lists are loaded again
  let lastUnits: Unit[] = [];
  let lastRows: Row[] = [];
  // the location asked for in the address is selected once, then the user's own choices win
  let openedFromUrl = false;
  // the tube picked to be placed in a slot of the box
  let pickedTube: Tube | null = null;
  // free slots chosen together (Cmd/Ctrl-click, Shift-click for a block) to store an entry in all of them
  let pickedSlots = new Set<string>();
  let pickedSlotsUnit = 0;
  let lastPickedSlot: string | null = null;
  // the tube being dragged to a slot of the box, or to another location of the tree
  let dragged: Tube | null = null;

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
  const addTop = el('button', 'btn btn-secondary btn-sm ml-2', 'Add a location');
  addTop.type = 'button';
  const addTopForm = el('div');
  addTopForm.hidden = true;
  addTop.addEventListener('click', () => {
    addTopForm.hidden = !addTopForm.hidden;
    if (!addTopForm.hidden) addTopForm.replaceChildren(renderAddForm(null));
  });
  // admins: the kinds of places, and new ones that behave like a location, a cooler (a fridge or a freezer), a rack or a box
  const kindsButton = el('button', 'btn btn-transparent btn-sm', 'Kinds of places');
  kindsButton.type = 'button';
  kindsButton.hidden = true;
  const kindsPanel = el('div', 'card card-body p-2 mb-2');
  kindsPanel.hidden = true;
  const csrf = (): string => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
  const kindsCall = async (body: Record<string, unknown>): Promise<void> => {
    const response = await fetch('registry-kinds.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf() },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      throw new Error(result.error ?? 'It did not work.');
    }
  };
  const renderKindsPanel = (): void => {
    kindsPanel.replaceChildren();
    kindsPanel.append(el('div', 'small font-weight-bold mb-1', 'Kinds of places'));
    kindList.forEach(k => {
      const row = el('div', 'd-flex align-items-center small mb-1');
      row.append(el('span', '', `${kindLabel(k.name)} `), el('span', 'ml-1 color-medium', `(behaves like ${k.behaves_like}${k.default_temperature !== null && !k.built_in ? `, ${k.default_temperature} °C` : ''})`));
      if (!k.built_in) {
        const remove = el('button', 'btn btn-transparent btn-sm ml-auto p-0', '×');
        remove.type = 'button';
        remove.title = 'Remove this kind';
        remove.addEventListener('click', () => {
          void kindsCall({ action: 'delete', name: k.name }).then(async () => {
            await loadKinds();
            renderKindsPanel();
            renderMain();
          }).catch(error => note.replaceChildren(document.createTextNode(error instanceof Error ? error.message : String(error))));
        });
        row.append(remove);
      }
      kindsPanel.append(row);
    });
    const form = el('div', 'd-flex flex-wrap align-items-end mt-2');
    const newName = el('input', 'form-control form-control-sm mr-1 mb-1');
    newName.placeholder = 'New kind, e.g. Incubator';
    newName.maxLength = 40;
    newName.setAttribute('aria-label', 'Name of the new kind');
    newName.style.width = '9rem';
    const like = el('select', 'form-control form-control-sm w-auto mr-1 mb-1');
    like.setAttribute('aria-label', 'It behaves like');
    [['cooler', 'Fridge or freezer'], ['location', 'Location'], ['rack', 'Rack / drawer / shelf'], ['box', 'Box']].forEach(([value, label]) => {
      const option = el('option', '', `Behaves like: ${label}`);
      option.value = value;
      like.append(option);
    });
    const degreesNew = el('input', 'form-control form-control-sm mr-1 mb-1');
    degreesNew.type = 'number';
    degreesNew.placeholder = '°C';
    degreesNew.title = 'The temperature a new place of this kind starts with';
    degreesNew.style.width = '4.5rem';
    degreesNew.setAttribute('aria-label', 'Temperature');
    like.addEventListener('change', () => {
      degreesNew.hidden = like.value !== 'cooler';
    });
    const add = el('button', 'btn btn-secondary btn-sm mb-1', 'Add the kind');
    add.type = 'button';
    const note = el('div', 'small text-danger');
    add.addEventListener('click', () => {
      note.textContent = '';
      void kindsCall({ action: 'add', name: newName.value, behaves_like: like.value, ...(degreesNew.value !== '' && like.value === 'cooler' ? { default_temperature: Number(degreesNew.value) } : {}) }).then(async () => {
        await loadKinds();
        renderKindsPanel();
        renderMain();
      }).catch(error => {
        note.textContent = error instanceof Error ? error.message : String(error);
      });
    });
    form.append(newName, like, degreesNew, add);
    kindsPanel.append(form, note);
  };
  kindsButton.addEventListener('click', () => {
    kindsPanel.hidden = !kindsPanel.hidden;
    if (!kindsPanel.hidden) {
      renderKindsPanel();
    }
  });
  let kindsLoaded = false;
  const loadKinds = async (): Promise<void> => {
    try {
      const response = await fetch('registry-kinds.php', { credentials: 'same-origin' });
      if (response.ok) {
        const body = await response.json() as { kinds: KindInfo[]; is_admin: boolean };
        kindList = body.kinds;
        isAdminUser = body.is_admin;
        kindsButton.hidden = !isAdminUser;
      }
    } catch {
      // the built-in kinds stay
    }
  };
  tools.append(search, expandAll, collapseAll, addTop, kindsButton, addTopForm, kindsPanel);
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
    const kids = node.children.filter(inTree);
    const hasChildren = kids.length > 0;
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
    label.append(el('i', `fas fa-fw ${behaves(node.unit.kind) === 'location' || !node.unit.parent_id ? 'fa-building' : 'fa-location-dot'} mr-1`), el('span', '', node.unit.name));
    const tag = kindTag(node.unit);
    if (tag) {
      label.append(tag);
    }
    label.append(el('span', 'grouped-section-count', String(node.total)));
    label.addEventListener('click', () => select(node.unit.id));
    // a tube dropped on a location moves there
    row.addEventListener('dragover', event => {
      if (dragged && dragged.location.storage_id !== node.unit.id) {
        event.preventDefault();
        row.classList.add('drop-target');
      }
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', event => {
      row.classList.remove('drop-target');
      if (dragged && dragged.location.storage_id !== node.unit.id) {
        event.preventDefault();
        const tube = dragged;
        dragged = null;
        patchAndReload(`inventory/${tube.row.id}/containers/${tube.location.container_id}`, { storage_id: node.unit.id });
      }
    });
    row.append(caret, label);
    li.append(row);
    if (hasChildren && !collapsed) {
      const ul = el('ul', 'storage-tree-list');
      kids.filter(c => query === '' || matches(c)).forEach(c => ul.append(renderNode(c, depth + 1)));
      li.append(ul);
    }
    return li;
  };

  const renderTree = (): void => {
    const ul = el('ul', 'storage-tree-list');
    tree.roots.filter(r => query === '' || matches(r)).forEach(r => ul.append(renderNode(r, 0)));
    treeBox.replaceChildren(ul);
  };


  // BOX: the unit as a grid of slots, the tubes in their slots, and the ones not placed yet
  const patchAndReload = (endpoint: string, body: Record<string, unknown>): void => {
    hideTubeCard();
    // a tube that moves (to a slot, out of its slot, to another place) is moved on the screen first: the answer of the server and the
    // new lists, which take a while with thousands of entries, only confirm it
    const tubeMove = /^inventory\/(\d+)\/containers\/(\d+)$/.exec(endpoint);
    if (tubeMove && lastRows.length > 0) {
      const location = lastRows.find(r => r.id === Number(tubeMove[1]))?.storage_locations?.find(l => l.container_id === Number(tubeMove[2]));
      if (location) {
        if ('position' in body) {
          location.position = body.position === '' || body.position === null ? null : String(body.position);
        }
        if ('storage_id' in body) {
          location.storage_id = Number(body.storage_id);
          location.position = null;
        }
        pickedTube = null;
        tree = buildTree(lastUnits, lastRows);
        renderTree();
        renderMain();
      }
    }
    void ApiC.patch(endpoint, body).then(() => {
      pickedTube = null;
      return load();
    }).catch(() => load());
  };

  const sameTube = (a: { location: StorageLocation } | null, b: { location: StorageLocation }): boolean =>
    a !== null && a.location.container_id === b.location.container_id;

  // a block of the page with a heading, and an input with its label above it: so it is clear what each one is for
  const section = (title: string, hint: string, ...nodes: HTMLElement[]): HTMLElement => {
    const card = el('div', 'card mb-3');
    const body = el('div', 'card-body py-2');
    body.append(el('h5', 'h6 mb-0', title));
    if (hint !== '') {
      body.append(el('div', 'small color-medium mb-2', hint));
    }
    body.append(...nodes);
    card.append(body);
    return card;
  };
  const labelled = (label: string, input: HTMLElement): HTMLElement => {
    const group = el('div', 'mr-2 mb-1');
    group.append(el('div', 'small color-medium', label), input);
    // an input that is hidden (the temperature of a box, the rows of a rack) takes its label with it
    const follow = (): void => {
      group.hidden = (input as HTMLInputElement).hidden;
    };
    new MutationObserver(follow).observe(input, { attributes: true, attributeFilter: ['hidden'] });
    follow();
    return group;
  };

  const renderBoxSize = (node: Node): HTMLElement => {
    const form = el('div', 'd-flex flex-wrap align-items-center mb-2');
    form.append(el('span', 'mr-2', 'Box size'));
    const rows = el('input', 'form-control form-control-sm mr-1');
    const cols = el('input', 'form-control form-control-sm mx-1');
    [rows, cols].forEach(i => {
      i.type = 'number';
      i.min = '1';
      i.style.width = '4.5rem';
    });
    rows.max = '26';
    cols.max = '99';
    rows.placeholder = 'rows';
    cols.placeholder = 'columns';
    rows.setAttribute('aria-label', 'Rows (letters)');
    cols.setAttribute('aria-label', 'Columns');
    rows.value = node.unit.box_rows ? String(node.unit.box_rows) : '';
    cols.value = node.unit.box_cols ? String(node.unit.box_cols) : '';
    const save = el('button', 'btn btn-secondary btn-sm ml-2', node.unit.box_rows ? 'Resize' : 'Make a box');
    save.type = 'button';
    save.addEventListener('click', () => patchAndReload(`storage_units/${node.unit.id}`, { box_rows: Number(rows.value), box_cols: Number(cols.value) }));
    form.append(rows, el('span', '', '×'), cols, save);
    if (node.unit.box_rows) {
      const clear = el('button', 'btn btn-transparent btn-sm', 'Not a box');
      clear.type = 'button';
      clear.addEventListener('click', () => patchAndReload(`storage_units/${node.unit.id}`, { box_rows: null, box_cols: null }));
      form.append(clear);
    }
    return form;
  };

  const renderBox = (node: Node): HTMLElement => {
    const wrap = el('div', 'mb-3');
    const rowsCount = node.unit.box_rows ?? 0;
    const colsCount = node.unit.box_cols ?? 0;
    const inBox = collect(node, false);
    const bySlot = new Map<string, { row: Row; location: StorageLocation }>();
    inBox.filter(e => e.location.position).forEach(e => bySlot.set(String(e.location.position), e));

    if (pickedSlotsUnit !== node.unit.id) {
      pickedSlots = new Set<string>();
      pickedSlotsUnit = node.unit.id;
      lastPickedSlot = null;
    }
    const scroller = el('div', 'box-grid-wrap');
    const table = el('table', 'box-grid');
    const head = el('tr');
    head.append(el('th'));
    for (let c = 1; c <= colsCount; c++) {
      head.append(el('th', '', String(c)));
    }
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (let r = 1; r <= rowsCount; r++) {
      const letter = String.fromCharCode(64 + r);
      const tr = el('tr');
      tr.append(el('th', '', letter));
      for (let c = 1; c <= colsCount; c++) {
        const slot = `${letter}${c}`;
        const entry = bySlot.get(slot);
        const td = el('td');
        const cell = el('button', entry ? 'box-slot filled' : 'box-slot');
        cell.type = 'button';
        if (entry) {
          // what the slot says: the target of the entry when it has one (an antibody), else its title; the whole text, in a few lines
          const target = entry.row.extra_fields?.find(f => f.name === 'Target')?.value?.trim();
          cell.textContent = target || entry.row.title;
          cell.setAttribute('aria-label', `${slot}: ${entry.row.title} (${entry.location.qty_stored} ${entry.location.qty_unit})`.trim());
          cell.addEventListener('mouseenter', event => showTubeCard(entry, event));
          cell.addEventListener('mousemove', moveTubeCard);
          cell.addEventListener('mouseleave', hideTubeCard);
          cell.draggable = true;
          cell.addEventListener('dragstart', event => {
            hideTubeCard();
            dragged = entry;
            event.dataTransfer?.setData('text/plain', entry.row.title);
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = 'move';
            }
            cell.classList.add('dragging');
          });
          cell.addEventListener('dragend', () => {
            dragged = null;
            cell.classList.remove('dragging');
          });
          if (entry.row.category_color) {
            cell.style.backgroundColor = `#${entry.row.category_color}`;
            // dark text on a light colour, white on a dark one: the text stays readable whatever the colour of the module
            const [red, green, blue] = [0, 2, 4].map(i => parseInt(entry.row.category_color?.slice(i, i + 2) ?? '0', 16));
            cell.style.color = (0.299 * red + 0.587 * green + 0.114 * blue) > 150 ? '#1b1b1b' : '#ffffff';
          }
          if (sameTube(pickedTube, entry)) {
            cell.classList.add('picked');
          }
          cell.addEventListener('click', () => {
            // a tube already picked to be moved: a click on another tube drops the pick
            if (pickedTube) {
              pickedTube = sameTube(pickedTube, entry) ? null : entry;
              renderMain();
              return;
            }
            pinTubeCard(entry, cell, [
              { label: 'Move to a slot', run: () => { pickedTube = entry; renderMain(); } },
              ...(entry.location.position ? [{ label: 'Take out of its slot', run: () => patchAndReload(`inventory/${entry.row.id}/containers/${entry.location.container_id}`, { position: '' }) }] : []),
            ]);
          });
        } else {
          cell.title = pickedTube ? `Place ${pickedTube.row.title} in ${slot}` : `${slot}: free, click to add storage`;
          cell.setAttribute('aria-label', cell.title);
          // a dragged tube is dropped in a free slot
          cell.addEventListener('dragover', event => {
            if (dragged) {
              event.preventDefault();
              cell.classList.add('drop-target');
            }
          });
          cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
          cell.addEventListener('drop', event => {
            cell.classList.remove('drop-target');
            if (dragged) {
              event.preventDefault();
              const tube = dragged;
              dragged = null;
              patchAndReload(`inventory/${tube.row.id}/containers/${tube.location.container_id}`, { position: slot });
            }
          });
          cell.dataset.slot = slot;
          if (pickedSlots.has(slot)) {
            cell.classList.add('chosen');
            cell.textContent = '✓';
          }
          cell.addEventListener('click', async event => {
            if (pickedTube) {
              patchAndReload(`inventory/${pickedTube.row.id}/containers/${pickedTube.location.container_id}`, { position: slot });
              return;
            }
            // several free slots: Cmd/Ctrl-click one, Shift-click to the other corner of a block; once some are chosen a click adds or removes
            if (event.metaKey || event.ctrlKey || event.shiftKey || pickedSlots.size > 0) {
              if (event.shiftKey && lastPickedSlot !== null) {
                const from = /^([A-Z])(\d+)$/.exec(lastPickedSlot);
                const to = /^([A-Z])(\d+)$/.exec(slot);
                if (from && to) {
                  const [r1, r2] = [from[1].charCodeAt(0), to[1].charCodeAt(0)].sort((a, b) => a - b);
                  const [c1, c2] = [Number(from[2]), Number(to[2])].sort((a, b) => a - b);
                  for (let r = r1; r <= r2; r++) {
                    for (let c = c1; c <= c2; c++) {
                      const name = `${String.fromCharCode(r)}${c}`;
                      if (!bySlot.has(name)) {
                        pickedSlots.add(name);
                      }
                    }
                  }
                }
              } else if (pickedSlots.has(slot)) {
                pickedSlots.delete(slot);
              } else {
                pickedSlots.add(slot);
              }
              lastPickedSlot = slot;
              renderMain();
              return;
            }
            // nothing picked: a free slot offers to store an entry in it
            (await import(/* webpackChunkName: 'storage-slot-add' */ './storage-slot-add')).openSlotAdd(node.unit, slot, () => {
              void load();
            });
          });
        }
        td.append(cell);
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(thead, body);
    // choosing free slots by dragging over them with the mouse: the block between where the button went down and where it is now
    const blockBetween = (a: string, b: string): string[] => {
      const from = /^([A-Z])(\d+)$/.exec(a);
      const to = /^([A-Z])(\d+)$/.exec(b);
      const out: string[] = [];
      if (from && to) {
        const [r1, r2] = [from[1].charCodeAt(0), to[1].charCodeAt(0)].sort((x, y) => x - y);
        const [c1, c2] = [Number(from[2]), Number(to[2])].sort((x, y) => x - y);
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            const name = `${String.fromCharCode(r)}${c}`;
            if (!bySlot.has(name)) {
              out.push(name);
            }
          }
        }
      }
      return out;
    };
    const freeCellOf = (target: EventTarget | null): HTMLElement | null => (target as HTMLElement | null)?.closest<HTMLElement>('.box-slot[data-slot]') ?? null;
    table.style.userSelect = 'none';
    table.addEventListener('mousedown', event => {
      const start = freeCellOf(event.target);
      if (!start || pickedTube || event.button !== 0) {
        return;
      }
      const startSlot = start.dataset.slot ?? '';
      let endSlot = startSlot;
      const additive = event.metaKey || event.ctrlKey;
      const preview = (): void => {
        const block = new Set(blockBetween(startSlot, endSlot));
        table.querySelectorAll<HTMLElement>('.box-slot[data-slot]').forEach(c => c.classList.toggle('preview', block.has(c.dataset.slot ?? '')));
      };
      const over = (e: MouseEvent): void => {
        const cell = freeCellOf(e.target);
        if (cell && cell.dataset.slot !== endSlot) {
          endSlot = cell.dataset.slot ?? endSlot;
          preview();
        }
      };
      const up = (): void => {
        table.removeEventListener('mouseover', over);
        document.removeEventListener('mouseup', up);
        table.querySelectorAll('.preview').forEach(c => c.classList.remove('preview'));
        // a drag over more than one slot chooses the block; a plain click on one slot is handled by its click
        if (endSlot !== startSlot) {
          if (!additive) {
            pickedSlots = new Set<string>();
          }
          blockBetween(startSlot, endSlot).forEach(name => pickedSlots.add(name));
          lastPickedSlot = endSlot;
          renderMain();
          // the entry to store in the slots is asked for at once (closing the window keeps the slots chosen)
          if (pickedSlots.size > 0) {
            const ordered = [...pickedSlots].sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0) || Number(a.slice(1)) - Number(b.slice(1)));
            void import(/* webpackChunkName: 'storage-slot-add' */ './storage-slot-add').then(module => {
              module.openSlotAdd(node.unit, ordered, () => {
                pickedSlots = new Set<string>();
                void load();
              });
            });
          }
        }
      };
      table.addEventListener('mouseover', over);
      document.addEventListener('mouseup', up);
    });
    scroller.append(table);
    wrap.append(scroller);

    const placed = inBox.filter(e => e.location.position).length;
    wrap.append(el('p', 'color-medium small mb-2', `${placed} of ${rowsCount * colsCount} slots used`));
    if (pickedSlots.size > 0) {
      const chosenBar = el('div', 'box-picked mb-2');
      chosenBar.append(document.createTextNode(`${pickedSlots.size} free ${pickedSlots.size === 1 ? 'slot' : 'slots'} chosen. `));
      const addMany = el('button', 'btn btn-primary btn-sm mr-1', 'Add an entry to these slots');
      addMany.type = 'button';
      addMany.addEventListener('click', async () => {
        // in the order of the box: A1, A2 ... B1
        const ordered = [...pickedSlots].sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0) || Number(a.slice(1)) - Number(b.slice(1)));
        (await import(/* webpackChunkName: 'storage-slot-add' */ './storage-slot-add')).openSlotAdd(node.unit, ordered, () => {
          pickedSlots = new Set<string>();
          void load();
        });
      });
      const clear = el('button', 'btn btn-transparent btn-sm', 'Clear');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        pickedSlots = new Set<string>();
        renderMain();
      });
      chosenBar.append(addMany, clear);
      wrap.append(chosenBar);
    } else {
      wrap.append(el('p', 'color-medium small mb-2', 'To fill several free slots: drag over them with the mouse, or Cmd/Ctrl-click them, or Shift-click the other corner of a block.'));
    }

    if (pickedTube) {
      const bar = el('div', 'box-picked mb-2');
      const link = el('a', '', pickedTube.row.title);
      link.href = `?mode=view&id=${encodeURIComponent(String(pickedTube.row.id))}`;
      bar.append(document.createTextNode('Selected: '), link);
      bar.append(document.createTextNode(pickedTube.location.position ? ` in ${pickedTube.location.position}. Click a free slot to move it. ` : '. Click a free slot to place it. '));
      if (pickedTube.location.position) {
        const out = el('button', 'btn btn-transparent btn-sm', 'Take out of its slot');
        out.type = 'button';
        const tube = pickedTube;
        out.addEventListener('click', () => patchAndReload(`inventory/${tube.row.id}/containers/${tube.location.container_id}`, { position: '' }));
        bar.append(out);
      }
      const cancel = el('button', 'btn btn-transparent btn-sm', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => {
        pickedTube = null;
        renderMain();
      });
      bar.append(cancel);
      wrap.append(bar);
    }

    const loose = inBox.filter(e => !e.location.position);
    if (loose.length > 0) {
      const box = el('div', 'mb-2');
      box.append(el('div', 'small color-medium', 'Not placed in a slot'));
      loose.forEach(e => {
        const chip = el('button', `btn btn-sm mr-1 mb-1 ${sameTube(pickedTube, e) ? 'btn-primary' : 'btn-secondary'}`, e.row.title);
        chip.type = 'button';
        chip.draggable = true;
        chip.addEventListener('dragstart', event => {
          dragged = e;
          event.dataTransfer?.setData('text/plain', e.row.title);
        });
        chip.addEventListener('dragend', () => {
          dragged = null;
        });
        chip.addEventListener('mouseenter', event => showTubeCard(e, event));
        chip.addEventListener('mousemove', moveTubeCard);
        chip.addEventListener('mouseleave', hideTubeCard);
        chip.addEventListener('click', () => {
          if (pickedTube) {
            pickedTube = sameTube(pickedTube, e) ? null : e;
            renderMain();
            return;
          }
          pinTubeCard(e, chip, [{ label: 'Move to a slot', run: () => { pickedTube = e; renderMain(); } }]);
        });
        box.append(chip);
      });
      wrap.append(box);
    }
    return wrap;
  };


  // RACKS: what a fridge or freezer holds, as a card per rack with its boxes drawn small, and a capacity gauge
  const subtree = (node: Node): Node[] => [node, ...node.children.flatMap(subtree)];
  const boxesIn = (node: Node): Node[] => subtree(node).filter(n => n.unit.box_rows && n.unit.box_cols);
  const slotsOf = (node: Node): number => boxesIn(node).reduce((sum, b) => sum + (b.unit.box_rows ?? 0) * (b.unit.box_cols ?? 0), 0);
  const takenIn = (node: Node): number => boxesIn(node).reduce((sum, b) => sum + b.own.length, 0);

  const gauge = (taken: number, slots: number): HTMLElement => {
    const bar = el('div', 'rack-gauge');
    const fill = el('div', 'rack-gauge-fill');
    fill.style.width = `${slots > 0 ? Math.min(100, Math.round((taken / slots) * 100)) : 0}%`;
    bar.append(fill);
    return bar;
  };

  const miniBox = (box: Node): HTMLElement => {
    const rows = box.unit.box_rows ?? 0;
    const cols = box.unit.box_cols ?? 0;
    const tile = el('button', 'rack-box');
    tile.type = 'button';
    tile.title = `${box.unit.name}: ${box.own.length} of ${rows * cols}`;
    tile.addEventListener('click', () => select(box.unit.id));
    const dots = el('div', 'rack-box-dots');
    dots.style.gridTemplateColumns = `repeat(${cols}, var(--rack-dot, 0.65rem))`;
    const filled = new Map<string, Row>();
    box.own.forEach(row => (row.storage_locations ?? [])
      .filter(l => l.storage_id === box.unit.id && l.position)
      .forEach(l => filled.set(String(l.position), row)));
    // a very large box is shown as its gauge only
    if (rows * cols <= 200) {
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          const dot = el('span', 'rack-dot');
          const row = filled.get(`${String.fromCharCode(64 + r)}${c}`);
          if (row) {
            dot.classList.add('filled');
            dot.style.backgroundColor = row.category_color ? `#${row.category_color}` : '#7a7a7a';
          }
          dots.append(dot);
        }
      }
      tile.append(dots);
    }
    tile.append(el('span', 'rack-box-name', box.unit.name), el('span', 'rack-box-count', `${box.own.length}/${rows * cols}`));
    return tile;
  };

  const renderRacks = (node: Node): HTMLElement => {
    const wrap = el('div', 'mb-3');
    const slots = slotsOf(node);
    if (slots > 0) {
      const taken = takenIn(node);
      wrap.append(el('div', 'small', `Capacity ${slots} slots, taken ${taken} (${Math.round((taken / slots) * 100)}%)`), gauge(taken, slots));
    }
    const cards = el('div', 'rack-cards');
    node.children.forEach(child => {
      const card = el('div', 'rack-card');
      const title = el('button', 'btn btn-transparent btn-sm rack-card-title');
      title.type = 'button';
      title.textContent = child.unit.name;
      title.addEventListener('click', () => select(child.unit.id));
      card.append(title);
      const boxes = boxesIn(child);
      const childSlots = slotsOf(child);
      if (childSlots > 0) {
        const taken = takenIn(child);
        card.append(el('div', 'small color-medium', `${boxes.length} ${boxes.length === 1 ? 'box' : 'boxes'}, ${taken}/${childSlots} slots`), gauge(taken, childSlots));
      } else {
        card.append(el('div', 'small color-medium', `${child.total} ${child.total === 1 ? 'resource' : 'resources'}`));
      }
      const tiles = el('div', 'rack-boxes');
      boxes.forEach(b => tiles.append(miniBox(b)));
      card.append(tiles);
      cards.append(card);
    });
    wrap.append(cards);
    return wrap;
  };

  // a fridge or a freezer seen from the front: a shelf for each rack or drawer, with its boxes on it
  const renderCabinet = (node: Node): HTMLElement => {
    const cabinet = el('div', 'storage-cabinet mb-3');
    const slots = slotsOf(node);
    const head = el('div', 'storage-cabinet-head d-flex align-items-center');
    const nameLink = el('button', 'btn btn-transparent btn-sm p-0 font-weight-bold', node.unit.name);
    nameLink.type = 'button';
    nameLink.title = 'Open this place';
    nameLink.addEventListener('click', () => select(node.unit.id));
    head.append(nameLink);
    const tag = kindTag(node.unit);
    if (tag) {
      head.append(tag);
    }
    const unitName = behaves(node.unit.kind) === 'rack' ? 'boxes' : 'racks';
    const capacity = capacityOf(node, tree.byId);
    const spans = el('span', 'ml-auto small color-medium');
    if (capacity > 0) {
      spans.textContent = `${node.children.length} / ${capacity} ${unitName}`;
    }
    if (slots > 0) {
      const taken = takenIn(node);
      spans.textContent += `${spans.textContent === '' ? '' : ' · '}${taken} / ${slots} slots`;
    }
    head.append(spans);
    cabinet.append(head);
    const shelfBox = (box: Node): HTMLElement => {
      const tile = el('button', 'storage-shelf-box');
      tile.type = 'button';
      const total = (box.unit.box_rows ?? 0) * (box.unit.box_cols ?? 0);
      tile.title = `${box.unit.name}: ${box.own.length} of ${total}`;
      // coloured by the module of what is in the box (the one with most entries), the modules are in its tooltip
      const modules = new Map<string, { title: string; color: string; n: number }>();
      new Set(box.own).forEach(entry => {
        const key = entry.category_title ?? '';
        const found = modules.get(key) ?? { title: key || 'No module', color: entry.category_color ?? '', n: 0 };
        found.n++;
        modules.set(key, found);
      });
      const byCount = [...modules.values()].sort((a, b) => b.n - a.n);
      if (byCount.length > 0) {
        tile.title += ` · ${byCount.map(m => `${m.title} ${m.n}`).join(', ')}`;
        const main = byCount[0];
        if (main.color) {
          const [red, green, blue] = [0, 2, 4].map(i => parseInt(main.color.slice(i, i + 2), 16));
          tile.style.borderColor = `#${main.color}`;
          tile.style.backgroundColor = `rgba(${red}, ${green}, ${blue}, 0.16)`;
          tile.style.setProperty('--tile-colour', `#${main.color}`);
        }
      }
      tile.append(el('span', 'storage-shelf-box-name', box.unit.name));
      if (total > 0) {
        tile.append(el('span', 'small color-medium', `${box.own.length}/${total}`), gauge(box.own.length, total));
      }
      tile.addEventListener('click', () => select(box.unit.id));
      return tile;
    };
    // the small form that makes a rack or a box in a free place of a fridge, a freezer or a rack
    const nextFreeOf = (parent: Node, skip: number): number => {
      const usedHere = new Set(parent.children.map(c => c.unit.position).filter((p): p is number => typeof p === 'number'));
      let n = 0;
      let found = 0;
      for (;;) {
        n++;
        if (!usedHere.has(n)) {
          if (found === skip) {
            return n;
          }
          found++;
        }
      }
    };
    const makeHere = (parent: Node, newKind: string, area: HTMLElement, skip: number): void => {
      if (area.childElementCount > 0) {
        area.replaceChildren();
        return;
      }
      const name = el('input', 'form-control form-control-sm mr-2');
      name.placeholder = newKind === 'box' ? 'Name of the box' : 'Name of the rack';
      name.setAttribute('aria-label', 'Name');
      name.style.maxWidth = '14rem';
      const holdsHere = el('input', 'form-control form-control-sm mr-2');
      holdsHere.type = 'number';
      holdsHere.min = '1';
      holdsHere.placeholder = 'holds';
      holdsHere.title = 'How many boxes fit in it';
      holdsHere.style.width = '5rem';
      holdsHere.hidden = newKind === 'box';
      const rowsHere = el('input', 'form-control form-control-sm mr-1');
      const colsHere = el('input', 'form-control form-control-sm mr-2');
      [rowsHere, colsHere].forEach(input => {
        input.type = 'number';
        input.min = '1';
        input.style.width = '4.2rem';
        input.hidden = newKind !== 'box';
      });
      rowsHere.value = '9';
      colsHere.value = '9';
      rowsHere.placeholder = 'rows';
      colsHere.placeholder = 'cols';
      const positionHere = el('input', 'form-control form-control-sm mr-2');
      positionHere.type = 'number';
      positionHere.min = '1';
      positionHere.value = String(nextFreeOf(parent, skip));
      positionHere.title = 'Its position among its neighbours';
      positionHere.setAttribute('aria-label', 'Position');
      positionHere.style.width = '4.5rem';
      const make = el('button', 'btn btn-secondary btn-sm mr-1', 'Add');
      make.type = 'button';
      const cancelHere = el('button', 'btn btn-transparent btn-sm', 'Cancel');
      cancelHere.type = 'button';
      cancelHere.addEventListener('click', () => area.replaceChildren());
      make.addEventListener('click', () => {
        const unitName = name.value.trim();
        if (unitName === '') {
          name.focus();
          return;
        }
        make.disabled = true;
        void ApiC.post2location('storage_units', {
          name: unitName,
          parent_id: parent.unit.id,
          kind: newKind,
          ...(Number(positionHere.value) > 0 ? { position: Number(positionHere.value) } : {}),
          ...(newKind === 'rack' && Number(holdsHere.value) > 0 ? { capacity: Number(holdsHere.value) } : {}),
        }).then(async id => {
          if (newKind === 'box') {
            await ApiC.patch(`storage_units/${id}`, { box_rows: Number(rowsHere.value), box_cols: Number(colsHere.value) });
          }
          state.selected = node.unit.id;
          writeState(state);
          return load();
        }).catch(() => {
          make.disabled = false;
        });
      });
      area.append(name, positionHere, holdsHere, rowsHere, colsHere, make, cancelHere);
      name.focus();

    };
    const loose = node.children.filter(c => behaves(c.unit.kind) === 'box' || (c.children.length === 0 && Boolean(c.unit.box_rows)));
    const shelves = node.children.filter(c => !loose.includes(c));
    shelves.forEach(shelf => {
      const row = el('div', 'storage-shelf');
      const label = el('button', 'btn btn-transparent btn-sm storage-shelf-label', shelf.unit.name);
      label.type = 'button';
      label.addEventListener('click', () => select(shelf.unit.id));
      const boxes = el('div', 'storage-shelf-boxes');
      const inside = boxesIn(shelf);
      inside.forEach(b => boxes.append(shelfBox(b)));
      // the places for boxes that are still free on this shelf, as far as its capacity says (one to click when it has none)
      const shelfCapacity = capacityOf(shelf, tree.byId);
      const freeBoxes = shelfCapacity > 0 ? Math.min(Math.max(shelfCapacity - shelf.children.length, 0), 8) : 1;
      const formArea = el('div');
      formArea.style.flexBasis = '100%';
      for (let i = 0; i < freeBoxes; i++) {
        const tile = el('button', 'storage-shelf-box storage-shelf-box-free', shelfCapacity > 0 ? 'free' : '+ add a box');
        tile.type = 'button';
        tile.title = 'Click to make a box here';
        tile.addEventListener('click', () => makeHere(shelf, 'box', formArea, i));
        boxes.append(tile);
      }
      boxes.append(formArea);
      row.append(label, boxes);
      cabinet.append(row);
    });
    // the places that are still free, as far as the capacity says: a click on one opens a small form to make the rack or the box there
    // without a capacity there is no limit: one place to click is always offered at the end, to add another
    const freePlaces = capacity > 0 ? Math.min(Math.max(capacity - node.children.length, 0), 12) : 1;
    const newKind = behaves(node.unit.kind) === 'rack' ? 'box' : 'rack';
    for (let i = 0; i < freePlaces; i++) {
      const row = el('div', 'storage-shelf storage-shelf-free');
      const label = el('button', 'btn btn-transparent btn-sm storage-shelf-label small color-medium', capacity > 0 ? (newKind === 'box' ? 'free place' : 'free rack') : (newKind === 'box' ? '+ add a box' : '+ add a rack'));
      label.type = 'button';
      label.title = `Click to make a ${newKind === 'box' ? 'box' : 'rack'} here`;
      const area = el('div', 'storage-shelf-boxes');
      const open = (): void => makeHere(node, newKind, area, i);
      label.addEventListener('click', open);
      row.append(label, area);
      cabinet.append(row);
    }
    if (loose.length > 0) {
      const row = el('div', 'storage-shelf');
      row.append(el('span', 'storage-shelf-label small color-medium', 'In the ' + (behaves(node.unit.kind) === 'rack' ? 'rack' : 'cabinet')));
      const boxes = el('div', 'storage-shelf-boxes');
      loose.forEach(b => boxes.append(shelfBox(b)));
      row.append(boxes);
      cabinet.append(row);
    }
    return cabinet;
  };

  // a location (a room, a building): every fridge and freezer in it drawn from the front, one under the other
  const renderLocationView = (node: Node): HTMLElement => {
    const wrap = el('div');
    let drawn = 0;
    const walk = (place: Node): void => {
      place.children.forEach(child => {
        if (behaves(child.unit.kind) === 'location') {
          // a place inside the location (a room in a building): its name, then what is in it
          const heading = el('button', 'btn btn-transparent btn-sm p-0 mt-3 mb-2 d-block font-weight-bold', child.unit.name);
          heading.type = 'button';
          heading.addEventListener('click', () => select(child.unit.id));
          wrap.append(heading);
          walk(child);
        } else {
          wrap.append(renderCabinet(child));
          drawn++;
        }
      });
    };
    walk(node);
    if (drawn === 0 && wrap.childElementCount === 0) {
      wrap.append(el('p', 'text-muted', 'No fridge or freezer here yet: add one below.'));
    }
    return wrap;
  };

  // node is null for a location at the top (a freezer, a cabinet...)
  const renderAddForm = (node: Node | null): HTMLElement => {
    const form = el('div', 'd-flex flex-wrap align-items-end');
    const kind = el('select', 'form-control form-control-sm w-auto mr-1');
    kind.setAttribute('aria-label', 'What to add');
    // a location at the top; in a location more locations, fridges and freezers (and the kinds that behave like them); in a cooler or a rack, racks and boxes
    const parentBehaves = node === null ? null : (behaves(node.unit.kind) ?? 'legacy');
    const fits = (k: KindInfo): boolean => parentBehaves === null
      ? k.behaves_like === 'location'
      : (parentBehaves === 'location'
        ? k.behaves_like === 'cooler' || k.behaves_like === 'location'
        : (parentBehaves === 'legacy' ? true : k.behaves_like === 'rack' || k.behaves_like === 'box'));
    const labelOf = (k: KindInfo): string => (k.built_in
      ? ({ location: 'Location (a room, a building)', freezer: 'Freezer', fridge: 'Fridge', rack: 'Rack / drawer / shelf', box: 'Box' } as Record<string, string>)[k.name]
      : `${kindLabel(k.name)} (${k.behaves_like})`);
    kindList.filter(fits).forEach(k => {
      const option = el('option', '', labelOf(k));
      option.value = k.name;
      kind.append(option);
    });
    const temperature = el('input', 'form-control form-control-sm mr-1');
    temperature.type = 'number';
    temperature.min = '-273';
    temperature.max = '100';
    temperature.style.width = '5.5rem';
    temperature.placeholder = '°C';
    temperature.title = 'Temperature in degrees Celsius';
    temperature.setAttribute('aria-label', 'Temperature');
    // how many racks a freezer or a fridge holds, how many boxes a rack holds
    const holds = el('input', 'form-control form-control-sm mr-1');
    holds.type = 'number';
    holds.min = '1';
    holds.style.width = '6rem';
    holds.placeholder = 'holds';
    holds.title = 'How many racks (in a fridge or a freezer) or boxes (in a rack) fit in it';
    holds.setAttribute('aria-label', 'How many fit');
    const name = el('input', 'form-control form-control-sm w-auto mr-1');
    name.placeholder = 'Name';
    name.setAttribute('aria-label', 'Name');
    const position = el('input', 'form-control form-control-sm mr-1');
    position.type = 'number';
    position.min = '1';
    position.style.width = '5.5rem';
    position.placeholder = 'position';
    position.title = 'Its position among the places of its parent (1, 2, 3...): it gives the order';
    position.setAttribute('aria-label', 'Position');
    const rows = el('input', 'form-control form-control-sm mr-1');
    const cols = el('input', 'form-control form-control-sm mr-1');
    [rows, cols].forEach(i => {
      i.type = 'number';
      i.min = '1';
      i.style.width = '4.5rem';
    });
    rows.max = '26';
    cols.max = '99';
    rows.placeholder = 'rows';
    cols.placeholder = 'cols';
    rows.value = '9';
    cols.value = '9';
    rows.hidden = cols.hidden = true;
    const showFields = (): void => {
      const how = behaves(kind.value);
      rows.hidden = cols.hidden = how !== 'box';
      temperature.hidden = how !== 'cooler';
      holds.hidden = how !== 'cooler' && how !== 'rack';
      const preset = kindList.find(k => k.name === kind.value)?.default_temperature;
      if (how === 'cooler' && temperature.value === '' && preset !== null && preset !== undefined && kind.value !== 'freezer') {
        temperature.value = String(preset);
      }
    };
    kind.addEventListener('change', showFields);
    showFields();
    const add = el('button', 'btn btn-secondary btn-sm', 'Add');
    add.type = 'button';
    add.addEventListener('click', () => {
      const unitName = name.value.trim();
      if (unitName === '') {
        name.focus();
        return;
      }
      void ApiC.post2location('storage_units', { name: unitName, kind: kind.value, ...(temperature.value !== '' && !temperature.hidden ? { temperature: Number(temperature.value) } : {}), ...(Number(holds.value) > 0 && !holds.hidden ? { capacity: Number(holds.value) } : {}), ...(node === null ? {} : { parent_id: node.unit.id }), ...(Number(position.value) > 0 ? { position: Number(position.value) } : {}) }).then(async id => {
        if (behaves(kind.value) === 'box') {
          await ApiC.patch(`storage_units/${id}`, { box_rows: Number(rows.value), box_cols: Number(cols.value) });
        }
        // show the new unit in the tree, and select it
        if (node !== null) {
          state.collapsed[String(node.unit.id)] = false;
        }
        state.selected = id;
        writeState(state);
        return load();
      });
    });
    const buttonCell = el('div', 'mb-1');
    buttonCell.append(add);
    form.append(labelled('What', kind), labelled('Name', name), labelled('Temperature (°C)', temperature), labelled('Holds', holds), labelled('Position', position), labelled('Rows', rows), labelled('Columns', cols), buttonCell);
    return form;
  };

  const renderRename = (node: Node): HTMLElement => {
    const form = el('div', 'd-flex flex-wrap align-items-end');
    const name = el('input', 'form-control form-control-sm w-auto mr-1');
    name.value = node.unit.name;
    name.setAttribute('aria-label', 'Rename');
    // the position of the place among the places of its parent: it gives the order
    const position = el('input', 'form-control form-control-sm mr-1');
    position.type = 'number';
    position.min = '1';
    position.style.width = '5.5rem';
    position.placeholder = 'position';
    position.title = 'Its position among the places of its parent (1, 2, 3...): it gives the order';
    position.setAttribute('aria-label', 'Position');
    position.value = node.unit.position ? String(node.unit.position) : '';
    // what the place is (it can be said for the places made before), and the temperature of a fridge or a freezer
    const what = el('select', 'form-control form-control-sm w-auto mr-1');
    what.setAttribute('aria-label', 'What it is');
    [['', 'Kind of place'] as [string, string]].concat(kindList.map(k => [k.name, kindLabel(k.name)] as [string, string])).forEach(([value, label]) => {
      const option = el('option', '', label);
      option.value = value;
      what.append(option);
    });
    what.value = node.unit.kind ?? '';
    const degrees = el('input', 'form-control form-control-sm mr-1');
    degrees.type = 'number';
    degrees.min = '-273';
    degrees.max = '100';
    degrees.style.width = '5.5rem';
    degrees.placeholder = '°C';
    degrees.setAttribute('aria-label', 'Temperature');
    degrees.value = node.unit.temperature === null || node.unit.temperature === undefined ? '' : String(node.unit.temperature);
    const holdsNow = el('input', 'form-control form-control-sm mr-1');
    holdsNow.type = 'number';
    holdsNow.min = '1';
    holdsNow.style.width = '6rem';
    holdsNow.placeholder = 'holds';
    holdsNow.title = 'How many racks (in a fridge or a freezer) or boxes (in a rack) fit in it';
    holdsNow.setAttribute('aria-label', 'How many fit');
    holdsNow.value = node.unit.capacity ? String(node.unit.capacity) : '';
    // said once on the fridge or freezer: each of its racks holds this many boxes (a rack with a number of its own keeps it)
    const eachRack = el('input', 'form-control form-control-sm mr-1');
    eachRack.type = 'number';
    eachRack.min = '1';
    eachRack.style.width = '6rem';
    eachRack.placeholder = 'boxes';
    eachRack.title = 'How many boxes each rack of this fridge or freezer holds';
    eachRack.setAttribute('aria-label', 'Boxes in each rack');
    eachRack.value = node.unit.child_capacity ? String(node.unit.child_capacity) : '';
    const note = el('input', 'form-control form-control-sm mr-1');
    note.type = 'text';
    note.maxLength = 1000;
    note.style.minWidth = '18rem';
    note.placeholder = 'e.g. door sticks, defrosted 2026-01';
    note.setAttribute('aria-label', 'Comment');
    note.value = node.unit.comment ?? '';
    const syncDegrees = (): void => {
      eachRack.hidden = behaves(what.value) !== 'cooler';
      degrees.hidden = behaves(what.value) !== 'cooler';
      holdsNow.hidden = behaves(what.value) !== 'cooler' && behaves(what.value) !== 'rack';
    };
    what.addEventListener('change', syncDegrees);
    syncDegrees();
    const save = el('button', 'btn btn-transparent btn-sm', 'Save');
    save.type = 'button';
    save.addEventListener('click', () => {
      const unitName = name.value.trim();
      const body: Record<string, unknown> = {};
      if (what.value !== (node.unit.kind ?? '') || degrees.value !== (node.unit.temperature === null || node.unit.temperature === undefined ? '' : String(node.unit.temperature))) {
        body.kind = what.value === '' ? null : what.value;
        body.temperature = degrees.hidden || degrees.value === '' ? null : Number(degrees.value);
      }
      if (unitName !== '' && unitName !== node.unit.name) {
        body.name = unitName;
      }
      if (!eachRack.hidden && eachRack.value !== (node.unit.child_capacity ? String(node.unit.child_capacity) : '')) {
        body.child_capacity = eachRack.value === '' ? null : Number(eachRack.value);
      }
      if (!holdsNow.hidden && holdsNow.value !== (node.unit.capacity ? String(node.unit.capacity) : '')) {
        body.capacity = holdsNow.value === '' ? null : Number(holdsNow.value);
      }
      if (note.value.trim() !== (node.unit.comment ?? '')) {
        body.comment = note.value.trim();
      }
      if (position.value !== (node.unit.position ? String(node.unit.position) : '')) {
        body.position = position.value === '' ? null : Number(position.value);
      }
      if (Object.keys(body).length > 0) {
        patchAndReload(`storage_units/${node.unit.id}`, body);
      }
    });
    const holdsLabel = behaves(node.unit.kind) === 'rack' ? 'Holds (boxes)' : 'Holds (racks)';
    form.append(labelled('Name', name), labelled('Kind of place', what), labelled('Temperature (°C)', degrees), labelled(holdsLabel, holdsNow), labelled('Boxes in each rack', eachRack), labelled('Position among its neighbours', position), labelled('Comment', note), el('div', 'mb-1', ''));
    form.lastElementChild?.append(save);
    return form;
  };

  // move the place, with everything inside it (the entries stored there go with it), to another place: a room, a freezer, a rack, or the top level
  const renderMoveTo = (node: Node): HTMLElement => {
    const form = el('div', 'd-flex flex-wrap align-items-end');
    const target = el('select', 'form-control form-control-sm w-auto mr-1');
    target.setAttribute('aria-label', 'Move this place into');
    target.style.maxWidth = '24rem';
    const top = el('option', '', 'Top level (no parent)');
    top.value = '0';
    target.append(top);
    const inside = new Set(subtree(node).map(n => n.unit.id));
    // the places in the order of the tree; the place itself, what is inside it and the boxes (they hold entries, not places) are left out
    const walk = (nodes: Node[]): void => {
      nodes.forEach(n => {
        if (!inside.has(n.unit.id) && !(n.unit.box_rows && n.unit.box_cols)) {
          const option = el('option', '', n.unit.full_path);
          option.value = String(n.unit.id);
          target.append(option);
        }
        walk(n.children);
      });
    };
    walk(tree.roots);
    target.value = String(node.unit.parent_id ?? 0);
    const go = el('button', 'btn btn-transparent btn-sm', 'Move');
    go.type = 'button';
    go.addEventListener('click', () => {
      if (Number(target.value) !== (node.unit.parent_id ?? 0)) {
        patchAndReload(`storage_units/${node.unit.id}`, { parent_id: Number(target.value) });
      }
    });
    form.append(labelled('Move this place (and everything in it) into', target), el('div', 'mb-1', ''));
    form.lastElementChild?.append(go);
    return form;
  };

  // the information about a storage place: where it is, its conditions, who looks after it, notes (saved in storage-info.php)
  const renderInfo = (node: Node): HTMLElement => {
    const box = el('div', 'card card-body mb-3');
    box.append(el('h5', '', 'Details'));
    const body = el('div');
    box.append(body);
    type Info = { location: string; conditions: string; contact: number | null; contact_name: string; notes: string };
    void fetch(`storage-info.php?id=${node.unit.id}`, { credentials: 'same-origin' }).then(r => r.json()).then((data: { info: Info; can_edit: boolean; users: { id: number; name: string }[] }) => {
      const field = (label: string, input: HTMLElement): HTMLElement => {
        const wrap = el('label', 'd-block mb-2');
        wrap.append(el('span', 'd-block small text-muted', label), input);
        return wrap;
      };
      const location = el('input', 'form-control form-control-sm');
      location.value = data.info.location;
      location.placeholder = 'For example Room 214, building B';
      const conditions = el('input', 'form-control form-control-sm');
      conditions.value = data.info.conditions;
      conditions.placeholder = 'For example -80 °C, or 4 °C';
      const contact = el('select', 'form-control form-control-sm w-auto');
      const none = el('option', '', 'Nobody');
      none.value = '0';
      contact.append(none);
      data.users.forEach(u => {
        const option = el('option', '', u.name);
        option.value = String(u.id);
        contact.append(option);
      });
      contact.value = String(data.info.contact ?? 0);
      const notes = el('textarea', 'form-control form-control-sm');
      notes.rows = 3;
      notes.value = data.info.notes;
      [location, conditions, contact, notes].forEach(input => {
        (input as HTMLInputElement).disabled = !data.can_edit;
      });
      body.append(field('Where it is', location), field('Temperature or conditions', conditions), field('Who looks after it', contact), field('Notes', notes));
      if (!data.can_edit) {
        body.append(el('p', 'small text-muted mb-0', 'You were not given the right to edit the storage places.'));
        return;
      }
      const save = el('button', 'btn btn-secondary btn-sm', 'Save the details');
      save.type = 'button';
      const message = el('span', 'small ml-2');
      save.addEventListener('click', () => {
        const token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
        void fetch('storage-info.php', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token },
          body: JSON.stringify({ storage_id: node.unit.id, location: location.value, conditions: conditions.value, contact: Number(contact.value), notes: notes.value }),
        }).then(async r => {
          const answer = await r.json() as { error?: string };
          message.textContent = r.ok ? 'Saved.' : (answer.error ?? 'Not saved.');
          message.className = `small ml-2 ${r.ok ? 'text-success' : 'text-danger'}`;
        });
      });
      body.append(save, message);
    }).catch(() => {
      body.append(el('p', 'small text-muted mb-0', 'The details could not be loaded.'));
    });
    return box;
  };

  // a location is deleted when nothing is in it and it has no sub-locations (the server refuses otherwise, and only for admins)
  // is the user an admin: the buttons that empty or delete a whole place are shown to admins (the server checks it again)
  let adminAnswer: Promise<boolean> | null = null;
  const adminCheck = (): Promise<boolean> => {
    adminAnswer ??= fetch('registry-transfer.php?users=1', { credentials: 'same-origin' }).then(r => r.json()).then(body => Boolean((body as { is_admin?: boolean }).is_admin)).catch(() => false);
    return adminAnswer;
  };

  const renderDelete = (node: Node): HTMLElement => {
    const wrap = el('div', 'mb-2');
    const blocked = node.children.length > 0 || collect(node, true).length > 0;
    const remove = el('button', 'btn btn-outline-danger btn-sm', 'Delete this location');
    remove.type = 'button';
    remove.disabled = blocked;
    remove.title = blocked ? 'Empty it first: it has sub-locations or something stored in it' : 'Delete this location';
    remove.addEventListener('click', () => {
      void askConfirm(`Delete "${node.unit.full_path}"?`, 'Delete').then(confirmed => {
        if (!confirmed) return;
        return ApiC.delete(`storage_units/${node.unit.id}`).then(() => {
          state.selected = node.unit.parent_id;
          writeState(state);
          return load();
        });
      });
    });
    wrap.append(remove);
    if (blocked) {
      wrap.append(el('span', 'small text-muted ml-2', 'Empty it first to delete it.'));
    }
    // admins: empty the place in one go, or delete it with everything inside; the numbers are shown to confirm first
    const bulk = el('div', 'mt-1');
    bulk.hidden = true;
    const bulkCall = async (body: Record<string, unknown>): Promise<Record<string, number | boolean | string>> => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
      const response = await fetch('registry-transfer.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': meta?.content ?? '' },
        body: JSON.stringify(Object.assign({ action: 'empty_storage', id: node.unit.id }, body)),
      });
      const result = await response.json() as Record<string, number | boolean | string>;
      if (!response.ok) {
        throw new Error(String(result.error ?? 'It did not work.'));
      }
      return result;
    };
    const bulkAction = (label: string, danger: boolean, options: Record<string, unknown>, describe: (n: Record<string, number | boolean | string>) => string): void => {
      const button = el('button', `btn btn-sm mr-2 ${danger ? 'btn-danger' : 'btn-outline-danger'}`, label);
      button.type = 'button';
      button.addEventListener('click', () => {
        void bulkCall({ ...options, count_only: true }).then(async counts => {
          if (!await askConfirm(`${describe(counts)} Continue?`, label)) {
            return;
          }
          await bulkCall(options);
          if (options.delete) {
            state.selected = node.unit.parent_id;
            writeState(state);
          }
          return load();
        }).catch(error => {
          button.after(el('span', 'small text-danger ml-1', error instanceof Error ? error.message : String(error)));
        });
      });
      bulk.append(button);
    };
    bulkAction('Empty this place', false, { include_children: includeChildren }, n => `This takes ${n.entries} entries out of ${n.places} place(s) (the entries are kept).`);
    bulkAction('Delete with everything inside', true, { delete: true }, n => `This deletes "${node.unit.full_path}" and the ${Number(n.places) - 1} place(s) inside it, and takes ${n.entries} entries out of them (the entries are kept).`);
    wrap.append(bulk);
    void adminCheck().then(isAdmin => {
      bulk.hidden = !isAdmin;
    });
    return wrap;
  };

  // the freezer (or fridge), the rack and the box of a place: by the kinds when they are said, else by the depth
  const placeParts = (storageId: number): { freezer: Node | null; rack: Node | null; box: Node | null } => {
    const chain: Node[] = [];
    for (let n: Node | undefined = tree.byId.get(storageId); n; n = n.unit.parent_id === null ? undefined : tree.byId.get(n.unit.parent_id)) {
      chain.unshift(n);
    }
    const isBox = (n: Node): boolean => behaves(n.unit.kind) === 'box' || (n.unit.kind === undefined || n.unit.kind === null ? Boolean(n.unit.box_rows) : false);
    let freezer: Node | null = null;
    chain.forEach(n => {
      if (behaves(n.unit.kind) === 'cooler') {
        freezer = n;
      }
    });
    const last = chain[chain.length - 1] ?? null;
    const box = last && isBox(last) ? last : null;
    const rack = chain.filter(n => behaves(n.unit.kind) === 'rack' && n !== box).pop() ?? null;
    if (freezer === null && chain.length >= 3) {
      // places without kinds: the box, the rack above it, the freezer above that
      return { freezer: chain[chain.length - 3], rack: chain[chain.length - 2], box: last };
    }
    return { freezer, rack, box };
  };

  // the path of the place, each part opens its place, and what the place is
  const renderHeader = (node: Node): HTMLElement => {
    const head = el('div', 'mb-2');
    const crumbs = el('div', 'd-flex flex-wrap align-items-center small color-medium');
    const chain: Node[] = [];
    for (let n: Node | undefined = node; n; n = n.unit.parent_id === null ? undefined : tree.byId.get(n.unit.parent_id)) {
      chain.unshift(n);
    }
    chain.slice(0, -1).forEach(ancestor => {
      const link = el('button', 'btn btn-transparent btn-sm p-0', ancestor.unit.name);
      link.type = 'button';
      link.addEventListener('click', () => select(ancestor.unit.id));
      crumbs.append(link, el('i', 'fas fa-chevron-right fa-xs mx-2'));
    });
    const title = el('h4', 'mb-0 d-flex align-items-center');
    title.append(document.createTextNode(node.unit.name));
    const tag = kindTag(node.unit);
    if (tag) {
      tag.classList.add('ml-2');
      title.append(tag);
    }
    head.append(crumbs, title);
    if (node.unit.comment) {
      head.append(el('div', 'small mt-1', node.unit.comment));
    }
    return head;
  };

  const renderMain = (): void => {
    main.replaceChildren();
    const node = state.selected === null ? undefined : tree.byId.get(state.selected);
    if (!node) {
      main.append(el('p', 'text-muted', 'Select a storage location in the tree.'));
      return;
    }
    main.append(renderHeader(node));
    // this place: what it is
    main.append(section('This place', 'Its name, what it is, and where it comes among the places next to it.', renderRename(node)));
    // above it: the place it is inside
    const parent = node.unit.parent_id === null ? null : tree.byId.get(node.unit.parent_id);
    main.append(section('Inside', parent ? `It is inside: ${parent.unit.full_path}` : 'It is at the top level: it is not inside another place.', renderMoveTo(node)));
    // below it: what is inside this place
    const isBox = Boolean(node.unit.box_rows && node.unit.box_cols);
    const contents: HTMLElement[] = [];
    // a unit with units inside is a rack or a freezer: it is a box only when it holds none
    if (isBox || node.children.length === 0) {
      contents.push(renderBoxSize(node));
    }
    if (isBox) {
      contents.push(renderBox(node));
    } else if (node.children.length > 0 || behaves(node.unit.kind) === 'cooler' || behaves(node.unit.kind) === 'rack') {
      // a fridge, a freezer or a rack is drawn even when it is empty: its place to click adds the first rack or box
      contents.push(behaves(node.unit.kind) === 'location' ? renderLocationView(node) : renderCabinet(node));
    }
    const heading = isBox ? 'The slots of this box' : (node.children.length > 0 ? `Inside it: ${node.children.length} ${node.children.length === 1 ? 'place' : 'places'}` : 'Inside it: nothing yet');
    main.append(section(heading, '', ...contents));
    if (!isBox) {
      main.append(section('Add a place inside it', behaves(node.unit.kind) === 'rack' ? 'Boxes go in a rack.' : 'What can be added here depends on what this place is.', renderAddForm(node)));
    }
    main.append(renderInfo(node));
    // taking things out or deleting: kept apart at the end
    const opt = el('label', 'd-block mb-2');
    const box = el('input', 'mr-1');
    box.type = 'checkbox';
    box.checked = includeChildren;
    box.addEventListener('change', () => {
      includeChildren = box.checked;
      renderMain();
    });
    opt.append(box, document.createTextNode('Include the places inside it in the list of entries below, and in "Empty this place"'));
    main.append(section('Empty or delete', 'These cannot be undone.', renderDelete(node), opt));

    const entries = collect(node, includeChildren);
    if (entries.length === 0) {
      main.append(el('p', 'text-muted', 'This location does not contain any resource.'));
      return;
    }
    // the tubes of one entry in one location are one line: its slots, the total quantity
    const groups = new Map<string, { row: Row; locations: StorageLocation[] }>();
    entries.forEach(({ row, location }) => {
      const key = `${row.id}:${location.storage_id}`;
      const group = groups.get(key) ?? { row, locations: [] };
      group.locations.push(location);
      groups.set(key, group);
    });
    const table = el('table', 'table table-sm table-hover');
    const head = el('tr');
    const columns = ['ID', 'Module', 'Title', 'Freezer', 'Rack', 'Box', 'Slots', 'Quantity', 'Stored on', 'Cap colour', 'Owner', 'Comment'];
    // a click on a heading sorts the table by it, a second click turns the order round (the highest ID first to start with)
    let sortColumn = 0;
    let sortAscending = false;
    const headings: HTMLElement[] = [];
    columns.forEach((h, i) => {
      const th = el('th', h === 'ID' ? 'id-cell' : '', h);
      th.style.cursor = 'pointer';
      th.title = `Sort by ${h}`;
      th.addEventListener('click', () => {
        sortAscending = sortColumn === i ? !sortAscending : true;
        sortColumn = i;
        sortTable();
      });
      headings.push(th);
      head.append(th);
    });
    const sortTable = (): void => {
      const numeric = (text: string): number => {
        const found = /-?\d+(\.\d+)?/.exec(text);
        return found ? Number(found[0]) : Number.NEGATIVE_INFINITY;
      };
      const trs = Array.from(body.querySelectorAll<HTMLTableRowElement>('tr'));
      trs.sort((a, b) => {
        const av = a.children[sortColumn]?.textContent ?? '';
        const bv = b.children[sortColumn]?.textContent ?? '';
        const order = sortColumn === 0 || sortColumn === 7
          ? numeric(av) - numeric(bv)
          : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
        return sortAscending ? order : -order;
      });
      trs.forEach(tr => body.append(tr));
      headings.forEach((th, i) => {
        th.textContent = columns[i] + (i === sortColumn ? (sortAscending ? ' ▲' : ' ▼') : '');
      });
    };
    // a filter under each heading, and one search for all of them: the rows that do not match are hidden
    const filterRow = el('tr', 'expandable-filter-row');
    const wanted: string[] = columns.map(() => '');
    const applyFilters = (): void => {
      const all = searchAll.value.toLowerCase().split(/\s+/).filter(Boolean);
      body.querySelectorAll<HTMLTableRowElement>('tr').forEach(tr => {
        const cells = Array.from(tr.children).map(c => (c.textContent ?? '').toLowerCase());
        const okColumns = wanted.every((w, i) => w === '' || (cells[i] ?? '').includes(w));
        const text = cells.join(' ');
        tr.hidden = !(okColumns && all.every(w => text.includes(w)));
      });
    };
    columns.forEach((h, i) => {
      const th = el('th', h === 'ID' ? 'id-cell' : '');
      if (h === 'Module') {
        // the modules that are in this list
        const choice = el('select', 'form-control form-control-sm');
        choice.setAttribute('aria-label', 'Filter Module');
        const any = el('option', '', 'All modules');
        any.value = '';
        choice.append(any);
        [...new Set([...groups.values()].map(g => g.row.category_title ?? '').filter(Boolean))].sort().forEach(title => {
          const option = el('option', '', title);
          option.value = title.toLowerCase();
          choice.append(option);
        });
        choice.addEventListener('change', () => {
          wanted[i] = choice.value;
          applyFilters();
        });
        th.append(choice);
        filterRow.append(th);
        return;
      }
      const input = el('input', 'form-control form-control-sm expandable-filter');
      input.type = 'search';
      input.placeholder = 'filter';
      input.setAttribute('aria-label', `Filter ${h}`);
      input.addEventListener('input', () => {
        wanted[i] = input.value.toLowerCase();
        applyFilters();
      });
      th.append(input);
      filterRow.append(th);
    });
    const searchAll = el('input', 'form-control form-control-sm mb-2');
    searchAll.type = 'search';
    searchAll.placeholder = 'Search the entries stored here (title, freezer, rack, box, owner, comment...)';
    searchAll.setAttribute('aria-label', 'Search the entries');
    searchAll.addEventListener('input', applyFilters);
    main.append(searchAll);
    const thead = el('thead');
    thead.append(head, filterRow);
    const body = el('tbody');
    groups.forEach(({ row, locations }) => {
      const first = locations[0];
      const tr = el('tr');
      // the number of the entry in its module (its lab number), not the row number of the database
      tr.append(el('td', 'id-cell', row.custom_id === null || row.custom_id === undefined ? '' : String(row.custom_id)));
      // the module of the entry (the ID counts in each module on its own), in the colour of the module
      const moduleCell = el('td', 'text-nowrap');
      if (row.category_title) {
        const dot = el('i', 'fas fa-circle fa-xs mr-1');
        dot.style.color = row.category_color ? `#${row.category_color}` : '#7a7a7a';
        moduleCell.append(dot, document.createTextNode(row.category_title));
      }
      tr.append(moduleCell);
      const titleCell = el('td');
      const link = el('a', '', row.title);
      link.href = `?mode=view&id=${encodeURIComponent(String(row.id))}`;
      titleCell.append(link);
      tr.append(titleCell);
      // where it is: the freezer or fridge (with its temperature), the rack and the box, each a link that opens that place
      const parts = placeParts(first.storage_id);
      [parts.freezer, parts.rack, parts.box].forEach(place => {
        const cell = el('td');
        if (place) {
          const open = el('a', '', place.unit.name);
          open.href = `?storage_unit=${place.unit.id}`;
          open.addEventListener('click', event => {
            event.preventDefault();
            select(place.unit.id);
          });
          cell.append(open);
          const tag = kindTag(place.unit);
          if (tag) {
            cell.append(tag);
          }
        }
        tr.append(cell);
      });
      const slotsCell = el('td');
      locations.forEach(l => {
        if (l.position) {
          const chip = el('span', `storage-slot-chip ${l.is_primary ? 'is-primary' : 'is-secondary'} mr-1`, l.position);
          chip.title = l.comment ? `${l.is_primary ? 'Primary' : 'Secondary'}: ${l.comment}` : (l.is_primary ? 'Primary' : 'Secondary');
          slotsCell.append(chip);
        }
      });
      tr.append(slotsCell);
      // the quantities of the tubes added up per unit
      const sums = new Map<string, number>();
      locations.forEach(l => sums.set(l.qty_unit, (sums.get(l.qty_unit) ?? 0) + Number(l.qty_stored)));
      const total = [...sums.entries()].map(([unit, qty]) => `${Math.round(qty * 100) / 100} ${unit}`.trim()).join(', ');
      tr.append(el('td', 'text-nowrap', locations.length > 1 ? `${total} (${locations.length} tubes)` : total));
      // the day it was put there (the earliest when it sits in several tubes)
      const days = locations.map(l => (l.stored_at ?? '').slice(0, 10)).filter(Boolean).sort();
      tr.append(el('td', 'text-nowrap', days[0] ?? ''));
      // the colours of the caps of its tubes
      const capCell = el('td', 'text-nowrap');
      [...new Set(locations.map(l => l.cap_colour ?? '').filter(Boolean))].forEach(colour => {
        const dot = capDot(colour);
        if (dot) {
          capCell.append(dot, document.createTextNode(`${capColourName(colour)} `));
        }
      });
      tr.append(capCell);
      tr.append(el('td', '', row.fullname ?? ''));
      // the comments of the tubes, and what the place itself says (door sticks, defrosted...)
      const notes = [...locations.map(l => l.comment ?? ''), ...[parts.freezer, parts.rack, parts.box].map(place => place?.unit.comment ? `${place.unit.name}: ${place.unit.comment}` : '')].filter(Boolean);
      tr.append(el('td', '', [...new Set(notes)].join(' | ')));
      body.append(tr);
    });
    table.append(thead, body);
    sortTable();
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
    if (!kindsLoaded) {
      kindsLoaded = true;
      await loadKinds();
    }
    const params = filterParams(event, order, sort);
    // the location in the address is for the tree, not a filter of the resources
    params.delete('storage_unit');
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
      lastUnits = units;
      lastRows = rows;
      tree = buildTree(units, rows);
      const requested = Number(new URLSearchParams(document.location.search).get('storage_unit'));
      if (requested > 0 && tree.byId.has(requested) && !openedFromUrl) {
        state.selected = requested;
        // open the parents so the selected location is visible
        let parent = tree.byId.get(requested)?.unit.parent_id ?? null;
        while (parent !== null && tree.byId.has(parent)) {
          state.collapsed[String(parent)] = false;
          parent = tree.byId.get(parent)?.unit.parent_id ?? null;
        }
        writeState(state);
      }
      openedFromUrl = true;
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
  closePinnedCard();
  hideTubeCard();
  if (onFiltersChanged) {
    window.removeEventListener('entity-filters-changed', onFiltersChanged);
    onFiltersChanged = null;
  }
  requestId++;
  rootEl?.replaceChildren();
  rootEl = null;
}
