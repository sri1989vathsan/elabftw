<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';

  // The private calendar link of the account (what Google, Apple or Outlook subscribe to): create or regenerate it, copy it, revoke it.
  // It was part of the to-do panel; it is part of the settings of the calendar page now.
  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();

  type CalendarFeedStatus = {
    enabled: boolean;
    created_at: string | null;
    updated_at: string | null;
  };

  let calendarFeedEnabled = false;
  let calendarFeedLoading = true;
  let calendarFeedUrl = '';

  async function loadCalendarFeedStatus(): Promise<void> {
    calendarFeedLoading = true;
    const status = await ApiC.getJson(Model.CalendarFeed) as CalendarFeedStatus;
    calendarFeedEnabled = status.enabled;
    calendarFeedLoading = false;
  }

  async function createCalendarFeed(): Promise<void> {
    calendarFeedLoading = true;
    try {
      const response = await ApiC.post(Model.CalendarFeed);
      calendarFeedUrl = (response.headers.get('Location') ?? '')
        .replace(/&feed=\d+$/, '');
      calendarFeedEnabled = true;
      if (!calendarFeedUrl) {
        notify.error('The calendar subscription URL could not be read.');
      }
    } finally {
      calendarFeedLoading = false;
    }
  }

  async function revokeCalendarFeed(): Promise<void> {
    if (!window.confirm(t('Revoke this private calendar link? Existing subscriptions will stop updating.'))) {
      return;
    }
    calendarFeedLoading = true;
    try {
      await ApiC.delete(Model.CalendarFeed);
      calendarFeedEnabled = false;
      calendarFeedUrl = '';
    } finally {
      calendarFeedLoading = false;
    }
  }

  async function copyCalendarFeed(): Promise<void> {
    await navigator.clipboard.writeText(calendarFeedUrl);
    notify.success(t('Calendar subscription link copied.'));
  }

  function googleCalendarUrl(): string {
    return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(calendarFeedUrl)}`;
  }

  function appleCalendarUrl(): string {
    return calendarFeedUrl.replace(/^https?:\/\//, 'webcal://');
  }

  function isLocalCalendarFeed(): boolean {
    return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  }

  function canCloudCalendarFetch(): boolean {
    return window.location.protocol === 'https:' && !isLocalCalendarFeed();
  }

  // combines what used to be four separate paragraphs (always-shown intro +
  // up to one of two mutually-exclusive environment warnings + two always-
  // shown tips) into one string for a single info-icon tooltip, since none
  // of it needs to be permanently visible to use the feature
  function calendarFeedHelpText(): string {
    const parts = [
      t('Subscribe to this account’s personal to-dos and owned experiment or resource step deadlines in Google Calendar or Apple Calendar.'),
    ];
    if (isLocalCalendarFeed()) {
      parts.push(t('Google Calendar will show nothing from this localhost demo because Google’s servers cannot reach it. Use Preview .ics to verify the feed; cloud subscription works after eLabFTW is available at a public HTTPS address with a trusted certificate.'));
    } else if (window.location.protocol !== 'https:') {
      parts.push(t('Cloud calendars require this feed to be served from a public trusted HTTPS address.'));
    }
    parts.push(t('If Google does not add the feed automatically, copy the private link and use Other calendars → From URL in Google Calendar on a desktop browser.'));
    parts.push(t('Apple subscriptions appear in Apple Calendar. Apple Reminders requires a separate native app or Shortcut integration.'));
    return parts.join('\n\n');
  }

  onMount(() => {
    void loadCalendarFeedStatus();
  });
</script>

<section class='calendar-feed mt-3' aria-labelledby='calendarFeedHeading'>
  <div class='calendar-feed-header'>
    <div class='calendar-feed-title'>
      <span class='calendar-feed-icon' aria-hidden='true'>
        <i class='fas fa-calendar-days'></i>
      </span>
      <div>
        <span class='calendar-feed-eyebrow'>{t('Calendar subscription')}</span>
        <h4 id='calendarFeedHeading' class='h5 mb-0'>
          {t('External calendar')}
          <button
            type='button'
            class='btn-unstyled calendar-feed-info'
            title={calendarFeedHelpText()}
            aria-label={calendarFeedHelpText()}
          >
            <i class='fas fa-circle-info fa-fw' aria-hidden='true'></i>
          </button>
        </h4>
      </div>
    </div>
    {#if calendarFeedEnabled}
      <span class='badge badge-success'>{t('Account feed active')}</span>
    {/if}
  </div>
  {#if calendarFeedUrl}
    <label class='sr-only' for='calendarFeedUrl'>{t('Private calendar subscription URL')}</label>
    <input id='calendarFeedUrl' class='form-control form-control-sm mb-2' readonly value={calendarFeedUrl} />
    <div class='d-flex flex-wrap calendar-feed-actions'>
      <button type='button' class='btn btn-sm btn-outline-primary' on:click={copyCalendarFeed}>
        <i class='fas fa-copy fa-fw mr-1' aria-hidden='true'></i>{t('Copy link')}
      </button>
      <a class='btn btn-sm btn-outline-primary' href={calendarFeedUrl} target='_blank' rel='noopener noreferrer'>
        <i class='fas fa-file-arrow-down fa-fw mr-1' aria-hidden='true'></i>{t('Preview .ics')}
      </a>
      {#if canCloudCalendarFetch()}
        <a class='btn btn-sm btn-outline-primary' href={googleCalendarUrl()} target='_blank' rel='noopener noreferrer'>
          <i class='fas fa-calendar-days fa-fw mr-1' aria-hidden='true'></i>{t('Google Calendar')}
        </a>
      {:else}
        <button
          type='button'
          class='btn btn-sm btn-outline-primary'
          disabled
          title={t('Google Calendar cannot fetch a feed from localhost. Deploy eLabFTW at a public trusted HTTPS address first.')}
        >
          <i class='fas fa-calendar-days fa-fw mr-1' aria-hidden='true'></i>{t('Google Calendar')}
        </button>
      {/if}
      <a class='btn btn-sm btn-outline-primary' href={appleCalendarUrl()}>
        <i class='fab fa-apple fa-fw mr-1' aria-hidden='true'></i>{t('Apple Calendar')}
      </a>
    </div>
    <p class='small text-warning mt-2 mb-0'>
      <i class='fas fa-key fa-fw mr-1' aria-hidden='true'></i>
      {t('Keep this link private. Anyone with it can read your task titles and deadlines.')}
    </p>
  {:else if calendarFeedEnabled}
    <p class='small mb-2'>
      {t('Your private account feed is active. Regenerate it to reveal and copy a new link; the old link will stop working.')}
    </p>
  {/if}
  <div class='d-flex calendar-feed-actions'>
    <button
      type='button'
      class='btn btn-sm btn-primary'
      disabled={calendarFeedLoading}
      on:click={createCalendarFeed}
    >
      <i class='fas fa-rotate fa-fw mr-1' aria-hidden='true'></i>
      {calendarFeedEnabled ? t('Regenerate private link') : t('Create private link')}
    </button>
    {#if calendarFeedEnabled}
      <button
        type='button'
        class='btn btn-sm btn-outline-danger'
        disabled={calendarFeedLoading}
        on:click={revokeCalendarFeed}
      >
        {t('Revoke')}
      </button>
    {/if}
  </div>
</section>

<style>
  .calendar-feed {
    background: transparent;
    border: 1px solid var(--cal-line, rgba(128, 128, 128, 0.4));
    border-radius: 0.25rem;
    color: inherit;
    padding: 0.8rem;
  }

  .calendar-feed .fas {
    color: inherit;
  }

  .calendar-feed-actions {
    gap: 0.35rem;
  }

  .calendar-feed-header,
  .calendar-feed-title {
    align-items: center;
    display: flex;
  }

  .calendar-feed-header {
    gap: 0.5rem;
    justify-content: space-between;
    margin-bottom: 0.55rem;
  }

  .calendar-feed-title {
    gap: 0.55rem;
    min-width: 0;
  }

  .calendar-feed-icon {
    align-items: center;
    background: var(--primary);
    border-radius: 0.65rem;
    box-shadow: 0 0.25rem 0.55rem color-mix(in srgb, var(--primary) 28%, transparent);
    color: #fff;
    display: inline-flex;
    flex: 0 0 auto;
    height: 2.25rem;
    justify-content: center;
    width: 2.25rem;
  }

  .calendar-feed-icon .fas {
    color: #fff;
  }

  .calendar-feed-eyebrow {
    color: currentColor;
    display: block;
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .calendar-feed-info {
    color: inherit;
    cursor: help;
    margin-left: 0.35rem;
    opacity: 0.75;
  }

  .calendar-feed-info:hover {
    opacity: 1;
  }

  .calendar-feed .text-muted {
    color: currentColor !important;
  }

  .calendar-feed .text-warning {
    color: var(--warning, #b45309) !important;
  }

  .calendar-feed .btn-outline-primary {
    border-color: currentColor;
    color: inherit;
  }

  .calendar-feed .btn-outline-danger {
    border-color: var(--danger, #c0392b);
    color: var(--danger, #c0392b);
  }
</style>
