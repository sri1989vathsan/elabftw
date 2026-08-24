/** Helpers for copying rich editor content without spreadsheet coordinate labels. */

const BLOCK_ELEMENTS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'UL',
]);

/** Convert spreadsheet display tables into normal clipboard tables. */
export function prepareCopiedContent(root: HTMLElement): void {
  root.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    const coordinates = table.querySelectorAll('.spreadsheet-coordinate');
    if (coordinates.length > 0) {
      coordinates.forEach(cell => cell.remove());
      table.removeAttribute('data-spreadsheet');
      table.removeAttribute('data-spreadsheet-style');
      table.classList.remove('elabftw-spreadsheet');
      table.classList.add('elabftw-pasted-table');
    }
    table.removeAttribute('data-mce-elabftw-collapsed');
    table.removeAttribute('data-elabftw-collapsed');
  });

  root.querySelectorAll<HTMLTableRowElement>('tr').forEach(row => {
    if (row.cells.length === 0) row.remove();
  });
  root.querySelectorAll('thead, tbody, tfoot').forEach(section => {
    if (!section.querySelector('tr')) section.remove();
  });
  root.querySelectorAll('script, style').forEach(element => element.remove());
  root.removeAttribute('contenteditable');
  root.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
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
        .map(cell => Array.from(cell.childNodes).map(nodeAsPlainText).join('').trim())
        .join('\t'))
      .join('\n');
  }

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
