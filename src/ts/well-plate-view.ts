/**
 * This file is part of the eLabFTW fork's customizations.
 *
 * A compact, interactive view of a well plate: coloured wells with the contents shown on hover, named colour
 * groups, and a popup to select wells and change their group or contents. The data stays an ordinary
 * spreadsheet (one cell per well); a well's group is the background colour of its cell, so the spreadsheet
 * popup, printing and this view always agree.
 */
import { read, utils } from '@e965/xlsx';
import {
  createWellPlateSpreadsheetData,
  SpreadsheetData,
  SpreadsheetHostHandle,
  SpreadsheetHostOptions,
  colLabel,
  normalizeSpreadsheetData,
  registerSpreadsheetHostData,
  spreadsheetToHTML,
  WELL_PLATE_PRESETS,
} from './inline-spreadsheet';
import { RICH_SELECTION_ATTRIBUTE } from './ClipboardContent';

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
    if (!named.some(group => group.color === color)) result.push({ name: '', color, count });
  });
  return result;
}

function groupNameFor(data: SpreadsheetData, color: string | null): string | null {
  if (!color) return null;
  return groupsWithCounts(data).find(group => group.color === color)?.name ?? '';
}

function wellValue(data: SpreadsheetData, row: number, col: number): string {
  const shown = data.displayData?.[row]?.[col] ?? data.data[row]?.[col] ?? '';
  return String(shown);
}

// More colours than the palette offers, so a column with many values still gets distinct groups.
const GROUP_COLORS = [...PALETTE, '#0b7285', '#a61e4d', '#5f3dc4', '#868e96', '#2b8a3e', '#c2255c', '#1864ab', '#e67700'];

function colorForIndex(index: number): string {
  if (index < GROUP_COLORS.length) return GROUP_COLORS[index];
  const hue = (index * 47) % 360;
  const channel = (n: number): string => {
    const k = (n + hue / 30) % 12;
    const value = 0.5 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Colours the wells by a column of the plate's table (a dynamic group): one group per distinct value. */
export function regroupByColumn(data: SpreadsheetData, column: string | null): void {
  const index = column && data.plateTable ? data.plateTable.columns.indexOf(column) : -1;
  if (!column || !data.plateTable || index < 0) {
    data.plateGroupBy = undefined;
    return;
  }
  const valueOf = (row: number, col: number): string => (data.plateTable?.rows[wellName(row, col)]?.[index] ?? '').trim();
  const known = new Map((data.plateGroups ?? []).map(group => [group.name, normalizeColor(group.color)]));
  const order: string[] = [];
  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      const value = valueOf(row, col);
      if (value && !order.includes(value)) order.push(value);
    }
  }
  // a value keeps the colour it already had; new values take the next colour not in use
  const used = new Set<string>();
  const colors = new Map<string, string>();
  order.forEach(value => {
    const previous = known.get(value);
    if (previous && !used.has(previous)) {
      colors.set(value, previous);
      used.add(previous);
    }
  });
  let next = 0;
  order.forEach(value => {
    if (colors.has(value)) return;
    while (used.has(colorForIndex(next))) next++;
    colors.set(value, colorForIndex(next));
    used.add(colorForIndex(next));
  });
  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      const value = valueOf(row, col);
      setWellColor(data, row, col, value ? colors.get(value) ?? null : null);
    }
  }
  data.plateGroups = order.map(value => ({ name: value, color: colors.get(value) ?? '#7d8499' }));
  data.plateGroupBy = column;
}

/** Writes the value of a table column into each well's cell: the text shown in the spreadsheet view of the plate. */
export function labelWellsByColumn(data: SpreadsheetData, column: string | null): void {
  const index = column && data.plateTable ? data.plateTable.columns.indexOf(column) : -1;
  if (!column || !data.plateTable || index < 0) {
    data.plateLabelBy = undefined;
    return;
  }
  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      data.data[row][col] = data.plateTable.rows[wellName(row, col)]?.[index] ?? '';
    }
  }
  data.displayData = data.data.map(row => [...row]);
  data.plateLabelBy = column;
}

/** Re-applies the column choices (colour and label) after the table or the choices changed. */
export function applyPlateColumns(data: SpreadsheetData): void {
  if (data.plateGroupBy) regroupByColumn(data, data.plateGroupBy);
  if (data.plateLabelBy) labelWellsByColumn(data, data.plateLabelBy);
}

