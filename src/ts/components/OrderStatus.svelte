<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import i18next from '../i18n';
  import { Notification as AppNotification } from '../Notifications.class';

  type ProcurementOrder = { id: number; title: string; status: string; requester: string };
  type Procurement = {
    procurement_id: string;
    order_numbers: string;
    order_date: string | null;
    requesters: string | null;
    order_count: number;
    orders: ProcurementOrder[];
    items_collected: number;
    items_total: number | null;
    last_collected_at: string | null;
  };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();
  const PAGE_SIZES = [10, 25, 50, 100];

  let rows: Procurement[] = [];
  let total = 0;
  let loading = true;
  let query = '';
  let dateFrom = '';
  let dateTo = '';
  let pageSize = 25;
  let pageOffset = 0;
  let expanded = new Set<string>();
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  async function load(): Promise<void> {
    loading = true;
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(pageOffset) });
      if (query.trim() !== '') params.set('q', query.trim());
      if (dateFrom !== '') params.set('date_from', dateFrom);
      if (dateTo !== '') params.set('date_to', dateTo);
      const result = await ApiC.getJson(`order_status?${params.toString()}`) as { total: number; items: Procurement[] };
      rows = result.items;
      total = result.total;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load the order status.');
    } finally {
      loading = false;
    }
  }

  function onSearchInput(): void {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { pageOffset = 0; void load(); }, 300);
  }

  function onFilterChange(): void {
    pageOffset = 0;
    void load();
  }

  function clearFilters(): void {
    query = '';
    dateFrom = '';
    dateTo = '';
    onFilterChange();
  }

  function toggle(id: string): void {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    expanded = next;
  }

  function progressLabel(row: Procurement): string {
    return row.items_total === null ? '—' : `${row.items_collected}/${row.items_total}`;
  }

  // green when everything was collected, amber when part of it was, grey when nothing yet or unknown
  function progressClass(row: Procurement): string {
    if (row.items_total === null) return 'badge-secondary';
    if (row.items_collected >= row.items_total) return 'badge-success';
    return row.items_collected > 0 ? 'badge-warning' : 'badge-secondary';
  }

  function statusLabel(status: string): string {
    return ({
      requested: t('Requested'), ordered: t('Ordered'), collected: t('Collected'), received: t('In storage'),
      backlogged: t('Backlogged'), cancelled: t('Cancelled'), pinned_all: t('Pinned for all'),
    } as Record<string, string>)[status] ?? status;
  }

  $: firstShown = total === 0 ? 0 : pageOffset + 1;
  $: lastShown = Math.min(total, pageOffset + rows.length);

  onMount(() => { void load(); });
</script>

<div class="order-status">
  <div class="d-flex flex-wrap align-items-center mb-3" style="gap:0.5rem">
    <input
      type="search"
      class="form-control form-control-sm order-status-search"
      placeholder={t('Search procurement ID, order number, order or requester')}
      aria-label={t('Search')}
      bind:value={query}
      on:input={onSearchInput}
    />
    <label class="mb-0 small" for="orderStatusFrom">{t('From')}</label>
    <input id="orderStatusFrom" type="date" class="form-control form-control-sm" style="width:auto" bind:value={dateFrom} on:change={onFilterChange} title={t('Order date on or after')} />
    <label class="mb-0 small" for="orderStatusTo">{t('To')}</label>
    <input id="orderStatusTo" type="date" class="form-control form-control-sm" style="width:auto" bind:value={dateTo} on:change={onFilterChange} title={t('Order date on or before')} />
    {#if query !== '' || dateFrom !== '' || dateTo !== ''}
      <button type="button" class="btn btn-ghost btn-sm" on:click={clearFilters}>{t('Clear filters')}</button>
    {/if}
    <span class="ml-auto small text-muted">{firstShown}–{lastShown} {t('of')} {total}</span>
  </div>

  <div class="table-responsive">
    <table class="table table-sm table-hover order-status-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{t('Procurement ID')}</th>
          <th scope="col">{t('Order #')}</th>
          <th scope="col">{t('Order date')}</th>
          <th scope="col">{t('Requested by')}</th>
          <th scope="col">{t('Orders')}</th>
          <th scope="col">{t('Items collected')}</th>
        </tr>
      </thead>
      <tbody>
        {#if loading && rows.length === 0}
          <tr><td colspan="7" class="text-muted">{t('Loading')}…</td></tr>
        {:else if rows.length === 0}
          <tr><td colspan="7" class="text-muted">{t('No procurements found.')}</td></tr>
        {/if}
        {#each rows as row, index (row.procurement_id)}
          <tr class="order-status-row" on:click={() => toggle(row.procurement_id)}>
            <td>{pageOffset + index + 1}</td>
            <td><i class={`fas fa-chevron-${expanded.has(row.procurement_id) ? 'down' : 'right'} fa-fw mr-1 text-muted`} aria-hidden="true"></i><strong>{row.procurement_id}</strong></td>
            <td>{row.order_numbers || '—'}</td>
            <td>{row.order_date ?? '—'}</td>
            <td>{row.requesters ?? '—'}</td>
            <td>{row.order_count}</td>
            <td>
              <span class={`badge ${progressClass(row)}`} title={row.last_collected_at ? `${t('Last collected')}: ${row.last_collected_at}` : ''}>{progressLabel(row)}</span>
            </td>
          </tr>
          {#if expanded.has(row.procurement_id)}
            <tr class="order-status-detail">
              <td></td>
              <td colspan="6">
                <ul class="list-unstyled mb-0">
                  {#each row.orders as order (order.id)}
                    <li>
                      <a href={`orders.php?order=${order.id}`}>{order.title}</a>
                      <span class="badge badge-light ml-1">{statusLabel(order.status)}</span>
                      <span class="text-muted small ml-1">{order.requester}</span>
                    </li>
                  {/each}
                </ul>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>

  <div class="d-flex align-items-center flex-wrap" style="gap:0.5rem">
    <select class="form-control form-control-sm" style="width:auto" bind:value={pageSize} on:change={onFilterChange} title={t('Items per page')}>
      {#each PAGE_SIZES as size (size)}
        <option value={size}>{size} {t('/ page')}</option>
      {/each}
    </select>
    <div class="btn-group btn-group-sm" role="group" aria-label={t('Pagination')}>
      <button type="button" class="btn btn-sm btn-ghost" disabled={pageOffset === 0} on:click={() => { pageOffset = Math.max(0, pageOffset - pageSize); void load(); }}>
        <i class="fas fa-chevron-left fa-fw" aria-hidden="true"></i>{t('Previous')}
      </button>
      <button type="button" class="btn btn-sm btn-ghost" disabled={pageOffset + pageSize >= total} on:click={() => { pageOffset += pageSize; void load(); }}>
        {t('Next')}<i class="fas fa-chevron-right fa-fw" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</div>

<style>
  .order-status-search {
    max-width: 24rem;
    width: 100%;
  }

  .order-status-row {
    cursor: pointer;
  }
</style>
