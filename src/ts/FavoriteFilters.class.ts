/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import { ApiC } from './api';
import { getEditor } from './Editor.class';
import { entity } from './getEntity';
import { EntityType, LinkSubModel } from './interfaces';
import { escapeHTML, reloadElements } from './misc';
import SidePanel from './SidePanel.class';

type FavoriteFilterTarget = 'experiments' | 'resources';

interface FavoriteFilterResult {
  id: number;
  title: string;
  category_title?: string | null;
  status_title?: string | null;
  fullname?: string | null;
}

export default class FavoriteFilters extends SidePanel {
  private resultsLoaded = false;
  private requestSequence = 0;

  constructor() {
    super('favorites');
    this.panelId = 'favoritesPanel';
  }

  show(): void {
    super.show();
    if (!this.resultsLoaded) void this.loadResults();
  }

  updateTarget(): void {
    const target = this.getTarget();
    document.querySelectorAll<HTMLElement>('[data-favorite-target-group]').forEach(group => {
      const isActive = group.dataset.favoriteTargetGroup === target;
      group.toggleAttribute('hidden', !isActive);
      group.querySelectorAll<HTMLInputElement>('input').forEach(input => {
        input.disabled = !isActive;
      });
    });
    this.resultsLoaded = false;
    const panel = document.getElementById(this.panelId);
    if (panel && !panel.hasAttribute('hidden')) void this.loadResults();
  }

  apply(): void {
    void this.loadResults();
  }

  clear(): void {
    document.querySelectorAll<HTMLInputElement>(
      '[data-favorite-filter-category], [data-favorite-filter-tag], [data-favorite-filter-status], [data-favorite-filter-owner]',
    ).forEach(input => {
      input.checked = false;
    });
    this.apply();
  }

  getTarget(): FavoriteFilterTarget {
    const select = document.getElementById('favoriteFilterTarget') as HTMLSelectElement | null;
    return select?.value === 'resources' ? 'resources' : 'experiments';
  }

