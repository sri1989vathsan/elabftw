/**
 * Single integration seam for fork-owned TinyMCE behavior.
 *
 * Future editor extensions should be registered here instead of expanding the
 * upstream tinymce.ts setup callback.
 */
import { Editor } from 'tinymce/tinymce';
import { registerDateTitleExtension } from './DateTitleExtension';
import { registerFormatPainterExtension } from './FormatPainterExtension';
import { registerLinkExtension } from './LinkExtension';
import { registerListExtension } from './ListExtension';
import { registerMouseLinkExtension } from './MouseLinkExtension';
import { registerNoteExtension } from './NoteExtension';
import { registerSpreadsheetExtension } from './SpreadsheetExtension';
import { registerTableToolsExtension } from './TableToolsExtension';
import { registerTocExtension } from './TocExtension';

export function registerCustomEditorExtensions(editor: Editor): void {
  registerDateTitleExtension(editor);
  registerFormatPainterExtension(editor);
  registerLinkExtension(editor);
  registerListExtension(editor);
  registerMouseLinkExtension(editor);
  registerNoteExtension(editor);
  registerSpreadsheetExtension(editor);
  registerTableToolsExtension(editor);
  registerTocExtension(editor);

  // Keep the primary toolbar compact without replacing the established action
  // handlers. TinyMCE expands these groups into their original controls, so
  // split-button menus, enabled states and keyboard shortcuts remain intact.
  editor.ui.registry.addGroupToolbarButton('custom-insert', {
    icon: 'plus',
    tooltip: 'Insert date, title, spreadsheet, line or note',
    items: document.getElementById('documentTitle')
      ? 'adddate experiment-title inline-sheet horizontal-rule insert-note'
      : 'adddate inline-sheet horizontal-rule insert-note',
  });
  editor.ui.registry.addGroupToolbarButton('custom-edit', {
    icon: 'edit-block',
    tooltip: 'Edit selected content',
    items: 'edit-date-reference delete-date-reference table-properties cell-properties',
  });
}
