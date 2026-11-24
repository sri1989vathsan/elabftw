/**
 * Printing from the editor's File menu.
 *
 * Print main text prints only the main text, the same way the table of contents prints it when nothing is filtered:
 * an isolated copy under the entry's title, so the sidebars, metadata and toolbars never end up on the paper, and
 * spreadsheets and well plates are printed in full.
 * Print everything prints the whole entry in the same way: title and details, the main text, then steps, data,
 * links, custom fields, files, storage and comments.
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { restoreStaticSpreadsheetsForPrint } from './spreadsheet-print-hook';
import { printWithSheetsChoice } from './sheets-mode';

// sections of the page that belong on paper (the others are editing tools, permissions or drawing areas)
const PRINTED_SECTIONS = /^(steps|data|links|custom fields|local files|storage|comments)/i;
const REMOVED_FROM_SECTIONS = 'script, style, form, input, select, textarea, button, .modal, [hidden], .d-none, .hidden, '
  + '.guide-info-btn, .dropzone, .btn';

function mainTextClone(source: HTMLElement): HTMLElement {
  const content = source.cloneNode(true) as HTMLElement;
  content.id = 'tocPrintSelectionBody';
  // A mounted grid only holds what is scrolled into view; this copies every row and column.
  restoreStaticSpreadsheetsForPrint(source, content);
  // In the editor the source is the live TinyMCE body; the theme's note styling is scoped to its class.
  content.classList.remove('mce-content-body');
  content.removeAttribute('contenteditable');
  content.querySelectorAll('script, style').forEach(element => element.remove());
  return content;
}

function printDocument(printContainer: HTMLElement): void {
  document.body.appendChild(printContainer);
  document.body.classList.add('toc-print-selection-active');
  window.requestAnimationFrame(() => {
    try {
      window.print();
    } finally {
      document.body.classList.remove('toc-print-selection-active');
      printContainer.remove();
    }
  });
}

function printHeader(label: string, ariaLabel: string): { container: HTMLElement; title: HTMLElement; context: HTMLElement } {
  const container = document.createElement('main');
  container.id = 'tocPrintSelectionDocument';
  container.setAttribute('aria-label', ariaLabel);
  const title = document.createElement('h1');
  title.className = 'toc-print-title';
  title.textContent = document.getElementById('documentTitle')?.textContent?.trim() || document.title;
  const context = document.createElement('p');
  context.className = 'toc-print-context';
  context.textContent = label;
  return { container, title, context };
}

/** Print main text: when a table is wider than the page the user is asked first how to print it (sheets-mode.ts). */
export function printMainText(editorBody?: HTMLElement | null): void {
  printWithSheetsChoice(() => printMainTextNow(editorBody));
}

function printMainTextNow(editorBody?: HTMLElement | null): void {
  const source = document.getElementById('body_view') ?? editorBody;
  if (!source) return;
  const { container, title, context } = printHeader('Notebook main text', 'Main text');
  container.append(title, context, mainTextClone(source));
  printDocument(container);
}

/** The details line under the title: date, category and tags, as far as the page shows them. */
function detailsLine(): string {
  const parts: string[] = [];
  const date = (document.getElementById('date_input') as HTMLInputElement | null)?.value?.trim();
  if (date) parts.push(date);
  const category = document.getElementById('categoryBtn')?.textContent?.trim();
  if (category && !/^add category$/i.test(category)) parts.push(category);
  const status = document.querySelector('.catstat-btn[data-target="status"]')?.textContent?.trim();
  if (status && !/^add status$/i.test(status)) parts.push(status);
  // owner and team: one hidden element in the view page and in the edit page (the edit page has no meta grid)
  const meta = document.getElementById('printEntryMeta');
  if (meta?.dataset.owner) parts.push(`Owner: ${meta.dataset.owner}`);
  if (meta?.dataset.team) parts.push(`Team: ${meta.dataset.team}`);
  const tags = document.querySelector('[id^="tags_div_currenttags_"]')?.textContent?.replace(/\s+/g, ' ').trim();
  if (tags) parts.push(`Tags: ${tags}`);
  return parts.join('  |  ');
}

