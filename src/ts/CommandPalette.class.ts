import { ApiC } from './api';

interface PaletteEntry {
  label: string;
  description: string;
  icon: string;
  keywords: string;
  action: () => void;
}

interface SearchEntity {
  id: number;
  page?: string;
  title?: string;
  category_title?: string;
  type?: string;
}

/** Searchable keyboard-first launcher for common navigation and editor actions. */
export default class CommandPalette {
  private overlay: HTMLDivElement;
  private input: HTMLInputElement;
  private results: HTMLDivElement;
  private entries: PaletteEntry[] = [];
  private searchTimer: number | null = null;
  private searchSequence = 0;
  private activeIndex = 0;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'command-palette-overlay';
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <section class="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
        <header class="command-palette-header">
          <i class="fas fa-search" aria-hidden="true"></i>
          <input id="command-palette-input" type="search" autocomplete="off" spellcheck="false"
            placeholder="Search or run a command…" aria-label="Search commands, experiments, resources and headings">
          <kbd>Esc</kbd>
        </header>
        <div id="command-palette-title" class="sr-only">Command palette</div>
        <div class="command-palette-results" role="listbox"></div>
        <footer>Navigate with ↑ ↓ · select with Enter · open with Ctrl/Cmd + K</footer>
      </section>`;
    document.body.append(this.overlay);
    this.input = this.overlay.querySelector('#command-palette-input');
    this.results = this.overlay.querySelector('.command-palette-results');
    this.entries = this.buildEntries();
    this.bindEvents();
    document.getElementById('commandPaletteOpener')?.addEventListener('click', () => this.open());
  }

  private buildEntries(): PaletteEntry[] {
    const click = (selector: string): void => {
      (document.querySelector(selector) as HTMLElement | null)?.click();
    };
    const editorAction = (label: string): void => {
      const containers = Array.from(document.querySelectorAll<HTMLElement>('.tox-tinymce'));
      const button = containers
        .flatMap(container => Array.from(container.querySelectorAll<HTMLElement>('[aria-label]')))
        .find(candidate => candidate.getAttribute('aria-label')?.toLowerCase().startsWith(label.toLowerCase()));
      button?.click();
    };
    return [
      { label: 'Save', description: 'Save the current entry', icon: 'fa-save', keywords: 'write autosave', action: () => click('[data-action="update-entity-body"]') },
      { label: 'Save and go back', description: 'Save and return to view mode', icon: 'fa-arrow-left', keywords: 'return view', action: () => click('[data-action="update-entity-body"][data-redirect]') },
      { label: 'Insert date', description: 'Insert today using your saved date style', icon: 'fa-calendar-days', keywords: 'day today calendar', action: () => editorAction('Insert today') },
      { label: 'Insert title', description: 'Insert a styled experiment title', icon: 'fa-heading', keywords: 'header heading', action: () => editorAction('Insert experiment title') },
      { label: 'Insert note', description: 'Insert a note using your saved defaults', icon: 'fa-note-sticky', keywords: 'callout box', action: () => editorAction('Insert a note') },
      { label: 'Insert table or spreadsheet', description: 'Open table, spreadsheet and well-plate options', icon: 'fa-table', keywords: 'formula well plate benchling', action: () => editorAction('Insert a table') },
      { label: 'Insert link', description: 'Insert a web, file/folder or LabCollector link', icon: 'fa-link', keywords: 'url file folder', action: () => editorAction('Insert a web') },
      { label: 'Open folders', description: 'Browse personal, bookmarked and team folders', icon: 'fa-folder-tree', keywords: 'sidebar navigation', action: () => click('#foldersPanelOpener') },
      { label: 'Open filters', description: 'Search and filter experiments or resources', icon: 'fa-filter', keywords: 'tags category owner status', action: () => click('#favoritesPanelOpener') },
      { label: 'Search everything', description: 'Search experiments, resources, templates, tasks and folders at once', icon: 'fa-magnifying-glass', keywords: 'unified find filters favorites', action: () => click('#favoritesPanelOpener') },
      { label: 'Open tasks', description: 'View tasks and steps', icon: 'fa-list-check', keywords: 'todo reminder', action: () => click('#todolistPanelOpener') },
      { label: 'Open calendar', description: 'View tasks and document activity by date', icon: 'fa-calendar', keywords: 'agenda activity', action: () => click('#calendarActivityPanelOpener') },
      { label: 'Open table of contents', description: 'Navigate headings in the current entry', icon: 'fa-list-ul', keywords: 'toc headers', action: () => click('#tocPanelOpener') },
    ].filter(entry => {
      if (entry.label.startsWith('Insert') || entry.label.startsWith('Save')) {
        return Boolean(document.getElementById('body_area'));
      }
      return true;
    });
  }

  private bindEvents(): void {
    // Ctrl/Cmd+K pressed while focus is inside the TinyMCE iframe never
    // reaches this outer document's keydown listener (separate document
    // tree) -- tinymce.ts frees up its own meta+k shortcut and dispatches
    // this instead, so the palette opens the same way regardless of focus.
    document.addEventListener('elabftw-open-command-palette', () => this.open());
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        this.open();
        return;
      }
      if (this.overlay.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.moveActive(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.results.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.click();
      }
    });
    this.overlay.addEventListener('click', event => {
      if (event.target === this.overlay) this.close();
    });
    this.input.addEventListener('input', () => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => void this.render(), 220);
    });
  }

  private open(): void {
    this.overlay.hidden = false;
    document.body.classList.add('command-palette-open');
    this.input.value = '';
    this.activeIndex = 0;
    void this.render();
    window.requestAnimationFrame(() => this.input.focus());
  }

  private close(): void {
    this.overlay.hidden = true;
    document.body.classList.remove('command-palette-open');
  }

  private moveActive(change: number): void {
    const buttons = Array.from(this.results.querySelectorAll<HTMLButtonElement>('.command-palette-result'));
    if (buttons.length === 0) return;
    this.activeIndex = (this.activeIndex + change + buttons.length) % buttons.length;
    buttons.forEach((button, index) => button.setAttribute('aria-selected', String(index === this.activeIndex)));
    buttons[this.activeIndex].scrollIntoView({ block: 'nearest' });
  }

  private localNavigationResults(query: string): PaletteEntry[] {
    const entries: PaletteEntry[] = [];
    const roots = [document.getElementById('body_view'), document.querySelector<HTMLIFrameElement>('.tox-edit-area iframe')?.contentDocument?.body];
    roots.forEach(root => root?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach(heading => {
      const label = heading.textContent?.trim();
      if (!label || !label.toLowerCase().includes(query)) return;
      entries.push({
        label,
        description: 'Heading in this entry',
        icon: 'fa-heading',
        keywords: '',
        action: () => heading.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      });
    }));
    document.querySelectorAll<HTMLAnchorElement>('#foldersPanel a[href]').forEach(link => {
      const label = link.textContent?.trim();
      if (!label || !label.toLowerCase().includes(query)) return;
      entries.push({ label, description: 'Folder', icon: 'fa-folder', keywords: '', action: () => link.click() });
    });
    return entries.slice(0, 10);
  }

  private async remoteResults(query: string, sequence: number): Promise<PaletteEntry[]> {
    if (query.length < 2) return [];
    try {
      const encoded = encodeURIComponent(query);
      const [experiments, resources] = await Promise.all([
        ApiC.getJson(`experiments?limit=8&scope=3&fastq=${encoded}`),
        ApiC.getJson(`items?limit=8&scope=3&fastq=${encoded}`),
      ]) as [SearchEntity[], SearchEntity[]];
      if (sequence !== this.searchSequence) return [];
      return [...experiments, ...resources].map(result => ({
        label: result.title ?? `Entry ${result.id}`,
        description: `${result.type === 'items' ? 'Resource' : 'Experiment'}${result.category_title ? ` · ${result.category_title}` : ''}`,
        icon: result.type === 'items' ? 'fa-box' : 'fa-flask',
        keywords: '',
        action: () => { window.location.href = result.page ?? `${result.type === 'items' ? 'database' : 'experiments'}.php?mode=view&id=${result.id}`; },
      }));
    } catch {
      return [];
    }
  }

  private async render(): Promise<void> {
    const query = this.input.value.trim().toLowerCase();
    const sequence = ++this.searchSequence;
    const commandResults = this.entries.filter(entry => `${entry.label} ${entry.description} ${entry.keywords}`.toLowerCase().includes(query));
    const localResults = query ? this.localNavigationResults(query) : [];
    this.paint([...commandResults, ...localResults], query ? 'Searching experiments and resources…' : 'Commands');
    const remoteResults = await this.remoteResults(query, sequence);
    if (sequence !== this.searchSequence) return;
    this.paint([...commandResults, ...localResults, ...remoteResults], query ? 'Results' : 'Commands');
  }

  private paint(entries: PaletteEntry[], heading: string): void {
    this.results.replaceChildren();
    const title = document.createElement('div');
    title.className = 'command-palette-section-title';
    title.textContent = heading;
    this.results.append(title);
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'command-palette-empty';
      empty.textContent = 'No matching commands or entries.';
      this.results.append(empty);
      return;
    }
    this.activeIndex = Math.min(this.activeIndex, entries.length - 1);
    entries.slice(0, 24).forEach((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-palette-result';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === this.activeIndex));
      button.innerHTML = `<i class="fas ${entry.icon} fa-fw" aria-hidden="true"></i><span><strong></strong><small></small></span>`;
      button.querySelector('strong').textContent = entry.label;
      button.querySelector('small').textContent = entry.description;
      button.addEventListener('click', () => {
        this.close();
        window.setTimeout(entry.action, 0);
      });
      this.results.append(button);
    });
  }
}
