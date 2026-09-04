/**
 * Insert semantic, linkable dates in the TinyMCE experiment body.
 *
 * A date always has its own stable anchor. With no explicit experiment target,
 * clicking it opens that anchored passage in the current entity. When an
 * experiment is selected, the visible date links to that experiment while its
 * stable id remains available for inbound links.
 */
import type { Editor } from 'tinymce/tinymce';
import { DateTime } from 'luxon';
import { ApiC } from './api';
import { entity } from './getEntity';
import { EntityType } from './interfaces';
import { captureFocus, restoreFocus, trapTabFocus } from './a11y';
import { escapeExtendedQuery, escapeHTML } from './misc';
import { getAccountEditorDefault, saveAccountEditorDefault } from './editor-defaults';

interface ExperimentSearchResult {
  id: number;
  title: string;
  category_title?: string;
  status_title?: string;
}

interface ExperimentTarget {
  id: number;
  title: string;
}

type DateDisplayFormat =
  | 'localized'
  | 'iso'
  | 'compact'
  | 'day-first-dash'
  | 'month-first-dash'
  | 'day-first-slash'
  | 'month-first-slash'
  | 'day-short-month'
  | 'month-short-day'
  | 'day-long-month'
  | 'month-long-day'
  | 'weekday-day-first'
  | 'weekday-month-first'
  | 'month-year'
  | 'custom';

interface DateFormatChoice {
  value: DateDisplayFormat;
  label: string;
}

