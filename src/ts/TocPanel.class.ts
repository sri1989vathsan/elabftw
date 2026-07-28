/**
 * @author eLabFTW custom
 * @license AGPL-3.0
 * @package elabftw
 *
 * Table of Contents side panel — extracts headings from #body_view (view mode)
 * or from the active TinyMCE editor (edit mode) and renders a navigable list.
 */
import SidePanel from './SidePanel.class';

// We don't register this in the Model enum because TOC is purely client-side
// and doesn't correspond to any API endpoint.
const TOC_MODEL = 'toc';
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const FILTER_HIDDEN_CLASS = 'toc-section-filter-hidden';

interface TocEntry {
  level: number;
  text: string;
  id: string;
  path: string;
  parentId?: string;
  ancestorIds: string[];
}

interface TinyMceEditor {
  execCommand(command: string, ui: boolean, value: string | Record<string, string>): void;
  focus(): void;
  getBody(): HTMLElement;
  selection: {
    getRng(): Range;
  };
}

export default class TocPanel extends SidePanel {

  initialLoad = true;
  private entries: TocEntry[] = [];
  private searchFilters: string[] = [];
  private selectedSectionIds = new Set<string>();
  private collapsedSectionIds = new Set<string>();

  constructor() {
    super(TOC_MODEL);
    this.panelId = 'tocPanel';
  }

  /**
   * Extract headings from #body_view (view mode) or the active TinyMCE editor (edit mode).
   */
  private getHeadings(): TocEntry[] {
    const entries: TocEntry[] = [];
    const ancestors: TocEntry[] = [];
    const usedIds = new Set<string>();
    let headings: NodeListOf<HTMLHeadingElement> | null = null;

    // View mode: headings live inside #body_view
    const bodyView = document.getElementById('body_view');
    if (bodyView) {
      headings = bodyView.querySelectorAll(HEADING_SELECTOR);
    }

    // Edit mode: headings are inside the TinyMCE iframe body
    if (!headings || headings.length === 0) {
      const editor = this.getEditor();
      if (editor) {
        const editorBody = editor.getBody();
        if (editorBody) {
          headings = editorBody.querySelectorAll(HEADING_SELECTOR);
        }
      }
    }

    if (!headings) return entries;

    headings.forEach((heading, index) => {
      const level = parseInt(heading.tagName.charAt(1), 10);
      const text = heading.textContent?.trim() || '';
      if (text.length === 0) return;

      // Keep existing anchors and generate deterministic, human-readable IDs for
      // new headings. Duplicate IDs are replaced so every copied link is unique.
      let id = heading.id.trim();
      if (!id || usedIds.has(id)) {
        id = this.createHeadingId(text, index, usedIds);
        heading.id = id;
      }
      usedIds.add(id);

      while (ancestors.length > 0 && ancestors[ancestors.length - 1].level >= level) {
        ancestors.pop();
      }
      const entry: TocEntry = {
        level,
        text,
        id,
        path: [...ancestors.map(ancestor => ancestor.text), text].join(' › '),
        parentId: ancestors[ancestors.length - 1]?.id,
        ancestorIds: ancestors.map(ancestor => ancestor.id),
      };
      entries.push(entry);
      ancestors.push(entry);
    });

    return entries;
  }

