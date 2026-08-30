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

type FavoriteFilterTarget = 'all' | 'experiments' | 'resources' | 'experiments_templates' | 'items_types';
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

interface ResultGroup {
  heading: string;
  items: { label: string; description: string; href?: string; onSelect?: () => void }[];
}
// Experiment/resource groups carry their raw results (instead of pre-built
// display items) so renderGrouped() can render them with renderResult() --
// same "Link"/"Add to text" insert actions as the single-target flow, which
// the grouped search would otherwise lack entirely.
interface EntityResultGroup {
  heading: string;
  target: FavoriteFilterTarget;
  results: FavoriteFilterResult[];
}
type SearchResultGroup = ResultGroup | EntityResultGroup;

const GROUPED_SEARCH_MIN_LENGTH = 2;
const GROUPED_SEARCH_PER_GROUP_LIMIT = 8;

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
    this.bindOverlayToggles();
  }

  // Plain hidden-attribute toggling instead of Bootstrap's dropdown/Popper
  // component: only one of Filters/Manage open at a time, closes on an
  // outside click or Escape, and there's no per-button transform
  // positioning to fight -- both overlays are placed with the same CSS,
  // anchored to their own button, regardless of which one is open.
  //
  // FavoriteFilters is instantiated more than once (common.ts AND
  // KeyboardShortcuts.class.ts each construct their own instance), so
  // without this guard each button would get one listener per instance --
  // a click would open then immediately re-close via the duplicate handler.
  private bindOverlayToggles(): void {
    if (document.body.dataset.favoriteOverlayBound === 'true') return;
    document.body.dataset.favoriteOverlayBound = 'true';
    const overlays: Record<string, HTMLElement | null> = {
      filters: document.getElementById('favoriteFiltersOverlay'),
      manage: document.getElementById('favoriteManageOverlay'),
    };
    const closeAll = (except?: string): void => {
      Object.entries(overlays).forEach(([key, overlay]) => {
        if (key !== except) overlay?.toggleAttribute('hidden', true);
      });
    };
    document.querySelectorAll<HTMLElement>('[data-action="toggle-favorite-overlay"]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const key = button.dataset.target;
        const overlay = key ? overlays[key] : null;
        if (!overlay) return;
        const opening = overlay.hasAttribute('hidden');
        closeAll();
        overlay.toggleAttribute('hidden', !opening);
        button.setAttribute('aria-expanded', String(opening));
      });
    });
    document.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      // Overlays are full-width siblings of both button wrappers within the
      // shared toolbar (not nested inside one anchor), so a click anywhere
      // in either overlay's content must be checked against the toolbar,
      // not the narrower per-button anchor.
      if (target.closest('.favorite-filter-toolbar')) return;
      closeAll();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeAll();
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
    const target = this.getTarget();
    // "All" has no single category/status group of its own -- category and
    // status filters only make sense once a specific entity type is picked,
    // so hide (and disable, see hasDetailedFilters()) both groups rather than
    // falling back to one of them.
    const categoryGroup = target === 'all' ? null : this.getCategoryGroup(target);
    document.querySelectorAll<HTMLElement>('[data-favorite-target-group]').forEach(group => {
      const isActive = categoryGroup !== null && group.dataset.favoriteTargetGroup === categoryGroup;
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

  // Only the explicit "Apply filters" button closes the overlay -- apply()
  // itself also runs on every live-update trigger (a checkbox toggling, the
  // text debounce, removing a chip), where closing it would kick the user
  // out mid-selection before they've finished checking every filter they want.
  applyAndClose(): void {
    const overlay = document.getElementById('favoriteFiltersOverlay');
    overlay?.toggleAttribute('hidden', true);
    document.querySelector('[data-action="toggle-favorite-overlay"][data-target="filters"]')
      ?.setAttribute('aria-expanded', 'false');
    this.apply();
  }

  // True once any category/tag/status/owner checkbox is checked -- in that
  // case the search stays scoped to the selected target (experiments,
  // resources, ...) via the existing single-target flow. With no detailed
  // filter active, a text query instead searches everything at once (see
  // runGroupedSearch()), folding in what used to be the standalone Unified
  // Search panel. Category/status checkboxes are excluded once disabled by
  // updateTarget() (their group is hidden for the current target) -- a
  // :checked input left over from a previous target shouldn't force the
  // narrow single-target flow while it's not even shown.
  private hasDetailedFilters(): boolean {
    return document.querySelector(
      '[data-favorite-filter-category]:checked:not(:disabled), [data-favorite-filter-tag]:checked, '
      + '[data-favorite-filter-status]:checked:not(:disabled), [data-favorite-filter-owner]:checked',
    ) !== null;
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
    if (value === 'all' || value === 'resources' || value === 'experiments_templates' || value === 'items_types') return value;
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

  // -- Grouped "search everything" (folded in from the former standalone
  // Unified Search panel) --------------------------------------------------

  private folderResults(query: string): ResultGroup {
    const items: ResultGroup['items'] = [];
    document.querySelectorAll<HTMLAnchorElement>('#foldersPanel a[href]').forEach(link => {
      const label = link.textContent?.trim();
      if (!label || !label.toLowerCase().includes(query) || items.length >= GROUPED_SEARCH_PER_GROUP_LIMIT) return;
      items.push({ label, description: 'Folder', onSelect: () => link.click() });
    });
    return { heading: 'Folders', items };
  }

  private async groupedEntityResults(
    target: FavoriteFilterTarget,
    heading: string,
    query: string,
  ): Promise<EntityResultGroup> {
    const entityType = this.getTargetEntityType(target);
    // An empty query omits fastq entirely rather than sending fastq= --
    // that's a plain unfiltered listing (most recent first), not "match
    // nothing", so "All" with no text still shows something per group.
    const params = new URLSearchParams({ limit: String(GROUPED_SEARCH_PER_GROUP_LIMIT), scope: '3' });
    if (query) params.set('fastq', query);
    try {
      const results = await ApiC.getJson<FavoriteFilterResult[]>(`${entityType}?${params.toString()}`);
      return { heading, target, results: Array.isArray(results) ? results : [] };
    } catch {
      return { heading, target, results: [] };
    }
  }

  private renderGrouped(groups: SearchResultGroup[], message?: string): void {
    const results = document.getElementById('favoriteFilterResults');
    if (!results) return;
    results.replaceChildren();
    if (message) {
      const info = document.createElement('p');
      info.className = 'text-muted px-2';
      info.textContent = message;
      results.append(info);
      return;
    }
    const groupSize = (group: SearchResultGroup): number => ('results' in group ? group.results.length : group.items.length);
    const nonEmpty = groups.filter(group => groupSize(group) > 0);
    if (nonEmpty.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-muted px-2';
      empty.textContent = 'No matches.';
      results.append(empty);
      return;
    }
    nonEmpty.forEach(group => {
      // Each type gets its own collapsible section (same <details>/<summary>
      // pattern as Categories/Status/Owner in the Filters overlay) with a
      // divider between sections, instead of one flat list where the type
      // boundary was only a small uppercase label easy to miss while scrolling.
      const section = document.createElement('details');
      section.className = 'favorite-filter-section';
      section.open = true;
      const summary = document.createElement('summary');
      summary.className = 'favorite-filter-section-summary';
      const chevron = document.createElement('i');
      chevron.className = 'fas fa-chevron-right fa-fw favorite-filter-section-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'unified-search-group-title mb-0';
      label.textContent = group.heading;
      summary.append(chevron, label);
      section.append(summary);

      const body = document.createElement('div');
      body.className = 'favorite-filter-section-body';

      if ('results' in group) {
        // Experiments/resources: reuse the single-target flow's card
        // renderer, so the same "Link"/"Add to text" insert actions (only
        // offered in experiment edit mode) are available here too.
        group.results.forEach(result => body.append(this.renderResult(result, group.target)));
      } else {
        // Tasks/folders: same transparent dark-chrome card as renderResult()
        // produces for experiments/resources, instead of Bootstrap's
        // .list-group-item (opaque --white background) -- these are
        // non-linkable entries so they don't need renderResult() itself, but
        // they still need to look like part of the same result list.
        group.items.forEach(item => {
          const entry = document.createElement('article');
          entry.className = 'favorite-filter-result unified-search-result';
          entry.innerHTML = `<strong class="favorite-filter-result-link"></strong>`
            + `${item.description ? '<p class="favorite-filter-result-meta mb-0"></p>' : ''}`;
          entry.querySelector('strong').textContent = item.label;
          const meta = entry.querySelector('p');
          if (meta) meta.textContent = item.description;
          if (item.href) {
            const link = document.createElement('a');
            link.className = 'favorite-filter-result-link';
            link.href = item.href;
            const itemLabel = entry.querySelector('strong');
            link.textContent = itemLabel.textContent;
            itemLabel.replaceWith(link);
          } else if (item.onSelect) {
            entry.style.cursor = 'pointer';
            entry.addEventListener('click', item.onSelect);
          }
          body.append(entry);
        });
      }
      section.append(body);
      results.append(section);
    });
  }

  private async runGroupedSearch(query: string): Promise<void> {
    const status = document.getElementById('favoriteFilterResultsStatus');
    const count = document.getElementById('favoriteFilterResultsCount');
    const fullResults = document.getElementById('favoriteFilterFullResults') as HTMLAnchorElement | null;
    const requestId = ++this.requestSequence;
    const loadingMessage = query ? 'Searching…' : 'Loading everything…';
    count?.toggleAttribute('hidden', true);
    fullResults?.toggleAttribute('hidden', true);
    if (status) {
      status.removeAttribute('hidden');
      status.textContent = loadingMessage;
    }
    this.renderGrouped([], loadingMessage);

    const groups = await Promise.all([
      this.groupedEntityResults('experiments', 'Experiments', query),
      this.groupedEntityResults('resources', 'Resources', query),
      this.groupedEntityResults('experiments_templates', 'Experiment templates', query),
      this.groupedEntityResults('items_types', 'Resource templates', query),
      Promise.resolve(this.folderResults(query)),
    ]);
    if (requestId !== this.requestSequence) return;
    this.renderGrouped(groups);
    if (status) {
      status.textContent = query
        ? 'Searching everything for matches.'
        : 'Showing recent entries across everything.';
    }
    this.resultsLoaded = true;
  }

  private async loadResults(): Promise<void> {
    const results = document.getElementById('favoriteFilterResults');
    const status = document.getElementById('favoriteFilterResultsStatus');
    const count = document.getElementById('favoriteFilterResultsCount');
    const fullResults = document.getElementById('favoriteFilterFullResults') as HTMLAnchorElement | null;
    if (!results || !status || !count || !fullResults) return;

    this.renderActiveChips();

    const query = document.querySelector<HTMLInputElement>('[data-favorite-filter-text]')?.value.trim() ?? '';
    const target = this.getTarget();
    // "All" has no single-entity-type listing of its own -- it always shows
    // everything grouped, with or without a query (an empty query just means
    // each group's own default/most-recent listing instead of a match list).
    if (target === 'all') {
      void this.runGroupedSearch(query.toLowerCase());
      return;
    }
    if (!this.hasDetailedFilters() && query.length >= GROUPED_SEARCH_MIN_LENGTH) {
      void this.runGroupedSearch(query.toLowerCase());
      return;
    }
    fullResults.removeAttribute('hidden');

    const requestId = ++this.requestSequence;
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
