/** Insert an editable, linkable note callout into the entity body. */
import { Editor } from 'tinymce/tinymce';
import { escapeHTML } from '../misc';

interface NoteDialogData {
  title: string;
  includeInToc: boolean;
  headingLevel: string;
  content: string;
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
  const openDialog = (): void => {
    const bookmark = editor.selection.getBookmark(2, true);
    const selectedHtml = editor.selection.getContent({ format: 'html' }).trim();
    const selectedText = editor.selection.getContent({ format: 'text' }).trim();

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
        ],
      },
      initialData: {
        title: 'Note',
        includeInToc: true,
        headingLevel: '3',
        content: selectedText,
      },
      buttons: [
        { type: 'cancel', text: 'Cancel' },
        { type: 'submit', text: 'Insert note', primary: true },
      ],
      onSubmit: api => {
        const data = api.getData() as NoteDialogData;
        const title = data.title.trim() || 'Note';
        const level = /^[2-6]$/.test(data.headingLevel) ? data.headingLevel : '3';
        const heading = data.includeInToc
          ? `<h${level} class="elabftw-note-heading" id="${createNoteId(editor, title)}">${escapeHTML(title)}</h${level}>`
          : `<div class="elabftw-note-heading">${escapeHTML(title)}</div>`;
        const contentUnchanged = Boolean(selectedHtml) && data.content.trim() === selectedText;
        const body = contentUnchanged
          ? selectedHtml
          : escapeHTML(data.content.trim()).replaceAll('\n', '<br>');
        const noteBody = body || '<br data-mce-bogus="1">';

        editor.focus();
        editor.selection.moveToBookmark(bookmark);
        editor.undoManager.transact(() => {
          editor.execCommand(
            'mceInsertContent',
            false,
            `<div class="elabftw-note-block">${heading}<div class="elabftw-note-content">${noteBody}</div></div><p><br data-mce-bogus="1"></p>`,
          );
        });
        api.close();
        window.dispatchEvent(new CustomEvent('editor-headings-changed'));
      },
    });
  };

  editor.ui.registry.addButton('insert-note', {
    icon: 'comment-add',
    tooltip: 'Insert a note box (Ctrl+Alt+N)',
    onAction: openDialog,
  });
  editor.addShortcut('ctrl+alt+n', 'insert a note box', openDialog);
}