function wellSize(data: SpreadsheetData, popup: boolean): number {
  const count = data.rows * data.cols;
  // Every plate up to 96 wells is as wide as the 96-well plate (12 columns of 36 px wells and 4 px gaps): the fewer
  // columns, the bigger the wells. A 384-well plate keeps small wells and is wider than that.
  const wideEnough = 12 * (36 + 4);
  const base = count > 96 ? 21 : Math.round(wideEnough / Math.max(1, data.cols) - 4);
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
  if (color) {
    const line = document.createElement('div');
    line.className = 'wp-tooltip-group';
    const dot = document.createElement('i');
    dot.className = 'wp-dot';
    dot.style.background = color;
    line.append(dot);
    if (group) line.append(document.createTextNode(group));
    tooltipEl.appendChild(line);
  }
  const body = document.createElement('div');
  body.className = 'wp-tooltip-body';
  body.textContent = value === '' ? 'empty' : (value.length > 300 ? `${value.slice(0, 300)}…` : value);
  if (value === '') body.classList.add('is-empty');
  tooltipEl.appendChild(body);
  const tableCells = data.plateTable?.rows[wellName(row, col)];
  data.plateTable?.columns.forEach((column, index) => {
    const extra = tableCells?.[index]?.trim();
    if (!extra) return;
    const line = document.createElement('div');
    line.className = 'wp-tooltip-extra';
    line.textContent = `${column}: ${extra}`;
    tooltipEl?.appendChild(line);
  });
  if (value === '' && tableCells?.some(cell => cell.trim() !== '')) body.remove();
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
  size?: number;
}

/** Draws the plate (lettered rows, numbered columns, round wells) into `root`. */
function renderPlate(root: HTMLElement, data: SpreadsheetData, options: PlateOptions): void {
  const size = options.size ?? wellSize(data, options.popup);
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
    text.textContent = `${group.name || 'Unnamed'} (${group.count})`;
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

/** The small "Plate | Spreadsheet" switch in a plate's title bar. */
export function createPlateViewSwitch(active: 'plate' | 'sheet', onPlate: () => void, onSheet: () => void): HTMLElement {
  const group = document.createElement('span');
  group.className = 'wp-view-switch';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'View');
  ([['plate', 'Plate', onPlate], ['sheet', 'Spreadsheet', onSheet]] as const).forEach(([name, label, action]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.classList.toggle('is-active', name === active);
    button.setAttribute('aria-pressed', String(name === active));
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (name !== active) action();
    });
    group.appendChild(button);
  });
  return group;
}

/**
 * Puts the whole plate on the clipboard the way the spreadsheet's copy button does: tab-separated text (a header row
 * of column numbers, then one row per plate row with its letter and the content of each well) and the plate as an editor table
 * (all its data and group colours), so pasting into the main text recreates the well plate.
 */
