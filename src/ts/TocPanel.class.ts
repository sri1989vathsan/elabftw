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

interface TocEntry {
  level: number;
  text: string;
  id: string;
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
    let headings: NodeListOf<HTMLHeadingElement> | null = null;

    // View mode: headings live inside #body_view
    const bodyView = document.getElementById('body_view');
    if (bodyView) {
      headings = bodyView.querySelectorAll('h1, h2, h3, h4, h5, h6');
    }

    // Edit mode: headings are inside the TinyMCE iframe body
    if (!headings || headings.length === 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tinymce = (window as any).tinymce;
        if (tinymce && tinymce.activeEditor) {
          const editorBody = tinymce.activeEditor.getBody();
          if (editorBody) {
            headings = editorBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
          }
        }
      } catch {
        // TinyMCE not available — that's fine
      }
    }

    if (!headings) return entries;

    headings.forEach((heading, index) => {
      const level = parseInt(heading.tagName.charAt(1), 10);
      const text = heading.textContent?.trim() || '';
      if (text.length === 0) return;

      // Ensure the heading has an id so we can scroll to it
      if (!heading.id) {
        heading.id = `toc-heading-${index}`;
      }

      entries.push({ level, text, id: heading.id });
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
      return;
    }

    // Find the minimum heading level to normalize indentation
    const minLevel = Math.min(...entries.map(e => e.level));

    let html = '<ul class="toc-list list-unstyled mb-0">';
    for (const entry of entries) {
      const indent = (entry.level - minLevel) * 16;
      const fontClass = entry.level <= 2 ? 'font-weight-bold' : '';
      const fontSize = entry.level <= 2 ? '' : (entry.level === 3 ? 'style="font-size:0.95em"' : 'style="font-size:0.9em"');
      html += `<li class="toc-item" style="padding-left:${indent}px">`;
      html += `<a href="#${entry.id}" class="toc-link d-block py-1 px-2 rounded ${fontClass}" ${fontSize} data-toc-target="${entry.id}">${this.escapeHTML(entry.text)}</a>`;
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

    // Set up scroll-spy for highlighting active heading
    this.setupScrollSpy(entries);
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
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tinymce = (window as any).tinymce;
      if (tinymce && tinymce.activeEditor) {
        const editorEl = tinymce.activeEditor.getBody().querySelector(`#${CSS.escape(targetId)}`);
        if (editorEl) {
          editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    } catch {
      // ignore
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
          const activeLink = document.querySelector(`#tocItems .toc-link[data-toc-target="${id}"]`);
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
}
