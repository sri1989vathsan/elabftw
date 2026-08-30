/**
 * One search field across experiments, resources, tags, tasks, folders, and
 * headings in the current entry, grouped by type -- instead of each of
 * those living behind its own separate panel/search box with no shared
 * entry point. Reuses the same per-entity fastq search already used
 * elsewhere (see CommandPalette.class.ts) rather than a new backend
 * union query.
 */
import { ApiC } from './api';
import { EntityType } from './interfaces';
import SidePanel from './SidePanel.class';

interface SearchEntity {
  id: number;
  title?: string;
  category_title?: string;
}

interface TeamTag {
  id: number;
  tag: string;
  item_count?: number;
}

interface TodoTask {
  id: number;
  body: string;
}

interface ResultGroup {
  heading: string;
  items: { label: string; description: string; href?: string; onSelect?: () => void }[];
}

const MIN_QUERY_LENGTH = 2;
const PER_GROUP_LIMIT = 8;

export default class UnifiedSearchPanel extends SidePanel {
  private input: HTMLInputElement | null = null;
  private results: HTMLElement | null = null;
  private searchSequence = 0;
  private searchTimer: number | null = null;

  constructor() {
    super('unified-search');
    this.panelId = 'unifiedSearchPanel';
    this.input = document.getElementById('unifiedSearchInput') as HTMLInputElement | null;
    this.results = document.getElementById('unifiedSearchResults');
    this.input?.addEventListener('input', () => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => void this.runSearch(), 250);
    });
  }

  show(): void {
    super.show();
    window.requestAnimationFrame(() => this.input?.focus());
  }

  private headingResults(query: string): ResultGroup {
    const items: ResultGroup['items'] = [];
    const roots = [
      document.getElementById('body_view'),
      document.querySelector<HTMLIFrameElement>('.tox-edit-area iframe')?.contentDocument?.body,
    ];
    roots.forEach(root => root?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach(heading => {
      const label = heading.textContent?.trim();
      if (!label || !label.toLowerCase().includes(query)) return;
      items.push({
        label,
        description: 'Heading in this entry',
        onSelect: () => heading.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      });
    }));
    return { heading: 'Headings in this entry', items: items.slice(0, PER_GROUP_LIMIT) };
  }

  private folderResults(query: string): ResultGroup {
    const items: ResultGroup['items'] = [];
    document.querySelectorAll<HTMLAnchorElement>('#foldersPanel a[href]').forEach(link => {
      const label = link.textContent?.trim();
      if (!label || !label.toLowerCase().includes(query) || items.length >= PER_GROUP_LIMIT) return;
      items.push({ label, description: 'Folder', onSelect: () => link.click() });
    });
    return { heading: 'Folders', items };
  }

  private async entityResults(
    entityType: EntityType.Experiment | EntityType.Item | EntityType.Template | EntityType.ItemType,
    query: string,
  ): Promise<ResultGroup> {
    const info: Record<string, { heading: string; page: string }> = {
      [EntityType.Experiment]: { heading: 'Experiments', page: 'experiments' },
      [EntityType.Item]: { heading: 'Resources', page: 'database' },
      [EntityType.Template]: { heading: 'Experiment templates', page: 'templates' },
      [EntityType.ItemType]: { heading: 'Resource templates', page: 'resources-templates' },
    };
    const { heading, page } = info[entityType];
    try {
      const results = await ApiC.getJson(
        `${entityType}?limit=${PER_GROUP_LIMIT}&scope=3&fastq=${encodeURIComponent(query)}`,
      ) as SearchEntity[];
      return {
        heading,
        items: results.map(result => ({
          label: result.title ?? `#${result.id}`,
          description: result.category_title ?? '',
          href: `${page}.php?mode=view&id=${result.id}`,
        })),
      };
    } catch {
      return { heading, items: [] };
    }
  }

  private async tagResults(query: string): Promise<ResultGroup> {
    try {
      const tags = await ApiC.getJson(`teams/current/tags?q=${encodeURIComponent(query)}`) as TeamTag[];
      const items = tags
        .slice(0, PER_GROUP_LIMIT)
        .map(tag => ({
          label: tag.tag,
          description: typeof tag.item_count === 'number' ? `${tag.item_count} entries` : 'Tag',
        }));
      return { heading: 'Tags', items };
    } catch {
      return { heading: 'Tags', items: [] };
    }
  }

  private async taskResults(query: string): Promise<ResultGroup> {
    try {
      const tasks = await ApiC.getJson('todolist') as TodoTask[];
      const items = tasks
        .filter(task => task.body?.toLowerCase().includes(query))
        .slice(0, PER_GROUP_LIMIT)
        .map(task => ({
          label: task.body,
          description: 'Task',
          onSelect: () => document.getElementById('todolistPanelOpener')?.click(),
        }));
      return { heading: 'Tasks', items };
    } catch {
      return { heading: 'Tasks', items: [] };
    }
  }

  private render(groups: ResultGroup[], message?: string): void {
    if (!this.results) return;
    this.results.replaceChildren();
    if (message) {
      const info = document.createElement('p');
      info.className = 'text-muted px-2';
      info.textContent = message;
      this.results.append(info);
      return;
    }
    const nonEmpty = groups.filter(group => group.items.length > 0);
    if (nonEmpty.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-muted px-2';
      empty.textContent = 'No matches.';
      this.results.append(empty);
      return;
    }
    nonEmpty.forEach(group => {
      const title = document.createElement('div');
      title.className = 'unified-search-group-title';
      title.textContent = group.heading;
      this.results?.append(title);
      const list = document.createElement('ul');
      list.className = 'list-group mb-2';
      group.items.forEach(item => {
        const entry = document.createElement('li');
        entry.className = 'list-group-item unified-search-result';
        entry.innerHTML = `<strong></strong>${item.description ? '<small></small>' : ''}`;
        entry.querySelector('strong').textContent = item.label;
        const small = entry.querySelector('small');
        if (small) small.textContent = item.description;
        if (item.href) {
          const link = document.createElement('a');
          link.href = item.href;
          link.append(...Array.from(entry.childNodes));
          entry.replaceChildren(link);
        } else if (item.onSelect) {
          entry.style.cursor = 'pointer';
          entry.addEventListener('click', item.onSelect);
        }
        list.append(entry);
      });
      this.results?.append(list);
    });
  }

  private async runSearch(): Promise<void> {
    const query = this.input?.value.trim().toLowerCase() ?? '';
    const sequence = ++this.searchSequence;
    if (query.length < MIN_QUERY_LENGTH) {
      this.render([], 'Type at least 2 characters to search.');
      return;
    }
    this.render([], 'Searching…');
    const groups = await Promise.all([
      this.entityResults(EntityType.Experiment, query),
      this.entityResults(EntityType.Item, query),
      this.entityResults(EntityType.Template, query),
      this.entityResults(EntityType.ItemType, query),
      this.tagResults(query),
      this.taskResults(query),
      Promise.resolve(this.folderResults(query)),
      Promise.resolve(this.headingResults(query)),
    ]);
    if (sequence !== this.searchSequence) return;
    this.render(groups);
  }
}
