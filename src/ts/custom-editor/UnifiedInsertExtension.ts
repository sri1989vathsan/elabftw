/**
 * One consistent "Insert" menu grouping every insertion action already
 * registered by the other custom-editor extensions (text elements, tables,
 * links, laboratory), instead of the same actions being scattered across
 * separate toolbar buttons with no shared structure. Reuses each
 * extension's own registered button/menu spec via the TinyMCE UI registry
 * rather than duplicating their logic.
 */
import { Editor } from 'tinymce/tinymce';

/* eslint-disable-next-line */
type AnyMenuItem = any;

/** Pull the already-built submenu items out of a registered addMenuButton/addSplitButton spec. */
function fetchRegisteredItems(editor: Editor, name: string): Promise<AnyMenuItem[]> {
  return new Promise(resolve => {
    const spec = (editor.ui.registry.getAll() as AnyMenuItem).buttons?.[name];
    if (!spec?.fetch) {
      resolve([]);
      return;
    }
    spec.fetch((items: AnyMenuItem[]) => resolve(items ?? []));
  });
}

/**
 * Wrap a plain addButton spec's onAction as a single menu item, reusing that
 * button's own registered icon rather than a second, separately-guessed icon
 * name -- a mismatched guess (e.g. 'calendar' vs the actually-registered
 * 'elabftw-calendar') silently falls back to a generic bullet in the menu.
 */
function buttonAsMenuItem(editor: Editor, name: string, text: string): AnyMenuItem | null {
  const spec = (editor.ui.registry.getAll() as AnyMenuItem).buttons?.[name];
  if (!spec?.onAction) return null;
  return { type: 'menuitem', text, icon: spec.icon, onAction: () => spec.onAction() };
}

export function registerUnifiedInsertExtension(editor: Editor): void {
  editor.ui.registry.addMenuButton('elabftw-insert-menu', {
    icon: 'plus',
    text: 'Insert',
    tooltip: 'Insert (text, tables, links, laboratory)',
    fetch: async callback => {
      const [tableItems, linkItems] = await Promise.all([
        fetchRegisteredItems(editor, 'insert-data-table'),
        fetchRegisteredItems(editor, 'insert-link'),
      ]);
      // The note button is a split button whose entries are choice items (acted on through onItemAction), which
      // a submenu cannot show: plain menu items that run its commands instead.
      const noteItems: AnyMenuItem[] = [
        { type: 'menuitem', text: 'Insert note', icon: 'comment-add', onAction: () => editor.execCommand('elabftwInsertNote') },
        { type: 'menuitem', text: 'Note options…', icon: 'edit-block', onAction: () => editor.execCommand('elabftwNoteOptions') },
      ];

      const catalog: Record<string, AnyMenuItem> = {};
      const register = (id: string, item: AnyMenuItem | null): void => {
        if (item) catalog[id] = { ...item, text: item.text ?? id };
      };

      register('date', buttonAsMenuItem(editor, 'adddate', 'Insert date'));
      register('title', buttonAsMenuItem(editor, 'experiment-title', 'Insert title'));
      register('divider', buttonAsMenuItem(editor, 'horizontal-rule', 'Insert divider'));
      noteItems.forEach((item, index) => register(`note-${index}`, item));
      // Spreadsheet and Well plate are entries of the Insert menu itself, next to
      // Text, Tables, Links and Laboratory, not buried inside Tables
      const isDirect = (item: AnyMenuItem): boolean => item.type === 'nestedmenuitem'
        && (item.text === 'Spreadsheet' || item.text === 'Well plate');
      const directItems = tableItems.filter(isDirect);
      const plainTableItems = tableItems.filter(item => !isDirect(item));
      plainTableItems.forEach((item, index) => register(`table-${index}`, item));
      linkItems.forEach((item, index) => register(`link-${index}`, item));
      register('template', buttonAsMenuItem(editor, 'inserttemplate', 'Insert template'));

      const items: AnyMenuItem[] = [];
      items.push(
        {
          type: 'nestedmenuitem',
          text: 'Text',
          getSubmenuItems: () => [
            catalog.title, catalog.date, ...noteItems.map((_, index) => catalog[`note-${index}`]), catalog.divider,
          ].filter(Boolean),
        },
        {
          type: 'nestedmenuitem',
          text: 'Tables',
          getSubmenuItems: () => plainTableItems.map((_, index) => catalog[`table-${index}`]).filter(Boolean),
        },
        ...directItems,
        {
          type: 'nestedmenuitem',
          text: 'Links',
          getSubmenuItems: () => linkItems.map((_, index) => catalog[`link-${index}`]).filter(Boolean),
        },
        ...(catalog.template ? [catalog.template] : []),
      );
      callback(items);
    },
  });
}
