<script lang='ts'>
  /**
   * @author Nicolas CARPi / Deltablot
   * @copyright 2026 Nicolas CARPi
   * @see https://www.elabftw.net Official website
   * @license AGPL-3.0
   * @package elabftw
   */
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';
  import { toRelative } from '../misc';

  type Todo = {
    id: number;
    body: string;
    notes: string | null;
    deadline: string | null;
    reminder_minutes: number | null;
    creation_time: string;
    completed_at: string | null;
    ordering: number;
  };

  type UnfinishedStep = {
    id: number;
    body: string;
    deadline: string | null;
  };

  type UnfinishedEntity = {
    id: number;
    title: string;
    steps: UnfinishedStep[];
  };

  type UnfinishedResponse = {
    experiments: UnfinishedEntity[];
    items: UnfinishedEntity[];
  };

  type SidebarEntry = {
    key: string;
    source: 'todo' | 'step';
    id: number;
    body: string;
    deadline: string | null;
    notes: string | null;
    creationTime: string | null;
    ordering: number | null;
    entityId?: number;
    entityTitle?: string;
    entityType?: 'experiments' | 'items';
  };

  type DueGroup = {
    key: string;
    label: string;
    entries: SidebarEntry[];
  };

  type CompletedGroup = {
    key: string;
    label: string;
    items: Todo[];
  };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();
  const initialDeadline = new Date();
  const initialDeadlineDate = [
    initialDeadline.getFullYear(),
    String(initialDeadline.getMonth() + 1).padStart(2, '0'),
    String(initialDeadline.getDate()).padStart(2, '0'),
  ].join('-');
  const initialDeadlineTime = [
    String(initialDeadline.getHours()).padStart(2, '0'),
    String(initialDeadline.getMinutes()).padStart(2, '0'),
  ].join(':');
  const quarterHourOptions = Array.from({ length: 96 }, (_, index) => {
    const hours = String(Math.floor(index / 4)).padStart(2, '0');
    const minutes = String((index % 4) * 15).padStart(2, '0');
    return `${hours}:${minutes}`;
  });
  const timeOptions = quarterHourOptions.includes(initialDeadlineTime)
    ? quarterHourOptions
    : [...quarterHourOptions, initialDeadlineTime].sort();
  let locale = 'en-gb';
  let items: Todo[] = [];
  let completedItems: Todo[] = [];
  let unfinished: UnfinishedResponse = { experiments: [], items: [] };
  let entries: SidebarEntry[] = [];
  let dueGroups: DueGroup[] = [];
  let completedGroups: CompletedGroup[] = [];
  let completedWindow = '7';
  let completedLoaded = false;
  let loadingCompleted = false;
  let draft = '';
  let draftNotes = '';
  let deadlineDate = initialDeadlineDate;
  let deadlineTime = initialDeadlineTime;
  let reminderChoice = '60';
  let customReminder = 120;
  let reminderDate = '';
  let reminderTime = '';
  let editingId: number | null = null;
  let editTitle = '';
  let editNotes = '';
  let editDeadlineDate = '';
  let editDeadlineTime = '';
  let editReminderChoice = '60';
  let editCustomReminder = 120;
  let editReminderDate = '';
  let editReminderTime = '';
  let draggedTaskId: number | null = null;
  let dragOverKey = '';
  let loading = true;
  const pageSize = 100;
  let nextOffset = pageSize;
  let canLoadMore = false;
  let loadingMore = false;

  $: entries = [
    ...items.map(item => ({
      key: `todo-${item.id}`,
      source: 'todo' as const,
      id: Number(item.id),
      body: item.body,
      deadline: item.deadline,
      notes: item.notes,
      creationTime: item.creation_time,
      ordering: Number(item.ordering),
    })),
    ...(['experiments', 'items'] as const).flatMap(entityType => (
      unfinished[entityType].flatMap(entity => (
        entity.steps.map(step => ({
          key: `step-${entityType}-${step.id}`,
          source: 'step' as const,
          id: Number(step.id),
          body: step.body,
          deadline: step.deadline,
          notes: null,
          creationTime: null,
          ordering: null,
          entityId: Number(entity.id),
          entityTitle: entity.title,
          entityType,
        }))
      ))
    )),
  ];
  $: dueGroups = buildDueGroups(entries);
  $: completedGroups = buildCompletedGroups(completedItems);

  function dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function groupLabel(key: string, date?: Date): string {
    if (key === 'overdue') return t('Overdue');
    if (key === 'today') return t('Today');
    if (key === 'tomorrow') return t('Tomorrow');
    if (key === 'undated') return t('No due date');
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  function buildDueGroups(allEntries: SidebarEntry[]): DueGroup[] {
    const now = new Date();
    const today = dateKey(now);
    const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrow = dateKey(tomorrowDate);
    const grouped = new Map<string, { date?: Date; entries: SidebarEntry[] }>();

    [...allEntries]
      .sort((a, b) => {
        if (a.source === 'todo' && b.source === 'todo') {
          return (a.ordering ?? 0) - (b.ordering ?? 0);
        }
        if (a.deadline === null && b.deadline === null) {
          return (a.creationTime ?? '').localeCompare(b.creationTime ?? '');
        }
        if (a.deadline === null) return 1;
        if (b.deadline === null) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      })
      .forEach(entry => {
        let key = 'undated';
        let date: Date | undefined;
        if (entry.deadline !== null) {
          date = new Date(entry.deadline);
          const entryDate = dateKey(date);
          if (date.getTime() < now.getTime()) {
            key = 'overdue';
          } else if (entryDate === today) {
            key = 'today';
          } else if (entryDate === tomorrow) {
            key = 'tomorrow';
          } else {
            key = entryDate;
          }
        }
        const group = grouped.get(key) ?? { date, entries: [] };
        group.entries.push(entry);
        grouped.set(key, group);
      });

    const rank = (key: string): number => {
      if (key === 'overdue') return 0;
      if (key === 'today') return 1;
      if (key === 'tomorrow') return 2;
      if (key === 'undated') return Number.MAX_SAFE_INTEGER;
      return new Date(`${key}T00:00:00`).getTime();
    };

    return Array.from(grouped.entries())
      .sort(([left], [right]) => rank(left) - rank(right))
      .map(([key, group]) => ({
        key,
        label: groupLabel(key, group.date),
        entries: group.entries,
      }));
  }

  function completedDateLabel(value: string): string {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));
  }

  function buildCompletedGroups(completed: Todo[]): CompletedGroup[] {
    const groups = new Map<string, CompletedGroup>();
    completed.forEach(item => {
      if (!item.completed_at) return;
      const completedDate = new Date(item.completed_at);
      const key = dateKey(completedDate);
      const group = groups.get(key) ?? {
        key,
        label: completedDateLabel(item.completed_at),
        items: [],
      };
      group.items.push(item);
      groups.set(key, group);
    });
    return Array.from(groups.values()).sort((left, right) => right.key.localeCompare(left.key));
  }

  async function loadCompleted(): Promise<void> {
    loadingCompleted = true;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(completedWindow, 10));
    completedItems = await ApiC.getJson(
      `${Model.Todolist}?completed=1&completed_since=${encodeURIComponent(since.toISOString())}&limit=100`,
    ) as Todo[];
    completedLoaded = true;
    loadingCompleted = false;
  }

  function toggleCompletedHistory(event: Event): void {
    if ((event.currentTarget as HTMLDetailsElement).open && !completedLoaded) {
      void loadCompleted();
    }
  }

  async function openFullHistory(event: MouseEvent): Promise<void> {
    event.preventDefault();
    const historyWindow = window.open('', 'elabftw-completed-tasks', 'width=840,height=760,resizable=yes,scrollbars=yes');
    if (!historyWindow) {
      notify.error('Allow pop-up windows to view the full completed-task history.');
      return;
    }

    const doc = historyWindow.document;
    doc.title = 'Completed tasks';
    doc.body.replaceChildren();
    const style = doc.createElement('style');
    style.textContent = `
      body { background:#f7f9fa; color:#263238; font:15px/1.45 system-ui,sans-serif; margin:0; padding:2rem; }
      main { margin:auto; max-width:760px; }
      h1 { font-size:1.6rem; margin:0 0 .35rem; }
      h2 { border-bottom:1px solid #ccd5da; font-size:1rem; margin:1.5rem 0 .5rem; padding-bottom:.35rem; }
      article { background:#fff; border:1px solid #d7dfe3; border-radius:6px; margin:.45rem 0; padding:.7rem .8rem; }
      .meta { color:#5f6f76; font-size:.82rem; margin-top:.25rem; }
      button { background:#167d8d; border:0; border-radius:5px; color:#fff; cursor:pointer; margin-top:1rem; padding:.55rem .8rem; }
      button:disabled { cursor:wait; opacity:.65; }
      .status { color:#5f6f76; }
    `;
    doc.head.appendChild(style);
    const main = doc.createElement('main');
    const heading = doc.createElement('h1');
    heading.textContent = 'Completed tasks';
    const intro = doc.createElement('p');
    intro.className = 'status';
    intro.textContent = 'All completed tasks, newest first. Older entries load in pages.';
    const list = doc.createElement('div');
    const loadMore = doc.createElement('button');
    loadMore.type = 'button';
    loadMore.textContent = 'Load older tasks';
    main.append(heading, intro, list, loadMore);
    doc.body.appendChild(main);

    let offset = 0;
    let lastDate = '';
    const pageSize = 100;
    const loadPage = async (): Promise<void> => {
      loadMore.disabled = true;
      loadMore.textContent = 'Loading…';
      try {
        const page = await ApiC.getJson(
          `${Model.Todolist}?completed=1&limit=${pageSize}&offset=${offset}`,
        ) as Todo[];
        page.forEach(item => {
          if (!item.completed_at) return;
          const key = dateKey(new Date(item.completed_at));
          if (key !== lastDate) {
            const dateHeading = doc.createElement('h2');
            dateHeading.textContent = completedDateLabel(item.completed_at);
            list.appendChild(dateHeading);
            lastDate = key;
          }
          const task = doc.createElement('article');
          const title = doc.createElement('div');
          title.textContent = item.body;
          const meta = doc.createElement('div');
          meta.className = 'meta';
          meta.textContent = `Finished ${formatDeadline(item.completed_at)}`;
          task.append(title, meta);
          list.appendChild(task);
        });
        offset += page.length;
        loadMore.hidden = page.length < pageSize;
        if (offset === 0) intro.textContent = 'No completed tasks yet.';
      } catch {
        intro.textContent = 'The completed-task history could not be loaded.';
      } finally {
        loadMore.disabled = false;
        loadMore.textContent = 'Load older tasks';
      }
    };
    loadMore.addEventListener('click', () => void loadPage());
    await loadPage();
  }

  function getReminderMinutes(
    choice: string,
    custom: number,
    deadline: Date,
    specificDate: string,
    specificTime: string,
  ): number | null {
    if (choice === 'none') return null;
    if (choice === 'specific') {
      if (!specificDate || !specificTime) {
        throw new Error('Choose both a reminder date and time.');
      }
      const reminder = new Date(`${specificDate}T${specificTime}`);
      if (Number.isNaN(reminder.getTime())) {
        throw new Error('Enter a valid reminder date and time.');
      }
      const minutes = Math.round((deadline.getTime() - reminder.getTime()) / 60000);
      if (minutes < 0) {
        throw new Error('The reminder must be at or before the task deadline.');
      }
      if (minutes > 10080) {
        throw new Error('The reminder can be at most one week before the task deadline.');
      }
      return minutes;
    }
    if (choice === 'custom') {
      return Math.max(0, Math.min(10080, Math.round(custom)));
    }
    return parseInt(choice, 10);
  }

  function setEditReminder(minutes: number | null, deadline: Date | null): void {
    const presets = new Set([0, 15, 60, 1440, 10080]);
    editReminderChoice = minutes === null
      ? 'none'
      : (presets.has(Number(minutes)) ? String(minutes) : 'specific');
    editCustomReminder = minutes ?? 120;
    editReminderDate = '';
    editReminderTime = '';
    if (minutes !== null && deadline !== null) {
      const reminder = toLocalInput(new Date(deadline.getTime() - Number(minutes) * 60000));
      editReminderDate = reminder.slice(0, 10);
      editReminderTime = reminder.slice(11, 16);
    }
  }

  function toLocalInput(date: Date): string {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
  }

  function initializeSpecificReminder(editing = false): void {
    const date = editing ? editDeadlineDate : deadlineDate;
    const time = editing ? editDeadlineTime : deadlineTime;
    if (!date || !time) return;
    const reminder = toLocalInput(new Date(new Date(`${date}T${time}`).getTime() - 60 * 60000));
    if (editing) {
      if (!editReminderDate) editReminderDate = reminder.slice(0, 10);
      if (!editReminderTime) editReminderTime = reminder.slice(11, 16);
      return;
    }
    if (!reminderDate) reminderDate = reminder.slice(0, 10);
    if (!reminderTime) reminderTime = reminder.slice(11, 16);
  }

  function startEditing(entry: SidebarEntry): void {
    if (entry.source !== 'todo') return;
    const task = items.find(item => Number(item.id) === entry.id);
    if (!task) return;
    editingId = entry.id;
    editTitle = task.body;
    editNotes = task.notes ?? '';
    if (task.deadline) {
      const deadline = toLocalInput(new Date(task.deadline));
      editDeadlineDate = deadline.slice(0, 10);
      editDeadlineTime = deadline.slice(11, 16);
    } else {
      editDeadlineDate = '';
      editDeadlineTime = '';
    }
    setEditReminder(task.reminder_minutes, task.deadline ? new Date(task.deadline) : null);
  }

  async function saveEditing(id: number): Promise<void> {
    const content = editTitle.trim();
    if (!content) {
      notify.error('Enter a task title.');
      return;
    }
    const hasDeadline = Boolean(editDeadlineDate || editDeadlineTime);
    if (hasDeadline && (!editDeadlineDate || !editDeadlineTime)) {
      notify.error('Enter both a deadline date and time, or clear both.');
      return;
    }
    const deadline = hasDeadline ? new Date(`${editDeadlineDate}T${editDeadlineTime}`) : null;
    if (deadline !== null && Number.isNaN(deadline.getTime())) {
      notify.error('Enter a valid deadline date and time.');
      return;
    }
    let reminderMinutes: number | null = null;
    try {
      reminderMinutes = deadline === null
        ? null
        : getReminderMinutes(
          editReminderChoice,
          editCustomReminder,
          deadline,
          editReminderDate,
          editReminderTime,
        );
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Enter a valid reminder.');
      return;
    }
    await ApiC.patch(`${Model.Todolist}/${id}`, {
      content,
      notes: editNotes.trim() || null,
      deadline: deadline?.toISOString() ?? null,
      reminder_minutes: reminderMinutes,
    });
    editingId = null;
    await load();
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }

  async function create(): Promise<void> {
    const content = draft.trim();
    if (!content) return;
    const hasDeadline = Boolean(deadlineDate || deadlineTime);
    if (hasDeadline && (!deadlineDate || !deadlineTime)) {
      notify.error('Enter a valid deadline date and time.');
      return;
    }
    const deadline = hasDeadline ? new Date(`${deadlineDate}T${deadlineTime}`) : null;
    if (deadline !== null && Number.isNaN(deadline.getTime())) {
      notify.error('Enter a valid deadline date and time.');
      return;
    }

    let reminderMinutes: number | null = null;
    try {
      reminderMinutes = deadline === null
        ? null
        : getReminderMinutes(reminderChoice, customReminder, deadline, reminderDate, reminderTime);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Enter a valid reminder.');
      return;
    }
    await ApiC.post(Model.Todolist, {
      notifOnSaved: 0,
      content,
      notes: draftNotes.trim() || null,
      deadline: deadline?.toISOString() ?? null,
      reminder_minutes: reminderMinutes,
    });
    draft = '';
    draftNotes = '';
    reminderChoice = '60';
    customReminder = 120;
    reminderDate = '';
    reminderTime = '';
    await load();
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }

  async function complete(id: number): Promise<void> {
    await ApiC.patch(`${Model.Todolist}/${id}`, { completed: true });
    items = items.filter(item => Number(item.id) !== id);
    if (completedLoaded) await loadCompleted();
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }

  async function restore(id: number): Promise<void> {
    await ApiC.patch(`${Model.Todolist}/${id}`, { completed: false });
    completedItems = completedItems.filter(item => Number(item.id) !== id);
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }

  async function destroyCompleted(id: number): Promise<void> {
    await ApiC.delete(`${Model.Todolist}/${id}`);
    completedItems = completedItems.filter(item => Number(item.id) !== id);
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }

  async function load(): Promise<void> {
    loading = true;
    const teamScope = localStorage.getItem(`${Model.Todolist}StepsShowTeam`) === '1';
    const [todoResponse, unfinishedResponse] = await Promise.all([
      ApiC.getJson(`${Model.Todolist}?limit=${pageSize}&offset=0`) as Promise<Todo[]>,
      ApiC.getJson(`unfinished_steps?scope=${teamScope ? 'team' : 'user'}&limit=${pageSize}&offset=0`) as Promise<UnfinishedResponse>,
    ]);
    items = todoResponse;
    unfinished = unfinishedResponse;
    nextOffset = pageSize;
    canLoadMore = todoResponse.length === pageSize
      || unfinishedResponse.experiments.length === pageSize
      || unfinishedResponse.items.length === pageSize;
    loading = false;
  }

  async function loadMore(): Promise<void> {
    loadingMore = true;
    const teamScope = localStorage.getItem(`${Model.Todolist}StepsShowTeam`) === '1';
    const [todos, steps] = await Promise.all([
      ApiC.getJson(`${Model.Todolist}?limit=${pageSize}&offset=${nextOffset}`) as Promise<Todo[]>,
      ApiC.getJson(`unfinished_steps?scope=${teamScope ? 'team' : 'user'}&limit=${pageSize}&offset=${nextOffset}`) as Promise<UnfinishedResponse>,
    ]);
    items = [...items, ...todos];
    unfinished = {
      experiments: [...unfinished.experiments, ...steps.experiments],
      items: [...unfinished.items, ...steps.items],
    };
    nextOffset += pageSize;
    canLoadMore = todos.length === pageSize
      || steps.experiments.length === pageSize
      || steps.items.length === pageSize;
    loadingMore = false;
  }

  function formatDeadline(value: string): string {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  function isOverdue(entry: SidebarEntry): boolean {
    return entry.deadline !== null && new Date(entry.deadline).getTime() < Date.now();
  }

  function relative(date: string): string {
    return toRelative(date, locale);
  }

  function entityPage(entry: SidebarEntry): string {
    return entry.entityType === 'items' ? 'database.php' : 'experiments.php';
  }

  function startTaskDrag(event: DragEvent, id: number): void {
    draggedTaskId = id;
    event.dataTransfer?.setData('text/plain', String(id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function allowTaskDrop(event: DragEvent, key: string): void {
    if (draggedTaskId === null) return;
    event.preventDefault();
    dragOverKey = key;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function finishTaskDrag(): void {
    draggedTaskId = null;
    dragOverKey = '';
  }

  function deadlineForDate(task: Todo, targetDate: string | null): string | null {
    if (targetDate === null) return null;
    const source = task.deadline ? new Date(task.deadline) : new Date();
    const hours = String(source.getHours()).padStart(2, '0');
    const minutes = String(source.getMinutes()).padStart(2, '0');
    return new Date(`${targetDate}T${hours}:${minutes}`).toISOString();
  }

  function groupDate(group: DueGroup): string | null | undefined {
    if (group.key === 'undated') return null;
    if (group.key === 'overdue') return undefined;
    if (group.key === 'today') return dateKey(new Date());
    if (group.key === 'tomorrow') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return dateKey(tomorrow);
    }
    return group.key;
  }

  async function persistTaskOrdering(nextItems: Todo[]): Promise<void> {
    const response = await fetch('app/controllers/SortableAjaxController.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '',
      },
      body: JSON.stringify({
        table: 'todolist',
        ordering: nextItems.map(item => `todo_${item.id}`),
      }),
    });
    const payload = await response.json() as { res?: boolean; msg?: string };
    if (!response.ok || payload.res === false) {
      throw new Error(payload.msg ?? 'The task order could not be saved.');
    }
  }

  async function dropTaskOnTask(event: DragEvent, targetId: number): Promise<void> {
    event.preventDefault();
    const sourceId = draggedTaskId;
    finishTaskDrag();
    if (sourceId === null || sourceId === targetId) return;
    const source = items.find(item => Number(item.id) === sourceId);
    const target = items.find(item => Number(item.id) === targetId);
    if (!source || !target) return;
    try {
      const sourceDay = source.deadline ? dateKey(new Date(source.deadline)) : null;
      const targetDay = target.deadline ? dateKey(new Date(target.deadline)) : null;
      if (sourceDay !== targetDay) {
        await ApiC.patch(`${Model.Todolist}/${sourceId}`, {
          deadline: deadlineForDate(source, targetDay),
        });
      }
      const nextItems = [...items];
      const sourceIndex = nextItems.findIndex(item => Number(item.id) === sourceId);
      const [moved] = nextItems.splice(sourceIndex, 1);
      const targetIndex = nextItems.findIndex(item => Number(item.id) === targetId);
      nextItems.splice(targetIndex, 0, moved);
      items = nextItems;
      await persistTaskOrdering(nextItems);
      await load();
      window.dispatchEvent(new CustomEvent('todolist-changed'));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'The task could not be moved.');
      await load();
    }
  }

  async function dropTaskOnGroup(event: DragEvent, group: DueGroup): Promise<void> {
    event.preventDefault();
    const sourceId = draggedTaskId;
    const targetDate = groupDate(group);
    finishTaskDrag();
    if (sourceId === null || targetDate === undefined) return;
    const source = items.find(item => Number(item.id) === sourceId);
    if (!source) return;
    const sourceDate = source.deadline ? dateKey(new Date(source.deadline)) : null;
    if (sourceDate === targetDate) return;
    try {
      await ApiC.patch(`${Model.Todolist}/${sourceId}`, {
        deadline: deadlineForDate(source, targetDate),
      });
      await load();
      window.dispatchEvent(new CustomEvent('todolist-changed'));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'The task date could not be changed.');
      await load();
    }
  }

  onMount(() => {
    const prefs = document.getElementById('user-prefs');
    locale = prefs?.dataset?.jslang || 'en-gb';
    const reload = (): void => {
      void load();
    };
    window.addEventListener('todolist-changed', reload);
    window.addEventListener('todolist-scope-changed', reload);
    void load();
    return () => {
      window.removeEventListener('todolist-changed', reload);
      window.removeEventListener('todolist-scope-changed', reload);
    };
  });
