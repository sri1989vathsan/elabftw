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
  pasteSpreadsheetRange,
  spreadsheetFromClipboard,
  spreadsheetFromFlattenedClipboard,
  spreadsheetToHTML,
  SpreadsheetData,
  WELL_PLATE_PRESETS,
} from '../inline-spreadsheet';
import { escapeHTML } from '../misc';
import { RICH_SELECTION_ATTRIBUTE } from '../ClipboardContent';

interface PdfTableDialogData {
  columns: string;
}

function spreadsheetColumnLabel(index: number): string {
  let label = '';
  let current = index;
  do {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return label;
}

function getFormulaSpreadsheetCoordinates(
  table: HTMLTableElement,
  cell: HTMLTableCellElement,
): { col: number; row: number } | null {
  const visualRow = Array.from(table.rows).indexOf(cell.parentElement as HTMLTableRowElement);
  const kind = table.dataset.spreadsheetStyle;
  const row = kind === 'notebook' ? visualRow : visualRow - 1;
  const col = kind === 'notebook' ? cell.cellIndex : cell.cellIndex - 1;
  return row >= 0 && col >= 0 ? { col, row } : null;
}

function replaceFormulaSpreadsheetRange(
  editor: Editor,
  table: HTMLTableElement,
  cell: HTMLTableCellElement,
  source: SpreadsheetData,
): boolean {
  const coordinates = getFormulaSpreadsheetCoordinates(table, cell);
  if (!coordinates) return false;
  const updated = pasteSpreadsheetRange(
    extractFromTable(table),
    source,
    coordinates.col,
    coordinates.row,
  );
  const container = editor.getDoc().createElement('div');
  container.innerHTML = spreadsheetToHTML(updated, updated.data);
  const replacement = container.firstElementChild as HTMLTableElement | null;
  if (!replacement) return false;
  table.replaceWith(replacement);

  const visualRow = coordinates.row + (updated.kind === 'notebook' ? 0 : 1);
  const visualCol = coordinates.col + (updated.kind === 'notebook' ? 0 : 1);
  const replacementCell = replacement.rows[visualRow]?.cells[visualCol];
  if (replacementCell) editor.selection.setCursorLocation(replacementCell, 0);
  return true;
}

function tableHasMergedCells(table: HTMLTableElement): boolean {
  return Array.from(table.querySelectorAll<HTMLTableCellElement>('td, th')).some(cell => (
    cell.colSpan > 1 || cell.rowSpan > 1
  ));
}

function createDestinationCell(
  row: HTMLTableRowElement,
  tagName: 'TD' | 'TH',
): HTMLTableCellElement {
  const cell = row.ownerDocument.createElement(tagName.toLowerCase()) as HTMLTableCellElement;
  row.appendChild(cell);
  return cell;
}

function pasteIntoHtmlTable(
  targetTable: HTMLTableElement,
  targetCell: HTMLTableCellElement,
  source: SpreadsheetData,
): HTMLTableCellElement | null {
  if (tableHasMergedCells(targetTable)) return null;
  const targetRow = targetCell.parentElement as HTMLTableRowElement | null;
  const targetSection = targetRow?.parentElement;
  if (!targetRow || !targetSection) return null;
  const sectionRows = Array.from(targetSection.children)
    .filter((element): element is HTMLTableRowElement => element.tagName === 'TR');
  const startRow = sectionRows.indexOf(targetRow);
  const startCol = targetCell.cellIndex;
  if (startRow < 0 || startCol < 0) return null;
  const newCellTag = targetCell.tagName === 'TH' ? 'TH' : 'TD';
  let lastCell: HTMLTableCellElement | null = targetCell;

  for (let rowOffset = 0; rowOffset < source.rows; rowOffset++) {
    let destinationRow = sectionRows[startRow + rowOffset];
    if (!destinationRow) {
      destinationRow = targetRow.ownerDocument.createElement('tr');
      targetSection.appendChild(destinationRow);
      sectionRows.push(destinationRow);
    }
    while (destinationRow.cells.length < startCol + source.cols) {
      createDestinationCell(destinationRow, newCellTag);
    }
    for (let colOffset = 0; colOffset < source.cols; colOffset++) {
      const destinationCell = destinationRow.cells[startCol + colOffset];
      const value = String(source.data[rowOffset]?.[colOffset] ?? '');
      destinationCell.innerHTML = escapeHTML(value).replace(/\r?\n/g, '<br>');
      const style = source.cellStyles?.[
        `${spreadsheetColumnLabel(colOffset)}${rowOffset + 1}`
      ];
      if (style) destinationCell.setAttribute('style', style);
      lastCell = destinationCell;
    }
  }
  return lastCell;
}

/**
 * Return true only when the rich clipboard payload represents one table by
 * itself. Mixed selections (paragraph + table + paragraph, for example) must
 * be left to TinyMCE so all selected content and formatting are retained.
 */
function isStandaloneClipboardTable(html: string): boolean {
  if (!/<table[\s>]/i.test(html)) return false;
  const clipboardDocument = new DOMParser().parseFromString(html, 'text/html');
  const body = clipboardDocument.body;
  const tables = body.querySelectorAll('table');
  if (tables.length !== 1) return false;

  const table = tables[0];
  let current: Element = table;
  while (current.parentElement && current.parentElement !== body) {
    const parent = current.parentElement;
    const hasMeaningfulSibling = Array.from(parent.childNodes).some(node => {
      if (node === current) return false;
      if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
      return node.nodeType === Node.ELEMENT_NODE
        && !['META', 'STYLE'].includes((node as Element).tagName);
    });
    if (hasMeaningfulSibling) return false;
    current = parent;
  }

  return !Array.from(body.childNodes).some(node => {
    if (node === current) return false;
    if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
    return node.nodeType === Node.ELEMENT_NODE
      && !['META', 'STYLE'].includes((node as Element).tagName);
  });
}

export function registerSpreadsheetExtension(editor: Editor): void {
  const openStandardTableDialog = (): void => {
    editor.windowManager.open({
      title: 'Insert table',
      body: {
        type: 'panel',
        items: [
          { type: 'input', name: 'rows', label: 'Rows', inputMode: 'numeric' },
          { type: 'input', name: 'columns', label: 'Columns', inputMode: 'numeric' },
        ],
      },
      initialData: { rows: '3', columns: '3' },
      buttons: [
        { type: 'cancel', text: 'Cancel' },
        { type: 'submit', text: 'Insert', buttonType: 'primary' },
      ],
      onSubmit: api => {
        const data = api.getData();
        const rows = Math.max(1, Math.min(100, Number.parseInt(data.rows, 10) || 3));
        const columns = Math.max(1, Math.min(100, Number.parseInt(data.columns, 10) || 3));
        editor.execCommand('mceInsertTable', false, { rows, columns });
        api.close();
      },
    });
  };
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

  editor.ui.registry.addMenuButton('insert-data-table', {
    icon: 'table',
    tooltip: 'Insert a table, spreadsheet or well plate',
    fetch: callback => {
      const existingTable = editor.selection.getNode()
        .closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
      const items = [];
      if (existingTable) {
        items.push({
          type: 'menuitem' as const,
          text: 'Edit selected spreadsheet…',
          icon: 'edit-block',
          onAction: () => openInlineSpreadsheet(extractFromTable(existingTable), existingTable),
        });
        items.push({ type: 'separator' as const });
      }
      items.push({
        type: 'menuitem',
        text: 'Table…',
        icon: 'table',
        onAction: openStandardTableDialog,
      },
      {
        type: 'nestedmenuitem',
        text: 'Spreadsheet',
        icon: 'table',
        getSubmenuItems: () => [
          {
            type: 'menuitem',
            text: 'Custom spreadsheet…',
            onAction: () => openInlineSpreadsheet(emptySpreadsheetData()),
          },
          {
            type: 'menuitem',
            text: 'Benchling-style data table',
            onAction: () => openInlineSpreadsheet(createNotebookSpreadsheetData()),
          },
        ],
      },
      {
        type: 'nestedmenuitem',
        text: 'Well plate',
        icon: 'table',
        getSubmenuItems: () => WELL_PLATE_PRESETS.map(preset => ({
          type: 'menuitem',
          text: `${preset.wells}-well plate (${preset.rows} × ${preset.cols})`,
          onAction: () => openInlineSpreadsheet(createWellPlateSpreadsheetData(preset.wells)),
        })),
      });
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
    const spreadsheetPasteHandler = (event: ClipboardEvent): void => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const plainText = clipboard.getData('text/plain');
      const normalizedPlainText = normalizePdfPrivateUseText(plainText);
      const richClipboardHtml = clipboard.getData('text/html');
      const selectedCell = editor.selection.getNode()
        .closest('td, th') as HTMLTableCellElement | null;
      const isRichSelection = richClipboardHtml.includes(RICH_SELECTION_ATTRIBUTE);
      if (isRichSelection && (!selectedCell || !isStandaloneClipboardTable(richClipboardHtml))) {
        return;
      }
      // A mixed rich copy belongs to TinyMCE. Converting it here would retain
      // only its first table and silently discard the surrounding content.
      const containsHtmlTable = /<table[\s>]/i.test(richClipboardHtml);
      if (containsHtmlTable && !isStandaloneClipboardTable(richClipboardHtml)) return;

      const spreadsheet = spreadsheetFromClipboard(richClipboardHtml, normalizedPlainText);
      if (spreadsheet) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (selectedCell) {
          const selectedTable = selectedCell.closest('table') as HTMLTableElement | null;
          if (!selectedTable) return;
          let pastedIntoTable = false;
          editor.undoManager.transact(() => {
            if (selectedTable.classList.contains('elabftw-spreadsheet')) {
              pastedIntoTable = replaceFormulaSpreadsheetRange(
                editor,
                selectedTable,
                selectedCell,
                spreadsheet,
              );
              return;
            }
            const lastCell = pasteIntoHtmlTable(selectedTable, selectedCell, spreadsheet);
            if (lastCell) {
              editor.selection.setCursorLocation(lastCell, lastCell.childNodes.length);
              pastedIntoTable = true;
            }
          });
          if (!pastedIntoTable) {
            editor.notificationManager.open({
              text: tableHasMergedCells(selectedTable)
                ? 'Pasting a cell range into a table with merged cells is not supported.'
                : 'The copied cells could not be pasted at this table position.',
              type: 'warning',
              timeout: 3500,
            });
          }
          return;
        }
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
    editor.on('remove', () => {
      editorDocument.removeEventListener('paste', spreadsheetPasteHandler, true);
    });
  });
}