interface DateInsertDefaults {
  format: DateDisplayFormat;
  customLabel: string;
  asHeading: boolean;
  headingLevel: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

const DATE_REFERENCE_SELECTOR = 'a.elabftw-date-reference';
const DATE_FORMAT_STORAGE_KEY = 'elabftw-date-display-format';
const DATE_DEFAULTS_STORAGE_KEY = 'elabftw-date-insert-defaults-v1';
const DATE_FORMAT_CHOICES: DateFormatChoice[] = [
  { value: 'localized', label: 'Localized date' },
  { value: 'iso', label: 'ISO (year-month-day)' },
  { value: 'compact', label: 'Compact (YYYYMMDD)' },
  { value: 'day-first-dash', label: 'Day first with dashes' },
  { value: 'month-first-dash', label: 'Month first with dashes' },
  { value: 'day-first-slash', label: 'Day first with slashes' },
  { value: 'month-first-slash', label: 'Month first with slashes' },
  { value: 'day-short-month', label: 'Day + abbreviated month' },
  { value: 'month-short-day', label: 'Abbreviated month + day' },
  { value: 'day-long-month', label: 'Day + full month' },
  { value: 'month-long-day', label: 'Full month + day' },
  { value: 'weekday-day-first', label: 'Weekday + day first' },
  { value: 'weekday-month-first', label: 'Weekday + month first' },
  { value: 'month-year', label: 'Month and year only' },
  { value: 'custom', label: 'Custom label' },
];

function getLocale(): string {
  return document.getElementById('user-prefs')?.dataset.jslang || 'en';
}

function getToday(): string {
  return DateTime.local().toISODate() ?? '';
}

function isDateDisplayFormat(value: string): value is DateDisplayFormat {
  return DATE_FORMAT_CHOICES.some(choice => choice.value === value);
}

function getDefaultDateFormat(): DateDisplayFormat {
  const stored = localStorage.getItem(DATE_FORMAT_STORAGE_KEY);
  if (stored && isDateDisplayFormat(stored) && stored !== 'custom') return stored;
  return 'iso';
}

function getDateInsertDefaults(): DateInsertDefaults {
  const fallback: DateInsertDefaults = {
    format: getDefaultDateFormat(),
    customLabel: '',
    asHeading: true,
    headingLevel: 1,
    bold: false,
    italic: false,
    underline: false,
  };
  const accountDefault = getAccountEditorDefault<DateInsertDefaults>('date');
  if (accountDefault) {
    return normalizeDateInsertDefaults(accountDefault, fallback);
  }
  try {
    const stored = localStorage.getItem(DATE_DEFAULTS_STORAGE_KEY);
    if (!stored) return fallback;
    return normalizeDateInsertDefaults(
      JSON.parse(stored) as Partial<DateInsertDefaults>,
      fallback,
    );
  } catch {
    return fallback;
  }
}

function normalizeDateInsertDefaults(
  parsed: Partial<DateInsertDefaults>,
  fallback: DateInsertDefaults,
): DateInsertDefaults {
  const format = typeof parsed.format === 'string' && isDateDisplayFormat(parsed.format)
    ? parsed.format
    : fallback.format;
  const headingLevel = Number(parsed.headingLevel);
  return {
    format,
    customLabel: format === 'custom' && typeof parsed.customLabel === 'string'
      ? parsed.customLabel
      : '',
    asHeading: parsed.asHeading === true,
    headingLevel: Number.isInteger(headingLevel) && headingLevel >= 1 && headingLevel <= 6
      ? headingLevel
      : fallback.headingLevel,
    bold: parsed.bold === true,
    italic: parsed.italic === true,
    underline: parsed.underline === true,
  };
}

function createEmphasisToggle(
  labelText: string,
  symbol: string,
  checked: boolean,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement('label');
  label.className = 'date-title-format-toggle';
  label.title = labelText;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.setAttribute('aria-label', labelText);
  const visible = document.createElement('span');
  visible.textContent = symbol;
  visible.setAttribute('aria-hidden', 'true');
  label.append(input, visible);
  return { label, input };
}

function createDateIconControl(
  iconClass: string,
  labelText: string,
  control: HTMLElement,
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'experiment-title-icon-control date-reference-icon-control';
  field.title = labelText;
  const icon = document.createElement('i');
  icon.className = iconClass;
  icon.setAttribute('aria-hidden', 'true');
  control.setAttribute('aria-label', labelText);
  field.append(icon, control);
  return field;
}

function createDateIconToggle(
  iconClass: string,
  labelText: string,
  checked: boolean,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement('label');
  label.className = 'experiment-title-option-toggle';
  label.title = labelText;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.setAttribute('aria-label', labelText);
  const visible = document.createElement('span');
  const icon = document.createElement('i');
  icon.className = iconClass;
  icon.setAttribute('aria-hidden', 'true');
  visible.appendChild(icon);
  label.append(input, visible);
  return { label, input };
}

function getReferenceEmphasis(
  reference: HTMLAnchorElement | null,
  defaults: DateInsertDefaults,
): Pick<DateInsertDefaults, 'bold' | 'italic' | 'underline'> {
  if (!reference) return defaults;
  return {
    bold: reference.style.fontWeight === 'bold' || Number(reference.style.fontWeight) >= 600,
    italic: reference.style.fontStyle === 'italic',
    underline: reference.style.textDecorationLine.includes('underline')
      || reference.style.textDecoration.includes('underline'),
  };
}

function applyReferenceEmphasis(
  reference: HTMLAnchorElement,
  bold: boolean,
  italic: boolean,
  underline: boolean,
): void {
  reference.style.fontWeight = bold ? 'bold' : 'normal';
  reference.style.fontStyle = italic ? 'italic' : 'normal';
  reference.style.textDecoration = underline ? 'underline' : 'none';
}

async function saveDateInsertDefaults(defaults: DateInsertDefaults): Promise<void> {
  // Write the local fallback first: if the account sync below fails (e.g.
  // offline), this is the only copy of the just-saved value that survives.
  localStorage.setItem(DATE_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
  // Keep the earlier format preference in sync for existing installations.
  if (defaults.format !== 'custom') {
    localStorage.setItem(DATE_FORMAT_STORAGE_KEY, defaults.format);
  }
  await saveAccountEditorDefault('date', defaults);
}

function formatDate(
  date: string,
  format: DateDisplayFormat,
  customLabel = '',
): string {
  const parsed = DateTime.fromISO(date).setLocale(getLocale());
  if (!parsed.isValid) return date;
  switch (format) {
  case 'iso':
    return parsed.toFormat('yyyy-LL-dd');
  case 'compact':
    return parsed.toFormat('yyyyLLdd');
  case 'day-first-dash':
    return parsed.toFormat('dd-LL-yyyy');
  case 'month-first-dash':
    return parsed.toFormat('LL-dd-yyyy');
  case 'day-first-slash':
    return parsed.toFormat('dd/LL/yyyy');
  case 'month-first-slash':
    return parsed.toFormat('LL/dd/yyyy');
  case 'day-short-month':
    return parsed.toFormat('d LLL yyyy');
  case 'month-short-day':
    return parsed.toFormat('LLL d, yyyy');
  case 'day-long-month':
    return parsed.toFormat('d LLLL yyyy');
  case 'month-long-day':
    return parsed.toFormat('LLLL d, yyyy');
  case 'weekday-day-first':
    return parsed.toFormat('cccc, d LLLL yyyy');
  case 'weekday-month-first':
    return parsed.toFormat('cccc, LLLL d, yyyy');
  case 'month-year':
    return parsed.toFormat('LLLL yyyy');
  case 'custom':
    return customLabel.trim() || parsed.toISODate() || date;
  case 'localized':
  default:
    return parsed.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY);
  }
}

// Today's date, formatted using the user's saved "Day" insertion defaults --
// so a log entry's date always matches whatever format the user picked for
// normal date insertion.
export function formatTodayWithSavedDefaults(): string {
  const defaults = getDateInsertDefaults();
  return formatDate(getToday(), defaults.format, defaults.customLabel);
}

function inferDateDisplayFormat(
  date: string,
  label: string,
): { format: DateDisplayFormat; customLabel: string } {
  const matchingChoice = DATE_FORMAT_CHOICES
    .filter(choice => choice.value !== 'custom')
    .find(choice => formatDate(date, choice.value) === label);
  if (matchingChoice) {
    return { format: matchingChoice.value, customLabel: '' };
  }
  return { format: 'custom', customLabel: label };
}

function generateAnchorId(date: string): string {
  const randomPart = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `date-${date}-${randomPart}`;
}

function getEntityViewHref(anchorId: string): string {
  const params = new URLSearchParams({
    mode: 'view',
    id: String(entity.id),
  });
  return `${window.location.pathname}?${params.toString()}#${anchorId}`;
}

function getExperimentHref(experimentId: number): string {
  return `experiments.php?mode=view&id=${experimentId}`;
}

function getReferenceAnchorId(anchor: HTMLAnchorElement): string {
  return anchor.id || anchor.closest('h1, h2, h3, h4, h5, h6')?.id || '';
}

function getTargetFromAnchor(anchor: HTMLAnchorElement): ExperimentTarget | null {
  const href = anchor.getAttribute('href');
  if (!href) return null;

  const targetUrl = new URL(href, window.location.href);
  const targetId = Number(targetUrl.searchParams.get('id'));
  const isExperiment = targetUrl.pathname.endsWith('/experiments.php');
  const isOwnPermanentLink = targetId === entity.id
    && targetUrl.hash === `#${getReferenceAnchorId(anchor)}`;
  if (!isExperiment || !Number.isInteger(targetId) || targetId < 1 || isOwnPermanentLink) {
    return null;
  }
  return { id: targetId, title: `Experiment #${targetId}` };
}

export default class DateReferenceEditor {
  constructor(private editor: Editor) {}

