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
  editor.ui.registry.addIcon(
    'elabftw-calendar',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none"><rect x="3.5" y="4.5" width="17" height="16" rx="3" stroke="currentColor" stroke-width="2"/><path d="M4 9h16M7 2.75v3.5M12 2.75v3.5M17 2.75v3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 12h2v2H7zM11 12h2v2h-2zM15 12h2v2h-2zM7 16h2v2H7zM11 16h2v2h-2zM15 16h2v2h-2z" fill="currentColor"/></svg>',
  );
  editor.ui.registry.addIcon(
    'elabftw-clock',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l-3.25 3.25" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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

  // Keep editing actions grouped without replacing their established handlers,
  // enabled states or keyboard shortcuts.
  editor.ui.registry.addGroupToolbarButton('custom-edit', {
    icon: 'edit-block',
    tooltip: 'Edit selected content',
    items: 'edit-date-reference delete-date-reference table-properties cell-properties',
  });
}
