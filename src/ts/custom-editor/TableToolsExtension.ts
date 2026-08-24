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

  const unwrapLegacyCollapsibleTable = (table: HTMLTableElement): void => {
    const existing = collapsibleWrapper(table);
    if (!existing) return;
    const container = table.parentElement?.classList.contains('elabftw-table-indent')
      ? table.parentElement
      : table;
    existing.parentNode?.insertBefore(container, existing);
    existing.remove();
  };

  const toggleCompactTable = (): void => {
    const table = selectedTable();
    if (!table) return;
    const bookmark = editor.selection.getBookmark(2, true);
    editor.undoManager.transact(() => {
      // Earlier builds wrapped tables in <details>. Remove that wrapper when
      // encountered, then use a TinyMCE-only state attribute instead. The
      // table remains normal saved HTML and is merely compacted in the editor.
      unwrapLegacyCollapsibleTable(table);
      if (table.dataset.mceElabftwCollapsed === 'true') {
        delete table.dataset.mceElabftwCollapsed;
      } else {
        table.dataset.mceElabftwCollapsed = 'true';
      }
      updateCompactToggle(table);
    });
    editor.selection.moveToBookmark(bookmark);
    editor.nodeChanged();
    editor.focus();
  };

  const updateCompactToggle = (table: HTMLTableElement): void => {
    const button = table.querySelector<HTMLButtonElement>(':scope .elabftw-table-collapse-toggle');
    if (!button) return;
    const collapsed = table.dataset.mceElabftwCollapsed === 'true';
    button.textContent = collapsed ? '▸' : '▾';
    button.title = collapsed ? 'Expand table' : 'Collapse table';
    button.setAttribute('aria-label', button.title);
  };

  const ensureCompactToggle = (table: HTMLTableElement): void => {
    if (table.querySelector(':scope .elabftw-table-collapse-toggle')) return;
    const cornerCell = table.querySelector<HTMLTableCellElement>('th,td');
    if (!cornerCell) return;
    const button = table.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'elabftw-table-collapse-toggle';
    button.contentEditable = 'false';
    button.dataset.mceBogus = 'all';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      lastSelectedTable = table;
      toggleCompactTable();
    });
    cornerCell.prepend(button);
    updateCompactToggle(table);
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
    if (table) {
      lastSelectedTable = table;
      ensureCompactToggle(table);
    }
  });

  editor.on('SetContent', () => {
    editor.getBody().querySelectorAll<HTMLTableElement>('table').forEach(ensureCompactToggle);
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
    items: 'table-select-copy',
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