  /**
   * Upgrade earlier date badges whose month/day were stored as selectable text.
   * Empty icon spans render their title attributes through CSS, keeping copying
   * and selection limited to the actual date label.
   */
  public normalizeReferences(): void {
    this.editor.getBody().querySelectorAll<HTMLAnchorElement>(DATE_REFERENCE_SELECTOR)
      .forEach(reference => {
        const icon = reference.querySelector<HTMLElement>('.elabftw-date-icon');
        const date = reference.querySelector('time')?.getAttribute('datetime');
        if (!icon || !date) return;
        const parsedDate = DateTime.fromISO(date).setLocale(getLocale());
        if (!parsedDate.isValid) return;
        const month = document.createElement('span');
        month.className = 'elabftw-date-icon-month';
        month.title = parsedDate.toFormat('LLL').toLocaleUpperCase();
        // TinyMCE can discard completely empty inline elements. A zero-width
        // space keeps the two visual rows in the DOM without adding selectable
        // month/day text.
        month.textContent = '\u200b';
        const day = document.createElement('span');
        day.className = 'elabftw-date-icon-day';
        day.title = parsedDate.toFormat('d');
        day.textContent = '\u200b';
        icon.replaceChildren(month, day);
      });
  }

  public getSelectedReference(): HTMLAnchorElement | null {
    return this.editor.selection.getNode().closest(DATE_REFERENCE_SELECTOR) as HTMLAnchorElement | null;
  }

