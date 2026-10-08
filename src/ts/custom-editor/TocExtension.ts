/** Notify the custom table of contents only when the heading tree changes. */
import { Editor } from 'tinymce/tinymce';

export function registerTocExtension(editor: Editor): void {
  let headingSignature = '';
  const notifyHeadingChanges = (): void => {
    const body = editor.getBody();
    const headings = Array.from(body.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map(heading => `${heading.tagName}:${heading.textContent?.trim() ?? ''}`);
    // Spreadsheets are listed too, under their title.
    const sheets = Array.from(body.querySelectorAll('table.elabftw-spreadsheet'))
      .map(table => `TABLE:${table.querySelector(':scope > caption')?.textContent?.trim() ?? ''}`);
    const pictures = Array.from(body.querySelectorAll('img:not([data-mce-bogus])'))
      .map(image => `IMG:${image.getAttribute('title') ?? ''}:${image.getAttribute('alt') ?? ''}:${image.closest('figure')?.querySelector('figcaption')?.textContent?.trim() ?? ''}`);
    const signature = [...headings, ...sheets, ...pictures].join('|');
    if (signature === headingSignature) return;
    headingSignature = signature;
    window.dispatchEvent(new CustomEvent('editor-headings-changed'));
  };
  editor.on('init', notifyHeadingChanges);
  editor.on('NodeChange', notifyHeadingChanges);
}
