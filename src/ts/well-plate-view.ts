/**
 * This file is part of the eLabFTW fork's customizations.
 *
 * A compact, interactive view of a well plate: coloured wells with the contents shown on hover, named colour
 * groups, and a popup to select wells and change their group or contents. The data stays an ordinary
 * spreadsheet (one cell per well); a well's group is the background colour of its cell, so the spreadsheet
 * popup, printing and this view always agree.
 */
import {
  SpreadsheetData,
  SpreadsheetHostHandle,
  SpreadsheetHostOptions,
  colLabel,
  normalizeSpreadsheetData,
  registerSpreadsheetHostData,
} from './inline-spreadsheet';

export interface PlateGroup {
  name: string;
  color: string;
}

const PALETTE = ['#e5484d', '#f76b15', '#e5a50a', '#30a46c', '#12a594', '#2a6df4', '#8e4ec6', '#d6409f', '#7d8499'];

// Well names run A, B, C down the plate and 1, 2, 3 across it, which is the reverse of spreadsheet coordinates.
const wellName = (row: number, col: number): string => `${colLabel(row)}${col + 1}`;
const cellCoordinate = (row: number, col: number): string => `${colLabel(col)}${row + 1}`;
const wellKey = (row: number, col: number): string => `${row},${col}`;

function normalizeColor(value: string): string {
  const text = value.trim().toLowerCase();
  const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map(part => Number(part).toString(16).padStart(2, '0')).join('')}`;
  }
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  return text;
}

function parseStyle(style: string | undefined): Array<[string, string]> {
  return (style ?? '').split(';').map(part => {
    const index = part.indexOf(':');
    return index < 0 ? null : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()] as [string, string];
  }).filter((entry): entry is [string, string] => entry !== null && entry[0] !== '');
}

function wellColor(data: SpreadsheetData, row: number, col: number): string | null {
  const entries = parseStyle(data.cellStyles?.[cellCoordinate(row, col)]);
  const found = entries.find(([name]) => name === 'background-color') ?? entries.find(([name]) => name === 'background');
  if (!found || /^(transparent|none|white|#fff(fff)?)$/i.test(found[1])) return null;
  return normalizeColor(found[1]);
}

function setWellColor(data: SpreadsheetData, row: number, col: number, color: string | null): void {
  const coordinate = cellCoordinate(row, col);
  const styles = { ...(data.cellStyles ?? {}) };
  const entries = parseStyle(styles[coordinate]).filter(([name]) => name !== 'background-color' && name !== 'background');
  if (color) entries.push(['background-color', color]);
  if (entries.length > 0) styles[coordinate] = entries.map(([name, value]) => `${name}:${value}`).join(';');
  else delete styles[coordinate];
  data.cellStyles = styles;
}

/** The named groups plus any colour in use that has no name yet, with how many wells each holds. */
function groupsWithCounts(data: SpreadsheetData): Array<PlateGroup & { count: number }> {
  const counts = new Map<string, number>();
  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      const color = wellColor(data, row, col);
      if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  const named = (data.plateGroups ?? []).map(group => ({ ...group, color: normalizeColor(group.color) }));
  const result = named.map(group => ({ ...group, count: counts.get(group.color) ?? 0 }));
  counts.forEach((count, color) => {
    if (!named.some(group => group.color === color)) result.push({ name: color, color, count });
  });
  return result;
}

function groupNameFor(data: SpreadsheetData, color: string | null): string | null {
  if (!color) return null;
  return groupsWithCounts(data).find(group => group.color === color)?.name ?? color;
}

function wellValue(data: SpreadsheetData, row: number, col: number): string {
  const shown = data.displayData?.[row]?.[col] ?? data.data[row]?.[col] ?? '';
  return String(shown);
}

function wellSize(data: SpreadsheetData, popup: boolean): number {
  const count = data.rows * data.cols;
  const base = count <= 24 ? 38 : count <= 48 ? 34 : count <= 96 ? 28 : 17;
  return popup ? Math.round(base * 1.15) : base;
}

// One tooltip element shared by every plate on the page.
let tooltipEl: HTMLDivElement | null = null;
function showTooltip(event: MouseEvent, data: SpreadsheetData, row: number, col: number): void {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'wp-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
  }
  const color = wellColor(data, row, col);
  const value = wellValue(data, row, col).trim();
  tooltipEl.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'wp-tooltip-head';
  heading.textContent = wellName(row, col);
  tooltipEl.appendChild(heading);
  const group = groupNameFor(data, color);
  if (group && color) {
    const line = document.createElement('div');
    line.className = 'wp-tooltip-group';
    const dot = document.createElement('i');
    dot.className = 'wp-dot';
    dot.style.background = color;
    line.append(dot, document.createTextNode(group));
    tooltipEl.appendChild(line);
  }
  const body = document.createElement('div');
  body.className = 'wp-tooltip-body';
  body.textContent = value === '' ? 'empty' : (value.length > 300 ? `${value.slice(0, 300)}…` : value);
  if (value === '') body.classList.add('is-empty');
  tooltipEl.appendChild(body);
  if (!tooltipEl.isConnected) document.body.appendChild(tooltipEl);
  moveTooltip(event);
}

function moveTooltip(event: MouseEvent): void {
  if (!tooltipEl) return;
  const width = tooltipEl.offsetWidth;
  const height = tooltipEl.offsetHeight;
  const left = Math.min(event.clientX + 14, window.innerWidth - width - 8);
  const top = event.clientY + 16 + height > window.innerHeight ? event.clientY - height - 12 : event.clientY + 16;
  tooltipEl.style.left = `${Math.max(4, left)}px`;
  tooltipEl.style.top = `${Math.max(4, top)}px`;
}

function hideTooltip(): void {
  tooltipEl?.remove();
}

interface PlateOptions {
  popup: boolean;
  selected?: Set<string>;
  onSelect?: (selected: Set<string>) => void;
  onClick?: () => void;
  dimmed?: Set<string>;
}

/** Draws the plate (lettered rows, numbered columns, round wells) into `root`. */
function renderPlate(root: HTMLElement, data: SpreadsheetData, options: PlateOptions): void {
  const size = wellSize(data, options.popup);
  root.replaceChildren();
  root.classList.add('wp-grid');
  root.style.setProperty('--wp-size', `${size}px`);
  root.style.gridTemplateColumns = `auto repeat(${data.cols}, ${size}px)`;
  root.appendChild(document.createElement('span'));
  for (let col = 0; col < data.cols; col++) {
    const label = document.createElement('span');
    label.className = 'wp-label';
    label.textContent = String(col + 1);
    if (options.popup) label.dataset.col = String(col);
    root.appendChild(label);
  }
  for (let row = 0; row < data.rows; row++) {
    const label = document.createElement('span');
    label.className = 'wp-label';
    label.textContent = colLabel(row);
    if (options.popup) label.dataset.row = String(row);
    root.appendChild(label);
    for (let col = 0; col < data.cols; col++) {
      const well = document.createElement('span');
      well.className = 'wp-well';
      well.dataset.row = String(row);
      well.dataset.col = String(col);
      const color = wellColor(data, row, col);
      if (color) {
        well.style.background = color;
        if (options.dimmed?.has(color)) well.classList.add('is-dimmed');
      } else if (wellValue(data, row, col).trim() === '') {
        well.classList.add('is-empty');
      } else {
        well.classList.add('has-content');
      }
      if (options.selected?.has(wellKey(row, col))) well.classList.add('is-selected');
      root.appendChild(well);
    }
  }
  const wellAt = (event: Event): HTMLElement | null => (event.target as Element | null)?.closest<HTMLElement>('.wp-well') ?? null;
  root.onmouseover = event => {
    const well = wellAt(event);
    if (well) showTooltip(event, data, Number(well.dataset.row), Number(well.dataset.col));
    else hideTooltip();
  };
  root.onmousemove = event => {
    if (wellAt(event)) moveTooltip(event);
  };
  root.onmouseleave = hideTooltip;
  if (options.onClick) root.onclick = () => options.onClick?.();
}

/** The legend: a swatch, the name and the number of wells for each group in use. */
function renderLegend(root: HTMLElement, data: SpreadsheetData, dimmed?: Set<string>, onToggle?: (color: string) => void): void {
  root.replaceChildren();
  groupsWithCounts(data).filter(group => group.count > 0 || (data.plateGroups ?? []).length > 0).forEach(group => {
    const item = document.createElement(onToggle ? 'button' : 'span');
    if (item instanceof HTMLButtonElement) {
      item.type = 'button';
      item.title = 'Click to dim or show this group';
    }
    item.className = 'wp-legend-item';
    if (dimmed?.has(group.color)) item.classList.add('is-dimmed');
    const dot = document.createElement('i');
    dot.className = 'wp-dot';
    dot.style.background = group.color;
    const text = document.createElement('span');
    text.textContent = `${group.name} (${group.count})`;
    item.append(dot, text);
    if (onToggle) {
      item.addEventListener('click', event => {
        event.stopPropagation();
        onToggle(group.color);
      });
    }
    root.appendChild(item);
  });
}

/**
 * The compact plate shown in the main text and on view pages. Same handle as the spreadsheet grid host so the
 * editor overlay can mount either one. Editing happens in the plate popup (onOpenFullEditor).
 */
export function buildWellPlateHost(extracted: SpreadsheetData, options: SpreadsheetHostOptions = {}): SpreadsheetHostHandle {
  const data = normalizeSpreadsheetData(extracted);
  const host = document.createElement('div');
  host.className = 'elabftw-spreadsheet-readonly-view elabftw-well-plate-view';
  registerSpreadsheetHostData(host, extracted);

  const toggleBar = document.createElement('div');
  toggleBar.className = 'elabftw-spreadsheet-readonly-toggle';
  if (data.caption) {
    const label = document.createElement('span');
    label.className = 'elabftw-spreadsheet-title';
    label.textContent = data.caption;
    label.title = data.caption;
    toggleBar.appendChild(label);
  }
  const addButton = (className: string, title: string, icon: string, action: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
    button.addEventListener('click', event => {
      event.stopPropagation();
      action();
    });
    toggleBar.appendChild(button);
  };
  if (options.onOpenFullEditor) {
    addButton('elabftw-spreadsheet-readonly-open-editor', 'Edit plate: select wells, set groups and colours', 'fa-up-right-and-down-left-from-center', options.onOpenFullEditor);
  }
  if (options.onDelete) {
    addButton('elabftw-spreadsheet-readonly-delete', 'Delete this plate', 'fa-trash', () => {
      if (window.confirm('Delete this plate? This cannot be undone.')) options.onDelete?.();
    });
  }
  host.appendChild(toggleBar);

  const gridArea = document.createElement('div');
  gridArea.className = 'elabftw-spreadsheet-readonly-grid';
  const content = document.createElement('div');
  content.className = 'wp-plate';
  const plate = document.createElement('div');
  const legend = document.createElement('div');
  legend.className = 'wp-legend';
  const dimmed = new Set<string>();
  const paint = (): void => {
    renderPlate(plate, data, { popup: false, dimmed, onClick: options.onOpenFullEditor });
    renderLegend(legend, data, dimmed, color => {
      if (dimmed.has(color)) dimmed.delete(color);
      else dimmed.add(color);
      paint();
    });
  };
  paint();
  if (options.onOpenFullEditor) plate.classList.add('is-clickable');
  content.append(plate, legend);
  gridArea.appendChild(content);
  host.appendChild(gridArea);

  return {
    host,
    destroy: () => hideTooltip(),
    syncActiveEditor: () => undefined,
    getData: () => data.data.map(row => [...row]),
    isEditing: () => false,
    flush: () => undefined,
  };
}

export interface WellPlateModalResult {
  raw: SpreadsheetData;
  /** True when the person asked to continue in the general spreadsheet popup. */
  openSpreadsheet: boolean;
}

/** The plate popup: select wells (drag, row/column headers, shift), then set group, colour or contents. */
export function openWellPlateModal(initial: SpreadsheetData, isEditing: boolean): Promise<WellPlateModalResult> {
  return new Promise((resolve, reject) => {
    const working = normalizeSpreadsheetData({
      ...initial,
      data: initial.data.map(row => [...row]),
      cellStyles: { ...(initial.cellStyles ?? {}) },
      plateGroups: (initial.plateGroups ?? []).map(group => ({ ...group })),
    });
    working.displayData = undefined;
    let selected = new Set<string>();
    let anchor: [number, number] | null = null;
    let dragging = false;
    let activeColor = PALETTE[5];
    const dimmed = new Set<string>();

    const overlay = document.createElement('div');
    overlay.className = 'inline-spreadsheet-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'inline-spreadsheet-dialog wp-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Edit well plate');
    dialog.tabIndex = -1;

    const title = document.createElement('h5');
    title.textContent = isEditing ? `Edit plate${working.caption ? `: ${working.caption}` : ''}` : 'Insert plate';
    dialog.appendChild(title);

    const body = document.createElement('div');
    body.className = 'wp-dialog-body';
    const left = document.createElement('div');
    left.className = 'wp-dialog-plate';
    const plateRoot = document.createElement('div');
    const legendRoot = document.createElement('div');
    legendRoot.className = 'wp-legend';
    const hint = document.createElement('p');
    hint.className = 'wp-hint';
    hint.textContent = 'Click or drag to select wells. Click a letter or number to select a row or column. Shift adds to the selection.';
    left.append(plateRoot, legendRoot, hint);

    const side = document.createElement('div');
    side.className = 'wp-dialog-side';
    side.innerHTML = `
      <section><h6>Groups</h6><div class="wp-group-list"></div>
        <div class="wp-row"><input class="form-control form-control-sm wp-new-name" placeholder="New group name" aria-label="New group name" maxlength="60"><button type="button" class="btn btn-sm btn-secondary wp-add-group">Add</button></div>
        <div class="wp-palette" role="group" aria-label="Group colour"></div>
      </section>
      <section><h6 class="wp-selection-title">Selection</h6>
        <p class="wp-hint wp-selection-info"></p>
        <textarea class="form-control form-control-sm wp-contents" rows="3" aria-label="Contents of the selected wells" placeholder="Contents of the selected wells"></textarea>
        <div class="wp-row"><button type="button" class="btn btn-sm btn-secondary wp-apply">Set contents</button>
        <button type="button" class="btn btn-sm btn-secondary wp-clear-group">Remove group</button></div>
      </section>`;
    body.append(left, side);
    dialog.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'wp-dialog-footer';
    const sheetButton = document.createElement('button');
    sheetButton.type = 'button';
    sheetButton.className = 'btn btn-sm btn-secondary';
    sheetButton.textContent = 'Open as spreadsheet';
    sheetButton.title = 'Continue in the general spreadsheet editor (keeps your changes here)';
    const spacer = document.createElement('span');
    spacer.className = 'wp-spacer';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-sm btn-secondary';
    cancelButton.textContent = 'Cancel';
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn-sm btn-primary';
    saveButton.textContent = isEditing ? 'Save' : 'Insert';
    footer.append(sheetButton, spacer, cancelButton, saveButton);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    const groupList = side.querySelector<HTMLElement>('.wp-group-list');
    const newName = side.querySelector<HTMLInputElement>('.wp-new-name');
    const palette = side.querySelector<HTMLElement>('.wp-palette');
    const selectionTitle = side.querySelector<HTMLElement>('.wp-selection-title');
    const selectionInfo = side.querySelector<HTMLElement>('.wp-selection-info');
    const contents = side.querySelector<HTMLTextAreaElement>('.wp-contents');
    if (!groupList || !newName || !palette || !selectionTitle || !selectionInfo || !contents) {
      reject(new Error('well plate dialog could not be built'));
      return;
    }

    const eachSelected = (action: (row: number, col: number) => void): void => {
      selected.forEach(key => {
        const [row, col] = key.split(',').map(Number);
        action(row, col);
      });
    };

    const assignColor = (color: string | null): void => {
      eachSelected((row, col) => setWellColor(working, row, col, color));
      paint();
    };

    const paintPalette = (): void => {
      palette.replaceChildren();
      PALETTE.forEach(color => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'wp-swatch';
        swatch.style.background = color;
        swatch.title = color;
        swatch.setAttribute('aria-label', `Colour ${color}`);
        swatch.setAttribute('aria-pressed', String(color === activeColor));
        swatch.addEventListener('click', () => {
          activeColor = color;
          paintPalette();
        });
        palette.appendChild(swatch);
      });
    };

    const paintGroups = (): void => {
      groupList.replaceChildren();
      groupsWithCounts(working).forEach(group => {
        const row = document.createElement('div');
        row.className = 'wp-group';
        const color = document.createElement('input');
        color.type = 'color';
        color.value = /^#[0-9a-f]{6}$/.test(group.color) ? group.color : '#7d8499';
        color.className = 'wp-group-color';
        color.title = 'Change this group\'s colour';
        color.addEventListener('change', () => {
          const next = normalizeColor(color.value);
          for (let r = 0; r < working.rows; r++) {
            for (let c = 0; c < working.cols; c++) {
              if (wellColor(working, r, c) === group.color) setWellColor(working, r, c, next);
            }
          }
          working.plateGroups = groupsWithCounts(working).map(entry => ({
            name: entry.color === next && entry.name === group.name ? group.name : entry.name,
            color: entry.color === group.color ? next : entry.color,
          }));
          paint();
        });
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'wp-group-name';
        name.value = group.name;
        name.maxLength = 60;
        name.setAttribute('aria-label', 'Group name');
        name.addEventListener('change', () => {
          const next = name.value.trim() || group.color;
          working.plateGroups = groupsWithCounts(working).map(entry => ({
            name: entry.color === group.color ? next : entry.name,
            color: entry.color,
          }));
          paint();
        });
        const count = document.createElement('span');
        count.className = 'wp-group-count';
        count.textContent = String(group.count);
        const assign = document.createElement('button');
        assign.type = 'button';
        assign.className = 'btn btn-sm btn-secondary';
        assign.textContent = selected.size > 0 ? 'Assign' : 'Select';
        assign.title = selected.size > 0 ? 'Put the selected wells in this group' : 'Select all wells of this group';
        assign.addEventListener('click', () => {
          if (selected.size > 0) {
            assignColor(group.color);
            return;
          }
          selected = new Set();
          for (let r = 0; r < working.rows; r++) {
            for (let c = 0; c < working.cols; c++) {
              if (wellColor(working, r, c) === group.color) selected.add(wellKey(r, c));
            }
          }
          paint();
        });
        row.append(color, name, count, assign);
        groupList.appendChild(row);
      });
    };

    const paintSelection = (): void => {
      selectionTitle.textContent = selected.size > 0 ? `Selection (${selected.size})` : 'Selection';
      const names = Array.from(selected).slice(0, 8).map(key => {
        const [row, col] = key.split(',').map(Number);
        return wellName(row, col);
      });
      selectionInfo.textContent = selected.size === 0
        ? 'Select wells to assign a group or set their contents.'
        : `${names.join(', ')}${selected.size > 8 ? ', …' : ''}`;
      const values = new Set<string>();
      eachSelected((row, col) => values.add(String(working.data[row]?.[col] ?? '')));
      contents.value = values.size === 1 ? Array.from(values)[0] : '';
      contents.placeholder = values.size > 1 ? '(different contents)' : 'Contents of the selected wells';
      contents.disabled = selected.size === 0;
      side.querySelectorAll<HTMLButtonElement>('.wp-apply, .wp-clear-group').forEach(button => {
        button.disabled = selected.size === 0;
      });
    };

    function paint(): void {
      renderPlate(plateRoot, working, { popup: true, selected, dimmed });
      renderLegend(legendRoot, working, dimmed, color => {
        if (dimmed.has(color)) dimmed.delete(color);
        else dimmed.add(color);
        paint();
      });
      paintGroups();
      paintSelection();
    }

    const rectangle = (from: [number, number], to: [number, number]): Set<string> => {
      const keys = new Set<string>();
      for (let r = Math.min(from[0], to[0]); r <= Math.max(from[0], to[0]); r++) {
        for (let c = Math.min(from[1], to[1]); c <= Math.max(from[1], to[1]); c++) keys.add(wellKey(r, c));
      }
      return keys;
    };

    plateRoot.addEventListener('mousedown', event => {
      const target = event.target as Element;
      const well = target.closest<HTMLElement>('.wp-well');
      const label = target.closest<HTMLElement>('.wp-label');
      const base = event.shiftKey ? new Set(selected) : new Set<string>();
      if (well) {
        event.preventDefault();
        anchor = [Number(well.dataset.row), Number(well.dataset.col)];
        dragging = true;
        selected = new Set([...base, wellKey(anchor[0], anchor[1])]);
        paint();
      } else if (label?.dataset.row !== undefined) {
        const row = Number(label.dataset.row);
        selected = new Set([...base, ...rectangle([row, 0], [row, working.cols - 1])]);
        paint();
      } else if (label?.dataset.col !== undefined) {
        const col = Number(label.dataset.col);
        selected = new Set([...base, ...rectangle([0, col], [working.rows - 1, col])]);
        paint();
      }
    });
    plateRoot.addEventListener('mouseover', event => {
      if (!dragging || !anchor) return;
      const well = (event.target as Element).closest<HTMLElement>('.wp-well');
      if (!well) return;
      const next = rectangle(anchor, [Number(well.dataset.row), Number(well.dataset.col)]);
      if (next.size === selected.size && Array.from(next).every(key => selected.has(key))) return;
      selected = next;
      // Update classes in place: a full repaint here would replace the element under the pointer mid-drag.
      plateRoot.querySelectorAll<HTMLElement>('.wp-well').forEach(el => {
        el.classList.toggle('is-selected', selected.has(wellKey(Number(el.dataset.row), Number(el.dataset.col))));
      });
    });
    const endDrag = (): void => {
      if (!dragging) return;
      dragging = false;
      paint();
    };
    document.addEventListener('mouseup', endDrag);

    side.querySelector('.wp-add-group')?.addEventListener('click', () => {
      const name = newName.value.trim();
      if (!name) {
        newName.focus();
        return;
      }
      const color = normalizeColor(activeColor);
      working.plateGroups = [
        ...groupsWithCounts(working).filter(group => group.color !== color).map(({ name: n, color: c }) => ({ name: n, color: c })),
        { name, color },
      ];
      newName.value = '';
      if (selected.size > 0) assignColor(color);
      else paint();
    });
    newName.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        side.querySelector<HTMLButtonElement>('.wp-add-group')?.click();
      }
    });
    side.querySelector('.wp-apply')?.addEventListener('click', () => {
      eachSelected((row, col) => {
        working.data[row][col] = contents.value;
      });
      paint();
    });
    side.querySelector('.wp-clear-group')?.addEventListener('click', () => assignColor(null));

    const close = (): void => {
      document.removeEventListener('mouseup', endDrag);
      document.removeEventListener('keydown', onKey, true);
      hideTooltip();
      overlay.remove();
    };
    const result = (openSpreadsheet: boolean): WellPlateModalResult => ({
      raw: normalizeSpreadsheetData({ ...working, displayData: undefined }),
      openSpreadsheet,
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) {
        event.stopPropagation();
        close();
        reject(new Error('cancelled'));
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancelButton.addEventListener('click', () => {
      close();
      reject(new Error('cancelled'));
    });
    saveButton.addEventListener('click', () => {
      close();
      resolve(result(false));
    });
    sheetButton.addEventListener('click', () => {
      close();
      resolve(result(true));
    });

    paintPalette();
    paint();
    document.body.appendChild(overlay);
    dialog.focus({ preventScroll: true });
  });
}
