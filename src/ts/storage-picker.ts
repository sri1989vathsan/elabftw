/**
 * Popup to add a storage to an entry, or to edit one (the button carries the container then): search the location,
 * say if it is the primary or a secondary storage, pick the slot when the location is a box, and give the quantity
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
  // editing: the container to change, with what it holds now
  const editId = button.dataset.editId ? Number(button.dataset.editId) : null;
  const editing = editId !== null;
  const currentStorageId = Number(button.dataset.storageId ?? '0');
  const currentPosition = button.dataset.position ?? '';
  const wasPrimary = button.dataset.primary === '1';
  const hasStorage = !editing && Number(button.dataset.containersCount ?? '0') > 0;
  let unitOptions: UnitOption[] = [];
  try {
    unitOptions = JSON.parse(button.dataset.units ?? '[]') as UnitOption[];
  } catch {
    unitOptions = [{ value: '•', label: '•' }];
  }
  const units = await ApiC.getJson<Unit[]>('storage_units?hierarchy=1', { notifOnError: 0 });
  // in order, place by place along the path: by the number at the end of a name when both have one (box 5, 6, ... 10), else in natural order
  const byName = (a: string, b: string): number => {
    const an = /(\d+)\s*$/.exec(a);
    const bn = /(\d+)\s*$/.exec(b);
    if (an && bn && Number(an[1]) !== Number(bn[1])) {
      return Number(an[1]) - Number(bn[1]);
    }
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  };
  units.sort((a, b) => {
    const as = a.full_path.split(' > ');
    const bs = b.full_path.split(' > ');
    for (let i = 0; i < Math.min(as.length, bs.length); i++) {
      const order = byName(as[i], bs[i]);
      if (order !== 0) {
        return order;
      }
    }
    return as.length - bs.length;
  });

  if (editing) {
    // the slot of the tube itself is not taken for the tube itself
    units.forEach(u => {
      if (u.id === currentStorageId && currentPosition !== '') {
        u.taken_positions = (u.taken_positions ?? '').split(',').filter(x => x && x !== currentPosition).join(',');
      }
    });
  }
  let selected: Unit | null = editing ? (units.find(u => u.id === currentStorageId) ?? null) : null;
  // the free slots the user clicked in the box; when none, the first free slots are used
  let pickedSlots: string[] = editing && currentPosition !== '' ? [currentPosition] : [];

  // the modal
  const modal = el('div', 'modal fade');
  modal.tabIndex = -1;
  modal.setAttribute('role', 'dialog');
  const dialog = el('div', 'modal-dialog modal-lg');
  const content = el('div', 'modal-content');
  const header = el('div', 'modal-header');
  const title = el('h4', 'modal-title');
  title.append(el('i', 'fas fa-fw fa-warehouse mr-1'), document.createTextNode(editing ? 'Edit storage' : 'Add storage'));
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
  let kind: 'primary' | 'secondary' = editing ? (wasPrimary ? 'primary' : 'secondary') : (hasStorage ? 'secondary' : 'primary');
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

  const add = el('button', 'btn btn-primary', editing ? 'Save' : 'Add storage');
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
  qty.value = editing ? (button.dataset.qty ?? '1') : '1';
  qty.setAttribute('aria-label', 'Quantity');
  const unitSelect = el('select', 'custom-select');
  unitSelect.setAttribute('aria-label', 'Quantity unit');
  unitOptions.forEach(u => {
    const option = el('option', '', u.label);
    option.value = u.value;
    unitSelect.append(option);
  });
  if (editing && button.dataset.unit) {
    // a unit that is not in the list is kept as it is
    if (!unitOptions.some(u => u.value === button.dataset.unit)) {
      const option = el('option', '', button.dataset.unit);
      option.value = button.dataset.unit;
      unitSelect.append(option);
    }
    unitSelect.value = button.dataset.unit;
  }
  // a short note on the storage: what is in the tube, a batch...
  const comment = el('input', 'form-control');
  comment.type = 'text';
  comment.maxLength = 255;
  comment.placeholder = 'Comment (optional)';
  comment.setAttribute('aria-label', 'Comment');
  comment.value = editing ? (button.dataset.comment ?? '') : '';
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
    chosen.append(el('label', 'mb-1', 'Comment'), comment);

    if (!editing) {
      chosen.append(el('label', 'mb-1', 'Number of containers (aliquots)'), copies);
    }

    if (unit.box_rows && unit.box_cols) {
      const taken = new Set((unit.taken_positions ?? '').split(',').filter(Boolean));
      const hint = el('p', 'small color-medium mt-2 mb-1');
      // what will be used: the slots clicked, or the first free ones
      const planned = (): string[] => pickedSlots.length > 0
        ? pickedSlots
        : freeSlotsFrom(unit, null, Math.max(1, Number(copies.value) || 1));
      const showHint = (): void => {
        if (editing && pickedSlots.length > 0) {
          hint.textContent = `Selected: ${pickedSlots.join(', ')}. The tube takes the first of them (${currentPosition !== '' && pickedSlots.includes(currentPosition) ? currentPosition : pickedSlots[0]}); each other slot gets one more tube with the same quantity.`;
        } else if (pickedSlots.length > 0) {
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
    if (editing) {
      add.disabled = true;
      const chosenSlots = unit.box_rows ? pickedSlots : [];
      // the tube keeps its own slot when it is still selected, else it takes the first one
      const slot = chosenSlots.length > 0 ? (chosenSlots.includes(currentPosition) && unit.id === currentStorageId ? currentPosition : chosenSlots[0]) : '';
      const extraSlots = chosenSlots.filter(x => x !== slot);
      const moved = unit.id !== currentStorageId;
      try {
        await ApiC.patch(`${entity.type}/${entity.id}/containers/${editId}`, {
          qty_stored: qty.value,
          qty_unit: unitSelect.value,
          comment: comment.value,
          ...(moved ? { storage_id: unit.id } : {}),
          // a move leaves the old slot: the new one is set after it
          ...((moved || slot !== currentPosition) && (slot !== '' || !moved) ? { position: slot } : {}),
          ...(kind === 'primary' && !wasPrimary ? { is_primary: 1 } : {}),
        });
        // more slots chosen: one more tube in each, with the same quantity
        for (const extra of extraSlots) {
          await ApiC.post(`${entity.type}/${entity.id}/containers/${unit.id}`, {
            qty_stored: qty.value,
            qty_unit: unitSelect.value,
            comment: comment.value,
            position: extra,
          });
        }
        $(modal).modal('hide');
        await reloadElements(['storageDivContent']);
      } catch {
        add.disabled = false;
      }
      return;
    }
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
          ...(comment.value.trim() !== '' ? { comment: comment.value } : {}),
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
