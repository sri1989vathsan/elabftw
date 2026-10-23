<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import { askConfirm } from '../confirm-dialog';
  import i18next from '../i18n';
  import { Notification as AppNotification } from '../Notifications.class';

  type Proj = { id: number; name: string; parent_id: number | null };

  type CanvasTask = {
    id: number;
    title: string;
    priority: 'low' | 'medium' | 'high' | null;
    deadline: string | null;
    completed_at: string | null;
    in_progress: boolean;
    archived: boolean;
    column: string | null;
    column_kind: string | null;
    assignees: string[];
    steps_total: number;
    steps_done: number;
    comments: number;
  };

  type CanvasExperiment = {
    id: number;
    title: string;
    date: string | null;
    status: string | null;
    status_color: string | null;
  };

  type CanvasNode = {
    id: number;
    project_id: number;
    type: 'question' | 'task' | 'experiment';
    x: number;
    y: number;
    title: string | null;
    note: string | null;
    task_id: number | null;
    entity_id: number | null;
    task?: CanvasTask | null;
    experiment?: CanvasExperiment | null;
  };

  type CanvasEdge = { id: number; from_node: number; to_node: number };

  type PickerTask = { id: number; body: string; project_id: number | null; completed_at: string | null };

  type Tool = 'select' | 'connect' | 'remove';

  export let projects: Proj[] = [];
  export let rootId: number;
  export let activeId: number | 'all' | null = null;
  export let onOpenTask: (taskId: number) => void = () => undefined;

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();

  const NODE_W = 176;
  const GROUP_PAD = 14;
  const GROUP_LABEL = 20;
  const GROUP_GAP = 26;
  const OUTER_PAD = 12;
  const COLORS = ['#0c58ab', '#7c3aed', '#1a7f4b', '#b45309', '#be185d', '#0f766e'];
  const ESTIMATE_H: Record<string, number> = { question: 92, task: 128, experiment: 92 };

  let canvasEl: HTMLDivElement;
  let canvasWidth = 700;
  let nodes: CanvasNode[] = [];
  let edges: CanvasEdge[] = [];
  let loading = true;
  let visible: number[] = [];
  let tool: Tool = 'select';
  let pending: number | null = null;
  let selectedEdge: number | null = null;
  let popup: CanvasNode | null = null;
  let popupTitle = '';
  let popupNote = '';
  let addTo: number = rootId;
  let picker: 'task' | 'experiment' | null = null;
  let pickerTasks: PickerTask[] = [];
  let pickerExperiments: Array<{ id: number; title: string }> = [];
  let pickerSearch = '';
  let pickerLoading = false;
  let searchTimer: number | undefined;
  let heights: Record<number, number> = {};
  let layout: Record<number, { ox: number; oy: number; fx: number; fy: number }> = {};
  let canvasHeight = 420;
  let dragging: number | null = null;
  let loadedRoot: number | null = null;
  // Stable per-project origin (the project-space point shown at the frame's top-left), so moving a card never
  // re-centres its group; and frame positions the user placed by hand, remembered per browser and board.
  let origins: Record<number, { ox: number; oy: number }> = {};
  let custom: Record<number, { fx: number; fy: number }> = {};
  let customLoadedFor: number | null = null;

  $: root = projects.find(project => project.id === rootId) ?? null;
  $: tree = root ? [root, ...projects.filter(project => project.parent_id === rootId)] : [];
  $: colorOf = (id: number): string => COLORS[Math.max(0, tree.findIndex(project => project.id === id)) % COLORS.length];
  $: visibleTree = tree.filter(project => visible.includes(project.id));
  $: shown = nodes.filter(node => visible.includes(node.project_id));
  $: if (rootId !== loadedRoot) {
    loadedRoot = rootId;
    addTo = rootId;
    void load(true);
  }

  function nodeHeight(node: CanvasNode): number {
    return heights[node.id] ?? ESTIMATE_H[node.type] ?? 100;
  }

  function resetVisible(): void {
    const ids = tree.map(project => project.id);
    visible = typeof activeId === 'number' && activeId !== rootId && ids.includes(activeId) ? [activeId] : ids;
    if (visible.length > 0 && !visible.includes(addTo)) addTo = visible[0];
  }

  async function load(resetView = false): Promise<void> {
    loading = true;
    try {
      const data = await ApiC.getJson(`todolist_canvas?project_id=${rootId}&include_subprojects=1`) as { nodes: CanvasNode[]; edges: CanvasEdge[] };
      nodes = data.nodes;
      edges = data.edges;
      if (resetView || visible.length === 0) resetVisible();
      relayout();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load the canvas.');
    } finally {
      loading = false;
    }
  }

  function loadCustom(): void {
    if (customLoadedFor === rootId) return;
    customLoadedFor = rootId;
    try {
      const stored = JSON.parse(window.localStorage.getItem(`pmc-groups-${rootId}`) ?? '{}') as { o?: typeof origins; c?: typeof custom };
      origins = stored.o ?? {};
      custom = stored.c ?? {};
    } catch {
      origins = {};
      custom = {};
    }
  }

  function saveCustom(): void {
    try {
      window.localStorage.setItem(`pmc-groups-${rootId}`, JSON.stringify({ o: origins, c: custom }));
    } catch {
      // positions of the frames are then simply not remembered
    }
  }

  // Each project keeps its own coordinate space; side by side on screen they only get an offset. Frames are
  // packed left to right unless the user has moved one. The origin of a project is only reset on request
  // (reset = true: first view, Fit), so moving a card never makes its group jump.
  function relayout(reset = false): void {
    loadCustom();
    if (reset) {
      origins = {};
      custom = {};
    }
    let originsAdded = false;
    const next: typeof layout = {};
    let cursorX = OUTER_PAD;
    let cursorY = OUTER_PAD;
    let rowHeight = 0;
    let bottom = 0;
    const maxWidth = Math.max(canvasWidth, 560);
    // from `visible` right now: the reactive visibleTree is only refreshed after the current handler returns
    for (const project of tree.filter(item => visible.includes(item.id))) {
      const own = nodes.filter(node => node.project_id === project.id);
      if (!origins[project.id]) {
        origins[project.id] = own.length > 0
          ? { ox: Math.min(...own.map(node => node.x)), oy: Math.min(...own.map(node => node.y)) }
          : { ox: 0, oy: 0 };
        originsAdded = true;
      }
      const { ox, oy } = origins[project.id];
      const width = own.length > 0 ? Math.max(NODE_W, Math.max(...own.map(node => node.x + NODE_W)) - ox) : 220;
      const height = own.length > 0 ? Math.max(70, Math.max(...own.map(node => node.y + nodeHeight(node))) - oy) : 70;
      const frameW = width + GROUP_PAD * 2;
      const frameH = height + GROUP_PAD * 2 + GROUP_LABEL;
      const placed = custom[project.id];
      if (placed) {
        next[project.id] = { ox, oy, fx: placed.fx, fy: placed.fy };
        bottom = Math.max(bottom, placed.fy + frameH);
        continue;
      }
      if (cursorX + frameW > maxWidth && cursorX > OUTER_PAD) {
        cursorX = OUTER_PAD;
        cursorY += rowHeight + GROUP_GAP;
        rowHeight = 0;
      }
      next[project.id] = { ox, oy, fx: cursorX, fy: cursorY };
      cursorX += frameW + GROUP_GAP;
      rowHeight = Math.max(rowHeight, frameH);
      bottom = Math.max(bottom, cursorY + rowHeight);
    }
    layout = next;
    canvasHeight = Math.max(420, bottom + OUTER_PAD);
    if (reset || originsAdded) saveCustom();
  }

  // `at` is the layout the position is read from. The template passes it explicitly: Svelte only re-runs a
  // template expression when a variable written in the expression itself changes, not one used inside a function.
  function screenX(node: CanvasNode, at: typeof layout = layout): number {
    const l = at[node.project_id];
    return l ? l.fx + GROUP_PAD + node.x - l.ox : node.x;
  }

  function screenY(node: CanvasNode, at: typeof layout = layout): number {
    const l = at[node.project_id];
    return l ? l.fy + GROUP_PAD + GROUP_LABEL + node.y - l.oy : node.y;
  }

  type Frame = { id: number; name: string; color: string; x: number; y: number; w: number; h: number };

  function frames(projectsShown: Proj[], list: CanvasNode[], layoutNow: typeof layout, _heights: typeof heights): Frame[] {
    return projectsShown.map(project => {
      const own = list.filter(node => node.project_id === project.id);
      const l = layoutNow[project.id];
      if (!l) return null;
      if (own.length === 0) {
        return { id: project.id, name: project.name, color: colorOf(project.id), x: l.fx, y: l.fy, w: 220 + GROUP_PAD * 2, h: 70 + GROUP_PAD * 2 + GROUP_LABEL };
      }
      const x1 = Math.min(...own.map(node => screenX(node, layoutNow)));
      const y1 = Math.min(...own.map(node => screenY(node, layoutNow)));
      const x2 = Math.max(...own.map(node => screenX(node, layoutNow) + NODE_W));
      const y2 = Math.max(...own.map(node => screenY(node, layoutNow) + nodeHeight(node)));
      return { id: project.id, name: project.name, color: colorOf(project.id), x: x1 - GROUP_PAD, y: y1 - GROUP_PAD - GROUP_LABEL, w: x2 - x1 + GROUP_PAD * 2, h: y2 - y1 + GROUP_PAD * 2 + GROUP_LABEL };
    }).filter((frame): frame is Frame => frame !== null);
  }

  $: frameList = frames(visibleTree, shown, layout, heights);

  type Arrow = { id: number; d: string; mx: number; my: number };

  function edgePoint(node: CanvasNode, towardX: number, towardY: number, at: typeof layout): [number, number] {
    const w = NODE_W;
    const h = nodeHeight(node);
    const cx = screenX(node, at) + w / 2;
    const cy = screenY(node, at) + h / 2;
    const dx = towardX - cx;
    const dy = towardY - cy;
    const scale = Math.min(w / 2 / Math.abs(dx || 0.001), h / 2 / Math.abs(dy || 0.001));
    return [cx + dx * scale, cy + dy * scale];
  }

  function arrows(list: CanvasNode[], edgeList: CanvasEdge[], layoutNow: typeof layout, _heights: typeof heights): { items: Arrow[]; hidden: number } {
    const byId = new Map(list.map(node => [node.id, node]));
    const items: Arrow[] = [];
    let hidden = 0;
    for (const edge of edgeList) {
      const from = byId.get(edge.from_node);
      const to = byId.get(edge.to_node);
      if (!from || !to) {
        hidden += 1;
        continue;
      }
      const fromCentre: [number, number] = [screenX(from, layoutNow) + NODE_W / 2, screenY(from, layoutNow) + nodeHeight(from) / 2];
      const toCentre: [number, number] = [screenX(to, layoutNow) + NODE_W / 2, screenY(to, layoutNow) + nodeHeight(to) / 2];
      const [px, py] = edgePoint(from, toCentre[0], toCentre[1], layoutNow);
      const [qx, qy] = edgePoint(to, fromCentre[0], fromCentre[1], layoutNow);
      const mx = (px + qx) / 2;
      items.push({ id: edge.id, d: `M${px} ${py} Q${mx} ${py} ${qx} ${qy}`, mx: (px + 2 * mx + qx) / 4, my: (py + 2 * py + qy) / 4 });
    }
    return { items, hidden };
  }

  $: arrowData = arrows(shown, edges, layout, heights);

  // Real card heights are only known after rendering, and can change later (fonts, wrapped titles): every card
  // reports its size here, and the layout follows.
  function measure(element: HTMLElement, id: number): { destroy(): void } {
    const observer = new ResizeObserver(() => {
      const height = element.offsetHeight;
      if (Math.abs((heights[id] ?? 0) - height) <= 1) return;
      heights = { ...heights, [id]: height };
      if (dragging === null) relayout();
    });
    observer.observe(element);
    return { destroy: () => observer.disconnect() };
  }

  onMount(() => {
    const observer = new ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (Math.abs(width - canvasWidth) > 8) {
        canvasWidth = width;
        if (dragging === null) relayout();
      }
    });
    observer.observe(canvasEl);
    return () => observer.disconnect();
  });

  function toggleProject(id: number): void {
    visible = visible.includes(id) ? visible.filter(value => value !== id) : [...visible, id];
    if (visible.length > 0 && !visible.includes(addTo)) addTo = visible[0];
    selectedEdge = null;
    popup = null;
    relayout();
  }

  function showAll(): void {
    visible = tree.map(project => project.id);
    relayout();
  }

  function hideAll(): void {
    visible = [];
    selectedEdge = null;
    popup = null;
    relayout();
  }

  function setTool(next: Tool): void {
    tool = next;
    pending = null;
    selectedEdge = null;
  }

  // Pointer handling: a press that barely moves is a click (open the card), a longer one drags it.
  function startDrag(event: PointerEvent, node: CanvasNode): void {
    if ((event.target as HTMLElement).closest('button, a, input, textarea')) return;
    if (event.button !== 0) return;
    selectedEdge = null;
    if (tool !== 'select') {
      void toolClick(node);
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = node.x;
    const originY = node.y;
    let moved = false;
    dragging = node.id;
    const move = (e: PointerEvent): void => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const o = origins[node.project_id] ?? { ox: -20000, oy: -20000 };
      node.x = Math.max(o.ox, Math.round(originX + dx));
      node.y = Math.max(o.oy, Math.round(originY + dy));
      nodes = nodes;
    };
    const up = async (): Promise<void> => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragging = null;
      if (moved) {
        relayout();
        try {
          await ApiC.patch(`todolist_canvas/${node.id}`, { x: node.x, y: node.y, notifOnSaved: 0 });
        } catch (error) {
          notify.error(error instanceof Error ? error.message : 'Could not save the position.');
        }
      } else {
        openCard(node);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // A frame is moved by its label; the cards inside travel with it. Where it was put is remembered.
  function startFrameDrag(event: PointerEvent, frame: Frame): void {
    if (event.button !== 0) return;
    const l = layout[frame.id];
    if (!l) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const originFx = l.fx;
    const originFy = l.fy;
    dragging = -frame.id;
    const move = (e: PointerEvent): void => {
      const current = layout[frame.id];
      if (!current) return;
      current.fx = Math.round(originFx + e.clientX - startX);
      current.fy = Math.round(originFy + e.clientY - startY);
      layout = layout;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragging = null;
      const final = layout[frame.id];
      if (final) {
        custom[frame.id] = { fx: final.fx, fy: final.fy };
        saveCustom();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function toolClick(node: CanvasNode): Promise<void> {
    if (tool === 'connect') {
      if (pending === null) {
        pending = node.id;
      } else if (pending !== node.id) {
        const from = pending;
        pending = null;
        try {
          await ApiC.post('todolist_canvas_edges', { from_node: from, to_node: node.id, notifOnSaved: 0 });
          await load();
        } catch (error) {
          notify.error(error instanceof Error ? error.message : 'Could not connect these cards.');
        }
      } else {
        pending = null;
      }
      return;
    }
    if (tool === 'remove') {
      await removeNode(node);
    }
  }

  async function removeNode(node: CanvasNode): Promise<void> {
    const what = node.type === 'question' ? 'this question' : 'this card';
    if (!await askConfirm(`Remove ${what} from the canvas? ${node.type === 'task' ? 'The task itself is kept.' : ''}`.trim(), t('Remove'))) return;
    try {
      await ApiC.delete(`todolist_canvas/${node.id}`);
      popup = null;
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not remove the card.');
    }
  }

  function openCard(node: CanvasNode): void {
    if (node.type === 'task' && node.task) {
      onOpenTask(node.task.id);
      return;
    }
    popup = node;
    popupTitle = node.title ?? '';
    popupNote = node.note ?? '';
  }

  async function savePopup(): Promise<void> {
    if (!popup) return;
    try {
      await ApiC.patch(`todolist_canvas/${popup.id}`, { title: popupTitle, note: popupNote, notifOnSaved: 0 });
      popup = null;
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save the question.');
    }
  }

  async function convertToTask(node: CanvasNode): Promise<void> {
    try {
      await ApiC.patch(`todolist_canvas/${node.id}`, { convert_to_task: true, notifOnSaved: 0 });
      popup = null;
      await load();
      notify.success(t('Question turned into a task.'));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not turn this into a task.');
    }
  }

  async function removeEdge(id: number): Promise<void> {
    selectedEdge = null;
    try {
      await ApiC.delete(`todolist_canvas_edges/${id}`);
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not remove the arrow.');
    }
  }

  // New cards go below the existing ones of their project, so they never land on top of another card.
  function freeSpot(projectId: number): { x: number; y: number } {
    const own = nodes.filter(node => node.project_id === projectId);
    if (own.length === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(...own.map(node => node.x)),
      y: Math.max(...own.map(node => node.y + nodeHeight(node))) + 24,
    };
  }

  async function addNode(body: Record<string, unknown>, projectId: number): Promise<void> {
    const spot = freeSpot(projectId);
    try {
      await ApiC.post('todolist_canvas', { project_id: projectId, x: spot.x, y: spot.y, notifOnSaved: 0, ...body });
      if (!visible.includes(projectId)) visible = [...visible, projectId];
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not add the card.');
    }
  }

  async function addQuestion(): Promise<void> {
    await addNode({ type: 'question', title: t('New question') }, addTo);
    const added = [...nodes].reverse().find(node => node.type === 'question' && node.project_id === addTo);
    if (added) openCard(added);
  }

  async function openTaskPicker(): Promise<void> {
    picker = 'task';
    pickerLoading = true;
    try {
      const base = `todolist?scope=team&limit=200&offset=0&project_id=${rootId}&include_subprojects=1`;
      const [open, done] = await Promise.all([
        ApiC.getJson(base) as Promise<PickerTask[]>,
        ApiC.getJson(`${base}&completed=1`) as Promise<PickerTask[]>,
      ]);
      pickerTasks = [...open, ...done];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load the tasks.');
    } finally {
      pickerLoading = false;
    }
  }

  function taskOnCanvas(taskId: number): boolean {
    return nodes.some(node => node.task_id === taskId);
  }

  async function addTask(task: PickerTask): Promise<void> {
    const home = task.project_id !== null && tree.some(project => project.id === task.project_id) ? task.project_id : addTo;
    await addNode({ type: 'task', task_id: task.id }, home);
  }

  function openExperimentPicker(): void {
    picker = 'experiment';
    pickerSearch = '';
    void searchExperiments();
  }

  async function searchExperiments(): Promise<void> {
    pickerLoading = true;
    try {
      const query = pickerSearch.trim();
      const result = await ApiC.getJson(`experiments?limit=10${query ? `&q=${encodeURIComponent(query)}` : ''}`) as Array<{ id: number; title: string }>;
      pickerExperiments = result;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not search experiments.');
    } finally {
      pickerLoading = false;
    }
  }

  function onPickerSearch(): void {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void searchExperiments(), 250);
  }

  function initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('');
  }

  function formatDate(value: string | null): string {
    if (!value) return '';
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function isLate(task: CanvasTask): boolean {
    if (!task.deadline || task.completed_at) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(task.deadline).getTime() < today.getTime();
  }

  function projectName(id: number | null): string {
    return projects.find(project => project.id === id)?.name ?? '';
  }
</script>

<div class="pmc">
  <div class="pmc-toolbar">
    <button type="button" class="btn btn-sm" class:btn-primary={tool === 'select'} class:btn-ghost={tool !== 'select'} on:click={() => setTool('select')}><i class="fas fa-arrow-pointer fa-fw mr-1" aria-hidden="true"></i>{t('Select')}</button>
    <button type="button" class="btn btn-sm btn-ghost" on:click={addQuestion}><i class="fas fa-circle-question fa-fw mr-1" aria-hidden="true"></i>{t('Question')}</button>
    <button type="button" class="btn btn-sm btn-ghost" on:click={openTaskPicker}><i class="fas fa-square-check fa-fw mr-1" aria-hidden="true"></i>{t('Existing task')}</button>
    <button type="button" class="btn btn-sm btn-ghost" on:click={openExperimentPicker}><i class="fas fa-flask fa-fw mr-1" aria-hidden="true"></i>{t('Experiment')}</button>
    <button type="button" class="btn btn-sm" class:btn-primary={tool === 'connect'} class:btn-ghost={tool !== 'connect'} on:click={() => setTool(tool === 'connect' ? 'select' : 'connect')}><i class="fas fa-arrow-right fa-fw mr-1" aria-hidden="true"></i>{t('Connect')}</button>
    <button type="button" class="btn btn-sm" class:btn-primary={tool === 'remove'} class:btn-ghost={tool !== 'remove'} on:click={() => setTool(tool === 'remove' ? 'select' : 'remove')}><i class="fas fa-xmark fa-fw mr-1" aria-hidden="true"></i>{t('Remove')}</button>
    <button type="button" class="btn btn-sm btn-ghost" on:click={() => relayout(true)}><i class="fas fa-crosshairs fa-fw mr-1" aria-hidden="true"></i>{t('Fit')}</button>
    {#if visibleTree.length > 1}
      <label class="pmc-addto">
        <span class="pm-muted">{t('Add to')}</span>
        <select class="form-control form-control-sm" bind:value={addTo}>
          {#each visibleTree as project (project.id)}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </label>
    {/if}
    <span class="pmc-hint pm-muted">
      {#if tool === 'connect'}{pending === null ? t('Click a card, then another to draw an arrow') : t('Now click the card it points to')}
      {:else if tool === 'remove'}{t('Click a card to take it off the canvas')}
      {:else if arrowData.hidden > 0}{arrowData.hidden} {t('arrow(s) lead to projects that are hidden')}
      {:else}{t('Click a card to open it, drag to move it')}{/if}
    </span>
  </div>

  <div class="pmc-layout">
    <aside class="pmc-tree" aria-label={t('Projects')}>
      <div class="pm-label">{t('Projects')}</div>
      {#each tree as project, index (project.id)}
        <button type="button" class="pmc-tree-item" class:sub={index > 0} on:click={() => toggleProject(project.id)}>
          <i class="far {visible.includes(project.id) ? 'fa-square-check' : 'fa-square'} fa-fw" aria-hidden="true"></i>
          <span class="pmc-dot" style="background:{colorOf(project.id)}"></span>
          <span class="pmc-tree-name">{project.name}</span>
          <span class="pm-muted pmc-count">{nodes.filter(node => node.project_id === project.id).length}</span>
        </button>
      {/each}
      {#if tree.length > 1}
        <div class="pmc-tree-actions">
          <button type="button" class="btn btn-sm btn-ghost" on:click={showAll}>{t('Show all')}</button>
          <button type="button" class="btn btn-sm btn-ghost" on:click={hideAll}>{t('Hide all')}</button>
        </div>
      {/if}
    </aside>

    <div class="pmc-canvas" bind:this={canvasEl} style="height:{canvasHeight}px">
      {#if loading && nodes.length === 0}
        <p class="pm-muted p-3">{t('Loading')}…</p>
      {:else if visible.length === 0}
        <p class="pm-muted p-3">{t('Tick a project on the left to show its canvas.')}</p>
      {/if}

      {#each frameList as frame (frame.id)}
        <div class="pmc-frame" style="left:{frame.x}px;top:{frame.y}px;width:{frame.w}px;height:{frame.h}px;border-color:{frame.color}">
          <span class="pmc-frame-label" style="color:{frame.color}" title={t('Drag to move this project')} on:pointerdown={(event) => startFrameDrag(event, frame)} role="presentation"><span class="pmc-dot" style="background:{frame.color}"></span>{frame.name}</span>
        </div>
      {/each}

      <svg class="pmc-edges" width="100%" height={canvasHeight} aria-hidden="true">
        <defs>
          <marker id="pmc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="currentColor"></path>
          </marker>
        </defs>
        {#each arrowData.items as arrow (arrow.id)}
          <path d={arrow.d} class="pmc-edge" class:selected={selectedEdge === arrow.id} marker-end="url(#pmc-arrow)"></path>
          <path d={arrow.d} class="pmc-edge-hit" on:click={() => { selectedEdge = selectedEdge === arrow.id ? null : arrow.id; }} role="presentation"></path>
          {#if selectedEdge === arrow.id}
            <g class="pmc-edge-delete" transform="translate({arrow.mx} {arrow.my})" on:click={() => removeEdge(arrow.id)} role="presentation">
              <circle r="10"></circle>
              <path d="M-4 -4L4 4M4 -4L-4 4"></path>
            </g>
          {/if}
        {/each}
      </svg>

      {#each shown as node (node.id)}
        <div
          class="pmc-node pmc-{node.type}"
          class:pmc-pending={pending === node.id}
          class:pmc-dragging={dragging === node.id}
          class:pmc-remove={tool === 'remove'}
          data-id={node.id}
          use:measure={node.id}
          style="left:{screenX(node, layout)}px;top:{screenY(node, layout)}px;width:{NODE_W}px"
          on:pointerdown={(event) => startDrag(event, node)}
          role="button"
          tabindex="0"
          on:keydown={(event) => { if (event.key === 'Enter') openCard(node); }}
        >
          {#if node.type === 'question'}
            <div class="pmc-kind"><i class="fas fa-circle-question fa-fw" aria-hidden="true"></i>{t('Question')}</div>
            <div class="pmc-title">{node.title}</div>
            {#if node.note}<div class="pmc-note">{node.note}</div>{/if}
            <div class="pmc-meta">
              <button type="button" class="pmc-chip pmc-chip-action" on:click|stopPropagation={() => convertToTask(node)}><i class="fas fa-arrow-right fa-fw" aria-hidden="true"></i>{t('Make task')}</button>
            </div>
          {:else if node.type === 'task'}
            {#if node.task}
              {@const task = node.task}
              <div class="pmc-kind">
                <i class="fas fa-square-check fa-fw" aria-hidden="true"></i>{t('Task')}
                {#if task.priority}<span class="pmc-prio pmc-prio-{task.priority}"><i class="fas fa-flag fa-fw" aria-hidden="true"></i>{t(task.priority)}</span>{/if}
              </div>
              <div class="pmc-title">
                {#if task.completed_at}<i class="fas fa-circle-check pmc-done" aria-hidden="true"></i>{/if}{task.title}
              </div>
              <div class="pmc-meta">
                {#each task.assignees.slice(0, 3) as name (name)}<span class="pmc-avatar" title={name}>{initials(name)}</span>{/each}
                {#if task.assignees.length === 0}<span class="pmc-chip"><i class="fas fa-user-plus fa-fw" aria-hidden="true"></i>{t('Unassigned')}</span>{/if}
                {#if task.deadline}<span class:pmc-late={isLate(task)}><i class="far fa-calendar fa-fw" aria-hidden="true"></i>{formatDate(task.deadline)}</span>{/if}
                {#if task.comments > 0}<span><i class="far fa-comment fa-fw" aria-hidden="true"></i>{task.comments}</span>{/if}
              </div>
              {#if task.steps_total > 0}
                <div class="pmc-bar"><i style="width:{Math.round(task.steps_done / task.steps_total * 100)}%"></i></div>
              {/if}
              <div class="pmc-meta">
                {#if task.column}<span class="pmc-chip">{task.column}</span>{/if}
                {#if task.steps_total > 0}<span>{task.steps_done}/{task.steps_total} {t('steps')}</span>{/if}
              </div>
            {:else}
              <div class="pmc-kind"><i class="fas fa-square-check fa-fw" aria-hidden="true"></i>{t('Task')}</div>
              <div class="pmc-title pm-muted">{t('This task no longer exists')}</div>
            {/if}
          {:else}
            <div class="pmc-kind"><i class="fas fa-flask fa-fw" aria-hidden="true"></i>{t('Experiment')}</div>
            {#if node.experiment}
              <div class="pmc-title">{node.experiment.title}</div>
              <div class="pmc-meta">
                {#if node.experiment.status}<span class="pmc-chip" style="background:#{node.experiment.status_color ?? 'cccccc'}33">{node.experiment.status}</span>{/if}
                {#if node.experiment.date}<span>{formatDate(node.experiment.date)}</span>{/if}
              </div>
            {:else}
              <div class="pmc-title pm-muted">{t('This experiment is not available')}</div>
            {/if}
          {/if}
        </div>
      {/each}

      {#if popup}
        <div class="pmc-popup" role="dialog" aria-label={popup.type}>
          <div class="d-flex justify-content-between align-items-start" style="gap:0.5rem">
            <div>
              <div class="pm-muted small">{popup.type === 'question' ? t('Question') : t('Experiment')} · {projectName(popup.project_id)}</div>
              {#if popup.type === 'question'}
                <input class="form-control form-control-sm mt-1" type="text" maxlength="255" bind:value={popupTitle} aria-label={t('Title')}>
              {:else}
                <strong>{popup.experiment?.title ?? t('This experiment is not available')}</strong>
              {/if}
            </div>
            <button type="button" class="btn btn-ghost btn-sm" aria-label={t('Close')} on:click={() => { popup = null; }}><i class="fas fa-xmark" aria-hidden="true"></i></button>
          </div>
          {#if popup.type === 'question'}
            <label class="pm-label mt-3" for="pmc-note">{t('Notes')}</label>
            <textarea id="pmc-note" class="form-control form-control-sm" rows="5" bind:value={popupNote}></textarea>
            <div class="d-flex mt-3" style="gap:0.4rem;flex-wrap:wrap">
              <button type="button" class="btn btn-primary btn-sm" on:click={savePopup}>{t('Save')}</button>
              <button type="button" class="btn btn-ghost btn-sm" on:click={() => popup && convertToTask(popup)}><i class="fas fa-arrow-right fa-fw mr-1" aria-hidden="true"></i>{t('Convert to task')}</button>
              <button type="button" class="btn btn-ghost btn-sm" on:click={() => popup && removeNode(popup)}>{t('Remove')}</button>
            </div>
          {:else if popup.experiment}
            <div class="mt-3 small">
              {#if popup.experiment.status}<div><span class="pm-muted">{t('Status')}:</span> {popup.experiment.status}</div>{/if}
              {#if popup.experiment.date}<div><span class="pm-muted">{t('Date')}:</span> {formatDate(popup.experiment.date)}</div>{/if}
            </div>
            <div class="d-flex mt-3" style="gap:0.4rem">
              <a class="btn btn-primary btn-sm" href="experiments.php?mode=view&id={popup.experiment.id}" target="_blank" rel="noopener">{t('Open experiment')}</a>
              <button type="button" class="btn btn-ghost btn-sm" on:click={() => popup && removeNode(popup)}>{t('Remove')}</button>
            </div>
          {:else}
            <div class="d-flex mt-3"><button type="button" class="btn btn-ghost btn-sm" on:click={() => popup && removeNode(popup)}>{t('Remove')}</button></div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#if picker === 'task'}
    <div class="pmc-picker">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <strong>{t('Add an existing task')}</strong>
        <button type="button" class="btn btn-ghost btn-sm" aria-label={t('Close')} on:click={() => { picker = null; }}><i class="fas fa-xmark" aria-hidden="true"></i></button>
      </div>
      {#if pickerLoading}<p class="pm-muted mb-0">{t('Loading')}…</p>{/if}
      {#each pickerTasks.filter(task => !taskOnCanvas(task.id)) as task (task.id)}
        <div class="pmc-picker-row">
          <span class="flex-grow-1 text-truncate">{task.body}</span>
          <span class="pm-muted small">{projectName(task.project_id)}</span>
          <button type="button" class="btn btn-ghost btn-sm" on:click={() => addTask(task)}>{t('Add')}</button>
        </div>
      {:else}
        {#if !pickerLoading}<p class="pm-muted mb-0">{t('Everything is already on the canvas.')}</p>{/if}
      {/each}
    </div>
  {:else if picker === 'experiment'}
    <div class="pmc-picker">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <strong>{t('Add an experiment')}</strong>
        <button type="button" class="btn btn-ghost btn-sm" aria-label={t('Close')} on:click={() => { picker = null; }}><i class="fas fa-xmark" aria-hidden="true"></i></button>
      </div>
      <input class="form-control form-control-sm mb-2" type="search" placeholder={t('Search experiments')} bind:value={pickerSearch} on:input={onPickerSearch}>
      {#if pickerLoading}<p class="pm-muted mb-0">{t('Loading')}…</p>{/if}
      {#each pickerExperiments as experiment (experiment.id)}
        <div class="pmc-picker-row">
          <span class="flex-grow-1 text-truncate">{experiment.title}</span>
          <span class="pm-muted small">#{experiment.id}</span>
          <button type="button" class="btn btn-ghost btn-sm" disabled={nodes.some(node => node.entity_id === experiment.id && node.project_id === addTo)} on:click={() => addNode({ type: 'experiment', entity_id: experiment.id }, addTo)}>{t('Add')}</button>
        </div>
      {/each}
    </div>
  {/if}
</div>
