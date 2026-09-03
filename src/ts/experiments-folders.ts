/**
 * @author Andreas Moor
 * @copyright 2026 Andreas Moor
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

import $ from 'jquery';
import tinymce from 'tinymce/tinymce';
import { Api } from './Apiv2.class';
import { on } from './handlers';
import { notify } from './notify';
import { getTinymceBaseConfig } from './tinymce';
import { htmlToMarkdown } from './Editor.class';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

type FolderScope = 'mine' | 'all';
type FolderEntityType = 'experiments' | 'items';

interface FolderReadme {
  id: number;
  name: string;
  readme_body: string;
  readme_content_type: number;
  can_edit_readme: boolean;
}

document.addEventListener('DOMContentLoaded', () => {
  // Only run on experiments page
  const initialSidebar = document.getElementById('experimentsFoldersSidebar');
  if (!initialSidebar) {
    return;
  }
  let sidebar = initialSidebar;

  const ApiC = new Api();

  const currentUserId = initialSidebar.dataset.currentUserId ?? '';
  // Versioned, per-user keys prevent legacy DOM-order state from leaking into
  // this deterministic tree layout. A missing value means collapsed by default.
  const COLLAPSED_KEY = `collapsed-experiment-folders-v2-${currentUserId}`;
  const OTHER_FOLDERS_KEY = `other-folders-collapsed-v2-${currentUserId}`;
  const folderScopeKey = `experiment-folder-scope-${currentUserId}`;
  const storedFolderScope = localStorage.getItem(folderScopeKey);
  let activeFolderScope: FolderScope = storedFolderScope === 'all' ? 'all' : 'mine';
  // the folder tree itself is shared between experiments and resources, only
  // which page a folder link opens (and which entity count badge shows)
  // depends on this -- persisted per-user so it survives navigating around
  const folderEntityTypeKey = `experiment-folder-entity-type-${currentUserId}`;
  const storedFolderEntityType = localStorage.getItem(folderEntityTypeKey);
  let activeFolderEntityType: FolderEntityType = storedFolderEntityType === 'items' ? 'items' : 'experiments';
  let activeReadme: FolderReadme | null = null;

  function readFavoriteFolderIds(element: HTMLElement): string[] {
    return (element.dataset.favoriteFolderIds ?? '').split(',').filter(folderId => folderId !== '');
  }

  // Read the server-provided set of bookmarked folder ids.
  let favoriteFolderIds = readFavoriteFolderIds(sidebar);
  document.addEventListener('elabftw:folders-panel-loaded', () => {
    const loadedSidebar = document.getElementById('experimentsFoldersSidebar');
    if (!loadedSidebar) return;
    sidebar = loadedSidebar;
    favoriteFolderIds = readFavoriteFolderIds(sidebar);
    initializeFolderTreeState();
  });
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
    const bookmarkedRoots = bookmarkedSection
      ? Array.from(bookmarkedSection.querySelectorAll('.folder-node[data-folder-depth="0"]')) as HTMLElement[]
      : [];
    if (bookmarkedSection) {
      bookmarkedSection.hidden = !bookmarkedRoots.some(node => !node.hidden);
    }

    const wrapper = document.querySelector('.other-folders-wrapper') as HTMLElement | null;
    const otherRoots = wrapper
      ? Array.from(wrapper.querySelectorAll('.other-folders-content > .folder-node[data-folder-depth="0"]')) as HTMLElement[]
      : [];
    if (wrapper) {
      wrapper.hidden = !otherRoots.some(node => !node.hidden);
    }
  }

  /**
   * Folder ownership scope and entity-list scope are separate concepts. Make
   * that relationship explicit in every folder link so selecting My folders
   * returns the current user's entities, while All folders returns readable
   * entities from the team. The API still applies each entity's canread rules.
   */
  function updateFolderEntityLinks(scope: FolderScope): void {
    const entityScope = scope === 'mine' ? '1' : '2';
    document.querySelectorAll<HTMLAnchorElement>('[data-folder-entity-link]').forEach(link => {
      const url = new URL(link.href, window.location.origin);
      url.searchParams.set('scope', entityScope);
      link.href = `${url.pathname}${url.search}${url.hash}`;
    });
  }

  /**
   * The folder tree is shared between experiments and resources -- this
   * swaps which page folder links point to and which entity-count badge
   * shows, entirely client-side (both counts are already in the DOM).
   */
  function applyFolderEntityType(type: FolderEntityType): void {
    activeFolderEntityType = type;
    localStorage.setItem(folderEntityTypeKey, type);

    const typeSelect = document.getElementById('folderEntityTypeSelect') as HTMLSelectElement | null;
    if (typeSelect) {
      typeSelect.value = type;
      typeSelect.closest('[data-active-entity-type]')?.setAttribute('data-active-entity-type', type);
    }

    // the "All X" quick-link option's visible label depends on the entity type
    const quickLinkSelect = document.getElementById('folderQuickLinkSelect') as HTMLSelectElement | null;
    if (quickLinkSelect) {
      const allOption = quickLinkSelect.querySelector('option[value="all"]') as HTMLOptionElement | null;
      const targetLabel = type === 'items' ? allOption?.dataset.itemsLabel : allOption?.dataset.experimentsLabel;
      if (allOption && targetLabel) allOption.textContent = targetLabel;
    }

    document.querySelectorAll<HTMLAnchorElement>('[data-folder-entity-link]').forEach(link => {
      const targetHref = type === 'items' ? link.dataset.itemsHref : link.dataset.experimentsHref;
      if (targetHref) link.href = targetHref;
      const count = (type === 'items' ? link.dataset.resourcesCount : link.dataset.experimentsCount) ?? '0';
      const badge = link.querySelector('.folder-entity-count') as HTMLElement | null;
      if (badge) {
        badge.textContent = count;
        badge.hidden = count === '0';
      }
    });

    // re-apply the mine/all entity-list scope on top, since it also rewrites href
    updateFolderEntityLinks(activeFolderScope);
  }

  function getQuickLinkHref(option: HTMLOptionElement, type: FolderEntityType): string | undefined {
    return type === 'items' ? option.dataset.itemsHref : option.dataset.experimentsHref;
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
    updateFolderEntityLinks(scope);
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

  function bindFolderInteractiveControls(): void {
    document.getElementById('newFolderName')?.addEventListener('keypress', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        (document.querySelector('[data-action="create-experiment-folder"]') as HTMLElement)?.click();
      }
    });

    document.getElementById('folderEntityTypeSelect')?.addEventListener('change', (event: Event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (value === 'experiments' || value === 'items') {
        applyFolderEntityType(value);
      }
    });

    document.getElementById('folderQuickLinkSelect')?.addEventListener('change', (event: Event) => {
      const select = event.target as HTMLSelectElement;
      const option = select.selectedOptions[0];
      const href = option && getQuickLinkHref(option, activeFolderEntityType);
      if (href) window.location.href = href;
    });

    document.getElementById('folderExportModalFormat')?.addEventListener('change', (event: Event) => {
      const format = (event.target as HTMLSelectElement).value;
      const row = document.getElementById('folderExportModalZipEntityFormatRow');
      if (row) row.hidden = format !== 'zip';
    });
  }

  function initializeFolderTreeState(): void {
    // On first use, every parent folder is collapsed. Only the ancestor paths to
    // the active and bookmarked folders are opened so their location is visible.
    const hasStoredCollapseState = localStorage.getItem(COLLAPSED_KEY) !== null;
    const collapsed = getCollapsedSet();
    if (!hasStoredCollapseState) {
      document.querySelectorAll('.folder-toggle[data-folder-id]').forEach((toggle: HTMLElement) => {
        if (toggle.dataset.folderId) collapsed.add(toggle.dataset.folderId);
      });
    }
    [...favoriteFolderIds, currentFolderId].forEach(folderId => {
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
    applyFolderEntityType(activeFolderEntityType);
    applyFolderScope(activeFolderScope);
    bindFolderInteractiveControls();
  }

  async function refreshFoldersSidebar(): Promise<void> {
    const currentPanel = document.getElementById('foldersPanel');
    if (!currentPanel) return;

    const panelWasHidden = currentPanel.hidden;
    const panelScrollTop = currentPanel.scrollTop;
    sessionStorage.removeItem('folders-panel-html-v1');
    sessionStorage.removeItem('folders-panel-html-v1-at');
    const supportsFolderData = ['/experiments.php', '/database.php'].includes(window.location.pathname);
    const refreshUrl = supportsFolderData
      ? new URL(window.location.href)
      : new URL('/experiments.php?mode=show&scope=1', window.location.origin);
    // Reading view mode provides the same folder data without reinitializing an
    // experiment's exclusive edit session while the user has unsaved content.
    if (refreshUrl.searchParams.get('mode') === 'edit') {
      refreshUrl.searchParams.set('mode', 'view');
    }
    const response = await fetch(refreshUrl, {
      credentials: 'same-origin',
      headers: {'X-Requested-With': 'XMLHttpRequest'},
    });
    if (!response.ok) {
      throw new Error(`Could not refresh folders (${response.status}).`);
    }

    const freshDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
    const freshPanel = freshDocument.getElementById('foldersPanel');
    if (!freshPanel) {
      throw new Error('Could not find the refreshed folder sidebar.');
    }

    // Keep the folder chooser in the Create Experiment/Resource dialog in sync
    // without replacing the select itself (its event listeners remain intact).
    const createFolderSelect = document.getElementById('createNewFolderSelect') as HTMLSelectElement | null;
    const freshCreateFolderSelect = freshDocument.getElementById('createNewFolderSelect') as HTMLSelectElement | null;
    if (createFolderSelect && freshCreateFolderSelect) {
      const selectedFolderId = createFolderSelect.value;
      createFolderSelect.replaceChildren(...Array.from(freshCreateFolderSelect.options).map(option => option.cloneNode(true)));
      if (createFolderSelect.querySelector(`option[value="${selectedFolderId}"]`)) {
        createFolderSelect.value = selectedFolderId;
      }
      document.dispatchEvent(new CustomEvent('elabftw:folders-refreshed'));
    }

    freshPanel.hidden = panelWasHidden;
    currentPanel.replaceWith(freshPanel);
    const refreshedSidebar = document.getElementById('experimentsFoldersSidebar');
    if (!refreshedSidebar) {
      throw new Error('Could not initialize the refreshed folder sidebar.');
    }
    sidebar = refreshedSidebar;
    favoriteFolderIds = readFavoriteFolderIds(sidebar);
    freshPanel.scrollTop = panelScrollTop;
    initializeFolderTreeState();
  }

  function refreshFoldersSidebarSafely(): void {
    void refreshFoldersSidebar().catch(error => notify.error(error));
  }

  async function getFolderReadme(folderId: string): Promise<FolderReadme> {
    return ApiC.getJson<FolderReadme>(`experiments_folders/${folderId}`);
  }

  function markdownToHtml(markdown: string): string {
    return DOMPurify.sanitize(marked(markdown) as string, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target'],
    });
  }

  function renderReadmeContent(target: HTMLElement, body: string, contentType = 1): void {
    target.innerHTML = (Number(contentType) === 2 ? markdownToHtml(body) : body)
      || '<p class="color-medium mb-0">This folder README is empty.</p>';
  }

  async function initializeReadmeEditor(): Promise<void> {
    if (tinymce.get('folderReadmeEditor')) return;
    const baseConfig = getTinymceBaseConfig('admin');
    await tinymce.init({
      ...baseConfig,
      selector: '#folderReadmeEditor',
      height: 360,
      min_height: 280,
      menubar: false,
      plugins: 'advlist autolink charmap code fullscreen link lists preview searchreplace table visualblocks',
      toolbar1: 'undo redo | blocks fontsize | bold italic underline | alignleft aligncenter alignright | bullist numlist | link table | removeformat code',
      setup: undefined,
      images_upload_handler: undefined,
      templates: undefined,
      paste_data_images: false,
      contextmenu: false,
    });
  }

  function setReadmeEditMode(editing: boolean): void {
    const view = document.getElementById('folderReadmeView');
    const empty = document.getElementById('folderReadmeEmpty');
    const textarea = document.getElementById('folderReadmeEditor');
    const markdownEditor = document.getElementById('folderReadmeMarkdownEditor');
    const typeGroup = document.getElementById('folderReadmeEditorTypeGroup');
    const typeSelect = document.getElementById('folderReadmeEditorType') as HTMLSelectElement | null;
    const editButton = document.getElementById('editFolderReadme');
    const saveButton = document.getElementById('saveFolderReadme');
    const cancelButton = document.getElementById('cancelFolderReadmeEdit');
    if (!view || !empty || !textarea || !markdownEditor || !typeGroup || !typeSelect || !editButton || !saveButton || !cancelButton) return;
    const markdownMode = typeSelect.value === '2';
    view.hidden = editing || !activeReadme?.readme_body;
    empty.hidden = editing || Boolean(activeReadme?.readme_body);
    textarea.hidden = !editing || markdownMode;
    markdownEditor.hidden = !editing || !markdownMode;
    typeGroup.hidden = !editing;
    editButton.hidden = editing || !activeReadme?.can_edit_readme;
    saveButton.hidden = !editing;
    cancelButton.hidden = !editing;
    tinymce.get('folderReadmeEditor')?.getContainer().toggleAttribute('hidden', !editing || markdownMode);
  }

  async function openFolderReadme(folderId: string): Promise<void> {
    activeReadme = await getFolderReadme(folderId);
    (document.getElementById('folderReadmeId') as HTMLInputElement).value = folderId;
    const title = document.getElementById('folderReadmeModalTitle');
    const view = document.getElementById('folderReadmeView');
    if (title) title.textContent = `${activeReadme.name} — README`;
    if (view) renderReadmeContent(view, activeReadme.readme_body, activeReadme.readme_content_type);
    $('#folderReadmeModal').modal('show');
    await initializeReadmeEditor();
    tinymce.get('folderReadmeEditor')?.setContent(activeReadme.readme_body);
    (document.getElementById('folderReadmeMarkdownEditor') as HTMLTextAreaElement).value = activeReadme.readme_body;
    (document.getElementById('folderReadmeEditorType') as HTMLSelectElement).value = String(activeReadme.readme_content_type);
    setReadmeEditMode(false);
  }

  async function loadSelectedFolderReadme(): Promise<void> {
    const panel = document.getElementById('selectedFolderReadmePanel');
    const folderId = panel?.dataset.folderId;
    if (!panel || !folderId) return;
    try {
      const folder = await getFolderReadme(folderId);
      const title = panel.querySelector('[data-folder-readme-title]');
      const content = panel.querySelector('[data-folder-readme-content]') as HTMLElement | null;
      if (title) title.textContent = `${folder.name} — README`;
      if (content) renderReadmeContent(content, folder.readme_body, folder.readme_content_type);
    } catch (error) {
      panel.hidden = true;
      notify.error(error);
    }
  }

  initializeFolderTreeState();
  void loadSelectedFolderReadme();
  document.addEventListener('elabftw:folder-changed', refreshFoldersSidebarSafely);

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

  on('toggle-folder-more-actions', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    const folderId = el.dataset.id;
    const panel = document.querySelector(`[data-folder-more-actions-for="${folderId}"]`) as HTMLElement | null;
    if (!panel) return;
    const isOpen = panel.hidden;
    panel.hidden = !isOpen;
    el.setAttribute('aria-expanded', String(isOpen));
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
      refreshFoldersSidebarSafely();
    });
  });

  on('open-folder-readme', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    if (el.dataset.id) {
      void openFolderReadme(el.dataset.id).catch(error => notify.error(error));
    }
  });

  on('edit-folder-readme', () => {
    if (!activeReadme?.can_edit_readme) return;
    const typeSelect = document.getElementById('folderReadmeEditorType') as HTMLSelectElement;
    typeSelect.value = String(activeReadme.readme_content_type);
    tinymce.get('folderReadmeEditor')?.setContent(Number(activeReadme.readme_content_type) === 2
      ? markdownToHtml(activeReadme.readme_body)
      : activeReadme.readme_body);
    (document.getElementById('folderReadmeMarkdownEditor') as HTMLTextAreaElement).value = Number(activeReadme.readme_content_type) === 1
      ? htmlToMarkdown(activeReadme.readme_body)
      : activeReadme.readme_body;
    setReadmeEditMode(true);
    if (Number(activeReadme.readme_content_type) === 1) tinymce.get('folderReadmeEditor')?.focus();
  });

  function changeFolderReadmeEditor(typeSelect: HTMLSelectElement): void {
    const markdownEditor = document.getElementById('folderReadmeMarkdownEditor') as HTMLTextAreaElement;
    if (typeSelect.value === '2') {
      markdownEditor.value = htmlToMarkdown(tinymce.get('folderReadmeEditor')?.getContent() ?? '');
    } else {
      tinymce.get('folderReadmeEditor')?.setContent(markdownToHtml(markdownEditor.value));
    }
    setReadmeEditMode(true);
  }

  document.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.id === 'folderReadmeEditorType') {
      changeFolderReadmeEditor(target);
    }
  });

  on('cancel-folder-readme-edit', () => {
    if (activeReadme) {
      (document.getElementById('folderReadmeEditorType') as HTMLSelectElement).value = String(activeReadme.readme_content_type);
    }
    setReadmeEditMode(false);
  });

  on('save-folder-readme', () => {
    if (!activeReadme?.can_edit_readme) return;
    const contentType = Number((document.getElementById('folderReadmeEditorType') as HTMLSelectElement).value);
    const body = contentType === 2
      ? (document.getElementById('folderReadmeMarkdownEditor') as HTMLTextAreaElement).value
      : tinymce.get('folderReadmeEditor')?.getContent() ?? '';
    ApiC.patch(`experiments_folders/${activeReadme.id}`, {
      readme_body: body,
      readme_content_type: contentType,
    }).then(async () => {
      activeReadme = await getFolderReadme(String(activeReadme?.id));
      const view = document.getElementById('folderReadmeView');
      if (view) renderReadmeContent(view, activeReadme.readme_body, activeReadme.readme_content_type);
      setReadmeEditMode(false);
      await loadSelectedFolderReadme();
      refreshFoldersSidebarSafely();
    }).catch(error => notify.error(error));
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
      refreshFoldersSidebarSafely();
    });
  });

  // Edit a folder name and its short description in one place.
  on('edit-folder', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    const folderId = el.dataset.id ?? '';
    const parentSelect = document.getElementById('editExperimentFolderParent') as HTMLSelectElement;
    const descendantIds = new Set<string>();
    document.querySelectorAll<HTMLElement>(`.folder-node[data-folder-id="${folderId}"] .folder-node[data-folder-id]`).forEach(node => {
      if (node.dataset.folderId) descendantIds.add(node.dataset.folderId);
    });
    Array.from(parentSelect.options).forEach(option => {
      const invalidParent = option.value === folderId || descendantIds.has(option.value);
      option.hidden = invalidParent;
      option.disabled = invalidParent;
    });

    (document.getElementById('editExperimentFolderId') as HTMLInputElement).value = folderId;
    (document.getElementById('editExperimentFolderName') as HTMLInputElement).value = el.dataset.name ?? '';
    parentSelect.value = el.dataset.parentId ?? '';
    (document.getElementById('editExperimentFolderDescription') as HTMLTextAreaElement).value = el.dataset.description ?? '';
    $('#editExperimentFolderModal').modal('show');
  });

  on('open-folder-export', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    (document.getElementById('folderExportModalFolderId') as HTMLInputElement).value = el.dataset.id ?? '';
    (document.getElementById('folderExportModalEntityType') as HTMLInputElement).value = activeFolderEntityType;
    const nameEl = document.getElementById('folderExportModalFolderName');
    if (nameEl) nameEl.textContent = el.dataset.name ?? '';
    $('#folderExportModal').modal('show');
  });

  on('export-folder-confirm', () => {
    const folderId = (document.getElementById('folderExportModalFolderId') as HTMLInputElement).value;
    const type = (document.getElementById('folderExportModalEntityType') as HTMLInputElement).value || 'experiments';
    let format = (document.getElementById('folderExportModalFormat') as HTMLSelectElement).value;
    if (!folderId) return;
    const pdfa = (document.getElementById('folderExportModalPdfa') as HTMLInputElement).checked;
    if (pdfa && format === 'pdf') {
      format = 'pdfa';
    } else if (pdfa && format === 'zip') {
      format = 'zipa';
    }
    let url = `make.php?format=${encodeURIComponent(format)}&folder=${encodeURIComponent(folderId)}&type=${encodeURIComponent(type)}`;
    if (format === 'zip' || format === 'zipa') {
      const entityFormat = (document.getElementById('folderExportModalZipEntityFormat') as HTMLSelectElement).value;
      url += `&entity_format=${encodeURIComponent(entityFormat)}`;
      if ((document.getElementById('folderExportModalJson') as HTMLInputElement).checked) {
        url += '&json=1';
      }
    }
    if ((document.getElementById('folderExportModalChangelog') as HTMLInputElement).checked) {
      url += '&changelog=1';
    }
    window.location.href = url;
  });

  on('save-folder-details', (_el: HTMLElement, event: Event) => {
    event.preventDefault();
    const folderId = (document.getElementById('editExperimentFolderId') as HTMLInputElement).value;
    const nameInput = document.getElementById('editExperimentFolderName') as HTMLInputElement;
    const parentSelect = document.getElementById('editExperimentFolderParent') as HTMLSelectElement;
    const descriptionInput = document.getElementById('editExperimentFolderDescription') as HTMLTextAreaElement;
    if (!folderId || !nameInput.reportValidity()) return;

    ApiC.patch(`experiments_folders/${folderId}`, {
      name: nameInput.value.trim(),
      parent_id: parentSelect.value ? parseInt(parentSelect.value, 10) : null,
      description: descriptionInput.value.trim(),
    }).then(() => {
      $('#editExperimentFolderModal').modal('hide');
      refreshFoldersSidebarSafely();
    });
  });

  // Delete folder
  on('delete-folder', (el: HTMLElement, event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    const folderId = el.dataset.id;
    if (confirm('Delete this folder? Experiments inside it will be moved to Unfiled.')) {
      ApiC.delete(`experiments_folders/${folderId}`).then(() => {
        refreshFoldersSidebarSafely();
      });
    }
  });
});
