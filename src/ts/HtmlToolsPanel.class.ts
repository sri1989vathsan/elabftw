/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import { ApiC } from './api';
import SidePanel from './SidePanel.class';

interface HtmlTool {
  id: number;
  name: string;
  description: string;
  version: string;
  launch_url: string;
}

export default class HtmlToolsPanel extends SidePanel {
  private static readonly WORKSPACE_WIDTH_KEY = 'html-tool-workspace-width';
  private static readonly MIN_WORKSPACE_WIDTH = 360;
  private static readonly MAX_WORKSPACE_WIDTH = 1100;
  private tools: HtmlTool[] = [];
  private loaded = false;
  private loading = false;

  constructor() {
    super('html-tools');
    this.panelId = 'htmlToolsPanel';
    document.getElementById('htmlToolsSearch')?.addEventListener('input', () => this.render());
    document.getElementById('htmlToolMaximize')?.addEventListener('click', () => this.toggleMaximized());
    document.getElementById('htmlToolClose')?.addEventListener('click', () => this.closeWorkspace());
    window.addEventListener('html-tools-changed', () => {
      if (this.loaded) void this.refresh();
    });
    this.initializeWorkspaceResizer();
  }

  show(): void {
    super.show();
    if (!this.loaded) void this.loadTools();
  }

  async refresh(): Promise<void> {
    this.loaded = false;
    await this.loadTools();
  }

  private async loadTools(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.setStatus('Loading tools…');
    try {
      this.tools = await ApiC.getJson<HtmlTool[]>('html_tools');
      this.loaded = true;
      this.render();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Could not load HTML tools.');
    } finally {
      this.loading = false;
    }
  }

  private render(): void {
    const list = document.getElementById('htmlToolsList');
    if (!list) return;
    const query = (document.getElementById('htmlToolsSearch') as HTMLInputElement | null)?.value
      .trim().toLocaleLowerCase() ?? '';
    const tools = this.tools.filter(tool => (
      `${tool.name} ${tool.description} ${tool.version}`.toLocaleLowerCase().includes(query)
    ));
    list.replaceChildren(...tools.map(tool => this.createToolCard(tool)));
    if (tools.length === 0) {
      this.setStatus(this.tools.length === 0
        ? 'No HTML tools have been installed by a sysadmin yet.'
        : 'No tools match your search.');
      return;
    }
    this.setStatus(`${tools.length} tool${tools.length === 1 ? '' : 's'} available.`);
  }

  private createToolCard(tool: HtmlTool): HTMLElement {
    const card = document.createElement('article');
    card.className = 'html-tool-card';

    const icon = document.createElement('span');
    icon.className = 'html-tool-card-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<i class="fas fa-cubes"></i>';

    const body = document.createElement('div');
    body.className = 'html-tool-card-body';
    const heading = document.createElement('h4');
    heading.className = 'html-tool-card-title';
    heading.textContent = tool.name;
    body.append(heading);
    if (tool.description) {
      const description = document.createElement('p');
      description.className = 'html-tool-card-description';
      description.textContent = tool.description;
      body.append(description);
    }
    if (tool.version) {
      const version = document.createElement('span');
      version.className = 'html-tool-version';
      version.textContent = `v${tool.version}`;
      body.append(version);
    }

    const actions = document.createElement('div');
    actions.className = 'html-tool-card-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-primary btn-sm';
    open.innerHTML = '<i class="fas fa-play fa-fw mr-1"></i>Open';
    open.addEventListener('click', () => this.openTool(tool));
    const newWindow = document.createElement('a');
    newWindow.className = 'btn btn-outline-secondary btn-sm';
    newWindow.href = tool.launch_url;
    newWindow.target = '_blank';
    newWindow.rel = 'noopener noreferrer';
    newWindow.title = 'Open in a new window';
    newWindow.setAttribute('aria-label', `Open ${tool.name} in a new window`);
    newWindow.innerHTML = '<i class="fas fa-up-right-from-square fa-fw"></i>';
    actions.append(open, newWindow);
    body.append(actions);
    card.append(icon, body);
    return card;
  }

