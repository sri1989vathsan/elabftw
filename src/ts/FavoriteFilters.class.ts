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

type FavoriteFilterTarget = 'experiments' | 'resources' | 'experiments_templates' | 'items_types';
// Templates share the same category/status tables as their parent entity
// type (see EntityType::toCategoryTable/toStatusTable server-side), so the
// existing favorite categories/tags/statuses -- grouped by 'experiments' or
// 'resources' only -- apply to their templates too, without needing a
// second, duplicate set of favorites.
type FavoriteCategoryGroup = 'experiments' | 'resources';

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

  private textFilterTimer: number | null = null;

  constructor() {
    super('favorites');
    this.panelId = 'favoritesPanel';
    const textFilter = document.querySelector<HTMLInputElement>('[data-favorite-filter-text]');
    if (textFilter && !textFilter.dataset.favoriteFilterReady) {
      textFilter.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.apply();
      });
      textFilter.addEventListener('input', () => {
        if (this.textFilterTimer !== null) window.clearTimeout(this.textFilterTimer);
        this.textFilterTimer = window.setTimeout(() => this.apply(), 300);
      });
      textFilter.dataset.favoriteFilterReady = 'true';
    }
    // Delegated (not per-checkbox) so it survives reloadSections() swapping
    // the checkboxes out for freshly rendered ones after a favorite is
    // added/removed. Results now update as soon as a filter is toggled,
    // instead of only when "Apply filters" is clicked.
    const panel = document.getElementById(this.panelId);
    panel?.addEventListener('change', event => {
      const target = event.target as HTMLElement;
      if (target.matches(
        '[data-favorite-filter-category], [data-favorite-filter-tag], [data-favorite-filter-status], [data-favorite-filter-owner]',
      )) {
        this.apply();
      }
    });
  }

  show(): void {
    super.show();
    void this.loadOwnerOptions();
    if (!this.resultsLoaded) void this.loadResults();
  }

  private async loadOwnerOptions(): Promise<void> {
    const target = document.getElementById('favoriteFilterOwnerOptions');
    if (!target || target.dataset.lazyOwnerOptions !== '1') return;
    target.dataset.lazyOwnerOptions = 'loading';
    const url = new URL(window.location.href);
    url.searchParams.set('load_filter_options', '1');
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      target.dataset.lazyOwnerOptions = '1';
      return;
    }
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    const loaded = parsed.getElementById('favoriteFilterOwnerOptions');
    if (!loaded) return;
    target.replaceChildren(...Array.from(loaded.children).map(option => option.cloneNode(true)));
    target.dataset.lazyOwnerOptions = '0';
  }

  private getCategoryGroup(target: FavoriteFilterTarget = this.getTarget()): FavoriteCategoryGroup {
    return target === 'resources' || target === 'items_types' ? 'resources' : 'experiments';
  }

  updateTarget(): void {
    const categoryGroup = this.getCategoryGroup();
    document.querySelectorAll<HTMLElement>('[data-favorite-target-group]').forEach(group => {
      const isActive = group.dataset.favoriteTargetGroup === categoryGroup;
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
    const textFilter = document.querySelector<HTMLInputElement>('[data-favorite-filter-text]');
    if (textFilter) textFilter.value = '';
    document.querySelectorAll<HTMLInputElement>(
      '[data-favorite-filter-category], [data-favorite-filter-tag], [data-favorite-filter-status], [data-favorite-filter-owner]',
    ).forEach(input => {
      input.checked = false;
    });
    this.apply();
  }

  async reloadSections(elementIds: string[]): Promise<void> {
    const panel = document.getElementById(this.panelId);
    const scrollTop = panel?.scrollTop ?? 0;
    const checkedInputIds = new Set(Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '[data-favorite-filter-category]:checked, [data-favorite-filter-tag]:checked, [data-favorite-filter-status]:checked, [data-favorite-filter-owner]:checked',
      ),
      input => input.id,
    ));

    await reloadElements(elementIds);
    checkedInputIds.forEach(id => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) input.checked = true;
    });
    this.updateTarget();
    if (panel) panel.scrollTop = scrollTop;
  }

  getTarget(): FavoriteFilterTarget {
    const select = document.getElementById('favoriteFilterTarget') as HTMLSelectElement | null;
    const value = select?.value;
    if (value === 'resources' || value === 'experiments_templates' || value === 'items_types') return value;
    return 'experiments';
  }

  private getFilterParams(): URLSearchParams {
    const categoryGroup = this.getCategoryGroup();
    const params = new URLSearchParams();
    // Always search the complete accessible listing. Reusing the current page
    // could unintentionally retain "My experiments", a query, or pagination.
    params.set('scope', '3');

    const textFilter = document.querySelector<HTMLInputElement>('[data-favorite-filter-text]')?.value.trim();
    if (textFilter) {
      params.set('q', textFilter);
    }

    const categories = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `[data-favorite-filter-category][data-category-type="${categoryGroup}"]:checked`,
      ),
      input => input.value,
    );
    if (categories.length > 0) {
      params.set('category', categories.join(','));
    }

    const statuses = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `[data-favorite-filter-status][data-status-type="${categoryGroup}"]:checked`,
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

  private getTargetPath(target: FavoriteFilterTarget): string {
    switch (target) {
    case 'resources': return '/database.php';
    case 'experiments_templates': return '/templates.php';
    case 'items_types': return '/resources-templates.php';
    default: return '/experiments.php';
    }
  }

  private getTargetLabel(target: FavoriteFilterTarget): string {
    switch (target) {
    case 'resources': return 'resource';
    case 'experiments_templates': return 'experiment template';
    case 'items_types': return 'resource template';
    default: return 'experiment';
    }
  }

  private getTargetEntityType(target: FavoriteFilterTarget): EntityType {
    switch (target) {
    case 'resources': return EntityType.Item;
    case 'experiments_templates': return EntityType.Template;
    case 'items_types': return EntityType.ItemType;
    default: return EntityType.Experiment;
    }
  }

  private getListingUrl(): URL {
    const url = new URL(this.getTargetPath(this.getTarget()), window.location.origin);
    url.search = this.getFilterParams().toString();
    return url;
  }

  private getResultUrl(target: FavoriteFilterTarget, id: number): URL {
    const url = new URL(this.getTargetPath(target), window.location.origin);
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
    // Templates aren't linkable entities on an experiment the way another
    // experiment or resource is -- only offer the "attach" action for those.
    return (target === 'experiments' || target === 'resources')
      && this.isExperimentEditMode()
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
    link.textContent = result.title || `Untitled ${this.getTargetLabel(target)}`;
    link.title = `Open ${this.getTargetLabel(target)}`;
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
      insert.title = 'Attach this entry to the current experiment';
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

      const insertInText = document.createElement('button');
      insertInText.type = 'button';
      insertInText.className = 'btn btn-sm btn-outline-primary favorite-filter-result-insert ml-1';
      insertInText.title = 'Add a link to this entry at the current main-text cursor';
      insertInText.setAttribute('aria-label', insertInText.title);
      const textIcon = document.createElement('i');
      textIcon.className = 'fas fa-paragraph fa-fw';
      textIcon.setAttribute('aria-hidden', 'true');
      const textLabel = document.createElement('span');
      textLabel.className = 'ml-1';
      textLabel.textContent = 'Add to text';
      insertInText.append(textIcon, textLabel);
      insertInText.addEventListener('click', () => {
        this.insertResultInMainText(result, target);
      });
      heading.append(insertInText);
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

  private getMainTextLink(
    result: FavoriteFilterResult,
    target: FavoriteFilterTarget,
    editorType: string,
  ): string {
    const resultUrl = this.getResultUrl(target, result.id);
    const label = result.category_title
      ? `${result.category_title} – ${result.title}`
      : result.title;
    return editorType === 'md'
      ? `[${label.replace(/([\\[\]])/g, '\\$1')}](${resultUrl.toString()})`
      : `<a href="${escapeHTML(resultUrl.toString())}">${escapeHTML(label)}</a>`;
  }

  private insertResultInMainText(
    result: FavoriteFilterResult,
    target: FavoriteFilterTarget,
  ): void {
    const editor = getEditor();
    editor.setContent(this.getMainTextLink(result, target, editor.type));
  }

  private async insertResultLink(
    result: FavoriteFilterResult,
    target: FavoriteFilterTarget,
    button: HTMLButtonElement,
  ): Promise<void> {
    const submodel = target === 'experiments'
      ? LinkSubModel.ExperimentsLinks
      : LinkSubModel.ItemsLinks;

    button.disabled = true;
    try {
      await ApiC.post(`${entity.type}/${entity.id}/${submodel}/${result.id}`);
      await reloadElements(['linksDiv']);
      button.title = 'Attached to the current experiment';
      button.setAttribute('aria-label', button.title);
      button.querySelector('i')?.classList.replace('fa-link', 'fa-check');
      const buttonLabel = button.querySelector<HTMLSpanElement>('span');
      if (buttonLabel) buttonLabel.textContent = 'Attached';
    } finally {
      button.disabled = false;
    }
  }

  // A single glance at what's actually applied, instead of having to scroll
  // back up through every collapsible section to remember what's checked.
  // Each chip removes just that one filter and re-searches immediately.
  private renderActiveChips(): void {
    const container = document.getElementById('favoriteActiveFiltersDiv');
    if (!container) return;
    const chips: { label: string; onRemove: () => void }[] = [];

    const textFilter = document.querySelector<HTMLInputElement>('[data-favorite-filter-text]');
    if (textFilter?.value.trim()) {
      const value = textFilter.value.trim();
      chips.push({ label: `Text: ${value}`, onRemove: () => { textFilter.value = ''; this.apply(); } });
    }

    document.querySelectorAll<HTMLInputElement>(
      '[data-favorite-filter-category]:checked, [data-favorite-filter-tag]:checked, '
      + '[data-favorite-filter-status]:checked, [data-favorite-filter-owner]:checked',
    ).forEach(input => {
      if (input.disabled) return; // belongs to a hidden (inactive target) group
      const label = document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ?? input.value;
      chips.push({ label, onRemove: () => { input.checked = false; this.apply(); } });
    });

    container.replaceChildren();
    container.toggleAttribute('hidden', chips.length === 0);
    chips.forEach(chip => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'favorite-filter-chip';
      button.title = `Remove filter: ${chip.label}`;
      button.innerHTML = '<span></span><i class="fas fa-xmark fa-fw ml-1" aria-hidden="true"></i>';
      button.querySelector('span').textContent = chip.label;
      button.addEventListener('click', chip.onRemove);
      container.append(button);
    });
  }

  private async loadResults(): Promise<void> {
    const results = document.getElementById('favoriteFilterResults');
    const status = document.getElementById('favoriteFilterResultsStatus');
    const count = document.getElementById('favoriteFilterResultsCount');
    const fullResults = document.getElementById('favoriteFilterFullResults') as HTMLAnchorElement | null;
    if (!results || !status || !count || !fullResults) return;

    this.renderActiveChips();
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
      const endpoint = this.getTargetEntityType(target);
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