function copyPlateToClipboard(data: SpreadsheetData): void {
  const textCell = (text: string): string => (/[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
  const numbers = Array.from({ length: data.cols }, (_, col) => String(col + 1));
  const textRows = [['', ...numbers].join('\t')];
  for (let row = 0; row < data.rows; row++) {
    const values: string[] = [];
    for (let col = 0; col < data.cols; col++) {
      const value = wellValue(data, row, col).trim();
      values.push(textCell(value));
    }
    textRows.push([colLabel(row), ...values].join('\t'));
  }
  const plain = textRows.join('\n');
  // The plate itself, with all its data, marked as an editor copy: pasting it into the main text makes a new well
  // plate, while other programs see an ordinary coloured table.
  const html = `<div ${RICH_SELECTION_ATTRIBUTE}="true">${spreadsheetToHTML(data, data.displayData ?? data.data)}</div>`;
  const writePlain = (): void => { navigator.clipboard?.writeText(plain)?.catch(() => undefined); };
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    writePlain();
    return;
  }
  navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([plain], { type: 'text/plain' }),
  })]).catch(writePlain);
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
  const titleEl = document.createElement('span');
  titleEl.className = 'elabftw-spreadsheet-title';
  const showTitle = (): void => {
    titleEl.textContent = data.caption ?? '';
    titleEl.title = data.caption ?? '';
    titleEl.hidden = !data.caption;
  };
  showTitle();
  toggleBar.appendChild(titleEl);
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
  if (options.onChange) {
    // Edit the title in place (the same box the spreadsheet grid uses); saved like any other edit.
    addButton('elabftw-spreadsheet-readonly-edit-title', 'Edit the plate title', 'fa-heading', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'elabftw-spreadsheet-title-input';
      input.maxLength = 120;
      input.value = data.caption ?? '';
      input.setAttribute('aria-label', 'Plate title');
      titleEl.hidden = true;
      titleEl.after(input);
      let finished = false;
      const finish = (commit: boolean): void => {
        if (finished) return;
        finished = true;
        const title = input.value.replace(/\s+/g, ' ').trim();
        input.remove();
        if (commit && title !== (data.caption ?? '')) {
          data.caption = title;
          options.onChange?.(data);
        }
        showTitle();
      };
      ['keydown', 'keyup', 'keypress'].forEach(type => input.addEventListener(type, keyEvent => {
        keyEvent.stopPropagation();
        if (type !== 'keydown') return;
        const key = (keyEvent as KeyboardEvent).key;
        if (key === 'Enter') {
          keyEvent.preventDefault();
          finish(true);
        } else if (key === 'Escape') {
          keyEvent.preventDefault();
          finish(false);
        }
      }));
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('mousedown', mouseEvent => mouseEvent.stopPropagation());
      input.focus();
      input.select();
    });
  }
  let repaintPlate: () => void = () => undefined;
  const tableColumns = data.plateTable?.columns ?? [];
  // On a view page (no onChange) colours and labels can still be switched, on a working copy that is never saved.
  let shown: SpreadsheetData = data;
  if (!options.onChange && tableColumns.length > 0) {
    const chosen: { colour: string; label: string } = { colour: '', label: '' };
    const refresh = (): void => {
      shown = data;
      if (chosen.colour || chosen.label) {
        shown = structuredClone(data);
        if (chosen.colour) regroupByColumn(shown, chosen.colour);
        if (chosen.label) labelWellsByColumn(shown, chosen.label);
      }
      // another colouring has other colours, so a dimmed colour from the previous one means nothing
      dimmed.clear();
      repaintPlate();
    };
    const addViewChoice = (label: string, title: string, savedText: string, current: string | undefined, key: 'colour' | 'label'): void => {
      const wrap = document.createElement('label');
      wrap.className = 'wp-choice';
      wrap.title = title;
      wrap.append(document.createTextNode(`${label} `));
      const select = document.createElement('select');
      select.setAttribute('aria-label', label);
      const saved = document.createElement('option');
      saved.value = '';
      saved.textContent = savedText;
      select.appendChild(saved);
      tableColumns.forEach(column => {
        const option = document.createElement('option');
        option.value = column;
        option.textContent = column || '(unnamed column)';
        select.appendChild(option);
      });
      select.value = current && tableColumns.includes(current) ? current : '';
      chosen[key] = select.value;
      select.addEventListener('mousedown', event => event.stopPropagation());
      select.addEventListener('change', () => {
        chosen[key] = select.value;
        refresh();
      });
      wrap.addEventListener('click', event => event.stopPropagation());
      wrap.appendChild(select);
      toggleBar.appendChild(wrap);
    };
    addViewChoice('Colour by', 'Colour the wells by the values of a column of the plate table (only for viewing, nothing is saved)', 'Saved colours', data.plateGroupBy, 'colour');
    addViewChoice('Label by', 'Show the values of a column of the plate table as the text of each well when hovering (only for viewing, nothing is saved)', 'Saved labels', data.plateLabelBy, 'label');
  }
  if (options.onChange && tableColumns.length > 0) {
    // Colour and label the wells by any column of the plate's table; saved like any other edit.
    const addChoice = (label: string, title: string, manualText: string, current: string | undefined, apply: (column: string) => void, clear: () => void): void => {
      const wrap = document.createElement('label');
      wrap.className = 'wp-choice';
      wrap.title = title;
      wrap.append(document.createTextNode(`${label} `));
      const select = document.createElement('select');
      select.setAttribute('aria-label', label);
      const manual = document.createElement('option');
      manual.value = '';
      manual.textContent = manualText;
      select.appendChild(manual);
      tableColumns.forEach(column => {
        const option = document.createElement('option');
        option.value = column;
        option.textContent = column || '(unnamed column)';
        select.appendChild(option);
      });
      select.value = current && tableColumns.includes(current) ? current : '';
      select.addEventListener('mousedown', event => event.stopPropagation());
      select.addEventListener('change', () => {
        if (select.value) apply(select.value);
        else clear();
        data.displayData = data.data.map(row => [...row]);
        options.onChange?.(data);
        repaintPlate();
      });
      wrap.appendChild(select);
      wrap.addEventListener('click', event => event.stopPropagation());
      toggleBar.appendChild(wrap);
    };
    addChoice('Colour by', 'Colour the wells by the values of a column of the plate table (one group per value)', 'Manual', data.plateGroupBy, column => regroupByColumn(data, column), () => {
      data.plateGroupBy = undefined;
    });
    addChoice('Label by', 'Show the values of a column of the plate table as the text of each well (visible in the spreadsheet view)', 'Typed', data.plateLabelBy, column => labelWellsByColumn(data, column), () => {
      data.plateLabelBy = undefined;
    });
  }
  addButton('elabftw-spreadsheet-readonly-copy-table', 'Copy the whole plate', 'fa-copy', () => copyPlateToClipboard(shown));
  if (options.onShowSheet) toggleBar.appendChild(createPlateViewSwitch('plate', () => undefined, options.onShowSheet));
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
    renderPlate(plate, shown, { popup: false, dimmed, onClick: options.onOpenFullEditor });
    renderLegend(legend, shown, dimmed, color => {
      if (dimmed.has(color)) dimmed.delete(color);
      else dimmed.add(color);
      paint();
    });
  };
  paint();
  repaintPlate = paint;
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

const tableCellText = (value: unknown): string => String(value ?? '').trim();

/** The plate table as a data table (header row, then one row per well) for the general spreadsheet popup. */
export function plateTableAsSpreadsheet(plate: SpreadsheetData): SpreadsheetData {
  const wells: string[] = [];
  for (let row = 0; row < plate.rows; row++) {
    for (let col = 0; col < plate.cols; col++) wells.push(wellName(row, col));
  }
  const columns = plate.plateTable?.columns ?? ['Sample', 'Condition'];
  let grid: string[][];
  if (plate.plateTableSource && plate.plateTableSource.length > 0) {
    grid = plate.plateTableSource.map(row => [...row]);
  } else {
    grid = [['Well ID', ...columns], ...wells.map(well => [well, ...columns.map((_, index) => plate.plateTable?.rows[well]?.[index] ?? '')])];
  }
  const cols = Math.max(2, grid.reduce((max, row) => Math.max(max, row.length), 0));
  grid = grid.map(row => Array.from({ length: cols }, (_, index) => row[index] ?? ''));
  return {
    data: grid,
    rows: grid.length,
    cols,
    kind: 'notebook',
    caption: plate.caption ? `${plate.caption}: table` : 'Plate table',
  };
}