  private getFilterParams(): URLSearchParams {
    const target = this.getTarget();
    const params = new URLSearchParams();
    // Always search the complete accessible listing. Reusing the current page
    // could unintentionally retain "My experiments", a query, or pagination.
    params.set('scope', '3');

    const categories = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `[data-favorite-filter-category][data-category-type="${target}"]:checked`,
      ),
      input => input.value,
    );
    if (categories.length > 0) {
      params.set('category', categories.join(','));
    }

    const statuses = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `[data-favorite-filter-status][data-status-type="${target}"]:checked`,
      ),
      input => input.value,
    );
    if (statuses.length > 0) {
      params.set('status', statuses.join(','));
    }

    const owner = document.querySelector<HTMLInputElement>('[data-favorite-filter-owner]:checked');
    if (owner) {
      params.set('owner', owner.value);
    }

    document.querySelectorAll<HTMLInputElement>('[data-favorite-filter-tag]:checked').forEach(input => {
      params.append('tags[]', input.value);
    });
    return params;
  }

  private getListingUrl(): URL {
    const targetPath = this.getTarget() === 'experiments' ? '/experiments.php' : '/database.php';
    const url = new URL(targetPath, window.location.origin);
    url.search = this.getFilterParams().toString();
    return url;
  }

  private getResultUrl(target: FavoriteFilterTarget, id: number): URL {
    const targetPath = target === 'experiments' ? '/experiments.php' : '/database.php';
    const url = new URL(targetPath, window.location.origin);
    url.searchParams.set('mode', 'view');
    url.searchParams.set('id', String(id));
    url.hash = 'pageTitle';
    return url;
  }

  private isExperimentEditMode(): boolean {
    return entity.type === EntityType.Experiment
      && Number.isInteger(entity.id)
      && new URLSearchParams(window.location.search).get('mode') === 'edit';
  }

  private canInsertResultLink(target: FavoriteFilterTarget, resultId: number): boolean {
    return this.isExperimentEditMode()
      && !(target === 'experiments' && resultId === entity.id);
  }

  private renderResult(
    result: FavoriteFilterResult,
    target: FavoriteFilterTarget,
  ): HTMLElement {
    const item = document.createElement('article');
    item.className = 'favorite-filter-result';

    const heading = document.createElement('div');
    heading.className = 'd-flex align-items-start';
    const link = document.createElement('a');
    link.className = 'favorite-filter-result-link flex-grow-1';
    link.href = this.getResultUrl(target, result.id).toString();
    link.textContent = result.title || `Untitled ${target === 'experiments' ? 'experiment' : 'resource'}`;
    link.title = `Open ${target === 'experiments' ? 'experiment' : 'resource'}`;
    if (this.isExperimentEditMode()
      && !(target === 'experiments' && result.id === entity.id)
    ) {
      link.addEventListener('click', (event: MouseEvent) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        if (!window.confirm(
          'You are editing an experiment. Leave this page and risk losing unsaved changes?',
        )) {
          event.preventDefault();
        }
      });
    }
    heading.append(link);

    if (this.canInsertResultLink(target, result.id)) {
      const insert = document.createElement('button');
      insert.type = 'button';
      insert.className = 'btn btn-sm btn-outline-primary favorite-filter-result-insert ml-2';
      insert.title = 'Link this entry to the current experiment and insert it at the cursor';
      insert.setAttribute('aria-label', insert.title);
      const icon = document.createElement('i');
      icon.className = 'fas fa-link fa-fw';
      icon.setAttribute('aria-hidden', 'true');
      const insertLabel = document.createElement('span');
      insertLabel.className = 'ml-1';
      insertLabel.textContent = 'Link';
      insert.append(icon, insertLabel);
      insert.addEventListener('click', () => {
        void this.insertResultLink(result, target, insert);
      });
      heading.append(insert);
    }
    item.append(heading);

    const metadata = [
      result.category_title,
      result.status_title,
      result.fullname,
    ].filter((value): value is string => Boolean(value));
    if (metadata.length > 0) {
      const meta = document.createElement('p');
      meta.className = 'favorite-filter-result-meta mb-0';
      meta.textContent = metadata.join(' · ');
      item.append(meta);
    }
    return item;
  }

  private async insertResultLink(
    result: FavoriteFilterResult,
    target: FavoriteFilterTarget,
    button: HTMLButtonElement,
  ): Promise<void> {
    const submodel = target === 'experiments'
      ? LinkSubModel.ExperimentsLinks
      : LinkSubModel.ItemsLinks;
    const resultUrl = this.getResultUrl(target, result.id);
    const label = result.category_title
      ? `${result.category_title} – ${result.title}`
      : result.title;

    button.disabled = true;
    try {
      await ApiC.post(`${entity.type}/${entity.id}/${submodel}/${result.id}`);
      const editor = getEditor();
      const content = editor.type === 'md'
        ? `[${label.replace(/([\\[\]])/g, '\\$1')}](${resultUrl.toString()})`
        : `<a href="${escapeHTML(resultUrl.toString())}">${escapeHTML(label)}</a>`;
      editor.setContent(content);
      await reloadElements(['linksDiv']);
      button.title = 'Linked and inserted';
      button.setAttribute('aria-label', button.title);
      button.querySelector('i')?.classList.replace('fa-link', 'fa-check');
      const buttonLabel = button.querySelector<HTMLSpanElement>('span');
      if (buttonLabel) buttonLabel.textContent = 'Linked';
    } finally {
      button.disabled = false;
    }
  }

  private async loadResults(): Promise<void> {
    const results = document.getElementById('favoriteFilterResults');
    const status = document.getElementById('favoriteFilterResultsStatus');
    const count = document.getElementById('favoriteFilterResultsCount');
    const fullResults = document.getElementById('favoriteFilterFullResults') as HTMLAnchorElement | null;
    if (!results || !status || !count || !fullResults) return;

    const requestId = ++this.requestSequence;
    const target = this.getTarget();
    const params = this.getFilterParams();
    params.set('limit', '25');
    results.replaceChildren();
    count.toggleAttribute('hidden', true);
    status.removeAttribute('hidden');
    status.textContent = 'Loading matching entries…';
    fullResults.href = this.getListingUrl().toString();

    try {
      const endpoint = target === 'experiments' ? EntityType.Experiment : EntityType.Item;
      const response = await ApiC.getJson<FavoriteFilterResult[]>(
        `${endpoint}?${params.toString()}`,
      );
      if (requestId !== this.requestSequence) return;
      const entries = Array.isArray(response) ? response : [];
      results.replaceChildren(...entries.map(result => this.renderResult(result, target)));
      count.textContent = String(entries.length);
      count.toggleAttribute('hidden', false);
      status.textContent = entries.length === 0
        ? 'No matching entries.'
        : (entries.length === 25
          ? 'Showing the first 25 matching entries.'
          : `Showing ${entries.length} matching ${entries.length === 1 ? 'entry' : 'entries'}.`);
      this.resultsLoaded = true;
    } catch (error) {
      if (requestId !== this.requestSequence) return;
      status.textContent = error instanceof Error
        ? `Could not load results: ${error.message}`
        : 'Could not load matching entries.';
      this.resultsLoaded = false;
    }
  }
}
