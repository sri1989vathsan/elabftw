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
    completed_at: string | null;
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
    completedAt: string | null;
    entityId?: number;
    entityPage?: string;
    entityTitle?: string;
    entityType?: 'experiments' | 'items';
  };

  type ActivityHeading = {
    index: number;
    level: number;
    text: string;
    date: string;
    parent_index: number | null;
    anchor: string;
  };

  type EntityActivity = {
    id: number;
    title: string;
    date: string;
    entity_type: 'experiments' | 'items';
    entity_page: string;
    headings: ActivityHeading[];
  };

  type VisibleActivityHeading = ActivityHeading & {
    depth: number;
    contextual: boolean;
  };

  type AgendaEntityActivity = EntityActivity & {
    visibleHeadings: VisibleActivityHeading[];
  };

  type ActivityResponse = {
    from: string;
    to: string;
    experiments: EntityActivity[];
    items: EntityActivity[];
  };

  type CalendarCell = {
    date: Date;
    key: string;
    day: number;
    inMonth: boolean;
    isToday: boolean;
    count: number;
    taskCount: number;
    experimentCount: number;
    resourceCount: number;
    overdue: boolean;
    taskTone: 'none' | 'activity' | 'upcoming' | 'today' | 'overdue' | 'completed';
  };

  type CalendarFeedStatus = {
    enabled: boolean;
    created_at: string | null;
    updated_at: string | null;
  };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();
  const urgentWindowMs = 60 * 60 * 1000;
  const selectedDateStorageKey = 'activity-calendar-selected-date';
  const monthStorageKey = 'activity-calendar-month';
  const highlightedTaskId = parseInt(
    new URLSearchParams(window.location.search).get('task') ?? '',
    10,
  );
  let locale = 'en-gb';
  let calendarTasks: Todo[] = [];
  let activeTasks: Todo[] = [];
  let stepDeadlines: StepDeadline[] = [];
  let entityActivities: EntityActivity[] = [];
  let entries: CalendarEntry[] = [];
  let reminderEntries: CalendarEntry[] = [];
  let calendarCells: CalendarCell[] = [];
  let agendaEntries: CalendarEntry[] = [];
  let agendaExperiments: AgendaEntityActivity[] = [];
  let agendaResources: AgendaEntityActivity[] = [];
  let agendaCount = 0;
  let activitySearch = '';
  let showTasks = true;
  let showExperiments = true;
  let showResources = true;
  let teamScope = localStorage.getItem(`${Model.Todolist}StepsShowTeam`) === '1';
  let monthCursor = storedMonthCursor();
  // With no selected date, the agenda displays the entire visible calendar
  // range. This makes entity activity available on every eLabFTW page.
  let selectedDate = sessionStorage.getItem(selectedDateStorageKey) ?? '';
  let loading = true;
  let reminderTimer: number | undefined;
  let calendarFeedEnabled = false;
  let calendarFeedLoading = true;
  let calendarFeedUrl = '';
  let draggedTaskId: number | null = null;
  let dragOverDate = '';

  $: entries = [
    ...calendarTasks
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
        completedAt: task.completed_at,
      })),
    ...stepDeadlines.map(step => ({
      key: `step-${step.entity_type}-${step.step_id}`,
      source: 'step' as const,
      id: Number(step.step_id),
      body: step.step_body,
      notes: null,
      deadline: step.deadline,
      reminderMinutes: Number(step.deadline_notif) === 1 ? 30 : null,
      completedAt: null,
      entityId: Number(step.entity_id),
      entityPage: step.entity_page,
      entityTitle: step.entity_title,
      entityType: step.entity_type,
    })),
  ].sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  $: reminderEntries = [
    ...activeTasks
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
        completedAt: null,
      })),
    ...stepDeadlines.map(step => ({
      key: `step-${step.entity_type}-${step.step_id}`,
      source: 'step' as const,
      id: Number(step.step_id),
      body: step.step_body,
      notes: null,
      deadline: step.deadline,
      reminderMinutes: Number(step.deadline_notif) === 1 ? 30 : null,
      completedAt: null,
      entityId: Number(step.entity_id),
      entityPage: step.entity_page,
      entityTitle: step.entity_title,
      entityType: step.entity_type,
    })),
  ];
  $: calendarCells = buildCalendarCells(monthCursor, entries, entityActivities);
  $: agendaEntries = showTasks
    ? entries.filter(entry => (
      matchesAgendaDate(dateKey(new Date(entry.deadline)), selectedDate, monthCursor)
        && matchesSearch(`${entry.body} ${entry.notes ?? ''} ${entry.entityTitle ?? ''}`, activitySearch)
    ))
    : [];
  $: agendaExperiments = showExperiments
    ? buildAgendaEntities('experiments', entityActivities, selectedDate, monthCursor, activitySearch)
    : [];
  $: agendaResources = showResources
    ? buildAgendaEntities('items', entityActivities, selectedDate, monthCursor, activitySearch)
    : [];
  $: agendaCount = agendaEntries.length + agendaExperiments.length + agendaResources.length;
  $: updateUrgentBadges(reminderEntries);

  function dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function storedMonthCursor(): Date {
    const stored = sessionStorage.getItem(monthStorageKey);
    if (stored && /^\d{4}-\d{2}-01$/.test(stored)) {
      const parsed = new Date(`${stored}T12:00:00`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }

  function buildCalendarCells(
    month: Date,
    calendarEntries: CalendarEntry[],
    activities: EntityActivity[],
  ): CalendarCell[] {
    const start = calendarStart(month);
    const today = dateKey(new Date());
    const now = Date.now();
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = dateKey(date);
      const dayEntries = calendarEntries.filter(entry => (
        dateKey(new Date(entry.deadline)) === key
      ));
      const activeDayEntries = dayEntries.filter(entry => entry.completedAt === null);
      const overdue = activeDayEntries.some(entry => new Date(entry.deadline).getTime() < now);
      const experimentCount = activities.filter(activity => (
        activity.entity_type === 'experiments' && activityOccursOn(activity, key)
      )).length;
      const resourceCount = activities.filter(activity => (
        activity.entity_type === 'items' && activityOccursOn(activity, key)
      )).length;
      return {
        date,
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === month.getMonth(),
        isToday: key === today,
        count: dayEntries.length + experimentCount + resourceCount,
        taskCount: dayEntries.length,
        experimentCount,
        resourceCount,
        overdue,
        taskTone: dayEntries.length === 0
          ? (experimentCount + resourceCount > 0 ? 'activity' : 'none')
          : overdue
            ? 'overdue'
            : activeDayEntries.length === 0
              ? 'completed'
              : key === today
                ? 'today'
                : 'upcoming',
      };
    });
  }

  function calendarStart(month: Date): Date {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayOffset);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function calendarTaskQuery(): string {
    const start = calendarStart(monthCursor);
    const end = new Date(start);
    end.setDate(start.getDate() + 42);
    const params = new URLSearchParams({
      calendar: '1',
      deadline_from: start.toISOString(),
      deadline_to: end.toISOString(),
    });
    return `${Model.Todolist}?${params.toString()}`;
  }

  function calendarActivityQuery(): string {
    const start = calendarStart(monthCursor);
    const end = new Date(start);
    end.setDate(start.getDate() + 41);
    const params = new URLSearchParams({
      from: dateKey(start),
      to: dateKey(end),
      scope: teamScope ? 'team' : 'user',
    });
    return `${Model.CalendarActivity}?${params.toString()}`;
  }

  function monthActivityCount(): number {
    const taskCount = entries.filter(entry => {
      const deadline = new Date(entry.deadline);
      return deadline.getFullYear() === monthCursor.getFullYear()
        && deadline.getMonth() === monthCursor.getMonth();
    }).length;
    const entityKeys = new Set<string>();
    entityActivities.forEach(activity => {
      activityDates(activity).forEach(date => {
        const parsed = new Date(`${date}T12:00:00`);
        if (parsed.getFullYear() === monthCursor.getFullYear()
          && parsed.getMonth() === monthCursor.getMonth()
        ) {
          entityKeys.add(`${activity.entity_type}-${activity.id}-${date}`);
        }
      });
    });
    return taskCount + entityKeys.size;
  }

  function activityDates(activity: EntityActivity): Set<string> {
    return new Set([activity.date, ...activity.headings.map(heading => heading.date)]);
  }

  function activityOccursOn(activity: EntityActivity, date: string): boolean {
    return activity.date === date || activity.headings.some(heading => heading.date === date);
  }

  function matchesSearch(value: string, search: string): boolean {
    const query = search.trim().toLocaleLowerCase();
    return query.length === 0 || value.toLocaleLowerCase().includes(query);
  }

  function matchesAgendaDate(date: string, agendaDate: string, month: Date): boolean {
    if (agendaDate) return date === agendaDate;
    const start = calendarStart(month);
    const end = new Date(start);
    end.setDate(start.getDate() + 41);
    return date >= dateKey(start) && date <= dateKey(end);
  }

  function buildAgendaEntities(
    type: 'experiments' | 'items',
    activities: EntityActivity[],
    agendaDate: string,
    month: Date,
    search: string,
  ): AgendaEntityActivity[] {
    const result: AgendaEntityActivity[] = [];
    activities
      .filter(activity => activity.entity_type === type && (
        agendaDate
          ? activityOccursOn(activity, agendaDate)
          : [...activityDates(activity)].some(date => matchesAgendaDate(date, agendaDate, month))
      ))
      .forEach(activity => {
        const byIndex = new Map(activity.headings.map(heading => [heading.index, heading]));
        const included = new Set<number>();
        activity.headings
          .filter(heading => matchesAgendaDate(heading.date, agendaDate, month))
          .forEach(heading => {
            included.add(heading.index);
            let parentIndex = heading.parent_index;
            while (parentIndex !== null) {
              included.add(parentIndex);
              parentIndex = byIndex.get(parentIndex)?.parent_index ?? null;
            }
          });

        const visibleHeadings = activity.headings
          .filter(heading => included.has(heading.index))
          .map(heading => {
            let depth = 0;
            let parentIndex = heading.parent_index;
            while (parentIndex !== null && included.has(parentIndex)) {
              depth++;
              parentIndex = byIndex.get(parentIndex)?.parent_index ?? null;
            }
            return {
              ...heading,
              depth,
              contextual: !matchesAgendaDate(heading.date, agendaDate, month),
            };
          });

        if (!matchesSearch(`${activity.title} ${visibleHeadings.map(heading => heading.text).join(' ')}`, search)) {
          return;
        }
        result.push({ ...activity, visibleHeadings });
      });
    return result;
  }

  function entityUrl(activity: EntityActivity): string {
    return `/${activity.entity_page}?mode=view&id=${activity.id}`;
  }

  function headingUrl(activity: EntityActivity, heading: ActivityHeading): string {
    const url = new URL(entityUrl(activity), window.location.origin);
    if (heading.anchor) {
      url.hash = heading.anchor;
    } else {
      url.searchParams.set('activity_heading', String(heading.index));
      url.hash = `activity-heading-${heading.index + 1}`;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function confirmEntityNavigation(event: MouseEvent, activity: EntityActivity): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') !== 'edit') return;
    const currentId = Number.parseInt(params.get('id') ?? '', 10);
    const currentPage = window.location.pathname.split('/').pop();
    if (currentId === activity.id && currentPage === activity.entity_page) return;
    if (!window.confirm(t('You are editing an entry. Leave this page and risk losing unsaved changes?'))) {
      event.preventDefault();
    }
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
    if (!selectedDate) return t('All visible dates');
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'full',
    }).format(new Date(`${selectedDate}T12:00:00`));
  }

  function selectDay(cell: CalendarCell): void {
    selectedDate = cell.key;
    sessionStorage.setItem(selectedDateStorageKey, selectedDate);
    if (!cell.inMonth) {
      monthCursor = new Date(cell.date.getFullYear(), cell.date.getMonth(), 1);
      sessionStorage.setItem(monthStorageKey, dateKey(monthCursor));
      void load();
    }
  }

  function changeMonth(offset: number): void {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + offset, 1);
    selectedDate = '';
    sessionStorage.setItem(monthStorageKey, dateKey(monthCursor));
    sessionStorage.removeItem(selectedDateStorageKey);
    void load();
  }

  function selectToday(): void {
    const today = new Date();
    monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedDate = dateKey(today);
    sessionStorage.setItem(monthStorageKey, dateKey(monthCursor));
    sessionStorage.setItem(selectedDateStorageKey, selectedDate);
    void load();
  }

  function selectAllVisibleDates(): void {
    selectedDate = '';
    sessionStorage.removeItem(selectedDateStorageKey);
  }

  function setCalendarScope(useTeamScope: boolean): void {
    if (teamScope === useTeamScope) return;
    teamScope = useTeamScope;
    localStorage.setItem(`${Model.Todolist}StepsShowTeam`, teamScope ? '1' : '0');
    const tasksScopeSwitch = document.getElementById(`${Model.Todolist}StepsShowTeam`) as HTMLInputElement | null;
    if (tasksScopeSwitch) tasksScopeSwitch.checked = teamScope;
    window.dispatchEvent(new CustomEvent('todolist-scope-changed'));
  }

  function startTaskDrag(event: DragEvent, entry: CalendarEntry): void {
    if (entry.source !== 'todo' || entry.completedAt !== null) return;
    draggedTaskId = entry.id;
    event.dataTransfer?.setData('text/plain', String(entry.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function allowDayDrop(event: DragEvent, key: string): void {
    if (draggedTaskId === null) return;
    event.preventDefault();
    dragOverDate = key;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function finishTaskDrag(): void {
    draggedTaskId = null;
    dragOverDate = '';
  }

  async function dropTaskOnDay(event: DragEvent, cell: CalendarCell): Promise<void> {
    event.preventDefault();
    const taskId = draggedTaskId;
    finishTaskDrag();
    if (taskId === null) return;
    const task = calendarTasks.find(item => Number(item.id) === taskId && item.completed_at === null);
    if (!task?.deadline) return;
    const currentDeadline = new Date(task.deadline);
    const movedDeadline = new Date(cell.date);
    movedDeadline.setHours(
      currentDeadline.getHours(),
      currentDeadline.getMinutes(),
      currentDeadline.getSeconds(),
      0,
    );
    try {
      await ApiC.patch(`${Model.Todolist}/${taskId}`, {deadline: movedDeadline.toISOString()});
      monthCursor = new Date(cell.date.getFullYear(), cell.date.getMonth(), 1);
      selectedDate = cell.key;
      await load();
      window.dispatchEvent(new CustomEvent('todolist-changed'));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'The task date could not be changed.');
      await load();
    }
  }

  async function load(): Promise<void> {
    loading = true;
    const [calendarResponse, activeResponse, stepResponse, activityResponse] = await Promise.all([
      ApiC.getJson(calendarTaskQuery()) as Promise<Todo[]>,
      ApiC.getJson(Model.Todolist) as Promise<Todo[]>,
      ApiC.getJson(`unfinished_steps?scope=${teamScope ? 'team' : 'user'}`) as Promise<{
        calendar?: StepDeadline[];
      }>,
      ApiC.getJson(calendarActivityQuery()) as Promise<ActivityResponse>,
    ]);
    calendarTasks = calendarResponse;
    activeTasks = activeResponse;
    stepDeadlines = stepResponse.calendar ?? [];
    entityActivities = [
      ...(activityResponse.experiments ?? []),
      ...(activityResponse.items ?? []),
    ];
    loading = false;
    window.setTimeout(checkReminders, 0);
  }

  async function loadCalendarFeedStatus(): Promise<void> {
    calendarFeedLoading = true;
    const status = await ApiC.getJson(Model.CalendarFeed) as CalendarFeedStatus;
    calendarFeedEnabled = status.enabled;
    calendarFeedLoading = false;
  }

  async function refreshCalendarSidebar(): Promise<void> {
    const button = document.getElementById('calendarActivityRefresh') as HTMLButtonElement | null;
    const icon = button?.querySelector('i');
    button?.setAttribute('disabled', '');
    button?.setAttribute('aria-busy', 'true');
    icon?.classList.add('fa-spin');
    try {
      await Promise.all([load(), loadCalendarFeedStatus()]);
    } finally {
      button?.removeAttribute('disabled');
      button?.removeAttribute('aria-busy');
      icon?.classList.remove('fa-spin');
    }
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
    reminderEntries.forEach(entry => {
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
    updateUrgentBadges(reminderEntries, now);
  }

  function updateUrgentBadges(
    calendarEntries: CalendarEntry[],
    now = Date.now(),
  ): void {
    const urgentDeadline = now + urgentWindowMs;
    const urgent = calendarEntries.filter(entry => {
      const deadline = new Date(entry.deadline).getTime();
      return Number.isFinite(deadline) && deadline <= urgentDeadline;
    }).length;
    ['todolistReminderBadge', 'activityCalendarReminderBadge'].forEach(id => {
      const badge = document.getElementById(id);
      if (!badge) return;
      badge.textContent = String(urgent);
      badge.toggleAttribute('hidden', urgent === 0);
    });
  }

  function isOverdue(entry: CalendarEntry): boolean {
    return entry.completedAt === null && new Date(entry.deadline).getTime() < Date.now();
  }

  function isHighlighted(entry: CalendarEntry): boolean {
    return entry.source === 'todo' && entry.id === highlightedTaskId;
  }

  onMount(() => {
    locale = document.getElementById('user-prefs')?.dataset?.jslang || 'en-gb';
    const refreshButton = document.getElementById('calendarActivityRefresh');
    const reload = (): void => {
      void load();
    };
    const reloadScope = (): void => {
      teamScope = localStorage.getItem(`${Model.Todolist}StepsShowTeam`) === '1';
      void load();
    };
    const refresh = (): void => {
      void refreshCalendarSidebar();
    };
    refreshButton?.addEventListener('click', refresh);
    window.addEventListener('todolist-changed', reload);
    window.addEventListener('todolist-scope-changed', reloadScope);
    document.addEventListener('visibilitychange', checkReminders);
    reminderTimer = window.setInterval(checkReminders, 30000);
    void load();
    void loadCalendarFeedStatus();
    return () => {
      window.removeEventListener('todolist-changed', reload);
      window.removeEventListener('todolist-scope-changed', reloadScope);
      document.removeEventListener('visibilitychange', checkReminders);
      refreshButton?.removeEventListener('click', refresh);
    };
  });

  onDestroy(() => {
    if (reminderTimer !== undefined) window.clearInterval(reminderTimer);
  });
</script>

<section class='calendar-todo-month' aria-label={t('Activity calendar')}>
  <div class='calendar-scope-selector' role='group' aria-label={t('Calendar scope')}>
    <button
      type='button'
      class:active={!teamScope}
      class='btn btn-sm'
      aria-pressed={!teamScope}
      on:click={() => setCalendarScope(false)}
    >
      <i class='fas fa-user fa-fw mr-1' aria-hidden='true'></i>{t('User')}
    </button>
    <button
      type='button'
      class:active={teamScope}
      class='btn btn-sm'
      aria-pressed={teamScope}
      on:click={() => setCalendarScope(true)}
    >
      <i class='fas fa-users fa-fw mr-1' aria-hidden='true'></i>{t('Team')}
    </button>
  </div>
  <div class='calendar-month-header'>
    <button type='button' class='btn btn-sm calendar-month-nav' on:click={() => changeMonth(-1)} aria-label={t('Previous month')}>
      <i class='fas fa-chevron-left' aria-hidden='true'></i>
    </button>
    <div class='calendar-month-copy'>
      <span class='calendar-month-eyebrow'>{t('Lab activity')}</span>
      <div class='calendar-month-title'>
        <strong>{monthLabel()}</strong>
        <span>{monthActivityCount()} {t('entries')}</span>
      </div>
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
        class:calendar-day-drag-over={dragOverDate === cell.key}
        class='calendar-todo-day'
        on:click={() => selectDay(cell)}
        on:dragover={(event) => allowDayDrop(event, cell.key)}
        on:drop={(event) => void dropTaskOnDay(event, cell)}
        aria-label={`${cell.key}, ${cell.count} ${t('calendar entries')}`}
        aria-pressed={selectedDate === cell.key}
      >
        <span class='calendar-day-number'>{cell.day}</span>
        {#if cell.count > 0}
          <span class='calendar-day-type-dots' aria-hidden='true'>
            {#if cell.taskCount > 0}<i class='calendar-type-dot calendar-type-task'></i>{/if}
            {#if cell.experimentCount > 0}<i class='calendar-type-dot calendar-type-experiment'></i>{/if}
            {#if cell.resourceCount > 0}<i class='calendar-type-dot calendar-type-resource'></i>{/if}
          </span>
        {/if}
        {#if cell.count > 0}
          <small
            class={`calendar-day-count calendar-day-count-${cell.taskTone}`}
            aria-label={`${cell.count} ${t('calendar entries')}`}
          >{cell.count}</small>
        {/if}
      </button>
    {/each}
  </div>
  <div class='calendar-legend'>
    <span><i class='calendar-legend-dot task-dot'></i>{t('Tasks')}</span>
    <span><i class='calendar-legend-dot experiment-dot'></i>{t('Experiments')}</span>
    <span><i class='calendar-legend-dot resource-dot'></i>{t('Resources')}</span>
    <span><i class='calendar-legend-dot overdue-dot'></i>{t('Overdue')}</span>
  </div>
  <div class='d-flex calendar-month-actions'>
    <button
      type='button'
      class:active={!selectedDate}
      class='btn btn-sm btn-outline-primary mr-2'
      aria-pressed={!selectedDate}
      on:click={selectAllVisibleDates}
    >
      <i class='fas fa-layer-group fa-fw mr-1' aria-hidden='true'></i>{t('All visible dates')}
    </button>
    <button type='button' class='btn btn-sm btn-outline-primary mr-2' on:click={selectToday}>
      <i class='fas fa-location-crosshairs fa-fw mr-1' aria-hidden='true'></i>{t('Today')}
    </button>
  </div>
</section>

<section class='calendar-todo-agenda mt-3' aria-labelledby='calendarTodoAgendaHeading'>
  <div class='calendar-agenda-header'>
    <div>
      <span class='calendar-agenda-eyebrow'>{t('Agenda')}</span>
      <h4 id='calendarTodoAgendaHeading' class='h5 mb-0'>{agendaLabel()}</h4>
    </div>
    <span class='badge badge-primary'>{agendaCount}</span>
  </div>
  <div class='calendar-agenda-controls mb-3'>
    <label class='sr-only' for='calendarActivitySearch'>{t('Filter this day')}</label>
    <div class='input-group input-group-sm mb-2'>
      <div class='input-group-prepend'>
        <span class='input-group-text'><i class='fas fa-magnifying-glass' aria-hidden='true'></i></span>
      </div>
      <input
        id='calendarActivitySearch'
        type='search'
        class='form-control'
        placeholder={t('Filter tasks, entries, or headers')}
        bind:value={activitySearch}
      />
    </div>
    <div class='btn-group btn-group-sm d-flex calendar-activity-toggles' role='group' aria-label={t('Calendar entry types')}>
      <button type='button' class:active={showTasks} class='btn btn-outline-primary flex-fill' aria-pressed={showTasks} on:click={() => showTasks = !showTasks}>
        <i class='fas fa-list-check fa-fw' aria-hidden='true'></i><span class='sr-only'>{t('Tasks')}</span>
      </button>
      <button type='button' class:active={showExperiments} class='btn btn-outline-primary flex-fill' aria-pressed={showExperiments} on:click={() => showExperiments = !showExperiments}>
        <i class='fas fa-flask fa-fw' aria-hidden='true'></i><span class='sr-only'>{t('Experiments')}</span>
      </button>
      <button type='button' class:active={showResources} class='btn btn-outline-primary flex-fill' aria-pressed={showResources} on:click={() => showResources = !showResources}>
        <i class='fas fa-box-archive fa-fw' aria-hidden='true'></i><span class='sr-only'>{t('Resources')}</span>
      </button>
    </div>
  </div>
  {#if loading}
    <p class='text-muted'>{t('Loading')}…</p>
  {:else if agendaCount === 0}
    <p class='text-muted'>{t('No matching activity for this date.')}</p>
  {:else}
    {#if agendaEntries.length > 0}
      <details class='calendar-activity-group' open>
        <summary>
          <i class='fas fa-list-check fa-fw mr-2' aria-hidden='true'></i>{t('Tasks and steps')}
          <span class='badge badge-secondary ml-auto'>{agendaEntries.length}</span>
        </summary>
        <ul class='list-group calendar-activity-tree'>
          {#each agendaEntries as entry (entry.key)}
            <li
              class:calendar-todo-overdue={isOverdue(entry)}
              class:calendar-todo-completed={entry.completedAt !== null}
              class:calendar-todo-highlight={isHighlighted(entry)}
              class='list-group-item calendar-todo-entry'
              id={entry.source === 'todo' ? `calendar-todo-${entry.id}` : undefined}
            >
              <div class='d-flex align-items-start'>
                {#if entry.completedAt}
                  <i class='fas fa-circle-check calendar-completed-icon fa-fw mr-2 mt-1' aria-hidden='true'></i>
                {:else if entry.source === 'step'}
                  <i class='fas fa-list-check color-medium fa-fw mr-2 mt-1' aria-hidden='true'></i>
                {:else}
                  <button type='button' class='btn btn-ghost btn-sm calendar-task-drag-handle mr-1' draggable='true' on:dragstart={(event) => startTaskDrag(event, entry)} on:dragend={finishTaskDrag} title={t('Drag to another calendar day')} aria-label={t('Drag to another calendar day')}>
                    <i class='fas fa-grip-vertical' aria-hidden='true'></i>
                  </button>
                  <i class='fas fa-clock color-medium fa-fw mr-2 mt-1' aria-hidden='true'></i>
                {/if}
                <div class='flex-grow-1 min-width-0'>
                  <span class='calendar-entry-source'>
                    {entry.source === 'todo' ? t('Task') : (entry.entityType === 'items' ? t('Resource step') : t('Experiment step'))}
                  </span>
                  <strong>{entry.body}</strong>
                  {#if entry.source === 'step'}
                    <div class='small'><a href={`${entry.entityPage}?mode=view&id=${entry.entityId}#step_view_${entry.id}`}>{entry.entityTitle}</a></div>
                  {/if}
                  <div class:font-weight-bold={isOverdue(entry)} class='small calendar-todo-deadline'>
                    <i class='fas fa-clock fa-fw mr-1' aria-hidden='true'></i>{formatDeadline(entry.deadline)}
                    {#if isOverdue(entry)} · {t('Overdue')}{/if}
                  </div>
                  {#if entry.completedAt}<div class='small calendar-task-completed'><i class='fas fa-check fa-fw mr-1' aria-hidden='true'></i>{t('Completed')} {formatDeadline(entry.completedAt)}</div>{/if}
                  {#if entry.notes}<p class='small mb-1 mt-1 calendar-task-notes'>{entry.notes}</p>{/if}
                  {#if entry.reminderMinutes !== null}<div class='small text-muted'><i class='fas fa-bell fa-fw mr-1' aria-hidden='true'></i>{entry.reminderMinutes === 0 ? t('At deadline') : `${entry.reminderMinutes} ${t('minutes before')}`}</div>{/if}
                </div>
              </div>
            </li>
          {/each}
        </ul>
      </details>
    {/if}

    {#each [
      { key: 'experiments', label: t('Experiments'), icon: 'fa-flask', entries: agendaExperiments },
      { key: 'items', label: t('Resources'), icon: 'fa-box-archive', entries: agendaResources },
    ] as group (group.key)}
      {#if group.entries.length > 0}
        <details class={`calendar-activity-group calendar-activity-group-${group.key}`} open>
          <summary>
            <i class={`fas ${group.icon} fa-fw mr-2`} aria-hidden='true'></i>{group.label}
            <span class='badge badge-secondary ml-auto'>{group.entries.length}</span>
          </summary>
          <ul class='calendar-entity-list list-unstyled mb-0'>
            {#each group.entries as activity (`${activity.entity_type}-${activity.id}`)}
              <li class='calendar-entity-node'>
                <details open>
                  <summary class='calendar-entity-summary'>
                    <i class='fas fa-file-lines fa-fw mr-2' aria-hidden='true'></i>
                    <a href={entityUrl(activity)} on:click={(event) => confirmEntityNavigation(event, activity)}>{activity.title || t('Untitled')}</a>
                    <time class='calendar-entity-date badge badge-light ml-auto' datetime={activity.date}>{activity.date}</time>
                  </summary>
                  {#if activity.visibleHeadings.length > 0}
                    <ul class='calendar-heading-tree list-unstyled mb-1'>
                      {#each activity.visibleHeadings as heading (heading.index)}
                        <li class:calendar-heading-context={heading.contextual} class='calendar-heading-node' style={`padding-left:${0.25 + (heading.depth * 0.82)}rem`}>
                          <span class='calendar-tree-branch' aria-hidden='true'>└</span>
                          <i class={`fas fa-heading calendar-heading-level-${heading.level} fa-fw mr-1`} aria-hidden='true'></i>
                          <a href={headingUrl(activity, heading)} on:click={(event) => confirmEntityNavigation(event, activity)}>{heading.text}</a>
                          {#if heading.contextual}<span class='badge badge-light ml-1'>{t('context')}</span>{/if}
                          {#if !selectedDate}<time class='calendar-heading-date ml-auto' datetime={heading.date}>{heading.date}</time>{/if}
                        </li>
                      {/each}
                    </ul>
                  {:else}
                    <p class='small text-muted calendar-entity-no-headings mb-1'>{t('No headers in this entry.')}</p>
                  {/if}
                </details>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    {/each}
  {/if}
</section>

<section class='calendar-feed mt-3' aria-labelledby='calendarFeedHeading'>
  <div class='calendar-feed-header'>
    <div class='calendar-feed-title'>
      <span class='calendar-feed-icon' aria-hidden='true'>
        <i class='fas fa-calendar-days'></i>
      </span>
      <div>
        <span class='calendar-feed-eyebrow'>{t('Calendar subscription')}</span>
        <h4 id='calendarFeedHeading' class='h5 mb-0'>{t('External calendar')}</h4>
      </div>
    </div>
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

<style>
  .calendar-feed {
    background: var(--chrome-bg);
    border: 1px solid var(--secondary);
    border-radius: 0.25rem;
    color: var(--chrome-fg);
    padding: 0.8rem;
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
    color: var(--chrome-muted);
    display: block;
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .calendar-todo-month,
  .calendar-todo-agenda {
    --calendar-count-overdue: #b91c1c;
    --calendar-count-today: #b45309;
    --calendar-count-upcoming: #6d28d9;
    --calendar-count-completed: #2e8b57;
    background: var(--chrome-bg);
    border: 1px solid var(--secondary);
    border-radius: 0.25rem;
    color: var(--chrome-fg);
    overflow: hidden;
    padding: 0.85rem;
  }

  .calendar-scope-selector {
    background: color-mix(in srgb, var(--chrome-bg) 88%, var(--primary));
    border: 1px solid var(--secondary);
    border-radius: 0.55rem;
    display: grid;
    gap: 0.25rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-bottom: 0.65rem;
    padding: 0.25rem;
  }

  .calendar-scope-selector .btn {
    border: 0;
    border-radius: 0.38rem;
    color: var(--chrome-fg);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .calendar-scope-selector .btn.active {
    background: var(--primary);
    box-shadow: 0 0.18rem 0.4rem color-mix(in srgb, var(--primary) 26%, transparent);
    color: var(--primary-fg, #fff);
  }

  .calendar-feed .fas,
  .calendar-todo-month .fas,
  .calendar-todo-agenda .fas {
    color: inherit;
  }

  .calendar-month-header {
    align-items: center;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--primary) 48%, #172033),
      color-mix(in srgb, var(--primary) 30%, #4c3f91)
    );
    border: 0;
    border-radius: 0.85rem;
    box-shadow: 0 0.35rem 0.9rem color-mix(in srgb, var(--primary) 24%, transparent);
    color: #fff;
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    min-height: 4.3rem;
    padding: 0.55rem 0.65rem;
  }

  .calendar-month-copy {
    min-width: 0;
    text-align: center;
  }

  .calendar-month-eyebrow {
    display: block;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    margin-bottom: 0.12rem;
    opacity: 0.78;
    text-transform: uppercase;
  }

  .calendar-month-title {
    align-items: center;
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }

  .calendar-month-title strong {
    font-size: 1rem;
    letter-spacing: 0.01em;
  }

  .calendar-month-title span {
    font-size: 0.66rem;
    margin-top: 0.2rem;
    opacity: 0.82;
  }

  .calendar-month-nav {
    align-items: center;
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.34);
    border-radius: 50%;
    color: #fff;
    display: inline-flex;
    flex: 0 0 auto;
    height: 2.1rem;
    justify-content: center;
    padding: 0;
    transition: background 120ms ease, transform 120ms ease;
    width: 2.1rem;
  }

  .calendar-month-nav:hover {
    background: rgba(255, 255, 255, 0.28);
    color: #fff;
    transform: scale(1.05);
  }

  .calendar-todo-weekdays,
  .calendar-todo-grid {
    display: grid;
    gap: 0.32rem;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .calendar-todo-weekdays {
    background: color-mix(in srgb, var(--chrome-bg) 82%, var(--primary));
    border-radius: 0.65rem;
    margin-bottom: 0.35rem;
    padding: 0.2rem 0.12rem;
  }

  .calendar-todo-weekdays span {
    color: var(--chrome-fg);
    font-size: 0.64rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 0.15rem 0;
    text-align: center;
    text-transform: uppercase;
  }

  .calendar-todo-day {
    align-items: flex-start;
    aspect-ratio: 1 / 1.04;
    background: var(--chrome-bg);
    border: 1px solid var(--chrome-muted);
    border-radius: 0.35rem;
    color: var(--chrome-fg);
    display: flex;
    font-size: 0.76rem;
    justify-content: flex-start;
    min-width: 0;
    padding: 0.3rem;
    position: relative;
    transition: background 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  }

  .calendar-todo-day:hover {
    background: color-mix(in srgb, var(--chrome-bg) 72%, var(--primary));
    box-shadow: 0 0.3rem 0.65rem rgba(0, 0, 0, 0.28);
    transform: translateY(-2px);
  }

  .calendar-todo-day.selected {
    background: color-mix(in srgb, var(--chrome-bg) 62%, var(--primary));
    border-color: var(--primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 18%, transparent);
  }

  .calendar-todo-day.calendar-day-drag-over {
    background: color-mix(in srgb, var(--chrome-bg) 55%, var(--primary));
    border-color: var(--primary);
    box-shadow: inset 0 0 0 2px var(--primary);
    transform: scale(1.04);
  }

  .calendar-todo-day.today {
    background: var(--chrome-bg);
    box-shadow: inset 0 0 0 2px var(--primary);
    font-weight: 700;
  }

  .calendar-todo-day.today .calendar-day-number {
    align-items: center;
    background: color-mix(in srgb, var(--primary) 48%, #172033);
    border-radius: 50%;
    box-shadow: 0 0.2rem 0.45rem color-mix(in srgb, var(--primary) 30%, transparent);
    color: #fff;
    display: inline-flex;
    height: 1.28rem;
    justify-content: center;
    width: 1.28rem;
  }

  .calendar-todo-day.outside {
    background: transparent;
    opacity: 0.32;
  }

  .calendar-day-number {
    line-height: 1.28rem;
  }

  .calendar-day-type-dots {
    bottom: 0.3rem;
    display: inline-flex;
    gap: 0.14rem;
    left: 0.28rem;
    position: absolute;
  }

  .calendar-type-dot {
    border: 1px solid var(--chrome-bg);
    border-radius: 50%;
    height: 0.42rem;
    width: 0.42rem;
  }

  .calendar-type-task,
  .calendar-legend-dot.task-dot {
    background: #6d28d9;
  }

  .calendar-type-experiment,
  .calendar-legend-dot.experiment-dot {
    background: #1677b8;
  }

  .calendar-type-resource,
  .calendar-legend-dot.resource-dot {
    background: #2e8b57;
  }

  .calendar-day-count {
    align-items: center;
    border: 2px solid var(--chrome-bg);
    border-radius: 50%;
    bottom: 0.22rem;
    box-shadow: 0 0.2rem 0.45rem rgba(31, 41, 55, 0.24);
    color: #fff;
    display: inline-flex;
    font-size: 0.65rem;
    font-weight: 800;
    height: 1.45rem;
    justify-content: center;
    line-height: 1;
    padding: 0;
    position: absolute;
    right: 0.22rem;
    width: 1.45rem;
  }

  .calendar-day-count-upcoming {
    background: var(--calendar-count-upcoming);
  }

  .calendar-day-count-today {
    background: var(--calendar-count-today);
  }

  .calendar-day-count-overdue {
    background: var(--calendar-count-overdue);
  }

  .calendar-day-count-completed {
    background: var(--calendar-count-completed);
  }

  .calendar-day-count-activity {
    background: color-mix(in srgb, var(--primary) 72%, #1677b8);
  }

  .calendar-legend {
    align-items: center;
    color: var(--chrome-muted);
    display: flex;
    flex-wrap: wrap;
    font-size: 0.66rem;
    gap: 0.58rem;
    justify-content: center;
    margin-top: 0.7rem;
  }

  .calendar-legend span {
    align-items: center;
    display: inline-flex;
    gap: 0.25rem;
  }

  .calendar-legend-dot {
    border: 2px solid var(--chrome-bg);
    border-radius: 50%;
    box-shadow: 0 0.1rem 0.3rem rgba(31, 41, 55, 0.22);
    display: inline-block;
    height: 0.8rem;
    width: 0.8rem;
  }

  .calendar-legend-dot.overdue-dot {
    background: var(--calendar-count-overdue);
  }

  .calendar-month-actions {
    background: var(--chrome-bg);
    border-top: 1px solid var(--secondary);
    border-radius: 0.25rem;
    flex-wrap: wrap;
    gap: 0.35rem;
    justify-content: center;
    margin-top: 0.7rem;
    padding: 0.45rem;
  }

  .calendar-month-actions .btn {
    margin-right: 0 !important;
  }

  .calendar-agenda-header {
    align-items: center;
    border-bottom: 1px solid var(--secondary);
    display: flex;
    justify-content: space-between;
    margin: -0.1rem 0 0.7rem;
    padding-bottom: 0.6rem;
  }

  .calendar-agenda-eyebrow {
    color: var(--chrome-muted);
    display: block;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .calendar-agenda-controls {
    background: color-mix(in srgb, var(--chrome-bg) 92%, var(--primary));
    border: 1px solid var(--secondary);
    border-radius: 0.55rem;
    padding: 0.55rem;
  }

  .calendar-agenda-controls .form-control,
  .calendar-agenda-controls .input-group-text {
    background: var(--chrome-bg);
    border-color: var(--secondary);
    color: var(--chrome-fg);
  }

  .calendar-activity-toggles .btn {
    border-color: var(--chrome-muted);
    color: var(--chrome-fg);
  }

  .calendar-activity-toggles .btn.active {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-fg, #fff);
  }

  .calendar-activity-group {
    background: color-mix(in srgb, var(--chrome-bg) 96%, var(--primary));
    border: 1px solid var(--secondary);
    border-radius: 0.55rem;
    margin-bottom: 0.55rem;
    overflow: hidden;
  }

  .calendar-activity-group > summary {
    align-items: center;
    background: color-mix(in srgb, var(--chrome-bg) 86%, var(--primary));
    color: var(--chrome-fg);
    cursor: pointer;
    display: flex;
    font-size: 0.8rem;
    font-weight: 700;
    list-style: none;
    padding: 0.55rem 0.65rem;
  }

  .calendar-activity-group > summary::-webkit-details-marker,
  .calendar-entity-summary::-webkit-details-marker {
    display: none;
  }

  .calendar-activity-group > summary::before,
  .calendar-entity-summary::before {
    content: '›';
    display: inline-block;
    font-size: 1rem;
    margin-right: 0.35rem;
    transform: rotate(0deg);
    transition: transform 120ms ease;
  }

  .calendar-activity-group[open] > summary::before,
  .calendar-entity-node details[open] > .calendar-entity-summary::before {
    transform: rotate(90deg);
  }

  .calendar-activity-tree {
    padding: 0.55rem;
  }

  .calendar-entity-list {
    padding: 0.45rem;
  }

  .calendar-entity-node {
    background: var(--chrome-bg);
    border: 1px solid var(--secondary);
    border-left: 3px solid #1677b8;
    border-radius: 0.4rem;
    margin-bottom: 0.4rem;
    overflow: hidden;
  }

  .calendar-activity-group-items .calendar-entity-node {
    border-left-color: #2e8b57;
  }

  .calendar-entity-summary {
    align-items: center;
    color: var(--chrome-fg);
    cursor: pointer;
    display: flex;
    font-size: 0.78rem;
    font-weight: 700;
    list-style: none;
    padding: 0.5rem 0.55rem;
  }

  .calendar-entity-summary a,
  .calendar-heading-node a {
    color: color-mix(in srgb, var(--primary) 72%, var(--chrome-fg));
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .calendar-entity-summary a {
    flex: 1 1 auto;
  }

  .calendar-entity-date {
    background: color-mix(in srgb, var(--chrome-bg) 78%, var(--primary));
    color: var(--chrome-fg);
    flex: 0 0 auto;
    font-size: 0.6rem;
  }

  .calendar-heading-tree {
    border-top: 1px solid var(--secondary);
    padding: 0.32rem 0.42rem 0.35rem;
  }

  .calendar-heading-node {
    align-items: center;
    color: var(--chrome-fg);
    display: flex;
    font-size: 0.75rem;
    min-height: 1.75rem;
    padding-bottom: 0.22rem;
    padding-right: 0.2rem;
    padding-top: 0.22rem;
  }

  .calendar-heading-node:hover {
    background: color-mix(in srgb, var(--chrome-bg) 80%, var(--primary));
    border-radius: 0.35rem;
  }

  .calendar-tree-branch {
    color: var(--chrome-muted);
    font-family: monospace;
    margin-right: 0.3rem;
  }

  .calendar-heading-date {
    color: var(--chrome-muted);
    flex: 0 0 auto;
    font-size: 0.58rem;
    padding-left: 0.35rem;
  }

  .calendar-heading-context {
    opacity: 0.78;
  }

  .calendar-heading-context .badge,
  .calendar-entity-no-headings {
    margin-left: 1.1rem;
  }

  .calendar-todo-entry {
    background: var(--chrome-bg);
    border-color: var(--secondary);
    border-left: 3px solid var(--primary);
    border-radius: 0.25rem !important;
    color: var(--chrome-fg);
    margin-bottom: 0.45rem;
  }

  .calendar-todo-entry.calendar-todo-overdue {
    background: var(--chrome-bg);
    border-color: var(--secondary);
    border-left-color: var(--side-panel-danger, #ff8a7a);
  }

  .calendar-todo-entry.calendar-todo-completed {
    border-left-color: var(--calendar-count-completed);
  }

  .calendar-task-drag-handle {
    color: var(--chrome-fg);
    cursor: grab;
    flex: 0 0 auto;
    line-height: 1;
    padding: 0.1rem 0.2rem;
  }

  .calendar-task-drag-handle:active {
    cursor: grabbing;
  }

  .calendar-todo-entry .fas {
    color: var(--primary);
  }

  .calendar-todo-entry.calendar-todo-overdue .fas {
    color: var(--side-panel-danger, #ff8a7a);
  }

  .calendar-todo-entry.calendar-todo-completed .calendar-completed-icon,
  .calendar-task-completed,
  .calendar-task-completed .fas {
    color: color-mix(in srgb, var(--calendar-count-completed) 70%, var(--chrome-fg));
  }

  .calendar-task-notes {
    white-space: pre-wrap;
  }

  .calendar-entry-source {
    color: var(--chrome-muted);
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
    color: var(--chrome-muted);
  }

  .calendar-todo-overdue .calendar-todo-deadline {
    color: var(--side-panel-danger, #ff8a7a);
  }

  .calendar-feed .text-muted,
  .calendar-todo-agenda .text-muted {
    color: var(--chrome-muted) !important;
  }

  .calendar-feed .text-warning {
    color: var(--side-panel-warning, #ffd166) !important;
  }

  .calendar-feed .btn-outline-primary,
  .calendar-month-actions .btn-outline-primary {
    border-color: var(--chrome-muted);
    color: var(--chrome-fg);
  }

  .calendar-feed .btn-outline-danger {
    border-color: var(--side-panel-danger, #ff8a7a);
    color: var(--side-panel-danger, #ff8a7a);
  }

  .min-width-0 {
    min-width: 0;
  }

  @keyframes calendar-highlight {
    50% {
      background-color: color-mix(in srgb, var(--warning) 25%, transparent);
    }
  }
</style>
