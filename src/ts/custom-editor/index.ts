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
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5 4v16M19 4v16M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  );
  editor.ui.registry.addIcon(
    'elabftw-calendar',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9.5h17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="14.6" r="1.7" fill="currentColor"/></svg>',
  );
  editor.ui.registry.addIcon(
    'elabftw-calendar-options',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9.5h17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="14.6" r="1" fill="currentColor"/><circle cx="12" cy="14.6" r="1" fill="currentColor"/><circle cx="15" cy="14.6" r="1" fill="currentColor"/></svg>',
  );
  editor.ui.registry.addIcon(
    'elabftw-clock',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l-3.25 3.25" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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

}
