/**
 * Insert the current entity title as a styled, linkable document heading.
 */
import type { Editor } from 'tinymce/tinymce';
import { entity } from './getEntity';
import { escapeHTML } from './misc';

type HeadingAlignment = 'left' | 'center' | 'right' | 'justify';

interface ExperimentTitleDefaults {
  headingLevel: number;
  fontFamily: string;
  fontSize: number;
  useThemeColor: boolean;
  textColor: string;
  useBackgroundColor: boolean;
  backgroundColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  alignment: HeadingAlignment;
}

const TITLE_DEFAULTS_STORAGE_KEY = 'elabftw-experiment-title-heading-defaults-v1';
const FONT_FAMILIES = new Map<string, string>([
  ['', 'Theme default'],
  ['Arial, sans-serif', 'Arial'],
  ['Verdana, sans-serif', 'Verdana'],
  ['Georgia, serif', 'Georgia'],
  ["'Times New Roman', serif", 'Times New Roman'],
  ["'Courier New', monospace", 'Courier New'],
]);
const ALIGNMENTS = new Set<HeadingAlignment>(['left', 'center', 'right', 'justify']);
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
    bold: candidate?.bold !== false,
    italic: candidate?.italic === true,
    underline: candidate?.underline === true,
    alignment: candidate?.alignment && ALIGNMENTS.has(candidate.alignment)
      ? candidate.alignment
      : fallback.alignment,
  };
}

function getDefaults(): ExperimentTitleDefaults {
  try {
    const stored = localStorage.getItem(TITLE_DEFAULTS_STORAGE_KEY);
    if (stored) return normalizeDefaults(JSON.parse(stored) as Partial<ExperimentTitleDefaults>);
  } catch {
    // A malformed or unavailable local preference must not block title insertion.
  }
  return getFallbackDefaults();
}

function saveDefaults(defaults: ExperimentTitleDefaults): void {
  localStorage.setItem(TITLE_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
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
  if (defaults.useBackgroundColor) {
    declarations.push(`background-color:${defaults.backgroundColor}`);
  }
  return declarations.join(';');
}

function createField(labelText: string, control: HTMLElement): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'date-reference-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  field.append(label, control);
  return field;
}

function createCheckbox(labelText: string, checked: boolean): {
  label: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const label = document.createElement('label');
  label.className = 'date-reference-heading-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(input, text);
  return { label, input };
}

export default class ExperimentTitleEditor {
  constructor(private editor: Editor) {}

  public insertUsingDefaults(): void {
    this.insert(getDefaults(), this.getCurrentTitle());
  }

  public openDialog(): void {
    const defaults = getDefaults();
    const overlay = document.createElement('div');
    overlay.className = 'date-reference-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'date-reference-dialog';
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
      option.textContent = `Heading ${level}`;
      headingLevelSelect.appendChild(option);
    }
    headingLevelSelect.value = String(defaults.headingLevel);

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

    const colorRow = document.createElement('div');
    colorRow.className = 'date-reference-heading-row';
    const textColorInput = document.createElement('input');
    textColorInput.type = 'color';
    textColorInput.className = 'form-control';
    textColorInput.value = defaults.textColor;
    const themeColor = createCheckbox('Use theme text colour', defaults.useThemeColor);
    textColorInput.disabled = themeColor.input.checked;
    colorRow.append(themeColor.label, textColorInput);

    const backgroundRow = document.createElement('div');
    backgroundRow.className = 'date-reference-heading-row';
    const backgroundColorInput = document.createElement('input');
    backgroundColorInput.type = 'color';
    backgroundColorInput.className = 'form-control';
    backgroundColorInput.value = defaults.backgroundColor;
    const noBackground = createCheckbox(
      'No background colour',
      !defaults.useBackgroundColor,
    );
    backgroundColorInput.disabled = noBackground.input.checked;
    backgroundRow.append(noBackground.label, backgroundColorInput);

    const emphasisRow = document.createElement('div');
    emphasisRow.className = 'date-reference-heading-row';
    const bold = createCheckbox('Bold', defaults.bold);
    const italic = createCheckbox('Italic', defaults.italic);
    const underline = createCheckbox('Underline', defaults.underline);
    emphasisRow.append(bold.label, italic.label, underline.label);

    const alignmentSelect = document.createElement('select');
    alignmentSelect.className = 'form-control';
    alignmentSelect.innerHTML = `
      <option value="left">Left</option>
      <option value="center">Centre</option>
      <option value="right">Right</option>
      <option value="justify">Justify</option>
    `;
    alignmentSelect.value = defaults.alignment;

    const preview = document.createElement('div');
    preview.className = 'experiment-title-heading-preview';
    preview.textContent = this.getCurrentTitle();

    const status = document.createElement('span');
    status.className = 'date-reference-target-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Ctrl+Alt+T inserts the title using the saved defaults.';

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
      createField('Heading level', headingLevelSelect),
      createField('Font family', fontFamilySelect),
      createField('Font size (pt)', fontSizeInput),
      colorRow,
      backgroundRow,
      emphasisRow,
      createField('Alignment', alignmentSelect),
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
      bold: bold.input.checked,
      italic: italic.input.checked,
      underline: underline.input.checked,
      alignment: alignmentSelect.value as HeadingAlignment,
    });
    const updatePreview = (): void => {
      preview.style.cssText = getHeadingStyle(readControls());
      preview.textContent = headingTextInput.value.trim() || 'Heading preview';
      textColorInput.disabled = themeColor.input.checked;
      backgroundColorInput.disabled = noBackground.input.checked;
    };
    const close = (): void => {
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
      this.editor.focus();
    };
    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };

    dialog.addEventListener('input', updatePreview);
    dialog.addEventListener('change', updatePreview);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    cancelButton.addEventListener('click', close);
    saveDefaultButton.addEventListener('click', () => {
      try {
        saveDefaults(readControls());
        status.textContent = 'Default title formatting saved for future insertions.';
      } catch {
        status.textContent = 'The browser could not save these defaults.';
      }
    });
    insertButton.addEventListener('click', () => {
      this.insert(readControls(), headingTextInput.value);
      close();
    });
    document.addEventListener('keydown', handleKeydown);
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
    const html = [
      `<h${headingLevel} id="${headingId}" style="${escapeHTML(getHeadingStyle(defaults))}">`,
      `${escapeHTML(title)}</h${headingLevel}>`,
      '<p><br data-mce-bogus="1"></p>',
    ].join('');
    this.editor.execCommand('mceInsertContent', false, html);
  }
}
