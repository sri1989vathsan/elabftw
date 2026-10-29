/**
 * "HTML tools" toolbar button: a dropdown of the tools a sysadmin installed. Picking one opens it in the tool workspace
 * beside the page (HtmlToolsPanel), where its "-> eLabFTW" buttons insert into the main text at the cursor.
 */
import { Editor } from 'tinymce/tinymce';
import { ApiC } from '../api';

interface InstalledTool {
  id: number;
  name: string;
  description: string;
}

export const OPEN_HTML_TOOL_EVENT = 'open-html-tool';

export function registerHtmlToolsExtension(editor: Editor): void {
  editor.ui.registry.addIcon(
    'elabftw-html-tools',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 9h16v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 9V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V9M4 13.5h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  );
  editor.ui.registry.addMenuButton('html-tools', {
    icon: 'elabftw-html-tools',
    tooltip: 'HTML tools: open a tool beside the text and insert its results',
    fetch: callback => {
      ApiC.getJson<InstalledTool[]>('html_tools').then(tools => {
        callback(tools.length === 0
          ? [{ type: 'menuitem', text: 'No HTML tools installed yet', enabled: false }]
          : tools.map(tool => ({
            type: 'menuitem' as const,
            text: tool.name,
            onAction: () => window.dispatchEvent(new CustomEvent(OPEN_HTML_TOOL_EVENT, { detail: { id: tool.id } })),
          })));
      }).catch(() => callback([{ type: 'menuitem', text: 'Could not load the tools', enabled: false }]));
    },
  });
}
