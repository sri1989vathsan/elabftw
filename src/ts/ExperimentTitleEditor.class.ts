/**
 * Insert the current entity title as a styled, linkable document heading.
 */
import type { Editor } from 'tinymce/tinymce';
import { entity } from './getEntity';
import { trapTabFocus } from './a11y';
import { escapeHTML } from './misc';
import { getAccountEditorDefault, saveAccountEditorDefault } from './editor-defaults';

type HeadingAlignment = 'left' | 'center' | 'right' | 'justify';
type BackgroundCoverage = 'title' | 'text';

interface ExperimentTitleDefaults {
  headingLevel: number;
  fontFamily: string;
  fontSize: number;
  useThemeColor: boolean;
  textColor: string;
  useBackgroundColor: boolean;
  backgroundColor: string;
  backgroundCoverage: BackgroundCoverage;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  alignment: HeadingAlignment;
}

interface ExperimentTitlePreset {
  name: string;
  defaults: ExperimentTitleDefaults;
}

interface ExperimentTitleAccountSettings extends ExperimentTitleDefaults {
  presets?: Array<Partial<ExperimentTitlePreset>>;
}

const TITLE_DEFAULTS_STORAGE_KEY = 'elabftw-experiment-title-heading-defaults-v1';
const TITLE_PRESETS_STORAGE_KEY = 'elabftw-experiment-title-heading-presets-v1';
const MAX_TITLE_PRESETS = 20;
const FONT_FAMILIES = new Map<string, string>([
  ['', 'Theme default'],
  ['Arial, sans-serif', 'Arial'],
  ['Verdana, sans-serif', 'Verdana'],
  ['Georgia, serif', 'Georgia'],
  ["'Times New Roman', serif", 'Times New Roman'],
  ["'Courier New', monospace", 'Courier New'],
]);
const ALIGNMENTS = new Set<HeadingAlignment>(['left', 'center', 'right', 'justify']);
const BACKGROUND_COVERAGES = new Set<BackgroundCoverage>(['title', 'text']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function getFallbackDefaults(): ExperimentTitleDefaults {
  return {
    headingLevel: 1,
    fontFamily: '',
    fontSize: 24,
    useThemeColor: true,
    textColor: '#343a40',
    useBackgroundColor: false,
    backgroundColor: '#e9ecef',
    backgroundCoverage: 'title',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
  };
}

function normalizeDefaults(candidate?: Partial<ExperimentTitleDefaults>): ExperimentTitleDefaults {
  const fallback = getFallbackDefaults();
  const headingLevel = Number(candidate?.headingLevel);
  const fontSize = Number(candidate?.fontSize);
  return {
    headingLevel: Number.isInteger(headingLevel) && headingLevel >= 1 && headingLevel <= 6
      ? headingLevel
      : fallback.headingLevel,
    fontFamily: typeof candidate?.fontFamily === 'string'
      && FONT_FAMILIES.has(candidate.fontFamily)
      ? candidate.fontFamily
      : fallback.fontFamily,
    fontSize: Number.isFinite(fontSize) && fontSize >= 8 && fontSize <= 72
      ? Math.round(fontSize)
      : fallback.fontSize,
    useThemeColor: candidate?.useThemeColor !== false,
    textColor: typeof candidate?.textColor === 'string'
      && COLOR_PATTERN.test(candidate.textColor)
      ? candidate.textColor.toLowerCase()
      : fallback.textColor,
    useBackgroundColor: candidate?.useBackgroundColor === true,
    backgroundColor: typeof candidate?.backgroundColor === 'string'
      && COLOR_PATTERN.test(candidate.backgroundColor)
      ? candidate.backgroundColor.toLowerCase()
      : fallback.backgroundColor,
    backgroundCoverage: candidate?.backgroundCoverage
      && BACKGROUND_COVERAGES.has(candidate.backgroundCoverage)
      ? candidate.backgroundCoverage
      : fallback.backgroundCoverage,
    bold: candidate?.bold !== false,
    italic: candidate?.italic === true,
    underline: candidate?.underline === true,
    alignment: candidate?.alignment && ALIGNMENTS.has(candidate.alignment)
      ? candidate.alignment
      : fallback.alignment,
  };
}

function getDefaults(): ExperimentTitleDefaults {
  const accountDefault = getAccountEditorDefault<ExperimentTitleDefaults>('title');
  if (accountDefault) return normalizeDefaults(accountDefault);
  try {
    const stored = localStorage.getItem(TITLE_DEFAULTS_STORAGE_KEY);
    if (stored) return normalizeDefaults(JSON.parse(stored) as Partial<ExperimentTitleDefaults>);
  } catch {
    // A malformed or unavailable local preference must not block title insertion.
  }
  return getFallbackDefaults();
}

async function saveDefaults(defaults: ExperimentTitleDefaults): Promise<void> {
  // Write the local fallback first: if the account sync below fails (e.g.
  // offline), this is the only copy of the just-saved value that survives.
  localStorage.setItem(TITLE_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
  await saveAccountEditorDefault<ExperimentTitleAccountSettings>('title', {
    ...defaults,
    presets: getPresets(),
  });
}

function normalizePresets(candidates: unknown): ExperimentTitlePreset[] {
  if (!Array.isArray(candidates)) return [];
  return (candidates as Array<Partial<ExperimentTitlePreset>>)
    .filter(candidate => typeof candidate?.name === 'string' && candidate.name.trim())
    .slice(0, MAX_TITLE_PRESETS)
    .map(candidate => ({
      name: candidate.name?.trim().slice(0, 50) ?? '',
      defaults: normalizeDefaults(candidate.defaults),
    }));
}

function getAccountPresets(): ExperimentTitlePreset[] | null {
  const settings = getAccountEditorDefault<ExperimentTitleAccountSettings>('title');
  return Array.isArray(settings?.presets) ? normalizePresets(settings.presets) : null;
}

function getLocalPresets(): ExperimentTitlePreset[] {
  try {
    const stored = localStorage.getItem(TITLE_PRESETS_STORAGE_KEY);
    if (!stored) return [];
    return normalizePresets(JSON.parse(stored) as unknown);
  } catch {
    return [];
  }
}

function getPresets(): ExperimentTitlePreset[] {
  return getAccountPresets() ?? getLocalPresets();
}

async function savePresets(presets: ExperimentTitlePreset[]): Promise<void> {
  const defaults = getDefaults();
  // Write the local fallback first: if the account sync below fails (e.g.
  // offline), this is the only copy of the just-saved value that survives.
  localStorage.setItem(TITLE_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  await saveAccountEditorDefault<ExperimentTitleAccountSettings>('title', {
    ...defaults,
    presets,
  });
}

function getHeadingStyle(defaults: ExperimentTitleDefaults): string {
  const declarations = [
    `font-size:${defaults.fontSize}pt`,
    `font-weight:${defaults.bold ? 'bold' : 'normal'}`,
    `font-style:${defaults.italic ? 'italic' : 'normal'}`,
    `text-decoration:${defaults.underline ? 'underline' : 'none'}`,
    `text-align:${defaults.alignment}`,
  ];
  if (defaults.fontFamily) declarations.push(`font-family:${defaults.fontFamily}`);
  if (!defaults.useThemeColor) declarations.push(`color:${defaults.textColor}`);
  if (defaults.useBackgroundColor && defaults.backgroundCoverage === 'title') {
    declarations.push(`background-color:${defaults.backgroundColor}`);
  }
  return declarations.join(';');
}

function getTitleTextStyle(defaults: ExperimentTitleDefaults): string {
  if (defaults.useBackgroundColor && defaults.backgroundCoverage === 'text') {
    return `background-color:${defaults.backgroundColor}`;
  }
  return '';
}

function createField(labelText: string, control: HTMLElement): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'date-reference-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  field.append(label, control);
  return field;
}

function createControlGroup(labelText: string, control: HTMLElement): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'date-reference-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  field.append(label, control);
  return field;
}

function createIconControl(
  iconClass: string,
  labelText: string,
  control: HTMLElement,
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'experiment-title-icon-control';
  field.title = labelText;
  const icon = document.createElement('i');
  icon.className = iconClass;
  icon.setAttribute('aria-hidden', 'true');
  control.setAttribute('aria-label', labelText);
  field.append(icon, control);
  return field;
}

function createIconToggle(
  iconClass: string,
  labelText: string,
  checked: boolean,
): {
  label: HTMLLabelElement;
  input: HTMLInputElement;
} {
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

function createColorControl(
  iconClass: string,
  labelText: string,
  input: HTMLInputElement,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'experiment-title-color-control';
  label.title = labelText;
  const icon = document.createElement('i');
  icon.className = iconClass;
  icon.setAttribute('aria-hidden', 'true');
  input.setAttribute('aria-label', labelText);
  label.append(icon, input);
  return label;
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

export default class ExperimentTitleEditor {
  constructor(private editor: Editor) {}

  public getSavedStyleNames(): string[] {
    return getPresets().map(preset => preset.name);
  }

  public applySavedStyle(name: string): void {
    const preset = getPresets().find(candidate => candidate.name === name);
    if (!preset) return;
    const selectedText = this.editor.selection.getContent({ format: 'text' }).trim();
    const selectedNode = this.editor.selection.getNode();
    const existingHeading = selectedNode.closest?.(
      'h1, h2, h3, h4, h5, h6',
    ) as HTMLHeadingElement | null;
    if (!selectedText && !existingHeading) {
      this.editor.notificationManager.open({
        text: 'Select text or place the cursor in a heading first',
        type: 'info',
        timeout: 2500,
      });
      return;
    }

    if (!existingHeading) {
      this.insert(preset.defaults, selectedText);
      return;
    }

    // A heading is a block-level unit: restyle the complete heading even if
    // only part of its text was selected, so surrounding words are never lost.
    const text = existingHeading.textContent?.trim() || 'Heading';
    const replacement = this.editor.getDoc().createElement(`h${preset.defaults.headingLevel}`);
    replacement.id = existingHeading.id || this.getUniqueHeadingId();
    replacement.style.cssText = getHeadingStyle(preset.defaults);
    const textStyle = getTitleTextStyle(preset.defaults);
    if (textStyle) {
      const span = this.editor.getDoc().createElement('span');
      span.style.cssText = textStyle;
      span.textContent = text;
      replacement.appendChild(span);
    } else {
      replacement.textContent = text;
    }
    this.editor.undoManager.transact(() => existingHeading.replaceWith(replacement));
    this.editor.selection.select(replacement, true);
    this.editor.nodeChanged();
    window.dispatchEvent(new CustomEvent('editor-headings-changed'));
  }

  public insertUsingDefaults(): void {
    this.insert(getDefaults(), this.getCurrentTitle());
  }

  public openDialog(): void {
    const defaults = getDefaults();
    const overlay = document.createElement('div');
    overlay.className = 'date-reference-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'date-reference-dialog experiment-title-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'experiment-title-dialog-title');

    const title = document.createElement('h5');
    title.id = 'experiment-title-dialog-title';
    title.textContent = 'Insert experiment title';

    const explanation = document.createElement('p');
    explanation.className = 'date-reference-help';
    explanation.textContent = 'Insert the experiment name or your own text as a linkable heading for the document and Table of Contents.';

    const headingTextInput = document.createElement('input');
    headingTextInput.type = 'text';
    headingTextInput.className = 'form-control';
    headingTextInput.value = this.getCurrentTitle();
    headingTextInput.placeholder = 'Heading text';
    headingTextInput.maxLength = 255;

    const headingLevelSelect = document.createElement('select');
    headingLevelSelect.className = 'form-control';
    for (let level = 1; level <= 6; level += 1) {
      const option = document.createElement('option');
      option.value = String(level);
      option.textContent = `H${level}`;
      headingLevelSelect.appendChild(option);
    }
    headingLevelSelect.value = String(defaults.headingLevel);

    const accountPresets = getAccountPresets();
    let presets = accountPresets ?? getLocalPresets();
    const presetRow = document.createElement('div');
    presetRow.className = 'experiment-title-preset-row';
    const presetSelect = document.createElement('select');
    presetSelect.className = 'form-control';
    presetSelect.setAttribute('aria-label', 'Saved title style');
    const presetNameInput = document.createElement('input');
    presetNameInput.type = 'text';
    presetNameInput.className = 'form-control';
    presetNameInput.placeholder = 'Style name';
    presetNameInput.maxLength = 50;
    const savePresetButton = document.createElement('button');
    savePresetButton.type = 'button';
    savePresetButton.className = 'btn btn-outline-primary';
    savePresetButton.textContent = 'Save style';
    const deletePresetButton = document.createElement('button');
    deletePresetButton.type = 'button';
    deletePresetButton.className = 'btn btn-outline-danger';
    deletePresetButton.textContent = 'Remove';
    presetRow.append(
      presetSelect,
      presetNameInput,
      savePresetButton,
      deletePresetButton,
    );

    const fontFamilySelect = document.createElement('select');
    fontFamilySelect.className = 'form-control';
    FONT_FAMILIES.forEach((label, value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      fontFamilySelect.appendChild(option);
    });
    fontFamilySelect.value = defaults.fontFamily;

    const fontSizeInput = document.createElement('input');
    fontSizeInput.type = 'number';
    fontSizeInput.className = 'form-control';
    fontSizeInput.min = '8';
    fontSizeInput.max = '72';
    fontSizeInput.value = String(defaults.fontSize);

    const textColorInput = document.createElement('input');
    textColorInput.type = 'color';
    textColorInput.value = defaults.textColor;
    const themeColor = createIconToggle(
      'fas fa-palette',
      'Use theme text colour',
      defaults.useThemeColor,
    );
    textColorInput.disabled = themeColor.input.checked;
    const textColorControl = createColorControl(
      'fas fa-font',
      'Choose text colour',
      textColorInput,
    );

    const backgroundColorInput = document.createElement('input');
    backgroundColorInput.type = 'color';
    backgroundColorInput.value = defaults.backgroundColor;
    const noBackground = createIconToggle(
      'fas fa-ban',
      'No background colour',
      !defaults.useBackgroundColor,
    );
    const backgroundColorControl = createColorControl(
      'fas fa-highlighter',
      'Choose background colour',
      backgroundColorInput,
    );
    const backgroundCoverageSelect = document.createElement('select');
    backgroundCoverageSelect.className = 'form-control';
    backgroundCoverageSelect.innerHTML = `
      <option value="title">Full title width</option>
      <option value="text">Text only</option>
    `;
    backgroundCoverageSelect.value = defaults.backgroundCoverage;
    backgroundColorInput.disabled = noBackground.input.checked;
    backgroundCoverageSelect.disabled = noBackground.input.checked;

    const emphasisButtons = document.createElement('div');
    emphasisButtons.className = 'date-title-format-buttons experiment-title-emphasis-buttons';
    const bold = createEmphasisToggle('Bold', 'B', defaults.bold);
    const italic = createEmphasisToggle('Italic', 'I', defaults.italic);
    const underline = createEmphasisToggle('Underline', 'U', defaults.underline);
    emphasisButtons.append(bold.label, italic.label, underline.label);

    const alignmentSelect = document.createElement('select');
    alignmentSelect.className = 'form-control';
    alignmentSelect.innerHTML = `
      <option value="left">Left</option>
      <option value="center">Centre</option>
      <option value="right">Right</option>
      <option value="justify">Justify</option>
    `;
    alignmentSelect.value = defaults.alignment;

    const typographyGrid = document.createElement('div');
    typographyGrid.className = 'experiment-title-typography-toolbar';
    typographyGrid.append(
      createIconControl('fas fa-heading', 'Heading level', headingLevelSelect),
      createIconControl('fas fa-font', 'Font family', fontFamilySelect),
      createIconControl('fas fa-text-height', 'Font size in points', fontSizeInput),
      createIconControl('fas fa-align-left', 'Text alignment', alignmentSelect),
      emphasisButtons,
      themeColor.label,
      textColorControl,
      noBackground.label,
      backgroundColorControl,
      createIconControl('fas fa-fill-drip', 'Background coverage', backgroundCoverageSelect),
    );

    const preview = document.createElement('div');
    preview.className = 'experiment-title-heading-preview';
    const previewText = document.createElement('span');
    previewText.textContent = this.getCurrentTitle();
    preview.appendChild(previewText);

    const status = document.createElement('span');
    status.className = 'date-reference-target-status';
    status.setAttribute('aria-live', 'polite');
    const initialStatus = 'Ctrl+Alt+T inserts the title using the saved defaults.';
    status.textContent = initialStatus;

    // Transparently move presets created by older versions from this browser
    // into the account-backed JSON so SQL backups and other devices receive them.
    if (accountPresets === null && presets.length > 0) {
      void savePresets(presets)
        .then(() => {
          if (status.textContent === initialStatus) {
            status.textContent = 'Saved title styles moved to your account.';
          }
        })
        .catch(() => {
          if (status.textContent === initialStatus) {
            status.textContent = 'Saved title styles remain available in this browser only.';
          }
        });
    }

    const actions = document.createElement('div');
    actions.className = 'date-reference-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-secondary';
    cancelButton.textContent = 'Cancel';
    const saveDefaultButton = document.createElement('button');
    saveDefaultButton.type = 'button';
    saveDefaultButton.className = 'btn btn-outline-primary';
    saveDefaultButton.textContent = 'Save as default';
    const insertButton = document.createElement('button');
    insertButton.type = 'button';
    insertButton.className = 'btn btn-primary';
    insertButton.textContent = 'Insert title';
    actions.append(cancelButton, saveDefaultButton, insertButton);

    dialog.append(
      title,
      explanation,
      createField('Heading text', headingTextInput),
      createControlGroup('Saved title styles', presetRow),
      typographyGrid,
      preview,
      status,
      actions,
    );
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const readControls = (): ExperimentTitleDefaults => normalizeDefaults({
      headingLevel: Number(headingLevelSelect.value),
      fontFamily: fontFamilySelect.value,
      fontSize: Number(fontSizeInput.value),
      useThemeColor: themeColor.input.checked,
      textColor: textColorInput.value,
      useBackgroundColor: !noBackground.input.checked,
      backgroundColor: backgroundColorInput.value,
      backgroundCoverage: backgroundCoverageSelect.value as BackgroundCoverage,
      bold: bold.input.checked,
      italic: italic.input.checked,
      underline: underline.input.checked,
      alignment: alignmentSelect.value as HeadingAlignment,
    });
    const updatePreview = (): void => {
      const controls = readControls();
      preview.style.cssText = getHeadingStyle(controls);
      previewText.style.cssText = getTitleTextStyle(controls);
      previewText.textContent = headingTextInput.value.trim() || 'Heading preview';
      textColorInput.disabled = themeColor.input.checked;
      backgroundColorInput.disabled = noBackground.input.checked;
      backgroundCoverageSelect.disabled = noBackground.input.checked;
      textColorControl.classList.toggle('is-disabled', textColorInput.disabled);
      backgroundColorControl.classList.toggle('is-disabled', backgroundColorInput.disabled);
      textColorControl.style.setProperty('--selected-color', textColorInput.value);
      backgroundColorControl.style.setProperty('--selected-color', backgroundColorInput.value);
    };
    const applyControls = (values: ExperimentTitleDefaults): void => {
      headingLevelSelect.value = String(values.headingLevel);
      fontFamilySelect.value = values.fontFamily;
      fontSizeInput.value = String(values.fontSize);
      themeColor.input.checked = values.useThemeColor;
      textColorInput.value = values.textColor;
      noBackground.input.checked = !values.useBackgroundColor;
      backgroundColorInput.value = values.backgroundColor;
      backgroundCoverageSelect.value = values.backgroundCoverage;
      bold.input.checked = values.bold;
      italic.input.checked = values.italic;
      underline.input.checked = values.underline;
      alignmentSelect.value = values.alignment;
      updatePreview();
    };
    const renderPresets = (selectedName = ''): void => {
      const customOption = document.createElement('option');
      customOption.value = '';
      customOption.textContent = 'Custom / saved default';
      presetSelect.replaceChildren(customOption);
      presets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.name;
        option.textContent = preset.name;
        presetSelect.appendChild(option);
      });
      presetSelect.value = selectedName;
      deletePresetButton.disabled = !presetSelect.value;
    };
    // Same discard-confirmation the spreadsheet editor and "Insert Note"
    // dialog already have -- this dialog previously closed silently on
    // Escape/backdrop-click/Cancel with an edited heading/style pending.
    let hasChanges = false;
    const close = (force = false): void => {
      if (!force && hasChanges && !window.confirm('Discard unsaved changes to this title?')) return;
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
      this.editor.focus();
    };
    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { close(); return; }
      trapTabFocus(dialog, event);
    };

    dialog.addEventListener('input', event => {
      hasChanges = true;
      updatePreview();
      if (!presetRow.contains(event.target as Node)) {
        presetSelect.value = '';
        deletePresetButton.disabled = true;
      }
    });
    dialog.addEventListener('change', event => {
      hasChanges = true;
      updatePreview();
      if (!presetRow.contains(event.target as Node)) {
        presetSelect.value = '';
        deletePresetButton.disabled = true;
      }
    });
    presetSelect.addEventListener('change', () => {
      const preset = presets.find(candidate => candidate.name === presetSelect.value);
      deletePresetButton.disabled = !preset;
      if (!preset) {
        presetNameInput.value = '';
        return;
      }
      presetNameInput.value = preset.name;
      applyControls(preset.defaults);
      status.textContent = `Loaded title style “${preset.name}”.`;
    });
    savePresetButton.addEventListener('click', async () => {
      const name = presetNameInput.value.trim();
      if (!name) {
        status.textContent = 'Enter a name before saving this title style.';
        presetNameInput.focus();
        return;
      }
      const existingIndex = presets.findIndex(
        preset => preset.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
      );
      const preset = { name, defaults: readControls() };
      const updatedPresets = [...presets];
      if (existingIndex >= 0) {
        updatedPresets[existingIndex] = preset;
      } else if (presets.length < MAX_TITLE_PRESETS) {
        updatedPresets.push(preset);
      } else {
        status.textContent = `You can save up to ${MAX_TITLE_PRESETS} title styles.`;
        return;
      }
      savePresetButton.disabled = true;
      try {
        await savePresets(updatedPresets);
        presets = updatedPresets;
        renderPresets(name);
        status.textContent = existingIndex >= 0
          ? `Updated account title style “${name}”.`
          : `Saved account title style “${name}”.`;
      } catch {
        status.textContent = 'Could not save this title style to your account.';
      } finally {
        savePresetButton.disabled = false;
      }
    });
    deletePresetButton.addEventListener('click', async () => {
      const name = presetSelect.value;
      if (!name) return;
      const updatedPresets = presets.filter(preset => preset.name !== name);
      deletePresetButton.disabled = true;
      try {
        await savePresets(updatedPresets);
        presets = updatedPresets;
        renderPresets();
        presetNameInput.value = '';
        status.textContent = `Removed account title style “${name}”.`;
      } catch {
        status.textContent = 'Could not remove this title style from your account.';
      } finally {
        deletePresetButton.disabled = !presetSelect.value;
      }
    });
    cancelButton.addEventListener('click', () => close());
    saveDefaultButton.addEventListener('click', async () => {
      saveDefaultButton.disabled = true;
      try {
        await saveDefaults(readControls());
        status.textContent = 'Default title formatting saved for your account.';
      } catch {
        status.textContent = 'Could not save title defaults for your account.';
      } finally {
        saveDefaultButton.disabled = false;
      }
    });
    insertButton.addEventListener('click', () => {
      this.insert(readControls(), headingTextInput.value);
      close(true);
    });
    document.addEventListener('keydown', handleKeydown);
    renderPresets();
    updatePreview();
    headingTextInput.focus();
    headingTextInput.select();
  }

  private getCurrentTitle(): string {
    return document.getElementById('documentTitle')?.textContent?.trim() || 'Untitled';
  }

  private getUniqueHeadingId(): string {
    const base = `experiment-title-${entity.id ?? 'current'}`;
    let candidate = base;
    let suffix = 2;
    while (this.editor.getDoc().getElementById(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private insert(defaults: ExperimentTitleDefaults, headingText: string): void {
    const headingLevel = defaults.headingLevel;
    const headingId = this.getUniqueHeadingId();
    const title = headingText.trim() || this.getCurrentTitle();
    const titleTextStyle = getTitleTextStyle(defaults);
    const titleHtml = titleTextStyle
      ? `<span style="${escapeHTML(titleTextStyle)}">${escapeHTML(title)}</span>`
      : escapeHTML(title);
    const html = [
      `<h${headingLevel} id="${headingId}" style="${escapeHTML(getHeadingStyle(defaults))}">`,
      `${titleHtml}</h${headingLevel}>`,
      '<p><br data-mce-bogus="1"></p>',
    ].join('');
    this.editor.execCommand('mceInsertContent', false, html);
  }
}
