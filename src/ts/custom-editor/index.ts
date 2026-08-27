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
  editor.ui.registry.addIcon(
    'elabftw-heading',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5 4v16M19 4v16M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  );
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
    text: 'Insert',
    tooltip: 'Insert line or note',
    items: 'horizontal-rule insert-note',
  });
  editor.ui.registry.addGroupToolbarButton('custom-edit', {
    icon: 'edit-block',
    tooltip: 'Edit selected content',
    items: 'edit-date-reference delete-date-reference table-properties cell-properties',
  });
}
