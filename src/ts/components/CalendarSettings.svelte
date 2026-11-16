<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import i18next from '../i18n';
  import { addFeed, feeds, loadCalendarSettings, removeFeed, setViewPrefs, viewPrefs } from '../calendarSettings';
  import CalendarFeed from './CalendarFeed.svelte';

  // The calendar settings window: how the calendar page looks (working hours, weekends), Google (drawn by googleSync.ts into the host
  // below), calendars from a web address, and the private link for other calendar apps. It opens on any page: the gear of the to-do
  // panel and the Settings button of the calendar page ask for it with the 'elabftw:calendar-settings-open' window event.
  export let startOpen = false;

  const t = i18next.t.bind(i18next);
  loadCalendarSettings();

  let open = startOpen;
  // Google is offered by the administrator: the to-do panel has the row of the sync then
  $: googleSetUp = open && document.getElementById('googleSyncRow') !== null;
  $: if (open && googleSetUp) {
    void tick().then(() => window.dispatchEvent(new CustomEvent('elabftw:google-settings-open')));
  }

  let addDialog = false;
  let feedUrl = '';
  let feedName = '';
  let feedBusy = false;
  let feedFormError = '';
  let feedUrlInput: HTMLInputElement | undefined;

  function close(): void {
    open = false;
    addDialog = false;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (addDialog) {
      addDialog = false;
    } else if (open) {
      close();
    }
  }

  async function openAddDialog(): Promise<void> {
    feedFormError = '';
    addDialog = true;
    await tick();
    feedUrlInput?.focus();
  }

  async function submitFeed(): Promise<void> {
    feedFormError = '';
    feedBusy = true;
    try {
      await addFeed(feedUrl, feedName);
      feedUrl = '';
      feedName = '';
      addDialog = false;
    } catch (error) {
      feedFormError = error instanceof Error ? error.message : String(error);
    } finally {
      feedBusy = false;
    }
  }

  onMount(() => {
    window.addEventListener('elabftw:calendar-settings-open', () => { open = true; });
    window.addEventListener('keydown', onKey);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', onKey);
  });
</script>

