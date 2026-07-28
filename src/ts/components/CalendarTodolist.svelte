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

<section class='calendar-todo-month mt-3' aria-label={t('Task calendar')}>
  <div class='d-flex align-items-center justify-content-between mb-2'>
    <button type='button' class='btn btn-sm btn-ghost' on:click={() => changeMonth(-1)} aria-label={t('Previous month')}>
      <i class='fas fa-chevron-left' aria-hidden='true'></i>
    </button>
    <strong>{monthLabel()}</strong>
    <button type='button' class='btn btn-sm btn-ghost' on:click={() => changeMonth(1)} aria-label={t('Next month')}>
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
        <span>{cell.day}</span>
        {#if cell.count > 0}<small>{cell.count}</small>{/if}
      </button>
    {/each}
  </div>
  <div class='d-flex mt-2'>
    <button type='button' class='btn btn-sm btn-outline-secondary mr-2' on:click={selectToday}>{t('Today')}</button>
    <button type='button' class='btn btn-sm btn-outline-secondary' on:click={() => selectedDate = ''}>{t('All deadlines')}</button>
  </div>
</section>

<section class='calendar-todo-agenda mt-3' aria-labelledby='calendarTodoAgendaHeading'>
  <h4 id='calendarTodoAgendaHeading' class='h5 mb-2'>{agendaLabel()}</h4>
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
    font-size: 0.72rem;
    text-align: center;
  }

  .calendar-todo-day {
    align-items: center;
    aspect-ratio: 1;
    background: var(--mainbackground);
    border: 1px solid var(--secondary);
    border-radius: 0.3rem;
    color: var(--strongest);
    display: flex;
    flex-direction: column;
    font-size: 0.78rem;
    justify-content: center;
    min-width: 0;
    padding: 0.1rem;
    position: relative;
  }

  .calendar-todo-day:hover,
  .calendar-todo-day.selected {
    border-color: var(--primary);
    box-shadow: inset 0 0 0 1px var(--primary);
  }

  .calendar-todo-day.today {
    background: color-mix(in srgb, var(--primary) 14%, var(--mainbackground));
    font-weight: 700;
  }

  .calendar-todo-day.outside {
    opacity: 0.45;
  }

  .calendar-todo-day small {
    background: var(--primary);
    border-radius: 1rem;
    color: white;
    font-size: 0.62rem;
    line-height: 1;
    min-width: 1rem;
    padding: 0.15rem;
  }

  .calendar-todo-day.has-overdue small {
    background: var(--danger);
  }

  .calendar-todo-entry {
    border-left: 3px solid var(--primary);
  }

  .calendar-todo-entry.calendar-todo-overdue {
    border-left-color: var(--danger);
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
