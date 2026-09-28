<script lang='ts'>
  /**
   * @author eLabFTW contributors
   * @license AGPL-3.0
   * @package elabftw
   */
  import { ApiC } from '../api';
  import i18next from '../i18n';

  type Status = 'requested' | 'ordered' | 'received' | 'backlogged' | 'cancelled';
  type Rule = { status: Status; days: number };

  // Order matches statusLabel() in OrdersBoard.svelte -- 'reference' is
  // deliberately excluded, those are pinned catalog entries with no real
  // lifecycle to measure "time in status" from.
  const ALL_STATUSES: Status[] = ['requested', 'ordered', 'received', 'backlogged', 'cancelled'];

  let { endpoint, rules: initialRules }: { endpoint: string; rules: string } = $props();

  let rules = $state<Rule[]>(parseInitialRules(initialRules));
  let newStatus = $state<Status>('ordered');
  let newDays = $state(30);
  let saving = $state(false);

  const t = i18next.t.bind(i18next);

  function parseInitialRules(raw: string): Rule[] {
    try {
      const parsed = JSON.parse(raw || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((r): r is Rule => typeof r?.status === 'string' && typeof r?.days === 'number');
    } catch {
      return [];
    }
  }

  function statusLabel(status: Status): string {
    return {
      requested: t('Requested'),
      ordered: t('Ordered'),
      received: t('Received'),
      backlogged: t('Backlogged'),
      cancelled: t('Cancelled'),
    }[status];
  }

  function availableStatuses(): Status[] {
    const used = new Set(rules.map(r => r.status));
    return ALL_STATUSES.filter(s => !used.has(s));
  }

  async function save(next: Rule[]): Promise<void> {
    saving = true;
    try {
      await ApiC.patch(endpoint, { orders_autoarchive_rules: JSON.stringify(next) });
      rules = next;
    } finally {
      saving = false;
    }
  }

  async function addRule(): Promise<void> {
    if (newDays <= 0 || rules.some(r => r.status === newStatus)) return;
    await save([...rules, { status: newStatus, days: newDays }]);
    const remaining = availableStatuses();
    if (remaining.length > 0) newStatus = remaining[0];
    newDays = 30;
  }

  async function updateDays(status: Status, days: number): Promise<void> {
    if (days <= 0) return;
    await save(rules.map(r => (r.status === status ? { ...r, days } : r)));
  }

  async function removeRule(status: Status): Promise<void> {
    await save(rules.filter(r => r.status !== status));
  }
</script>

{#if rules.length > 0}
  <table class='table mt-2' aria-describedby='ordersSettings'>
    <thead>
      <tr>
        <th scope='col'>{t('Status')}</th>
        <th scope='col'>{t('Days')}</th>
        <th scope='col'><span class='sr-only'>{t('Action')}</span></th>
      </tr>
    </thead>
    <tbody>
      {#each rules as rule (rule.status)}
        <tr>
          <td data-label={t('Status')}>{statusLabel(rule.status)}</td>
          <td data-label={t('Days')}>
            <input
              type='number'
              min='1'
              class='form-control col-md-4'
              value={rule.days}
              disabled={saving}
              on:change={(event) => updateDays(rule.status, Number((event.target as HTMLInputElement).value))}
              aria-label={`${t('Days')} (${statusLabel(rule.status)})`}
            />
          </td>
          <td>
            <span class='sr-only'>{t('Action')}</span>
            <button
              type='button'
              class='btn btn-danger-ghost'
              title={t('Delete')}
              aria-label={t('Delete')}
              disabled={saving}
              on:click={() => removeRule(rule.status)}
            >
              <i class='fas fa-trash-alt fa-fw' aria-hidden='true'></i>
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

{#if availableStatuses().length > 0}
  <form class='d-flex align-items-center mt-2' on:submit|preventDefault={addRule}>
    <label class='sr-only' for='ordersAutoArchiveNewStatus'>{t('Status')}</label>
    <select class='form-control col-md-4 mr-2' id='ordersAutoArchiveNewStatus' bind:value={newStatus}>
      {#each availableStatuses() as status (status)}
        <option value={status}>{statusLabel(status)}</option>
      {/each}
    </select>
    <label class='sr-only' for='ordersAutoArchiveNewDays'>{t('Days')}</label>
    <input
      type='number'
      min='1'
      class='form-control col-md-3 mr-2'
      id='ordersAutoArchiveNewDays'
      bind:value={newDays}
      placeholder={t('Days')}
    />
    <button type='submit' class='btn btn-primary' disabled={saving || newDays <= 0}>
      <i class='fas fa-plus fa-fw mr-1' aria-hidden='true'></i>{t('Add rule')}
    </button>
  </form>
{/if}
