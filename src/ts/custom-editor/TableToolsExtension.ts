/** Fork-owned table indentation and direct property shortcuts. */
import { Editor } from 'tinymce/tinymce';
import TableIndentation from '../TableIndentation.class';
import {
  copiedContentAsPlainText,
  prepareCopiedContent,
  writeRangeToClipboardEvent,
  writeRichClipboard,
} from '../ClipboardContent';
import { EDITOR_COLLAPSED_ATTRIBUTE, installTableCollapse } from '../TableCollapse';

export function registerTableToolsExtension(editor: Editor): void {
  const tableIndentation = new TableIndentation(editor);
  let lastSelectedTable: HTMLTableElement | null = null;
  let lastMixedSelectionRange: Range | null = null;
  let copyFallbackInProgress = false;

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

  const copyContainer = async(container: HTMLElement, successMessage: string): Promise<void> => {
    prepareCopiedContent(container);
    const html = container.innerHTML;
    const plainText = copiedContentAsPlainText(container);

    if (await writeRichClipboard(html, plainText)) {
      editor.notificationManager.open({ text: successMessage, type: 'success', timeout: 1800 });
      return;
    }

    // Rich clipboard access can be unavailable inside an editor iframe.
    // Copy the cleaned clone with the synchronous native clipboard command.
    copyFallbackInProgress = true;
    container.contentEditable = 'true';
    container.style.cssText = 'position:fixed;left:-9999px;top:0;';
    editor.getBody().append(container);
    const range = editor.getDoc().createRange();
    range.selectNodeContents(container);
    const selection = editor.getDoc().getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const copied = editor.getDoc().execCommand('copy');
    container.remove();
    copyFallbackInProgress = false;
    editor.nodeChanged();
    editor.notificationManager.open({
      text: copied ? successMessage : 'Unable to copy content',
      type: copied ? 'success' : 'error',
      timeout: 2400,
    });
  };

  const copyWholeTable = async(): Promise<void> => {
    const table = selectedTable();
    if (!table) return;
    const container = editor.getDoc().createElement('div');
    const clone = table.cloneNode(true) as HTMLTableElement;
    container.append(clone);
    await copyContainer(container, 'Table copied');
  };

  const copySelectedContent = async(): Promise<void> => {
    const selection = editor.getDoc().getSelection();
    const range = selection && selection.rangeCount > 0 && !selection.isCollapsed
      ? selection.getRangeAt(0).cloneRange()
      : lastMixedSelectionRange;
    if (!range || range.collapsed) {
      editor.notificationManager.open({
        text: 'Select text and/or tables first',
        type: 'info',
        timeout: 2200,
      });
      return;
    }
    const container = editor.getDoc().createElement('div');
    container.append(range.cloneContents());
    await copyContainer(container, 'Selected content copied with formatting');
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

    const setMixedContentSelection = (anchor: CaretPoint, focus: CaretPoint): Range => {
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
      return selectionRange;
    };
    const removeTableCollapse = installTableCollapse(
      editor.getBody(),
      EDITOR_COLLAPSED_ATTRIBUTE,
      table => {
        lastSelectedTable = table;
        unwrapLegacyCollapsibleTable(table);
      },
    );
    const mixedSelectionStartHandler = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      lastMixedSelectionRange = null;
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
      lastMixedSelectionRange = setMixedContentSelection(mixedSelectionAnchor, focus).cloneRange();
    };
    const mixedSelectionEndHandler = (event: MouseEvent): void => {
      if (selectingAcrossTable) {
        event.stopPropagation();
        event.stopImmediatePropagation();
        const range = lastMixedSelectionRange?.cloneRange();
        if (range) {
          editor.getWin().requestAnimationFrame(() => {
            const selection = editorDocument.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          });
        }
      }
      mixedSelectionAnchor = null;
      selectingAcrossTable = false;
    };
    const richSelectionCopyHandler = (event: ClipboardEvent): void => {
      if (copyFallbackInProgress) return;
      const selection = editorDocument.getSelection();
      const range = selection && selection.rangeCount > 0 && !selection.isCollapsed
        ? selection.getRangeAt(0)
        : lastMixedSelectionRange;
      if (!range) return;
      writeRangeToClipboardEvent(event, range);
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
    editorDocument.addEventListener('mousemove', mixedSelectionMoveHandler, true);
    editorDocument.addEventListener('mouseup', mixedSelectionEndHandler, true);
    editorDocument.addEventListener('copy', richSelectionCopyHandler, true);
    editorDocument.addEventListener('keydown', tableTabHandler, true);
    editor.on('remove', () => {
      editorDocument.removeEventListener('mousedown', mixedSelectionStartHandler, true);
      removeTableCollapse();
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
  editor.ui.registry.addButton('copy-rich-selection', {
    icon: 'copy',
    tooltip: 'Copy selected text and tables with formatting',
    onAction: () => void copySelectedContent(),
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
