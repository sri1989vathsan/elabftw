/**
 * @author Andreas Moor
 * @copyright 2026 Andreas Moor
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

import $ from 'jquery';
import { Api } from './Apiv2.class';
import { on } from './handlers';

type FolderScope = 'mine' | 'all';

document.addEventListener('DOMContentLoaded', () => {
  // Only run on experiments page
  const sidebar = document.getElementById('experimentsFoldersSidebar');
  if (!sidebar) {
    return;
  }

  const ApiC = new Api();

  const currentUserId = sidebar.dataset.currentUserId ?? '';
  // Versioned, per-user keys prevent legacy DOM-order state from leaking into
  // this deterministic tree layout. A missing value means collapsed by default.
  const COLLAPSED_KEY = `collapsed-experiment-folders-v2-${currentUserId}`;
  const OTHER_FOLDERS_KEY = `other-folders-collapsed-v2-${currentUserId}`;
  const folderScopeKey = `experiment-folder-scope-${currentUserId}`;
  const storedFolderScope = localStorage.getItem(folderScopeKey);
  let activeFolderScope: FolderScope = storedFolderScope === 'all' ? 'all' : 'mine';

  // Read the server-provided favorite folder id
  const favoriteFolderIdAttr = sidebar.dataset.favoriteFolderId;
  const favoriteFolderId: string | null = favoriteFolderIdAttr && favoriteFolderIdAttr !== '' ? favoriteFolderIdAttr : null;
  const currentFolderId = new URLSearchParams(window.location.search).get('folder')
    || sidebar.dataset.currentFolderId
    || null;

  /**
   * Get the set of collapsed folder IDs from localStorage.
   */
  function getCollapsedSet(): Set<string> {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  }

  /**
   * Persist the collapsed set to localStorage.
   */
  function saveCollapsedSet(collapsed: Set<string>): void {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(collapsed)));
  }

  function filterParentFolders(scope: FolderScope): void {
    const parentSelect = document.getElementById('newFolderParent') as HTMLSelectElement | null;
    if (!parentSelect) return;

    Array.from(parentSelect.options).forEach((option, index) => {
      if (index === 0) return;
      const shouldHide = scope === 'mine' && option.dataset.folderOwnerId !== currentUserId;
      option.hidden = shouldHide;
      option.disabled = shouldHide;
    });
    if (parentSelect.selectedOptions[0]?.disabled) {
      parentSelect.value = '';
    }
  }

  function setOtherFoldersOpen(isOpen: boolean): void {
    const wrapper = document.querySelector('.other-folders-wrapper') as HTMLElement | null;
    if (!wrapper) return;
    const header = wrapper.querySelector('.other-folders-header') as HTMLButtonElement | null;
    const content = wrapper.querySelector('.other-folders-content') as HTMLElement | null;
    if (!header || !content) return;
    content.style.display = isOpen ? 'block' : 'none';
    header.setAttribute('aria-expanded', String(isOpen));
    const caret = header.querySelector('.fa-caret-right, .fa-caret-down');
    const folderIcon = header.querySelector('.fa-folder, .fa-folder-open');
    if (caret) {
      caret.classList.toggle('fa-caret-right', !isOpen);
      caret.classList.toggle('fa-caret-down', isOpen);
    }
    if (folderIcon) {
      folderIcon.classList.toggle('fa-folder', !isOpen);
      folderIcon.classList.toggle('fa-folder-open', isOpen);
    }
  }

  function updateFolderSections(): void {
    const bookmarkedSection = document.querySelector('.bookmarked-folders-section') as HTMLElement | null;
    const bookmarkedRoot = bookmarkedSection?.querySelector('.folder-node[data-folder-depth="0"]') as HTMLElement | null;
    if (bookmarkedSection) {
      bookmarkedSection.hidden = !bookmarkedRoot || bookmarkedRoot.hidden;
    }

    const wrapper = document.querySelector('.other-folders-wrapper') as HTMLElement | null;
    const otherRoots = wrapper
      ? Array.from(wrapper.querySelectorAll('.other-folders-content > .folder-node[data-folder-depth="0"]')) as HTMLElement[]
      : [];
    if (wrapper) {
      wrapper.hidden = !otherRoots.some(node => !node.hidden);
    }
  }

  function applyFolderScope(scope: FolderScope): void {
    activeFolderScope = scope;
    localStorage.setItem(folderScopeKey, scope);

    document.querySelectorAll('[data-action="select-folder-scope"]').forEach((button: HTMLButtonElement) => {
      const isActive = button.dataset.scope === scope;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });

    const tree = document.getElementById('experimentsFoldersTree');
    if (!tree) return;
    const allNodes = Array.from(tree.querySelectorAll('.folder-node')) as HTMLElement[];
    const rootNodes = allNodes.filter(node => node.dataset.folderDepth === '0');
    if (scope === 'all') {
      allNodes.forEach(node => {
        node.hidden = false;
        node.classList.remove('folder-scope-context');
        if (node.dataset.folderId) {
          applyFolderState(node.dataset.folderId, getCollapsedSet().has(node.dataset.folderId));
        }
      });
    } else {
      rootNodes.forEach(root => {
        const isMyTree = root.dataset.folderOwnerId === currentUserId;
        root.hidden = !isMyTree;
        root.classList.remove('folder-scope-context');
        root.querySelectorAll('.folder-node').forEach((child: HTMLElement) => {
          child.hidden = !isMyTree;
          child.classList.remove('folder-scope-context');
        });
      });
    }

    const ownedRootCount = rootNodes.filter(node => node.dataset.folderOwnerId === currentUserId).length;
    const emptyState = document.getElementById('myFoldersEmpty');
    if (emptyState) {
      emptyState.hidden = scope !== 'mine' || ownedRootCount > 0;
    }
    filterParentFolders(scope);
    updateFolderSections();
  }

  /**
   * Apply collapsed/expanded state to a single folder (caret + children + folder icon).
   */
  function applyFolderState(folderId: string, isCollapsed: boolean): void {
    const childrenDiv = document.querySelector(`.folder-children[data-parent-folder-id="${folderId}"]`) as HTMLElement;
    const toggle = document.querySelector(`.folder-toggle[data-folder-id="${folderId}"]`);
    if (!childrenDiv || !toggle) return;

    // Find the folder icon in the same row
    const folderNode = document.querySelector(`.folder-node[data-folder-id="${folderId}"]`);
    const folderIcon = folderNode?.querySelector('.folder-icon');

    if (isCollapsed) {
      childrenDiv.style.display = 'none';
      toggle.querySelector('i')?.classList.replace('fa-caret-down', 'fa-caret-right');
      folderIcon?.classList.replace('fa-folder-open', 'fa-folder');
    } else {
      childrenDiv.style.display = '';
      toggle.querySelector('i')?.classList.replace('fa-caret-right', 'fa-caret-down');
      folderIcon?.classList.replace('fa-folder', 'fa-folder-open');
    }
  }

  /**
   * Collect all ancestor folder IDs for a given folder (not including itself).
   */
  function getAncestorIds(folderId: string): string[] {
    const ancestors: string[] = [];
    let node = document.querySelector(`.folder-node[data-folder-id="${folderId}"]`) as HTMLElement;
    if (!node) return ancestors;
    while (node) {
      const parentChildren = node.parentElement?.closest('.folder-children') as HTMLElement;
      if (parentChildren) {
        const parentFolderId = parentChildren.dataset.parentFolderId;
        if (parentFolderId) {
          ancestors.push(parentFolderId);
        }
        node = parentChildren.closest('.folder-node') as HTMLElement;
      } else {
        break;
      }
    }
    return ancestors;
  }

  // On first use, every parent folder is collapsed. Only the ancestor paths to
  // the active and bookmarked folders are opened so their location is visible.
  const hasStoredCollapseState = localStorage.getItem(COLLAPSED_KEY) !== null;
  const collapsed = getCollapsedSet();
  if (!hasStoredCollapseState) {
    document.querySelectorAll('.folder-toggle[data-folder-id]').forEach((toggle: HTMLElement) => {
      if (toggle.dataset.folderId) collapsed.add(toggle.dataset.folderId);
    });
  }
  [favoriteFolderId, currentFolderId].forEach(folderId => {
    if (!folderId || folderId === '0') return;
    getAncestorIds(folderId).forEach(ancestorId => collapsed.delete(ancestorId));
  });
  saveCollapsedSet(collapsed);

  document.querySelectorAll('.folder-toggle[data-folder-id]').forEach((toggle: HTMLElement) => {
    const folderId = toggle.dataset.folderId;
    if (!folderId) return;
    applyFolderState(folderId, collapsed.has(folderId));
  });

  const currentNode = currentFolderId
    ? document.querySelector(`.folder-node[data-folder-id="${currentFolderId}"]`)
    : null;
  const activeFolderIsOther = Boolean(currentNode?.closest('.other-folders-wrapper'));
  setOtherFoldersOpen(activeFolderIsOther || localStorage.getItem(OTHER_FOLDERS_KEY) === 'open');

  applyFolderScope(activeFolderScope);

  on('select-folder-scope', (el: HTMLElement, event: Event) => {
    event.preventDefault();
    if (el.dataset.scope === 'mine' || el.dataset.scope === 'all') {
      applyFolderScope(el.dataset.scope);
    }
  });

  on('toggle-other-folders', (el: HTMLElement, event: Event) => {
    event.preventDefault();
    const isOpen = el.getAttribute('aria-expanded') !== 'true';
    setOtherFoldersOpen(isOpen);
    localStorage.setItem(OTHER_FOLDERS_KEY, isOpen ? 'open' : 'collapsed');
  });

  // Toggle folder on click — registered via the global on() dispatcher
  // because #container's click listener routes all data-action clicks
  on('toggle-folder-children', (el: HTMLElement) => {
    const folderId = el.dataset.folderId;
    if (!folderId) return;
    const current = getCollapsedSet();
    if (current.has(folderId)) {
      current.delete(folderId);
      applyFolderState(folderId, false);
    } else {
      current.add(folderId);
      applyFolderState(folderId, true);
    }
    saveCollapsedSet(current);
  });

  // Toggle favorite folder on star click
  on('toggle-favorite-folder', (el: HTMLElement) => {
    const folderId = el.dataset.id;
    if (!folderId) return;

    ApiC.patch('experiments_folders', {
      action: 'toggle_favorite',
      folder_id: parseInt(folderId, 10),
    }).then(() => {
      // Reload to reflect the new favorite state (reorder + collapse)
      window.location.reload();
    });
  });

  // Show folder action buttons on hover
  document.querySelectorAll('#experimentsFoldersContent .folder-node > .d-flex').forEach(row => {
    const actions = row.querySelector('.folder-actions') as HTMLElement;
    if (actions) {
      row.addEventListener('mouseenter', () => actions.style.display = 'inline');
      row.addEventListener('mouseleave', () => actions.style.display = 'none');
    }
  });

  // Create folder
  on('create-experiment-folder', () => {
    const nameInput = document.getElementById('newFolderName') as HTMLInputElement;
    const parentSelect = document.getElementById('newFolderParent') as HTMLSelectElement;
    const descriptionInput = document.getElementById('newFolderDescription') as HTMLTextAreaElement;
    const name = nameInput.value.trim();
    if (!name) {
      return;
    }
    const parentId = parentSelect.value ? parseInt(parentSelect.value, 10) : null;
    ApiC.post('experiments_folders', {
      name: name,
      parent_id: parentId,
      description: descriptionInput.value.trim(),
    }).then(() => {
      nameInput.value = '';
      descriptionInput.value = '';
      window.location.reload();
    });
  });

  // Allow Enter key to create folder
  document.getElementById('newFolderName')?.addEventListener('keypress', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      (document.querySelector('[data-action="create-experiment-folder"]') as HTMLElement)?.click();
    }
  });

  // Edit a folder name and its short description in one place.
  on('edit-folder', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    (document.getElementById('editExperimentFolderId') as HTMLInputElement).value = el.dataset.id ?? '';
    (document.getElementById('editExperimentFolderName') as HTMLInputElement).value = el.dataset.name ?? '';
    (document.getElementById('editExperimentFolderDescription') as HTMLTextAreaElement).value = el.dataset.description ?? '';
    $('#editExperimentFolderModal').modal('show');
  });

  on('save-folder-details', (_el: HTMLElement, event: Event) => {
    event.preventDefault();
    const folderId = (document.getElementById('editExperimentFolderId') as HTMLInputElement).value;
    const nameInput = document.getElementById('editExperimentFolderName') as HTMLInputElement;
    const descriptionInput = document.getElementById('editExperimentFolderDescription') as HTMLTextAreaElement;
    if (!folderId || !nameInput.reportValidity()) return;

    ApiC.patch(`experiments_folders/${folderId}`, {
      name: nameInput.value.trim(),
      description: descriptionInput.value.trim(),
    }).then(() => {
      $('#editExperimentFolderModal').modal('hide');
      window.location.reload();
    });
  });

  // Delete folder
  on('delete-folder', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    const folderId = el.dataset.id;
    if (confirm('Delete this folder? Experiments inside it will be moved to Unfiled.')) {
      ApiC.delete(`experiments_folders/${folderId}`).then(() => {
        window.location.reload();
      });
    }
  });
});
