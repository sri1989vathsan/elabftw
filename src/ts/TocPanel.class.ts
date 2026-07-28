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
}

interface TinyMceEditor {
  execCommand(command: string, ui: boolean, value: string): void;
  focus(): void;
  getBody(): HTMLElement;
}

export default class TocPanel extends SidePanel {

  initialLoad = true;

  constructor() {
    super(TOC_MODEL);
    this.panelId = 'tocPanel';
  }

  /**
   * Extract headings from #body_view (view mode) or the active TinyMCE editor (edit mode).
   */
  private getHeadings(): TocEntry[] {
    const entries: TocEntry[] = [];
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

      entries.push({ level, text, id });
    });

    return entries;
  }

  /**
   * Build the TOC HTML from extracted headings.
   */
  display(): void {
    const entries = this.getHeadings();
    const container = document.getElementById('tocItems');
    if (!container) return;

    if (entries.length === 0) {
      container.innerHTML = '<p class="text-muted px-2">No headings found in the document.</p>';
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
      html += `<li class="toc-item" style="padding-left:${indent}px" data-toc-search-text="${label.toLocaleLowerCase()}" data-toc-target="${id}">`;
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
    const clear = document.getElementById('tocSearchClear') as HTMLButtonElement | null;
    if (!input || !clear || input.dataset.tocSearchReady) return;

    input.addEventListener('input', () => this.filterEntries());
    clear.addEventListener('click', () => {
      input.value = '';
      input.focus();
      this.filterEntries();
    });
    input.dataset.tocSearchReady = 'true';
  }

  private filterEntries(): void {
    const input = document.getElementById('tocSearchInput') as HTMLInputElement | null;
    const noResults = document.getElementById('tocNoResults');
    const items = Array.from(document.querySelectorAll<HTMLElement>('#tocItems .toc-item'));
    const query = input?.value.trim().toLocaleLowerCase() ?? '';
    const matchingHeadingIds = new Set<string>();
    let matches = 0;

    for (const item of items) {
      const visible = !query || (item.dataset.tocSearchText ?? '').includes(query);
      item.hidden = !visible;
      if (visible) {
        matches++;
        if (item.dataset.tocTarget) {
          matchingHeadingIds.add(item.dataset.tocTarget);
        }
      }
    }

    if (noResults) {
      noResults.hidden = items.length === 0 || matches > 0;
    }

    this.filterMainText(query, matchingHeadingIds);
  }

  /**
   * In view mode, show only sections selected by the TOC heading search.
   * The filter only adds transient CSS classes and never changes saved body HTML.
   */
  private filterMainText(query: string, matchingHeadingIds: Set<string>): void {
    const bodyView = document.getElementById('body_view');
    if (!bodyView) return;

    this.clearMainTextFilter();
    if (!query) return;

    const headings = Array.from(bodyView.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR));
    if (headings.length === 0) return;

    // A matching heading includes its content and all nested subsections up to
    // the next heading at the same or a higher level.
    const sectionHeadingIds = new Set<string>();
    const visibleHeadingIds = new Set<string>();
    const activeMatchLevels: number[] = [];
    const ancestorHeadings: HTMLHeadingElement[] = [];

    for (const heading of headings) {
      const level = parseInt(heading.tagName.charAt(1), 10);

      while (activeMatchLevels.length > 0 && activeMatchLevels.at(-1) >= level) {
        activeMatchLevels.pop();
      }
      while (ancestorHeadings.length > 0
        && parseInt(ancestorHeadings.at(-1).tagName.charAt(1), 10) >= level) {
        ancestorHeadings.pop();
      }

      if (matchingHeadingIds.has(heading.id)) {
        activeMatchLevels.push(level);
        ancestorHeadings.forEach(ancestor => visibleHeadingIds.add(ancestor.id));
      }

      if (activeMatchLevels.length > 0) {
        sectionHeadingIds.add(heading.id);
        visibleHeadingIds.add(heading.id);
      }
      ancestorHeadings.push(heading);
    }

    // Walk in document order so ordinary content inherits the visibility of
    // its nearest preceding heading. Containers holding headings remain in the
    // layout, while their individual sections are filtered recursively.
    let showSectionContent = false;
    const filterChildren = (parent: Element): void => {
      Array.from(parent.children).forEach((element: HTMLElement) => {
        if (element.matches(HEADING_SELECTOR)) {
          element.classList.toggle(FILTER_HIDDEN_CLASS, !visibleHeadingIds.has(element.id));
          showSectionContent = sectionHeadingIds.has(element.id);
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

    editor.focus();
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
