/**
 * Popup to add a storage to a resource: search the location, say if it is the primary or a secondary storage,
 * pick the slot when the location is a box, and give the quantity
 */
import { ApiC } from './api';
import { entity } from './getEntity';
import { reloadElements } from './misc';
import { el } from './entities-view-utils';

type Unit = {
  id: number;
  name: string;
  full_path: string;
  box_rows: number | null;
  box_cols: number | null;
  taken_positions: string | null;
};
type UnitOption = { value: string; label: string };

const MAX_RESULTS = 50;

function slotName(row: number, col: number): string {
  return `${String.fromCharCode(64 + row)}${col}`;
}

// the free slots of a box in reading order, starting at a given slot
function freeSlotsFrom(unit: Unit, start: string | null, count: number): string[] {
  const taken = new Set((unit.taken_positions ?? '').split(',').filter(Boolean));
  const rows = unit.box_rows ?? 0;
  const cols = unit.box_cols ?? 0;
  const slots: string[] = [];
  let started = start === null;
  for (let r = 1; r <= rows && slots.length < count; r++) {
    for (let c = 1; c <= cols && slots.length < count; c++) {
      const slot = slotName(r, c);
      if (!started && slot === start) {
        started = true;
      }
      if (started && !taken.has(slot)) {
        slots.push(slot);
      }
    }
  }
  return slots;
}

