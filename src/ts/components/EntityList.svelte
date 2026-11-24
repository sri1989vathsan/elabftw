<script lang='ts'>
  /**
   * @author Nicolas CARPi / Deltablot
   * @copyright 2026 Nicolas CARPi
   * @see https://www.elabftw.net Official website
   * @license AGPL-3.0
   * @package elabftw
   */
  import { onMount, tick } from 'svelte';
  import type { Writable } from 'svelte/store';
  import { ApiC } from '../api';
  import i18next from '../i18n';
  import { State, type StateValue } from '../state.auto';
  import { relativeMoment } from "../misc";

  // this is only used in the template, so it is stripped by svelte during compilation
  // copy it so it stays available
  const EntityState = State;

  type EntityType = 'experiments' | 'items' | 'experiments_templates' | 'items_types';

  interface EntityTag {
    tag: string;
    id: number;
    is_favorite: boolean;
  }

  interface EntityListItem {
    id: number;
    title: string | null;
    experiment_goal?: string | null;
    experiment_conclusion?: string | null;
    experiment_notes?: string | null;
    state: StateValue;
    category?: string | null;
    category_title?: string | null;
    category_color?: string | null;
    status?: string | null;
    status_title?: string | null;
    status_color?: string | null;
    rating?: number | null;
    custom_id?: string | null;
    userid?: number | null;
    fullname?: string | null;
    team?: number | null;
    team_name?: string | null;
    timestamped?: boolean;
    signature_count?: number;
    last_signed_by?: number;
    timestampedby?: number;
    next_step?: string | null;
    locked?: boolean;
    modified_at?: string | null;
    steps_done?: number | string | null;
    steps_total?: number | string | null;
    date?: string | null;
    created_at?: string | null;
    is_pinned?: boolean;
    tags_decoded?: EntityTag[] | null;
  }

  const t = i18next.t.bind(i18next);
  const SEARCH_DEBOUNCE_MS = 500;
  const GOAL_COLLAPSE_LENGTH = 180;

  let {
    entityType = 'experiments',
    limit = 15,
    order = 'date',
    sort = 'desc',
    searchQuery,
    queryPending,
    selectedEntities = [],
    layout,
    currentUserId = null,
    currentTeam = null,
    isAdmin = false,
    isAnon = false,
    onInitialLoadDone,
  } = $props<{
    entityType?: EntityType;
    limit?: number;
    order?: string;
    sort?: string;
    searchQuery: Writable<string>;
    queryPending?: Writable<boolean>;
    selectedEntities: Writable<string[]>;
    layout?: Writable<string>;
    currentUserId?: number | null;
    currentTeam?: number | null;
    isAdmin?: boolean;
    isAnon?: boolean;
    onInitialLoadDone?: () => void;
  }>();

  // 'it' cards, 'cr' grouped compact rows, 'pv' compact rows with a preview pane of the selected entry
  let layoutMode = $state('it');
  let previewId = $state<number | null>(null);

  const previewEntity = $derived(entities.find(item => item.id === previewId) ?? entities[0] ?? null);

  // ---- board by status (experiments): one column per status of the team, in their configured order ----
  type StatusColumn = { id: string | null; title: string; color: string };
  let statusColumns = $state<StatusColumn[]>([]);
  let statusesLoaded = false;
  let draggedId = $state<number | null>(null);
  let dropColumn = $state<string | null>(null);

  async function loadStatuses(): Promise<void> {
    if (statusesLoaded) return;
    statusesLoaded = true;
    try {
      const list = await ApiC.getJson('teams/current/experiments_status?limit=9000') as Array<{ id: number; title: string; color: string }>;
      statusColumns = [
        { id: null, title: t('not-set'), color: 'bdbdbd' },
        ...(Array.isArray(list) ? list : []).map(status => ({ id: String(status.id), title: status.title, color: status.color || 'bdbdbd' })),
      ];
    } catch {
      statusesLoaded = false;
    }
  }

  $effect(() => {
    if (layoutMode === 'bd') void loadStatuses();
  });

  function columnEntities(column: StatusColumn): EntityListItem[] {
    return entities.filter(item => (item.status == null || item.status === '' ? null : String(item.status)) === column.id);
  }

  async function moveToStatus(item: EntityListItem, column: StatusColumn): Promise<void> {
    const previous = { status: item.status, status_title: item.status_title, status_color: item.status_color };
    // shown at once; put back when the server refuses
    item.status = column.id;
    item.status_title = column.id === null ? null : column.title;
    item.status_color = column.id === null ? null : column.color;
    entities = [...entities];
    try {
      await ApiC.patch(`${entityType}/${item.id}`, { status: column.id === null ? null : Number(column.id), notifOnSaved: 0 });
    } catch {
      Object.assign(item, previous);
      entities = [...entities];
    }
  }

  function stepsLabel(item: EntityListItem): string {
    const total = Number(item.steps_total ?? 0);
    return total > 0 ? `${Number(item.steps_done ?? 0)}/${total}` : '';
  }

  // arrow keys move the selection of the preview list
  function onPreviewKeydown(event: KeyboardEvent): void {
    if (layoutMode !== 'pv' || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return;
    const index = Math.max(0, entities.findIndex(item => item.id === (previewEntity?.id ?? -1)));
    const next = entities[Math.min(entities.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    event.preventDefault();
    previewId = next.id;
    void tick().then(() => document.querySelector(`.entity-rows [data-entity-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  // Pinned entries come first, in a group of their own, then the rest by the month of their date (created for templates); the order of the
  // server is kept inside each group (it puts pinned entries first whatever the sort, so they are on the first page too).
  const groups = $derived.by(() => {
    const result: Array<{ key: string; label: string; items: EntityListItem[] }> = [];
    const pinned = entities.filter(item => item.is_pinned);
    if (pinned.length > 0) result.push({ key: 'pinned', label: t('Pinned'), items: pinned });
    for (const item of entities) {
      if (item.is_pinned) continue;
      const raw = isTemplateType(entityType) ? item.created_at : item.date;
      const key = raw && /^\d{4}-\d{2}/.test(String(raw)) ? String(raw).slice(0, 7) : '';
      let group = result.find(candidate => candidate.key === key);
      if (!group) {
        const label = key === ''
          ? t('No date')
          : new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        group = { key, label, items: [] };
        result.push(group);
      }
      group.items.push(item);
    }
    return result;
  });

  let hasReportedInitialLoad = false;
  let entities = $state<EntityListItem[]>([]);
  let error = $state('');
  let requestSeq = 0;

  let urlVersion = $state(0);
  let isLoading = $state(false);
  let isLoadingMore = $state(false);
  let hasMore = $state(true);
  let sentinelEl = $state<HTMLDivElement | null>(null);
  let currentQueryKey = '';
  let reloadVersion = $state(0);
  let debouncedSearchQuery = $state('');
  let searchDebounceTimer: number | undefined;
  let hasPendingQueryResults = $state(false);
  let queryResultsRequestSeq = 0;
  let hasInitializedDebouncedSearch = false;
  let nonSearchFilterSignature = '';

  function setPendingQueryResults(value: boolean): void {
    hasPendingQueryResults = value;
    queryPending?.set(value);
  }

  function bumpUrlVersion(): void {
    urlVersion += 1;
  }

  type FilterParam = 'owner' | 'category' | 'status';

  type EntityQueryContext = {
    currentType: EntityType;
    currentLimit: number;
    currentQ: string;
    currentCategory: string;
    currentStatus: string;
    currentOwner: string;
    currentTags: string[];
    currentState: string;
    currentScope: string;
    currentBookable: string;
    currentFolder: string;
    currentModifiedDays: string;
    currentOpenSteps: string;
    currentOrder: string;
    currentSort: string;
    currentRelated: number | null;
    currentRelatedOrigin: string;
  };

  let fullnames = $state<Record<number, string>>({});
  const loadingFullnames = new Set<number>();

  async function getFullname(userId: number): Promise<void> {
    if (!userId || fullnames[userId] || loadingFullnames.has(userId)) return;

    loadingFullnames.add(userId);

    try {
      const user = await ApiC.getJson(`users/${userId}`);
      fullnames[userId] = user.fullname;
    } finally {
      loadingFullnames.delete(userId);
    }
  }


  function handleFilterClick(
    event: MouseEvent,
    param: FilterParam,
    value: string | number | null | undefined,
    label: string | null | undefined,
  ): void {
    event.preventDefault();
    event.stopPropagation();

    if (value == null || String(value).length === 0) {
      return;
    }

    window.dispatchEvent(new CustomEvent('entity-filter-requested', {
      detail: {
        param,
        value: String(value),
        label: label ?? String(value),
      },
    }));
  }

  function getCurrentUrlParam(param: string): string {
    return new URL(window.location.href).searchParams.get(param)?.trim() ?? '';
  }

  function getCurrentUrlParamOrFallback(param: string, fallback: string): string {
    const value = getCurrentUrlParam(param);

    return value.length > 0 ? value : fallback;
  }

  function getCurrentUrlNumberParam(param: string): number | null {
    const value = getCurrentUrlParam(param);

    if (value.length === 0) {
      return null;
    }

    const numberValue = Number(value);

    return Number.isFinite(numberValue) ? numberValue : null;
  }

  function getCurrentUrlTags(): string[] {
    return new URL(window.location.href).searchParams
      .getAll('tags[]')
      .map(tag => tag.trim())
      .filter(Boolean);
  }

  function clearInUrl(param: string): void {
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.replaceState({}, '', url.toString());
    bumpUrlVersion();
  }

  function setSingleTagInUrl(tag: string): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('tags[]');
    url.searchParams.append('tags[]', tag);

    window.history.replaceState({}, '', url.toString());
    bumpUrlVersion();
  }

  function handleTagClick(event: MouseEvent, tag: string): void {
    event.preventDefault();

    if (getCurrentUrlTags().includes(tag)) {
      clearInUrl('tags[]');
      return;
    }

    setSingleTagInUrl(tag);
  }

  function getCurrentNonSearchFilterSignature(): string {
    const params = new URL(window.location.href).searchParams;
    const normalized = new URLSearchParams(params);

    normalized.delete('q');
    normalized.delete('offset');

    return normalized.toString();
  }

  function bumpReloadVersionIfFiltersChanged(): void {
    nonSearchFilterSignature = getCurrentNonSearchFilterSignature();
    reloadVersion += 1;
  }

  $effect(() => {
    const nextQuery = $searchQuery.trim();

    if (!hasInitializedDebouncedSearch) {
      hasInitializedDebouncedSearch = true;
      debouncedSearchQuery = nextQuery;
      setPendingQueryResults(false);
      return;
    }

    if (nextQuery === debouncedSearchQuery) {
      setPendingQueryResults(queryResultsRequestSeq !== 0);
      return;
    }

    setPendingQueryResults(true);

    if (searchDebounceTimer !== undefined) {
      window.clearTimeout(searchDebounceTimer);
    }

    searchDebounceTimer = window.setTimeout(() => {
      if (debouncedSearchQuery !== nextQuery) {
        debouncedSearchQuery = nextQuery;
      }

      searchDebounceTimer = undefined;
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchDebounceTimer !== undefined) {
        window.clearTimeout(searchDebounceTimer);
      }
    };
  });

  function getEntityQueryContext(): EntityQueryContext {
    return {
      currentType: entityType,
      currentLimit: limit,
      currentQ: debouncedSearchQuery,
      currentCategory: getCurrentUrlParam('category'),
      currentStatus: getCurrentUrlParam('status'),
      currentOwner: getCurrentUrlParam('owner'),
      currentTags: getCurrentUrlTags(),
      currentState: getCurrentUrlParam('state'),
      currentScope: getCurrentUrlParam('scope'),
      currentBookable: getCurrentUrlParam('bookable'),
      currentFolder: getCurrentUrlParam('folder'),
      currentModifiedDays: getCurrentUrlParam('modified_days'),
      currentOpenSteps: getCurrentUrlParam('open_steps'),
      currentOrder: getCurrentUrlParamOrFallback('order', order),
      currentSort: getCurrentUrlParamOrFallback('sort', sort),
      currentRelated: getCurrentUrlNumberParam('related'),
      currentRelatedOrigin: getCurrentUrlParam('related_origin'),
    };
  }

  function getEntityQueryKey(
    context: EntityQueryContext,
    currentReloadVersion: number,
  ): string {
    return JSON.stringify([
      context.currentType,
      context.currentLimit,
      context.currentQ,
      context.currentStatus,
      context.currentCategory,
      context.currentOwner,
      context.currentTags,
      context.currentState,
      context.currentScope,
      context.currentBookable,
      context.currentFolder,
      context.currentModifiedDays,
      context.currentOpenSteps,
      context.currentOrder,
      context.currentSort,
      context.currentRelated,
      context.currentRelatedOrigin,
      currentReloadVersion,
    ]);
  }

  $effect(() => {
    entities;
    void tick().then(() => {
      document.querySelectorAll('.relative-moment').forEach(el => el.textContent = '');
      relativeMoment();
    });
  });

  $effect(() => {
    urlVersion;

    const currentReloadVersion = reloadVersion;
    const context = getEntityQueryContext();
    const nextQueryKey = getEntityQueryKey(context, currentReloadVersion);
    // Reconnect the observer after every appended page. When the sentinel is
    // still within rootMargin, IntersectionObserver does not necessarily emit
    // a second transition after its position changes, which used to stop the
    // list after one page on tall screens.
    const currentEntityCount = entities.length;

    if (nextQueryKey !== currentQueryKey) {
      currentQueryKey = nextQueryKey;
      hasMore = true;

      void loadEntities(context, 0, true);
    }

    if (!sentinelEl) {
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];

        if (!entry?.isIntersecting) {
          return;
        }

        if (hasPendingQueryResults || isLoading || isLoadingMore || !hasMore || currentEntityCount === 0) {
          return;
        }

        void loadEntities(
          getEntityQueryContext(),
          currentEntityCount,
          false,
        );
      },
      {
        rootMargin: '600px 0px',
      },
    );

    observer.observe(sentinelEl);

    return () => {
      observer.disconnect();
    };
  });

  async function loadEntities(
    context: EntityQueryContext,
    currentOffset: number,
    replace: boolean,
  ): Promise<void> {

    const {
      currentType,
      currentLimit,
      currentQ,
      currentCategory,
      currentStatus,
      currentOwner,
      currentTags,
      currentState,
      currentScope,
      currentBookable,
      currentFolder,
      currentModifiedDays,
      currentOpenSteps,
      currentOrder,
      currentSort,
      currentRelated,
      currentRelatedOrigin,
    } = context;
    const seq = ++requestSeq;
    error = '';

    if (replace) {
      isLoading = true;
    } else {
      isLoadingMore = true;
    }

    if (replace && hasPendingQueryResults && currentQ === $searchQuery.trim()) {
      queryResultsRequestSeq = seq;
    }

    try {
      const params: Record<string, string | number | string[]> = {
        limit: currentLimit,
        offset: currentOffset,
      };

      if (currentQ.length > 0) {
        params.q = currentQ;
      }

      if (currentCategory.length > 0) {
        params['category'] = currentCategory;
      }
      if (currentStatus.length > 0) {
        params['status'] = currentStatus;
      }
      if (currentOwner.length > 0) {
        params['owner'] = currentOwner;
      }

      if (currentTags.length > 0) {
        params['tags[]'] = currentTags;
      }

      if (currentState.length > 0) {
        params['state'] = currentState;
      }

      if (currentScope.length > 0) {
        params['scope'] = currentScope;
      }

      if (currentBookable.length > 0) {
        params['bookable'] = currentBookable;
      }

      // dashboard tiles: modified in the last N days, and having an unfinished step
      if (currentModifiedDays.length > 0) {
        params['modified_days'] = currentModifiedDays;
      }
      if (currentOpenSteps.length > 0) {
        params['open_steps'] = currentOpenSteps;
      }

      // Folder links reload the list page with ?folder=<id>. Keep that
      // filter when the Svelte list fetches its rows from the API, including
      // folder=0 for the Unfiled view.
      if ((currentType === 'experiments' || currentType === 'items') && currentFolder.length > 0) {
        params['folder'] = currentFolder;
      }

      if (currentOrder.length > 0) {
        params['order'] = currentOrder;
      }

      if (currentSort.length > 0) {
        params['sort'] = currentSort;
      }

      if (currentRelated !== null) {
        params['related'] = currentRelated;
      }

      if (currentRelatedOrigin.length > 0) {
        params['related_origin'] = currentRelatedOrigin;
      }

      // don't display errors
      params['notifOnError'] = 0;

      // fetch entries
      const payload = await ApiC.getJson(currentType, params) as EntityListItem[] | { items?: EntityListItem[] };

      if (seq !== requestSeq) {
        return;
      }

      const nextEntities = Array.isArray(payload) ? payload : (payload.items ?? []);

      if (replace) {
        entities = nextEntities;
      } else {
        const existingIds = new Set(entities.map(item => item.id));
        entities = [
          ...entities,
          ...nextEntities.filter(item => !existingIds.has(item.id)),
        ];
      }

      hasMore = nextEntities.length === currentLimit;
    } catch (err) {
      if (seq !== requestSeq) {
        return;
      }

      // example: type "title:" in search bar, it's incomplete, we ignore the error
      const apiError = err as Error & { status?: number };

      if (apiError.status === 400) {
        error = '';
        return;
      }

      error = apiError.message || t('error');
    } finally {

      if (seq === requestSeq) {
        if (replace) {
          isLoading = false;
        } else {
          isLoadingMore = false;
        }

        if (queryResultsRequestSeq === seq && currentQ === $searchQuery.trim()) {
          queryResultsRequestSeq = 0;
          setPendingQueryResults(false);
        }

        if (!hasReportedInitialLoad) {
          hasReportedInitialLoad = true;
          await tick();
          onInitialLoadDone?.();
        }
      }
    }
  }

  function isTemplateType(type: EntityType): boolean {
    return type === 'experiments_templates' || type === 'items_types';
  }

  function getCreateLabel(type: EntityType): string {
    return type === 'items_types'
      ? t('create-resource-from-template')
      : t('create-experiment-from-template');
  }

  function getCreateDataType(type: EntityType): 'experiments' | 'database' {
    return type === 'experiments_templates' ? 'experiments' : 'database';
  }

  function formatDate(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value.slice(0, 10);
    }

    return date.toISOString().slice(0, 10);
  }

  // One block for Goals, Conclusion and Notes (list card, preview pane): the label and icon in a fixed column, the text in
  // a hanging indent next to it, every line of the value kept as its own line, numbered/bulleted lines indented as lists,
  // and long values clamped with a small Show more that expands in place.
  const LIST_MARKER = /^\s*(\d+[.)]|[-*\u2022])\s+/;
  function fieldLines(value: string): Array<{ text: string; list: boolean }> {
    return value.replace(/\r\n?/g, '\n').trim().split('\n').map(text => ({ text: text.trimEnd(), list: LIST_MARKER.test(text) }));
  }
  function fieldIsLong(value: string, clamp: number): boolean {
    return fieldLines(value).length > clamp || value.trim().length > clamp * 70;
  }
  let expandedFields = $state<Record<string, boolean>>({});

  function getSummaryPreview(summary: string): string {
    const normalized = summary.replace(/\s+/g, ' ').trim();
    return normalized.length > GOAL_COLLAPSE_LENGTH
      ? `${normalized.slice(0, GOAL_COLLAPSE_LENGTH).trimEnd()}…`
      : normalized;
  }

  function getLeftColor(entity: EntityListItem): string {
    return entity.category_color || '6f6f6f';
  }

  function canEditEntity(entity: EntityListItem): boolean {
    return entity.userid === currentUserId || entityType === 'items' || isAdmin;
  }

  onMount(() => {
    const unsubscribeLayout = layout?.subscribe(value => { layoutMode = value; });
    nonSearchFilterSignature = getCurrentNonSearchFilterSignature();

    window.addEventListener('popstate', bumpUrlVersion);
    window.addEventListener('entity-filters-changed', bumpReloadVersionIfFiltersChanged);

    return () => {
      window.removeEventListener('popstate', bumpUrlVersion);
      window.removeEventListener('entity-filters-changed', bumpReloadVersionIfFiltersChanged);
      unsubscribeLayout?.();
    };
  });
</script>

{#if error && entities.length === 0}
  <div class='alert alert-danger'>{error}</div>
{:else}
  {#snippet fieldBlock(key: string, label: string, icon: string, value: string | null | undefined, clamp: number)}
    {#if value?.trim()}
      {@const open = expandedFields[key] === true}
      <div class={`fx-field ${open ? 'is-open' : ''}`} style={`--fx-clamp: ${clamp};`}>
        <div class='fx-field-label'><i class={`fas ${icon} fa-fw`} aria-hidden='true'></i><span>{label}</span></div>
        <div class='fx-field-body'>
          <div class='fx-field-text'>
            {#each fieldLines(value) as line}
              {#if line.text === ''}
                <div class='fx-line fx-line-gap'></div>
              {:else}
                <div class={`fx-line ${line.list ? 'fx-line-list' : ''}`}>{line.text}</div>
              {/if}
            {/each}
          </div>
          {#if fieldIsLong(value, clamp)}
            <button type='button' class='fx-field-more' aria-expanded={open} onclick={() => { expandedFields[key] = !open; }}>
              {open ? t('Show less') : t('Show more')}
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet compactRow(entity: EntityListItem, index: number)}
    {@const rowId = `entity-body-${entity.id}-${index}`}
    <section
      class={`entity entity-row d-flex align-items-center ${layoutMode === 'pv' && previewEntity?.id === entity.id ? 'is-previewed' : ''}`}
      id={`parent_${rowId}`}
      data-entity-id={entity.id}
      style={`--left-color: #${getLeftColor(entity)};`}
      aria-label={`${t('Entry')}_${rowId}`}
    >
      <input
        autocomplete='off'
        type='checkbox'
        data-action='checkbox-entity'
        data-id={entity.id}
        data-randomid={rowId}
        data-type={entityType}
        aria-label={t('Select')}
        class='entity-row-check'
      />
      {#if layoutMode === 'pv'}
        <button type='button' class='entity-row-title btn-link-plain' onclick={() => { previewId = entity.id; }}>
          {entity.title || t('entity-default-title')}
        </button>
      {:else}
        <a class='entity-row-title' href={`?mode=view&id=${entity.id}`}>{entity.title || t('entity-default-title')}</a>
      {/if}
      {#if entity.status_title}<span class='entity-row-meta' title={t('Status')}>{entity.status_title}</span>{/if}
      {#if entity.category_title}<span class='entity-row-meta' title={t('Category')}>{entity.category_title}</span>{/if}
      <span class='entity-row-meta entity-row-date'>{formatDate(isTemplateType(entityType) ? entity.created_at : entity.date)}</span>
      <button
        type='button'
        title={t('toggle-pin')}
        aria-label={t('toggle-pin')}
        data-action='toggle-pin'
        data-id={entity.id}
        class={`entity-row-pin ${entity.is_pinned ? 'is-pinned' : ''}`}
      ><i class={`fas fa-thumbtack fa-fw ${!entity.is_pinned ? 'color-weak' : ''}`} aria-hidden='true'></i></button>
    </section>
  {/snippet}

  {#if layoutMode === 'bd'}
    <div class='entity-board' id='itemList' role='group' aria-label={t('Board by status')}>
      {#if isLoading && entities.length === 0}
        {#each [0, 1, 2, 3] as column (column)}
          <div class='entity-board-column'><div class='fx-skeleton'></div><div class='fx-skeleton'></div></div>
        {/each}
      {:else}
        {#each statusColumns as column (column.id ?? 'none')}
          {@const cards = columnEntities(column)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class={`entity-board-column ${dropColumn === (column.id ?? 'none') ? 'is-drop' : ''}`}
            ondragover={event => { if (draggedId !== null) { event.preventDefault(); dropColumn = column.id ?? 'none'; } }}
            ondragleave={() => { if (dropColumn === (column.id ?? 'none')) dropColumn = null; }}
            ondrop={event => {
              event.preventDefault();
              const moved = entities.find(item => item.id === draggedId);
              draggedId = null;
              dropColumn = null;
              if (moved && (moved.status == null || moved.status === '' ? null : String(moved.status)) !== column.id) void moveToStatus(moved, column);
            }}
          >
            <h3 class='entity-board-title'>
              <i class='fas fa-circle fa-fw' style={`color: #${column.color}`} aria-hidden='true'></i>
              <span>{column.title}</span>
              <span class='entity-board-count'>{cards.length}</span>
            </h3>
            <div class='entity-board-cards'>
              {#each cards as entity (entity.id)}
                <article
                  class='entity-board-card'
                  style={`--left-color: #${getLeftColor(entity)};`}
                  data-entity-id={entity.id}
                  draggable={canEditEntity(entity)}
                  ondragstart={event => { draggedId = entity.id; event.dataTransfer?.setData('text/plain', String(entity.id)); }}
                  ondragend={() => { draggedId = null; dropColumn = null; }}
                >
                  <a class='entity-board-card-title' href={`?mode=view&id=${entity.id}`}>{entity.title || t('entity-default-title')}</a>
                  <div class='entity-board-card-meta'>
                    <span>{formatDate(entity.date)}</span>
                    {#if entity.fullname}<span class='entity-board-card-owner'>{entity.fullname}</span>{/if}
                    {#if stepsLabel(entity)}<span title={t('Steps')}><i class='fas fa-list-check fa-fw' aria-hidden='true'></i>{stepsLabel(entity)}</span>{/if}
                    <button
                      type='button'
                      class={`entity-row-pin ml-auto ${entity.is_pinned ? 'is-pinned' : ''}`}
                      title={t('toggle-pin')}
                      aria-label={t('toggle-pin')}
                      data-action='toggle-pin'
                      data-id={entity.id}
                    ><i class={`fas fa-thumbtack fa-fw ${!entity.is_pinned ? 'color-weak' : ''}`} aria-hidden='true'></i></button>
                  </div>
                </article>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
    {#if hasMore}
      <p class='entity-board-footer'>{t('Showing only the entries loaded so far. Switch to a list layout to load more.')}</p>
    {/if}
  {:else if layoutMode === 'cr' || layoutMode === 'pv'}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
    <div class={`entity-rows ${layoutMode === 'pv' ? 'entity-rows-with-preview' : ''}`} id='itemList' tabindex={layoutMode === 'pv' ? 0 : -1} role={layoutMode === 'pv' ? 'listbox' : undefined} aria-label={t('Entries')} onkeydown={onPreviewKeydown}>
      <div class='entity-rows-list'>
        {#if isLoading && entities.length === 0}
          {#each [0, 1, 2, 3, 4, 5] as row (row)}<div class='fx-skeleton'></div>{/each}
        {:else if entities.length === 0}
          <p class='fx-empty'>{t('No entries to show.')}</p>
        {/if}
        {#each groups as group (group.key)}
          <h3 class='entity-group-title'>{group.label} <span class='entity-group-count'>{group.items.length}</span>{#if group.key === 'pinned'}<button type='button' class='btn btn-link guide-info-btn p-0 ml-1' data-action='open-guide-card' data-card='guide-pins' title={t('About Pins in the guide')} aria-label={t('About Pins in the guide')}><i class='fas fa-circle-info' aria-hidden='true'></i></button>{/if}</h3>
          {#each group.items as entity, index (`${entity.id}-${index}`)}
            {@render compactRow(entity, index)}
          {/each}
        {/each}
        {#if hasMore}
          <div bind:this={sentinelEl} class='py-3 text-center color-medium'>
            {#if isLoadingMore}{t('Loading...')}{/if}
          </div>
        {/if}
      </div>
      {#if layoutMode === 'pv'}
        <aside class='entity-preview' aria-label={t('Preview')}>
          {#if previewEntity}
            <h3 class='entity-preview-title'>
              <a href={`?mode=view&id=${previewEntity.id}`}>{previewEntity.title || t('entity-default-title')}</a>
            </h3>
            <div class='entity-preview-meta color-medium'>
              {formatDate(previewEntity.date ?? previewEntity.created_at)}
              {#if previewEntity.fullname} · {previewEntity.fullname}{/if}
              {#if previewEntity.status_title} · {previewEntity.status_title}{/if}
              {#if previewEntity.category_title} · {previewEntity.category_title}{/if}
            </div>
            {#if (previewEntity.tags_decoded?.length ?? 0) > 0}
              <div class='entity-preview-tags'>
                {#each previewEntity.tags_decoded ?? [] as tag (tag.id)}<span class='tag'>{tag.tag}</span>{/each}
              </div>
            {/if}
            {@render fieldBlock(`pv-${previewEntity.id}-goal`, t('Goals'), 'fa-bullseye', previewEntity.experiment_goal, 6)}
            {@render fieldBlock(`pv-${previewEntity.id}-concl`, t('Conclusion'), 'fa-clipboard-check', previewEntity.experiment_conclusion, 6)}
            {@render fieldBlock(`pv-${previewEntity.id}-notes`, t('Notes'), 'fa-file-lines', previewEntity.experiment_notes, 6)}
            {#if !previewEntity.experiment_goal?.trim() && !previewEntity.experiment_conclusion?.trim() && !previewEntity.experiment_notes?.trim()}
              <p class='color-medium'>{t('Nothing to preview. Open the entry to read it.')}</p>
            {/if}
          {/if}
        </aside>
      {/if}
    </div>
  {:else}
  <div class='d-flex flex-column' id='itemList'>
    {#each entities as entity, index (`${entity.id}-${index}`)}
      {@const template = isTemplateType(entityType)}
      {@const bodyId = `entity-body-${entity.id}-${index}`}
      {@const statusDateLabel = isTemplateType(entityType) ? t('created-on') : t('started-on')}
      {@const dateValue = template ? entity.created_at : entity.date}
      {@const createLabel = getCreateLabel(entityType)}
      {@const createDataType = getCreateDataType(entityType)}

      <section
        class={`entity ${template ? 'entity-template' : ''} pl-3 py-3 d-flex`}
        id={`parent_${bodyId}`}
        data-entity-id={entity.id}
        style={`--left-color: #${getLeftColor(entity)};`}
        aria-label={`${t('Entry')}_${bodyId}`}
      >
        <div class='align-self-center entity-card-main'>
          <div class='entity-card-pills'>
            <input
              autocomplete='off'
              type='checkbox'
              data-action='checkbox-entity'
              data-id={entity.id}
              data-randomid={bodyId}
              data-type={entityType}
              aria-label={t('Select')}
              class='entity-card-check'
            />
            {#if entity.timestamped}
              <div
                class='infotip'
                role='img'
                aria-label={`${t('timestamped-by')} ${fullnames[entity.timestampedby] || ''}`}
                onmouseenter={() => getFullname(entity.timestampedby)}
              >
                <span class='infotip-icon'>
                  <i
                    style={`color:#${getLeftColor(entity)}`}
                    class='fas fa-calendar-check fa-fw'
                    aria-hidden='true'
                  ></i>
                </span>

                <p class='infotip-text'>
                  {#if fullnames[entity.last_signed_by]}
                    {t('timestamped-by')} {fullnames[entity.timestampedby]}
                  {:else}
                    {t('loading')}
                  {/if}
                </p>
              </div>
            {/if}

            {#if entity.signature_count > 0}
              <div
                class='infotip'
                role='img'
                aria-label={`${t('signed-by')} ${fullnames[entity.last_signed_by] || ''}`}
                onmouseenter={() => getFullname(entity.last_signed_by)}
              >
                <span class='infotip-icon'>
                  <i
                    style={`color:#${getLeftColor(entity)}`}
                    class='fas fa-signature fa-fw'
                    aria-hidden='true'
                  ></i>
                </span>

                <p class='infotip-text'>
                  {#if fullnames[entity.last_signed_by]}
                    {t('signed-by')} {fullnames[entity.last_signed_by]}
                  {:else}
                    {t('loading')}
                  {/if}
                </p>
              </div>
            {/if}

            {#if entity.state === EntityState.Archived}
              <i class='fas fa-box-archive fa-fw'></i>
            {/if}

            {#if entity.state === EntityState.Deleted}
              <i class='fas fa-ban fa-fw color-danger'></i>
            {/if}

            {#if entity.category}
              <button
                class='btn catstat-btn category-btn mr-1'
                type='button'
                style={`--bg: #${getLeftColor(entity)};line-height:normal;`}
                data-key='category'
                data-value={entity.category}
                onclick={event => handleFilterClick(event, 'category', entity.category, entity.category_title)}
              >
                {entity.category_title}
              </button>
            {/if}

            {#if entity.status}
              <button
                class='btn catstat-btn mr-1 status-btn bg-firstlevel'
                type='button'
                data-key='status'
                data-value={entity.status}
                style='line-height:normal;'
                onclick={event => handleFilterClick(event, 'status', entity.status, entity.status_title)}
              >
                <i
                  class='fas fa-circle fa-fw'
                  style={`--bg: #${entity.status_color || 'bdbdbd'}`}
                ></i>
                {entity.status_title}
              </button>
            {/if}

            {#if (entity.rating ?? 0) > 0}
              <span class='rating-show rounded p-1 font-weight-bold'>
                <i class='fas fa-star mr-1' title='☻'></i>{entity.rating}
              </span>
            {/if}
          </div>

          <div class='d-flex title flex-nowrap my-2'>
            {#if entity.custom_id}
              <span class='color-medium mr-1 text-nowrap' title={t('Custom ID')}>
                {entity.custom_id}
              </span>
            {/if}

            <a href={`?mode=view&id=${entity.id}`}>
              {entity.title || t('entity-default-title')}
            </a>
          </div>

          {#if entityType === 'experiments'}
            {@render fieldBlock(`c-${entity.id}-goal`, t('Goals'), 'fa-bullseye', entity.experiment_goal, 3)}
            {@render fieldBlock(`c-${entity.id}-concl`, t('Conclusion'), 'fa-clipboard-check', entity.experiment_conclusion, 3)}
            {@render fieldBlock(`c-${entity.id}-notes`, t('Notes'), 'fa-file-lines', entity.experiment_notes, 3)}
          {/if}

          <div class='owner'>
            {#if entity.userid != null && currentUserId !== entity.userid && !isAnon}
              {t('by')}
              <a
                class={'owner'}
                href={`?owner=${entity.userid}`}
                onclick={event => handleFilterClick(event, 'owner', entity.userid, entity.fullname)}
              >
                {entity.fullname}
              </a>
            {/if}

            {#if entity.team != null && currentTeam !== entity.team && !isAnon && entity.team_name}
              <span class='badge badge-pill badge-light'>{entity.team_name}</span>
            {/if}
          </div>

          {#if entity.next_step}
            <p class='item-next my-2'>
              <span class='next-step-text'>{t('Next step')}:</span>
              <span class='item-next-step'> {entity.next_step}</span>
            </p>
          {/if}


          <p class='my-2'>
            {#if (entity.tags_decoded?.length ?? 0) > 0}
              <span class='d-inline-flex flex-wrap'>
                <i class='fas fa-tags mr-1 fa-fw'></i>

                {#each entity.tags_decoded ?? [] as tag, tagIndex (`${entity.id}-${tag.id}-${tagIndex}`)}
                  <a
                    class={`tag mathjax-ignore margin-1px ${tag.is_favorite ? 'favorite' : ''}`}
                    href={`?mode=show&tags%5B%5D=${encodeURIComponent(tag.tag)}`}
                    onclick={event => handleTagClick(event, tag.tag)}
                  >
                    {tag.tag}
                  </a>
                {/each}
              </span>
            {/if}
          </p>

          <div class='d-flex flex-row'>
            {#if template}
              <a
                data-action='create-entity'
                data-type={createDataType}
                data-tplid={entity.id}
                href='#'
                class='btn btn-primary left-icon mr-1 lh-normal p-2 border-0 hl-hover-gray'
                title={createLabel}
                aria-label={createLabel}
              >
                <i class='fas fa-file-circle-plus fa-fw'></i>
              </a>
            {/if}

            {#if entity.locked}
              <div class='btn left-icon mr-1 lh-normal p-2 border-0 bgnd-gray disabled'>
                <i class='fas fa-lock fa-fw'></i>
              </div>
            {:else if entity.state === EntityState.Deleted}
              <div
                class='btn btn-secondary mr-1 lh-normal p-2 border-0'
                data-action='restore-entity-showmode'
                title={t('Restore entry')}
                data-endpoint={entityType}
                data-id={entity.id}
              >
                <i class='fas fa-trash-can-arrow-up fa-fw'></i>
              </div>
            {:else if canEditEntity(entity)}
              <a
                href={`?mode=edit&id=${entity.id}`}
                class='btn btn-secondary left-icon mr-1 lh-normal p-2 border-0'
                title={t('Edit')}
                aria-label={t('Edit')}
              >
                <i class='fas fa-pencil fa-fw'></i>
              </a>
            {:else}
              <a
                href={`?mode=view&id=${entity.id}`}
                class='btn btn-secondary left-icon mr-1 lh-normal p-2 border-0'
                title={t('View')}
                aria-label={t('View')}
              >
                <i class='fas fa-eye fa-fw'></i>
              </a>
            {/if}

            <button
              type='button'
              class='btn btn-neutral mr-2 lh-normal'
              data-type={entityType}
              data-id={entity.id}
              data-opened-icon='fa-caret-down'
              data-closed-icon='fa-caret-right'
              data-randid={bodyId}
              data-action='toggle-body'
              title={t('Toggle content')}
              aria-label={t('Toggle content')}
            >
              <i class='fas fa-caret-right color-medium'></i>
            </button>

          </div>

          <div class='entity-card-dates color-medium'>
            <span class='item-date'>{statusDateLabel} {formatDate(dateValue)}</span>
            <span aria-hidden='true'> · </span>
            <span class='item-date'>
              {t('Last modified')}
              <span title={entity.modified_at ?? ''} class='relative-moment'></span>
            </span>
          </div>

          <div hidden id={bodyId} style='overflow:auto;margin: 10px 0 0 20px'>
            <div></div>
          </div>
        </div>

        <div class='d-flex justify-content-end ml-auto text-nowrap'>
          <div>
            <button
              type='button'
              title={t('toggle-pin')}
              aria-label={t('toggle-pin')}
              data-action='toggle-pin'
              data-id={entity.id}
              class={`btn ${entity.is_pinned ? 'bgnd-gray' : 'hl-hover-gray'} p-2 mr-2 lh-normal border-0`}
            >
              <i class={`fas fa-thumbtack ${!entity.is_pinned ? 'color-weak' : ''} fa-fw`}></i>
            </button>
          </div>
        </div>
      </section>
    {/each}
  {#if hasMore}
      <div bind:this={sentinelEl} class='py-3 text-center color-medium'>
        {#if isLoadingMore}
          {t('Loading...')}
        {/if}
      </div>
    {/if}
  </div>
  {/if}
{/if}

<style>
  .experiment-summary-toggle {
    cursor: pointer;
  }

  .experiment-summary-text {
    white-space: pre-wrap;
  }

  .experiment-summary[open] .experiment-summary-preview {
    display: none;
  }
</style>
