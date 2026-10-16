/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import { confirmLeaveEditing, initPermissionsTomSelects } from './misc';
import SidePanel from './SidePanel.class';

export default class FoldersPanel extends SidePanel {
  private loading: Promise<void> | null = null;

  constructor() {
    super('folders');
    this.panelId = 'foldersPanel';
    // Delegated (not bound per-render) so it survives loadPanel() replacing
    // the whole panel element -- same "leave this page and lose unsaved
    // edits?" guard as the Search panel's result links (FavoriteFilters).
    document.addEventListener('click', event => {
      if ((event.target as HTMLElement)?.closest('[data-action="refresh-folders"]')) {
        const icon = (event.target as HTMLElement).closest('[data-action="refresh-folders"]')?.querySelector('i');
        icon?.classList.add('fa-spin');
        void this.refresh().finally(() => icon?.classList.remove('fa-spin'));
      }
    });
    document.addEventListener('click', event => {
      const link = (event.target as HTMLElement)?.closest<HTMLAnchorElement>(`#${this.panelId} a[href]`);
      if (!link) return;
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!confirmLeaveEditing()) event.preventDefault();
    });
  }

  /** The refresh button: forget the short-lived cached copy and load the folder tree again. */
  refresh(): Promise<void> {
    sessionStorage.removeItem('folders-panel-html-v3');
    sessionStorage.removeItem('folders-panel-html-v3-at');
    this.loading = this.loadPanel();
    return this.loading;
  }

  show(): void {
    super.show();
    if (document.getElementById(this.panelId)?.hasAttribute('data-lazy-folders-panel')) {
      this.loading ??= this.loadPanel();
    }
  }

  private async loadPanel(): Promise<void> {
    const cacheKey = 'folders-panel-html-v4';
    const cached = sessionStorage.getItem(cacheKey);
    const cachedAt = Number(sessionStorage.getItem(`${cacheKey}-at`) ?? 0);
    let fragmentHtml = cachedAt > Date.now() - 30000 ? cached : null;
    if (!fragmentHtml) {
      const response = await fetch('/experiments.php?mode=show&scope=1', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Unable to load folders (${response.status})`);
      const responseDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
      // folderReadmeModal is NOT scraped here -- base.html now includes it on
      // every page unconditionally, so it's always present regardless of
      // which page the Folders panel loaded from.
      fragmentHtml = [
        responseDocument.getElementById(this.panelId)?.outerHTML ?? '',
        responseDocument.getElementById('editExperimentFolderModal')?.outerHTML ?? '',
        responseDocument.getElementById('folderExportModal')?.outerHTML ?? '',
        responseDocument.getElementById('folderPermissionsModal')?.outerHTML ?? '',
      ].join('');
      sessionStorage.setItem(cacheKey, fragmentHtml);
      sessionStorage.setItem(`${cacheKey}-at`, String(Date.now()));
    }
    const documentCopy = new DOMParser().parseFromString(fragmentHtml, 'text/html');
    const freshPanel = documentCopy.getElementById(this.panelId);
    const currentPanel = document.getElementById(this.panelId);
    if (!freshPanel || !currentPanel) return;
    freshPanel.removeAttribute('hidden');
    currentPanel.replaceWith(freshPanel);
    ['editExperimentFolderModal', 'folderExportModal', 'folderPermissionsModal'].forEach(id => {
      if (document.getElementById(id)) return;
      const modal = documentCopy.getElementById(id);
      // Inside #container, like the windows built into the page: the page's button handling only reaches
      // buttons inside it, so a window added to the end of <body> had dead buttons (Permissions, Save...).
      if (modal) (document.getElementById('container') ?? document.body).append(modal);
    });
    // A window added after the page loaded has not had its Teams / User Groups / Users pickers set up yet.
    const permissionsModal = document.getElementById('folderPermissionsModal');
    if (permissionsModal) initPermissionsTomSelects(permissionsModal);
    document.dispatchEvent(new CustomEvent('elabftw:folders-panel-loaded'));
  }
}
