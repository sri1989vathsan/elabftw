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
import { escapeExtendedQuery, escapeHTML } from './misc';

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

const DATE_REFERENCE_SELECTOR = 'a.elabftw-date-reference';
const DATE_FORMAT_STORAGE_KEY = 'elabftw-date-display-format';
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
  return document.getElementById('user-prefs')?.dataset.isodate === '1'
    ? 'iso'
    : 'localized';
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

  public getSelectedReference(): HTMLAnchorElement | null {
    return this.editor.selection.getNode().closest(DATE_REFERENCE_SELECTOR) as HTMLAnchorElement | null;
  }

  public insertToday(): void {
    this.insertReference(getToday(), null, undefined, getDefaultDateFormat());
  }

  public openCalendar(reference: HTMLAnchorElement | null = null): void {
    const bookmark = this.editor.selection.getBookmark(2, true);
    const existingTime = reference?.querySelector('time');
    const existingDate = existingTime?.getAttribute('datetime') ?? getToday();
    const inferredFormat = existingTime
      ? inferDateDisplayFormat(existingDate, existingTime.textContent?.trim() ?? existingDate)
      : { format: getDefaultDateFormat(), customLabel: '' };
    let selectedFormat = inferredFormat.format;
    let customLabel = inferredFormat.customLabel;
    const existingHeading = reference?.closest(
      'h1, h2, h3, h4, h5, h6',
    ) as HTMLHeadingElement | null;
    let selectedTarget = reference ? getTargetFromAnchor(reference) : null;
    let requestSerial = 0;
    let searchTimer: number | undefined;

    const overlay = document.createElement('div');
    overlay.className = 'date-reference-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'date-reference-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'date-reference-title');

    const title = document.createElement('h5');
    title.id = 'date-reference-title';
    title.textContent = reference ? 'Edit linked date' : 'Insert linked date';

    const explanation = document.createElement('p');
    explanation.className = 'date-reference-help';
    explanation.textContent = 'Choose a date from the calendar. It receives a permanent link, and can optionally open another experiment.';

    const dateGroup = document.createElement('label');
    dateGroup.className = 'date-reference-field';
    dateGroup.textContent = 'Date';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'form-control';
    dateInput.required = true;
    dateInput.value = existingDate;
    dateGroup.appendChild(dateInput);

    const formatGroup = document.createElement('label');
    formatGroup.className = 'date-reference-field';
    formatGroup.textContent = 'Display format';
    const formatSelect = document.createElement('select');
    formatSelect.className = 'form-control';
    formatSelect.setAttribute('aria-label', 'Date display format');
    const customLabelInput = document.createElement('input');
    customLabelInput.type = 'text';
    customLabelInput.className = 'form-control';
    customLabelInput.placeholder = 'Custom date label';
    customLabelInput.value = customLabel;
    const formatPreview = document.createElement('span');
    formatPreview.className = 'date-reference-format-preview';
    formatPreview.setAttribute('aria-live', 'polite');

    const updateFormatControls = (): void => {
      selectedFormat = formatSelect.value as DateDisplayFormat;
      customLabelInput.hidden = selectedFormat !== 'custom';
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
    formatGroup.append(formatSelect, customLabelInput, formatPreview);

    const headingGroup = document.createElement('div');
    headingGroup.className = 'date-reference-heading-row';
    const headingCheckboxLabel = document.createElement('label');
    headingCheckboxLabel.className = 'date-reference-heading-toggle';
    const headingCheckbox = document.createElement('input');
    headingCheckbox.type = 'checkbox';
    headingCheckbox.checked = Boolean(existingHeading);
    const headingText = document.createElement('span');
    headingText.textContent = 'Use this date as a heading';
    headingCheckboxLabel.append(headingCheckbox, headingText);
    const headingLevelSelect = document.createElement('select');
    headingLevelSelect.className = 'form-control';
    headingLevelSelect.setAttribute('aria-label', 'Date heading level');
    for (let level = 1; level <= 6; level++) {
      const option = document.createElement('option');
      option.value = String(level);
      option.textContent = `Heading ${level}`;
      headingLevelSelect.appendChild(option);
    }
    headingLevelSelect.value = existingHeading?.tagName.slice(1) ?? '2';
    headingLevelSelect.hidden = !headingCheckbox.checked;
    headingCheckbox.addEventListener('change', () => {
      headingLevelSelect.hidden = !headingCheckbox.checked;
    });
    headingGroup.append(headingCheckboxLabel, headingLevelSelect);

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
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-secondary';
    cancelButton.textContent = 'Cancel';
    const insertButton = document.createElement('button');
    insertButton.type = 'button';
    insertButton.className = 'btn btn-primary';
    insertButton.textContent = reference ? 'Update date' : 'Insert date';
    actions.append(cancelButton, insertButton);

    dialog.append(
      title,
      explanation,
      dateGroup,
      formatGroup,
      headingGroup,
      linkGroup,
      actions,
    );
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = (): void => {
      if (searchTimer !== undefined) window.clearTimeout(searchTimer);
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
    };

    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
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

    insertButton.addEventListener('click', () => {
      if (!dateInput.value) {
        dateInput.focus();
        dateInput.reportValidity();
        return;
      }
      if (selectedFormat === 'custom' && !customLabelInput.value.trim()) {
        customLabelInput.hidden = false;
        customLabelInput.focus();
        customLabelInput.setCustomValidity('Enter a custom date label.');
        customLabelInput.reportValidity();
        return;
      }
      customLabelInput.setCustomValidity('');
      localStorage.setItem(DATE_FORMAT_STORAGE_KEY, selectedFormat);
      close();
      this.editor.focus();
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
        Number(headingLevelSelect.value),
      );
    });
    cancelButton.addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
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

  private insertReference(
    date: string,
    target: ExperimentTarget | null,
    existingAnchorId?: string,
    format: DateDisplayFormat = getDefaultDateFormat(),
    customLabel = '',
    asHeading = false,
    headingLevel = 2,
  ): void {
    const anchorId = existingAnchorId || generateAnchorId(date);
    const href = target ? getExperimentHref(target.id) : getEntityViewHref(anchorId);
    const label = formatDate(date, format, customLabel);
    const title = target
      ? `${label} — open ${target.title}`
      : `${label} — permanent link to this passage`;
    const anchorHtml = [
      `<a${asHeading ? '' : ` id="${escapeHTML(anchorId)}"`}`,
      ' class="elabftw-date-reference"',
      ` href="${escapeHTML(href)}" title="${escapeHTML(title)}">`,
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
