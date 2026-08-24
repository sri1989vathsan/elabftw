/** Fork-owned inline spreadsheet insertion, editing and clipboard handling. */
import { Editor } from 'tinymce/tinymce';
import {
  createNotebookSpreadsheetData,
  createWellPlateSpreadsheetData,
  emptySpreadsheetData,
  extractFromTable,
  getFlattenedClipboardSuggestion,
  normalizePdfPrivateUseText,
  openSpreadsheetModal,
  spreadsheetFromClipboard,
  spreadsheetFromFlattenedClipboard,
  spreadsheetToHTML,
  SpreadsheetData,
  WELL_PLATE_PRESETS,
} from '../inline-spreadsheet';
import { escapeHTML } from '../misc';
import TableIndentation from '../TableIndentation.class';

interface PdfTableDialogData {
  columns: string;
}

export function registerSpreadsheetExtension(editor: Editor): void {
  const tableIndentation = new TableIndentation(editor);
  const openInlineSpreadsheet = (
    initial: SpreadsheetData,
    existingTable: HTMLTableElement | null = null,
  ): void => {
    const bookmark = editor.selection.getBookmark(2, true);
    openSpreadsheetModal(initial).then(({ raw, computed }) => {
      const html = spreadsheetToHTML(raw, computed);
      editor.focus();
      editor.selection.moveToBookmark(bookmark);
      if (existingTable) editor.selection.select(existingTable);
      editor.execCommand('mceInsertContent', false, html);
      editor.undoManager.add();
    }).catch(() => {
      // User cancelled.
    });
  };

  editor.ui.registry.addMenuButton('inline-sheet', {
    icon: 'table',
    text: 'Spreadsheet',
    tooltip: 'Insert or edit a formula spreadsheet',
    fetch: callback => {
      const existingTable = editor.selection.getNode()
        .closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
      const items = [];
      if (existingTable) {
        items.push({
          type: 'menuitem' as const,
          text: 'Edit selected spreadsheet',
          onAction: () => openInlineSpreadsheet(extractFromTable(existingTable), existingTable),
        });
        items.push({ type: 'separator' as const });
      }

      items.push(
        {
          type: 'menuitem' as const,
          text: 'Custom size…',
          onAction: () => openInlineSpreadsheet(emptySpreadsheetData(), existingTable),
        },
        {
          type: 'menuitem' as const,
          text: 'Benchling-style data table',
          onAction: () => openInlineSpreadsheet(createNotebookSpreadsheetData(), existingTable),
        },
        {
          type: 'nestedmenuitem' as const,
          text: 'Well plate',
          getSubmenuItems: () => WELL_PLATE_PRESETS.map(preset => ({
            type: 'menuitem' as const,
            text: `${preset.wells}-well plate (${preset.rows} × ${preset.cols})`,
            onAction: () => openInlineSpreadsheet(
              createWellPlateSpreadsheetData(preset.wells),
              existingTable,
            ),
          })),
        },
      );
      callback(items);
    },
  });

  editor.on('dblclick', event => {
    const target = (event.target as HTMLElement)
      .closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
    if (target) openInlineSpreadsheet(extractFromTable(target), target);
  });

  editor.on('init', () => {
    const editorDocument = editor.getDoc();
    const spreadsheetTabHandler = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const table = (editor.selection.getNode() as HTMLElement)
        .closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
      if (!table) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      tableIndentation.trackSelectedTable(table);
      if (event.shiftKey) tableIndentation.outdentSelectedTable();
      else tableIndentation.indentSelectedTable();
    };
    const spreadsheetPasteHandler = (event: ClipboardEvent): void => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const plainText = clipboard.getData('text/plain');
      const normalizedPlainText = normalizePdfPrivateUseText(plainText);
      const richClipboardHtml = clipboard.getData('text/html');
      const spreadsheet = spreadsheetFromClipboard(richClipboardHtml, normalizedPlainText);
      if (spreadsheet) {
        event.preventDefault();
        event.stopImmediatePropagation();
        editor.undoManager.transact(() => {
          editor.insertContent(spreadsheetToHTML(spreadsheet, spreadsheet.data));
        });
        return;
      }

      const flattened = getFlattenedClipboardSuggestion(normalizedPlainText);
      if (!flattened) {
        if (normalizedPlainText === plainText) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        editor.undoManager.transact(() => {
          editor.insertContent(escapeHTML(normalizedPlainText).replace(/\r?\n/g, '<br>'));
        });
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      const bookmark = editor.selection.getBookmark(2, true);
      editor.windowManager.open({
        title: 'Paste PDF table',
        size: 'normal',
        body: {
          type: 'panel',
          items: [{
            type: 'input',
            name: 'columns',
            label: `${flattened.cells} clipboard cells — number of columns`,
          }],
        },
        initialData: { columns: String(flattened.columns) },
        buttons: [
          { type: 'cancel', text: 'Cancel' },
          { type: 'submit', text: 'Paste table', primary: true },
        ],
        onSubmit: api => {
          const data = api.getData() as PdfTableDialogData;
          const columns = parseInt(data.columns, 10);
          if (!Number.isInteger(columns) || columns < 2 || columns > 100) {
            editor.notificationManager.open({
              text: 'Enter a column count between 2 and 100.',
              type: 'error',
              timeout: 2500,
            });
            return;
          }
          const recovered = spreadsheetFromFlattenedClipboard(
            normalizedPlainText,
            columns,
            richClipboardHtml,
          );
          if (!recovered) return;
          editor.focus();
          editor.selection.moveToBookmark(bookmark);
          editor.undoManager.transact(() => {
            editor.insertContent(spreadsheetToHTML(recovered, recovered.data));
          });
          api.close();
        },
      });
    };
    editorDocument.addEventListener('paste', spreadsheetPasteHandler, true);
    editorDocument.addEventListener('keydown', spreadsheetTabHandler, true);
    editor.on('remove', () => {
      editorDocument.removeEventListener('paste', spreadsheetPasteHandler, true);
      editorDocument.removeEventListener('keydown', spreadsheetTabHandler, true);
    });
  });
}
