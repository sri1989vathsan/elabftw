/** Fork-owned table indentation and direct property shortcuts. */
import { Editor } from 'tinymce/tinymce';
import TableIndentation from '../TableIndentation.class';
import {
  copiedContentAsPlainText,
  prepareCopiedContent,
  removeLegacyTableCollapse,
  RICH_SELECTION_ATTRIBUTE,
  writeRangeToClipboardEvent,
  writeRichClipboard,
} from '../ClipboardContent';

export function registerTableToolsExtension(editor: Editor): void {
  editor.ui.registry.addIcon(
    'elabftw-copy-table',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h7M8 11.5h7M11.5 8v7" stroke="currentColor" stroke-width="1.4"/><rect x="10" y="10" width="10" height="10" rx="1.5" fill="var(--tox-icon-highlight-bg, white)" stroke="currentColor" stroke-width="1.8"/><path d="M13 13h4M13 16h4M15 13v5" stroke="currentColor" stroke-width="1.2"/></svg>',
  );
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

  const copyContainer = async(
    container: HTMLElement,
    successMessage: string,
    markAsMixedSelection = false,
  ): Promise<void> => {
    prepareCopiedContent(container);
    if (markAsMixedSelection) {
      const marker = editor.getDoc().createElement('div');
      marker.setAttribute(RICH_SELECTION_ATTRIBUTE, 'true');
      marker.append(...Array.from(container.childNodes));
      container.append(marker);
    }
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
    const range = lastMixedSelectionRange
      ?? (selection && selection.rangeCount > 0 && !selection.isCollapsed
        ? selection.getRangeAt(0).cloneRange()
        : null);
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
    await copyContainer(container, 'Selected content copied with formatting', true);
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
    let mixedSelectionAnchorTable: HTMLTableElement | null = null;
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

    const createMixedContentRange = (anchor: CaretPoint, focus: CaretPoint): Range => {
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
      return selectionRange;
    };

    const applyMixedContentSelection = (selectionRange: Range): void => {
      const selection = editorDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(selectionRange);
    };
    removeLegacyTableCollapse(editor.getBody());
    const mixedSelectionStartHandler = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      lastMixedSelectionRange = null;
      const target = event.target as Element | null;
      mixedSelectionAnchorTable = target?.closest?.('table') as HTMLTableElement | null;
      mixedSelectionAnchor = caretPointFromCoordinates(event.clientX, event.clientY);
      selectingAcrossTable = false;
    };
    const mixedSelectionMoveHandler = (event: MouseEvent): void => {
      if (!mixedSelectionAnchor || (event.buttons & 1) === 0) return;
      const target = event.target as Element | null;
      const focus = caretPointFromCoordinates(event.clientX, event.clientY);
      if (!focus) return;
      const candidate = createMixedContentRange(mixedSelectionAnchor, focus);
      const targetTable = target?.closest?.('table') as HTMLTableElement | null;
      const crossesTableBoundary = mixedSelectionAnchorTable
        ? targetTable !== mixedSelectionAnchorTable
        : Array.from(editor.getBody().querySelectorAll('table'))
          .some(table => candidate.intersectsNode(table));
      if (!selectingAcrossTable && !crossesTableBoundary) return;
      selectingAcrossTable = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      applyMixedContentSelection(candidate);
      lastMixedSelectionRange = candidate.cloneRange();
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
      mixedSelectionAnchorTable = null;
      selectingAcrossTable = false;
    };
    const richSelectionCopyHandler = (event: ClipboardEvent): void => {
      if (copyFallbackInProgress) return;
      const selection = editorDocument.getSelection();
      const range = lastMixedSelectionRange
        ?? (selection && selection.rangeCount > 0 && !selection.isCollapsed
          ? selection.getRangeAt(0)
          : null);
      if (!range) return;
      writeRangeToClipboardEvent(event, range);
    };
    editorDocument.addEventListener('mousedown', mixedSelectionStartHandler, true);
    editorDocument.addEventListener('mousemove', mixedSelectionMoveHandler, true);
    editorDocument.addEventListener('mouseup', mixedSelectionEndHandler, true);
    editorDocument.addEventListener('copy', richSelectionCopyHandler, true);
    // Leave Tab/Shift+Tab to TinyMCE so they navigate table cells. Table
    // indentation is intentionally available only through the toolbar buttons.
    editor.on('remove', () => {
      editorDocument.removeEventListener('mousedown', mixedSelectionStartHandler, true);
      editorDocument.removeEventListener('mousemove', mixedSelectionMoveHandler, true);
      editorDocument.removeEventListener('mouseup', mixedSelectionEndHandler, true);
      editorDocument.removeEventListener('copy', richSelectionCopyHandler, true);
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
    icon: 'elabftw-copy-table',
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
