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
    project_name: string | null;
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
  let newAssignedUserid = core.currentUserid;
  let newDeadline = '';
  let submitting = false;
  let detailTask: Task | null = null;
  let detailTitle = '';
  let detailDeadline = '';
  let detailAssignedUserid = core.currentUserid;
  let detailDescription = '';
  let detailNotes = '';
  let savingDetail = false;
  let detailComments: TaskComment[] = [];
  let loadingComments = false;
  let newCommentText = '';
  let postingComment = false;
  let descriptionEl: HTMLDivElement;
  let notesEl: HTMLDivElement;

  $: activeProject = projects.find(p => p.id === activeProjectId) ?? null;
  $: assignableMembers = activeProject ? activeProject.members : teamMembers;
  $: visibleTasks = tasks.filter(task => task.project_id === activeProjectId);
  $: todoTasks = visibleTasks.filter(task => !task.completed_at);
  $: doneTasks = visibleTasks.filter(task => task.completed_at);

  function canManage(task: Task): boolean {
    return task.userid === core.currentUserid
      || task.assigned_userid === core.currentUserid
      || core.isAdmin;
  }

  function formatDeadline(deadline: string | null): string {
    if (!deadline) return '';
    return new Date(deadline).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
      tasks = await ApiC.getJson(`${Model.Todolist}?scope=${scope}`) as Task[];
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
  });

  function selectScope(next: 'assigned' | 'created' | 'all'): void {
    scope = next;
    void load();
  }

  function selectProject(id: number | null): void {
    activeProjectId = id;
    if (newAssignedUserid !== core.currentUserid) {
      const project = projects.find(p => p.id === id);
      if (project && !project.members.some(m => m.userid === newAssignedUserid)) {
        newAssignedUserid = core.currentUserid;
      }
    }
  }

  async function submitNewTask(): Promise<void> {
    if (newTitle.trim() === '') return;
    submitting = true;
    try {
      await ApiC.post(Model.Todolist, {
        content: newTitle.trim(),
        assigned_userid: newAssignedUserid,
        deadline: newDeadline || null,
        project_id: activeProjectId,
      });
      newTitle = '';
      newDeadline = '';
      newAssignedUserid = core.currentUserid;
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

  async function reassign(task: Task, userid: number): Promise<void> {
    if (userid === task.assigned_userid) return;
    try {
      await ApiC.patch(`${Model.Todolist}/${task.id}`, { assigned_userid: userid });
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not reassign the task.');
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
    detailTitle = task.body;
    detailDeadline = toDateInputValue(task.deadline);
    detailAssignedUserid = task.assigned_userid ?? core.currentUserid;
    detailDescription = task.description ?? '';
    detailNotes = task.notes ?? '';
    newCommentText = '';
    void loadComments(task.id);
  }

  function closeDetail(): void {
    detailTask = null;
    detailComments = [];
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
        assigned_userid: detailAssignedUserid,
        description: descriptionEl?.innerHTML ?? detailDescription,
        notes: notesEl?.innerHTML ?? detailNotes,
      });
      closeDetail();
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save the task.');
    } finally {
      savingDetail = false;
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
  {#if activeProject?.description}
    <p class="pm-muted pm-project-description">{activeProject.description}</p>
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
        <select id="pm-new-assignee" class="form-control" bind:value={newAssignedUserid}>
          <option value={core.currentUserid}>{t('Myself')}</option>
          {#each assignableMembers.filter(member => member.userid !== core.currentUserid) as member (member.userid)}
            <option value={member.userid}>{member.fullname}</option>
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
            <div class="pm-task-meta d-flex align-items-center flex-wrap mt-1">
              <span class="badge badge-info mr-1">
                <i class="fas fa-user fa-fw mr-1" aria-hidden="true"></i>{task.assigned_fullname ?? t('Unassigned')}
              </span>
              {#if scope === 'created' && task.assigned_userid !== task.userid}
                <span class="pm-muted mr-1">{t('from')} {task.creator_fullname}</span>
              {/if}
              {#if canManage(task) && task.userid === core.currentUserid}
                <select
                  class="form-control form-control-sm pm-reassign-select"
                  value={task.assigned_userid}
                  on:change={(event) => reassign(task, Number((event.target as HTMLSelectElement).value))}
                  aria-label={t('Reassign')}
                >
                  <option value={core.currentUserid}>{t('Myself')}</option>
                  {#each assignableMembers.filter(member => member.userid !== core.currentUserid) as member (member.userid)}
                    <option value={member.userid}>{member.fullname}</option>
                  {/each}
                </select>
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
            <div class="pm-task-meta">
              <span class="badge badge-info">
                <i class="fas fa-user fa-fw mr-1" aria-hidden="true"></i>{task.assigned_fullname ?? t('Unassigned')}
              </span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

{#if detailTask}
  <div class="pm-overlay" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
    <div class="pm-dialog pm-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="pmDetailTitle">
      <div class="pm-dialog-header">
        <h4 id="pmDetailTitle" class="mb-0">{t('Task details')}</h4>
        <button type="button" class="pm-close-btn" on:click={closeDetail} aria-label={t('Close')}>&times;</button>
      </div>
      <div class="pm-dialog-body">
        {#if detailTask.project_name}<span class="badge badge-info mb-2">{detailTask.project_name}</span>{/if}

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
            <select id="pm-detail-assignee" class="form-control" bind:value={detailAssignedUserid}>
              <option value={core.currentUserid}>{t('Myself')}</option>
              {#each assignableMembers.filter(member => member.userid !== core.currentUserid) as member (member.userid)}
                <option value={member.userid}>{member.fullname}</option>
              {/each}
            </select>
          </div>
        </div>
        <div class="small pm-muted mb-2">
          {t('Created by')} {detailTask.creator_fullname}
        </div>

        <div class="pm-dialog-field">
          <span class="pm-label">{t('Description')}</span>
          <div class="rte-toolbar" role="toolbar" aria-label={t('Formatting')}>
            <button type="button" class="rte-btn" title={t('Heading')} on:mousedown|preventDefault={() => exec(descriptionEl, 'formatBlock', 'H4')}><i class="fas fa-heading" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Bold')} on:mousedown|preventDefault={() => exec(descriptionEl, 'bold')}><i class="fas fa-bold" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Italic')} on:mousedown|preventDefault={() => exec(descriptionEl, 'italic')}><i class="fas fa-italic" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Bullet list')} on:mousedown|preventDefault={() => exec(descriptionEl, 'insertUnorderedList')}><i class="fas fa-list-ul" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Numbered list')} on:mousedown|preventDefault={() => exec(descriptionEl, 'insertOrderedList')}><i class="fas fa-list-ol" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Clear formatting')} on:mousedown|preventDefault={() => exec(descriptionEl, 'removeFormat')}><i class="fas fa-eraser" aria-hidden="true"></i></button>
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
            <button type="button" class="rte-btn" title={t('Heading')} on:mousedown|preventDefault={() => exec(notesEl, 'formatBlock', 'H4')}><i class="fas fa-heading" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Bold')} on:mousedown|preventDefault={() => exec(notesEl, 'bold')}><i class="fas fa-bold" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Italic')} on:mousedown|preventDefault={() => exec(notesEl, 'italic')}><i class="fas fa-italic" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Bullet list')} on:mousedown|preventDefault={() => exec(notesEl, 'insertUnorderedList')}><i class="fas fa-list-ul" aria-hidden="true"></i></button>
            <button type="button" class="rte-btn" title={t('Numbered list')} on:mousedown|preventDefault={() => exec(notesEl, 'insertOrderedList')}><i class="fas fa-list-ol" aria-hidden="true"></i></button>
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
                    <span class="pm-muted">{formatDeadline(comment.created_at)}</span>
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
        <button type="button" class="btn btn-ghost" on:click={closeDetail}>{t('Close')}</button>
        <button type="button" class="btn btn-primary" disabled={savingDetail} on:click={saveDetail}>{t('Save')}</button>
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
          <label class="pm-label" for="pm-project-desc">{t('Short description')}</label>
          <input id="pm-project-desc" type="text" class="form-control" bind:value={dialogDescription} maxlength="500" />
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

