<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import { core } from '../core';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';
  import { applyMention, extractMentionQuery, wrapMentionsAsHtml, stripMentionHtml } from '../mentions';
  import { fetchLinkPreviewLabel, handleLinkPreviewPaste } from '../linkPreview';

  // Closes the @mention dropdown on any click outside its own container --
  // it otherwise stayed open until a mention was picked, even after
  // clicking elsewhere on the page.
  function clickOutside(node: HTMLElement, onOutsideClick: () => void): { destroy(): void } {
    const handleClick = (event: MouseEvent): void => {
      if (event.target instanceof Node && !node.contains(event.target)) {
        onOutsideClick();
      }
    };
    document.addEventListener('click', handleClick, true);
    return {
      destroy(): void {
        document.removeEventListener('click', handleClick, true);
      },
    };
  }

  type Priority = 'low' | 'medium' | 'high';

  type ColumnKind = 'todo' | 'in_progress' | 'done' | 'custom';

  type Column = {
    id: number;
    name: string;
    kind: ColumnKind;
    ordering: number;
  };

  type Task = {
    id: number;
    body: string;
    notes: string | null;
    description: string | null;
    deadline: string | null;
    completed_at: string | null;
    in_progress: boolean;
    pinned: boolean;
    priority: Priority | null;
    column_id: number | null;
    // the kind of task.column_id's own column -- present even when that
    // column belongs to a different project's private copy than whatever
    // is in `columns` right now (see tasksInColumn() below)
    column_kind: ColumnKind | null;
    creation_time: string;
    userid: number;
    team: number;
    assigned_userid: number | null;
    project_id: number | null;
    creator_fullname: string;
    assigned_fullname: string | null;
    assignees: TeamMember[];
    project_name: string | null;
    entity_links: EntityLink[];
  };

  type TeamMember = {
    userid: number;
    fullname: string;
  };

  type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'done';

  type Project = {
    id: number;
    name: string;
    description: string | null;
    target_end_date: string | null;
    status: ProjectStatus;
    userid: number;
    members: TeamMember[];
    archived: boolean;
    ordering: number;
  };

  type TaskComment = {
    id: number;
    body: string;
    created_at: string;
    userid: number;
    author_fullname: string;
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

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();

  let tasks: Task[] = [];
  // team-wide open/done totals for the progress bar -- see load() and the
  // doneCount/donePercent/totalCount reactive statements below
  let teamCounts: { open: number; done: number } | null = null;
  let teamMembers: TeamMember[] = [];
  let projects: Project[] = [];
  let columns: Column[] = [];
  // null = the "Unfiled" bucket (tasks with no project); 'all' = every project combined
  let activeProjectId: number | null | 'all' = 'all';
  let loading = true;
  // 'assigned' shows tasks assigned to me (by myself or someone else);
  // 'created' shows tasks I set up, whether for myself or someone else;
  // 'all' is the union of both -- never a view of everyone else's work
  // 'team' is the backend's actual "every task in the team" scope --
  // confusingly, its 'all' means "created by me OR assigned to me", which
  // is not what a board default should hide everything else behind
  let scope: 'assigned' | 'created' | 'all' | 'team' = 'team';
  // set while the detail dialog is open for a task that doesn't exist yet
  // (opened via a column's "+" button) -- steps and links can still be
  // added, buffered here since there's no task id to attach them to yet;
  // saveDetail() posts the task first, then each buffered step/link, then
  // closes. Comments stay hidden -- there's nothing to discuss yet.
  let creatingNewTask = false;
  let newTaskColumnId: number | null = null;
  let draftSteps: string[] = [];
  let draftLinks: { url: string; label: string }[] = [];
  let detailTask: Task | null = null;
  let detailEditing = false;
  let detailTitle = '';
  let detailDeadline = '';
  let detailAssignees: TeamMember[] = [];
  let detailPriority: Priority | '' = '';
  let detailProjectId: number | null = null;
  let detailDescription = '';
  let detailNotes = '';
  let savingDetail = false;
  let detailComments: TaskComment[] = [];
  let loadingComments = false;
  let newCommentText = '';
  // users @-mentioned in the comment currently being drafted, and the
  // dropdown of matching team members while typing "@something"
  let commentMentions: TeamMember[] = [];
  let mentionCandidates: TeamMember[] = [];
  let postingComment = false;
  let descriptionEl: HTMLDivElement;
  let notesEl: HTMLDivElement;
  let detailEntityLinks: EntityLink[] = [];
  let loadingEntityLinks = false;
  let weblinkUrl = '';
  let weblinkLabel = '';
  let addingWeblink = false;
  let detailSteps: Step[] = [];
  let loadingSteps = false;
  let newStepText = '';
  let addingStep = false;
  const COLUMN_TASK_LIMIT = 5;
  let expandedColumns: Record<number, boolean> = {};
  let searchQuery = '';
  let priorityFilter: Priority | 'all' = 'all';

  function matchesSearch(task: Task, query: string): boolean {
    if (query === '') return true;
    const haystack = [
      task.body,
      task.notes ?? '',
      task.description ?? '',
      task.project_name ?? '',
      task.creator_fullname,
      task.assigned_fullname ?? '',
      task.priority ?? '',
      ...task.assignees.map(a => a.fullname),
      ...task.entity_links.map(link => link.title ?? ''),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  $: activeProject = typeof activeProjectId === 'number' ? (projects.find(p => p.id === activeProjectId) ?? null) : null;
  $: assignableMembers = activeProject ? activeProject.members : teamMembers;
  $: normalizedSearch = searchQuery.trim().toLowerCase();
  function matchesScope(task: Task): boolean {
    switch (scope) {
    case 'assigned':
      return task.assignees.some(a => a.userid === core.currentUserid);
    case 'created':
      return task.userid === core.currentUserid;
    case 'all':
      return task.userid === core.currentUserid || task.assignees.some(a => a.userid === core.currentUserid);
    default:
      return true;
    }
  }

  $: visibleTasks = (activeProjectId === 'all' ? tasks : tasks.filter(task => task.project_id === activeProjectId))
    .filter(matchesScope)
    .filter(task => priorityFilter === 'all' || task.priority === priorityFilter)
    .filter(task => matchesSearch(task, normalizedSearch));
  $: doneColumn = columns.find(c => c.kind === 'done') ?? null;
  $: todoColumn = columns.find(c => c.kind === 'todo') ?? null;

  // `columns` only ever holds ONE project's column set at a time (see
  // loadColumns()) -- but in "All" scope, visibleTasks spans every project,
  // and each project gets its own private copy of column ids the first
  // time its board is opened (TodolistColumns::ensureProjectColumns()).
  // Matching by raw column_id would silently drop any task whose column
  // belongs to a project other than whichever one `columns` happens to be
  // scoped to right now, so match by column "kind" instead in that case --
  // it's the one thing every project's copy of a built-in column shares.
  // A single project's own tab keeps matching by exact id, since multiple
  // custom columns there can share kind 'custom' and must stay distinct.
  function tasksInColumn(column: Column, list: Task[]): Task[] {
    return activeProjectId === 'all'
      ? list.filter(task => task.column_kind === column.kind)
      : list.filter(task => task.column_id === column.id);
  }

  // team-wide totals from the server (see load()), independent of the
  // list's own LIMIT and of whatever priority/search/project filter is
  // currently applied -- computing this from visibleTasks.length instead
  // would go quietly wrong the moment the team has more tasks than a
  // single page of the list actually loads, exactly the same way the
  // list itself would silently miss tasks past that same page.
  $: totalCount = teamCounts ? teamCounts.open + teamCounts.done : visibleTasks.length;
  $: doneCount = teamCounts ? teamCounts.done : (doneColumn ? tasksInColumn(doneColumn, visibleTasks).length : 0);
  $: donePercent = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

  function canManage(task: Task): boolean {
    if (task.userid === core.currentUserid
      || task.assignees.some(a => a.userid === core.currentUserid)
      || core.isAdmin) {
      return true;
    }
    // mirrors Todolist::canWriteOrExplode() server-side: a project member
    // can manage any task in that project, not just their own/assigned ones
    if (task.project_id === null) return false;
    const project = projects.find(p => p.id === task.project_id);
    if (!project) return false;
    return project.userid === core.currentUserid
      || project.members.some(m => m.userid === core.currentUserid);
  }

  function addAssignee(list: TeamMember[], userid: number, pool: TeamMember[]): TeamMember[] {
    if (list.some(m => m.userid === userid)) return list;
    const member = pool.find(m => m.userid === userid);
    return member ? [...list, member] : list;
  }

  function initials(fullname: string): string {
    const parts = fullname.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function removeAssignee(list: TeamMember[], userid: number): TeamMember[] {
    return list.filter(m => m.userid !== userid);
  }

  function priorityLabel(priority: Priority): string {
    return {
      low: t('Low'),
      medium: t('Medium'),
      high: t('High'),
    }[priority];
  }

  function projectStatusLabel(status: ProjectStatus): string {
    return {
      planning: t('Planning'),
      active: t('Active'),
      on_hold: t('On hold'),
      done: t('Done'),
    }[status];
  }

  function formatDeadline(deadline: string | null): string {
    if (!deadline) return '';
    return new Date(deadline).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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

  // Strips rich-text HTML down to a short plain-text snippet for the card
  // preview -- the full formatted version still shows in the detail dialog.
  function plainPreview(html: string | null, maxLen = 140): string {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = (div.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text;
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

  async function loadTeamMembers(): Promise<void> {
    try {
      teamMembers = await ApiC.getJson('users?currentTeam=1') as TeamMember[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load team members.');
    }
  }

  let showArchivedProjects = false;

  async function loadProjects(): Promise<void> {
    try {
      projects = await ApiC.getJson(`${Model.TodolistProjects}?archived=${showArchivedProjects ? '1' : '0'}`) as Project[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load projects.');
    }
  }

  function toggleShowArchivedProjects(): void {
    showArchivedProjects = !showArchivedProjects;
    void loadProjects();
  }

  async function load(): Promise<void> {
    loading = true;
    try {
      // readAll() only returns either open or completed tasks per call
      // (the sidebar To-do widget relies on that split), so the board
      // fetches both and merges them to populate the To do/Done columns.
      // Always fetched team-wide (scope=team): being a project member
      // means seeing every task in it, regardless of who created or is
      // assigned to it -- the Assigned/Created/All tabs below are a
      // client-side filter on top of that, never a narrower fetch, so
      // switching tabs can't hide a task a project membership should show.
      // The list fetches above stay capped (see readAll()'s $limit) --
      // counts is a separate, cheap aggregate query with no such cap, so
      // the progress bar stays correct even past that page.
      const [open, done, counts] = await Promise.all([
        ApiC.getJson(`${Model.Todolist}?scope=team`) as Promise<Task[]>,
        ApiC.getJson(`${Model.Todolist}?scope=team&completed=1`) as Promise<Task[]>,
        ApiC.getJson(`${Model.Todolist}?scope=team&counts=1`) as Promise<Array<{ open_count: number; done_count: number }>>,
      ]);
      tasks = [...open, ...done];
      teamCounts = counts[0] ? { open: counts[0].open_count, done: counts[0].done_count } : null;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load tasks.');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const projectParam = searchParams.get('project');
    if (projectParam === 'all') {
      activeProjectId = 'all';
    } else {
      const numericParam = Number(projectParam);
      if (Number.isInteger(numericParam) && numericParam > 0) activeProjectId = numericParam;
    }

    // a notification (task assignment, mention in a comment) links here
    // with ?task=<id> -- make sure that task is actually visible (it may
    // belong to a project/scope other than whatever's currently selected)
    // and open its detail dialog once it's loaded
    const taskParam = Number(searchParams.get('task'));
    if (Number.isInteger(taskParam) && taskParam > 0) {
      activeProjectId = 'all';
      scope = 'team';
    }

    void loadTeamMembers();
    void loadProjects();
    void loadColumns();
    void load().then(async () => {
      if (!Number.isInteger(taskParam) || taskParam <= 0) return;
      let task = tasks.find(t => t.id === taskParam);
      if (!task) {
        // not on the first page of results (readAll() caps at 100) --
        // fetch it directly rather than making the user hunt for it
        try {
          task = await ApiC.getJson(`${Model.Todolist}/${taskParam}`) as Task;
          tasks = [...tasks, task];
        } catch {
          return;
        }
      }
      // now that we know which project the task actually belongs to,
      // land on that project's tab instead of leaving "All" selected
      activeProjectId = task.project_id ?? 'all';
      openDetail(task);
    });

    // Lets the Search side panel offer a "Link to task" button on its
    // results (see FavoriteFilters.class.ts) while a task's detail dialog is
    // open, the same way it offers "Link" while editing an experiment.
    const onEntityLinkAdded = (): void => {
      if (detailTask) void loadEntityLinks(detailTask.id);
    };
    window.addEventListener('elabftw:pm-entity-link-added', onEntityLinkAdded);
    return () => {
      window.removeEventListener('elabftw:pm-entity-link-added', onEntityLinkAdded);
      window.dispatchEvent(new CustomEvent('elabftw:pm-task-link-target', { detail: null }));
    };
  });

  function selectScope(next: 'assigned' | 'created' | 'all' | 'team'): void {
    scope = next;
    void load();
  }

  function selectProject(id: number | null | 'all'): void {
    activeProjectId = id;
    void loadColumns();
  }

  function openNewTaskInColumn(columnId: number): void {
    creatingNewTask = true;
    newTaskColumnId = columnId;
    draftSteps = [];
    draftLinks = [];
    newStepText = '';
    weblinkUrl = '';
    weblinkLabel = '';
    detailTask = {
      id: 0,
      body: '',
      notes: null,
      description: null,
      deadline: null,
      completed_at: null,
      in_progress: false,
      pinned: false,
      priority: null,
      column_id: columnId,
      column_kind: columns.find(c => c.id === columnId)?.kind ?? null,
      creation_time: '',
      userid: core.currentUserid,
      team: 0,
      assigned_userid: null,
      project_id: typeof activeProjectId === 'number' ? activeProjectId : null,
      creator_fullname: '',
      assigned_fullname: null,
      assignees: [],
      project_name: null,
      entity_links: [],
    };
    detailEditing = true;
    detailTitle = '';
    detailDeadline = '';
    detailAssignees = [];
    detailPriority = '';
    detailProjectId = detailTask.project_id;
    detailDescription = '';
    detailNotes = '';
  }

  async function loadColumns(): Promise<void> {
    try {
      const params = typeof activeProjectId === 'number' ? { project_id: String(activeProjectId) } : {};
      columns = await ApiC.getJson(Model.TodolistColumns, params) as Column[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load columns.');
    }
  }

  function sortedColumns(list: Column[]): Column[] {
    return [...list].sort((a, b) => a.ordering - b.ordering);
  }

  function adjacentColumn(column: Column, direction: -1 | 1): Column | null {
    const sorted = sortedColumns(columns);
    const idx = sorted.findIndex(c => c.id === column.id);
    return sorted[idx + direction] ?? null;
  }

  function toggleColumnExpanded(columnId: number): void {
    expandedColumns = { ...expandedColumns, [columnId]: !expandedColumns[columnId] };
  }

  // Single entry point for every column-to-column transition, used by both
  // the move buttons and drag-and-drop below, so a task moved either way
  // always ends up fully consistent (Todolist::patch() keeps completed_at/
  // in_progress in sync with whichever column's "kind" the task lands in).
  async function moveTaskToColumn(task: Task, columnId: number): Promise<void> {
    if (task.column_id === columnId) return;
    try {
      await ApiC.patch(`${Model.Todolist}/${task.id}`, { column_id: columnId });
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not move the task.');
    }
  }

  let selectedTaskIds = new Set<number>();

  function toggleTaskSelect(taskId: number): void {
    const next = new Set(selectedTaskIds);
    if (next.has(taskId)) {
      next.delete(taskId);
    } else {
      next.add(taskId);
    }
    selectedTaskIds = next;
  }

  async function bulkMoveToColumn(columnId: number): Promise<void> {
    const ids = [...selectedTaskIds];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map(id => ApiC.patch(`${Model.Todolist}/${id}`, { column_id: columnId })));
      selectedTaskIds = new Set();
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not move the selected tasks.');
    }
  }

  async function togglePin(task: Task): Promise<void> {
    try {
      await ApiC.patch(`${Model.Todolist}/${task.id}`, { pinned: !task.pinned });
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update the task.');
    }
  }

  let draggedTaskId: number | null = null;
  let draggedColumnId: number | null = null;
  let dragOverColumn: number | null = null;

  function startTaskDrag(event: DragEvent, id: number): void {
    draggedTaskId = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(id));
    }
  }

  function finishTaskDrag(): void {
    draggedTaskId = null;
    dragOverColumn = null;
  }

  function startColumnDrag(event: DragEvent, id: number): void {
    draggedColumnId = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `column:${id}`);
    }
  }

  function finishColumnDrag(): void {
    draggedColumnId = null;
    dragOverColumn = null;
  }

  function allowColumnDrop(event: DragEvent, columnId: number): void {
    if (draggedTaskId === null && draggedColumnId === null) return;
    event.preventDefault();
    dragOverColumn = columnId;
  }

  // One drop target per column serves both drags: a task dropped there
  // moves into that column; a column header dropped there swaps that
  // column's whole position with the drop target's.
  async function dropOnColumn(event: DragEvent, columnId: number): Promise<void> {
    event.preventDefault();
    if (draggedColumnId !== null) {
      const sourceId = draggedColumnId;
      finishColumnDrag();
      if (sourceId === columnId) return;
      await reorderColumn(sourceId, columnId);
      return;
    }
    const taskId = draggedTaskId;
    finishTaskDrag();
    // dragging a task that's part of a multi-selection moves the whole
    // selection together, not just the one card that was dragged
    if (taskId !== null && selectedTaskIds.size > 1 && selectedTaskIds.has(taskId)) {
      await bulkMoveToColumn(columnId);
      return;
    }
    const task = taskId === null ? undefined : tasks.find(t => t.id === taskId);
    if (task) await moveTaskToColumn(task, columnId);
  }

  async function reorderColumn(sourceId: number, targetId: number): Promise<void> {
    const sorted = sortedColumns(columns);
    const sourceIdx = sorted.findIndex(c => c.id === sourceId);
    const targetIdx = sorted.findIndex(c => c.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    try {
      await Promise.all(
        reordered
          .map((column, index) => ({ column, index }))
          .filter(({ column, index }) => column.ordering !== index)
          .map(({ column, index }) => ApiC.patch(`${Model.TodolistColumns}/${column.id}`, { ordering: index })),
      );
      await loadColumns();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not reorder that column.');
    }
  }

  let draggedProjectId: number | null = null;
  let dragOverProjectId: number | null = null;

  function startProjectDrag(event: DragEvent, id: number): void {
    draggedProjectId = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `project:${id}`);
    }
  }

  function finishProjectDrag(): void {
    draggedProjectId = null;
    dragOverProjectId = null;
  }

  function allowProjectDrop(event: DragEvent, projectId: number): void {
    if (draggedProjectId === null) return;
    event.preventDefault();
    dragOverProjectId = projectId;
  }

  async function dropOnProjectTab(event: DragEvent, projectId: number): Promise<void> {
    event.preventDefault();
    const sourceId = draggedProjectId;
    finishProjectDrag();
    if (sourceId === null || sourceId === projectId) return;
    await reorderProject(sourceId, projectId);
  }

  async function reorderProject(sourceId: number, targetId: number): Promise<void> {
    const sourceIdx = projects.findIndex(p => p.id === sourceId);
    const targetIdx = projects.findIndex(p => p.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;
    const reordered = [...projects];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    try {
      await Promise.all(
        reordered
          .map((project, index) => ({ project, index }))
          .filter(({ project, index }) => project.ordering !== index)
          .map(({ project, index }) => ApiC.patch(`${Model.TodolistProjects}/${project.id}`, { ordering: index })),
      );
      await loadProjects();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not reorder that project.');
    }
  }

  let columnDialogOpen = false;
  let newColumnName = '';
  let addingColumn = false;

  function openColumnDialog(): void {
    columnDialogOpen = true;
  }

  function closeColumnDialog(): void {
    columnDialogOpen = false;
    newColumnName = '';
  }

  async function addColumn(): Promise<void> {
    const name = newColumnName.trim();
    if (!name) return;
    addingColumn = true;
    try {
      await ApiC.post(Model.TodolistColumns, {
        name,
        project_id: typeof activeProjectId === 'number' ? activeProjectId : null,
      });
      newColumnName = '';
      await loadColumns();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not add that column.');
    } finally {
      addingColumn = false;
    }
  }

  async function renameColumn(column: Column, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || trimmed === column.name) return;
    try {
      await ApiC.patch(`${Model.TodolistColumns}/${column.id}`, { name: trimmed });
      await loadColumns();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not rename that column.');
    }
  }

  async function deleteColumn(column: Column): Promise<void> {
    if (!confirm(`Delete the "${column.name}" column? Any tasks in it move to To do.`)) return;
    try {
      await ApiC.delete(`${Model.TodolistColumns}/${column.id}`);
      await Promise.all([loadColumns(), load()]);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete that column.');
    }
  }

  async function moveColumn(column: Column, direction: -1 | 1): Promise<void> {
    const swapWith = adjacentColumn(column, direction);
    if (!swapWith) return;
    try {
      await Promise.all([
        ApiC.patch(`${Model.TodolistColumns}/${column.id}`, { ordering: swapWith.ordering }),
        ApiC.patch(`${Model.TodolistColumns}/${swapWith.id}`, { ordering: column.ordering }),
      ]);
      await loadColumns();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not reorder that column.');
    }
  }

  async function deleteTask(task: Task): Promise<void> {
    try {
      await ApiC.delete(`${Model.Todolist}/${task.id}`);
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete the task.');
    }
  }

  function toDateInputValue(deadline: string | null): string {
    if (!deadline) return '';
    return deadline.slice(0, 10);
  }

  function openDetail(task: Task): void {
    detailTask = task;
    detailEditing = false;
    detailTitle = task.body;
    detailDeadline = toDateInputValue(task.deadline);
    detailAssignees = [...task.assignees];
    detailPriority = task.priority ?? '';
    detailProjectId = task.project_id;
    detailDescription = task.description ?? '';
    detailNotes = task.notes ?? '';
    newCommentText = '';
    weblinkUrl = '';
    weblinkLabel = '';
    void loadComments(task.id);
    void loadEntityLinks(task.id);
    void loadSteps(task.id);
    window.dispatchEvent(new CustomEvent('elabftw:pm-task-link-target', { detail: { id: task.id, title: task.body } }));
  }

  function closeDetail(): void {
    detailTask = null;
    detailEditing = false;
    creatingNewTask = false;
    newTaskColumnId = null;
    draftSteps = [];
    draftLinks = [];
    detailComments = [];
    detailEntityLinks = [];
    detailSteps = [];
    newStepText = '';
    window.dispatchEvent(new CustomEvent('elabftw:pm-task-link-target', { detail: null }));
  }

  function startEdit(): void {
    detailEditing = true;
  }

  function cancelEdit(): void {
    if (!detailTask) return;
    if (creatingNewTask) {
      closeDetail();
      return;
    }
    detailTitle = detailTask.body;
    detailDeadline = toDateInputValue(detailTask.deadline);
    detailAssignees = [...detailTask.assignees];
    detailPriority = detailTask.priority ?? '';
    detailProjectId = detailTask.project_id;
    detailDescription = detailTask.description ?? '';
    detailNotes = detailTask.notes ?? '';
    detailEditing = false;
  }

  async function saveDetail(): Promise<void> {
    if (!detailTask) return;
    const title = detailTitle.trim();
    if (!title) {
      notify.error('Enter a task title.');
      return;
    }
    savingDetail = true;
    try {
      if (creatingNewTask) {
        const newId = await ApiC.post2location(Model.Todolist, {
          content: title,
          deadline: detailDeadline || null,
          assignee_userids: detailAssignees.map(a => a.userid),
          priority: detailPriority || null,
          project_id: detailProjectId,
          column_id: newTaskColumnId,
        });
        for (const body of draftSteps) {
          await ApiC.post(`${Model.Todolist}/${newId}/steps`, { body });
        }
        for (const link of draftLinks) {
          await ApiC.post(`${Model.Todolist}/${newId}/entity_links`, {
            entity_type: 'weblink',
            url: link.url,
            label: link.label,
          });
        }
        closeDetail();
        await load();
        return;
      }
      await ApiC.patch(`${Model.Todolist}/${detailTask.id}`, {
        content: title,
        deadline: detailDeadline || null,
        assignee_userids: detailAssignees.map(a => a.userid),
        priority: detailPriority || null,
        project_id: detailProjectId,
        description: descriptionEl?.innerHTML ?? detailDescription,
        notes: notesEl?.innerHTML ?? detailNotes,
      });
      const updated = await ApiC.getJson(`${Model.Todolist}/${detailTask.id}`) as Task;
      detailTask = updated;
      detailDescription = updated.description ?? '';
      detailNotes = updated.notes ?? '';
      detailEditing = false;
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save the task.');
    } finally {
      savingDetail = false;
    }
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

  function removeDraftLink(index: number): void {
    draftLinks = draftLinks.filter((_, i) => i !== index);
  }

  async function addWeblink(): Promise<void> {
    if (!detailTask) return;
    const url = normalizeWeblinkUrl(weblinkUrl);
    if (!url) {
      notify.error('Enter a valid web address.');
      return;
    }
    const label = weblinkLabel.trim() || await fetchLinkPreviewLabel(url);
    if (creatingNewTask) {
      draftLinks = [...draftLinks, { url, label }];
      weblinkUrl = '';
      weblinkLabel = '';
      return;
    }
    addingWeblink = true;
    try {
      await ApiC.post(`${Model.Todolist}/${detailTask.id}/entity_links`, {
        entity_type: 'weblink',
        url,
        label,
      });
      weblinkUrl = '';
      weblinkLabel = '';
      await loadEntityLinks(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not add that link.');
    } finally {
      addingWeblink = false;
    }
  }

  let editingWeblinkId: number | null = null;
  let editWeblinkUrl = '';
  let editWeblinkLabel = '';

  function startEditWeblink(link: EntityLink): void {
    editingWeblinkId = link.id;
    editWeblinkUrl = link.url ?? '';
    editWeblinkLabel = link.title ?? '';
  }

  function cancelEditWeblink(): void {
    editingWeblinkId = null;
  }

  async function saveEditWeblink(link: EntityLink): Promise<void> {
    if (!detailTask) return;
    const url = editWeblinkUrl.trim();
    if (!url) return;
    try {
      await ApiC.patch(`${Model.Todolist}/${detailTask.id}/entity_links/${link.id}`, {
        url,
        label: editWeblinkLabel.trim(),
      });
      editingWeblinkId = null;
      await loadEntityLinks(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save that link.');
    }
  }

  async function removeEntityLink(link: EntityLink): Promise<void> {
    if (!detailTask) return;
    try {
      await ApiC.delete(`${Model.Todolist}/${detailTask.id}/entity_links/${link.id}`);
      await loadEntityLinks(detailTask.id);
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

  function removeDraftStep(index: number): void {
    draftSteps = draftSteps.filter((_, i) => i !== index);
  }

  async function addStep(): Promise<void> {
    if (!detailTask) return;
    const body = newStepText.trim();
    if (!body) return;
    if (creatingNewTask) {
      draftSteps = [...draftSteps, body];
      newStepText = '';
      return;
    }
    addingStep = true;
    try {
      await ApiC.post(`${Model.Todolist}/${detailTask.id}/steps`, { body });
      newStepText = '';
      await loadSteps(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not add that step.');
    } finally {
      addingStep = false;
    }
  }

  async function toggleStep(step: Step): Promise<void> {
    if (!detailTask) return;
    try {
      await ApiC.patch(`${Model.Todolist}/${detailTask.id}/steps/${step.id}`, { finished: !step.finished });
      await loadSteps(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update that step.');
    }
  }

  async function removeStep(step: Step): Promise<void> {
    if (!detailTask) return;
    try {
      await ApiC.delete(`${Model.Todolist}/${detailTask.id}/steps/${step.id}`);
      await loadSteps(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not remove that step.');
    }
  }

  let editingStepId: number | null = null;
  let editStepDraft = '';

  function startEditStep(step: Step): void {
    editingStepId = step.id;
    editStepDraft = step.body;
  }

  function cancelEditStep(): void {
    editingStepId = null;
  }

  async function saveEditStep(step: Step): Promise<void> {
    if (!detailTask) return;
    const body = editStepDraft.trim();
    if (!body) return;
    try {
      await ApiC.patch(`${Model.Todolist}/${detailTask.id}/steps/${step.id}`, { body });
      editingStepId = null;
      await loadSteps(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save that step.');
    }
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
    if (!body || !detailTask) return;
    postingComment = true;
    try {
      const mentionedUserids = commentMentions
        .filter(m => body.includes(`@${m.fullname}`))
        .map(m => m.userid);
      const htmlBody = wrapMentionsAsHtml(body, teamMembers);
      await ApiC.post(`${Model.Todolist}/${detailTask.id}/${Model.Comment}`, { body: htmlBody, mentioned_userids: mentionedUserids });
      newCommentText = '';
      commentMentions = [];
      await loadComments(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post the comment.');
    } finally {
      postingComment = false;
    }
  }

  // a task tied to a project can only be usefully mentioned-at by that
  // project's own members (plus its creator, who isn't always in the
  // explicit member list) -- narrows the dropdown and matches who can
  // actually see the task per Todolist's own visibility rules
  function mentionPoolForTask(task: Task | null): TeamMember[] {
    if (!task || task.project_id === null) return teamMembers;
    const project = projects.find(p => p.id === task.project_id);
    if (!project) return teamMembers;
    const pool = [...project.members];
    for (const userid of [project.userid, core.currentUserid]) {
      if (!pool.some(m => m.userid === userid)) {
        const member = teamMembers.find(m => m.userid === userid);
        if (member) pool.push(member);
      }
    }
    return pool;
  }

  function onCommentInput(): void {
    const query = extractMentionQuery(newCommentText);
    if (query === null) {
      mentionCandidates = [];
      return;
    }
    const lower = query.toLowerCase();
    mentionCandidates = mentionPoolForTask(detailTask).filter(m => m.fullname.toLowerCase().includes(lower)).slice(0, 5);
  }

  function pickMention(member: TeamMember): void {
    const query = extractMentionQuery(newCommentText) ?? '';
    newCommentText = applyMention(newCommentText, query, member.fullname);
    if (!commentMentions.some(m => m.userid === member.userid)) {
      commentMentions = [...commentMentions, member];
    }
    mentionCandidates = [];
  }

  async function deleteComment(comment: TaskComment): Promise<void> {
    if (!detailTask) return;
    try {
      await ApiC.delete(`${Model.Todolist}/${detailTask.id}/${Model.Comment}/${comment.id}`);
      await loadComments(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete the comment.');
    }
  }

  let editingCommentId: number | null = null;
  let editCommentDraft = '';

  function startEditComment(comment: TaskComment): void {
    editingCommentId = comment.id;
    editCommentDraft = stripMentionHtml(comment.body);
  }

  function cancelEditComment(): void {
    editingCommentId = null;
  }

  async function saveEditComment(comment: TaskComment): Promise<void> {
    if (!detailTask) return;
    const text = editCommentDraft.trim();
    if (!text) return;
    try {
      const body = wrapMentionsAsHtml(text, teamMembers);
      await ApiC.patch(`${Model.Todolist}/${detailTask.id}/${Model.Comment}/${comment.id}`, { body });
      editingCommentId = null;
      await loadComments(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save this comment.');
    }
  }

  // A lightweight rich-text toolbar (contenteditable + execCommand) rather
  // than wiring the full TinyMCE editor into a Svelte-managed dialog -- gives
  // headings/bullets/bold without the added integration risk.
  function exec(el: HTMLElement | undefined, cmd: string, value?: string): void {
    if (!el) return;
    el.focus();
    document.execCommand(cmd, false, value ?? '');
    // execCommand('removeFormat') only strips inline styling (bold,
    // italic, ...) -- it leaves block-level formatting (headings,
    // blockquotes) untouched, so a heading stays a heading. Follow it
    // with formatBlock to a plain paragraph to actually reset the block.
    if (cmd === 'removeFormat') {
      document.execCommand('formatBlock', false, '<p>');
    }
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

  // project dialog: null = creating a new project; a project = editing it
  let projectDialogOpen = false;
  let editingProject: Project | null = null;
  let dialogName = '';
  let dialogDescription = '';
  let dialogDescriptionEl: HTMLDivElement;
  let dialogTargetEndDate = '';
  let dialogStatus: ProjectStatus = 'planning';
  let dialogMembers: TeamMember[] = [];
  let savingProject = false;

  function openProjectDialog(project: Project | null): void {
    editingProject = project;
    dialogName = project?.name ?? '';
    dialogDescription = project?.description ?? '';
    dialogTargetEndDate = toDateInputValue(project?.target_end_date ?? null);
    dialogStatus = project?.status ?? 'planning';
    dialogMembers = project ? [...project.members] : [];
    // whoever's managing a project should always end up a member of it,
    // whether that's by explicitly picking themselves (no longer possible,
    // see the "Add a member" dropdown) or just opening the dialog
    const self = teamMembers.find(m => m.userid === core.currentUserid);
    if (self && !dialogMembers.some(m => m.userid === self.userid)) {
      dialogMembers = [...dialogMembers, self];
    }
    projectDialogOpen = true;
  }

  function closeProjectDialog(): void {
    projectDialogOpen = false;
  }

  function addDialogMember(userid: number): void {
    if (dialogMembers.some(m => m.userid === userid)) return;
    const member = teamMembers.find(m => m.userid === userid);
    if (member) dialogMembers = [...dialogMembers, member];
  }

  function removeDialogMember(userid: number): void {
    dialogMembers = dialogMembers.filter(m => m.userid !== userid);
  }

  async function saveProject(): Promise<void> {
    const name = dialogName.trim();
    if (!name) return;
    savingProject = true;
    try {
      const memberIds = dialogMembers.map(m => m.userid);
      const description = dialogDescriptionEl?.innerHTML ?? dialogDescription;
      if (editingProject) {
        await ApiC.patch(`${Model.TodolistProjects}/${editingProject.id}`, {
          name,
          description,
          target_end_date: dialogTargetEndDate || null,
          status: dialogStatus,
          members: memberIds,
        });
      } else {
        const response = await ApiC.post(Model.TodolistProjects, {
          name,
          description,
          target_end_date: dialogTargetEndDate || null,
          status: dialogStatus,
          members: memberIds,
        });
        const location = response.headers.get('Location') ?? '';
        const newId = Number(location.split('/').filter(Boolean).pop());
        if (Number.isInteger(newId) && newId > 0) activeProjectId = newId;
      }
      closeProjectDialog();
      await loadProjects();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save the project.');
    } finally {
      savingProject = false;
    }
  }

  async function setProjectArchived(archived: boolean): Promise<void> {
    if (!editingProject) return;
    if (archived && !window.confirm(t('Archive this project? It disappears from the normal project list (its tasks are unaffected and stay visible), and can be restored later from "Show archived".'))) return;
    savingProject = true;
    try {
      await ApiC.patch(`${Model.TodolistProjects}/${editingProject.id}`, { archived });
      if (archived && activeProjectId === editingProject.id) activeProjectId = 'all';
      closeProjectDialog();
      await loadProjects();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update the project.');
    } finally {
      savingProject = false;
    }
  }
</script>

<div class="pm-board">
  <div class="pm-project-row">
    {#each projects as project (project.id)}
      <button
        type="button"
        class="pm-project-tab"
        class:active={activeProjectId === project.id}
        class:pm-project-tab-drag-over={dragOverProjectId === project.id}
        draggable="true"
        on:click={() => selectProject(project.id)}
        on:dragstart={(event) => startProjectDrag(event, project.id)}
        on:dragend={finishProjectDrag}
        on:dragover={(event) => allowProjectDrop(event, project.id)}
        on:dragleave={() => { if (dragOverProjectId === project.id) dragOverProjectId = null; }}
        on:drop={(event) => dropOnProjectTab(event, project.id)}
      >
        {project.name}
      </button>
    {/each}
    <button type="button" class="pm-project-tab" class:active={activeProjectId === 'all'} on:click={() => selectProject('all')}>
      {t('All')}
    </button>
    <button type="button" class="pm-project-tab" class:active={activeProjectId === null} on:click={() => selectProject(null)}>
      {t('Unfiled')}
    </button>
    {#if activeProject}
      <button type="button" class="pm-manage-btn" title={t('Manage this project')} aria-label={t('Manage this project')} on:click={() => openProjectDialog(activeProject)}>
        <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
      </button>
    {/if}
    <button type="button" class="pm-project-tab-new" on:click={() => openProjectDialog(null)}>+ {t('New project')}</button>
    <button type="button" class="pm-manage-btn" class:active={showArchivedProjects} title={showArchivedProjects ? t('Show active projects') : t('Show archived projects')} aria-label={showArchivedProjects ? t('Show active projects') : t('Show archived projects')} on:click={toggleShowArchivedProjects}>
      <i class="fas fa-box-archive fa-fw" aria-hidden="true"></i>
    </button>
    <button type="button" class="pm-manage-btn ml-auto" title={t('Manage columns')} aria-label={t('Manage columns')} on:click={openColumnDialog}>
      <i class="fas fa-table-columns fa-fw" aria-hidden="true"></i>
    </button>
    <button
      type="button"
      class="pm-manage-btn"
      title={t('View my sidebar to-dos')}
      aria-label={t('View my sidebar to-dos')}
      on:click={() => {
        const panel = document.getElementById('todolistPanel');
        if (panel?.hasAttribute('hidden')) {
          (document.querySelector('[data-action="toggle-sidepanel"][data-target="todolist"]') as HTMLElement | null)?.click();
        }
      }}
    >
      <i class="fas fa-list-check fa-fw" aria-hidden="true"></i>
    </button>
  </div>

  <div class="pm-search mt-2 d-flex align-items-start flex-wrap" style="gap:0.5rem">
    <div class="flex-grow-1">
      <input
        class="form-control form-control-sm"
        type="search"
        placeholder={t('Search tasks…')}
        title={t('Searches title, notes, description, project, priority, people and linked items')}
        bind:value={searchQuery}
      />
      <span class="pm-muted small">{t('Searches: title, notes, description, project, priority, people, links')}</span>
    </div>
    <select class="form-control form-control-sm pm-priority-filter" bind:value={priorityFilter} aria-label={t('Filter by priority')}>
      <option value="all">{t('All priorities')}</option>
      <option value="low">{priorityLabel('low')}</option>
      <option value="medium">{priorityLabel('medium')}</option>
      <option value="high">{priorityLabel('high')}</option>
    </select>
  </div>

  {#if activeProject}
    <div class="pm-project-description">
      <div class="d-flex align-items-center flex-wrap" style="gap:0.4rem">
        <span class="badge pm-project-status pm-project-status-{activeProject.status}">{projectStatusLabel(activeProject.status)}</span>
        {#if activeProject.target_end_date}
          <span class="pm-muted small"><i class="fas fa-flag-checkered fa-fw mr-1" aria-hidden="true"></i>{t('Target')}: {formatDeadline(activeProject.target_end_date)}</span>
        {/if}
      </div>
      <span class="pm-label mb-0 mt-2 d-block">{t('Goals / description')}</span>
      {#if activeProject.description}
        <div class="pm-project-description-body">{@html activeProject.description}</div>
      {:else}
        <p class="pm-muted small mb-0">{t('No description yet.')}</p>
      {/if}
    </div>
  {/if}
  {#if visibleTasks.length > 0}
    <div class="pm-progress mt-2" title={`${doneCount} / ${totalCount} ${t('done')}`}>
      <div class="pm-progress-bar" style={`width: ${donePercent}%`}></div>
      <span class="pm-progress-label">{donePercent}% {t('done')}</span>
    </div>
  {/if}

  <div class="mb-3 mt-2">
    <button
      type="button"
      class="btn btn-primary"
      on:click={() => openNewTaskInColumn(todoColumn?.id ?? sortedColumns(columns)[0]?.id ?? 0)}
      disabled={columns.length === 0}
    >
      <i class="fas fa-plus fa-fw mr-1" aria-hidden="true"></i>{t('Add task')}
    </button>
  </div>

  <div class="d-flex align-items-center my-3">
    <div class="btn-group btn-group-sm" role="group" aria-label={t('Task view')}>
      <button type="button" class={scope === 'team' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectScope('team')}>
        <i class="fas fa-list fa-fw mr-1" aria-hidden="true"></i>{t('All')}
      </button>
      <button type="button" class={scope === 'assigned' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectScope('assigned')}>
        <i class="fas fa-user fa-fw mr-1" aria-hidden="true"></i>{t('Assigned to me')}
      </button>
      <button type="button" class={scope === 'created' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectScope('created')}>
        <i class="fas fa-pen-to-square fa-fw mr-1" aria-hidden="true"></i>{t('Created by me')}
      </button>
    </div>
  </div>

  {#if selectedTaskIds.size > 0}
    <div class="pm-bulk-bar d-flex align-items-center flex-wrap mb-2">
      <span class="mr-2">{selectedTaskIds.size} {t('selected')}</span>
      <select
        class="form-control form-control-sm mr-2"
        style="width:auto"
        value=""
        on:change={(event) => {
          const value = (event.target as HTMLSelectElement).value;
          if (value !== '') void bulkMoveToColumn(Number(value));
          (event.target as HTMLSelectElement).value = '';
        }}
        aria-label={t('Move to column')}
      >
        <option value="" disabled>{t('Move to column…')}</option>
        {#each sortedColumns(columns) as column (column.id)}
          <option value={column.id}>{column.name}</option>
        {/each}
      </select>
      <button type="button" class="btn btn-ghost btn-sm" on:click={() => selectedTaskIds = new Set()}>{t('Clear selection')}</button>
    </div>
  {/if}

  {#if loading}
    <p class="pm-muted">{t('Loading')}…</p>
  {:else}
    <div class="pm-columns">
      {#each sortedColumns(columns) as column (column.id)}
        {@const columnTasks = tasksInColumn(column, visibleTasks)}
        {@const prevCol = adjacentColumn(column, -1)}
        {@const nextCol = adjacentColumn(column, 1)}
        {@const columnExpanded = !!expandedColumns[column.id]}
        {@const shownTasks = columnExpanded ? columnTasks : columnTasks.slice(0, COLUMN_TASK_LIMIT)}
        {@const hiddenCount = columnTasks.length - shownTasks.length}
        <div
          class="pm-column"
          class:pm-column-drag-over={dragOverColumn === column.id}
          on:dragover={(event) => allowColumnDrop(event, column.id)}
          on:dragleave={() => { if (dragOverColumn === column.id) dragOverColumn = null; }}
          on:drop={(event) => dropOnColumn(event, column.id)}
        >
          <div class="d-flex align-items-center pm-column-header">
            <h3
              class="h6 pm-column-title"
              draggable="true"
              title={t('Drag to reorder this column')}
              on:dragstart={(event) => startColumnDrag(event, column.id)}
              on:dragend={finishColumnDrag}
            >{column.name} <span class="badge badge-secondary">{columnTasks.length}</span></h3>
            <button type="button" class="btn-unstyled pm-column-add-btn ml-auto" title={`${t('Add a task to')} ${column.name}`} aria-label={`${t('Add a task to')} ${column.name}`} on:click={() => openNewTaskInColumn(column.id)}>
              <i class="fas fa-plus fa-fw" aria-hidden="true"></i>
            </button>
          </div>
          {#if columnTasks.length === 0}
            <p class="pm-muted">{t('Nothing here.')}</p>
          {/if}
          {#each shownTasks as task (task.id)}
            <div
              class="pm-card pm-task"
              class:pm-task-done={column.kind === 'done'}
              class:pm-task-pinned={task.pinned}
              draggable={canManage(task)}
              on:dragstart={(event) => startTaskDrag(event, task.id)}
              on:dragend={finishTaskDrag}
            >
              <div class="d-flex align-items-start">
                {#if canManage(task)}
                  <input
                    type="checkbox"
                    class="pm-task-select-checkbox mr-2 mt-1"
                    checked={selectedTaskIds.has(task.id)}
                    on:change={() => toggleTaskSelect(task.id)}
                    title={t('Select')}
                    aria-label={t('Select')}
                  />
                {/if}
                <button type="button" class="pm-task-title-btn flex-grow-1" on:click={() => openDetail(task)}>{task.body}</button>
              </div>
              {#if canManage(task)}
                <div class="pm-task-actions">
                  {#if doneColumn}
                    <button type="button" class="btn btn-ghost btn-sm pm-icon-button" class:pm-icon-button-active={column.kind === 'done'} title={column.kind === 'done' ? t('Mark as not done') : t('Mark as done')} aria-label={column.kind === 'done' ? t('Mark as not done') : t('Mark as done')} on:click={() => moveTaskToColumn(task, column.kind === 'done' ? (todoColumn?.id ?? column.id) : doneColumn.id)}>
                      <i class={`fas ${column.kind === 'done' ? 'fa-rotate-left' : 'fa-check'} fa-fw`} aria-hidden="true"></i>
                    </button>
                  {/if}
                  <button type="button" class="btn btn-ghost btn-sm pm-icon-button" class:pm-icon-button-active={task.pinned} title={task.pinned ? t('Unpin') : t('Pin to top')} aria-label={task.pinned ? t('Unpin') : t('Pin to top')} on:click={() => togglePin(task)}>
                    <i class="fas fa-thumbtack fa-fw" aria-hidden="true"></i>
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm pm-icon-button" title={t('Edit')} aria-label={t('Edit')} on:click={() => openDetail(task)}>
                    <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
                  </button>
                  {#if prevCol}
                    <button type="button" class="btn btn-ghost btn-sm pm-icon-button" title={`${t('Move to')} ${prevCol.name}`} aria-label={`${t('Move to')} ${prevCol.name}`} on:click={() => moveTaskToColumn(task, prevCol.id)}>
                      <i class="fas fa-arrow-left fa-fw" aria-hidden="true"></i>
                    </button>
                  {/if}
                  {#if nextCol}
                    <button type="button" class="btn btn-ghost btn-sm pm-icon-button" title={`${t('Move to')} ${nextCol.name}`} aria-label={`${t('Move to')} ${nextCol.name}`} on:click={() => moveTaskToColumn(task, nextCol.id)}>
                      <i class="fas fa-arrow-right fa-fw" aria-hidden="true"></i>
                    </button>
                  {/if}
                  <button type="button" class="btn btn-danger-ghost btn-sm pm-icon-button" title={t('Delete')} aria-label={t('Delete')} on:click={() => deleteTask(task)}>
                    <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                  </button>
                </div>
              {/if}
              {#if activeProjectId === 'all'}
                <span class="badge badge-info mt-1">{task.project_name ?? t('Unfiled')}</span>
              {/if}
              {#if task.priority}
                <span class="badge pm-priority pm-priority-{task.priority} mt-1">{priorityLabel(task.priority)}</span>
              {/if}
              {#if task.deadline}
                <div class="pm-muted pm-task-meta"><i class="fas fa-calendar fa-fw mr-1" aria-hidden="true"></i>{formatDeadline(task.deadline)}</div>
              {/if}
              {#if task.description}
                <p class="pm-muted pm-task-preview">{plainPreview(task.description)}</p>
              {/if}
              {#if task.notes}
                <p class="pm-muted pm-task-preview">{plainPreview(task.notes)}</p>
              {/if}
              <div class="pm-task-meta d-flex align-items-center flex-wrap mt-1">
                {#if task.assignees.length === 0}
                  <span class="badge badge-info mr-1"><i class="fas fa-user fa-fw mr-1" aria-hidden="true"></i>{t('Unassigned')}</span>
                {:else}
                  <div class="pm-avatar-group">
                    {#each task.assignees as assignee (assignee.userid)}
                      <span class="pm-avatar" title={assignee.fullname}>{initials(assignee.fullname)}</span>
                    {/each}
                  </div>
                {/if}
                {#if scope === 'created' && !task.assignees.some(a => a.userid === task.userid)}
                  <span class="pm-muted mr-1">{t('from')} {task.creator_fullname}</span>
                {/if}
              </div>
            </div>
          {/each}
          {#if hiddenCount > 0 || columnExpanded && columnTasks.length > COLUMN_TASK_LIMIT}
            <button type="button" class="btn btn-link btn-sm pm-show-older" on:click={() => toggleColumnExpanded(column.id)}>
              {columnExpanded ? t('Show less') : `${t('Show')} ${hiddenCount} ${t('older')}`}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if detailTask}
  <div class="pm-overlay pm-overlay-task" role="presentation">
    <div class="pm-dialog pm-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="pmDetailTitle">
      <div class="pm-dialog-header">
        <h4 id="pmDetailTitle" class="mb-0">{detailEditing ? t('Edit task') : detailTask.body}</h4>
        {#if detailTask.project_name}<span class="badge badge-info">{detailTask.project_name}</span>{/if}
        <button type="button" class="pm-close-btn" on:click={closeDetail} aria-label={t('Close')}>&times;</button>
      </div>
      <div class="pm-dialog-body">

        {#if detailEditing}
          <div class="pm-dialog-field">
            <label class="pm-label" for="pm-detail-title">{t('Title')}</label>
            <input id="pm-detail-title" type="text" class="form-control" bind:value={detailTitle} />
          </div>

          <div class="d-flex pm-dialog-row">
            <div class="pm-dialog-field flex-grow-1">
              <label class="pm-label" for="pm-detail-deadline">{t('Deadline')}</label>
              <input id="pm-detail-deadline" type="date" class="form-control" bind:value={detailDeadline} />
            </div>
            <div class="pm-dialog-field flex-grow-1">
              <label class="pm-label" for="pm-detail-priority">{t('Priority')}</label>
              <select id="pm-detail-priority" class="form-control" bind:value={detailPriority}>
                <option value="">{t('None')}</option>
                <option value="low">{t('Low')}</option>
                <option value="medium">{t('Medium')}</option>
                <option value="high">{t('High')}</option>
              </select>
            </div>
          </div>
          <div class="d-flex pm-dialog-row">
            <div class="pm-dialog-field flex-grow-1">
              <label class="pm-label" for="pm-detail-project">{t('Project')}</label>
              <select id="pm-detail-project" class="form-control" bind:value={detailProjectId}>
                <option value={null}>{t('Unfiled')}</option>
                {#each projects as project (project.id)}
                  <option value={project.id}>{project.name}</option>
                {/each}
              </select>
            </div>
            {#if creatingNewTask}
              <div class="pm-dialog-field flex-grow-1">
                <label class="pm-label" for="pm-detail-column">{t('Column')}</label>
                <select id="pm-detail-column" class="form-control" bind:value={newTaskColumnId}>
                  {#each sortedColumns(columns) as column (column.id)}
                    <option value={column.id}>{column.name}</option>
                  {/each}
                </select>
              </div>
            {/if}
          </div>
          <div class="d-flex pm-dialog-row">
            <div class="pm-dialog-field flex-grow-1">
              <label class="pm-label" for="pm-detail-assignee">{t('Assigned to')}</label>
              <div class="pm-chips">
                {#each detailAssignees as member (member.userid)}
                  <span class="pm-chip">
                    {member.fullname}
                    <button type="button" aria-label={`${t('Remove')} ${member.fullname}`} on:click={() => detailAssignees = removeAssignee(detailAssignees, member.userid)}>&times;</button>
                  </span>
                {/each}
              </div>
              <select
                id="pm-detail-assignee"
                class="form-control"
                value=""
                on:change={(event) => { const value = (event.target as HTMLSelectElement).value; if (value) detailAssignees = addAssignee(detailAssignees, Number(value), assignableMembers); (event.target as HTMLSelectElement).value = ''; }}
              >
                <option value="" disabled>{t('Yourself, if left empty')}</option>
                {#each assignableMembers.filter(member => !detailAssignees.some(a => a.userid === member.userid)) as member (member.userid)}
                  <option value={member.userid}>{member.userid === core.currentUserid ? t('Myself') : member.fullname}</option>
                {/each}
              </select>
            </div>
          </div>
          {#if !creatingNewTask}
          <div class="small pm-muted mb-2">
            {t('Created by')} {detailTask.creator_fullname}
          </div>
          {/if}

          <div class="pm-dialog-field">
            <div class="d-flex align-items-center justify-content-between">
              <span class="pm-label mb-0">{t('Description')}</span>
              <button type="button" class="btn-unstyled pm-field-edit-btn" title={t('Edit')} aria-label={t('Edit description')} on:mousedown|preventDefault={() => descriptionEl?.focus()}>
                <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
              </button>
            </div>
            <div
              id="pm-detail-description"
              class="rte-content form-control"
              contenteditable="true"
              role="textbox"
              aria-multiline="true"
              aria-label={t('Description')}
              bind:this={descriptionEl}
              on:paste={(event) => handleLinkPreviewPaste(event, descriptionEl)}
            >{@html detailDescription}</div>
          </div>

          <div class="pm-dialog-field">
            <span class="pm-label">{t('Notes')}</span>
            <div class="rte-toolbar" role="toolbar" aria-label={t('Formatting')}>
              <button type="button" class="rte-btn" title={t('Heading')} on:mousedown|preventDefault={() => exec(notesEl, 'formatBlock', '<h4>')}><i class="fas fa-heading" aria-hidden="true"></i></button>
              <button type="button" class="rte-btn" title={t('Bold')} on:mousedown|preventDefault={() => exec(notesEl, 'bold')}><i class="fas fa-bold" aria-hidden="true"></i></button>
              <button type="button" class="rte-btn" title={t('Italic')} on:mousedown|preventDefault={() => exec(notesEl, 'italic')}><i class="fas fa-italic" aria-hidden="true"></i></button>
              <button type="button" class="rte-btn" title={t('Bullet list')} on:mousedown|preventDefault={() => exec(notesEl, 'insertUnorderedList')}><i class="fas fa-list-ul" aria-hidden="true"></i></button>
              <button type="button" class="rte-btn" title={t('Numbered list')} on:mousedown|preventDefault={() => exec(notesEl, 'insertOrderedList')}><i class="fas fa-list-ol" aria-hidden="true"></i></button>
              <button type="button" class="rte-btn" title={t('Insert link')} on:mousedown|preventDefault={() => insertLink(notesEl)}><i class="fas fa-link" aria-hidden="true"></i></button>
              <button type="button" class="rte-btn" title={t('Clear formatting')} on:mousedown|preventDefault={() => exec(notesEl, 'removeFormat')}><i class="fas fa-eraser" aria-hidden="true"></i></button>
            </div>
            <div
              id="pm-detail-notes"
              class="rte-content form-control"
              contenteditable="true"
              role="textbox"
              aria-multiline="true"
              aria-label={t('Notes')}
              bind:this={notesEl}
              on:paste={(event) => handleLinkPreviewPaste(event, notesEl)}
            >{@html detailNotes}</div>
          </div>
        {:else}
          {#if detailTask.priority}
            <span class="badge pm-priority pm-priority-{detailTask.priority} mb-1">{priorityLabel(detailTask.priority)}</span>
          {/if}
          {#if detailTask.deadline}
            <div class="small pm-muted mb-1"><i class="fas fa-calendar fa-fw mr-1" aria-hidden="true"></i>{formatDeadline(detailTask.deadline)}</div>
          {/if}
          <div class="small mb-1 d-flex align-items-center flex-wrap">
            {#if detailTask.assignees.length === 0}
              <span class="badge badge-info mr-1"><i class="fas fa-user fa-fw mr-1" aria-hidden="true"></i>{t('Unassigned')}</span>
            {:else}
              <div class="pm-avatar-group mr-2">
                {#each detailTask.assignees as assignee (assignee.userid)}
                  <span class="pm-avatar" title={assignee.fullname}>{initials(assignee.fullname)}</span>
                {/each}
              </div>
            {/if}
          </div>
          <div class="small pm-muted mb-2">
            {t('Created by')} {detailTask.creator_fullname}
          </div>

          <div class="pm-dialog-field">
            <span class="pm-label">{t('Description')}</span>
            {#if detailTask.description}
              <div class="rte-content">{@html detailTask.description}</div>
            {:else}
              <p class="pm-muted small mb-0">{t('No description yet.')}</p>
            {/if}
          </div>
          <div class="pm-dialog-field">
            <span class="pm-label">{t('Notes')}</span>
            {#if detailTask.notes}
              <div class="rte-content">{@html detailTask.notes}</div>
            {:else}
              <p class="pm-muted small mb-0">{t('No notes yet.')}</p>
            {/if}
          </div>
        {/if}

        <div class="pm-dialog-field">
          <div class="d-flex align-items-center justify-content-between">
            <span class="pm-label mb-0">{t('Linked items')}</span>
            {#if !creatingNewTask}
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                on:click={() => {
                  const panel = document.getElementById('favoritesPanel');
                  if (panel?.hasAttribute('hidden')) {
                    (document.querySelector('[data-action="toggle-sidepanel"][data-target="favorites"]') as HTMLElement | null)?.click();
                  }
                }}
              >
                <i class="fas fa-magnifying-glass fa-fw mr-1" aria-hidden="true"></i>{t('Open Search to link')}
              </button>
            {/if}
          </div>
          {#if creatingNewTask}
            {#if draftLinks.length === 0}
              <p class="pm-muted small">{t('No linked items yet.')}</p>
            {:else}
              <ul class="pm-entity-link-list">
                {#each draftLinks as link, index (index)}
                  <li class="pm-entity-link">
                    <span class="mr-auto text-break">{link.label}</span>
                    <button type="button" class="btn-unstyled pm-comment-delete" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeDraftLink(index)}>
                      <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else if loadingEntityLinks}
            <p class="pm-muted small">{t('Loading')}…</p>
          {:else if detailEntityLinks.length === 0}
            <p class="pm-muted small">{t('No linked items yet.')}</p>
          {:else}
            <ul class="pm-entity-link-list">
              {#each detailEntityLinks as link (link.id)}
                <li class="pm-entity-link">
                  {#if editingWeblinkId === link.id}
                    <input
                      type="url"
                      class="form-control form-control-sm mr-1"
                      bind:value={editWeblinkUrl}
                      aria-label={t('Web address')}
                    />
                    <input
                      type="text"
                      class="form-control form-control-sm mr-1"
                      bind:value={editWeblinkLabel}
                      placeholder={t('Label (optional)')}
                      aria-label={t('Link label')}
                    />
                    <button type="button" class="btn btn-primary btn-sm mr-1" disabled={!editWeblinkUrl.trim()} on:click={() => saveEditWeblink(link)}>{t('Save')}</button>
                    <button type="button" class="btn btn-ghost btn-sm" on:click={cancelEditWeblink}>{t('Cancel')}</button>
                  {:else}
                    {#if link.entity_type === 'weblink' && link.url && smbCore(link.url)}
                      <i class="fas fa-server fa-fw mr-1" aria-hidden="true"></i>
                      <span class="mr-auto text-break">{link.title}</span>
                      <a class="btn-unstyled mr-1" href={link.url} title={t('Open on Mac (smb://)')} aria-label={t('Open on Mac')}>
                        <i class="fab fa-apple fa-fw" aria-hidden="true"></i>
                      </a>
                      <button type="button" class="btn-unstyled mr-1" data-action="copy-unc-path" data-unc={uncPath(smbCore(link.url) ?? '')} title={t('Copy Windows path (paste into Explorer)')} aria-label={t('Copy Windows path')}>
                        <i class="fab fa-windows fa-fw" aria-hidden="true"></i>
                      </button>
                    {:else}
                      <span class="badge badge-info mr-1">{entityTypeLabel(link.entity_type)}</span>
                      <a class="mr-auto text-break" href={entityViewUrl(link)} target="_blank" rel="noreferrer noopener">{link.title}</a>
                    {/if}
                    <div class="pm-item-actions">
                      {#if link.entity_type === 'weblink'}
                        <button type="button" class="btn-unstyled pm-comment-delete" title={t('Edit')} aria-label={t('Edit')} on:click={() => startEditWeblink(link)}>
                          <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
                        </button>
                      {/if}
                      <button type="button" class="btn-unstyled pm-comment-delete" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeEntityLink(link)}>
                        <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                      </button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          <div class="d-flex pm-dialog-row">
            <input
              type="url"
              class="form-control"
              placeholder={t('https://… or smb://…')}
              bind:value={weblinkUrl}
              aria-label={t('Web address')}
            />
            <input
              type="text"
              class="form-control"
              placeholder={t('Label (optional)')}
              bind:value={weblinkLabel}
              aria-label={t('Link label')}
            />
            <button type="button" class="btn btn-secondary ml-2" disabled={addingWeblink || !weblinkUrl.trim()} on:click={addWeblink}>{t('Add')}</button>
          </div>
        </div>

        <div class="pm-dialog-field">
          <span class="pm-label">{t('Steps')}</span>
          {#if creatingNewTask}
            {#if draftSteps.length === 0}
              <p class="pm-muted small">{t('No steps yet.')}</p>
            {:else}
              <ul class="pm-step-list">
                {#each draftSteps as step, index (index)}
                  <li class="pm-step">
                    <span class="pm-step-body">{step}</span>
                    <button type="button" class="btn-unstyled pm-comment-delete" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeDraftStep(index)}>
                      <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else if loadingSteps}
            <p class="pm-muted small">{t('Loading')}…</p>
          {:else if detailSteps.length === 0}
            <p class="pm-muted small">{t('No steps yet.')}</p>
          {:else}
            <ul class="pm-step-list">
              {#each detailSteps as step (step.id)}
                <li class="pm-step" class:pm-step-done={step.finished}>
                  {#if editingStepId === step.id}
                    <input
                      type="text"
                      class="form-control form-control-sm mr-2"
                      maxlength="500"
                      bind:value={editStepDraft}
                      on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveEditStep(step); } }}
                    />
                    <button type="button" class="btn btn-primary btn-sm mr-1" disabled={!editStepDraft.trim()} on:click={() => saveEditStep(step)}>{t('Save')}</button>
                    <button type="button" class="btn btn-ghost btn-sm" on:click={cancelEditStep}>{t('Cancel')}</button>
                  {:else}
                    <input
                      type="checkbox"
                      checked={step.finished}
                      on:change={() => toggleStep(step)}
                      aria-label={step.body}
                    />
                    <span class="pm-step-body">{step.body}</span>
                    <div class="pm-item-actions">
                      <button type="button" class="btn-unstyled pm-comment-delete" title={t('Edit')} aria-label={t('Edit')} on:click={() => startEditStep(step)}>
                        <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
                      </button>
                      <button type="button" class="btn-unstyled pm-comment-delete" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeStep(step)}>
                        <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                      </button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          <div class="d-flex pm-dialog-row">
            <input
              type="text"
              class="form-control"
              placeholder={t('Add a step…')}
              bind:value={newStepText}
              on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addStep(); } }}
            />
            <button type="button" class="btn btn-secondary ml-2" disabled={addingStep || !newStepText.trim()} on:click={addStep}>{t('Add')}</button>
          </div>
        </div>

        {#if !creatingNewTask}
        <div class="pm-dialog-field">
          <span class="pm-label">{t('Comments')}</span>
          {#if loadingComments}
            <p class="pm-muted small">{t('Loading')}…</p>
          {:else if detailComments.length === 0}
            <p class="pm-muted small">{t('No comments yet.')}</p>
          {:else}
            <ul class="pm-comment-list">
              {#each detailComments as comment (comment.id)}
                <li class="pm-comment">
                  <div class="pm-comment-meta">
                    <strong>{comment.author_fullname}</strong>
                    <span class="pm-muted">{formatCommentTime(comment.created_at)}</span>
                    {#if core.isAdmin || comment.userid === core.currentUserid}
                      <div class="pm-item-actions">
                        <button type="button" class="btn-unstyled pm-comment-delete" title={t('Edit')} aria-label={t('Edit')} on:click={() => startEditComment(comment)}>
                          <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn-unstyled pm-comment-delete" title={t('Delete')} aria-label={t('Delete')} on:click={() => deleteComment(comment)}>
                          <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                        </button>
                      </div>
                    {/if}
                  </div>
                  {#if editingCommentId === comment.id}
                    <div class="d-flex">
                      <input
                        type="text"
                        class="form-control form-control-sm mr-2"
                        maxlength="5000"
                        bind:value={editCommentDraft}
                        on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveEditComment(comment); } }}
                      />
                      <button type="button" class="btn btn-primary btn-sm mr-1" disabled={!editCommentDraft.trim()} on:click={() => saveEditComment(comment)}>{t('Save')}</button>
                      <button type="button" class="btn btn-ghost btn-sm" on:click={cancelEditComment}>{t('Cancel')}</button>
                    </div>
                    {#if wrapMentionsAsHtml(editCommentDraft, teamMembers).includes('elabftw-mention')}
                      <div class="pm-mention-preview small pm-muted mt-1">{@html wrapMentionsAsHtml(editCommentDraft, teamMembers)}</div>
                    {/if}
                  {:else}
                    <div class="pm-comment-body">{@html comment.body}</div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          <div use:clickOutside={() => { mentionCandidates = []; }}>
            <div class="d-flex pm-comment-form">
              <input
                type="text"
                class="form-control"
                placeholder={t('Add a comment… (type @ to mention someone)')}
                bind:value={newCommentText}
                on:input={onCommentInput}
                on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void postComment(); } }}
              />
              {#if mentionCandidates.length > 0}
                <ul class="pm-mention-results">
                  {#each mentionCandidates as member (member.userid)}
                    <li>
                      <button type="button" class="btn-unstyled pm-mention-result" on:click={() => pickMention(member)}>
                        {member.fullname}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
              <button type="button" class="btn btn-secondary ml-2" disabled={postingComment || !newCommentText.trim()} on:click={postComment}>{t('Post')}</button>
            </div>
            {#if wrapMentionsAsHtml(newCommentText, teamMembers).includes('elabftw-mention')}
              <div class="pm-mention-preview small pm-muted mt-1">{@html wrapMentionsAsHtml(newCommentText, teamMembers)}</div>
            {/if}
          </div>
        </div>
        {/if}
      </div>
      <div class="pm-dialog-footer">
        {#if detailEditing}
          <button type="button" class="btn btn-ghost" on:click={cancelEdit}>{t('Cancel')}</button>
          <button type="button" class="btn btn-primary" disabled={savingDetail} on:click={saveDetail}>{t('Save')}</button>
        {:else}
          <button type="button" class="btn btn-ghost" on:click={closeDetail}>{t('Close')}</button>
          {#if canManage(detailTask)}
            <button type="button" class="btn btn-primary" on:click={startEdit}>{t('Edit')}</button>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if projectDialogOpen}
  <div class="pm-overlay" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) closeProjectDialog(); }}>
    <div class="pm-dialog pm-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="pmProjectDialogTitle">
      <div class="pm-dialog-header">
        <h4 id="pmProjectDialogTitle" class="mb-0">{editingProject ? t('Manage project') : t('New project')}</h4>
        <button type="button" class="pm-close-btn" on:click={closeProjectDialog} aria-label={t('Close')}>&times;</button>
      </div>
      <div class="pm-dialog-body">
        <div class="pm-dialog-field">
          <label class="pm-label" for="pm-project-name">{t('Project name')}</label>
          <input id="pm-project-name" type="text" class="form-control" bind:value={dialogName} maxlength="255" />
        </div>
        <div class="d-flex pm-dialog-row">
          <div class="pm-dialog-field flex-grow-1">
            <label class="pm-label" for="pm-project-target-end-date">{t('Target end date')}</label>
            <input id="pm-project-target-end-date" type="date" class="form-control" bind:value={dialogTargetEndDate} />
          </div>
          <div class="pm-dialog-field flex-grow-1">
            <label class="pm-label" for="pm-project-status">{t('Status')}</label>
            <select id="pm-project-status" class="form-control" bind:value={dialogStatus}>
              <option value="planning">{projectStatusLabel('planning')}</option>
              <option value="active">{projectStatusLabel('active')}</option>
              <option value="on_hold">{projectStatusLabel('on_hold')}</option>
              <option value="done">{projectStatusLabel('done')}</option>
            </select>
          </div>
        </div>
        <div class="pm-dialog-field">
          <span class="pm-label">{t('Goals / description')}</span>
          <div class="rte-toolbar" role="toolbar" aria-label={t('Formatting')}>
            <button type="button" class="rte-btn" title={t('Heading')} on:mousedown|preventDefault={() => exec(dialogDescriptionEl, 'formatBlock', '<h4>')}><i class="fas fa-heading" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Bold')} on:mousedown|preventDefault={() => exec(dialogDescriptionEl, 'bold')}><i class="fas fa-bold" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Italic')} on:mousedown|preventDefault={() => exec(dialogDescriptionEl, 'italic')}><i class="fas fa-italic" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Bullet list')} on:mousedown|preventDefault={() => exec(dialogDescriptionEl, 'insertUnorderedList')}><i class="fas fa-list-ul" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Numbered list')} on:mousedown|preventDefault={() => exec(dialogDescriptionEl, 'insertOrderedList')}><i class="fas fa-list-ol" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Insert link')} on:mousedown|preventDefault={() => insertLink(dialogDescriptionEl)}><i class="fas fa-link" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Clear formatting')} on:mousedown|preventDefault={() => exec(dialogDescriptionEl, 'removeFormat')}><i class="fas fa-eraser" aria-hidden="true"></i></button>
          </div>
          <div
            id="pm-project-desc"
            class="rte-content form-control"
            contenteditable="true"
            role="textbox"
            aria-multiline="true"
            aria-label={t('Goals / description')}
            bind:this={dialogDescriptionEl}
            on:paste={(event) => handleLinkPreviewPaste(event, dialogDescriptionEl)}
          >{@html dialogDescription}</div>
        </div>
        <div class="pm-dialog-field">
          <label class="pm-label" for="pm-project-picker">{t('Team members on this project')}</label>
          <div class="pm-chips">
            {#each dialogMembers as member (member.userid)}
              <span class="pm-chip">
                {member.fullname}
                <button type="button" aria-label={`${t('Remove')} ${member.fullname}`} on:click={() => removeDialogMember(member.userid)}>&times;</button>
              </span>
            {/each}
          </div>
          <select id="pm-project-picker" class="form-control" on:change={(event) => { const value = (event.target as HTMLSelectElement).value; if (value) addDialogMember(Number(value)); (event.target as HTMLSelectElement).value = ''; }}>
            <option value="">+ {t('Add a member')}…</option>
            {#each teamMembers.filter(member => member.userid !== core.currentUserid && !dialogMembers.some(m => m.userid === member.userid)) as member (member.userid)}
              <option value={member.userid}>{member.fullname}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="pm-dialog-footer">
        {#if editingProject}
          <button type="button" class="btn btn-danger-ghost mr-auto" disabled={savingProject} on:click={() => setProjectArchived(!editingProject.archived)}>
            {editingProject.archived ? t('Unarchive project') : t('Archive project')}
          </button>
        {/if}
        <button type="button" class="btn btn-ghost" on:click={closeProjectDialog}>{t('Cancel')}</button>
        <button type="button" class="btn btn-primary" disabled={savingProject || dialogName.trim() === ''} on:click={saveProject}>
          {editingProject ? t('Save changes') : t('Create project')}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if columnDialogOpen}
  <div class="pm-overlay" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) closeColumnDialog(); }}>
    <div class="pm-dialog" role="dialog" aria-modal="true" aria-labelledby="pmColumnDialogTitle">
      <div class="pm-dialog-header">
        <h4 id="pmColumnDialogTitle" class="mb-0">{t('Manage columns')}</h4>
        <button type="button" class="pm-close-btn" on:click={closeColumnDialog} aria-label={t('Close')}>&times;</button>
      </div>
      <div class="pm-dialog-body">
        <p class="pm-muted small mt-0">
          {activeProject ? t('Editing the columns for this project\'s board only.') : t('Editing the team\'s default columns, used by Unfiled and All projects, and by any project that hasn\'t customized its own yet.')}
        </p>
        <ul class="pm-column-manage-list">
          {#each sortedColumns(columns) as column (column.id)}
            <li class="pm-column-manage-row">
              <input
                type="text"
                class="form-control"
                value={column.name}
                on:blur={(event) => renameColumn(column, (event.target as HTMLInputElement).value)}
              />
              <button type="button" class="btn-unstyled pm-icon-button" title={t('Move left')} aria-label={t('Move left')} disabled={!adjacentColumn(column, -1)} on:click={() => moveColumn(column, -1)}>
                <i class="fas fa-arrow-left fa-fw" aria-hidden="true"></i>
              </button>
              <button type="button" class="btn-unstyled pm-icon-button" title={t('Move right')} aria-label={t('Move right')} disabled={!adjacentColumn(column, 1)} on:click={() => moveColumn(column, 1)}>
                <i class="fas fa-arrow-right fa-fw" aria-hidden="true"></i>
              </button>
              {#if column.kind === 'custom'}
                <button type="button" class="btn-unstyled pm-comment-delete" title={t('Delete')} aria-label={t('Delete')} on:click={() => deleteColumn(column)}>
                  <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                </button>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="d-flex pm-dialog-row">
          <input
            type="text"
            class="form-control"
            placeholder={t('New column name…')}
            bind:value={newColumnName}
            maxlength="100"
            on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addColumn(); } }}
          />
          <button type="button" class="btn btn-secondary ml-2" disabled={addingColumn || !newColumnName.trim()} on:click={addColumn}>{t('Add')}</button>
        </div>
      </div>
      <div class="pm-dialog-footer">
        <button type="button" class="btn btn-primary" on:click={closeColumnDialog}>{t('Done')}</button>
      </div>
    </div>
  </div>
{/if}