  private openTool(tool: HtmlTool): void {
    const iframe = document.getElementById('htmlToolIframe') as HTMLIFrameElement | null;
    const title = document.getElementById('htmlToolWorkspaceTitle');
    const newWindow = document.getElementById('htmlToolNewWindow') as HTMLAnchorElement | null;
    const workspace = document.getElementById('htmlToolWorkspace');
    if (!iframe || !title || !newWindow || !workspace) return;
    title.textContent = tool.name;
    iframe.title = tool.name;
    iframe.src = tool.launch_url;
    newWindow.href = tool.launch_url;
    workspace.removeAttribute('hidden');
    document.body.classList.add('html-tool-workspace-open');
    iframe.focus();
  }

  private toggleMaximized(): void {
    const workspace = document.getElementById('htmlToolWorkspace');
    const button = document.getElementById('htmlToolMaximize');
    const icon = button?.querySelector('i');
    if (!workspace || !button || !icon) return;
    const maximized = workspace.classList.toggle('html-tool-workspace-maximized');
    document.body.classList.toggle('html-tool-workspace-is-maximized', maximized);
    icon.classList.toggle('fa-expand', !maximized);
    icon.classList.toggle('fa-compress', maximized);
    button.title = maximized ? 'Restore sidebar' : 'Maximize';
    button.setAttribute('aria-label', button.title);
  }

  private closeWorkspace(): void {
    const iframe = document.getElementById('htmlToolIframe') as HTMLIFrameElement | null;
    const workspace = document.getElementById('htmlToolWorkspace');
    if (iframe) iframe.removeAttribute('src');
    workspace?.classList.remove('html-tool-workspace-maximized');
    workspace?.toggleAttribute('hidden', true);
    document.body.classList.remove('html-tool-workspace-open', 'html-tool-workspace-is-maximized');
  }

  private initializeWorkspaceResizer(): void {
    const resizer = document.getElementById('htmlToolWorkspaceResizer');
    if (!resizer) return;
    const storedWidth = Number.parseFloat(localStorage.getItem(HtmlToolsPanel.WORKSPACE_WIDTH_KEY) ?? '');
    this.setWorkspaceWidth(Number.isFinite(storedWidth) ? storedWidth : window.innerWidth * 0.46);

    resizer.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizer.setPointerCapture(event.pointerId);
      document.body.classList.add('html-tool-workspace-resizing');
      const resize = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId === event.pointerId) this.setWorkspaceWidth(window.innerWidth - moveEvent.clientX);
      };
      const finish = (endEvent: PointerEvent): void => {
        if (endEvent.pointerId !== event.pointerId) return;
        resizer.removeEventListener('pointermove', resize);
        resizer.removeEventListener('pointerup', finish);
        resizer.removeEventListener('pointercancel', finish);
        document.body.classList.remove('html-tool-workspace-resizing');
        localStorage.setItem(
          HtmlToolsPanel.WORKSPACE_WIDTH_KEY,
          getComputedStyle(document.documentElement).getPropertyValue('--html-tool-workspace-width').trim(),
        );
      };
      resizer.addEventListener('pointermove', resize);
      resizer.addEventListener('pointerup', finish);
      resizer.addEventListener('pointercancel', finish);
    });
    resizer.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const current = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--html-tool-workspace-width'),
      );
      this.setWorkspaceWidth(current + (event.key === 'ArrowLeft' ? 20 : -20));
      localStorage.setItem(
        HtmlToolsPanel.WORKSPACE_WIDTH_KEY,
        getComputedStyle(document.documentElement).getPropertyValue('--html-tool-workspace-width').trim(),
      );
    });
    window.addEventListener('resize', () => {
      const current = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--html-tool-workspace-width'),
      );
      this.setWorkspaceWidth(current);
    });
  }

  private setWorkspaceWidth(width: number): void {
    const viewportMaximum = Math.max(HtmlToolsPanel.MIN_WORKSPACE_WIDTH, window.innerWidth - 280);
    const maximum = Math.min(HtmlToolsPanel.MAX_WORKSPACE_WIDTH, viewportMaximum);
    const nextWidth = Math.round(Math.min(Math.max(width, HtmlToolsPanel.MIN_WORKSPACE_WIDTH), maximum));
    document.documentElement.style.setProperty('--html-tool-workspace-width', `${nextWidth}px`);
    const resizer = document.getElementById('htmlToolWorkspaceResizer');
    resizer?.setAttribute('aria-valuenow', String(nextWidth));
    resizer?.setAttribute('aria-valuemax', String(maximum));
  }

  private setStatus(message: string): void {
    const status = document.getElementById('htmlToolsStatus');
    if (status) status.textContent = message;
  }
}