{#if open}
  <div class='cs-backdrop' role='presentation' on:mousedown|self={close}>
    <div class='cs-modal cs-settings' role='dialog' aria-modal='true' aria-label={t('Calendar settings')}>
      <div class='cs-head'>
        <h3 class='h5 mb-0'>{t('Calendar settings')}</h3>
        <button type='button' class='btn btn-ghost btn-sm' aria-label={t('Close')} on:click={close}><i class='fas fa-xmark' aria-hidden='true'></i></button>
      </div>
      <section class='cs-section'>
        <div class='cs-title'>{t('View')}</div>
        <div class='cs-view'>
          <label class='small mb-0' for='cal-work-start'>{t('Working hours')}</label>
          <select id='cal-work-start' class='form-control form-control-sm' on:change={event => setViewPrefs({ ...$viewPrefs, start: Number(event.currentTarget.value) })}>
            {#each Array.from({ length: 24 }, (_, hour) => hour) as hour (hour)}
              <option value={hour} selected={$viewPrefs.start === hour}>{String(hour).padStart(2, '0')}:00</option>
            {/each}
          </select>
          <span class='small'>{t('to')}</span>
          <select id='cal-work-end' class='form-control form-control-sm' aria-label={t('Working hours end')} on:change={event => setViewPrefs({ ...$viewPrefs, end: Number(event.currentTarget.value) })}>
            {#each Array.from({ length: 24 - $viewPrefs.start }, (_, index) => $viewPrefs.start + 1 + index) as hour (hour)}
              <option value={hour} selected={$viewPrefs.end === hour}>{String(hour).padStart(2, '0')}:00</option>
            {/each}
          </select>
        </div>
        <label class='small d-block mt-2 mb-0'>
          <input type='checkbox' checked={$viewPrefs.weekends} on:change={event => setViewPrefs({ ...$viewPrefs, weekends: event.currentTarget.checked })} />
          {t('Include weekend days')}
        </label>
        <span class='cs-muted small'>{t('Events outside the working hours still show: the day gets longer for them.')}</span>
      </section>
      <section class='cs-section'>
        <div class='cs-title'>{t('Google')}</div>
        {#if googleSetUp}
          <div id='googleSettings'></div>
        {:else}
          <span class='cs-muted small'>{t('Google is not set up here: ask the administrator to turn on the Google sync.')}</span>
        {/if}
      </section>
      <section class='cs-section'>
        <div class='cs-title'>{t('Calendars from a web address')}</div>
        {#each $feeds as feed (feed.id)}
          <div class='cs-feed'>
            <span class='small'><span class='cs-dot' style='--c:{feed.color}'></span> {feed.name}</span>
            <button type='button' class='btn btn-ghost btn-sm' aria-label={t('Remove this calendar')} title={t('Remove this calendar')} on:click={() => removeFeed(feed.id)}><i class='fas fa-xmark' aria-hidden='true'></i></button>
          </div>
        {/each}
        <button type='button' class='btn btn-secondary btn-sm' on:click={openAddDialog}><i class='fas fa-link fa-fw mr-1' aria-hidden='true'></i>{t('Add from URL…')}</button>
      </section>
      <section class='cs-section'>
        <CalendarFeed />
      </section>
      <div class='cs-buttons'>
        <button type='button' class='btn btn-primary' on:click={close}>{t('Done')}</button>
      </div>
    </div>
  </div>
{/if}

{#if addDialog}
  <div class='cs-backdrop cs-above' role='presentation' on:mousedown|self={() => { addDialog = false; }}>
    <form class='cs-modal' role='dialog' aria-modal='true' aria-labelledby='cs-add-title' on:submit|preventDefault={submitFeed}>
      <h3 id='cs-add-title' class='h5'>{t('Add a calendar from a web address')}</h3>
      <label class='cs-field'>
        <span class='small'>{t('Web address (URL)')}</span>
        <input class='form-control' type='text' bind:this={feedUrlInput} bind:value={feedUrl} placeholder='https://…/calendar.ics' autocomplete='off' />
      </label>
      <label class='cs-field'>
        <span class='small'>{t('Name (optional)')}</span>
        <input class='form-control' type='text' bind:value={feedName} placeholder={t('The name the calendar gives itself')} autocomplete='off' />
      </label>
      <span class='cs-muted small'>{t('The address of a calendar from Google ("Secret address in iCal format"), Outlook, a university or any other service. It is kept in this browser only.')}</span>
      {#if feedFormError}
        <div class='cs-error small' role='alert'>{feedFormError}</div>
      {/if}
      <div class='cs-buttons'>
        <button type='button' class='btn btn-ghost' on:click={() => { addDialog = false; }}>{t('Cancel')}</button>
        <button type='submit' class='btn btn-primary' disabled={feedBusy || feedUrl.trim() === ''}>{feedBusy ? t('Reading…') : t('Add calendar')}</button>
      </div>
    </form>
  </div>
{/if}

<style>
  .cs-backdrop {
    align-items: center;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: 1rem;
    position: fixed;
    z-index: 1050;
  }

  .cs-above {
    z-index: 1060;
  }

  .cs-modal {
    background: var(--mainbackground, #fff);
    border-radius: 0.5rem;
    box-shadow: 0 0.5rem 2rem rgba(0, 0, 0, 0.4);
    color: var(--text-color, inherit);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-width: 30rem;
    padding: 1rem 1.1rem;
    width: 100%;
  }

  .cs-settings {
    display: block;
    max-height: 88vh;
    max-width: 32rem;
    overflow-y: auto;
  }

  .cs-head {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.3rem;
  }

  .cs-section {
    border-top: 1px solid var(--cal-line, rgba(128, 128, 128, 0.4));
    margin-top: 0.5rem;
    padding-top: 0.5rem;
  }

  .cs-title {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .cs-view {
    align-items: center;
    display: flex;
    gap: 0.4rem;
  }

  .cs-view select {
    width: auto;
  }

  .cs-feed {
    align-items: center;
    display: flex;
    justify-content: space-between;
  }

  .cs-dot {
    background: var(--c);
    border-radius: 50%;
    display: inline-block;
    height: 0.6rem;
    width: 0.6rem;
  }

  .cs-muted {
    opacity: 0.75;
  }

  .cs-error {
    color: var(--danger, #c0392b);
  }

  .cs-field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
  }

  .cs-buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.6rem;
  }
</style>
