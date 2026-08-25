/** Helpers for copying rich editor content while preserving table formatting. */

export const RICH_SELECTION_ATTRIBUTE = 'data-elabftw-rich-selection';

const BLOCK_ELEMENTS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'UL',
]);

/** Remove transient editor state while retaining complete table/spreadsheet data. */
export function prepareCopiedContent(root: HTMLElement): void {
  root.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    table.removeAttribute('data-mce-elabftw-collapsed');
    table.removeAttribute('data-elabftw-collapsed');
  });
  root.querySelectorAll('script, style').forEach(element => element.remove());
  root.removeAttribute('contenteditable');
  root.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
}

/** Remove markup left by the retired table-collapse implementation. */
export function removeLegacyTableCollapse(root: HTMLElement): void {
  root.querySelectorAll('.elabftw-table-collapse-toggle').forEach(element => element.remove());
  root.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    table.removeAttribute('data-mce-elabftw-collapsed');
    table.removeAttribute('data-elabftw-collapsed');
  });
  root.querySelectorAll<HTMLDetailsElement>('details.elabftw-collapsible-table').forEach(details => {
    details.querySelector(':scope > summary')?.remove();
    details.replaceWith(...Array.from(details.childNodes));
  });
}

/** Put a rich DOM range on a native copy event. */
export function writeRangeToClipboardEvent(event: ClipboardEvent, range: Range): boolean {
  if (!event.clipboardData || range.collapsed) return false;
  const container = range.startContainer.ownerDocument?.createElement('div')
    ?? document.createElement('div');
  container.append(range.cloneContents());
  if (!container.querySelector('table')) return false;
  prepareCopiedContent(container);
  event.preventDefault();
  event.clipboardData.setData(
    'text/html',
    `<div ${RICH_SELECTION_ATTRIBUTE}="true">${container.innerHTML}</div>`,
  );
  event.clipboardData.setData('text/plain', copiedContentAsPlainText(container));
  return true;
}

/** Clean mixed text/table copies made from a rendered entity body. */
export function installRichContentCopy(root: HTMLElement): () => void {
  const ownerDocument = root.ownerDocument;
  const onCopy = (event: ClipboardEvent): void => {
    const selection = ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range.endContainer.parentElement;
    if ((!start || !root.contains(start)) && (!end || !root.contains(end))) return;
    writeRangeToClipboardEvent(event, range);
  };
  ownerDocument.addEventListener('copy', onCopy, true);
  return () => ownerDocument.removeEventListener('copy', onCopy, true);
}

function nodeAsPlainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  // Nodes cloned from TinyMCE belong to its iframe realm, so instanceof
  // Element from the parent window is not reliable here.
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as Element;
  if (element.tagName === 'BR') return '\n';
  if (element.tagName === 'TABLE') {
    return Array.from((element as HTMLTableElement).rows)
      .map(row => Array.from(row.cells)
        .filter(cell => !cell.classList.contains('spreadsheet-coordinate'))
        .map(cell => Array.from(cell.childNodes).map(nodeAsPlainText).join('').trim()))
      .filter(row => row.length > 0)
      .map(row => row.join('\t'))
      .join('\n');
  }
  if (element.classList.contains('spreadsheet-coordinate')) return '';

  const text = Array.from(element.childNodes).map(nodeAsPlainText).join('');
  return BLOCK_ELEMENTS.has(element.tagName) ? `${text}\n` : text;
}

export function copiedContentAsPlainText(root: HTMLElement): string {
  return Array.from(root.childNodes)
    .map(nodeAsPlainText)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function writeRichClipboard(html: string, plainText: string): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plainText], { type: 'text/plain' }),
    })]);
    return true;
  } catch {
    return false;
  }
}
