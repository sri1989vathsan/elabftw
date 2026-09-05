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
  import { core } from '../core';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';
  import { toRelative } from '../misc';

  type Todo = {
    id: number;
    body: string;
    notes: string | null;
    description: string | null;
    deadline: string | null;
    reminder_minutes: number | null;
    creation_time: string;
    completed_at: string | null;
    ordering: number;
    userid?: number;
    assigned_userid?: number | null;
    creator_fullname?: string | null;
    assigned_fullname?: string | null;
    assignees?: { userid: number; fullname: string }[];
    project_id?: number | null;
    project_name?: string | null;
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
    description: string | null;
    creationTime: string | null;
    ordering: number | null;
    entityId?: number;
    entityTitle?: string;
    entityType?: 'experiments' | 'items';
    creatorUserid?: number;
    assignedUserid?: number | null;
    creatorFullname?: string | null;
    assignedFullname?: string | null;
    assignees?: { userid: number; fullname: string }[];
    projectId?: number | null;
    projectName?: string | null;
  };

  type DueGroup = {
    key: string;
    label: string;
    entries: SidebarEntry[];
  };

  type EntityLinkType = 'experiments' | 'items' | 'experiments_templates' | 'items_types' | 'weblink';

  type EntityLink = {
    id: number;
    entity_type: EntityLinkType;
    entity_id: number | null;
    url: string | null;
    title: string | null;
  };

  type Step = {
    id: number;
    body: string;
    ordering: number;
    finished: boolean;
  };

  type CompletedGroup = {
    key: string;
    label: string;
    items: Todo[];
  };

  type TaskComment = {
    id: number;
    body: string;
    created_at: string;
    userid: number;
    author_fullname: string;
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
  let detailEntry: SidebarEntry | null = null;
  let detailEditing = false;
  let detailNotesEl: HTMLDivElement;
  let detailDescriptionEl: HTMLDivElement;
  let detailComments: TaskComment[] = [];
  let loadingComments = false;
  let newCommentText = '';
  let postingComment = false;
  let editTitle = '';
  let editNotes = '';
  let editDescription = '';
  let editDeadlineDate = '';
  let editDeadlineTime = '';
  let editReminderChoice = '60';
  let editCustomReminder = 120;
  let editReminderDate = '';
  let editReminderTime = '';
  let detailEntityLinks: EntityLink[] = [];
  let loadingEntityLinks = false;
  let weblinkUrl = '';
  let weblinkLabel = '';
  let addingWeblink = false;
  let detailSteps: Step[] = [];
  let loadingSteps = false;
  let newStepText = '';
  let addingStep = false;
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
      description: item.description,
      creationTime: item.creation_time,
      ordering: Number(item.ordering),
      creatorUserid: item.userid,
      assignedUserid: item.assigned_userid,
      creatorFullname: item.creator_fullname,
      assignedFullname: item.assigned_fullname,
      assignees: item.assignees ?? [],
      projectId: item.project_id,
      projectName: item.project_name,
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
          description: null,
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

  function initials(fullname: string): string {
    const parts = fullname.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function isAssignedByOther(entry: SidebarEntry): boolean {
    return entry.source === 'todo'
      && (entry.assignees ?? []).some(a => a.userid === core.currentUserid)
      && entry.creatorUserid !== undefined
      && entry.creatorUserid !== core.currentUserid;
  }

  function populateEditFields(entry: SidebarEntry): void {
    const task = items.find(item => Number(item.id) === entry.id);
    if (!task) return;
    editTitle = task.body;
    editNotes = task.notes ?? '';
    editDescription = task.description ?? '';
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

  function openDetail(entry: SidebarEntry): void {
    if (entry.source !== 'todo') return;
    detailEntry = entry;
    detailEditing = false;
    weblinkUrl = '';
    weblinkLabel = '';
    populateEditFields(entry);
    void loadEntityLinks(entry.id);
    void loadComments(entry.id);
    void loadSteps(entry.id);
    window.dispatchEvent(new CustomEvent('elabftw:pm-task-link-target', { detail: { id: entry.id, title: entry.body } }));
  }

  function closeDetail(): void {
    detailEntry = null;
    detailEditing = false;
    detailEntityLinks = [];
    detailComments = [];
    newCommentText = '';
    detailSteps = [];
    newStepText = '';
    window.dispatchEvent(new CustomEvent('elabftw:pm-task-link-target', { detail: null }));
  }

  function startDetailEdit(): void {
    detailEditing = true;
  }

  function cancelDetailEdit(): void {
    if (!detailEntry) return;
    populateEditFields(detailEntry);
    detailEditing = false;
  }

  async function saveDetailEdit(): Promise<void> {
    if (!detailEntry) return;
    const id = detailEntry.id;
    editNotes = detailNotesEl?.innerHTML ?? editNotes;
    editDescription = detailDescriptionEl?.innerHTML ?? editDescription;
    await saveEditing(id);
    const refreshed = entries.find(e => e.source === 'todo' && e.id === id);
    if (refreshed) detailEntry = refreshed;
    detailEditing = false;
  }

  function startEditing(entry: SidebarEntry): void {
    if (entry.source !== 'todo') return;
    populateEditFields(entry);
    editingId = entry.id;
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
      description: editDescription.trim() || null,
      deadline: deadline?.toISOString() ?? null,
      reminder_minutes: reminderMinutes,
    });
    editingId = null;
    await load();
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }

  // A lightweight rich-text toolbar (contenteditable + execCommand), same
  // approach as ProjectManagementBoard.svelte's Notes field.
  function exec(el: HTMLElement | undefined, cmd: string, value?: string): void {
    if (!el) return;
    el.focus();
    document.execCommand(cmd, false, value ?? '');
  }

  function insertLink(el: HTMLElement | undefined): void {
    if (!el) return;
    const input = window.prompt(t('Enter a URL'));
    const url = input?.trim();
    if (!url) return;
    el.focus();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim() !== '') {
      document.execCommand('createLink', false, url);
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = url;
    document.execCommand('insertHTML', false, link.outerHTML);
  }

  const ENTITY_TYPE_PAGES: Partial<Record<EntityLinkType, string>> = {
    experiments: 'experiments.php',
    items: 'database.php',
    experiments_templates: 'templates.php',
    items_types: 'resources-templates.php',
  };

  function entityViewUrl(link: EntityLink): string {
    if (link.entity_type === 'weblink') return link.url ?? '#';
    return `${ENTITY_TYPE_PAGES[link.entity_type]}?mode=view&id=${link.entity_id}`;
  }

  function entityTypeLabel(type: EntityLinkType): string {
    return {
      experiments: t('Experiment'),
      items: t('Resource'),
      experiments_templates: t('Template'),
      items_types: t('Resource template'),
      weblink: t('Link'),
    }[type];
  }

  async function loadEntityLinks(taskId: number): Promise<void> {
    loadingEntityLinks = true;
    try {
      const links = await ApiC.getJson(`${Model.Todolist}/${taskId}/entity_links`) as EntityLink[];
      detailEntityLinks = links.filter(link => link.title !== null);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load linked items.');
    } finally {
      loadingEntityLinks = false;
    }
  }

  function normalizeWeblinkUrl(input: string): string | null {
    let candidate = input.trim();
    if (!candidate) return null;
    // A bare "\\server\share" (Windows UNC path notation) is a common way
    // people write a network share -- accept it as shorthand for smb://.
    if (/^\\\\/.test(candidate)) candidate = `smb://${candidate.slice(2).replace(/\\/g, '/')}`;
    if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
    try {
      const url = new URL(candidate);
      return ['http:', 'https:', 'smb:'].includes(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  }

  // Same host/share/path convention as file-folder-references.ts and
  // links.html's Data section, so a network share renders exactly the same
  // way here: a real smb:// link for Mac, and a copy-to-clipboard \\UNC\path
  // button for Windows (data-action="copy-unc-path" is a global handler
  // already wired in common.ts, so it works here with no extra JS).
  function smbCore(url: string): string | null {
    return url.startsWith('smb://') ? url.slice('smb://'.length) : null;
  }

  function uncPath(core: string): string {
    return `\\\\${core.replace(/\//g, '\\')}`;
  }

  async function addWeblink(): Promise<void> {
    if (!detailEntry) return;
    const url = normalizeWeblinkUrl(weblinkUrl);
    if (!url) {
      notify.error('Enter a valid web address.');
      return;
    }
    addingWeblink = true;
    try {
      await ApiC.post(`${Model.Todolist}/${detailEntry.id}/entity_links`, {
        entity_type: 'weblink',
        url,
        label: weblinkLabel.trim() || url,
      });
      weblinkUrl = '';
      weblinkLabel = '';
      await loadEntityLinks(detailEntry.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not add that link.');
    } finally {
      addingWeblink = false;
    }
  }

  async function removeEntityLink(link: EntityLink): Promise<void> {
    if (!detailEntry) return;
    try {
      await ApiC.delete(`${Model.Todolist}/${detailEntry.id}/entity_links/${link.id}`);
      await loadEntityLinks(detailEntry.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not remove that link.');
    }
  }

  async function loadSteps(taskId: number): Promise<void> {
    loadingSteps = true;
    try {
      detailSteps = await ApiC.getJson(`${Model.Todolist}/${taskId}/steps`) as Step[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load steps.');
    } finally {
      loadingSteps = false;
    }
  }

  async function addStep(): Promise<void> {
    if (!detailEntry) return;
    const body = newStepText.trim();
    if (!body) return;
    addingStep = true;
    try {
      await ApiC.post(`${Model.Todolist}/${detailEntry.id}/steps`, { body });
      newStepText = '';
      await loadSteps(detailEntry.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not add that step.');
    } finally {
      addingStep = false;
    }
  }

  async function toggleStep(step: Step): Promise<void> {
    if (!detailEntry) return;
    try {
      await ApiC.patch(`${Model.Todolist}/${detailEntry.id}/steps/${step.id}`, { finished: !step.finished });
      await loadSteps(detailEntry.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update that step.');
    }
  }

  async function removeStep(step: Step): Promise<void> {
    if (!detailEntry) return;
    try {
      await ApiC.delete(`${Model.Todolist}/${detailEntry.id}/steps/${step.id}`);
      await loadSteps(detailEntry.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not remove that step.');
    }
  }

  function formatCommentTime(timestamp: string): string {
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function loadComments(taskId: number): Promise<void> {
    loadingComments = true;
    try {
      detailComments = await ApiC.getJson(`${Model.Todolist}/${taskId}/${Model.Comment}`) as TaskComment[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load comments.');
    } finally {
      loadingComments = false;
    }
  }

  async function postComment(): Promise<void> {
    const body = newCommentText.trim();
    if (!body || !detailEntry) return;
    postingComment = true;
    try {
      await ApiC.post(`${Model.Todolist}/${detailEntry.id}/${Model.Comment}`, { body });
      newCommentText = '';
      await loadComments(detailEntry.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post the comment.');
    } finally {
      postingComment = false;
    }
  }

  async function deleteComment(comment: TaskComment): Promise<void> {
    if (!detailEntry) return;
    try {
      await ApiC.delete(`${Model.Todolist}/${detailEntry.id}/${Model.Comment}/${comment.id}`);
      await loadComments(detailEntry.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete the comment.');
    }
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

    // Lets the Search side panel offer a "Link to task" button on its
    // results (see FavoriteFilters.class.ts) while this popup is open, the
    // same way ProjectManagementBoard.svelte does.
    const onEntityLinkAdded = (): void => {
      if (detailEntry) void loadEntityLinks(detailEntry.id);
    };
    window.addEventListener('elabftw:pm-entity-link-added', onEntityLinkAdded);
    return () => {
      window.removeEventListener('todolist-changed', reload);
      window.removeEventListener('todolist-scope-changed', reload);
      window.removeEventListener('elabftw:pm-entity-link-added', onEntityLinkAdded);
      window.dispatchEvent(new CustomEvent('elabftw:pm-task-link-target', { detail: null }));
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
                      <button type='button' class='btn-unstyled todo-title-btn' on:click={() => openDetail(entry)}>{entry.body}</button>
                      {#if entry.projectName || isAssignedByOther(entry)}
                        <div class='small todo-secondary-text d-flex align-items-center flex-wrap' style='gap:0.3rem'>
                          {#if entry.projectName}<span class='badge badge-info todo-project-badge'>{entry.projectName}</span>{/if}
                          {#if isAssignedByOther(entry)}<span>{t('Assigned by')} {entry.creatorFullname}</span>{/if}
                        </div>
                      {/if}
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

{#if detailEntry}
  <div class='todo-detail-overlay pm-overlay-task' role='presentation'>
    <div class='todo-detail-dialog' role='dialog' aria-modal='true' aria-labelledby='todoDetailTitle'>
      <div class='todo-detail-header'>
        <h4 id='todoDetailTitle' class='mb-0'>{detailEditing ? t('Edit task') : detailEntry.body}</h4>
        {#if detailEntry.projectName}<span class='badge badge-info'>{detailEntry.projectName}</span>{/if}
        <button type='button' class='btn-unstyled todo-detail-close' on:click={closeDetail} aria-label={t('Close')}>&times;</button>
      </div>
      <div class='todo-detail-body'>
        {#if detailEditing}
          <div class='pm-dialog-field'>
            <label class='pm-label' for='todo-detail-title'>{t('Title')}</label>
            <input id='todo-detail-title' type='text' class='form-control' bind:value={editTitle} />
          </div>
          <div class='d-flex pm-dialog-row'>
            <div class='pm-dialog-field flex-grow-1'>
              <label class='pm-label' for='todo-detail-deadline-date'>{t('Deadline date')}</label>
              <input id='todo-detail-deadline-date' type='date' class='form-control' bind:value={editDeadlineDate} />
            </div>
            <div class='pm-dialog-field flex-grow-1'>
              <label class='pm-label' for='todo-detail-deadline-time'>{t('Deadline time')}</label>
              <select id='todo-detail-deadline-time' class='form-control' bind:value={editDeadlineTime}>
                <option value=''>{t('None')}</option>
                {#each timeOptions as timeOption (timeOption)}
                  <option value={timeOption}>{timeOption}</option>
                {/each}
              </select>
            </div>
          </div>
        {:else}
          {#if detailEntry.deadline}
            <div class='small'>
              <i class='fas fa-clock fa-fw mr-1' aria-hidden='true'></i>{formatDeadline(detailEntry.deadline)}
            </div>
          {/if}
          <div class='small mb-1 d-flex align-items-center flex-wrap'>
            {#if (detailEntry.assignees ?? []).length === 0}
              <span class='badge badge-info mr-1'><i class='fas fa-user fa-fw mr-1' aria-hidden='true'></i>{t('Unassigned')}</span>
            {:else}
              <div class='pm-avatar-group mr-2'>
                {#each detailEntry.assignees as assignee (assignee.userid)}
                  <span class='pm-avatar' title={assignee.fullname}>{initials(assignee.fullname)}</span>
                {/each}
              </div>
            {/if}
            {#if isAssignedByOther(detailEntry)}<span class='pm-muted'>{t('Assigned by')} {detailEntry.creatorFullname}</span>{/if}
          </div>
        {/if}

        <div class='pm-dialog-field'>
          {#if detailEditing}
            <div class='d-flex align-items-center justify-content-between'>
              <span class='pm-label mb-0'>{t('Description')}</span>
              <button type='button' class='btn-unstyled pm-field-edit-btn' title={t('Edit')} aria-label={t('Edit description')} on:mousedown|preventDefault={() => detailDescriptionEl?.focus()}>
                <i class='fas fa-pen fa-fw' aria-hidden='true'></i>
              </button>
            </div>
            <div
              id='todo-detail-description-editor'
              class='rte-content form-control'
              contenteditable='true'
              role='textbox'
              aria-multiline='true'
              aria-label={t('Description')}
              bind:this={detailDescriptionEl}
            >{@html editDescription}</div>
          {:else}
            <span class='pm-label'>{t('Description')}</span>
            {#if detailEntry.description}
              <div class='rte-content'>{@html detailEntry.description}</div>
            {:else}
              <p class='pm-muted small mb-0'>{t('No description yet.')}</p>
            {/if}
          {/if}
        </div>

        <div class='pm-dialog-field'>
          <span class='pm-label'>{t('Notes')}</span>
          {#if detailEditing}
            <div class='rte-toolbar' role='toolbar' aria-label={t('Formatting')}>
              <button type='button' class='rte-btn' title={t('Heading')} on:mousedown|preventDefault={() => exec(detailNotesEl, 'formatBlock', '<h4>')}><i class='fas fa-heading' aria-hidden='true'></i></button>
              <button type='button' class='rte-btn' title={t('Bold')} on:mousedown|preventDefault={() => exec(detailNotesEl, 'bold')}><i class='fas fa-bold' aria-hidden='true'></i></button>
              <button type='button' class='rte-btn' title={t('Italic')} on:mousedown|preventDefault={() => exec(detailNotesEl, 'italic')}><i class='fas fa-italic' aria-hidden='true'></i></button>
              <button type='button' class='rte-btn' title={t('Bullet list')} on:mousedown|preventDefault={() => exec(detailNotesEl, 'insertUnorderedList')}><i class='fas fa-list-ul' aria-hidden='true'></i></button>
              <button type='button' class='rte-btn' title={t('Numbered list')} on:mousedown|preventDefault={() => exec(detailNotesEl, 'insertOrderedList')}><i class='fas fa-list-ol' aria-hidden='true'></i></button>
              <button type='button' class='rte-btn' title={t('Insert link')} on:mousedown|preventDefault={() => insertLink(detailNotesEl)}><i class='fas fa-link' aria-hidden='true'></i></button>
              <button type='button' class='rte-btn' title={t('Clear formatting')} on:mousedown|preventDefault={() => exec(detailNotesEl, 'removeFormat')}><i class='fas fa-eraser' aria-hidden='true'></i></button>
            </div>
            <div
              id='todo-detail-notes-editor'
              class='rte-content form-control'
              contenteditable='true'
              role='textbox'
              aria-multiline='true'
              aria-label={t('Notes')}
              bind:this={detailNotesEl}
            >{@html editNotes}</div>
          {:else if detailEntry.notes}
            <div class='rte-content'>{@html detailEntry.notes}</div>
          {:else}
            <p class='pm-muted small mb-0'>{t('No notes yet.')}</p>
          {/if}
        </div>

        <div class='pm-dialog-field'>
          <div class='d-flex align-items-center justify-content-between'>
            <span class='pm-label mb-0'>{t('Linked items')}</span>
            <button
              type='button'
              class='btn btn-ghost btn-sm'
              on:click={() => {
                const panel = document.getElementById('favoritesPanel');
                if (panel?.hasAttribute('hidden')) {
                  (document.querySelector('[data-action="toggle-sidepanel"][data-target="favorites"]') as HTMLElement | null)?.click();
                }
              }}
            >
              <i class='fas fa-magnifying-glass fa-fw mr-1' aria-hidden='true'></i>{t('Open Search to link')}
            </button>
          </div>
          {#if loadingEntityLinks}
            <p class='pm-muted small'>{t('Loading')}…</p>
          {:else if detailEntityLinks.length === 0}
            <p class='pm-muted small'>{t('No linked items yet.')}</p>
          {:else}
            <ul class='pm-entity-link-list'>
              {#each detailEntityLinks as link (link.id)}
                <li class='pm-entity-link'>
                  {#if link.entity_type === 'weblink' && link.url && smbCore(link.url)}
                    <i class='fas fa-server fa-fw mr-1' aria-hidden='true'></i>
                    <span class='mr-auto text-break'>{link.title}</span>
                    <a class='btn-unstyled mr-1' href={link.url} title={t('Open on Mac (smb://)')} aria-label={t('Open on Mac')}>
                      <i class='fab fa-apple fa-fw' aria-hidden='true'></i>
                    </a>
                    <button type='button' class='btn-unstyled mr-1' data-action='copy-unc-path' data-unc={uncPath(smbCore(link.url) ?? '')} title={t('Copy Windows path (paste into Explorer)')} aria-label={t('Copy Windows path')}>
                      <i class='fab fa-windows fa-fw' aria-hidden='true'></i>
                    </button>
                  {:else}
                    <span class='badge badge-info mr-1'>{entityTypeLabel(link.entity_type)}</span>
                    <a class='mr-auto text-break' href={entityViewUrl(link)} target='_blank' rel='noreferrer noopener'>{link.title}</a>
                  {/if}
                  <button type='button' class='btn-unstyled pm-comment-delete' title={t('Remove')} aria-label={t('Remove')} on:click={() => removeEntityLink(link)}>
                    <i class='fas fa-trash fa-fw' aria-hidden='true'></i>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          <div class='d-flex pm-dialog-row'>
            <input
              type='url'
              class='form-control'
              placeholder={t('https://… or smb://…')}
              bind:value={weblinkUrl}
              aria-label={t('Web address')}
            />
            <input
              type='text'
              class='form-control'
              placeholder={t('Label (optional)')}
              bind:value={weblinkLabel}
              aria-label={t('Link label')}
            />
            <button type='button' class='btn btn-secondary ml-2' disabled={addingWeblink || !weblinkUrl.trim()} on:click={addWeblink}>{t('Add')}</button>
          </div>
        </div>

        <div class='pm-dialog-field'>
          <span class='pm-label'>{t('Steps')}</span>
          {#if loadingSteps}
            <p class='pm-muted small'>{t('Loading')}…</p>
          {:else if detailSteps.length === 0}
            <p class='pm-muted small'>{t('No steps yet.')}</p>
          {:else}
            <ul class='pm-step-list'>
              {#each detailSteps as step (step.id)}
                <li class='pm-step' class:pm-step-done={step.finished}>
                  <input
                    type='checkbox'
                    checked={step.finished}
                    on:change={() => toggleStep(step)}
                    aria-label={step.body}
                  />
                  <span class='pm-step-body'>{step.body}</span>
                  <button type='button' class='btn-unstyled pm-comment-delete' title={t('Remove')} aria-label={t('Remove')} on:click={() => removeStep(step)}>
                    <i class='fas fa-trash fa-fw' aria-hidden='true'></i>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          <div class='d-flex pm-dialog-row'>
            <input
              type='text'
              class='form-control'
              placeholder={t('Add a step…')}
              bind:value={newStepText}
              on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addStep(); } }}
            />
            <button type='button' class='btn btn-secondary ml-2' disabled={addingStep || !newStepText.trim()} on:click={addStep}>{t('Add')}</button>
          </div>
        </div>

        <div class='pm-dialog-field'>
          <span class='pm-label'>{t('Comments')}</span>
          {#if loadingComments}
            <p class='pm-muted small'>{t('Loading')}…</p>
          {:else if detailComments.length === 0}
            <p class='pm-muted small'>{t('No comments yet.')}</p>
          {:else}
            <ul class='pm-comment-list'>
              {#each detailComments as comment (comment.id)}
                <li class='pm-comment'>
                  <div class='pm-comment-meta'>
                    <strong>{comment.author_fullname}</strong>
                    <span class='pm-muted'>{formatCommentTime(comment.created_at)}</span>
                    {#if comment.userid === core.currentUserid}
                      <button type='button' class='btn-unstyled pm-comment-delete' title={t('Delete')} aria-label={t('Delete')} on:click={() => deleteComment(comment)}>
                        <i class='fas fa-trash fa-fw' aria-hidden='true'></i>
                      </button>
                    {/if}
                  </div>
                  <div class='pm-comment-body'>{comment.body}</div>
                </li>
              {/each}
            </ul>
          {/if}
          <div class='d-flex pm-comment-form'>
            <input
              type='text'
              class='form-control'
              placeholder={t('Add a comment…')}
              bind:value={newCommentText}
              on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void postComment(); } }}
            />
            <button type='button' class='btn btn-secondary ml-2' disabled={postingComment || !newCommentText.trim()} on:click={postComment}>{t('Post')}</button>
          </div>
        </div>
      </div>
      <div class='todo-detail-footer'>
        {#if detailEditing}
          <button type='button' class='btn btn-ghost' on:click={cancelDetailEdit}>{t('Cancel')}</button>
          <button type='button' class='btn btn-primary' on:click={saveDetailEdit}>{t('Save')}</button>
        {:else}
          <button type='button' class='btn btn-ghost' on:click={closeDetail}>{t('Close')}</button>
          <button type='button' class='btn btn-primary' on:click={startDetailEdit}>{t('Edit')}</button>
        {/if}
      </div>
    </div>
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
