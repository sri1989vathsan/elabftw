/**
 * Fork-owned list behavior for TinyMCE.
 *
 * Keeping this outside tinymce.ts leaves upstream's editor configuration with
 * one registration call instead of the implementation details.
 */
import { Editor } from 'tinymce/tinymce';

const CHECKLIST_CLASS = 'elabftw-checklist';
const CHECKLIST_ITEM_CLASS = 'elabftw-checklist-item';

function checklistFromSelection(editor: Editor): HTMLUListElement | null {
  const node = editor.selection.getNode() as HTMLElement;
  return node.closest(`ul.${CHECKLIST_CLASS}`) as HTMLUListElement | null;
}

function normalizeChecklist(list: HTMLUListElement): void {
  list.classList.add(CHECKLIST_CLASS);
  list.querySelectorAll<HTMLUListElement>('ul').forEach(nestedList => {
    nestedList.classList.add(CHECKLIST_CLASS);
  });
  list.querySelectorAll<HTMLLIElement>('li').forEach(item => {
    if (!item.parentElement?.matches(`ul.${CHECKLIST_CLASS}`)) return;
    item.classList.add(CHECKLIST_ITEM_CLASS);
    item.dataset.checked = item.dataset.checked === 'true' ? 'true' : 'false';
  });
}

function normalizeChecklists(editor: Editor): void {
  editor.getBody().querySelectorAll<HTMLUListElement>(`ul.${CHECKLIST_CLASS}`)
    .forEach(normalizeChecklist);
}

function applyChecklist(editor: Editor, checked = false): void {
  let list = checklistFromSelection(editor);
  if (!list) {
    const currentList = (editor.selection.getNode() as HTMLElement)
      .closest('ul,ol') as HTMLOListElement | HTMLUListElement | null;
    if (!currentList || currentList.tagName === 'OL') {
      editor.execCommand('InsertUnorderedList');
    }
    list = (editor.selection.getNode() as HTMLElement)
      .closest('ul') as HTMLUListElement | null;
  }
  if (!list) return;

  normalizeChecklist(list);
  const selectedItem = (editor.selection.getNode() as HTMLElement)
    .closest(`li.${CHECKLIST_ITEM_CLASS}`) as HTMLLIElement | null;
  if (checked && selectedItem) selectedItem.dataset.checked = 'true';
}

function removeChecklist(editor: Editor): void {
  const list = checklistFromSelection(editor);
  if (!list) return;
  list.querySelectorAll<HTMLLIElement>(`li.${CHECKLIST_ITEM_CLASS}`).forEach(item => {
    item.classList.remove(CHECKLIST_ITEM_CLASS);
    delete item.dataset.checked;
  });
  list.querySelectorAll<HTMLUListElement>(`ul.${CHECKLIST_CLASS}`).forEach(nestedList => {
    nestedList.classList.remove(CHECKLIST_CLASS);
  });
  list.classList.remove(CHECKLIST_CLASS);
  editor.execCommand('RemoveList');
}

function toggleChecklist(editor: Editor): void {
  editor.undoManager.transact(() => {
    if (checklistFromSelection(editor)) {
      removeChecklist(editor);
    } else {
      applyChecklist(editor);
    }
  });
  editor.setDirty(true);
  editor.nodeChanged();
  editor.focus();
}

function handleChecklistClick(editor: Editor, event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const item = target?.closest(`li.${CHECKLIST_ITEM_CLASS}`) as HTMLLIElement | null;
  if (!item || !item.closest(`ul.${CHECKLIST_CLASS}`)) return;

  const offset = event.clientX - item.getBoundingClientRect().left;
  if (offset < -2 || offset > 24) return;

  event.preventDefault();
  event.stopPropagation();
  editor.undoManager.transact(() => {
    item.dataset.checked = item.dataset.checked !== 'true' ? 'true' : 'false';
  });
  editor.setDirty(true);
  editor.nodeChanged();
}

function handleListShortcut(editor: Editor, event: KeyboardEvent): void {
  if ((event.key !== ' ' && event.code !== 'Space')
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || event.isComposing) {
    return;
  }

  const range = editor.selection.getRng();
  if (!range.collapsed) return;
  const block = editor.dom.getParent(range.startContainer, 'p,div') as HTMLElement | null;
  if (!block || block.closest('li,pre,code,table')) return;

  const marker = block.textContent ?? '';
  let command: 'InsertUnorderedList' | 'InsertOrderedList' | 'Checklist' | null = null;
  let checklistChecked = false;
  if (marker === '-') {
    command = 'InsertUnorderedList';
  } else if (marker === '1' || marker === '1.') {
    command = 'InsertOrderedList';
  } else if (marker === '[]' || marker === '[ ]' || marker === '- [ ]') {
    command = 'Checklist';
  } else if (/^(?:- )?\[[xX]\]$/.test(marker)) {
    command = 'Checklist';
    checklistChecked = true;
  }
  if (!command) return;

  const beforeCursor = range.cloneRange();
  beforeCursor.selectNodeContents(block);
  beforeCursor.setEnd(range.startContainer, range.startOffset);
  if (beforeCursor.toString() !== marker) return;

  event.preventDefault();
  editor.undoManager.transact(() => {
    editor.dom.setHTML(block, '<br data-mce-bogus="1">');
    editor.selection.setCursorLocation(block, 0);
    if (command === 'Checklist') {
      applyChecklist(editor, checklistChecked);
    } else {
      editor.execCommand(command);
    }
  });
}

function handleBlockIndentShortcut(editor: Editor, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab'
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || event.defaultPrevented
    || event.isComposing) {
    return false;
  }

  const selectionNode = editor.selection.getNode() as HTMLElement;
  if (selectionNode.closest('td,th,[contenteditable="false"]')) return false;

  const listItem = selectionNode.matches('li') ? selectionNode : selectionNode.closest('li');
  const block = editor.dom.getParent(
    selectionNode,
    'p,h1,h2,h3,h4,h5,h6,blockquote,div,pre',
  );
  if (!listItem && (!block || block === editor.getBody())) return false;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  editor.undoManager.transact(() => {
    editor.execCommand(event.shiftKey ? 'Outdent' : 'Indent');
  });
  editor.nodeChanged();
  return true;
}

export function registerListExtension(editor: Editor): void {
  editor.ui.registry.addIcon(
    'elabftwChecklist',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="2"/><path d="m4.5 7 1.5 1.5L8 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7h9M12 17h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="2"/></svg>',
  );
  editor.ui.registry.addToggleButton('checklist', {
    icon: 'elabftwChecklist',
    tooltip: 'Checklist ([ ] then Space)',
    onAction: () => toggleChecklist(editor),
    onSetup: api => {
      const update = (): void => api.setActive(Boolean(checklistFromSelection(editor)));
      editor.on('NodeChange', update);
      update();
      return () => editor.off('NodeChange', update);
    },
  });

  editor.on('init', () => normalizeChecklists(editor));
  editor.on('click', event => handleChecklistClick(editor, event));
  editor.on('NodeChange', () => normalizeChecklists(editor));
  editor.on('keydown', event => {
    if (handleBlockIndentShortcut(editor, event)) return;
    handleListShortcut(editor, event);
  });
  editor.on('init', () => {
    const editorDocument = editor.getDoc();
    const blockIndentHandler = (event: KeyboardEvent): void => {
      handleBlockIndentShortcut(editor, event);
    };
    editorDocument.addEventListener('keydown', blockIndentHandler, true);
    editor.on('remove', () => {
      editorDocument.removeEventListener('keydown', blockIndentHandler, true);
    });
  });
}
