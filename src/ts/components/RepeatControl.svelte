<script lang='ts'>
  /**
   * Repeat options for a to-do, like the Repeat setting of Google Tasks: does not repeat, daily, weekly,
   * monthly, yearly or a custom "every N days/weeks/months/years", ending never, on a date, or after N times.
   * The parent keeps the rule (or null) in `rule`; a repeating task needs a deadline.
   */
  import i18next from '../i18n';

  export type RepeatRule = {
    unit: 'day' | 'week' | 'month' | 'year';
    every: number;
    until: string | null;
    count: number | null;
  };

  export let rule: RepeatRule | null = null;
  export let disabled = false;

  const t = i18next.t.bind(i18next);

  function choiceFor(value: RepeatRule | null): string {
    if (value === null) return 'none';
    return value.every === 1 ? value.unit : 'custom';
  }

  let choice = choiceFor(rule);
  let every = rule?.every ?? 1;
  let unit: RepeatRule['unit'] = rule?.unit ?? 'week';
  let endKind = rule?.until ? 'date' : rule?.count ? 'count' : 'never';
  let until = rule?.until ?? '';
  // "count" in the rule is how many more occurrences follow this one, so "after 5 times" is 4 more
  let times = rule?.count ? rule.count + 1 : 5;

  function emit(): void {
    if (choice === 'none') {
      rule = null;
      return;
    }
    const ruleUnit = choice === 'custom' ? unit : choice as RepeatRule['unit'];
    const ruleEvery = choice === 'custom' ? Math.min(365, Math.max(1, Math.round(Number(every) || 1))) : 1;
    rule = {
      unit: ruleUnit,
      every: ruleEvery,
      until: endKind === 'date' && until ? until : null,
      count: endKind === 'count' ? Math.max(0, Math.round(Number(times) || 1) - 1) : null,
    };
  }
</script>

<div style='display:flex; flex-direction:column; gap:0.35rem'>
  <label class='mb-0'>
    <span class='small'>{t('Repeat')}</span>
    <select
      class='form-control form-control-sm'
      bind:value={choice}
      on:change={emit}
      {disabled}
      title={disabled ? t('Choose a task date and time first') : undefined}
    >
      <option value='none'>{t('Does not repeat')}</option>
      <option value='day'>{t('Daily')}</option>
      <option value='week'>{t('Weekly')}</option>
      <option value='month'>{t('Monthly')}</option>
      <option value='year'>{t('Yearly')}</option>
      <option value='custom'>{t('Custom')}</option>
    </select>
  </label>
  {#if choice === 'custom'}
    <div style='display:flex; gap:0.5rem; align-items:flex-end; flex-wrap:wrap'>
      <label class='mb-0'>
        <span class='small'>{t('Every')}</span>
        <input class='form-control form-control-sm' style='width:5rem' type='number' min='1' max='365' bind:value={every} on:change={emit} {disabled} />
      </label>
      <label class='mb-0'>
        <span class='small'>&nbsp;</span>
        <select class='form-control form-control-sm' bind:value={unit} on:change={emit} {disabled}>
          <option value='day'>{t('days')}</option>
          <option value='week'>{t('weeks')}</option>
          <option value='month'>{t('months')}</option>
          <option value='year'>{t('years')}</option>
        </select>
      </label>
    </div>
  {/if}
  {#if choice !== 'none'}
    <div style='display:flex; gap:0.5rem; align-items:flex-end; flex-wrap:wrap'>
      <label class='mb-0'>
        <span class='small'>{t('Ends')}</span>
        <select class='form-control form-control-sm' bind:value={endKind} on:change={emit} {disabled}>
          <option value='never'>{t('Never')}</option>
          <option value='date'>{t('On a date')}</option>
          <option value='count'>{t('After a number of times')}</option>
        </select>
      </label>
      {#if endKind === 'date'}
        <label class='mb-0'>
          <span class='small'>{t('Last date')}</span>
          <input class='form-control form-control-sm' type='date' bind:value={until} on:change={emit} {disabled} />
        </label>
      {:else if endKind === 'count'}
        <label class='mb-0'>
          <span class='small'>{t('Times')}</span>
          <input class='form-control form-control-sm' style='width:5rem' type='number' min='1' max='1000' bind:value={times} on:change={emit} {disabled} />
        </label>
      {/if}
    </div>
  {/if}
</div>
