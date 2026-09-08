/** Insert an editable, linkable note callout into the entity body. */
import { Editor } from 'tinymce/tinymce';
import { escapeHTML } from '../misc';
import { getAccountEditorDefault, saveAccountEditorDefault } from '../editor-defaults';

interface NoteDefaults {
  title: string;
  includeInToc: boolean;
  headingLevel: string;
}

interface NoteDialogData {
  title: string;
  includeInToc: boolean;
  headingLevel: string;
  content: string;
  saveAsDefault: boolean;
}

const FALLBACK_NOTE_DEFAULTS: NoteDefaults = {
  title: 'Note',
  includeInToc: true,
  headingLevel: '3',
};

function getNoteDefaults(): NoteDefaults {
  const saved = getAccountEditorDefault<NoteDefaults>('note');
  return {
    title: typeof saved?.title === 'string' && saved.title.trim()
      ? saved.title.trim().slice(0, 255)
      : FALLBACK_NOTE_DEFAULTS.title,
    includeInToc: saved?.includeInToc !== false,
    headingLevel: typeof saved?.headingLevel === 'string'
      && /^[2-6]$/.test(saved.headingLevel)
      ? saved.headingLevel
      : FALLBACK_NOTE_DEFAULTS.headingLevel,
  };
}

function createNoteId(editor: Editor, title: string): string {
  const stem = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'note';
  let candidate = `note-${stem}`;
  let suffix = 2;
  while (editor.getBody().querySelector(`#${CSS.escape(candidate)}`)) {
    candidate = `note-${stem}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function registerNoteExtension(editor: Editor): void {
  const insertNote = (
    defaults: NoteDefaults,
    content: string,
    selectedHtml = '',
    selectedText = '',
  ): void => {
    const title = defaults.title.trim() || 'Note';
    const level = /^[2-6]$/.test(defaults.headingLevel) ? defaults.headingLevel : '3';
    const heading = defaults.includeInToc
      ? `<h${level} class="elabftw-note-heading" id="${createNoteId(editor, title)}">${escapeHTML(title)}</h${level}>`
      : `<div class="elabftw-note-heading">${escapeHTML(title)}</div>`;
    const contentUnchanged = Boolean(selectedHtml) && content.trim() === selectedText;
    const body = contentUnchanged
      ? selectedHtml
      : escapeHTML(content.trim()).replaceAll('\n', '<br>');
    const noteBody = body || '<br data-mce-bogus="1">';

    editor.undoManager.transact(() => {
      editor.execCommand(
        'mceInsertContent',
        false,
        `<div class="elabftw-note-block">${heading}<div class="elabftw-note-content">${noteBody}</div></div><p><br data-mce-bogus="1"></p>`,
      );
    });
    window.dispatchEvent(new CustomEvent('editor-headings-changed'));
  };

  const insertUsingDefaults = (): void => {
    const selectedHtml = editor.selection.getContent({ format: 'html' }).trim();
    const selectedText = editor.selection.getContent({ format: 'text' }).trim();
    insertNote(getNoteDefaults(), selectedText, selectedHtml, selectedText);
  };

  const openDialog = (dataOverride?: NoteDialogData): void => {
    const defaults = getNoteDefaults();
    const bookmark = editor.selection.getBookmark(2, true);
    const selectedHtml = editor.selection.getContent({ format: 'html' }).trim();
    const selectedText = editor.selection.getContent({ format: 'text' }).trim();
    const initialData: NoteDialogData = dataOverride ?? {
      title: defaults.title,
      includeInToc: defaults.includeInToc,
      headingLevel: defaults.headingLevel,
      content: selectedText,
      saveAsDefault: false,
    };
    let lastData = initialData;

    editor.windowManager.open({
      title: 'Insert note',
      size: 'normal',
      body: {
        type: 'panel',
        items: [
          {
            type: 'input',
            name: 'title',
            label: 'Note title',
          },
          {
            type: 'checkbox',
            name: 'includeInToc',
            label: 'Include note title in the Table of Contents',
          },
          {
            type: 'selectbox',
            name: 'headingLevel',
            label: 'Heading level (when included)',
            items: [
              { text: 'Heading 2', value: '2' },
              { text: 'Heading 3', value: '3' },
              { text: 'Heading 4', value: '4' },
              { text: 'Heading 5', value: '5' },
              { text: 'Heading 6', value: '6' },
            ],
          },
          {
            type: 'textarea',
            name: 'content',
            label: selectedHtml
              ? 'Note text (leave unchanged to retain the selected text formatting)'
              : 'Note text',
          },
          {
            type: 'checkbox',
            name: 'saveAsDefault',
            label: 'Save title and heading options as my account default',
          },
        ],
      },
      initialData,
      buttons: [
        { type: 'cancel', text: 'Cancel' },
        { type: 'submit', text: 'Insert note', primary: true },
      ],
      onChange: api => {
        lastData = api.getData() as NoteDialogData;
      },
      onCancel: () => {
        const changed = lastData.title !== initialData.title
          || lastData.content !== initialData.content
          || lastData.includeInToc !== initialData.includeInToc
          || lastData.headingLevel !== initialData.headingLevel;
        if (changed && !window.confirm('Discard this note?')) {
          // TinyMCE dialogs cannot be kept open past onCancel; reopen with
          // whatever was typed so it isn't silently lost.
          window.setTimeout(() => openDialog(lastData), 0);
        }
      },
      onSubmit: api => {
        const data = api.getData() as NoteDialogData;
        const nextDefaults: NoteDefaults = {
          title: data.title.trim() || 'Note',
          includeInToc: data.includeInToc,
          headingLevel: /^[2-6]$/.test(data.headingLevel) ? data.headingLevel : '3',
        };

        editor.focus();
        editor.selection.moveToBookmark(bookmark);
        insertNote(nextDefaults, data.content, selectedHtml, selectedText);
        if (data.saveAsDefault) {
          void saveAccountEditorDefault('note', nextDefaults)
            .then(() => editor.notificationManager.open({
              text: 'Note defaults saved for your account',
              type: 'success',
              timeout: 2500,
            }))
            .catch(() => editor.notificationManager.open({
              text: 'Could not save note defaults',
              type: 'error',
              timeout: 3500,
            }));
        }
        api.close();
      },
    });
  };

  // Named command so the command palette can invoke this directly instead of
  // locating the toolbar button by its (English, wording-dependent)
  // tooltip/aria-label -- see CommandPalette.class.ts.
  editor.addCommand('elabftwInsertNote', insertUsingDefaults);

  editor.ui.registry.addSplitButton('insert-note', {
    icon: 'comment-add',
    tooltip: 'Insert a note using saved defaults; open the arrow for options (Ctrl+Alt+N)',
    onAction: insertUsingDefaults,
    onItemAction: (_api, value) => {
      if (value === 'insert') insertUsingDefaults();
      if (value === 'options') openDialog();
    },
    fetch: callback => callback([
      {
        type: 'choiceitem',
        text: 'Insert note',
        value: 'insert',
        icon: 'comment-add',
      },
      {
        type: 'choiceitem',
        text: 'Note options…',
        value: 'options',
        icon: 'edit-block',
      },
    ]),
  });
  editor.addShortcut('ctrl+alt+n', 'insert a note box using saved defaults', insertUsingDefaults);
}
