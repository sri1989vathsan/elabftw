<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ApiC } from '../api';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Malle } from '@deltablot/malle';
  import { Notification as AppNotification } from '../Notifications.class';
  import { toRelative } from '../misc';

  type Todo = {
    id: number;
    body: string;
    notes: string | null;
    deadline: string | null;
    reminder_minutes: number | null;
    creation_time: string;
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
    entityId?: number;
    entityTitle?: string;
    entityType?: 'experiments' | 'items';
  };

  type DueGroup = {
    key: string;
    label: string;
    entries: SidebarEntry[];
  };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();
  const timeOptions = Array.from({ length: 96 }, (_, index) => {
    const hours = String(Math.floor(index / 4)).padStart(2, '0');
    const minutes = String((index % 4) * 15).padStart(2, '0');
    return `${hours}:${minutes}`;
  });
  let locale = 'en-gb';
  let malleable: Malle | null = null;
  let items: Todo[] = [];
  let unfinished: UnfinishedResponse = { experiments: [], items: [] };
  let entries: SidebarEntry[] = [];
  let dueGroups: DueGroup[] = [];
  let draft = '';
  let deadlineDate = '';
  let deadlineTime = '';
  let reminderChoice = '60';
  let customReminder = 120;
  let loading = true;

  $: entries = [
    ...items.map(item => ({
      key: `todo-${item.id}`,
      source: 'todo' as const,
      id: Number(item.id),
      body: item.body,
      deadline: item.deadline,
      notes: item.notes,
      creationTime: item.creation_time,
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
          entityId: Number(entity.id),
          entityTitle: entity.title,
          entityType,
        }))
      ))
    )),
  ];
  $: dueGroups = buildDueGroups(entries);

  function setupMalle(): void {
    malleable = new Malle({
      before: original => original.classList.contains('editable'),
      inputClasses: ['form-control'],
      fun: async (value, original) => {
        const id = original.dataset.id;
        if (!id) {
          throw new Error('Missing todo id on editable element');
        }
        const resp = await ApiC.patch(`${Model.Todolist}/${id}`, { content: value });
        const json = await resp.json();
        window.dispatchEvent(new CustomEvent('todolist-changed'));
        return json.body;
      },
      returnedValueIsTrustedHtml: false,
      listenOn: '.todoItem',
      tooltip: t('click-to-edit'),
    });
    malleable.listen();
  }

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

  function getReminderMinutes(): number | null {
    if (reminderChoice === 'none') return null;
    if (reminderChoice === 'custom') {
      return Math.max(0, Math.min(10080, Math.round(customReminder)));
    }
    return parseInt(reminderChoice, 10);
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

    ApiC.notifOnSaved = false;
    await ApiC.post(Model.Todolist, {
      content,
      deadline: deadline?.toISOString() ?? null,
      reminder_minutes: deadline === null ? null : getReminderMinutes(),
    });
    ApiC.notifOnSaved = true;
    draft = '';
    deadlineDate = '';
    deadlineTime = '';
    reminderChoice = '60';
    customReminder = 120;
    await load();
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }

  async function destroy(id: number): Promise<void> {
    await ApiC.delete(`${Model.Todolist}/${id}`);
    items = items.filter(item => Number(item.id) !== id);
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }

  async function load(): Promise<void> {
    loading = true;
    const teamScope = localStorage.getItem(`${Model.Todolist}StepsShowTeam`) === '1';
    const [todoResponse, unfinishedResponse] = await Promise.all([
      ApiC.getJson(Model.Todolist) as Promise<Todo[]>,
      ApiC.getJson(`unfinished_steps?scope=${teamScope ? 'team' : 'user'}`) as Promise<UnfinishedResponse>,
    ]);
    items = todoResponse;
    unfinished = unfinishedResponse;
    loading = false;
    await tick();
    setupMalle();
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
  <div class='todo-create-options'>
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
    {#if deadlineDate && deadlineTime}
      <label class='mb-0'>
        <span class='small'>{t('Reminder')}</span>
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
      {/if}
    {/if}
    {#if deadlineDate || deadlineTime}
      <button
        type='button'
        class='btn btn-sm btn-outline-secondary todo-clear-deadline'
        on:click={() => {
          deadlineDate = '';
          deadlineTime = '';
        }}
      >
        <i class='fas fa-xmark fa-fw mr-1' aria-hidden='true'></i>{t('Clear')}
      </button>
    {/if}
  </div>
</section>

{#if loading}
  <p class='todo-secondary-text'>{t('Loading')}…</p>
{:else if dueGroups.length === 0}
  <p class='mb-0'>{t('no-tasks-yet')}</p>
{:else}
  <div class='todo-due-groups'>
    {#each dueGroups as group (group.key)}
      <section class='todo-due-group' aria-labelledby={`todo-due-${group.key}`}>
        <h4 id={`todo-due-${group.key}`} class:overdue-heading={group.key === 'overdue'} class='todo-due-heading'>
          <span>{group.label}</span>
          <span class='badge badge-secondary'>{group.entries.length}</span>
        </h4>
        <ul class='list-group'>
          {#each group.entries as entry (entry.key)}
            <li class:todo-entry-overdue={isOverdue(entry)} class='list-group-item todo-group-entry'>
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
                  <i class='fas fa-list-check color-medium fa-fw mr-2 mt-1' aria-hidden='true'></i>
                {/if}
                <div class='d-flex flex-column flex-grow-1 min-width-0'>
                  {#if entry.source === 'todo'}
                    <span class='editable todoItem' data-id={entry.id}>{entry.body}</span>
                  {:else}
                    <span>{entry.body}</span>
                    <a class='small' href={`${entityPage(entry)}?mode=view&id=${entry.entityId}#step_view_${entry.id}`}>
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
                    <div class='small todo-secondary-text'>{entry.notes}</div>
                  {/if}
                  {#if entry.creationTime}
                    <div class='relative-moment small todo-secondary-text' title={entry.creationTime}>
                      {relative(entry.creationTime)}
                    </div>
                  {/if}
                </div>
                {#if entry.source === 'todo'}
                  <button
                    type='button'
                    class='btn btn-sm btn-ghost ml-2'
                    on:click={() => destroy(entry.id)}
                  >
                    {t('done')}
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
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

  .todo-group-entry .todoItem,
  .todo-group-entry .btn-ghost {
    color: var(--chrome-fg);
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

  .min-width-0 {
    min-width: 0;
  }
</style>