/** Puts an edited plate table back on the plate: the results become the table, the raw cells (formulas) are kept. */
export function applyTableToPlate(plate: SpreadsheetData, raw: SpreadsheetData['data'], computed: SpreadsheetData['data']): SpreadsheetData {
  const next = normalizeSpreadsheetData({ ...plate, displayData: undefined });
  const header = (computed[0] ?? []).map(tableCellText);
  const names = header.slice(1).map((name, index) => name || `Column ${index + 1}`);
  const rows: Record<string, string[]> = {};
  computed.slice(1).forEach(cells => {
    const well = parseWellId(tableCellText(cells[0]));
    if (!well || well[0] >= next.rows || well[1] >= next.cols) return;
    rows[wellName(well[0], well[1])] = names.map((_, index) => tableCellText(cells[index + 1]));
  });
  next.plateTable = names.length > 0 ? { columns: names, rows } : undefined;
  next.plateTableSource = raw.map(row => row.map(cell => String(cell ?? '')));
  if (next.plateGroupBy && !names.includes(next.plateGroupBy)) next.plateGroupBy = undefined;
  if (next.plateLabelBy && !names.includes(next.plateLabelBy)) next.plateLabelBy = undefined;
  applyPlateColumns(next);
  return normalizeSpreadsheetData(next);
}

export interface WellPlateModalResult {
  raw: SpreadsheetData;
  /** True when the person asked to continue in the general spreadsheet popup. */
  openSpreadsheet: boolean;
  /** True when the person asked for the plate table as a spreadsheet. */
  openTable: boolean;
}

