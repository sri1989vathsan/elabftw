<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ApiC } from '../api';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';

  type Todo = {
    id: number;
    body: string;
    notes: string | null;
    deadline: string | null;
    reminder_minutes: number | null;
    creation_time: string;
  };

  type StepDeadline = {
    entity_type: 'experiments' | 'items';
    entity_page: string;
    entity_id: number;
    entity_title: string;
    step_id: number;
    step_body: string;
    deadline: string;
    deadline_notif: number;
  };

  type CalendarEntry = {
    key: string;
    source: 'todo' | 'step';
    id: number;
    body: string;
    notes: string | null;
    deadline: string;
    reminderMinutes: number | null;
    entityId?: number;
    entityPage?: string;
    entityTitle?: string;
    entityType?: 'experiments' | 'items';
  };

  type CalendarCell = {
    date: Date;
    key: string;
    day: number;
    inMonth: boolean;
    isToday: boolean;
    count: number;
    overdue: boolean;
  };

  type CalendarFeedStatus = {
    enabled: boolean;
    created_at: string | null;
    updated_at: string | null;
  };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();
  const reminderPresets = new Set([0, 15, 60, 1440, 10080]);
  const highlightedTaskId = parseInt(
    new URLSearchParams(window.location.search).get('task') ?? '',
    10,
  );
  let locale = 'en-gb';
  let tasks: Todo[] = [];
  let stepDeadlines: StepDeadline[] = [];
  let entries: CalendarEntry[] = [];
  let calendarCells: CalendarCell[] = [];
  let agendaEntries: CalendarEntry[] = [];
  let monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDate = '';
  let draft = '';
  let notes = '';
  let deadlineLocal = defaultDeadline();
  let reminderChoice = '60';
  let customReminder = 120;
  let editingId: number | null = null;
  let editNotes = '';
  let editDeadlineLocal = '';
  let editReminderChoice = '60';
  let editCustomReminder = 120;
  let loading = true;
  let reminderTimer: number | undefined;
  let calendarFeedEnabled = false;
  let calendarFeedLoading = true;
  let calendarFeedUrl = '';

  $: entries = [
    ...tasks
      .filter(task => Boolean(task.deadline))
      .map(task => ({
        key: `todo-${task.id}`,
        source: 'todo' as const,
        id: Number(task.id),
        body: task.body,
        notes: task.notes,
        deadline: task.deadline as string,
        reminderMinutes: task.reminder_minutes === null
          ? null
          : Number(task.reminder_minutes),
      })),
    ...stepDeadlines.map(step => ({
      key: `step-${step.entity_type}-${step.step_id}`,
      source: 'step' as const,
      id: Number(step.step_id),
      body: step.step_body,
      notes: null,
      deadline: step.deadline,
      reminderMinutes: Number(step.deadline_notif) === 1 ? 30 : null,
      entityId: Number(step.entity_id),
      entityPage: step.entity_page,
      entityTitle: step.entity_title,
      entityType: step.entity_type,
    })),
  ].sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  $: calendarCells = buildCalendarCells(monthCursor, entries);
  $: agendaEntries = entries.filter(entry => (
    selectedDate ? dateKey(new Date(entry.deadline)) === selectedDate : true
  ));
  $: updateUrgentBadges(entries);

  function defaultDeadline(): string {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    date.setMinutes(0, 0, 0);
    return toLocalInput(date);
  }

  function toLocalInput(date: Date): string {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
  }

  function dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function buildCalendarCells(month: Date, calendarEntries: CalendarEntry[]): CalendarCell[] {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayOffset);
    const today = dateKey(new Date());
    const now = Date.now();
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = dateKey(date);
      const dayEntries = calendarEntries.filter(entry => (
        dateKey(new Date(entry.deadline)) === key
      ));
      return {
        date,
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === month.getMonth(),
        isToday: key === today,
        count: dayEntries.length,
        overdue: dayEntries.some(entry => new Date(entry.deadline).getTime() < now),
      };
    });
  }

  function monthLabel(): string {
    return new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
    }).format(monthCursor);
  }

  function weekdayLabels(): string[] {
    const monday = new Date(2026, 0, 5);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(date);
    });
  }

  function formatDeadline(value: string): string {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  function agendaLabel(): string {
    if (!selectedDate) return t('All deadlines');
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'full',
    }).format(new Date(`${selectedDate}T12:00:00`));
  }

  function selectDay(cell: CalendarCell): void {
    selectedDate = selectedDate === cell.key ? '' : cell.key;
    if (!cell.inMonth) {
      monthCursor = new Date(cell.date.getFullYear(), cell.date.getMonth(), 1);
    }
  }

  function changeMonth(offset: number): void {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + offset, 1);
    selectedDate = '';
  }

  function selectToday(): void {
    const today = new Date();
    monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedDate = dateKey(today);
  }

  function getReminderMinutes(choice: string, custom: number): number | null {
    if (choice === 'none') return null;
    if (choice === 'custom') {
      return Math.max(0, Math.min(10080, Math.round(custom)));
    }
    return parseInt(choice, 10);
  }

  function setReminderControls(
    minutes: number | null,
    edit = false,
  ): void {
    const choice = minutes === null
      ? 'none'
      : (reminderPresets.has(minutes) ? String(minutes) : 'custom');
    if (edit) {
      editReminderChoice = choice;
      editCustomReminder = minutes ?? 120;
    } else {
      reminderChoice = choice;
      customReminder = minutes ?? 120;
    }
  }

  async function create(): Promise<void> {
    const content = draft.trim();
    const deadline = new Date(deadlineLocal);
    if (!content || Number.isNaN(deadline.getTime())) {
      notify.error('Enter a task and a valid deadline date and time.');
      return;
    }
    ApiC.notifOnSaved = false;
    await ApiC.post(Model.Todolist, {
      content,
      notes: notes.trim() || null,
      deadline: deadline.toISOString(),
      reminder_minutes: getReminderMinutes(reminderChoice, customReminder),
    });
    ApiC.notifOnSaved = true;
    draft = '';
    notes = '';
    deadlineLocal = defaultDeadline();
    setReminderControls(60);
    await signalChange();
  }

  async function destroyTask(id: number): Promise<void> {
    await ApiC.delete(`${Model.Todolist}/${id}`);
    editingId = null;
    await signalChange();
  }

  function startEditing(entry: CalendarEntry): void {
    editingId = entry.id;
    editNotes = entry.notes ?? '';
    editDeadlineLocal = toLocalInput(new Date(entry.deadline));
    setReminderControls(entry.reminderMinutes, true);
  }

  async function saveEditing(id: number): Promise<void> {
    const deadline = new Date(editDeadlineLocal);
    if (Number.isNaN(deadline.getTime())) {
      notify.error('Enter a valid deadline date and time.');
      return;
    }
    await ApiC.patch(`${Model.Todolist}/${id}`, {
      notes: editNotes.trim() || null,
      deadline: deadline.toISOString(),
      reminder_minutes: getReminderMinutes(editReminderChoice, editCustomReminder),
    });
    editingId = null;
    await signalChange();
  }

  async function signalChange(): Promise<void> {
    await load();
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }

  async function load(): Promise<void> {
    loading = true;
    const teamScope = localStorage.getItem(`${Model.Todolist}StepsShowTeam`) === '1';
    const [todoResponse, stepResponse] = await Promise.all([
      ApiC.getJson(Model.Todolist) as Promise<Todo[]>,
      ApiC.getJson(`unfinished_steps?scope=${teamScope ? 'team' : 'user'}`) as Promise<{
        calendar?: StepDeadline[];
      }>,
    ]);
    tasks = todoResponse;
    stepDeadlines = stepResponse.calendar ?? [];
    loading = false;
    window.setTimeout(checkReminders, 0);
  }

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

  function checkReminders(): void {
    const now = Date.now();
    entries.forEach(entry => {
      if (entry.reminderMinutes === null) return;
      const deadline = new Date(entry.deadline).getTime();
      const remindAt = deadline - entry.reminderMinutes * 60000;
      if (now < remindAt) return;
      const storageKey = `todo-reminder-${entry.key}-${entry.deadline}`;
      if (sessionStorage.getItem(storageKey)) return;
      const prefix = deadline < now ? t('Overdue') : t('Deadline approaching');
      notify.warning(`${prefix}: ${entry.body} — ${formatDeadline(entry.deadline)}`);
      sessionStorage.setItem(storageKey, '1');
    });
  }

  function updateUrgentBadges(calendarEntries: CalendarEntry[]): void {
    const now = Date.now();
    const urgent = calendarEntries.filter(entry => (
      new Date(entry.deadline).getTime() <= now + 24 * 60 * 60 * 1000
    )).length;
    ['todolistReminderBadge', 'todoCalendarUrgentCount'].forEach(id => {
      const badge = document.getElementById(id);
      if (!badge) return;
      badge.textContent = String(urgent);
      badge.toggleAttribute('hidden', urgent === 0);
    });
  }

  function isOverdue(entry: CalendarEntry): boolean {
    return new Date(entry.deadline).getTime() < Date.now();
  }

  function isHighlighted(entry: CalendarEntry): boolean {
    return entry.source === 'todo' && entry.id === highlightedTaskId;
  }

  onMount(() => {
    locale = document.getElementById('user-prefs')?.dataset?.jslang || 'en-gb';
    const reload = (): void => {
      void load();
    };
    window.addEventListener('todolist-changed', reload);
    window.addEventListener('todolist-scope-changed', reload);
    document.addEventListener('visibilitychange', checkReminders);
    reminderTimer = window.setInterval(checkReminders, 30000);
    void load();
    void loadCalendarFeedStatus();
    return () => {
      window.removeEventListener('todolist-changed', reload);
      window.removeEventListener('todolist-scope-changed', reload);
      document.removeEventListener('visibilitychange', checkReminders);
    };
  });

  onDestroy(() => {
    if (reminderTimer !== undefined) window.clearInterval(reminderTimer);
  });
