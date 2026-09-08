/** Notify the custom table of contents only when the heading tree changes. */
import { Editor } from 'tinymce/tinymce';

export function registerTocExtension(editor: Editor): void {
  let headingSignature = '';
  const notifyHeadingChanges = (): void => {
    const signature = Array.from(editor.getBody().querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map(heading => `${heading.tagName}:${heading.textContent?.trim() ?? ''}`)
      .join('|');
    if (signature === headingSignature) return;
    headingSignature = signature;
    window.dispatchEvent(new CustomEvent('editor-headings-changed'));
  };
  editor.on('init', notifyHeadingChanges);
  editor.on('NodeChange', notifyHeadingChanges);
}