  public deleteReference(reference: HTMLAnchorElement | null = this.getSelectedReference()): void {
    if (!reference?.isConnected) return;

    const heading = reference.closest('h1, h2, h3, h4, h5, h6') as HTMLHeadingElement | null;
    const headingCopy = heading?.cloneNode(true) as HTMLHeadingElement | undefined;
    headingCopy?.querySelector(DATE_REFERENCE_SELECTOR)?.remove();
    const headingContainsOtherContent = Boolean(
      headingCopy?.textContent?.replaceAll('\u200b', '').trim()
      || headingCopy?.querySelector('img, video, audio, table, hr'),
    );

    this.editor.undoManager.transact(() => {
      if (heading && !headingContainsOtherContent) {
        const paragraph = this.editor.dom.create('p', {}, '<br data-mce-bogus="1">');
        heading.replaceWith(paragraph);
        this.editor.selection.setCursorLocation(paragraph, 0);
      } else {
        const parent = reference.parentNode;
        if (!parent) return;
        const childIndex = Array.from(parent.childNodes).indexOf(reference);
        const spacer = reference.nextSibling;
        reference.remove();
        if (spacer?.nodeType === Node.TEXT_NODE && spacer.textContent?.startsWith('\u00a0')) {
          spacer.textContent = spacer.textContent.slice(1);
          if (!spacer.textContent) spacer.remove();
        }
        this.editor.selection.setCursorLocation(parent, Math.min(childIndex, parent.childNodes.length));
      }
    });
    this.editor.nodeChanged();
    window.dispatchEvent(new CustomEvent('editor-headings-changed'));
  }

  public insertToday(): void {
    const defaults = getDateInsertDefaults();
    this.insertReference(
      getToday(),
      null,
      undefined,
      defaults.format,
      defaults.customLabel,
      defaults.asHeading,
      defaults.headingLevel,
      defaults.bold,
      defaults.italic,
      defaults.underline,
    );
  }

  public openCalendar(reference: HTMLAnchorElement | null = null): void {
    const bookmark = this.editor.selection.getBookmark(2, true);
    const savedDefaults = getDateInsertDefaults();
    const existingTime = reference?.querySelector('time');
    const existingDate = existingTime?.getAttribute('datetime') ?? getToday();
    const inferredFormat = existingTime
      ? inferDateDisplayFormat(existingDate, existingTime.textContent?.trim() ?? existingDate)
      : { format: savedDefaults.format, customLabel: savedDefaults.customLabel };
    let selectedFormat = inferredFormat.format;
    let customLabel = inferredFormat.customLabel;
    const existingHeading = reference?.closest(
      'h1, h2, h3, h4, h5, h6',
    ) as HTMLHeadingElement | null;
    const emphasis = getReferenceEmphasis(reference, savedDefaults);
    let selectedTarget = reference ? getTargetFromAnchor(reference) : null;
    let requestSerial = 0;
    let searchTimer: number | undefined;

    const overlay = document.createElement('div');
    overlay.className = 'date-reference-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'date-reference-dialog date-reference-editor-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'date-reference-title');

    const title = document.createElement('h5');
    title.id = 'date-reference-title';
    title.textContent = reference ? 'Edit linked date' : 'Insert linked date';

    const explanation = document.createElement('p');
    explanation.className = 'date-reference-help';
    explanation.textContent = 'Choose a date from the calendar. It receives a permanent link, and can optionally open another experiment.';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'form-control';
    dateInput.required = true;
    dateInput.value = existingDate;
    const dateControl = createDateIconControl('fas fa-calendar-alt', 'Choose date', dateInput);

    const formatSelect = document.createElement('select');
    formatSelect.className = 'form-control';
    formatSelect.setAttribute('aria-label', 'Date display format');
    const customLabelInput = document.createElement('input');
    customLabelInput.type = 'text';
    customLabelInput.className = 'form-control';
    customLabelInput.placeholder = 'Custom date label';
    customLabelInput.value = customLabel;
    const customLabelControl = createDateIconControl(
      'fas fa-pen',
      'Custom date label',
      customLabelInput,
    );
    const formatPreview = document.createElement('span');
    formatPreview.className = 'date-reference-format-preview';
    formatPreview.setAttribute('aria-live', 'polite');

