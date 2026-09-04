<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import { core } from '../core';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';

  type Task = {
    id: number;
    body: string;
    notes: string | null;
    description: string | null;
    deadline: string | null;
    completed_at: string | null;
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

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();

  let tasks: Task[] = [];
  let teamMembers: TeamMember[] = [];
  let projects: Project[] = [];
  // null = the "Unfiled" bucket (tasks with no project)
  let activeProjectId: number | null = null;
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
  let detailDescription = '';
  let detailNotes = '';
  let savingDetail = false;
  let detailComments: TaskComment[] = [];
  let loadingComments = false;
  let newCommentText = '';
  let postingComment = false;
  let descriptionEl: HTMLDivElement;
  let notesEl: HTMLDivElement;
  let detailEntityLinks: EntityLink[] = [];
  let loadingEntityLinks = false;
  let weblinkUrl = '';
  let weblinkLabel = '';
  let addingWeblink = false;

  $: activeProject = projects.find(p => p.id === activeProjectId) ?? null;
  $: assignableMembers = activeProject ? activeProject.members : teamMembers;
  $: visibleTasks = tasks.filter(task => task.project_id === activeProjectId);
  $: todoTasks = visibleTasks.filter(task => !task.completed_at);
  $: doneTasks = visibleTasks.filter(task => task.completed_at);

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
    void loadTeamMembers();
    void loadProjects();
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

  function selectProject(id: number | null): void {
    activeProjectId = id;
    const project = projects.find(p => p.id === id);
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
        project_id: activeProjectId,
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

  async function toggleCompleted(task: Task): Promise<void> {
    try {
      await ApiC.patch(`${Model.Todolist}/${task.id}`, { completed: task.completed_at ? '0' : '1' });
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update the task.');
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
    detailDescription = task.description ?? '';
    detailNotes = task.notes ?? '';
    newCommentText = '';
    weblinkUrl = '';
    weblinkLabel = '';
    void loadComments(task.id);
    void loadEntityLinks(task.id);
    window.dispatchEvent(new CustomEvent('elabftw:pm-task-link-target', { detail: { id: task.id, title: task.body } }));
  }

  function closeDetail(): void {
    detailTask = null;
    detailEditing = false;
    detailComments = [];
    detailEntityLinks = [];
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
    if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
    try {
      const url = new URL(candidate);
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
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
      await ApiC.post(`${Model.Todolist}/${detailTask.id}/${Model.Comment}`, { body });
      newCommentText = '';
      await loadComments(detailTask.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post the comment.');
    } finally {
      postingComment = false;
    }
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

  function insertChecklistItem(el: HTMLElement | undefined): void {
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const hasText = !range.collapsed && selection.toString().trim() !== '';
    const text = hasText ? selection.toString() : '';
    if (hasText) range.deleteContents();

    // Built via the DOM (not string interpolation), and inserted via the
    // Range API (not execCommand, whose own choice of where to leave the
    // caret afterwards is inconsistent across browsers and broke chaining
    // a second checklist item with Enter).
    const item = document.createElement('span');
    item.className = 'pm-check-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    item.appendChild(checkbox);
    const textNode = document.createTextNode(hasText ? ` ${text}` : ' ');
    item.appendChild(textNode);

    // A block-level <div> inserted mid-flow gets misplaced by the browser's
    // HTML parser when the cursor isn't already at the start of a line (it
    // can't nest inside inline content) -- an inline <span> preceded by an
    // explicit <br> avoids that while still starting its own line.
    const br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    range.insertNode(item);

    // Leave the caret inside the item's own text, right after the checkbox,
    // so handleChecklistKeydown() below can find it as the current line's
    // owner and typed text lands next to the checkbox rather than after it.
    const caretRange = document.createRange();
    caretRange.setStart(textNode, textNode.length);
    caretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caretRange);
  }

  // Pressing Enter while on a checklist line should continue the list, like
  // pressing Enter in a bullet/numbered list does -- otherwise it just ends
  // the checklist and starts a plain line.
  function handleChecklistKeydown(event: KeyboardEvent, el: HTMLElement | undefined): void {
    if (!el || event.key !== 'Enter' || event.shiftKey) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    // The caret's container is either a descendant of `el` (climb to the
    // child of `el` that owns it) or `el` itself, positioned between two of
    // its top-level children (use the one right before the caret).
    let node: Node | null = range.startContainer;
    if (node === el) {
      node = range.startOffset > 0 ? el.childNodes[range.startOffset - 1] : null;
    } else {
      while (node && node.parentNode !== el) node = node.parentNode;
    }
    let sibling: Node | null = node;
    let onChecklistLine = false;
    while (sibling) {
      if (sibling instanceof HTMLElement && sibling.tagName === 'BR') break;
      if (sibling instanceof HTMLElement && sibling.classList.contains('pm-check-item')) {
        onChecklistLine = true;
        break;
      }
      sibling = sibling.previousSibling;
    }
    if (!onChecklistLine) return;
    event.preventDefault();
    insertChecklistItem(el);
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

  // Toggling a checkbox updates its live `checked` property but not the
  // serialized attribute, so it wouldn't survive being read back out of
  // notesEl.innerHTML on save without this -- keep the attribute in sync.
  function syncChecklistState(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      target.toggleAttribute('checked', target.checked);
    }
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
      <div class="pm-column">
        <h3 class="h6 pm-column-title">{t('To do')} <span class="badge badge-secondary">{todoTasks.length}</span></h3>
        {#if todoTasks.length === 0}
          <p class="pm-muted">{t('Nothing here.')}</p>
        {/if}
        {#each todoTasks as task (task.id)}
          <div class="pm-card pm-task">
            <div class="d-flex align-items-start">
              <button type="button" class="pm-task-title-btn flex-grow-1" on:click={() => openDetail(task)}>{task.body}</button>
              {#if canManage(task)}
                <div class="pm-task-actions">
                  <button type="button" class="btn btn-ghost btn-sm pm-icon-button" title={t('Edit')} aria-label={t('Edit')} on:click={() => openDetail(task)}>
                    <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm pm-icon-button" title={t('Mark as done')} aria-label={t('Mark as done')} on:click={() => toggleCompleted(task)}>
                    <i class="fas fa-check fa-fw" aria-hidden="true"></i>
                  </button>
                  <button type="button" class="btn btn-danger-ghost btn-sm pm-icon-button" title={t('Delete')} aria-label={t('Delete')} on:click={() => deleteTask(task)}>
                    <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                  </button>
                </div>
              {/if}
            </div>
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
      </div>

      <div class="pm-column">
        <h3 class="h6 pm-column-title">{t('Done')} <span class="badge badge-secondary">{doneTasks.length}</span></h3>
        {#if doneTasks.length === 0}
          <p class="pm-muted">{t('Nothing here.')}</p>
        {/if}
        {#each doneTasks as task (task.id)}
          <div class="pm-card pm-task pm-task-done">
            <div class="d-flex align-items-start">
              <button type="button" class="pm-task-title-btn flex-grow-1" on:click={() => openDetail(task)}>{task.body}</button>
              {#if canManage(task)}
                <div class="pm-task-actions">
                  <button type="button" class="btn btn-ghost btn-sm pm-icon-button" title={t('Edit')} aria-label={t('Edit')} on:click={() => openDetail(task)}>
                    <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm pm-icon-button" title={t('Reopen')} aria-label={t('Reopen')} on:click={() => toggleCompleted(task)}>
                    <i class="fas fa-rotate-left fa-fw" aria-hidden="true"></i>
                  </button>
                  <button type="button" class="btn btn-danger-ghost btn-sm pm-icon-button" title={t('Delete')} aria-label={t('Delete')} on:click={() => deleteTask(task)}>
                    <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                  </button>
                </div>
              {/if}
            </div>
            {#if task.description}
              <p class="pm-muted pm-task-preview">{plainPreview(task.description)}</p>
            {/if}
            {#if task.notes}
              <p class="pm-muted pm-task-preview">{plainPreview(task.notes)}</p>
            {/if}
            <div class="pm-task-meta">
              {#if task.assignees.length === 0}
                <span class="badge badge-info"><i class="fas fa-user fa-fw mr-1" aria-hidden="true"></i>{t('Unassigned')}</span>
              {:else}
                <div class="pm-avatar-group">
                  {#each task.assignees as assignee (assignee.userid)}
                    <span class="pm-avatar" title={assignee.fullname}>{initials(assignee.fullname)}</span>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
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
              <button type="button" class="rte-btn" title={t('Checklist item')} on:mousedown|preventDefault={() => insertChecklistItem(notesEl)}><i class="fas fa-square-check" aria-hidden="true"></i></button>
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
              on:change={syncChecklistState}
              on:keydown={(event) => handleChecklistKeydown(event, notesEl)}
            >{@html detailNotes}</div>
          </div>
        {:else}
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
                  <span class="badge badge-info mr-1">{entityTypeLabel(link.entity_type)}</span>
                  <a class="mr-auto text-break" href={entityViewUrl(link)} target="_blank" rel="noreferrer noopener">{link.title}</a>
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
              placeholder={t('https://…')}
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
              placeholder={t('Add a comment…')}
              bind:value={newCommentText}
              on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void postComment(); } }}
            />
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

