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
    });
    editor.selection.moveToBookmark(bookmark);
    editor.nodeChanged();
    editor.focus();
  };

  const tableAsPlainText = (table: HTMLTableElement): string => (
    Array.from(table.rows)
      .map(row => Array.from(row.cells).map(cell => cell.innerText).join('\t'))
      .join('\n')
  );

  const copyWholeTable = async(): Promise<void> => {
    const table = selectedTable();
    if (!table) return;
    const clone = table.cloneNode(true) as HTMLTableElement;
    delete clone.dataset.mceElabftwCollapsed;
    const html = clone.outerHTML;
    const plainText = tableAsPlainText(clone);

    try {
      const clipboardItem = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([clipboardItem]);
      editor.notificationManager.open({
        text: 'Table copied',
        type: 'success',
        timeout: 1800,
      });
    } catch {
      // Some browsers disallow the rich Clipboard API inside an editor
      // iframe. Preserve a useful fallback: select the complete table and
      // invoke the native copy command while the toolbar click is active.
      editor.focus();
      editor.selection.select(table);
      const copied = editor.getDoc().execCommand('copy');
      editor.nodeChanged();
      editor.notificationManager.open({
        text: copied ? 'Table copied' : 'Table selected — press Ctrl/Cmd+C',
        type: copied ? 'success' : 'info',
        timeout: 2400,
      });
    }
  };

  editor.on('NodeChange', event => {
    const element = event.element as Element | undefined;
    const table = element?.closest?.('table') as HTMLTableElement | null;
    if (table) lastSelectedTable = table;
  });

  editor.on('init', () => {
    const editorDocument = editor.getDoc();
    type CaretPoint = { node: Node; offset: number };
    let mixedSelectionAnchor: CaretPoint | null = null;
    let selectingAcrossTable = false;

    const caretPointFromCoordinates = (x: number, y: number): CaretPoint | null => {
      const documentWithCaretApi = editorDocument as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const position = documentWithCaretApi.caretPositionFromPoint?.(x, y);
      if (position) return { node: position.offsetNode, offset: position.offset };
      const range = documentWithCaretApi.caretRangeFromPoint?.(x, y);
      return range ? { node: range.startContainer, offset: range.startOffset } : null;
    };

    const setMixedContentSelection = (anchor: CaretPoint, focus: CaretPoint): void => {
      const anchorRange = editorDocument.createRange();
      anchorRange.setStart(anchor.node, anchor.offset);
      anchorRange.collapse(true);
      const focusRange = editorDocument.createRange();
      focusRange.setStart(focus.node, focus.offset);
      focusRange.collapse(true);
      const anchorFirst = anchorRange.compareBoundaryPoints(Range.START_TO_START, focusRange) <= 0;
      const selectionRange = editorDocument.createRange();
      if (anchorFirst) {
        selectionRange.setStart(anchor.node, anchor.offset);
        selectionRange.setEnd(focus.node, focus.offset);
      } else {
        selectionRange.setStart(focus.node, focus.offset);
        selectionRange.setEnd(anchor.node, anchor.offset);
      }
      const selection = editorDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(selectionRange);
    };

    const tableCollapseHandler = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      const table = target?.closest?.('table') as HTMLTableElement | null;
      if (!table) return;
      const cornerCell = table.querySelector<HTMLTableCellElement>(
        ':scope > thead:first-child > tr:first-child > :is(th,td):first-child, :scope > tbody:first-child > tr:first-child > :is(th,td):first-child, :scope > tfoot:first-child > tr:first-child > :is(th,td):first-child',
      );
      const bounds = cornerCell?.getBoundingClientRect();
      if (!bounds) return;
      const inToggle = event.clientX >= bounds.left
        && event.clientX <= bounds.left + 24
        && event.clientY >= bounds.top
        && event.clientY <= bounds.top + 24;
      if (!inToggle) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      lastSelectedTable = table;
      toggleCompactTable();
    };
    const mixedSelectionStartHandler = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      if (target?.closest?.('table')) {
        mixedSelectionAnchor = null;
        return;
      }
      mixedSelectionAnchor = caretPointFromCoordinates(event.clientX, event.clientY);
      selectingAcrossTable = false;
    };
    const mixedSelectionMoveHandler = (event: MouseEvent): void => {
      if (!mixedSelectionAnchor || (event.buttons & 1) === 0) return;
      const target = event.target as Element | null;
      if (target?.closest?.('table')) selectingAcrossTable = true;
      if (!selectingAcrossTable) return;
      const focus = caretPointFromCoordinates(event.clientX, event.clientY);
      if (!focus) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setMixedContentSelection(mixedSelectionAnchor, focus);
    };
    const mixedSelectionEndHandler = (event: MouseEvent): void => {
      if (selectingAcrossTable) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      mixedSelectionAnchor = null;
      selectingAcrossTable = false;
    };
    const richSelectionCopyHandler = (event: ClipboardEvent): void => {
      const selection = editorDocument.getSelection();
      if (!event.clipboardData || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const container = editorDocument.createElement('div');
      container.append(selection.getRangeAt(0).cloneContents());
      if (!container.querySelector('table')) return;
      event.preventDefault();
      event.clipboardData.setData('text/html', container.innerHTML);
      event.clipboardData.setData('text/plain', selection.toString());
    };
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

    editorDocument.addEventListener('mousedown', mixedSelectionStartHandler, true);
    editorDocument.addEventListener('mousedown', tableCollapseHandler, true);
    editorDocument.addEventListener('mousemove', mixedSelectionMoveHandler, true);
    editorDocument.addEventListener('mouseup', mixedSelectionEndHandler, true);
    editorDocument.addEventListener('copy', richSelectionCopyHandler, true);
    editorDocument.addEventListener('keydown', tableTabHandler, true);
    editor.on('remove', () => {
      editorDocument.removeEventListener('mousedown', mixedSelectionStartHandler, true);
      editorDocument.removeEventListener('mousedown', tableCollapseHandler, true);
      editorDocument.removeEventListener('mousemove', mixedSelectionMoveHandler, true);
      editorDocument.removeEventListener('mouseup', mixedSelectionEndHandler, true);
      editorDocument.removeEventListener('copy', richSelectionCopyHandler, true);
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
    text: 'Copy table',
    tooltip: 'Copy the complete table with formatting',
    onAction: () => void copyWholeTable(),
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