</script>

<section class='calendar-todo-create' aria-labelledby='calendarTodoCreateHeading'>
  <h4 id='calendarTodoCreateHeading' class='h5 mb-2'>{t('Schedule a task')}</h4>
  <label class='sr-only' for='calendarTodoTitle'>{t('Task')}</label>
  <input
    id='calendarTodoTitle'
    class='form-control form-control-sm mb-2'
    bind:value={draft}
    placeholder={t('What needs to be done?')}
  />
  <div class='calendar-todo-form-grid'>
    <label>
      <span>{t('Deadline')}</span>
      <input class='form-control form-control-sm' type='datetime-local' bind:value={deadlineLocal} required />
    </label>
    <label>
      <span>{t('Reminder')}</span>
      <select class='form-control form-control-sm' bind:value={reminderChoice}>
        <option value='none'>{t('No reminder')}</option>
        <option value='0'>{t('At deadline')}</option>
        <option value='15'>{t('15 minutes before')}</option>
        <option value='60'>{t('1 hour before')}</option>
        <option value='1440'>{t('1 day before')}</option>
        <option value='10080'>{t('1 week before')}</option>
        <option value='custom'>{t('Custom minutes')}</option>
      </select>
    </label>
    {#if reminderChoice === 'custom'}
      <label>
        <span>{t('Minutes before')}</span>
        <input class='form-control form-control-sm' type='number' min='0' max='10080' bind:value={customReminder} />
      </label>
    {/if}
  </div>
  <label class='w-100 mt-2'>
    <span class='small'>{t('Notes')}</span>
    <textarea class='form-control form-control-sm' rows='2' bind:value={notes} placeholder={t('Optional details')}></textarea>
  </label>
  <button type='button' class='btn btn-primary btn-sm btn-block mt-2' on:click={create}>
    <i class='fas fa-calendar-plus fa-fw mr-1' aria-hidden='true'></i>{t('Add scheduled task')}
  </button>
</section>

<section class='calendar-feed mt-3' aria-labelledby='calendarFeedHeading'>
  <div class='d-flex align-items-center justify-content-between'>
    <h4 id='calendarFeedHeading' class='h5 mb-1'>{t('External calendar')}</h4>
    {#if calendarFeedEnabled}
      <span class='badge badge-success'>{t('Account feed active')}</span>
    {/if}
  </div>
  <p class='small text-muted mb-2'>
    {t('Subscribe to this account’s personal to-dos and owned experiment or resource step deadlines in Google Calendar or Apple Calendar.')}
  </p>
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
  {#if isLocalCalendarFeed()}
    <p class='small text-warning mb-2'>
      {t('Google Calendar will show nothing from this localhost demo because Google’s servers cannot reach it. Use Preview .ics to verify the feed; cloud subscription works after eLabFTW is available at a public HTTPS address with a trusted certificate.')}
    </p>
  {:else if window.location.protocol !== 'https:'}
    <p class='small text-warning mb-2'>
      {t('Cloud calendars require this feed to be served from a public trusted HTTPS address.')}
    </p>
  {/if}
  <p class='small text-muted mb-2'>
    {t('If Google does not add the feed automatically, copy the private link and use Other calendars → From URL in Google Calendar on a desktop browser.')}
  </p>
  <p class='small text-muted mb-2'>
    {t('Apple subscriptions appear in Apple Calendar. Apple Reminders requires a separate native app or Shortcut integration.')}
  </p>
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

<section class='calendar-todo-month mt-3' aria-label={t('Task calendar')}>
  <div class='calendar-month-header'>
    <button type='button' class='btn btn-sm calendar-month-nav' on:click={() => changeMonth(-1)} aria-label={t('Previous month')}>
      <i class='fas fa-chevron-left' aria-hidden='true'></i>
    </button>
    <div class='calendar-month-title'>
      <i class='fas fa-calendar-days' aria-hidden='true'></i>
      <strong>{monthLabel()}</strong>
    </div>
    <button type='button' class='btn btn-sm calendar-month-nav' on:click={() => changeMonth(1)} aria-label={t('Next month')}>
      <i class='fas fa-chevron-right' aria-hidden='true'></i>
    </button>
  </div>
  <div class='calendar-todo-weekdays' aria-hidden='true'>
    {#each weekdayLabels() as weekday}
      <span>{weekday}</span>
    {/each}
  </div>
  <div class='calendar-todo-grid'>
    {#each calendarCells as cell (cell.key)}
      <button
        type='button'
        class:outside={!cell.inMonth}
        class:today={cell.isToday}
        class:selected={selectedDate === cell.key}
        class:has-overdue={cell.overdue}
        class='calendar-todo-day'
        on:click={() => selectDay(cell)}
        aria-label={`${cell.key}, ${cell.count} ${t('tasks')}`}
        aria-pressed={selectedDate === cell.key}
      >
        <span class='calendar-day-number'>{cell.day}</span>
        {#if cell.count > 0}
          <small class='calendar-day-count' aria-label={`${cell.count} ${t('tasks')}`}>{cell.count}</small>
        {/if}
      </button>
    {/each}
  </div>
  <div class='calendar-legend'>
    <span><i class='calendar-legend-dot today-dot'></i>{t('Today')}</span>
    <span><i class='calendar-legend-dot selected-dot'></i>{t('Selected')}</span>
    <span><i class='calendar-legend-dot overdue-dot'></i>{t('Overdue')}</span>
  </div>
  <div class='d-flex calendar-month-actions'>
    <button type='button' class='btn btn-sm btn-outline-primary mr-2' on:click={selectToday}>
      <i class='fas fa-location-crosshairs fa-fw mr-1' aria-hidden='true'></i>{t('Today')}
    </button>
    <button type='button' class='btn btn-sm btn-outline-secondary' on:click={() => selectedDate = ''}>{t('All deadlines')}</button>
  </div>
</section>

<section class='calendar-todo-agenda mt-3' aria-labelledby='calendarTodoAgendaHeading'>
  <div class='calendar-agenda-header'>
    <div>
      <span class='calendar-agenda-eyebrow'>{t('Agenda')}</span>
      <h4 id='calendarTodoAgendaHeading' class='h5 mb-0'>{agendaLabel()}</h4>
    </div>
    <span class='badge badge-primary'>{agendaEntries.length}</span>
  </div>
  {#if loading}
    <p class='text-muted'>{t('Loading')}…</p>
  {:else if agendaEntries.length === 0}
    <p class='text-muted'>{t('No scheduled tasks for this selection.')}</p>
  {:else}
    <ul class='list-group'>
      {#each agendaEntries as entry (entry.key)}
        <li
          class:calendar-todo-overdue={isOverdue(entry)}
          class:calendar-todo-highlight={isHighlighted(entry)}
          class='list-group-item calendar-todo-entry'
          id={entry.source === 'todo' ? `calendar-todo-${entry.id}` : undefined}
        >
          <div class='d-flex align-items-start'>
            {#if entry.source === 'step'}
              <input
                type='checkbox'
                class='stepbox mr-2 mt-1'
                id={`todo_calendar_step_${entry.id}`}
                data-id={entry.entityId}
                data-type={entry.entityType}
                data-stepid={entry.id}
                aria-label={t('Mark experiment step complete')}
                on:change={() => window.setTimeout(load, 600)}
              />
            {:else}
              <i class='fas fa-circle-check color-medium fa-fw mr-2 mt-1' aria-hidden='true'></i>
            {/if}
            <div class='flex-grow-1 min-width-0'>
              <span class='calendar-entry-source'>
                {entry.source === 'todo'
                  ? t('Task')
                  : (entry.entityType === 'items' ? t('Resource step') : t('Experiment step'))}
              </span>
              <strong>{entry.body}</strong>
              {#if entry.source === 'step'}
                <div class='small'>
                  <a href={`${entry.entityPage}?mode=view&id=${entry.entityId}#step_view_${entry.id}`}>
                    {entry.entityTitle}
                  </a>
                </div>
              {/if}
              <div class:font-weight-bold={isOverdue(entry)} class='small calendar-todo-deadline'>
                <i class='fas fa-clock fa-fw mr-1' aria-hidden='true'></i>{formatDeadline(entry.deadline)}
                {#if isOverdue(entry)} · {t('Overdue')}{/if}
              </div>
              {#if entry.notes}<p class='small mb-1 mt-1'>{entry.notes}</p>{/if}
              {#if entry.reminderMinutes !== null}
                <div class='small text-muted'>
                  <i class='fas fa-bell fa-fw mr-1' aria-hidden='true'></i>
                  {entry.reminderMinutes === 0
                    ? t('At deadline')
                    : `${entry.reminderMinutes} ${t('minutes before')}`}
                </div>
              {/if}
            </div>
            {#if entry.source === 'todo'}
              <div class='btn-group btn-group-sm ml-2'>
                <button type='button' class='btn btn-ghost' on:click={() => startEditing(entry)} title={t('Edit')} aria-label={t('Edit')}>
                  <i class='fas fa-pen' aria-hidden='true'></i>
                </button>
                <button type='button' class='btn btn-ghost' on:click={() => destroyTask(entry.id)} title={t('done')} aria-label={t('done')}>
                  <i class='fas fa-check' aria-hidden='true'></i>
                </button>
              </div>
            {/if}
          </div>
          {#if entry.source === 'todo' && editingId === entry.id}
            <div class='calendar-todo-edit mt-2'>
              <input class='form-control form-control-sm' type='datetime-local' bind:value={editDeadlineLocal} />
              <select class='form-control form-control-sm' bind:value={editReminderChoice}>
                <option value='none'>{t('No reminder')}</option>
                <option value='0'>{t('At deadline')}</option>
                <option value='15'>{t('15 minutes before')}</option>
                <option value='60'>{t('1 hour before')}</option>
                <option value='1440'>{t('1 day before')}</option>
                <option value='10080'>{t('1 week before')}</option>
                <option value='custom'>{t('Custom minutes')}</option>
              </select>
              {#if editReminderChoice === 'custom'}
                <input class='form-control form-control-sm' type='number' min='0' max='10080' bind:value={editCustomReminder} aria-label={t('Minutes before')} />
              {/if}
              <textarea class='form-control form-control-sm' rows='2' bind:value={editNotes} aria-label={t('Notes')}></textarea>
              <div class='d-flex'>
                <button type='button' class='btn btn-primary btn-sm mr-1' on:click={() => saveEditing(entry.id)}>{t('Save')}</button>
                <button type='button' class='btn btn-secondary btn-sm' on:click={() => editingId = null}>{t('Cancel')}</button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .calendar-todo-create {
    background: var(--firstlevel);
    border: 1px solid var(--secondary);
    border-radius: 0.35rem;
    padding: 0.65rem;
  }

  .calendar-feed {
    background: var(--firstlevel);
    border: 1px solid var(--secondary);
    border-radius: 0.35rem;
    padding: 0.65rem;
  }

  .calendar-feed-actions {
    gap: 0.35rem;
  }

  .calendar-todo-month,
  .calendar-todo-agenda {
    background: var(--white);
    border: 1px solid var(--secondary-muted);
    border-radius: 0.65rem;
    box-shadow: 0 0.2rem 0.65rem color-mix(in srgb, var(--strongest) 10%, transparent);
    overflow: hidden;
    padding: 0.75rem;
  }

  .calendar-month-header {
    align-items: center;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--primary) 16%, var(--white)),
      color-mix(in srgb, var(--primary) 5%, var(--white))
    );
    border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--secondary-muted));
    border-radius: 0.5rem;
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.65rem;
    padding: 0.45rem;
  }

  .calendar-month-title {
    align-items: center;
    color: var(--strongest);
    display: flex;
    gap: 0.45rem;
  }

  .calendar-month-title i {
    color: var(--primary);
  }

  .calendar-month-nav {
    align-items: center;
    background: var(--white);
    border: 1px solid var(--secondary-muted);
    border-radius: 50%;
    color: var(--primary);
    display: inline-flex;
    height: 2rem;
    justify-content: center;
    padding: 0;
    width: 2rem;
  }

  .calendar-month-nav:hover {
    background: var(--primary);
    color: var(--chrome-fg);
  }

  .calendar-todo-form-grid,
  .calendar-todo-edit {
    display: grid;
    gap: 0.45rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .calendar-todo-form-grid label {
    font-size: 0.78rem;
    margin: 0;
  }

  .calendar-todo-weekdays,
  .calendar-todo-grid {
    display: grid;
    gap: 0.2rem;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .calendar-todo-weekdays span {
    color: var(--medium);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 0.2rem 0;
    text-align: center;
    text-transform: uppercase;
  }

  .calendar-todo-day {
    align-items: flex-start;
    aspect-ratio: 1 / 0.92;
    background: color-mix(in srgb, var(--white) 82%, var(--mainbackground));
    border: 1px solid var(--secondary-muted);
    border-radius: 0.42rem;
    color: var(--strongest);
    display: flex;
    font-size: 0.78rem;
    justify-content: flex-start;
    min-width: 0;
    padding: 0.28rem;
    position: relative;
    transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  }

  .calendar-todo-day:hover {
    border-color: var(--primary);
    transform: translateY(-1px);
  }

  .calendar-todo-day.selected {
    background: color-mix(in srgb, var(--primary) 18%, var(--white));
    border-color: var(--primary);
    box-shadow: inset 0 0 0 1px var(--primary);
  }

  .calendar-todo-day.today {
    background: color-mix(in srgb, var(--primary) 11%, var(--white));
    font-weight: 700;
  }

  .calendar-todo-day.today .calendar-day-number {
    align-items: center;
    background: var(--primary);
    border-radius: 50%;
    color: var(--chrome-fg);
    display: inline-flex;
    height: 1.35rem;
    justify-content: center;
    width: 1.35rem;
  }

  .calendar-todo-day.outside {
    background: var(--mainbackground);
    opacity: 0.4;
  }

  .calendar-day-number {
    line-height: 1.35rem;
  }

  .calendar-day-count {
    align-items: center;
    background: var(--primary);
    border-radius: 1rem;
    bottom: 0.25rem;
    color: var(--chrome-fg);
    display: inline-flex;
    font-size: 0.62rem;
    font-weight: 700;
    height: 1.05rem;
    justify-content: center;
    line-height: 1;
    min-width: 1rem;
    padding: 0.15rem;
    position: absolute;
    right: 0.25rem;
  }

  .calendar-todo-day.has-overdue .calendar-day-count {
    background: var(--danger);
  }

  .calendar-legend {
    align-items: center;
    color: var(--medium);
    display: flex;
    flex-wrap: wrap;
    font-size: 0.67rem;
    gap: 0.7rem;
    margin-top: 0.6rem;
  }

  .calendar-legend span {
    align-items: center;
    display: inline-flex;
    gap: 0.25rem;
  }

  .calendar-legend-dot {
    background: var(--mainbackground);
    border: 1px solid var(--secondary-muted);
    border-radius: 50%;
    display: inline-block;
    height: 0.55rem;
    width: 0.55rem;
  }

  .calendar-legend-dot.today-dot {
    background: var(--primary);
    border-color: var(--primary);
  }

  .calendar-legend-dot.selected-dot {
    background: color-mix(in srgb, var(--primary) 24%, var(--white));
    border-color: var(--primary);
  }

  .calendar-legend-dot.overdue-dot {
    background: var(--danger);
    border-color: var(--danger);
  }

  .calendar-month-actions {
    border-top: 1px solid var(--secondary-muted);
    margin-top: 0.65rem;
    padding-top: 0.65rem;
  }

  .calendar-agenda-header {
    align-items: center;
    border-bottom: 1px solid var(--secondary-muted);
    display: flex;
    justify-content: space-between;
    margin: -0.1rem 0 0.7rem;
    padding-bottom: 0.6rem;
  }

  .calendar-agenda-eyebrow {
    color: var(--primary);
    display: block;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .calendar-todo-entry {
    background: color-mix(in srgb, var(--white) 92%, var(--primary));
    border-left: 3px solid var(--primary);
    border-radius: 0.35rem !important;
    margin-bottom: 0.45rem;
  }

  .calendar-todo-entry.calendar-todo-overdue {
    background: color-mix(in srgb, var(--white) 92%, var(--danger));
    border-left-color: var(--danger);
  }

  .calendar-entry-source {
    color: var(--primary);
    display: block;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    margin-bottom: 0.1rem;
    text-transform: uppercase;
  }

  .calendar-todo-highlight {
    animation: calendar-highlight 2s ease-in-out 2;
  }

  .calendar-todo-deadline {
    color: var(--medium);
  }

  .calendar-todo-overdue .calendar-todo-deadline {
    color: var(--danger);
  }

  .calendar-todo-edit {
    background: var(--firstlevel);
    border-radius: 0.25rem;
    padding: 0.5rem;
  }

  .calendar-todo-edit textarea,
  .calendar-todo-edit .d-flex {
    grid-column: 1 / -1;
  }

  .min-width-0 {
    min-width: 0;
  }

  @keyframes calendar-highlight {
    50% {
      background-color: color-mix(in srgb, var(--warning) 25%, transparent);
    }
  }

  @media (max-width: 480px) {
    .calendar-todo-form-grid,
    .calendar-todo-edit {
      grid-template-columns: 1fr;
    }
  }
</style>