    const updateFormatControls = (): void => {
      selectedFormat = formatSelect.value as DateDisplayFormat;
      customLabelControl.hidden = selectedFormat !== 'custom';
      customLabel = customLabelInput.value;
      formatPreview.textContent = `Preview: ${formatDate(dateInput.value, selectedFormat, customLabel)}`;
    };
    const renderFormatOptions = (): void => {
      formatSelect.replaceChildren();
      DATE_FORMAT_CHOICES.forEach(choice => {
        const option = document.createElement('option');
        option.value = choice.value;
        const example = choice.value === 'custom'
          ? 'enter your own text'
          : formatDate(dateInput.value, choice.value);
        option.textContent = `${choice.label} — ${example}`;
        formatSelect.appendChild(option);
      });
      formatSelect.value = selectedFormat;
      updateFormatControls();
    };
    renderFormatOptions();
    formatSelect.addEventListener('change', updateFormatControls);
    customLabelInput.addEventListener('input', updateFormatControls);
    dateInput.addEventListener('change', renderFormatOptions);
    const formatControl = createDateIconControl(
      'fas fa-calendar-day',
      'Date display format',
      formatSelect,
    );

    const heading = createDateIconToggle(
      'fas fa-heading',
      'Use this date as a heading',
      reference ? Boolean(existingHeading) : savedDefaults.asHeading,
    );
    const headingCheckbox = heading.input;
    const headingLevelSelect = document.createElement('select');
    headingLevelSelect.className = 'form-control';
    headingLevelSelect.setAttribute('aria-label', 'Date heading level');
    for (let level = 1; level <= 6; level++) {
      const option = document.createElement('option');
      option.value = String(level);
      option.textContent = `H${level}`;
      headingLevelSelect.appendChild(option);
    }
    headingLevelSelect.value = existingHeading?.tagName.slice(1)
      ?? String(savedDefaults.headingLevel);
    headingCheckbox.addEventListener('change', () => {
      headingLevelControl.hidden = !headingCheckbox.checked;
    });
    const headingLevelControl = createDateIconControl(
      'fas fa-layer-group',
      'Date heading level',
      headingLevelSelect,
    );
    headingLevelControl.hidden = !headingCheckbox.checked;

    const emphasisButtons = document.createElement('div');
    emphasisButtons.className = 'date-title-format-buttons experiment-title-emphasis-buttons';
    const bold = createEmphasisToggle('Bold', 'B', emphasis.bold);
    const italic = createEmphasisToggle('Italic', 'I', emphasis.italic);
    const underline = createEmphasisToggle('Underline', 'U', emphasis.underline);
    emphasisButtons.append(bold.label, italic.label, underline.label);

    const editingToolbar = document.createElement('div');
    editingToolbar.className = 'experiment-title-typography-toolbar date-reference-editing-toolbar';
    editingToolbar.append(
      dateControl,
      formatControl,
      customLabelControl,
      heading.label,
      headingLevelControl,
      emphasisButtons,
    );

    const linkGroup = document.createElement('div');
    linkGroup.className = 'date-reference-field';
    const linkLabel = document.createElement('label');
    linkLabel.htmlFor = 'date-reference-experiment-search';
    linkLabel.textContent = 'Link to another experiment (optional)';
    const searchRow = document.createElement('div');
    searchRow.className = 'date-reference-search-row';
    const searchInput = document.createElement('input');
    searchInput.id = 'date-reference-experiment-search';
    searchInput.type = 'search';
    searchInput.className = 'form-control';
    searchInput.autocomplete = 'off';
    searchInput.placeholder = 'Type at least 3 characters';
    searchInput.value = selectedTarget?.title ?? '';
    const clearTargetButton = document.createElement('button');
    clearTargetButton.type = 'button';
    clearTargetButton.className = 'btn btn-outline-secondary';
    clearTargetButton.textContent = 'Clear';
    searchRow.append(searchInput, clearTargetButton);

