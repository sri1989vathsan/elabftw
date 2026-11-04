/**
 * Popup opened on a free slot of a box in the storage browser: search the entry to store there, give the quantity,
 * say if it is its primary or a secondary storage
 */
import { ApiC } from './api';
import { el } from './entities-view-utils';
import { capColourPicker } from './cap-colours';

type Entry = { id: number; title: string; category_title: string | null; storage_locations?: unknown[] };

const UNITS = ['•', 'μL', 'mL', 'L', 'μg', 'mg', 'g', 'kg', 'e6 cells'];
const MAX_RESULTS = 8;

export function openSlotAdd(unit: { id: number; full_path: string }, slotOrSlots: string | string[], onDone: () => void): void {
  // one slot, or several free slots chosen together: the entry is stored in each of them
  const slots = Array.isArray(slotOrSlots) ? slotOrSlots : [slotOrSlots];
  const slot = slots.length === 1 ? slots[0] : `${slots.length} slots`;
  let selected: Entry | null = null;
  let timer = 0;

  const modal = el('div', 'modal fade');
  modal.tabIndex = -1;
  modal.setAttribute('role', 'dialog');
  const dialog = el('div', 'modal-dialog');
  const content = el('div', 'modal-content');
  const header = el('div', 'modal-header');
  const title = el('h4', 'modal-title');
  title.append(el('i', 'fas fa-fw fa-warehouse mr-1'), document.createTextNode(`Add storage in ${slots.length > 4 ? slot : slots.join(', ')}`));
  const close = el('button', 'close');
  close.type = 'button';
  close.setAttribute('data-dismiss', 'modal');
  close.setAttribute('aria-label', 'Close');
  close.append(el('span', '', '×'));
  header.append(title, close);
  const body = el('div', 'modal-body');
  const footer = el('div', 'modal-footer');
  content.append(header, body, footer);
  dialog.append(content);
  modal.append(dialog);

  body.append(el('p', 'color-medium', slots.length === 1 ? `${unit.full_path} · slot ${slot}` : `${unit.full_path} · slots ${slots.join(', ')}`));

  const searchLabel = el('label', 'font-weight-bold', 'Which entry is stored here?');
  const search = el('input', 'form-control mb-2');
  search.type = 'search';
  search.placeholder = 'Search an entry by title';
  search.autocomplete = 'off';
  searchLabel.htmlFor = search.id = 'slotAddSearch';
  const results = el('div', 'list-group mb-3');
  const chosen = el('div');
  body.append(searchLabel, search, results, chosen);

  const amount = el('div', 'input-group mb-2');
  const qty = el('input', 'form-control');
  qty.type = 'number';
  qty.min = '0';
  qty.step = 'any';
  qty.value = '1';
  qty.setAttribute('aria-label', 'Quantity');
  const unitSelect = el('select', 'custom-select');
  unitSelect.setAttribute('aria-label', 'Quantity unit');
  UNITS.forEach(u => {
    const option = el('option', '', u);
    option.value = u;
    unitSelect.append(option);
  });
  const append = el('div', 'input-group-append');
  append.append(unitSelect);
  amount.append(qty, append);

  const comment = el('input', 'form-control mb-2');
  comment.type = 'text';
  comment.maxLength = 255;
  comment.placeholder = 'Comment (optional)';
  comment.setAttribute('aria-label', 'Comment');
  // the day the entries were put there: today to start with
  const storedAt = el('input', 'form-control mb-2');
  storedAt.type = 'date';
  storedAt.setAttribute('aria-label', 'Stored on');
  const expiresAt = el('input', 'form-control mb-2');
  expiresAt.type = 'date';
  expiresAt.setAttribute('aria-label', 'Expires on');
  const capPicker = capColourPicker('');
  storedAt.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  let kind: 'primary' | 'secondary' = 'primary';
  const kindRow = el('div', 'mb-2');
  (['primary', 'secondary'] as const).forEach(k => {
    const label = el('label', 'mr-4 mb-0');
    const radio = el('input', 'mr-1');
    radio.type = 'radio';
    radio.name = 'slotAddKind';
    radio.value = k;
    radio.addEventListener('change', () => {
      kind = k;
    });
    radio.dataset.kind = k;
    label.append(radio, document.createTextNode(k === 'primary' ? 'Primary storage' : 'Secondary storage'));
    kindRow.append(label);
  });

  const add = el('button', 'btn btn-primary', 'Add storage');
  add.type = 'button';
  add.disabled = true;
  const cancel = el('button', 'btn btn-secondary', 'Close');
  cancel.type = 'button';
  cancel.setAttribute('data-dismiss', 'modal');
  footer.append(cancel, add);

  const renderChosen = (): void => {
    chosen.replaceChildren();
    add.disabled = selected === null;
    if (selected === null) {
      return;
    }
    chosen.append(el('h5', '', selected.title));
    chosen.append(el('label', 'mb-1', 'Quantity'), amount, el('label', 'mb-1', 'Stored on'), storedAt, el('label', 'mb-1', 'Expires on (optional)'), expiresAt, el('label', 'mb-1', 'Cap colour'), capPicker.element, el('label', 'mb-1', 'Comment'), comment, kindRow);
    kindRow.querySelectorAll<HTMLInputElement>('input').forEach(radio => {
      radio.checked = radio.dataset.kind === kind;
    });
  };

  const showResults = (entries: Entry[]): void => {
    results.replaceChildren();
    if (search.value.trim() === '') {
      results.append(el('div', 'list-group-item text-muted', 'Type to search an entry.'));
      return;
    }
    if (entries.length === 0) {
      results.append(el('div', 'list-group-item text-muted', 'No entry matches.'));
      return;
    }
    entries.slice(0, MAX_RESULTS).forEach(entry => {
      const item = el('button', `list-group-item list-group-item-action py-1${selected?.id === entry.id ? ' active' : ''}`);
      item.type = 'button';
      item.append(document.createTextNode(`#${entry.id} ${entry.title}`));
      if (entry.category_title) {
        item.append(el('span', 'badge badge-light ml-2', entry.category_title));
      }
      item.addEventListener('click', () => {
        selected = entry;
        // an entry that is stored nowhere yet gets its primary storage here
        kind = (entry.storage_locations?.length ?? 0) > 0 ? 'secondary' : 'primary';
        showResults(entries);
        renderChosen();
      });
      results.append(item);
    });
  };

  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const term = search.value.trim();
      if (term === '') {
        showResults([]);
        return;
      }
      try {
        showResults(await ApiC.getJson<Entry[]>(`inventory?limit=${MAX_RESULTS}&q=${encodeURIComponent(term)}`, { notifOnError: 0 }));
      } catch {
        results.replaceChildren(el('div', 'list-group-item text-muted', 'The search failed.'));
      }
    }, 250);
  });

  add.addEventListener('click', async () => {
    if (selected === null) {
      return;
    }
    add.disabled = true;
    try {
      // one tube in each slot: the first is the primary storage of the entry when it is chosen so, the others are secondary
      for (const [index, place] of slots.entries()) {
        await ApiC.post(`inventory/${selected.id}/containers/${unit.id}`, {
          qty_stored: qty.value,
          qty_unit: unitSelect.value,
          position: place,
          ...(comment.value.trim() !== '' ? { comment: comment.value } : {}),
          ...(storedAt.value !== '' ? { stored_at: storedAt.value } : {}),
          ...(capPicker.get() !== '' ? { cap_colour: capPicker.get() } : {}),
          ...(expiresAt.value !== '' ? { expires_at: expiresAt.value } : {}),
          ...(kind === 'primary' && index === 0 ? { is_primary: 1 } : {}),
        });
      }
      $(modal).modal('hide');
      onDone();
    } catch {
      // ApiC already told the user what went wrong: let them fix it and try again
      add.disabled = false;
    }
  });

  document.body.append(modal);
  $(modal).on('hidden.bs.modal', () => modal.remove());
  showResults([]);
  $(modal).modal('show');
  search.focus();
}
