/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import { confirmLeaveEditing } from './misc';
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
      const link = (event.target as HTMLElement)?.closest<HTMLAnchorElement>(`#${this.panelId} a[href]`);
      if (!link) return;
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!confirmLeaveEditing()) event.preventDefault();
    });
  }

  show(): void {
    super.show();
    if (document.getElementById(this.panelId)?.hasAttribute('data-lazy-folders-panel')) {
      this.loading ??= this.loadPanel();
    }
  }

  private async loadPanel(): Promise<void> {
    const cacheKey = 'folders-panel-html-v1';
    const cached = sessionStorage.getItem(cacheKey);
    const cachedAt = Number(sessionStorage.getItem(`${cacheKey}-at`) ?? 0);
    let fragmentHtml = cachedAt > Date.now() - 30000 ? cached : null;
    if (!fragmentHtml) {
      const response = await fetch('/experiments.php?mode=show&scope=1', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Unable to load folders (${response.status})`);
      const responseDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
      fragmentHtml = [
        responseDocument.getElementById(this.panelId)?.outerHTML ?? '',
        responseDocument.getElementById('editExperimentFolderModal')?.outerHTML ?? '',
        responseDocument.getElementById('folderReadmeModal')?.outerHTML ?? '',
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
    ['editExperimentFolderModal', 'folderReadmeModal'].forEach(id => {
      if (document.getElementById(id)) return;
      const modal = documentCopy.getElementById(id);
      if (modal) document.body.append(modal);
    });
    document.dispatchEvent(new CustomEvent('elabftw:folders-panel-loaded'));
  }
}