    const targetStatus = document.createElement('div');
    targetStatus.className = 'date-reference-target-status';
    targetStatus.setAttribute('aria-live', 'polite');
    const searchResults = document.createElement('div');
    searchResults.className = 'date-reference-search-results';
    searchResults.setAttribute('role', 'listbox');

    const updateTargetStatus = (): void => {
      if (selectedTarget) {
        targetStatus.textContent = `Linked to: ${selectedTarget.title} (#${selectedTarget.id})`;
        targetStatus.classList.add('is-selected');
      } else {
        targetStatus.textContent = 'No experiment selected — the date links to its passage in this entry.';
        targetStatus.classList.remove('is-selected');
      }
    };
    updateTargetStatus();
    linkGroup.append(linkLabel, searchRow, targetStatus, searchResults);

    const actions = document.createElement('div');
    actions.className = 'date-reference-actions';
    const deleteButton = reference ? document.createElement('button') : null;
    if (deleteButton) {
      deleteButton.type = 'button';
      deleteButton.className = 'btn btn-outline-danger mr-auto';
      deleteButton.textContent = 'Delete date';
      deleteButton.title = 'Remove this date; Undo can restore it';
    }
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-secondary';
    cancelButton.textContent = 'Cancel';
    const saveDefaultButton = document.createElement('button');
    saveDefaultButton.type = 'button';
    saveDefaultButton.className = 'btn btn-outline-primary';
    saveDefaultButton.textContent = 'Save as default';
    saveDefaultButton.title = 'Use this format and heading choice for one-click date insertion';
    const insertButton = document.createElement('button');
    insertButton.type = 'button';
    insertButton.className = 'btn btn-primary';
    insertButton.textContent = reference ? 'Update date' : 'Insert date';
    if (deleteButton) actions.appendChild(deleteButton);
    actions.append(cancelButton, saveDefaultButton, insertButton);

    dialog.append(
      title,
      explanation,
      editingToolbar,
      formatPreview,
      linkGroup,
      actions,
    );
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Same discard-confirmation the spreadsheet editor and "Insert Note"
    // dialog already have -- this dialog previously closed silently on
    // Escape/backdrop-click/Cancel even with an edited date, format, or
    // linked experiment pending. A delegated change/input listener (below)
    // covers every field without wiring each one individually.
    let hasChanges = false;
    const openerFocus = captureFocus();
    const close = (force = false): void => {
      if (!force && hasChanges && !window.confirm('Discard unsaved changes to this date?')) return;
      if (searchTimer !== undefined) window.clearTimeout(searchTimer);
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
      restoreFocus(openerFocus);
    };
    dialog.addEventListener('input', () => { hasChanges = true; });
    dialog.addEventListener('change', () => { hasChanges = true; });

    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { close(); return; }
      trapTabFocus(dialog, event);
    };

    const showSearchMessage = (message: string): void => {
      searchResults.replaceChildren();
      const status = document.createElement('div');
      status.className = 'date-reference-search-message';
      status.textContent = message;
      searchResults.appendChild(status);
    };

