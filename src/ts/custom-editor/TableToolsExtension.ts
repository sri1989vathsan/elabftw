/** Fork-owned table indentation and direct property shortcuts. */
import { Editor } from 'tinymce/tinymce';
import TableIndentation from '../TableIndentation.class';

export function registerTableToolsExtension(editor: Editor): void {
  const tableIndentation = new TableIndentation(editor);
  let lastSelectedTable: HTMLTableElement | null = null;

  const selectedTable = (node?: Node | null): HTMLTableElement | null => {
    const element = node?.nodeType === 1
      ? node as Element
      : node?.parentElement ?? editor.selection.getNode() as Element;
    const table = element?.closest?.('table') as HTMLTableElement | null;
    if (table) {
      lastSelectedTable = table;
      return table;
    }
    if (lastSelectedTable && editor.getBody().contains(lastSelectedTable)) {
      return lastSelectedTable;
    }
    lastSelectedTable = null;
    return null;
  };

  const collapsibleWrapper = (table: HTMLTableElement | null): HTMLDetailsElement | null => {
    return table?.closest('details.elabftw-collapsible-table') as HTMLDetailsElement | null;
  };

  const toggleCollapsibleTable = (): void => {
    const table = selectedTable();
    if (!table) return;
    const bookmark = editor.selection.getBookmark(2, true);
    editor.undoManager.transact(() => {
      const existing = collapsibleWrapper(table);
      if (existing) {
        Array.from(existing.childNodes).forEach(child => {
          if (child.nodeType !== 1 || (child as Element).tagName !== 'SUMMARY') {
            existing.parentNode?.insertBefore(child, existing);
          }
        });
        existing.remove();
      } else {
        const details = table.ownerDocument.createElement('details');
        details.className = 'elabftw-collapsible-table';
        details.open = true;
        const summary = table.ownerDocument.createElement('summary');
        summary.className = 'elabftw-collapsible-table-summary';
        summary.textContent = table.querySelector('caption')?.textContent?.trim() || 'Table';
        const container = table.parentElement?.classList.contains('elabftw-table-indent')
          ? table.parentElement
          : table;
        container.parentNode?.insertBefore(details, container);
        details.append(summary, container);
      }
    });
    editor.selection.moveToBookmark(bookmark);
    editor.nodeChanged();
    editor.focus();
  };

  const selectWholeTable = (): void => {
    const table = selectedTable();
    if (!table) return;
    editor.focus();
    editor.selection.select(table);
    editor.nodeChanged();
  };

  editor.on('NodeChange', event => {
    const element = event.element as Element | undefined;
    const table = element?.closest?.('table') as HTMLTableElement | null;
    if (table) lastSelectedTable = table;
  });

  editor.on('init', () => {
    const editorDocument = editor.getDoc();
    const tableTabHandler = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab'
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || event.isComposing
        || event.defaultPrevented
      ) {
        return;
      }

      // A contenteditable iframe can target either the active cell or its
      // editable body. Prefer the native target and fall back to TinyMCE's
      // range so Shift+Tab still finds a table after it has been wrapped.
      const target = event.target as Node | null;
      const table = tableIndentation.trackSelectedTable(target)
        ?? tableIndentation.trackSelectedTable();
      if (!table) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.shiftKey) tableIndentation.outdentSelectedTable();
      else tableIndentation.indentSelectedTable();
    };

    editorDocument.addEventListener('keydown', tableTabHandler, true);
    editor.on('remove', () => {
      editorDocument.removeEventListener('keydown', tableTabHandler, true);
    });
  });

  editor.ui.registry.addButton('table-outdent', {
    icon: 'outdent',
    tooltip: 'Outdent table',
    onAction: () => tableIndentation.outdentSelectedTable(),
    onSetup: api => {
      const update = (event): void => {
        const table = tableIndentation.trackSelectedTable(event.element);
        api.setEnabled(tableIndentation.canOutdent(table));
      };
      api.setEnabled(tableIndentation.canOutdent(tableIndentation.trackSelectedTable()));
      editor.on('NodeChange', update);
      return () => editor.off('NodeChange', update);
    },
  });
  editor.ui.registry.addToggleButton('table-collapse', {
    text: 'Collapse',
    tooltip: 'Make this table collapsible',
    onAction: toggleCollapsibleTable,
    onSetup: api => {
      const update = (): void => {
        const table = selectedTable();
        api.setEnabled(Boolean(table));
        api.setActive(Boolean(collapsibleWrapper(table)));
      };
      update();
      editor.on('NodeChange', update);
      return () => editor.off('NodeChange', update);
    },
  });
  editor.ui.registry.addButton('table-select-copy', {
    text: 'Select table',
    tooltip: 'Select the whole table, then use Copy',
    onAction: selectWholeTable,
    onSetup: api => {
      const update = (event?): void => api.setEnabled(Boolean(selectedTable(event?.element)));
      update();
      editor.on('NodeChange', update);
      return () => editor.off('NodeChange', update);
    },
  });
  editor.ui.registry.addContextToolbar('elabftw-table-actions', {
    predicate: node => Boolean((node as Element).closest?.('table')),
    items: 'table-collapse table-select-copy',
    position: 'node',
    scope: 'node',
  });
  editor.ui.registry.addButton('table-indent', {
    icon: 'indent',
    tooltip: 'Indent table to align with nested bullets',
    onAction: () => tableIndentation.indentSelectedTable(),
    onSetup: api => {
      const update = (event): void => {
        const table = tableIndentation.trackSelectedTable(event.element);
        api.setEnabled(tableIndentation.canIndent(table));
      };
      api.setEnabled(tableIndentation.canIndent(tableIndentation.trackSelectedTable()));
      editor.on('NodeChange', update);
      return () => editor.off('NodeChange', update);
    },
  });
  editor.ui.registry.addButton('cell-properties', {
    text: 'Cell style',
    tooltip: 'Cell background, border style, color and width',
    onAction: () => editor.execCommand('mceTableCellProps'),
    onSetup: api => {
      const update = (event): void => api.setEnabled(Boolean(event.element?.closest?.('td,th')));
      api.setEnabled(Boolean(editor.selection.getNode().closest?.('td,th')));
      editor.on('NodeChange', update);
      return () => editor.off('NodeChange', update);
    },
  });
  editor.ui.registry.addButton('table-properties', {
    text: 'Table style',
    tooltip: 'Table size, alignment, border, background, spacing and caption',
    onAction: () => editor.execCommand('mceTableProps'),
    onSetup: api => {
      const update = (event): void => api.setEnabled(Boolean(event.element?.closest?.('table')));
      api.setEnabled(Boolean(editor.selection.getNode().closest?.('table')));
      editor.on('NodeChange', update);
      return () => editor.off('NodeChange', update);
    },
  });
}