/** The plate popup: select wells (drag, row/column headers, shift), then set group, colour or contents. */
export function openWellPlateModal(initial: SpreadsheetData, isEditing: boolean): Promise<WellPlateModalResult> {
  return new Promise((resolve, reject) => {
    const working = normalizeSpreadsheetData({
      ...initial,
      data: initial.data.map(row => [...row]),
      cellStyles: { ...(initial.cellStyles ?? {}) },
      plateGroups: (initial.plateGroups ?? []).map(group => ({ ...group })),
      plateTable: initial.plateTable ? JSON.parse(JSON.stringify(initial.plateTable)) : undefined,
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
    hint.textContent = 'Click or drag to select wells. Ctrl/Cmd-click toggles wells, Shift-click extends from the last well. Click a letter or number for a row or column.';
    left.append(plateRoot, legendRoot, hint);

    // Plate | Table: the table opens as a full spreadsheet (formulas, selection, insert and delete rows or columns).
    const modeBar = document.createElement('div');
    modeBar.className = 'wp-mode-bar';
    const plateTab = document.createElement('button');
    plateTab.type = 'button';
    plateTab.textContent = 'Plate';
    plateTab.classList.add('is-active');
    plateTab.setAttribute('aria-pressed', 'true');
    const tableTab = document.createElement('button');
    tableTab.type = 'button';
    tableTab.textContent = 'Table';
    tableTab.title = 'Open the plate table as a spreadsheet (keeps your changes here)';
    tableTab.setAttribute('aria-pressed', 'false');
    modeBar.append(plateTab, tableTab);
    dialog.appendChild(modeBar);

    const side = document.createElement('div');
    side.className = 'wp-dialog-side';
    side.innerHTML = `
      <section class="wp-box wp-box-selection" hidden><h6 class="wp-selection-title">Selection</h6>
        <p class="wp-hint wp-selection-info"></p>
        <textarea class="form-control form-control-sm wp-contents" rows="3" aria-label="Contents of the selected wells" placeholder="Contents of the selected wells"></textarea>
        <div class="wp-row"><button type="button" class="btn btn-sm btn-secondary wp-apply">Set contents</button>
        <button type="button" class="btn btn-sm btn-secondary wp-clear-group">Remove group</button></div>
      </section>
      <section class="wp-box"><h6>Colour wells by</h6>
        <select class="form-control form-control-sm wp-groupby" aria-label="Colour wells by"></select>
        <p class="wp-hint wp-groupby-hint"></p>
      </section>
      <section class="wp-box"><h6>Label wells by</h6>
        <select class="form-control form-control-sm wp-labelby" aria-label="Label wells by"></select>
        <p class="wp-hint wp-labelby-hint"></p>
      </section>
      <section class="wp-box wp-box-groups"><h6>Groups</h6><div class="wp-group-list"></div>
        <p class="wp-hint">With wells selected, press Assign to put them in a group.</p>
      </section>
      <section class="wp-box wp-box-new"><h6>Create a new group</h6>
        <input class="form-control form-control-sm wp-new-name" placeholder="Group name" aria-label="New group name" maxlength="60">
        <div class="wp-palette" role="group" aria-label="Group colour"></div>
        <div class="wp-row"><button type="button" class="btn btn-sm btn-primary wp-add-group">Create group</button></div>
        <p class="wp-hint">Only creates the group. Assign wells from the list above.</p>
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
    const selectionBox = side.querySelector<HTMLElement>('.wp-box-selection');
    const selectionInfo = side.querySelector<HTMLElement>('.wp-selection-info');
    const groupBySelect = side.querySelector<HTMLSelectElement>('.wp-groupby');
    const groupByHint = side.querySelector<HTMLElement>('.wp-groupby-hint');
    const labelBySelect = side.querySelector<HTMLSelectElement>('.wp-labelby');
    const labelByHint = side.querySelector<HTMLElement>('.wp-labelby-hint');
    const contents = side.querySelector<HTMLTextAreaElement>('.wp-contents');
    if (!groupList || !newName || !palette || !selectionTitle || !selectionBox || !selectionInfo || !contents || !groupBySelect || !groupByHint || !labelBySelect || !labelByHint) {
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
        color.tabIndex = -1;
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
        name.readOnly = !!working.plateGroupBy;
        name.placeholder = 'Group name';
        name.addEventListener('change', () => {
          const next = name.value.trim();
          working.plateGroups = groupsWithCounts(working).map(entry => ({
            name: entry.color === group.color ? next : entry.name,
            color: entry.color,
          }));
          // Not a full repaint: rebuilding the list here would drop the focus Tab just moved to the next name.
          renderLegend(legendRoot, working, dimmed, color => {
            if (dimmed.has(color)) dimmed.delete(color);
            else dimmed.add(color);
            paint();
          });
        });
        const count = document.createElement('span');
        count.className = 'wp-group-count';
        count.textContent = String(group.count);
        const assign = document.createElement('button');
        assign.type = 'button';
        assign.className = 'btn btn-sm btn-secondary';
        assign.textContent = selected.size > 0 ? 'Assign' : 'Select';
        assign.tabIndex = -1;
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
        if (working.plateGroupBy) row.append(color, name, count);
        else row.append(color, name, count, assign);
        groupList.appendChild(row);
      });
    };

    const paintSelection = (): void => {
      // the selection box is only there while wells are selected
      selectionBox.hidden = selected.size === 0;
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
      contents.disabled = selected.size === 0 || !!working.plateLabelBy;
      side.querySelectorAll<HTMLButtonElement>('.wp-apply, .wp-clear-group').forEach(button => {
        button.disabled = selected.size === 0 || (!!working.plateLabelBy && button.classList.contains('wp-apply'));
      });
    };

    const paintGroupBy = (): void => {
      const columns = working.plateTable?.columns ?? [];
      groupBySelect.replaceChildren();
      const manual = document.createElement('option');
      manual.value = '';
      manual.textContent = 'Manual (colours set by hand)';
      groupBySelect.appendChild(manual);
      columns.forEach(column => {
        const option = document.createElement('option');
        option.value = column;
        option.textContent = column || '(unnamed column)';
        groupBySelect.appendChild(option);
      });
      groupBySelect.value = working.plateGroupBy && columns.includes(working.plateGroupBy) ? working.plateGroupBy : '';
      groupByHint.textContent = columns.length === 0
        ? 'Add columns in the Table tab to colour the wells by them.'
        : working.plateGroupBy
          ? `One group for each value of "${working.plateGroupBy}". Edit the Table tab to change them.`
          : 'Colours are set by hand. Pick a column to colour by its values.';
      side.classList.toggle('is-dynamic', !!working.plateGroupBy);
      labelBySelect.replaceChildren();
      const typed = document.createElement('option');
      typed.value = '';
      typed.textContent = 'Typed by hand';
      labelBySelect.appendChild(typed);
      columns.forEach(column => {
        const option = document.createElement('option');
        option.value = column;
        option.textContent = column || '(unnamed column)';
        labelBySelect.appendChild(option);
      });
      labelBySelect.value = working.plateLabelBy && columns.includes(working.plateLabelBy) ? working.plateLabelBy : '';
      labelByHint.textContent = working.plateLabelBy
        ? `Each well shows its "${working.plateLabelBy}" value in the spreadsheet view. Contents can no longer be typed per well.`
        : 'The text each well shows in the spreadsheet view. Pick a column of the table, or type it per well.';
      contents.disabled = selected.size === 0 || !!working.plateLabelBy;
    };
    labelBySelect.addEventListener('change', () => {
      if (labelBySelect.value) labelWellsByColumn(working, labelBySelect.value);
      else working.plateLabelBy = undefined;
      paint();
    });
    groupBySelect.addEventListener('change', () => {
      if (groupBySelect.value) regroupByColumn(working, groupBySelect.value);
      else working.plateGroupBy = undefined;
      selected = new Set();
      paint();
    });

    function paint(): void {
      // the colours and labels follow the table columns they are set from
      applyPlateColumns(working);
      paintGroupBy();
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

    // Selection like a file list: plain click replaces, Ctrl/Cmd toggles (and drags add or remove a block),
    // Shift extends from the last clicked well.
    let baseSelection = new Set<string>();
    let dragMode: 'add' | 'remove' = 'add';
    const applyBlock = (to: [number, number]): void => {
      if (!anchor) return;
      const block = rectangle(anchor, to);
      selected = new Set(baseSelection);
      block.forEach(key => {
        if (dragMode === 'remove') selected.delete(key);
        else selected.add(key);
      });
    };
    plateRoot.addEventListener('contextmenu', event => {
      // Ctrl+click opens the context menu on a Mac; it is a selection gesture here.
      if (event.ctrlKey) event.preventDefault();
    });
    plateRoot.addEventListener('mousedown', event => {
      const target = event.target as Element;
      const well = target.closest<HTMLElement>('.wp-well');
      const label = target.closest<HTMLElement>('.wp-label');
      const toggle = event.ctrlKey || event.metaKey;
      if (well) {
        event.preventDefault();
        const position: [number, number] = [Number(well.dataset.row), Number(well.dataset.col)];
        if (event.shiftKey && anchor) {
          dragMode = 'add';
        } else {
          baseSelection = toggle ? new Set(selected) : new Set<string>();
          anchor = position;
          dragMode = toggle && baseSelection.has(wellKey(position[0], position[1])) ? 'remove' : 'add';
        }
        dragging = true;
        applyBlock(position);
        paint();
      } else if (label?.dataset.row !== undefined || label?.dataset.col !== undefined) {
        const keys = label.dataset.row !== undefined
          ? rectangle([Number(label.dataset.row), 0], [Number(label.dataset.row), working.cols - 1])
          : rectangle([0, Number(label.dataset.col)], [working.rows - 1, Number(label.dataset.col)]);
        const extend = event.shiftKey || toggle;
        const allIn = Array.from(keys).every(key => selected.has(key));
        selected = extend ? new Set(selected) : new Set<string>();
        keys.forEach(key => {
          if (toggle && allIn) selected.delete(key);
          else selected.add(key);
        });
        paint();
      }
    });
    plateRoot.addEventListener('mouseover', event => {
      if (!dragging || !anchor) return;
      const well = (event.target as Element).closest<HTMLElement>('.wp-well');
      if (!well) return;
      const before = selected;
      applyBlock([Number(well.dataset.row), Number(well.dataset.col)]);
      if (before.size === selected.size && Array.from(selected).every(key => before.has(key))) return;
      // Update classes in place: a full repaint here would replace the element under the pointer mid-drag.
      plateRoot.querySelectorAll<HTMLElement>('.wp-well').forEach(el => {
        el.classList.toggle('is-selected', selected.has(wellKey(Number(el.dataset.row), Number(el.dataset.col))));
      });
    });
    // a click anywhere else in the dialog's body, outside the plate's wells and the side panel, drops the selection
    body.addEventListener('mousedown', event => {
      const target = event.target as Element;
      if (selected.size === 0 || target.closest('.wp-well, .wp-label, .wp-dialog-side')) return;
      selected = new Set();
      anchor = null;
      paint();
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
      paint();
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
    const result = (openSpreadsheet: boolean, openTable = false): WellPlateModalResult => ({
      raw: (() => {
        applyPlateColumns(working);
        return normalizeSpreadsheetData({ ...working, displayData: undefined });
      })(),
      openSpreadsheet,
      openTable,
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

    tableTab.addEventListener('click', () => {
      close();
      resolve(result(false, true));
    });

    paintPalette();
    paint();
    document.body.appendChild(overlay);
    dialog.focus({ preventScroll: true });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Insert a plate from a file (CSV, TSV or XLSX): a table with one row per well and a column of well IDs.
// ---------------------------------------------------------------------------------------------------------------

const WELL_ID = /^([A-Za-z]{1,2})\s*0*(\d{1,2})$/;

function parseWellId(text: string): [number, number] | null {
  const match = WELL_ID.exec(text.trim());
  if (!match) return null;
  const letters = match[1].toUpperCase();
  const row = letters.length === 1 ? letters.charCodeAt(0) - 65 : (letters.charCodeAt(0) - 64) * 26 + (letters.charCodeAt(1) - 65);
  const col = Number(match[2]) - 1;
  return col >= 0 && col < 48 && row >= 0 && row < 32 ? [row, col] : null;
}

function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map(candidate => [candidate, firstLine.split(candidate).length] as const)
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map(cells => cells.map(value => value.trim())).filter(cells => cells.some(value => value !== ''));
}

interface ImportSheet {
  name: string;
  rows: string[][];
}

async function readImportSheets(file: File): Promise<ImportSheet[]> {
  if (/\.(csv|tsv|txt)$/i.test(file.name)) {
    return [{ name: file.name, rows: parseDelimited(await file.text()) }];
  }
  // formatted text (raw: false), so a value such as 01:50 stays as typed
  const book = read(await file.arrayBuffer(), { type: 'array' });
  return book.SheetNames.map(name => ({
    name,
    rows: (utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: '' }) as unknown[][])
      .map(cells => cells.map(value => String(value ?? '').trim()))
      .filter(cells => cells.some(value => value !== '')),
  })).filter(sheet => sheet.rows.length > 1);
}

function detectWellColumn(rows: string[][]): number {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  let best = -1;
  let bestScore = 0;
  header.forEach((name, col) => {
    const filled = body.filter(row => (row[col] ?? '') !== '');
    const hits = filled.filter(row => parseWellId(row[col] ?? '')).length;
    if (filled.length === 0 || hits / filled.length < 0.6) return;
    const score = hits + (/well/i.test(name) ? 0.5 : 0);
    if (score > bestScore) {
      best = col;
      bestScore = score;
    }
  });
  return best;
}

/** The last well row and column used in the file (zero-based; -1 when there are none). */
function wellExtent(rows: string[][], wellColumn: number): [number, number] {
  let maxRow = -1;
  let maxCol = -1;
  rows.slice(1).forEach(row => {
    const well = parseWellId(row[wellColumn] ?? '');
    if (!well) return;
    maxRow = Math.max(maxRow, well[0]);
    maxCol = Math.max(maxCol, well[1]);
  });
  return [maxRow, maxCol];
}

/** The standard plates that are big enough for the wells found, smallest first. */
function fittingPresets(rows: string[][], wellColumn: number): typeof WELL_PLATE_PRESETS {
  const [maxRow, maxCol] = wellExtent(rows, wellColumn);
  return WELL_PLATE_PRESETS.filter(preset => preset.rows > maxRow && preset.cols > maxCol);
}

function buildPlateFromRows(rows: string[][], wellColumn: number, wells: number, title: string, colourBy: string, labelBy: string): SpreadsheetData {
  const preset = WELL_PLATE_PRESETS.find(candidate => candidate.wells === wells) ?? WELL_PLATE_PRESETS[4];
  const data = createWellPlateSpreadsheetData(preset.wells);
  data.caption = title;
  const header = rows[0] ?? [];
  const sourceColumns = header.map((name, index) => index).filter(index => index !== wellColumn);
  const columns = sourceColumns.map(index => header[index] || `Column ${index + 1}`);
  const table: { columns: string[]; rows: Record<string, string[]> } = { columns, rows: {} };
  rows.slice(1).forEach(row => {
    const well = parseWellId(row[wellColumn] ?? '');
    if (!well || well[0] >= preset.rows || well[1] >= preset.cols) return;
    table.rows[wellName(well[0], well[1])] = sourceColumns.map(index => row[index] ?? '');
  });
  data.plateTable = table;
  regroupByColumn(data, colourBy || null);
  labelWellsByColumn(data, labelBy || null);
  return data;
}

/** Reads a table file, detects the well IDs and the plate size, and lets the person confirm or change them. */
export async function openPlateImportDialog(file: File): Promise<SpreadsheetData | null> {
  const sheets = await readImportSheets(file);
  if (sheets.length === 0 || sheets.every(sheet => sheet.rows.length < 2)) {
    throw new Error('The file has no table to read: it needs a header row and one row per well.');
  }
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'inline-spreadsheet-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'inline-spreadsheet-dialog wp-dialog wp-import';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Insert plate from file');
    dialog.tabIndex = -1;
    const title = document.createElement('h5');
    title.textContent = 'Insert plate from file';
    dialog.appendChild(title);
    const body = document.createElement('div');
    body.className = 'wp-import-body';
    const fields = document.createElement('div');
    fields.className = 'wp-import-fields';
    const preview = document.createElement('div');
    preview.className = 'wp-import-preview';
    body.append(fields, preview);
    dialog.appendChild(body);

    const makeField = (label: string, control: HTMLElement): void => {
      const text = document.createElement('span');
      text.textContent = label;
      fields.append(text, control);
    };
    const makeSelect = (): HTMLSelectElement => {
      const select = document.createElement('select');
      select.className = 'form-control form-control-sm';
      return select;
    };
    const fillSelect = (select: HTMLSelectElement, options: Array<[string, string]>, value: string): void => {
      select.replaceChildren();
      options.forEach(([optionValue, text]) => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = text;
        select.appendChild(option);
      });
      select.value = value;
    };

    const fileLine = document.createElement('span');
    makeField('File', fileLine);
    const sheetSelect = makeSelect();
    if (sheets.length > 1) makeField('Sheet', sheetSelect);
    const wellSelect = makeSelect();
    makeField('Well ID column', wellSelect);
    const sizeSelect = makeSelect();
    makeField('Plate size', sizeSelect);
    const colourSelect = makeSelect();
    makeField('Colour wells by', colourSelect);
    const labelSelect = makeSelect();
    makeField('Label wells by', labelSelect);
    const titleInput = document.createElement('input');
    titleInput.className = 'form-control form-control-sm';
    titleInput.maxLength = 120;
    titleInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    makeField('Title', titleInput);
    const info = document.createElement('p');
    info.className = 'wp-hint wp-import-info';
    const previewGrid = document.createElement('div');
    const previewLegend = document.createElement('div');
    previewLegend.className = 'wp-legend wp-legend-column';
    preview.append(previewGrid, previewLegend);
    body.appendChild(info);

    const footer = document.createElement('div');
    footer.className = 'wp-dialog-footer';
    const spacer = document.createElement('span');
    spacer.className = 'wp-spacer';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-sm btn-secondary';
    cancelButton.textContent = 'Cancel';
    const insertButton = document.createElement('button');
    insertButton.type = 'button';
    insertButton.className = 'btn btn-sm btn-primary';
    insertButton.textContent = 'Insert plate';
    footer.append(spacer, cancelButton, insertButton);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    let sheet = sheets[0];
    const distinct = (column: number): number => new Set(sheet.rows.slice(1).map(row => row[column] ?? '').filter(Boolean)).size;
    const chooseDefaultColour = (wellColumn: number): string => {
      const header = sheet.rows[0];
      const candidates = header.map((name, index) => index).filter(index => index !== wellColumn && distinct(index) >= 2 && distinct(index) <= 12);
      const named = candidates.find(index => /^(group|condition|treatment)$/i.test(header[index]));
      const pick = named ?? candidates[0];
      return pick === undefined ? '' : (header[pick] || `Column ${pick + 1}`);
    };

    const load = (): void => {
      const header = sheet.rows[0];
      const wellColumn = detectWellColumn(sheet.rows);
      fileLine.textContent = `${file.name} (${sheet.rows.length - 1} rows, ${header.length} columns)`;
      fillSelect(wellSelect, [['-1', '(none found)'], ...header.map((name, index): [string, string] => [String(index), name || `Column ${index + 1}`])], String(wellColumn));
      const names = header.map((name, index) => name || `Column ${index + 1}`);
      fillSelect(colourSelect, [['', 'Manual (colours set by hand)'], ...names.map((name): [string, string] => [name, name])], chooseDefaultColour(wellColumn));
      fillSelect(labelSelect, [['', 'Typed by hand'], ...names.map((name): [string, string] => [name, name])], '');
      refresh(true);
    };

    const refresh = (resizeChoices: boolean): void => {
      const wellColumn = Number(wellSelect.value);
      const fits = wellColumn >= 0 ? fittingPresets(sheet.rows, wellColumn) : [];
      // The size is always chosen by the person (a half-empty plate is common), never assumed.
      if (resizeChoices || sizeSelect.options.length === 0) {
        fillSelect(sizeSelect, [['', 'Choose the plate size…'], ...fits.map((preset): [string, string] => [String(preset.wells), `${preset.wells}-well plate (${preset.rows} × ${preset.cols})`])], '');
      }
      const ready = wellColumn >= 0 && fits.length > 0 && sizeSelect.value !== '';
      insertButton.disabled = !ready;
      previewGrid.replaceChildren();
      previewLegend.replaceChildren();
      if (wellColumn < 0) {
        info.textContent = 'No column with well IDs such as A1 or B12 was found. Choose the Well ID column above.';
        return;
      }
      if (fits.length === 0) {
        info.textContent = 'The well IDs in this column do not fit a standard plate (up to 16 × 24). Check the Well ID column.';
        return;
      }
      const [lastRow, lastCol] = wellExtent(sheet.rows, wellColumn);
      const found = `Wells up to ${wellName(lastRow, lastCol)} were found (they fit ${fits.map(preset => preset.wells).join(', ')} wells).`;
      if (sizeSelect.value === '') {
        info.textContent = `${found} Choose the size of the plate you used; a partly filled plate is fine.`;
        return;
      }
      const data = buildPlateFromRows(sheet.rows, wellColumn, Number(sizeSelect.value), titleInput.value.trim(), colourSelect.value, labelSelect.value);
      const placed = Object.keys(data.plateTable?.rows ?? {}).length;
      info.textContent = `${placed} of ${sheet.rows.length - 1} rows placed on a ${data.plateSize}-well plate. The other columns become the plate's table.`;
      renderPlate(previewGrid, data, { popup: false, size: data.rows * data.cols > 96 ? 12 : 20 });
      renderLegend(previewLegend, data);
    };

    sheetSelect.addEventListener('change', () => {
      sheet = sheets[Number(sheetSelect.value)];
      load();
    });
    if (sheets.length > 1) fillSelect(sheetSelect, sheets.map((candidate, index): [string, string] => [String(index), candidate.name]), '0');
    wellSelect.addEventListener('change', () => {
      fillSelect(colourSelect, [['', 'Manual (colours set by hand)'], ...Array.from(colourSelect.options).slice(1).map((option): [string, string] => [option.value, option.textContent ?? ''])], colourSelect.value);
      refresh(true);
    });
    [sizeSelect, colourSelect, labelSelect].forEach(select => select.addEventListener('change', () => refresh(false)));
    titleInput.addEventListener('input', () => undefined);

    const close = (): void => {
      document.removeEventListener('keydown', onKey, true);
      hideTooltip();
      overlay.remove();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        resolve(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancelButton.addEventListener('click', () => {
      close();
      resolve(null);
    });
    insertButton.addEventListener('click', () => {
      const wellColumn = Number(wellSelect.value);
      const data = buildPlateFromRows(sheet.rows, wellColumn, Number(sizeSelect.value), titleInput.value.trim(), colourSelect.value, labelSelect.value);
      close();
      resolve(data);
    });
    document.body.appendChild(overlay);
    load();
    dialog.focus({ preventScroll: true });
  });
}
