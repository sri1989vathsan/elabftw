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
    // weekly only: 1 = Monday ... 7 = Sunday
    days?: number[];
    until: string | null;
    count: number | null;
  };

  export let rule: RepeatRule | null = null;
  export let disabled = false;

  const t = i18next.t.bind(i18next);

  const weekdayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function choiceFor(value: RepeatRule | null): string {
    if (value === null) return 'none';
    const days = value.days ?? [];
    if (value.unit === 'week' && value.every === 1 && days.join(',') === '1,2,3,4,5') return 'weekdays';
    if (days.length > 0) return 'custom';
    return value.every === 1 ? value.unit : 'custom';
  }

  let choice = choiceFor(rule);
  let every = rule?.every ?? 1;
  let unit: RepeatRule['unit'] = rule?.unit ?? 'week';
  let days: number[] = rule?.days ?? [];
  let endKind = rule?.until ? 'date' : rule?.count ? 'count' : 'never';
  let until = rule?.until ?? '';
  // "count" in the rule is how many more occurrences follow this one, so "after 5 times" is 4 more
  let times = rule?.count ? rule.count + 1 : 5;

  function toggleDay(day: number): void {
    days = days.includes(day) ? days.filter(d => d !== day) : [...days, day].sort((x, y) => x - y);
    emit();
  }

  function emit(): void {
    if (choice === 'none') {
      rule = null;
      return;
    }
    // the person's own time zone, so "every Monday at 9:00" stays that way when the clocks change
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const ends = {
      until: endKind === 'date' && until ? until : null,
      count: endKind === 'count' ? Math.max(0, Math.round(Number(times) || 1) - 1) : null,
    };
    if (choice === 'weekdays') {
      rule = { unit: 'week', every: 1, days: [1, 2, 3, 4, 5], ...ends, tz } as RepeatRule & { tz: string };
      return;
    }
    const ruleUnit = choice === 'custom' ? unit : choice as RepeatRule['unit'];
    const ruleEvery = choice === 'custom' ? Math.min(365, Math.max(1, Math.round(Number(every) || 1))) : 1;
    rule = {
      unit: ruleUnit,
      every: ruleEvery,
      ...(choice === 'custom' && ruleUnit === 'week' && days.length > 0 ? { days } : {}),
      ...ends,
      tz,
    } as RepeatRule & { tz: string };
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
      <option value='weekdays'>{t('Every weekday (Monday to Friday)')}</option>
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
    {#if unit === 'week'}
      <div style='display:flex; gap:0.25rem; align-items:center; flex-wrap:wrap'>
        <span class='small'>{t('On')}</span>
        {#each weekdayLetters as letter, index (index)}
          <button
            type='button'
            class='btn btn-sm {days.includes(index + 1) ? "btn-primary" : "btn-outline-secondary"}'
            style='width:2rem; padding:0.15rem 0'
            title={t(weekdayNames[index])}
            aria-label={t(weekdayNames[index])}
            aria-pressed={days.includes(index + 1)}
            {disabled}
            on:click={() => toggleDay(index + 1)}
          >{letter}</button>
        {/each}
      </div>
    {/if}
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