  /**
   * Build the TOC HTML from extracted headings.
   */
  display(): void {
    const entries = this.getHeadings();
    this.entries = entries;
    const availableIds = new Set(entries.map(entry => entry.id));
    this.selectedSectionIds = new Set(
      [...this.selectedSectionIds].filter(id => availableIds.has(id)),
    );
    this.collapsedSectionIds = new Set(
      [...this.collapsedSectionIds].filter(id => availableIds.has(id)),
    );
    const container = document.getElementById('tocItems');
    if (!container) return;

    if (entries.length === 0) {
      container.innerHTML = '<p class="text-muted px-2">No headings found in the document.</p>';
      this.renderSectionFilterTree();
      this.renderSectionFilters();
      this.setupSearchControls();
      this.filterEntries();
      return;
    }

    // Find the minimum heading level to normalize indentation
    const minLevel = Math.min(...entries.map(e => e.level));

    let html = '<ul class="toc-list list-unstyled mb-0">';
    for (const entry of entries) {
      const indent = (entry.level - minLevel) * 16;
      const fontClass = entry.level <= 2 ? 'font-weight-bold' : '';
      const fontSize = entry.level <= 2 ? '' : (entry.level === 3 ? 'style="font-size:0.95em"' : 'style="font-size:0.9em"');
      const id = this.escapeAttribute(entry.id);
      const text = this.escapeHTML(entry.text);
      const label = this.escapeAttribute(entry.text);
      const searchText = this.escapeAttribute(entry.path.toLocaleLowerCase());
      html += `<li class="toc-item" style="padding-left:${indent}px" data-toc-search-text="${searchText}" data-toc-target="${id}">`;
      html += '<div class="toc-entry d-flex align-items-center">';
      html += `<a href="#${encodeURIComponent(entry.id)}" class="toc-link flex-grow-1 py-1 px-2 rounded ${fontClass}" ${fontSize} data-toc-target="${id}">${text}</a>`;
      html += `<button type="button" class="btn btn-sm toc-entry-action toc-copy-link" data-toc-target="${id}" title="Copy link to ${label}" aria-label="Copy link to ${label}"><i class="fas fa-link fa-fw" aria-hidden="true"></i></button>`;
      if (this.getEditor()) {
        html += `<button type="button" class="btn btn-sm toc-entry-action toc-insert-link" data-toc-target="${id}" data-toc-text="${label}" title="Insert link to ${label}" aria-label="Insert link to ${label}"><i class="fas fa-paste fa-fw" aria-hidden="true"></i></button>`;
      }
      html += '</div>';
      html += '</li>';
    }
    html += '</ul>';
    container.innerHTML = html;

    // Attach click handlers for smooth scrolling
    container.querySelectorAll('.toc-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = (link as HTMLElement).dataset.tocTarget;
        this.scrollToHeading(targetId);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.toc-copy-link').forEach(button => {
      button.addEventListener('click', () => {
        const targetId = button.dataset.tocTarget;
        if (targetId) {
          void this.copySectionLink(button, targetId);
        }
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.toc-insert-link').forEach(button => {
      button.addEventListener('click', () => {
        const targetId = button.dataset.tocTarget;
        const text = button.dataset.tocText;
        if (targetId && text) {
          this.insertSectionLink(targetId, text);
        }
      });
    });

    this.renderSectionFilterTree();
    this.renderSectionFilters();
    this.setupSearchControls();
    this.filterEntries();

    // Set up scroll-spy for highlighting active heading
    this.setupScrollSpy(entries);
  }

  /**
   * Add search and clear behavior once, then retain the query across refreshes.
   */
  private setupSearchControls(): void {
    const input = document.getElementById('tocSearchInput') as HTMLInputElement | null;
    const add = document.getElementById('tocSearchAdd') as HTMLButtonElement | null;
    const clear = document.getElementById('tocSearchClear') as HTMLButtonElement | null;
    const mode = document.getElementById('tocSearchMode') as HTMLSelectElement | null;
    if (!input || !add || !clear || !mode || input.dataset.tocSearchReady) return;

    input.addEventListener('input', () => this.filterEntries());
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.addSearchFilter(input);
    });
    add.addEventListener('click', () => this.addSearchFilter(input));
    mode.addEventListener('change', () => this.filterEntries());
    clear.addEventListener('click', () => {
      input.value = '';
      this.searchFilters = [];
      this.selectedSectionIds.clear();
      this.renderSearchFilters();
      this.renderSectionFilters();
      this.updateSectionFilterTree();
      input.focus();
      this.filterEntries();
    });
    input.dataset.tocSearchReady = 'true';
    this.renderSearchFilters();
  }

  private addSearchFilter(input: HTMLInputElement): void {
    const filter = input.value.trim();
    if (!filter) return;
    if (!this.searchFilters.some(value => value.toLocaleLowerCase() === filter.toLocaleLowerCase())) {
      this.searchFilters.push(filter);
    }
    input.value = '';
    this.renderSearchFilters();
    this.filterEntries();
    input.focus();
  }

  private renderSearchFilters(): void {
    const container = document.getElementById('tocSearchFilters');
    if (!container) return;

    container.replaceChildren();
    this.searchFilters.forEach((filter, index) => {
      const chip = document.createElement('span');
      chip.className = 'toc-search-filter badge badge-secondary';
      const label = document.createElement('span');
      label.textContent = filter;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'toc-search-filter-remove';
      remove.title = `Remove filter ${filter}`;
      remove.setAttribute('aria-label', `Remove filter ${filter}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        this.searchFilters.splice(index, 1);
        this.renderSearchFilters();
        this.filterEntries();
      });
      chip.append(label, remove);
      container.appendChild(chip);
    });
  }

  private renderSectionFilterTree(): void {
    const container = document.getElementById('tocSectionFilterTree');
    const empty = document.getElementById('tocSectionFilterEmpty');
    if (!container || !empty) return;

    container.replaceChildren();
    empty.hidden = this.entries.length > 0;
    this.entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'toc-section-filter-option';
      row.dataset.tocSectionId = entry.id;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(entry.ancestorIds.length + 1));
      row.style.setProperty('--toc-section-indent', `${entry.ancestorIds.length * 0.8}rem`);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'toc-section-filter-toggle';
      toggle.dataset.tocSectionToggle = entry.id;
      if (this.hasSectionChildren(entry.id)) {
        toggle.setAttribute('aria-expanded', 'true');
        const icon = document.createElement('i');
        icon.className = 'fas fa-caret-down fa-fw';
        icon.setAttribute('aria-hidden', 'true');
        toggle.appendChild(icon);
        toggle.addEventListener('click', () => {
          if (this.collapsedSectionIds.has(entry.id)) {
            this.collapsedSectionIds.delete(entry.id);
          } else {
            this.collapsedSectionIds.add(entry.id);
          }
          this.updateSectionFilterTree();
        });
      } else {
        toggle.disabled = true;
        toggle.setAttribute('aria-hidden', 'true');
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `tocSectionFilter-${index}`;
      checkbox.dataset.tocSectionCheckbox = entry.id;
      checkbox.setAttribute('aria-label', `Filter by ${entry.path}`);
      checkbox.addEventListener('change', () => {
        this.toggleSectionSelection(entry.id, checkbox.checked);
      });

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.className = 'toc-section-filter-label';
      label.textContent = entry.path;
      label.title = entry.path;

      row.append(toggle, checkbox, label);
      container.appendChild(row);
    });
    this.updateSectionFilterTree();
  }

  private toggleSectionSelection(entryId: string, selected: boolean): void {
    this.getSectionIds(entryId).forEach(id => {
      if (selected) {
        this.selectedSectionIds.add(id);
      } else {
        this.selectedSectionIds.delete(id);
      }
    });
    this.renderSectionFilters();
    this.updateSectionFilterTree();
    this.filterEntries();
  }

  private renderSectionFilters(): void {
    const container = document.getElementById('tocSectionFilters');
    const count = document.getElementById('tocSectionFilterCount');
    if (!container || !count) return;

    container.replaceChildren();
    this.getSectionSelectionGroups().forEach(group => {
      const chip = document.createElement('span');
      chip.className = 'toc-search-filter toc-section-filter-chip badge badge-primary';
      chip.title = group.entry.path;
      const label = document.createElement('span');
      label.textContent = group.directOnly && this.hasSectionChildren(group.entry.id)
        ? `${group.entry.path} (section only)`
        : group.entry.path;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'toc-search-filter-remove';
      remove.title = `Remove section filter ${group.entry.path}`;
      remove.setAttribute('aria-label', `Remove section filter ${group.entry.path}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        const ids = group.directOnly ? [group.entry.id] : this.getSectionIds(group.entry.id);
        ids.forEach(id => this.selectedSectionIds.delete(id));
        this.renderSectionFilters();
        this.updateSectionFilterTree();
        this.filterEntries();
      });
      chip.append(label, remove);
      container.appendChild(chip);
    });

    const selectedCount = this.selectedSectionIds.size;
    count.textContent = selectedCount.toString();
    count.toggleAttribute('hidden', selectedCount === 0);
  }

  private getSectionSelectionGroups(): Array<{
    entry: TocEntry;
    directOnly: boolean;
  }> {
    const fullBranchIds = new Set(
      this.entries
        .filter(entry => (
          this.getSectionIds(entry.id)
            .every(id => this.selectedSectionIds.has(id))
        ))
        .map(entry => entry.id),
    );
    const groups: Array<{ entry: TocEntry; directOnly: boolean }> = [];
    this.entries.forEach(entry => {
      if (!this.selectedSectionIds.has(entry.id)) return;
      if (fullBranchIds.has(entry.id)) {
        if (!entry.parentId || !fullBranchIds.has(entry.parentId)) {
          groups.push({ entry, directOnly: false });
        }
        return;
      }
      groups.push({ entry, directOnly: true });
    });
    return groups;
  }

  private updateSectionFilterTree(): void {
    const input = document.getElementById('tocSearchInput') as HTMLInputElement | null;
    const mode = document.getElementById('tocSearchMode') as HTMLSelectElement | null;
    const filters = [
      ...this.searchFilters,
      ...(input?.value.trim() ? [input.value.trim()] : []),
    ].map(filter => filter.toLocaleLowerCase());
    const matchAll = mode?.value !== 'any';
    const matchingIds = new Set<string>();

    this.entries.forEach(entry => {
      const matches = filters.length === 0
        || (matchAll
          ? filters.every(filter => entry.path.toLocaleLowerCase().includes(filter))
          : filters.some(filter => entry.path.toLocaleLowerCase().includes(filter)));
      if (matches || this.selectedSectionIds.has(entry.id)) {
        matchingIds.add(entry.id);
        entry.ancestorIds.forEach(id => matchingIds.add(id));
      }
    });

    let visibleOptions = 0;
    document.querySelectorAll<HTMLElement>('[data-toc-section-id]').forEach(row => {
      const entryId = row.dataset.tocSectionId;
      const entry = this.entries.find(candidate => candidate.id === entryId);
      if (!entry) return;
      const hiddenByCollapsedParent = filters.length === 0
        && entry.ancestorIds.some(id => this.collapsedSectionIds.has(id));
      const visible = matchingIds.has(entry.id) && !hiddenByCollapsedParent;
      row.hidden = !visible;
      if (visible) visibleOptions++;

      const branchIds = this.getSectionIds(entry.id);
      const selectedCount = branchIds.filter(id => this.selectedSectionIds.has(id)).length;
      const checkbox = row.querySelector<HTMLInputElement>('[data-toc-section-checkbox]');
      if (checkbox) {
        checkbox.checked = selectedCount === branchIds.length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < branchIds.length;
      }
      row.classList.toggle('selected', selectedCount > 0);

      const toggle = row.querySelector<HTMLButtonElement>('[data-toc-section-toggle]');
      if (toggle && !toggle.disabled) {
        const collapsed = this.collapsedSectionIds.has(entry.id);
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute(
          'aria-label',
          `${collapsed ? 'Expand' : 'Collapse'} ${entry.path}`,
        );
        const icon = toggle.querySelector('i');
        icon?.classList.toggle('fa-caret-right', collapsed);
        icon?.classList.toggle('fa-caret-down', !collapsed);
      }
    });

    const empty = document.getElementById('tocSectionFilterEmpty');
    if (empty) empty.hidden = visibleOptions > 0;
  }

  private getSectionIds(entryId: string): string[] {
    return this.entries
      .filter(entry => entry.id === entryId || entry.ancestorIds.includes(entryId))
      .map(entry => entry.id);
  }

  private hasSectionChildren(entryId: string): boolean {
    return this.entries.some(entry => entry.parentId === entryId);
  }

  private filterEntries(): void {
    const input = document.getElementById('tocSearchInput') as HTMLInputElement | null;
    const mode = document.getElementById('tocSearchMode') as HTMLSelectElement | null;
    const noResults = document.getElementById('tocNoResults');
    const items = Array.from(document.querySelectorAll<HTMLElement>('#tocItems .toc-item'));
    const pendingFilter = input?.value.trim() ?? '';
    const filters = [
      ...this.searchFilters,
      ...(pendingFilter ? [pendingFilter] : []),
    ].map(filter => filter.toLocaleLowerCase());
    const matchAll = mode?.value !== 'any';
    const hasSectionSelection = this.selectedSectionIds.size > 0;
    const matchingRoots = this.entries.filter(entry => {
      if (hasSectionSelection && !this.selectedSectionIds.has(entry.id)) return false;
      if (filters.length === 0) return hasSectionSelection;
      const path = entry.path.toLocaleLowerCase();
      return matchAll
        ? filters.every(filter => path.includes(filter))
        : filters.some(filter => path.includes(filter));
    });
    const sectionIds = new Set<string>();
    matchingRoots.forEach(entry => {
      this.getSectionIds(entry.id).forEach(id => {
        if (!hasSectionSelection || this.selectedSectionIds.has(id)) {
          sectionIds.add(id);
        }
      });
    });
    const filterActive = filters.length > 0 || hasSectionSelection;
    const visibleTocIds = new Set(sectionIds);
    this.entries.forEach(entry => {
      if (sectionIds.has(entry.id)) {
        entry.ancestorIds.forEach(id => visibleTocIds.add(id));
      }
    });
    let matches = 0;

    for (const item of items) {
      const targetId = item.dataset.tocTarget ?? '';
      const visible = !filterActive || visibleTocIds.has(targetId);
      item.hidden = !visible;
      if (sectionIds.has(targetId)) matches++;
    }

    if (noResults) {
      noResults.hidden = items.length === 0 || matches > 0;
    }

    this.updateSectionFilterTree();
    this.filterMainText(filterActive, sectionIds);
  }

  /**
   * In view mode, show only sections selected by the TOC heading search.
   * The filter only adds transient CSS classes and never changes saved body HTML.
   */
  private filterMainText(filterActive: boolean, sectionIds: Set<string>): void {
    const bodyView = document.getElementById('body_view');
    if (!bodyView) return;

    this.clearMainTextFilter();
    if (!filterActive) return;

    const headings = Array.from(bodyView.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR));
    if (headings.length === 0) return;

    const visibleHeadingIds = new Set(sectionIds);
    this.entries.forEach(entry => {
      if (sectionIds.has(entry.id)) {
        entry.ancestorIds.forEach(id => visibleHeadingIds.add(id));
      }
    });

    // Walk in document order so ordinary content inherits the visibility of
    // its nearest preceding heading. Containers holding headings remain in the
    // layout, while their individual sections are filtered recursively.
    let showSectionContent = false;
    const filterChildren = (parent: Element): void => {
      Array.from(parent.children).forEach((element: HTMLElement) => {
        if (element.matches(HEADING_SELECTOR)) {
          element.classList.toggle(FILTER_HIDDEN_CLASS, !visibleHeadingIds.has(element.id));
          showSectionContent = sectionIds.has(element.id);
          return;
        }

        if (element.querySelector(HEADING_SELECTOR)) {
          filterChildren(element);
          return;
        }
        element.classList.toggle(FILTER_HIDDEN_CLASS, !showSectionContent);
      });
    };

    filterChildren(bodyView);
    bodyView.classList.add('toc-main-text-filtered');
  }

  private clearMainTextFilter(): void {
    const bodyView = document.getElementById('body_view');
    if (!bodyView) return;

    bodyView.classList.remove('toc-main-text-filtered');
    bodyView.querySelectorAll(`.${FILTER_HIDDEN_CLASS}`).forEach(element => {
      element.classList.remove(FILTER_HIDDEN_CLASS);
    });
  }

  private async copySectionLink(button: HTMLButtonElement, targetId: string): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'view');
    url.hash = targetId;

    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url.toString();
      textarea.style.left = '-9999px';
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }

    const icon = button.querySelector('i');
    if (!icon) return;
    const originalClass = icon.className;
    icon.className = 'fas fa-check fa-fw';
    button.classList.add('text-success');
    button.title = 'Link copied';
    setTimeout(() => {
      icon.className = originalClass;
      button.classList.remove('text-success');
      button.title = 'Copy section link';
    }, 1500);
  }

  private insertSectionLink(targetId: string, text: string): void {
    const editor = this.getEditor();
    if (!editor) return;

    const hasSelection = !editor.selection.getRng().collapsed;
    editor.focus();
    if (hasSelection) {
      // Preserve the selected label and inline formatting; only add the link.
      editor.execCommand('mceInsertLink', false, {
        href: `#${encodeURIComponent(targetId)}`,
      });
      return;
    }

    editor.execCommand(
      'mceInsertContent',
      false,
      `<a href="#${encodeURIComponent(targetId)}">${this.escapeHTML(text)}</a>`,
    );
  }

  private createHeadingId(text: string, index: number, usedIds: Set<string>): string {
    const slug = text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const base = `section-${slug || index + 1}`;
    let candidate = base;
    let suffix = 2;

    while (usedIds.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix++;
    }
    return candidate;
  }

  private getEditor(): TinyMceEditor | null {
    try {
      const tinymce = (window as typeof window & { tinymce?: { activeEditor?: TinyMceEditor } }).tinymce;
      return tinymce?.activeEditor ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Scroll to a heading, handling both view-mode (#body_view) and edit-mode (TinyMCE iframe).
   */
  private scrollToHeading(targetId: string): void {
    // View mode: heading is in the main document
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief highlight
      el.classList.add('toc-highlight');
      setTimeout(() => el.classList.remove('toc-highlight'), 1500);
      return;
    }

    // Edit mode: heading is inside TinyMCE iframe
    const editor = this.getEditor();
    if (editor) {
      const editorEl = editor.getBody().querySelector(`#${CSS.escape(targetId)}`);
      if (editorEl) {
        editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  /**
   * Highlight the active TOC entry as the user scrolls through the document.
   */
  private setupScrollSpy(entries: TocEntry[]): void {
    const bodyView = document.getElementById('body_view');
    if (!bodyView) return;

    const observer = new IntersectionObserver((observerEntries) => {
      for (const obsEntry of observerEntries) {
        if (obsEntry.isIntersecting) {
          const id = obsEntry.target.id;
          // Remove active from all
          document.querySelectorAll('#tocItems .toc-link').forEach(l => l.classList.remove('active'));
          // Add active to matching
          const activeLink = Array.from(document.querySelectorAll<HTMLElement>('#tocItems .toc-link'))
            .find(link => link.dataset.tocTarget === id);
          if (activeLink) {
            activeLink.classList.add('active');
          }
        }
      }
    }, {
      rootMargin: '-80px 0px -70% 0px',
      threshold: 0,
    });

    for (const entry of entries) {
      const heading = document.getElementById(entry.id);
      if (heading) {
        observer.observe(heading);
      }
    }
  }

  /**
   * Refresh the TOC — useful after content changes in the editor.
   */
  refresh(): void {
    if (!document.getElementById(this.panelId).hasAttribute('hidden')) {
      this.display();
    }
  }

  // TOGGLE TOC PANEL VISIBILITY
  toggle(): void {
    super.toggle();
    // Lazy load content only once, then allow manual refresh
    if (!document.getElementById(this.panelId).hasAttribute('hidden')) {
      this.display();
      this.initialLoad = false;
    }
  }

  private escapeHTML(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  private escapeAttribute(str: string): string {
    return this.escapeHTML(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}