    const renderSearchResults = (results: ExperimentSearchResult[]): void => {
      searchResults.replaceChildren();
      if (results.length === 0) {
        showSearchMessage('No experiments found.');
        return;
      }
      results.forEach(result => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'date-reference-search-result';
        button.setAttribute('role', 'option');

        const name = document.createElement('strong');
        name.textContent = result.title;
        const metadata = document.createElement('span');
        metadata.textContent = [
          `#${result.id}`,
          result.category_title,
          result.status_title,
        ].filter(Boolean).join(' · ');
        button.append(name, metadata);
        button.addEventListener('click', () => {
          selectedTarget = { id: result.id, title: result.title };
          searchInput.value = result.title;
          searchResults.replaceChildren();
          updateTargetStatus();
        });
        searchResults.appendChild(button);
      });
    };

    searchInput.addEventListener('input', () => {
      selectedTarget = null;
      updateTargetStatus();
      if (searchTimer !== undefined) window.clearTimeout(searchTimer);
      const term = searchInput.value.trim();
      if (term.length < 3) {
        searchResults.replaceChildren();
        return;
      }
      searchTimer = window.setTimeout(async () => {
        const thisRequest = ++requestSerial;
        showSearchMessage('Searching…');
        const params = new URLSearchParams({
          q: escapeExtendedQuery(term),
          limit: '12',
        });
        try {
          const results = await ApiC.getJson<ExperimentSearchResult[]>(
            `${EntityType.Experiment}/?${params.toString()}`,
          );
          if (thisRequest === requestSerial) renderSearchResults(results);
        } catch {
          if (thisRequest === requestSerial) showSearchMessage('Experiment search failed.');
        }
      }, 250);
    });

    clearTargetButton.addEventListener('click', () => {
      selectedTarget = null;
      searchInput.value = '';
      searchResults.replaceChildren();
      updateTargetStatus();
      searchInput.focus();
    });

    const validateCustomLabel = (): boolean => {
      if (selectedFormat !== 'custom' || customLabelInput.value.trim()) {
        customLabelInput.setCustomValidity('');
        return true;
      }
      customLabelControl.hidden = false;
      customLabelInput.focus();
      customLabelInput.setCustomValidity('Enter a custom date label.');
      customLabelInput.reportValidity();
      return false;
    };

    saveDefaultButton.addEventListener('click', async () => {
      if (!validateCustomLabel()) return;
      saveDefaultButton.disabled = true;
      try {
        await saveDateInsertDefaults({
          format: selectedFormat,
          customLabel: customLabelInput.value.trim(),
          asHeading: headingCheckbox.checked,
          headingLevel: Number(headingLevelSelect.value),
          bold: bold.input.checked,
          italic: italic.input.checked,
          underline: underline.input.checked,
        });
        this.editor.notificationManager.open({
          text: 'Date defaults saved for your account',
          type: 'success',
          timeout: 2500,
        });
      } catch {
        this.editor.notificationManager.open({
          text: 'Could not save date defaults for your account',
          type: 'error',
          timeout: 3500,
        });
      } finally {
        saveDefaultButton.disabled = false;
      }
    });

    insertButton.addEventListener('click', () => {
      if (!dateInput.value) {
        dateInput.focus();
        dateInput.reportValidity();
        return;
      }
      if (!validateCustomLabel()) return;
      close(true);
      this.editor.focus();
      const requestedHeadingLevel = Math.min(
        6,
        Math.max(1, Math.round(Number(headingLevelSelect.value))),
      );
      const keepsExistingStructure = Boolean(
        reference
        && headingCheckbox.checked === Boolean(existingHeading)
        && (!existingHeading || existingHeading.tagName === `H${requestedHeadingLevel}`),
      );
      if (reference && keepsExistingStructure) {
        this.updateReference(
          reference,
          dateInput.value,
          selectedTarget,
          selectedFormat,
          customLabelInput.value,
          bold.input.checked,
          italic.input.checked,
          underline.input.checked,
        );
        return;
      }
      const referenceHost = existingHeading ?? reference;
      if (referenceHost?.isConnected) {
        this.editor.selection.select(referenceHost);
      } else {
        this.editor.selection.moveToBookmark(bookmark);
      }
      this.insertReference(
        dateInput.value,
        selectedTarget,
        reference ? getReferenceAnchorId(reference) : undefined,
        selectedFormat,
        customLabelInput.value,
        headingCheckbox.checked,
        requestedHeadingLevel,
        bold.input.checked,
        italic.input.checked,
        underline.input.checked,
      );
    });
    deleteButton?.addEventListener('click', () => {
      close(true);
      this.editor.focus();
      this.deleteReference(reference);
    });
    cancelButton.addEventListener('click', () => close());
    document.addEventListener('keydown', handleKeydown);

    // Resolve an edited experiment link to its current title without delaying
    // the dialog.
    if (selectedTarget) {
      ApiC.getJson<ExperimentSearchResult>(`${EntityType.Experiment}/${selectedTarget.id}`)
        .then(result => {
          if (!overlay.isConnected || !result?.title) return;
          selectedTarget = { id: result.id, title: result.title };
          searchInput.value = result.title;
          updateTargetStatus();
        })
        .catch(() => undefined);
    }

    dateInput.focus();
  }

  public async copySelectedReferenceLink(): Promise<void> {
    const reference = this.getSelectedReference();
    if (!reference) return;

    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'view');
    url.searchParams.set('id', String(entity.id));
    url.hash = getReferenceAnchorId(reference);

    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url.toString();
      textarea.style.left = '-9999px';
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    this.editor.notificationManager.open({
      text: 'Permanent date link copied',
      type: 'success',
      timeout: 2500,
    });
  }

  /** Update the date badge without reinserting it and inheriting surrounding font styles. */
  private updateReference(
    reference: HTMLAnchorElement,
    date: string,
    target: ExperimentTarget | null,
    format: DateDisplayFormat,
    customLabel: string,
    bold: boolean,
    italic: boolean,
    underline: boolean,
  ): void {
    const anchorId = getReferenceAnchorId(reference) || generateAnchorId(date);
    const label = formatDate(date, format, customLabel);
    const parsedDate = DateTime.fromISO(date).setLocale(getLocale());
    const iconMonth = parsedDate.isValid ? parsedDate.toFormat('LLL').toLocaleUpperCase() : '';
    const iconDay = parsedDate.isValid ? parsedDate.toFormat('d') : '';
    const title = target
      ? `${label} — open ${target.title}`
      : `${label} — permanent link to this passage`;

    this.editor.undoManager.transact(() => {
      reference.setAttribute(
        'href',
        target ? getExperimentHref(target.id) : getEntityViewHref(anchorId),
      );
      reference.setAttribute('title', title);
      applyReferenceEmphasis(reference, bold, italic, underline);
      const time = reference.querySelector('time') ?? document.createElement('time');
      time.setAttribute('datetime', date);
      time.textContent = label;
      if (!time.isConnected) reference.appendChild(time);

      const month = reference.querySelector<HTMLElement>('.elabftw-date-icon-month');
      const day = reference.querySelector<HTMLElement>('.elabftw-date-icon-day');
      if (month) month.title = iconMonth;
      if (day) day.title = iconDay;
    });
    this.editor.selection.select(reference);
    this.editor.nodeChanged();
    window.dispatchEvent(new CustomEvent('editor-headings-changed'));
  }

  private insertReference(
    date: string,
    target: ExperimentTarget | null,
    existingAnchorId?: string,
    format: DateDisplayFormat = getDefaultDateFormat(),
    customLabel = '',
    asHeading = true,
    headingLevel = 1,
    bold = false,
    italic = false,
    underline = false,
  ): void {
    const anchorId = existingAnchorId || generateAnchorId(date);
    const href = target ? getExperimentHref(target.id) : getEntityViewHref(anchorId);
    const label = formatDate(date, format, customLabel);
    const parsedDate = DateTime.fromISO(date).setLocale(getLocale());
    const iconMonth = parsedDate.isValid ? parsedDate.toFormat('LLL').toLocaleUpperCase() : '';
    const iconDay = parsedDate.isValid ? parsedDate.toFormat('d') : '';
    const title = target
      ? `${label} — open ${target.title}`
      : `${label} — permanent link to this passage`;
    const anchorHtml = [
      `<a${asHeading ? '' : ` id="${escapeHTML(anchorId)}"`}`,
      ' class="elabftw-date-reference"',
      ` style="font-weight:${bold ? 'bold' : 'normal'};font-style:${italic ? 'italic' : 'normal'};text-decoration:${underline ? 'underline' : 'none'}"`,
      ` href="${escapeHTML(href)}" title="${escapeHTML(title)}">`,
      '<span class="elabftw-date-icon">',
      `<span class="elabftw-date-icon-month" title="${escapeHTML(iconMonth)}">&#8203;</span>`,
      `<span class="elabftw-date-icon-day" title="${escapeHTML(iconDay)}">&#8203;</span>`,
      '</span>',
      `<time datetime="${escapeHTML(date)}">${escapeHTML(label)}</time></a>`,
    ].join('');
    const safeHeadingLevel = Math.min(6, Math.max(1, Math.round(headingLevel)));
    const html = asHeading
      ? `<h${safeHeadingLevel} id="${escapeHTML(anchorId)}">${anchorHtml}</h${safeHeadingLevel}><p><br data-mce-bogus="1"></p>`
      : `${anchorHtml}&nbsp;`;
    this.editor.execCommand('mceInsertContent', false, html);
    this.editor.undoManager.add();
  }
}
