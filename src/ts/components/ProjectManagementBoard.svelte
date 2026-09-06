<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import { core } from '../core';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';
  import { applyMention, extractMentionQuery } from '../mentions';

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
    priority: Priority | null;
    column_id: number | null;
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

  type Project = {
    id: number;
    name: string;
    description: string | null;
    userid: number;
    members: TeamMember[];
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
  let teamMembers: TeamMember[] = [];
  let projects: Project[] = [];
  let columns: Column[] = [];
  // null = the "Unfiled" bucket (tasks with no project); 'all' = every project combined
  let activeProjectId: number | null | 'all' = null;
  let loading = true;
  // 'assigned' shows tasks assigned to me (by myself or someone else);
  // 'created' shows tasks I set up, whether for myself or someone else;
  // 'all' is the union of both -- never a view of everyone else's work
  let scope: 'assigned' | 'created' | 'all' = 'assigned';
  let newTitle = '';
  let newAssignees: TeamMember[] = [];
  let newDeadline = '';
  let submitting = false;
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
  $: visibleTasks = (activeProjectId === 'all' ? tasks : tasks.filter(task => task.project_id === activeProjectId))
    .filter(task => matchesSearch(task, normalizedSearch));
  $: doneColumn = columns.find(c => c.kind === 'done') ?? null;
  $: todoColumn = columns.find(c => c.kind === 'todo') ?? null;
  $: doneCount = doneColumn ? visibleTasks.filter(task => task.column_id === doneColumn.id).length : 0;
  $: donePercent = visibleTasks.length === 0 ? 0 : Math.round((doneCount / visibleTasks.length) * 100);

  function canManage(task: Task): boolean {
    return task.userid === core.currentUserid
      || task.assignees.some(a => a.userid === core.currentUserid)
      || core.isAdmin;
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

  async function loadProjects(): Promise<void> {
    try {
      projects = await ApiC.getJson(Model.TodolistProjects) as Project[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load projects.');
    }
  }

  async function load(): Promise<void> {
    loading = true;
    try {
      // readAll() only returns either open or completed tasks per call
      // (the sidebar To-do widget relies on that split), so the board
      // fetches both and merges them to populate the To do/Done columns.
      const [open, done] = await Promise.all([
        ApiC.getJson(`${Model.Todolist}?scope=${scope}`) as Promise<Task[]>,
        ApiC.getJson(`${Model.Todolist}?scope=${scope}&completed=1`) as Promise<Task[]>,
      ]);
      tasks = [...open, ...done];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load tasks.');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    const projectParam = new URLSearchParams(window.location.search).get('project');
    if (projectParam === 'all') {
      activeProjectId = 'all';
    } else {
      const numericParam = Number(projectParam);
      if (Number.isInteger(numericParam) && numericParam > 0) activeProjectId = numericParam;
    }

    void loadTeamMembers();
    void loadProjects();
    void loadColumns();
    void load();

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

  function selectScope(next: 'assigned' | 'created' | 'all'): void {
    scope = next;
    void load();
  }

  function selectProject(id: number | null | 'all'): void {
    activeProjectId = id;
    const project = typeof id === 'number' ? projects.find(p => p.id === id) : undefined;
    if (project) {
      newAssignees = newAssignees.filter(a => project.members.some(m => m.userid === a.userid));
    }
  }

  async function submitNewTask(): Promise<void> {
    if (newTitle.trim() === '') return;
    submitting = true;
    try {
      await ApiC.post(Model.Todolist, {
        content: newTitle.trim(),
        assignee_userids: newAssignees.map(a => a.userid),
        deadline: newDeadline || null,
        project_id: activeProjectId === 'all' ? null : activeProjectId,
      });
      newTitle = '';
      newDeadline = '';
      newAssignees = [];
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not create the task.');
    } finally {
      submitting = false;
    }
  }

  async function loadColumns(): Promise<void> {
    try {
      columns = await ApiC.getJson(Model.TodolistColumns) as Column[];
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
      await ApiC.post(Model.TodolistColumns, { name });
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

  async function addWeblink(): Promise<void> {
    if (!detailTask) return;
    const url = normalizeWeblinkUrl(weblinkUrl);
    if (!url) {
      notify.error('Enter a valid web address.');
      return;
    }
    addingWeblink = true;
    try {
      await ApiC.post(`${Model.Todolist}/${detailTask.id}/entity_links`, {
        entity_type: 'weblink',
        url,
        label: weblinkLabel.trim() || url,
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

  async function addStep(): Promise<void> {
    if (!detailTask) return;
    const body = newStepText.trim();
    if (!body) return;
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
      await ApiC.post(`${Model.Todolist}/${detailTask.id}/${Model.Comment}`, { body, mentioned_userids: mentionedUserids });
      newCommentText = '';
      commentMentions = [];
      await loadComments(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post the comment.');
    } finally {
      postingComment = false;
    }
  }

  function onCommentInput(): void {
    const query = extractMentionQuery(newCommentText);
    if (query === null) {
      mentionCandidates = [];
      return;
    }
    const lower = query.toLowerCase();
    mentionCandidates = teamMembers.filter(m => m.fullname.toLowerCase().includes(lower)).slice(0, 5);
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

  // A lightweight rich-text toolbar (contenteditable + execCommand) rather
  // than wiring the full TinyMCE editor into a Svelte-managed dialog -- gives
  // headings/bullets/bold without the added integration risk.
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

  // project dialog: null = creating a new project; a project = editing it
  let projectDialogOpen = false;
  let editingProject: Project | null = null;
  let dialogName = '';
  let dialogDescription = '';
  let dialogMembers: TeamMember[] = [];
  let savingProject = false;

  function openProjectDialog(project: Project | null): void {
    editingProject = project;
    dialogName = project?.name ?? '';
    dialogDescription = project?.description ?? '';
    dialogMembers = project ? [...project.members] : [];
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
      if (editingProject) {
        await ApiC.patch(`${Model.TodolistProjects}/${editingProject.id}`, {
          name,
          description: dialogDescription.trim(),
          members: memberIds,
        });
      } else {
        const response = await ApiC.post(Model.TodolistProjects, {
          name,
          description: dialogDescription.trim(),
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
</script>

<div class="pm-board">
  <div class="pm-project-row">
    <button type="button" class="pm-project-tab" class:active={activeProjectId === 'all'} on:click={() => selectProject('all')}>
      {t('All')}
    </button>
    <button type="button" class="pm-project-tab" class:active={activeProjectId === null} on:click={() => selectProject(null)}>
      {t('Unfiled')}
    </button>
    {#each projects as project (project.id)}
      <button type="button" class="pm-project-tab" class:active={activeProjectId === project.id} on:click={() => selectProject(project.id)}>
        {project.name}
      </button>
    {/each}
    {#if activeProject}
      <button type="button" class="pm-manage-btn" title={t('Manage this project')} aria-label={t('Manage this project')} on:click={() => openProjectDialog(activeProject)}>
        <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
      </button>
    {/if}
    <button type="button" class="pm-project-tab-new" on:click={() => openProjectDialog(null)}>+ {t('New project')}</button>
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

  <div class="pm-search mt-2">
    <input
      class="form-control form-control-sm"
      type="search"
      placeholder={t('Search tasks…')}
      title={t('Searches title, notes, description, project, priority, people and linked items')}
      bind:value={searchQuery}
    />
    <span class="pm-muted small">{t('Searches: title, notes, description, project, priority, people, links')}</span>
  </div>

  {#if activeProject}
    <div class="pm-project-description">
      <span class="pm-label mb-0">{t('Description')}</span>
      {#if activeProject.description}
        <p class="mb-0">{activeProject.description}</p>
      {:else}
        <p class="pm-muted small mb-0">{t('No description yet.')}</p>
      {/if}
    </div>
  {/if}
  {#if visibleTasks.length > 0}
    <div class="pm-progress mt-2" title={`${doneCount} / ${visibleTasks.length} ${t('done')}`}>
      <div class="pm-progress-bar" style={`width: ${donePercent}%`}></div>
      <span class="pm-progress-label">{donePercent}% {t('done')}</span>
    </div>
  {/if}

  <div class="pm-card pm-new-card mb-3 mt-2">
    <form on:submit|preventDefault={submitNewTask} class="d-flex flex-wrap align-items-end gap-2">
      <div class="flex-grow-1">
        <label class="pm-label" for="pm-new-title">{t('Task')}</label>
        <input
          id="pm-new-title"
          type="text"
          class="form-control"
          placeholder={t('What needs to be done?')}
          bind:value={newTitle}
          maxlength="1000"
        />
      </div>
      <div>
        <label class="pm-label" for="pm-new-assignee">{t('Assign to')}</label>
        <div class="pm-chips">
          {#each newAssignees as member (member.userid)}
            <span class="pm-chip">
              {member.fullname}
              <button type="button" aria-label={`${t('Remove')} ${member.fullname}`} on:click={() => newAssignees = removeAssignee(newAssignees, member.userid)}>&times;</button>
            </span>
          {/each}
        </div>
        <select
          id="pm-new-assignee"
          class="form-control"
          value=""
          on:change={(event) => { const value = (event.target as HTMLSelectElement).value; if (value) newAssignees = addAssignee(newAssignees, Number(value), assignableMembers); (event.target as HTMLSelectElement).value = ''; }}
        >
          <option value="" disabled>{t('Yourself, if left empty')}</option>
          {#each assignableMembers.filter(member => !newAssignees.some(a => a.userid === member.userid)) as member (member.userid)}
            <option value={member.userid}>{member.userid === core.currentUserid ? t('Myself') : member.fullname}</option>
          {/each}
        </select>
      </div>
      <div>
        <label class="pm-label" for="pm-new-deadline">{t('Due date')}</label>
        <input id="pm-new-deadline" type="date" class="form-control" bind:value={newDeadline} />
      </div>
      <button type="submit" class="btn btn-primary" disabled={submitting || newTitle.trim() === ''}>
        <i class="fas fa-plus fa-fw mr-1" aria-hidden="true"></i>{t('Add task')}
      </button>
    </form>
  </div>

  <div class="d-flex align-items-center my-3">
    <div class="btn-group btn-group-sm" role="group" aria-label={t('Task view')}>
      <button type="button" class={scope === 'assigned' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectScope('assigned')}>
        <i class="fas fa-user fa-fw mr-1" aria-hidden="true"></i>{t('Assigned to me')}
      </button>
      <button type="button" class={scope === 'created' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectScope('created')}>
        <i class="fas fa-pen-to-square fa-fw mr-1" aria-hidden="true"></i>{t('Created by me')}
      </button>
      <button type="button" class={scope === 'all' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectScope('all')}>
        <i class="fas fa-list fa-fw mr-1" aria-hidden="true"></i>{t('All')}
      </button>
    </div>
  </div>

  {#if loading}
    <p class="pm-muted">{t('Loading')}…</p>
  {:else}
    <div class="pm-columns">
      {#each sortedColumns(columns) as column (column.id)}
        {@const columnTasks = visibleTasks.filter(task => task.column_id === column.id)}
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
          <h3
            class="h6 pm-column-title"
            draggable="true"
            title={t('Drag to reorder this column')}
            on:dragstart={(event) => startColumnDrag(event, column.id)}
            on:dragend={finishColumnDrag}
          >{column.name} <span class="badge badge-secondary">{columnTasks.length}</span></h3>
          {#if columnTasks.length === 0}
            <p class="pm-muted">{t('Nothing here.')}</p>
          {/if}
          {#each shownTasks as task (task.id)}
            <div
              class="pm-card pm-task"
              class:pm-task-done={column.kind === 'done'}
              draggable={canManage(task)}
              on:dragstart={(event) => startTaskDrag(event, task.id)}
              on:dragend={finishTaskDrag}
            >
              <div class="d-flex align-items-start">
                {#if doneColumn && canManage(task)}
                  <input
                    type="checkbox"
                    class="pm-task-done-checkbox mr-2 mt-1"
                    checked={column.kind === 'done'}
                    on:change={() => moveTaskToColumn(task, column.kind === 'done' ? (todoColumn?.id ?? column.id) : doneColumn.id)}
                    title={column.kind === 'done' ? t('Mark as not done') : t('Mark as done')}
                    aria-label={column.kind === 'done' ? t('Mark as not done') : t('Mark as done')}
                  />
                {/if}
                <button type="button" class="pm-task-title-btn flex-grow-1" on:click={() => openDetail(task)}>{task.body}</button>
                {#if canManage(task)}
                  <div class="pm-task-actions">
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
              </div>
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
          <div class="small pm-muted mb-2">
            {t('Created by')} {detailTask.creator_fullname}
          </div>

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
          </div>
          {#if loadingEntityLinks}
            <p class="pm-muted small">{t('Loading')}…</p>
          {:else if detailEntityLinks.length === 0}
            <p class="pm-muted small">{t('No linked items yet.')}</p>
          {:else}
            <ul class="pm-entity-link-list">
              {#each detailEntityLinks as link (link.id)}
                <li class="pm-entity-link">
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
                  <button type="button" class="btn-unstyled pm-comment-delete" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeEntityLink(link)}>
                    <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                  </button>
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
          {#if loadingSteps}
            <p class="pm-muted small">{t('Loading')}…</p>
          {:else if detailSteps.length === 0}
            <p class="pm-muted small">{t('No steps yet.')}</p>
          {:else}
            <ul class="pm-step-list">
              {#each detailSteps as step (step.id)}
                <li class="pm-step" class:pm-step-done={step.finished}>
                  <input
                    type="checkbox"
                    checked={step.finished}
                    on:change={() => toggleStep(step)}
                    aria-label={step.body}
                  />
                  <span class="pm-step-body">{step.body}</span>
                  <button type="button" class="btn-unstyled pm-comment-delete" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeStep(step)}>
                    <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                  </button>
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
                    {#if comment.userid === core.currentUserid}
                      <button type="button" class="btn-unstyled pm-comment-delete" title={t('Delete')} aria-label={t('Delete')} on:click={() => deleteComment(comment)}>
                        <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                      </button>
                    {/if}
                  </div>
                  <div class="pm-comment-body">{comment.body}</div>
                </li>
              {/each}
            </ul>
          {/if}
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
        </div>
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
    <div class="pm-dialog" role="dialog" aria-modal="true" aria-labelledby="pmProjectDialogTitle">
      <div class="pm-dialog-header">
        <h4 id="pmProjectDialogTitle" class="mb-0">{editingProject ? t('Manage project') : t('New project')}</h4>
        <button type="button" class="pm-close-btn" on:click={closeProjectDialog} aria-label={t('Close')}>&times;</button>
      </div>
      <div class="pm-dialog-body">
        <div class="pm-dialog-field">
          <label class="pm-label" for="pm-project-name">{t('Project name')}</label>
          <input id="pm-project-name" type="text" class="form-control" bind:value={dialogName} maxlength="255" />
        </div>
        <div class="pm-dialog-field">
          <label class="pm-label" for="pm-project-desc">{t('Description')}</label>
          <textarea id="pm-project-desc" class="form-control" rows="3" bind:value={dialogDescription} maxlength="500"></textarea>
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
            {#each teamMembers.filter(member => !dialogMembers.some(m => m.userid === member.userid)) as member (member.userid)}
              <option value={member.userid}>{member.fullname}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="pm-dialog-footer">
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

