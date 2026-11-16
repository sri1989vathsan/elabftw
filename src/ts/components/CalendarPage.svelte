<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ApiC } from '../api';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';

  // The calendar page: the to-do tasks of the user (the deadline is when a task starts, its duration how long it lasts) in a day, week
  // or month view. A task block is moved by dragging it and made longer or shorter by dragging its lower edge; a click opens the task.
  // Events of other calendars (Google Calendar) come in through the 'elabftw:calendar-events' window event and are shown next to the tasks.

  type View = 'day' | 'week' | 'month';

  type CalEvent = {
    key: string;
    kind: 'task' | 'external';
    id: number;
    title: string;
    start: Date;
    end: Date;
    done: boolean;
    color: string;
    // the name of the calendar an external event comes from, and its id
    source?: string;
    calendar?: string;
    // the project of a task (0: none)
    project?: number;
    url?: string;
  };

  type RawTask = {
    id: number;
    body: string;
    deadline: string;
    duration_minutes?: number | null;
    completed_at: string | null;
    project_id?: number | null;
  };

  type Project = { id: number; name: string; parent_id: number | null };

  type GoogleCalendar = { id: string; summary: string; color: string; shown: boolean };

  type Placed = CalEvent & { top: number; height: number; lane: number; lanes: number };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();

  const HOUR = 48;
  const SNAP = 15;
  const VIEW_KEY = 'elabftw-calendar-page-view';
  const TASK_COLOR = '#5f6b7a';
  const PALETTE = ['#0c58ab', '#7c3aed', '#1a7f4b', '#b45309', '#be185d', '#0f766e', '#c2410c', '#4d7c0f'];
  const HIDDEN_KEY = 'elabftw-calendar-page-hidden-projects';
  const DAY_MS = 86400000;

  function startOfDay(date: Date): Date {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function addDays(date: Date, days: number): Date {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function mondayOf(date: Date): Date {
    const day = startOfDay(date);
    return addDays(day, -((day.getDay() + 6) % 7));
  }

  function isView(value: string | null): value is View {
    return value === 'day' || value === 'week' || value === 'month';
  }

  function savedView(): View {
    try {
      const stored = window.localStorage.getItem(VIEW_KEY);
      return isView(stored) ? stored : 'week';
    } catch {
      return 'week';
    }
  }

  let view: View = savedView();
  let cursor = startOfDay(new Date());
  let tasks: CalEvent[] = [];
  let external: CalEvent[] = [];
  let loading = true;
  let gridEl: HTMLDivElement | null = null;
  let columnsEl: HTMLDivElement | null = null;
  let now = new Date();
  let scrolledFor = '';
  let refreshTimer: number | undefined;
  let clockTimer: number | undefined;
  let drag: { key: string; mode: 'move' | 'resize'; start: Date; end: Date } | null = null;
  let suppressClick = false;
  let monthDay: Date | null = null;
  // the calendars of the page: the projects of the tasks (each can be shown or hidden, 0 is "No project"), and the Google calendars
  let projects: Project[] = [];
  let hiddenProjects: number[] = readHidden();
  let googleState: 'unknown' | 'off' | 'needs' | 'ready' = 'unknown';
  let googleCalendars: GoogleCalendar[] = [];

  function readHidden(): number[] {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? '[]') as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : [];
    } catch {
      return [];
    }
  }

  // the days of the view, and the range read from the server (a day more on each side)
  $: days = view === 'day'
    ? [startOfDay(cursor)]
    : view === 'week'
      ? Array.from({ length: 7 }, (_, index) => addDays(mondayOf(cursor), index))
      : Array.from({ length: 42 }, (_, index) => addDays(mondayOf(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), index));
  $: rangeKey = `${view}|${days[0].getTime()}|${days.length}`;
  $: if (rangeKey) void load();
  $: shownGoogle = new Set(googleCalendars.filter(calendar => calendar.shown).map(calendar => calendar.id));
  $: events = [
    ...tasks.filter(task => !hiddenProjects.includes(task.project ?? 0)),
    ...external.filter(event => googleState !== 'ready' || event.calendar === undefined || shownGoogle.has(event.calendar)),
  ].map(event => (event.kind === 'task' ? { ...event, color: projectColor(event.project ?? 0) } : event)).map(applyDrag);
  // the project calendars: a colour each, a project with a parent is written "Parent / Project"
  $: sorted = [...projects].sort((a, b) => a.id - b.id);
  $: projectName = (id: number): string => {
    const project = projects.find(item => item.id === id);
    if (!project) return t('No project');
    const parent = project.parent_id === null ? null : projects.find(item => item.id === project.parent_id);
    return parent ? `${parent.name} / ${project.name}` : project.name;
  };
  $: projectColor = (id: number): string => {
    const index = sorted.findIndex(item => item.id === id);
    return index < 0 ? TASK_COLOR : PALETTE[index % PALETTE.length];
  };
  // only the projects that have a task in the days shown are listed, the ones that are hidden stay listed
  $: usedProjects = [...new Set([...tasks.map(task => task.project ?? 0), ...hiddenProjects])]
    .sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : projectName(a).localeCompare(projectName(b))));
  $: columns = view === 'month' ? [] : days.map(day => place(events, day));
  $: byDay = view === 'month' ? groupByDay(events, days) : new Map<string, CalEvent[]>();
  $: title = periodLabel(view, cursor, days);
  $: nowTop = (now.getHours() + now.getMinutes() / 60) * HOUR;
  $: if (view !== 'month' && gridEl && scrolledFor !== rangeKey) {
    scrolledFor = rangeKey;
    const todayShown = days.some(day => sameDay(day, now));
    gridEl.scrollTop = Math.max(0, (todayShown ? now.getHours() - 1 : 7) * HOUR);
  }
  $: try { window.localStorage.setItem(VIEW_KEY, view); } catch { /* the view is then just not remembered */ }

  function applyDrag(event: CalEvent): CalEvent {
    return drag && drag.key === event.key ? { ...event, start: drag.start, end: drag.end } : event;
  }

  function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function dayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  function groupByDay(list: CalEvent[], shown: Date[]): Map<string, CalEvent[]> {
    const map = new Map<string, CalEvent[]>();
    for (const day of shown) {
      const from = day.getTime();
      const to = from + DAY_MS;
      map.set(dayKey(day), list.filter(event => event.start.getTime() < to && event.end.getTime() > from).sort((a, b) => a.start.getTime() - b.start.getTime()));
    }
    return map;
  }

  // The events of one day side by side where they overlap: a lane per overlapping event, the width shared by the lanes of the cluster.
  function place(list: CalEvent[], day: Date): Placed[] {
    const from = day.getTime();
    const to = from + DAY_MS;
    const items = list
      .filter(event => event.start.getTime() < to && event.end.getTime() > from)
      .sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
    const out: Placed[] = [];
    let cluster: Placed[] = [];
    let laneEnds: number[] = [];
    let clusterEnd = 0;
    const flush = (): void => {
      for (const item of cluster) item.lanes = laneEnds.length;
      out.push(...cluster);
      cluster = [];
      laneEnds = [];
    };
    for (const event of items) {
      const start = Math.max(event.start.getTime(), from);
      const end = Math.min(event.end.getTime(), to);
      if (cluster.length > 0 && start >= clusterEnd) flush();
      let lane = laneEnds.findIndex(laneEnd => laneEnd <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      clusterEnd = Math.max(clusterEnd, end);
      const top = (start - from) / 3600000 * HOUR;
      const height = Math.max(20, (end - start) / 3600000 * HOUR - 2);
      cluster.push({ ...event, top, height, lane, lanes: 1 });
    }
    flush();
    return out;
  }

  function periodLabel(mode: View, current: Date, shown: Date[]): string {
    if (mode === 'day') {
      return current.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (mode === 'month') {
      return current.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    const first = shown[0];
    const last = shown[shown.length - 1];
    const sameMonth = first.getMonth() === last.getMonth();
    const left = first.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    const right = last.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${left} – ${right}`;
  }

  function timeText(date: Date): string {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
  }

  async function load(): Promise<void> {
    const from = addDays(days[0], -1);
    const to = addDays(days[days.length - 1], 2);
    const params = new URLSearchParams({ calendar: '1', deadline_from: from.toISOString(), deadline_to: to.toISOString() });
    try {
      const raw = await ApiC.getJson(`${Model.Todolist}?${params.toString()}`) as RawTask[];
      tasks = raw.filter(task => task.deadline).map(task => {
        const start = new Date(task.deadline);
        const minutes = Number(task.duration_minutes) > 0 ? Number(task.duration_minutes) : 30;
        return {
          key: `task-${task.id}`,
          kind: 'task' as const,
          id: Number(task.id),
          title: task.body,
          start,
          end: new Date(start.getTime() + minutes * 60000),
          done: task.completed_at !== null,
          color: TASK_COLOR,
          project: task.project_id ?? 0,
          url: `projectmanagement.php?task=${task.id}`,
        };
      });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load the calendar.');
    } finally {
      loading = false;
    }
  }

  function toggleProject(id: number): void {
    hiddenProjects = hiddenProjects.includes(id) ? hiddenProjects.filter(value => value !== id) : [...hiddenProjects, id];
    try { window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenProjects)); } catch { /* not remembered */ }
  }

  function setAllProjects(on: boolean): void {
    hiddenProjects = on ? [] : usedProjects;
    try { window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenProjects)); } catch { /* not remembered */ }
  }

  // a Google calendar is shown or hidden by the sync (the same choice as in the panel of the to-dos)
  function toggleGoogle(calendar: GoogleCalendar): void {
    googleCalendars = googleCalendars.map(item => (item.id === calendar.id ? { ...item, shown: !item.shown } : item));
    window.dispatchEvent(new CustomEvent('elabftw:calendar-toggle', { detail: { id: calendar.id, on: !calendar.shown } }));
  }

  function connectGoogle(): void {
    window.dispatchEvent(new CustomEvent('elabftw:calendar-connect'));
  }

  function onGoogleList(event: Event): void {
    const detail = (event as CustomEvent<{ state: 'off' | 'needs' | 'ready'; calendars: GoogleCalendar[] }>).detail;
    googleState = detail?.state ?? 'off';
    googleCalendars = detail?.calendars ?? [];
  }

  async function loadProjects(): Promise<void> {
    try {
      projects = await ApiC.getJson(`${Model.TodolistProjects}?archived=0`) as Project[];
    } catch {
      projects = [];
    }
  }

  function go(direction: number): void {
    cursor = view === 'month'
      ? new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1)
      : addDays(cursor, direction * (view === 'week' ? 7 : 1));
  }

  function today(): void {
    cursor = startOfDay(new Date());
  }

  function openDay(day: Date): void {
    cursor = startOfDay(day);
    view = 'day';
  }

  // ---- dragging a task block: the block itself moves it (to another time, or another day in the week view), its lower edge changes
  // how long it lasts; both snap to 15 minutes and are saved when the mouse is let go
  function startDrag(pointer: PointerEvent, event: Placed, mode: 'move' | 'resize'): void {
    if (event.kind !== 'task' || pointer.button !== 0) return;
    const startX = pointer.clientX;
    const startY = pointer.clientY;
    const origin = { start: new Date(event.start), end: new Date(event.end) };
    const columnWidth = columnsEl && days.length > 0 ? columnsEl.clientWidth / days.length : 1;
    let moved = false;
    const move = (e: PointerEvent): void => {
      const dy = e.clientY - startY;
      const dx = e.clientX - startX;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const minutes = Math.round(dy / HOUR * 60 / SNAP) * SNAP;
      if (mode === 'resize') {
        const end = new Date(Math.max(origin.start.getTime() + SNAP * 60000, origin.end.getTime() + minutes * 60000));
        drag = { key: event.key, mode, start: origin.start, end };
        return;
      }
      const dayShift = view === 'week' ? Math.round(dx / columnWidth) : 0;
      const shiftMs = (dayShift * 24 * 60 + minutes) * 60000;
      const start = new Date(origin.start.getTime() + shiftMs);
      // a move to another day keeps the clock time (summer time must not shift the task by an hour)
      if (dayShift !== 0) {
        start.setTime(addDays(origin.start, dayShift).getTime() + minutes * 60000);
      }
      drag = { key: event.key, mode, start, end: new Date(start.getTime() + (origin.end.getTime() - origin.start.getTime())) };
    };
    const up = async (): Promise<void> => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const result = drag;
      drag = null;
      if (!moved || !result) return;
      suppressClick = true;
      window.setTimeout(() => { suppressClick = false; }, 0);
      try {
        const payload = result.mode === 'resize'
          ? { duration_minutes: Math.round((result.end.getTime() - result.start.getTime()) / 60000) }
          : { deadline: result.start.toISOString() };
        await ApiC.patch(`${Model.Todolist}/${event.id}`, { ...payload, notifOnSaved: 0 });
        window.dispatchEvent(new CustomEvent('todolist-changed'));
      } catch (error) {
        notify.error(error instanceof Error ? error.message : 'Could not save the change.');
      }
      await load();
    };
    pointer.preventDefault();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onLinkClick(event: MouseEvent): void {
    if (suppressClick) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onExternal(event: Event): void {
    const detail = (event as CustomEvent<{ events: Array<{ key: string; calendar?: string; title: string; start: string; end: string; color?: string; source?: string; url?: string }> }>).detail;
    external = (detail?.events ?? []).map(item => ({
      key: item.key,
      kind: 'external' as const,
      id: 0,
      title: item.title,
      start: new Date(item.start),
      end: new Date(item.end),
      done: false,
      color: item.color ?? '#7c3aed',
      source: item.source,
      calendar: item.calendar,
      url: item.url,
    }));
  }

  onMount(() => {
    window.addEventListener('todolist-changed', load);
    window.addEventListener('elabftw:calendar-events', onExternal);
    window.addEventListener('elabftw:calendar-list', onGoogleList);
    void loadProjects();
    // a request for the events of other calendars, for the days that are shown (answered by the sync, when it is on)
    window.dispatchEvent(new CustomEvent('elabftw:calendar-ready'));
    // refreshed while the page is on screen: tasks edited in a popup, by another person, in another tab
    refreshTimer = window.setInterval(() => {
      if (!document.hidden && drag === null) void load();
    }, 20000);
    clockTimer = window.setInterval(() => { now = new Date(); }, 30000);
  });

  onDestroy(() => {
    window.removeEventListener('todolist-changed', load);
    window.removeEventListener('elabftw:calendar-events', onExternal);
    window.removeEventListener('elabftw:calendar-list', onGoogleList);
    window.clearInterval(refreshTimer);
    window.clearInterval(clockTimer);
  });

  // what the sync needs to know to ask for the right days
  $: if (typeof window !== 'undefined' && days.length > 0) {
    window.dispatchEvent(new CustomEvent('elabftw:calendar-range', { detail: { from: addDays(days[0], -1).toISOString(), to: addDays(days[days.length - 1], 2).toISOString() } }));
  }
</script>

<div class='cal-page'>
  <div class='cal-toolbar'>
    <div class='cal-nav'>
      <button type='button' class='btn btn-secondary btn-sm' on:click={today}>{t('Today')}</button>
      <button type='button' class='btn btn-ghost btn-sm' aria-label={t('Previous')} on:click={() => go(-1)}><i class='fas fa-chevron-left' aria-hidden='true'></i></button>
      <button type='button' class='btn btn-ghost btn-sm' aria-label={t('Next')} on:click={() => go(1)}><i class='fas fa-chevron-right' aria-hidden='true'></i></button>
      <h2 class='cal-title'>{title}</h2>
    </div>
    <div class='cal-views' role='group' aria-label={t('View')}>
      {#each ['day', 'week', 'month'] as mode (mode)}
        <button type='button' class='btn btn-sm' class:btn-primary={view === mode} class:btn-ghost={view !== mode} aria-pressed={view === mode} on:click={() => { view = mode as View; }}>
          {mode === 'day' ? t('Day') : mode === 'week' ? t('Week') : t('Month')}
        </button>
      {/each}
    </div>
  </div>

  <div class='cal-sources'>
    <div class='cal-sources-row'>
      <span class='cal-sources-title'>{t('My tasks')}</span>
      {#each usedProjects as id (id)}
        <label class='cal-source' class:cal-off={hiddenProjects.includes(id)} style='--c:{projectColor(id)}'>
          <input type='checkbox' checked={!hiddenProjects.includes(id)} on:change={() => toggleProject(id)} />
          <span class='cal-dot'></span>{id === 0 ? t('No project') : projectName(id)}
        </label>
      {:else}
        <span class='pm-muted small'>{t('No tasks in these days')}</span>
      {/each}
      {#if usedProjects.length > 1}
        <button type='button' class='btn btn-ghost btn-sm' on:click={() => setAllProjects(true)}>{t('All')}</button>
        <button type='button' class='btn btn-ghost btn-sm' on:click={() => setAllProjects(false)}>{t('None')}</button>
      {/if}
    </div>
    {#if googleState !== 'unknown'}
      <div class='cal-sources-row'>
        <span class='cal-sources-title'>{t('Google calendars')}</span>
        {#if googleState === 'ready'}
          {#each googleCalendars as calendar (calendar.id)}
            <label class='cal-source' class:cal-off={!calendar.shown} style='--c:{calendar.color}'>
              <input type='checkbox' checked={calendar.shown} on:change={() => toggleGoogle(calendar)} />
              <span class='cal-dot'></span>{calendar.summary}
            </label>
          {/each}
        {:else}
          <button type='button' class='btn btn-secondary btn-sm' on:click={connectGoogle}>{googleState === 'needs' ? t('Show my Google calendars') : t('Connect Google')}</button>
          <span class='pm-muted small'>{googleState === 'needs' ? t('Allow Google Calendar once to choose which calendars are shown here.') : t('Connect your Google account to show its calendars here.')}</span>
        {/if}
      </div>
    {/if}
  </div>

  {#if view === 'month'}
    <div class='cal-month'>
      {#each days.slice(0, 7) as day (day.getTime())}
        <div class='cal-month-head'>{day.toLocaleDateString(undefined, { weekday: 'short' })}</div>
      {/each}
      {#each days as day (day.getTime())}
        {@const list = byDay.get(dayKey(day)) ?? []}
        <div class='cal-month-cell' class:cal-other={day.getMonth() !== cursor.getMonth()} class:cal-today={sameDay(day, now)}>
          <button type='button' class='cal-month-num' on:click={() => openDay(day)} title={t('Open this day')}>{day.getDate()}</button>
          {#each list.slice(0, 3) as event (event.key)}
            <a class='cal-chip' class:cal-done={event.done} style='--c:{event.color}' href={event.url ?? '#'} data-open-task-popup={event.kind === 'task' ? event.id : undefined} title={event.title} on:click={onLinkClick}>
              <span class='cal-chip-time'>{timeText(event.start)}</span> {event.title}
            </a>
          {/each}
          {#if list.length > 3}
            <button type='button' class='cal-more' on:click={() => openDay(day)}>+{list.length - 3} {t('more')}</button>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class='cal-head' style='--n:{days.length}'>
      <div class='cal-gutter'></div>
      {#each days as day (day.getTime())}
        <button type='button' class='cal-day-head' class:cal-today={sameDay(day, now)} on:click={() => openDay(day)}>
          <span class='cal-dow'>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
          <span class='cal-dom'>{day.getDate()}</span>
        </button>
      {/each}
    </div>
    <div class='cal-grid' bind:this={gridEl}>
      <div class='cal-body' style='height:{HOUR * 24}px'>
        <div class='cal-hours'>
          {#each Array.from({ length: 24 }, (_, hour) => hour) as hour (hour)}
            <div class='cal-hour' style='top:{hour * HOUR}px'><span>{hour === 0 ? '' : hourLabel(hour)}</span></div>
          {/each}
        </div>
        <div class='cal-columns' bind:this={columnsEl} style='--n:{days.length}'>
          {#each Array.from({ length: 24 }, (_, hour) => hour) as hour (hour)}
            <div class='cal-line' style='top:{hour * HOUR}px'></div>
          {/each}
          {#each days as day, index (day.getTime())}
            <div class='cal-col' class:cal-today={sameDay(day, now)} style='left:{index / days.length * 100}%;width:{100 / days.length}%'>
              {#each columns[index] ?? [] as event (event.key)}
                <a
                  class='cal-ev'
                  class:cal-done={event.done}
                  class:cal-dragging={drag !== null && drag.key === event.key}
                  class:cal-external={event.kind === 'external'}
                  style='top:{event.top}px;height:{event.height}px;left:{event.lane / event.lanes * 100}%;width:{100 / event.lanes}%;--c:{event.color}'
                  href={event.url ?? '#'}
                  data-open-task-popup={event.kind === 'task' ? event.id : undefined}
                  draggable='false'
                  title={`${timeText(event.start)}–${timeText(event.end)}  ${event.title}${event.source ? `  (${event.source})` : ''}`}
                  on:pointerdown={(pointer) => startDrag(pointer, event, 'move')}
                  on:click={onLinkClick}
                >
                  <span class='cal-ev-time'>{timeText(event.start)}–{timeText(event.end)}</span>
                  <span class='cal-ev-title'>{event.title}</span>
                  {#if event.kind === 'task'}
                    <span class='cal-resize' role='presentation' title={t('Drag to change how long it takes')} on:pointerdown|stopPropagation={(pointer) => startDrag(pointer, event, 'resize')}></span>
                  {/if}
                </a>
              {/each}
              {#if sameDay(day, now)}
                <div class='cal-now' style='top:{nowTop}px'></div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
  {#if loading}<p class='pm-muted small mt-2'>{t('Loading')}…</p>{/if}
</div>

<style>
  .cal-page {
    --cal-line: color-mix(in srgb, var(--secondary, #888) 28%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .cal-toolbar {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: space-between;
  }

  .cal-nav {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .cal-title {
    font-size: 1.15rem;
    margin: 0 0 0 0.5rem;
  }

  .cal-views {
    display: flex;
    gap: 0.25rem;
  }

  .cal-sources {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .cal-sources-row {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.6rem;
  }

  .cal-sources-title {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .cal-source {
    align-items: center;
    border: 1px solid var(--c);
    border-radius: 999px;
    cursor: pointer;
    display: inline-flex;
    font-size: 0.78rem;
    gap: 0.3rem;
    margin: 0;
    padding: 0.05rem 0.55rem 0.05rem 0.4rem;
  }

  .cal-source input {
    margin: 0;
  }

  .cal-source.cal-off {
    border-style: dashed;
    opacity: 0.55;
  }

  .cal-dot {
    background: var(--c);
    border-radius: 50%;
    display: inline-block;
    height: 0.6rem;
    width: 0.6rem;
  }

  .cal-head {
    display: grid;
    grid-template-columns: 3.2rem repeat(var(--n), minmax(0, 1fr));
  }

  .cal-day-head {
    background: none;
    border: 0;
    border-left: 1px solid var(--cal-line);
    color: inherit;
    cursor: pointer;
    padding: 0.25rem 0;
    text-align: center;
  }

  .cal-dow {
    display: block;
    font-size: 0.72rem;
    text-transform: uppercase;
  }

  .cal-dom {
    display: inline-block;
    font-size: 1.1rem;
    min-width: 1.9rem;
    padding: 0.1rem 0;
  }

  .cal-day-head.cal-today .cal-dom {
    background: var(--primary);
    border-radius: 999px;
    color: #fff;
  }

  .cal-grid {
    border: 1px solid var(--cal-line);
    border-radius: 0.4rem;
    max-height: 68vh;
    overflow-y: auto;
  }

  .cal-body {
    display: grid;
    grid-template-columns: 3.2rem minmax(0, 1fr);
    position: relative;
  }

  .cal-hours,
  .cal-columns {
    position: relative;
  }

  .cal-hour {
    color: var(--secondary, #888);
    font-size: 0.68rem;
    height: 0;
    position: absolute;
    right: 0.35rem;
    text-align: right;
  }

  .cal-hour span {
    position: relative;
    top: -0.45em;
  }

  .cal-line {
    border-top: 1px solid var(--cal-line);
    left: 0;
    position: absolute;
    right: 0;
  }

  .cal-col {
    border-left: 1px solid var(--cal-line);
    bottom: 0;
    position: absolute;
    top: 0;
  }

  .cal-col.cal-today {
    background: color-mix(in srgb, var(--primary) 6%, transparent);
  }

  .cal-now {
    border-top: 2px solid #d93025;
    left: 0;
    pointer-events: none;
    position: absolute;
    right: 0;
    z-index: 3;
  }

  .cal-ev {
    background: color-mix(in srgb, var(--c) 18%, var(--mainbackground, #fff));
    border: 1px solid var(--c);
    border-left-width: 4px;
    border-radius: 0.3rem;
    box-sizing: border-box;
    color: inherit;
    cursor: grab;
    display: block;
    font-size: 0.74rem;
    line-height: 1.2;
    overflow: hidden;
    padding: 0.1rem 0.3rem 0.35rem;
    position: absolute;
    text-decoration: none;
    touch-action: none;
    user-select: none;
    z-index: 2;
  }

  .cal-ev:hover {
    color: inherit;
    text-decoration: none;
    z-index: 4;
  }

  .cal-ev.cal-dragging {
    box-shadow: 0 0.25rem 0.8rem rgba(0, 0, 0, 0.3);
    cursor: grabbing;
    z-index: 5;
  }

  .cal-ev.cal-external {
    cursor: default;
    opacity: 0.9;
  }

  .cal-ev.cal-done,
  .cal-chip.cal-done {
    opacity: 0.55;
    text-decoration: line-through;
  }

  .cal-ev-time {
    display: block;
    font-size: 0.66rem;
    opacity: 0.8;
  }

  .cal-ev-title {
    display: block;
    font-weight: 600;
  }

  .cal-resize {
    bottom: 0;
    cursor: ns-resize;
    height: 0.4rem;
    left: 0;
    position: absolute;
    right: 0;
  }

  .cal-resize::after {
    background: var(--c);
    border-radius: 2px;
    bottom: 1px;
    content: '';
    height: 2px;
    left: 40%;
    opacity: 0.6;
    position: absolute;
    right: 40%;
  }

  .cal-month {
    border-left: 1px solid var(--cal-line);
    border-top: 1px solid var(--cal-line);
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .cal-month-head {
    border-bottom: 1px solid var(--cal-line);
    border-right: 1px solid var(--cal-line);
    font-size: 0.72rem;
    padding: 0.2rem;
    text-align: center;
    text-transform: uppercase;
  }

  .cal-month-cell {
    border-bottom: 1px solid var(--cal-line);
    border-right: 1px solid var(--cal-line);
    min-height: 6.5rem;
    min-width: 0;
    padding: 0.15rem 0.2rem;
  }

  .cal-month-cell.cal-other {
    opacity: 0.5;
  }

  .cal-month-cell.cal-today {
    background: color-mix(in srgb, var(--primary) 8%, transparent);
  }

  .cal-month-num {
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0 0.2rem;
  }

  .cal-chip {
    background: color-mix(in srgb, var(--c) 18%, var(--mainbackground, #fff));
    border-left: 3px solid var(--c);
    border-radius: 0.25rem;
    color: inherit;
    display: block;
    font-size: 0.72rem;
    margin-top: 2px;
    overflow: hidden;
    padding: 0 0.25rem;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cal-chip:hover {
    color: inherit;
    text-decoration: none;
  }

  .cal-chip-time {
    opacity: 0.75;
  }

  .cal-more {
    background: none;
    border: 0;
    color: var(--primary);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0 0.25rem;
  }
</style>
