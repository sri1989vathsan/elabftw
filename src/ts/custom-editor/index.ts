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
import { registerSpreadsheetExtension } from './SpreadsheetExtension';
import { registerTableToolsExtension } from './TableToolsExtension';
import { registerTocExtension } from './TocExtension';

export function registerCustomEditorExtensions(editor: Editor): void {
  registerDateTitleExtension(editor);
  registerFormatPainterExtension(editor);
  registerLinkExtension(editor);
  registerListExtension(editor);
  registerMouseLinkExtension(editor);
  registerSpreadsheetExtension(editor);
  registerTableToolsExtension(editor);
  registerTocExtension(editor);
}