</script>

<section class='todo-create mb-3' aria-label={t('add-task')}>
  <div class='input-group mb-2'>
    <input
      class='form-control'
      bind:value={draft}
      on:keydown={(event) => event.key === 'Enter' && create()}
      placeholder={t('add-task')}
    />
    <div class='input-group-append'>
      <button type='button' class='btn btn-primary' on:click={create} aria-label={t('add')}>
        <i class='fas fa-plus fa-fw' title={t('add')}></i>
      </button>
    </div>
  </div>
  <label class='w-100 mb-2'>
    <span class='small'>{t('Notes')}</span>
    <textarea
      class='form-control form-control-sm'
      rows='2'
      bind:value={draftNotes}
      placeholder={t('Optional details')}
    ></textarea>
  </label>
  <div class='todo-create-options'>
    <div class='todo-date-time-row'>
      <label class='mb-0'>
        <span class='small'>{t('Date')}</span>
        <input
          class='form-control form-control-sm'
          type='date'
          bind:value={deadlineDate}
        />
      </label>
      <label class='mb-0'>
        <span class='small'>{t('Time')}</span>
        <select class='form-control form-control-sm' bind:value={deadlineTime}>
          <option value=''>—</option>
          {#each timeOptions as time}
            <option value={time}>{time}</option>
          {/each}
        </select>
      </label>
    </div>
    <label class='mb-0'>
      <span class='small'>{t('Reminder')}</span>
      <select
        class='form-control form-control-sm'
        bind:value={reminderChoice}
        disabled={!deadlineDate || !deadlineTime}
        title={!deadlineDate || !deadlineTime ? t('Choose a task date and time first') : undefined}
        on:change={() => reminderChoice === 'specific' && initializeSpecificReminder()}
      >
        <option value='none'>{t('No reminder')}</option>
        <option value='0'>{t('At deadline')}</option>
        <option value='15'>{t('15 minutes before')}</option>
        <option value='60'>{t('1 hour before')}</option>
        <option value='1440'>{t('1 day before')}</option>
        <option value='10080'>{t('1 week before')}</option>
        <option value='custom'>{t('Custom minutes')}</option>
        <option value='specific'>{t('Specific date and time')}</option>
      </select>
    </label>
    {#if deadlineDate && deadlineTime && reminderChoice === 'custom'}
      <label class='mb-0'>
        <span class='small'>{t('Minutes before')}</span>
        <input
          class='form-control form-control-sm'
          type='number'
          min='0'
          max='10080'
          bind:value={customReminder}
        />
      </label>
    {:else if deadlineDate && deadlineTime && reminderChoice === 'specific'}
      <div class='todo-date-time-row'>
        <label class='mb-0'>
          <span class='small'>{t('Reminder date')}</span>
          <input class='form-control form-control-sm' type='date' bind:value={reminderDate} />
        </label>
        <label class='mb-0'>
          <span class='small'>{t('Reminder time')}</span>
          <select class='form-control form-control-sm' bind:value={reminderTime}>
            <option value=''>—</option>
            {#each timeOptions as time}
              <option value={time}>{time}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}
    {#if deadlineDate || deadlineTime}
      <button
        type='button'
        class='btn btn-sm btn-outline-secondary todo-clear-deadline'
        on:click={() => {
          deadlineDate = '';
          deadlineTime = '';
          reminderChoice = 'none';
          reminderDate = '';
          reminderTime = '';
        }}
      >
        <i class='fas fa-xmark fa-fw mr-1' aria-hidden='true'></i>{t('Clear')}
      </button>
    {/if}
  </div>
</section>

{#if loading}
  <p class='todo-secondary-text'>{t('Loading')}…</p>
{:else}
  {#if dueGroups.length === 0}
    <p class='mb-0'>{t('no-tasks-yet')}</p>
  {:else}
    <div class='todo-due-groups'>
      {#each dueGroups as group (group.key)}
        <section class='todo-due-group' aria-labelledby={`todo-due-${group.key}`}>
          <h4
            id={`todo-due-${group.key}`}
            class:overdue-heading={group.key === 'overdue'}
            class:todo-drag-over={dragOverKey === `group-${group.key}`}
            class='todo-due-heading'
            on:dragover={(event) => groupDate(group) !== undefined && allowTaskDrop(event, `group-${group.key}`)}
            on:drop={(event) => void dropTaskOnGroup(event, group)}
          >
            <span>{group.label}</span>
            <span class='badge badge-secondary'>{group.entries.length}</span>
          </h4>
          <ul class='list-group'>
            {#each group.entries as entry (entry.key)}
              <li
                class:todo-entry-overdue={isOverdue(entry)}
                class:todo-drag-over={dragOverKey === entry.key}
                class='list-group-item todo-group-entry'
                on:dragover={(event) => entry.source === 'todo' && allowTaskDrop(event, entry.key)}
                on:drop={(event) => entry.source === 'todo' && void dropTaskOnTask(event, entry.id)}
              >
                <div class='d-flex align-items-start'>
                  {#if entry.source === 'step'}
                    <input
                      type='checkbox'
                      class='stepbox mr-2 mt-1'
                      id={`todo_step_${entry.id}`}
                      data-id={entry.entityId}
                      data-type={entry.entityType}
                      data-stepid={entry.id}
                      aria-label={t('Mark experiment step complete')}
                    />
                  {:else}
                    <button
                      type='button'
                      class='btn btn-ghost btn-sm todo-drag-handle mr-1'
                      draggable='true'
                      on:dragstart={(event) => startTaskDrag(event, entry.id)}
                      on:dragend={finishTaskDrag}
                      title={t('Drag to reorder or move to another day')}
                      aria-label={t('Drag to reorder or move to another day')}
                    >
                      <i class='fas fa-grip-vertical' aria-hidden='true'></i>
                    </button>
                    <i class='fas fa-list-check color-medium fa-fw mr-2 mt-1' aria-hidden='true'></i>
                  {/if}
                  <div class='d-flex flex-column flex-grow-1 min-width-0'>
                    {#if entry.source === 'todo'}
                      <strong>{entry.body}</strong>
                    {:else}
                      <span>{entry.body}</span>
                      <a class='small todo-step-entity-link' href={`${entityPage(entry)}?mode=view&id=${entry.entityId}#step_view_${entry.id}`}>
                        {entry.entityTitle}
                      </a>
                    {/if}
                    {#if entry.deadline}
                      <div class:font-weight-bold={isOverdue(entry)} class='small todo-item-deadline'>
                        <i class='fas fa-clock fa-fw mr-1' aria-hidden='true'></i>
                        {formatDeadline(entry.deadline)}
                      </div>
                    {/if}
                    {#if entry.notes}
                      <div class='small todo-secondary-text todo-task-notes'>{entry.notes}</div>
                    {/if}
                    {#if entry.creationTime}
                      <div class='relative-moment small todo-secondary-text' title={entry.creationTime}>
                        {relative(entry.creationTime)}
                      </div>
                    {/if}
                  </div>
                  {#if entry.source === 'todo'}
                    <div class='btn-group btn-group-sm ml-2'>
                      <button
                        type='button'
                        class='btn btn-ghost'
                        on:click={() => startEditing(entry)}
                        title={t('Edit')}
                        aria-label={t('Edit')}
                      >
                        <i class='fas fa-pen' aria-hidden='true'></i>
                      </button>
                      <button
                        type='button'
                        class='btn btn-ghost'
                        on:click={() => complete(entry.id)}
                        title={t('done')}
                        aria-label={t('done')}
                      >
                        <i class='fas fa-check' aria-hidden='true'></i>
                      </button>
                    </div>
                  {/if}
                </div>
                {#if entry.source === 'todo' && editingId === entry.id}
                  <div class='todo-task-edit mt-2'>
                    <label class='todo-edit-full mb-0'>
                      <span class='small'>{t('Task')}</span>
                      <input class='form-control form-control-sm' bind:value={editTitle} />
                    </label>
                    <label class='todo-edit-full mb-0'>
                      <span class='small'>{t('Notes')}</span>
                      <textarea class='form-control form-control-sm' rows='2' bind:value={editNotes}></textarea>
                    </label>
                    <div class='todo-edit-full todo-date-time-row'>
                      <label class='mb-0'>
                        <span class='small'>{t('Date')}</span>
                        <input class='form-control form-control-sm' type='date' bind:value={editDeadlineDate} />
                      </label>
                      <label class='mb-0'>
                        <span class='small'>{t('Time')}</span>
                        <select class='form-control form-control-sm' bind:value={editDeadlineTime}>
                          <option value=''>—</option>
                          {#each timeOptions as time}
                            <option value={time}>{time}</option>
                          {/each}
                        </select>
                      </label>
                    </div>
                    <label class='todo-edit-full mb-0'>
                      <span class='small'>{t('Reminder')}</span>
                      <select
                        class='form-control form-control-sm'
                        bind:value={editReminderChoice}
                        disabled={!editDeadlineDate || !editDeadlineTime}
                        title={!editDeadlineDate || !editDeadlineTime ? t('Choose a task date and time first') : undefined}
                        on:change={() => editReminderChoice === 'specific' && initializeSpecificReminder(true)}
                      >
                        <option value='none'>{t('No reminder')}</option>
                        <option value='0'>{t('At deadline')}</option>
                        <option value='15'>{t('15 minutes before')}</option>
                        <option value='60'>{t('1 hour before')}</option>
                        <option value='1440'>{t('1 day before')}</option>
                        <option value='10080'>{t('1 week before')}</option>
                        <option value='custom'>{t('Custom minutes')}</option>
                        <option value='specific'>{t('Specific date and time')}</option>
                      </select>
                    </label>
                    {#if editDeadlineDate && editDeadlineTime && editReminderChoice === 'custom'}
                      <label class='todo-edit-full mb-0'>
                        <span class='small'>{t('Minutes before')}</span>
                        <input
                          class='form-control form-control-sm'
                          type='number'
                          min='0'
                          max='10080'
                          bind:value={editCustomReminder}
                        />
                      </label>
                    {:else if editDeadlineDate && editDeadlineTime && editReminderChoice === 'specific'}
                      <div class='todo-edit-full todo-date-time-row'>
                        <label class='mb-0'>
                          <span class='small'>{t('Reminder date')}</span>
                          <input class='form-control form-control-sm' type='date' bind:value={editReminderDate} />
                        </label>
                        <label class='mb-0'>
                          <span class='small'>{t('Reminder time')}</span>
                          <select class='form-control form-control-sm' bind:value={editReminderTime}>
                            <option value=''>—</option>
                            {#each timeOptions as time}
                              <option value={time}>{time}</option>
                            {/each}
                          </select>
                        </label>
                      </div>
                    {/if}
                    <div class='todo-edit-full d-flex flex-wrap align-items-center'>
                      <button type='button' class='btn btn-primary btn-sm mr-1' on:click={() => saveEditing(entry.id)}>{t('Save')}</button>
                      <button type='button' class='btn btn-secondary btn-sm mr-1' on:click={() => editingId = null}>{t('Cancel')}</button>
                      {#if editDeadlineDate || editDeadlineTime}
                        <button
                          type='button'
                          class='btn btn-link btn-sm'
                          on:click={() => {
                            editDeadlineDate = '';
                            editDeadlineTime = '';
                            editReminderChoice = 'none';
                            editReminderDate = '';
                            editReminderTime = '';
                          }}
                        >{t('Clear deadline')}</button>
                      {/if}
                    </div>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
    {#if canLoadMore}
      <button type='button' class='btn btn-sm btn-outline-secondary btn-block mt-2' disabled={loadingMore} on:click={loadMore}>
        {loadingMore ? `${t('Loading')}…` : t('Load more')}
      </button>
    {/if}
  {/if}

  <details class='todo-completed-history mt-3' on:toggle={toggleCompletedHistory}>
    <summary>
      <span>{t('Completed tasks')}</span>
      {#if completedLoaded}<span class='badge badge-secondary'>{completedItems.length}</span>{/if}
    </summary>
    <div class='todo-completed-toolbar'>
      <label class='mb-0'>
        <span class='small'>{t('Show')}</span>
        <select
          class='form-control form-control-sm'
          bind:value={completedWindow}
          on:change={() => loadCompleted()}
        >
          <option value='1'>{t('Past day')}</option>
          <option value='2'>{t('Past 2 days')}</option>
          <option value='3'>{t('Past 3 days')}</option>
          <option value='7'>{t('Past week')}</option>
          <option value='14'>{t('Past 2 weeks')}</option>
          <option value='30'>{t('Past month')}</option>
        </select>
      </label>
      <button type='button' class='btn btn-link p-0' on:click={openFullHistory}>
        {t('All')} <i class='fas fa-up-right-from-square fa-fw' aria-hidden='true'></i>
      </button>
    </div>
    {#if loadingCompleted}
      <p class='todo-secondary-text mb-0'>{t('Loading')}…</p>
    {:else if completedGroups.length === 0}
      <p class='todo-secondary-text mb-0'>{t('No completed tasks in this time window.')}</p>
    {:else}
      {#each completedGroups as group (group.key)}
        <section class='todo-completed-group'>
          <h4>{group.label}</h4>
          <ul class='list-group'>
            {#each group.items as item (item.id)}
              <li class='list-group-item todo-completed-entry'>
                <div class='flex-grow-1 min-width-0'>
                  <div>{item.body}</div>
                  {#if item.completed_at}
                    <div class='small todo-secondary-text'>{formatDeadline(item.completed_at)}</div>
                  {/if}
                </div>
                <div class='btn-group btn-group-sm ml-2'>
                  <button type='button' class='btn btn-ghost' on:click={() => restore(item.id)} title={t('Restore')} aria-label={t('Restore')}>
                    <i class='fas fa-rotate-left' aria-hidden='true'></i>
                  </button>
                  <button type='button' class='btn btn-ghost' on:click={() => destroyCompleted(item.id)} title={t('Delete')} aria-label={t('Delete')}>
                    <i class='fas fa-trash' aria-hidden='true'></i>
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </details>
{/if}

<style>
  .todo-create {
    background: var(--chrome-bg);
    border: 1px solid var(--secondary);
    border-radius: 0.25rem;
    color: var(--chrome-fg);
    padding: 0.65rem;
  }

  .todo-create-options {
    display: grid;
    gap: 0.45rem;
  }

  .todo-date-time-row {
    display: grid;
    gap: 0.45rem;
    grid-template-columns: minmax(0, 1.35fr) minmax(5.75rem, 0.65fr);
    width: 100%;
  }

  .todo-date-time-row label,
  .todo-date-time-row .form-control {
    min-width: 0;
  }

  .todo-clear-deadline {
    border-color: var(--chrome-muted);
    color: var(--chrome-fg);
    justify-self: start;
  }

  .todo-due-group + .todo-due-group {
    margin-top: 1rem;
  }

  .todo-due-heading {
    align-items: center;
    background: var(--chrome-bg);
    border: 1px solid var(--secondary);
    border-left: 4px solid var(--primary);
    border-radius: 0.25rem;
    color: var(--chrome-fg);
    display: flex;
    font-size: 0.95rem;
    justify-content: space-between;
    margin: 0 0 0.45rem;
    padding: 0.48rem 0.6rem;
  }

  .todo-due-heading .badge {
    background: var(--primary);
    color: var(--chrome-fg);
  }

  .todo-due-heading.overdue-heading {
    background: var(--chrome-bg);
    border-color: var(--secondary);
    border-left-color: var(--side-panel-danger, #ff8a7a);
    color: var(--chrome-fg);
  }

  .todo-due-heading.overdue-heading .badge {
    background: var(--side-panel-danger, #ff8a7a);
    color: var(--chrome-bg);
  }

  .todo-due-heading.todo-drag-over,
  .todo-group-entry.todo-drag-over {
    border-color: var(--primary);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--primary) 45%, transparent);
  }

  .todo-group-entry {
    background: var(--chrome-bg);
    border-color: var(--secondary);
    border-left: 3px solid var(--primary);
    border-radius: 0.25rem !important;
    color: var(--chrome-fg);
    margin-bottom: 0.4rem;
    padding: 0.65rem;
  }

  .todo-group-entry.todo-entry-overdue {
    background: var(--chrome-bg);
    border-color: var(--secondary);
    border-left-color: var(--side-panel-danger, #ff8a7a);
  }

  .todo-task-edit {
    background: color-mix(in srgb, var(--chrome-bg) 82%, var(--primary));
    border: 1px solid var(--secondary);
    border-radius: 0.25rem;
    display: grid;
    gap: 0.45rem;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    padding: 0.55rem;
  }

  .todo-edit-full {
    grid-column: 1 / -1;
  }

  .todo-group-entry .btn-ghost {
    color: var(--chrome-fg);
  }

  .todo-drag-handle {
    cursor: grab;
    flex: 0 0 auto;
    line-height: 1;
    padding: 0.1rem 0.2rem;
  }

  .todo-drag-handle:active {
    cursor: grabbing;
  }

  .todo-group-entry .fas {
    color: var(--primary);
  }

  .todo-group-entry.todo-entry-overdue .fas {
    color: var(--side-panel-danger, #ff8a7a);
  }

  .todo-item-deadline {
    color: var(--chrome-muted);
  }

  .todo-entry-overdue .todo-item-deadline {
    color: var(--side-panel-danger, #ff8a7a);
  }

  .todo-secondary-text {
    color: var(--chrome-muted);
  }

  .todo-step-entity-link {
    color: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-decoration-thickness: 0.08em;
    text-underline-offset: 0.12em;
  }

  .todo-step-entity-link:hover,
  .todo-step-entity-link:focus {
    color: inherit;
    text-decoration-thickness: 0.12em;
  }

  .todo-task-notes {
    white-space: pre-wrap;
  }

  .todo-completed-history {
    background: var(--chrome-bg);
    border: 1px solid var(--secondary);
    border-radius: 0.25rem;
    color: var(--chrome-fg);
    padding: 0.55rem 0.65rem;
  }

  .todo-completed-history summary {
    align-items: center;
    cursor: pointer;
    display: flex;
    font-weight: 600;
    justify-content: space-between;
  }

  .todo-completed-toolbar {
    align-items: end;
    display: flex;
    justify-content: space-between;
    margin: 0.75rem 0;
  }

  .todo-completed-toolbar select {
    min-width: 9rem;
  }

  .todo-completed-group + .todo-completed-group {
    margin-top: 0.8rem;
  }

  .todo-completed-group h4 {
    color: var(--chrome-muted);
    font-size: 0.82rem;
    margin: 0 0 0.35rem;
  }

  .todo-completed-entry {
    align-items: center;
    background: var(--chrome-bg);
    border-color: var(--secondary);
    color: var(--chrome-fg);
    display: flex;
    padding: 0.55rem 0.6rem;
  }

  .todo-completed-entry .btn-ghost {
    color: var(--chrome-fg);
  }

  .min-width-0 {
    min-width: 0;
  }

  @media (max-width: 480px) {
    .todo-task-edit {
      grid-template-columns: 1fr;
    }
  }
</style>