export async function openStoragePicker(button: HTMLElement): Promise<void> {
  const hasStorage = Number(button.dataset.containersCount ?? '0') > 0;
  let unitOptions: UnitOption[] = [];
  try {
    unitOptions = JSON.parse(button.dataset.units ?? '[]') as UnitOption[];
  } catch {
    unitOptions = [{ value: '•', label: '•' }];
  }
  const units = await ApiC.getJson<Unit[]>('storage_units?hierarchy=1', { notifOnError: 0 });
  units.sort((a, b) => a.full_path.localeCompare(b.full_path));

  let selected: Unit | null = null;
  // the free slots the user clicked in the box; when none, the first free slots are used
  let pickedSlots: string[] = [];

  // the modal
  const modal = el('div', 'modal fade');
  modal.tabIndex = -1;
  modal.setAttribute('role', 'dialog');
  const dialog = el('div', 'modal-dialog modal-lg');
  const content = el('div', 'modal-content');
  const header = el('div', 'modal-header');
  const title = el('h4', 'modal-title');
  title.append(el('i', 'fas fa-fw fa-warehouse mr-1'), document.createTextNode('Add storage'));
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

  // primary or secondary
  const kindRow = el('div', 'mb-3');
  const kinds: { value: 'primary' | 'secondary'; label: string }[] = [
    { value: 'primary', label: 'Primary storage' },
    { value: 'secondary', label: 'Secondary storage' },
  ];
  let kind: 'primary' | 'secondary' = hasStorage ? 'secondary' : 'primary';
  kinds.forEach(k => {
    const label = el('label', 'mr-4 mb-0');
    const radio = el('input', 'mr-1');
    radio.type = 'radio';
    radio.name = 'storagePickerKind';
    radio.value = k.value;
    radio.checked = k.value === kind;
    radio.addEventListener('change', () => {
      kind = k.value;
    });
    label.append(radio, document.createTextNode(k.label));
    kindRow.append(label);
  });
  if (hasStorage) {
    kindRow.append(el('div', 'small color-medium', 'A resource has one primary storage. Choosing primary makes this one the primary.'));
  }

  // search
  const searchLabel = el('label', 'font-weight-bold', 'Where do you want to store it?');
  const search = el('input', 'form-control mb-2');
  search.type = 'search';
  search.placeholder = 'Search a location, a freezer, a rack or a box';
  search.autocomplete = 'off';
  searchLabel.htmlFor = search.id = 'storagePickerSearch';
  const results = el('div', 'list-group storage-picker-results mb-3');

  // what is chosen
  const chosen = el('div');

  body.append(kindRow, searchLabel, search, results, chosen);

  const add = el('button', 'btn btn-primary', 'Add storage');
  add.type = 'button';
  add.disabled = true;
  const cancel = el('button', 'btn btn-secondary', 'Close');
  cancel.type = 'button';
  cancel.setAttribute('data-dismiss', 'modal');
  footer.append(cancel, add);

  // quantity fields live in the chosen part, kept here so the add button can read them
  const qty = el('input', 'form-control');
  qty.type = 'number';
  qty.min = '0';
  qty.step = 'any';
  qty.value = '1';
  qty.setAttribute('aria-label', 'Quantity');
  const unitSelect = el('select', 'custom-select');
  unitSelect.setAttribute('aria-label', 'Quantity unit');
  unitOptions.forEach(u => {
    const option = el('option', '', u.label);
    option.value = u.value;
    unitSelect.append(option);
  });
  const copies = el('input', 'form-control');
  copies.type = 'number';
  copies.min = '1';
  copies.step = '1';
  copies.value = '1';
  copies.setAttribute('aria-label', 'Number of containers');

  const renderResults = (): void => {
    // every word typed must be in the path, in any order: "freezer rack 3" finds Freezer > Rack 3_1
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    results.replaceChildren();
    // nothing is listed until something is typed
    if (words.length === 0) {
      results.append(el('div', 'list-group-item text-muted', 'Type to search a location: a room, a freezer, a rack or a box.'));
      return;
    }
    const matches = units
      .filter(u => words.every(w => u.full_path.toLowerCase().includes(w)))
      .slice(0, MAX_RESULTS);
    if (matches.length === 0) {
      results.append(el('div', 'list-group-item text-muted', 'No location matches.'));
      return;
    }
    matches.forEach(u => {
      const item = el('button', `list-group-item list-group-item-action py-1${selected?.id === u.id ? ' active' : ''}`);
      item.type = 'button';
      item.append(el('i', 'fas fa-fw fa-location-dot mr-1'), document.createTextNode(u.full_path));
      if (u.box_rows) {
        item.append(el('span', 'badge badge-light ml-2', `box ${u.box_rows}×${u.box_cols}`));
      }
      item.addEventListener('click', () => {
        selected = u;
        pickedSlots = [];
        copies.disabled = false;
        renderResults();
        renderChosen();
        // a box shows its slots below the results: make sure they are seen
        chosen.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      results.append(item);
    });
  };

  const renderChosen = (): void => {
    chosen.replaceChildren();
    add.disabled = selected === null;
    if (selected === null) {
      return;
    }
    const unit = selected;
    chosen.append(el('h5', '', unit.full_path));

    const amount = el('div', 'input-group mb-2');
    const append = el('div', 'input-group-append');
    append.append(unitSelect);
    amount.append(qty, append);
    chosen.append(el('label', 'mb-1', 'Quantity per container'), amount);

    chosen.append(el('label', 'mb-1', 'Number of containers (aliquots)'), copies);

    if (unit.box_rows && unit.box_cols) {
      const taken = new Set((unit.taken_positions ?? '').split(',').filter(Boolean));
      const hint = el('p', 'small color-medium mt-2 mb-1');
      // what will be used: the slots clicked, or the first free ones
      const planned = (): string[] => pickedSlots.length > 0
        ? pickedSlots
        : freeSlotsFrom(unit, null, Math.max(1, Number(copies.value) || 1));
      const showHint = (): void => {
        if (pickedSlots.length > 0) {
          hint.textContent = `Selected: ${pickedSlots.join(', ')}. Click a selected slot again to unselect it.`;
        } else {
          const slots = planned();
          hint.textContent = slots.length === 0
            ? 'This box is full.'
            : `No slot selected: the first free slots (${slots.join(', ')}) will be used. Click free slots to choose your own.`;
        }
      };
      const wrap = el('div', 'box-grid-wrap');
      const table = el('table', 'box-grid');
      const head = el('tr');
      head.append(el('th'));
      for (let c = 1; c <= unit.box_cols; c++) {
        head.append(el('th', '', String(c)));
      }
      const thead = el('thead');
      thead.append(head);
      const tbody = el('tbody');
      const cells = new Map<string, HTMLButtonElement>();
      for (let r = 1; r <= unit.box_rows; r++) {
        const tr = el('tr');
        tr.append(el('th', '', String.fromCharCode(64 + r)));
        for (let c = 1; c <= unit.box_cols; c++) {
          const slot = slotName(r, c);
          const td = el('td');
          const cell = el('button', taken.has(slot) ? 'box-slot filled' : 'box-slot');
          cell.type = 'button';
          cell.title = taken.has(slot) ? `${slot}: taken` : `${slot}: free`;
          cell.disabled = taken.has(slot);
          if (taken.has(slot)) {
            cell.style.backgroundColor = '#9a9a9a';
          } else {
            cell.addEventListener('click', () => {
              pickedSlots = pickedSlots.includes(slot) ? pickedSlots.filter(x => x !== slot) : [...pickedSlots, slot];
              // the selection decides how many containers there are
              copies.disabled = pickedSlots.length > 0;
              if (pickedSlots.length > 0) {
                copies.value = String(pickedSlots.length);
              }
              paint();
            });
          }
          cells.set(slot, cell);
          td.append(cell);
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(thead, tbody);
      wrap.append(table);
      // the slots that will be used are shown picked
      const paint = (): void => {
        const chosenSlots = new Set(pickedSlots);
        const suggested = new Set(pickedSlots.length > 0 ? [] : planned());
        cells.forEach((cell, slot) => {
          const isChosen = chosenSlots.has(slot);
          cell.classList.toggle('chosen', isChosen);
          cell.classList.toggle('suggested', suggested.has(slot));
          cell.setAttribute('aria-pressed', String(isChosen));
          if (!cell.disabled) {
            cell.textContent = isChosen ? '✓' : '';
          }
        });
        showHint();
      };
      copies.oninput = paint;
      chosen.append(el('label', 'mt-2 mb-1 font-weight-bold', 'Choose free slots in the box'), wrap, hint);
      paint();
    } else {
      copies.oninput = null;
    }
  };

  search.addEventListener('input', renderResults);
  // Enter picks the first result
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      results.querySelector<HTMLButtonElement>('button')?.click();
    }
  });

  add.addEventListener('click', async () => {
    if (selected === null) {
      return;
    }
    const unit = selected;
    const count = pickedSlots.length > 0 ? pickedSlots.length : Math.max(1, Math.floor(Number(copies.value) || 1));
    const slots = unit.box_rows ? (pickedSlots.length > 0 ? pickedSlots : freeSlotsFrom(unit, null, count)) : [];
    if (unit.box_rows && slots.length < count) {
      // the box cannot take that many: say so instead of leaving some containers loose
      copies.setCustomValidity(`Only ${slots.length} free slot(s) in this box`);
      copies.reportValidity();
      copies.setCustomValidity('');
      return;
    }
    add.disabled = true;
    try {
      for (let i = 0; i < count; i++) {
        // the first container takes the primary flag when asked, the position is set by the server on creation
        await ApiC.post(`${entity.type}/${entity.id}/containers/${unit.id}`, {
          qty_stored: qty.value,
          qty_unit: unitSelect.value,
          ...(slots[i] ? { position: slots[i] } : {}),
          ...(kind === 'primary' && i === 0 ? { is_primary: 1 } : {}),
        });
      }
      $(modal).modal('hide');
      await reloadElements(['storageDivContent']);
    } catch {
      // ApiC already told the user what went wrong: let them fix it and try again
      add.disabled = false;
    }
  });

  document.body.append(modal);
  $(modal).on('hidden.bs.modal', () => modal.remove());
  renderResults();
  renderChosen();
  $(modal).modal('show');
  search.focus();
}
