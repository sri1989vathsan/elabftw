/**
 * Moving things in the Folders panel by dragging: an experiment or resource (a "file") or a folder is dropped onto a folder
 * (in the tree, the list or the cards), onto the up row, or onto "All" / "Unfiled". Each move can be taken back from the
 * message that shows afterwards.
 *
 * What can be dropped where is told by the page's own markup: a row that is draggable has data-drag-kind ("folder" or "entry",
 * with data-drag-id and, for a file, data-drag-type) and a row that accepts drops has data-drop-folder, which is
 *  - a folder id: that folder,
 *  - "root": the top level, for folders (the "All" row),
 *  - "unfiled": no folder, for files (the "Unfiled" row),
 *  - "top": the top level for either (the up row of the first level).
 * The server decides who may move what (each file's and folder's own permissions); a refusal is shown as the page's usual error.
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import i18next from './i18n';
import { Api } from './Apiv2.class';
import { currentFlatFolderLevel, forgetFolderEntries } from './folder-views';

type EntryType = 'experiments' | 'items';
type Dragged =
  | { kind: 'folder'; id: string; name: string; from: string | null }
  | { kind: 'entry'; type: EntryType; id: string; name: string; from: string | null };

const TOAST_MS = 8000;

/** Where a drop on this kind of target puts the dragged thing: a folder id, null for "no folder", or undefined when it is not allowed. */
export function dropTargetFolder(kind: 'folder' | 'entry', targetValue: string): string | null | undefined {
  if (targetValue === 'top') return null;
  if (targetValue === 'root') return kind === 'folder' ? null : undefined;
  if (targetValue === 'unfiled') return kind === 'entry' ? null : undefined;
  return /^\d+$/.test(targetValue) ? targetValue : undefined;
}

/** True when `candidate` is `folderId` itself or one of the folders inside it. */
function isInsideFolder(folderId: string, candidate: string): boolean {
  if (folderId === candidate) return true;
  return document.querySelector(`#experimentsFoldersTree .folder-node[data-folder-id="${folderId}"] .folder-node[data-folder-id="${candidate}"]`) !== null;
}

/** The folder a folder sits in now (null for a top-level one). */
function parentOfFolder(folderId: string): string | null {
  const node = document.querySelector<HTMLElement>(`#experimentsFoldersTree .folder-node[data-folder-id="${folderId}"]`);
  return node?.parentElement?.closest<HTMLElement>('.folder-node')?.dataset.folderId ?? null;
}

function draggedFrom(source: HTMLElement): Dragged | null {
  const id = source.dataset.dragId ?? '';
  if (id === '') return null;
  const name = source.querySelector('.folder-name, .folder-file-title, .folder-file-card-title')?.textContent?.trim() || source.textContent?.trim() || '';
  if (source.dataset.dragKind === 'folder') return { kind: 'folder', id, name, from: parentOfFolder(id) };
  if (source.dataset.dragKind === 'entry') {
    const type: EntryType = source.dataset.dragType === 'items' ? 'items' : 'experiments';
    // files are only listed inside the folder the flat views are in, so that is where this one comes from
    const level = currentFlatFolderLevel();
    return { kind: 'entry', type, id, name, from: level ? level : null };
  }
  return null;
}

/** Whether dropping `dragged` on a target row is allowed, and the folder it would end up in. */
function resolveDrop(dragged: Dragged, targetValue: string): { folder: string | null } | null {
  const folder = dropTargetFolder(dragged.kind, targetValue);
  if (folder === undefined) return null;
  if (dragged.kind === 'folder' && folder !== null && isInsideFolder(dragged.id, folder)) return null;
  return { folder };
}

async function moveDragged(dragged: Dragged, folder: string | null): Promise<void> {
  const ApiC = new Api();
  // "no folder" / "top level" is null for a file and 0 for a folder's parent
  if (dragged.kind === 'entry') await ApiC.patch(`${dragged.type}/${dragged.id}`, { folder_id: folder === null ? null : Number(folder), notifOnSaved: 0 });
  else await ApiC.patch(`experiments_folders/${dragged.id}`, { parent_id: folder === null ? 0 : Number(folder), notifOnSaved: 0 });
}

function folderLabel(folder: string | null): string {
  if (folder === null) return i18next.t('the top level');
  const node = document.querySelector(`#experimentsFoldersTree .folder-node[data-folder-id="${folder}"] .folder-name`);
  return node?.textContent?.trim() || i18next.t('that folder');
}

let toastTimer: number | undefined;

function hideToast(): void {
  window.clearTimeout(toastTimer);
  document.getElementById('folderMoveToast')?.remove();
}

/** The message after a move, with the button that takes it back. It lives on the page, not in the panel, so it survives the panel being reloaded. */
function showToast(message: string, undo: (() => void) | null): void {
  hideToast();
  const toast = document.createElement('div');
  toast.id = 'folderMoveToast';
  toast.className = 'folder-move-toast';
  toast.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'folder-move-toast-text';
  text.textContent = message;
  toast.append(text);
  if (undo) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folder-move-toast-undo';
    button.textContent = i18next.t('Undo');
    button.addEventListener('click', () => {
      hideToast();
      undo();
    });
    toast.append(button);
  }
  document.body.append(toast);
  toastTimer = window.setTimeout(hideToast, TOAST_MS);
}

/** The panel reloads its folders (so the counts and the lists are right again). */
function refreshPanel(): void {
  forgetFolderEntries();
  document.querySelector<HTMLElement>('#foldersPanel [data-action="refresh-folders"]')?.click();
}

async function performMove(dragged: Dragged, folder: string | null): Promise<void> {
  try {
    await moveDragged(dragged, folder);
  } catch {
    // the page has already shown why (no permission, a name that is taken, ...)
    return;
  }
  refreshPanel();
  showToast(
    `${i18next.t('Moved')} ${dragged.name} ${i18next.t('to')} ${folderLabel(folder)}`,
    () => {
      moveDragged(dragged, dragged.from).then(refreshPanel).catch(() => { /* the page showed the reason */ });
    },
  );
}

export function initFolderDragDrop(): void {
  let dragged: Dragged | null = null;
  const clearTargets = (): void => {
    document.querySelectorAll('#foldersPanel .is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
  };

  document.addEventListener('dragstart', event => {
    const source = (event.target as Element | null)?.closest<HTMLElement>('#foldersPanel [data-drag-kind]');
    if (!source || !event.dataTransfer) return;
    dragged = draggedFrom(source);
    if (!dragged) return;
    // a link dragged from a row would otherwise carry its address along and open it where it is dropped
    event.dataTransfer.clearData();
    event.dataTransfer.setData('text/plain', dragged.name);
    event.dataTransfer.effectAllowed = 'move';
    source.classList.add('is-dragging');
  });

  document.addEventListener('dragover', event => {
    if (!dragged) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>('#foldersPanel [data-drop-folder]');
    clearTargets();
    if (!target || !resolveDrop(dragged, target.dataset.dropFolder ?? '')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    target.classList.add('is-drop-target');
  });

  document.addEventListener('drop', event => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('#foldersPanel [data-drop-folder]');
    const moving = dragged;
    clearTargets();
    if (!moving || !target) return;
    const result = resolveDrop(moving, target.dataset.dropFolder ?? '');
    if (!result) return;
    event.preventDefault();
    dragged = null;
    if (result.folder === moving.from) return;
    void performMove(moving, result.folder);
  });

  document.addEventListener('dragend', () => {
    dragged = null;
    clearTargets();
    document.querySelectorAll('#foldersPanel .is-dragging').forEach(el => el.classList.remove('is-dragging'));
  });
}