/** The printable sections under the main text: a heading and what follows it, until the next rule or heading. */
function pageSections(): HTMLElement[] {
  const container = document.getElementById('realContainer');
  if (!container) return [];
  const sections: HTMLElement[] = [];
  const add = (rawHeading: string, nodes: Element[]): void => {
    const count = /\((\d+)\)/.exec(rawHeading);
    // a section that says it has nothing in it is not printed
    if (count && Number.parseInt(count[1], 10) === 0 && !/^links/i.test(rawHeading)) return;
    const section = document.createElement('section');
    section.className = 'print-everything-section';
    const h2 = document.createElement('h2');
    h2.textContent = rawHeading.replace(/\s*\(\d+\).*$/, '').trim();
    section.appendChild(h2);
    const body = document.createElement('div');
    nodes.forEach(node => {
      const copy = node.cloneNode(true) as HTMLElement;
      // a section folded away on the page is still printed
      copy.removeAttribute('hidden');
      body.appendChild(copy);
    });
    body.querySelectorAll(REMOVED_FROM_SECTIONS).forEach(element => element.remove());
    // steps and comments keep their text in click-to-edit elements: the text stays, the editing goes
    body.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
    // empty subsections ("Resource links (0)") and the instructions meant for editing are left out
    body.querySelectorAll('h3, h4, h5, h6').forEach(heading => {
      if (/\(0\)\s*$/.test(heading.textContent?.trim() ?? '')) heading.remove();
    });
    if (nodes.length === 1 && nodes[0].id === 'filesDiv') body.querySelector('h3')?.remove();
    body.querySelectorAll('p, div, span').forEach(element => {
      if (element.children.length === 0 && /^(drop files above|no containers stored|click to add)/i.test(element.textContent?.trim() ?? '')) element.remove();
    });
    if ((body.textContent ?? '').replace(/\s+/g, '') === '' && body.querySelector('img, table') === null) return;
    section.appendChild(body);
    sections.push(section);
  };
  Array.from(container.children).forEach(child => {
    if (child.matches('h3.togglable-section-title')) {
      const heading = child.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (!PRINTED_SECTIONS.test(heading)) return;
      const content: Element[] = [];
      for (let next = child.nextElementSibling; next && !next.matches('hr, h3'); next = next.nextElementSibling) {
        if (next.matches('div:not(.modal), section') && !next.classList.contains('modal')) content.push(next);
      }
      add(heading, content);
    } else if (child.id === 'filesDiv') {
      // the files section carries its own heading
      const own = child.querySelector('h3');
      add(own?.textContent?.replace(/\s+/g, ' ').trim() ?? 'Files', [child]);
    }
  });
  return sections;
}

export function printEverything(editorBody?: HTMLElement | null): void {
  printWithSheetsChoice(() => printEverythingNow(editorBody));
}

/** The whole entry as the isolated print copy (title, details, main text, sections); null when the page has no entry text. */
function buildEverything(editorBody?: HTMLElement | null): HTMLElement | null {
  const source = document.getElementById('body_view') ?? editorBody;
  if (!source) return null;
  const { container, title, context } = printHeader('Complete entry', 'Complete entry');
  container.append(title, context);
  const details = detailsLine();
  if (details) {
    const line = document.createElement('p');
    line.className = 'toc-print-context';
    line.textContent = details;
    container.appendChild(line);
  }
  const mainHeading = document.createElement('h2');
  mainHeading.textContent = 'Main text';
  const mainSection = document.createElement('section');
  mainSection.className = 'print-everything-section';
  mainSection.append(mainHeading, mainTextClone(source));
  container.appendChild(mainSection);
  pageSections().forEach(section => container.appendChild(section));
  return container;
}

function printEverythingNow(editorBody?: HTMLElement | null): void {
  const container = buildEverything(editorBody);
  if (container) printDocument(container);
}

/**
 * Printing never prints the screen. Every Print button builds the print copy itself (above); this covers the other ways in
 * (Ctrl+P, the browser's File > Print, Print from the editor's own menu bar in edit mode): when the browser is about to print and no copy
 * exists yet, the whole-entry copy is built from the page (the edit view included: the editor's text, not its toolbars) and everything else is
 * hidden by the same rule as for the buttons; afterprint puts the page back. Pages without an entry text print as they are.
 */
let implicitCopy: HTMLElement | null = null;

function onBeforePrint(): void {
  if (document.getElementById('tocPrintSelectionDocument')) return;
  const editorBody = (window as unknown as { tinymce?: { activeEditor?: { getBody(): HTMLElement } } }).tinymce?.activeEditor?.getBody();
  const container = buildEverything(editorBody);
  if (!container) return;
  document.body.appendChild(container);
  document.body.classList.add('toc-print-selection-active');
  implicitCopy = container;
}

function onAfterPrint(): void {
  if (!implicitCopy) return;
  implicitCopy.remove();
  implicitCopy = null;
  document.body.classList.remove('toc-print-selection-active');
}

if (typeof window !== 'undefined') {
  // capture: this must run before the page-print handler of the spreadsheets (inline-spreadsheet.ts), which leaves a page with a copy alone
  window.addEventListener('beforeprint', onBeforePrint, true);
  window.addEventListener('afterprint', onAfterPrint, true);
}
