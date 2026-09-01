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

const RECENT_KEY = 'elabftw-recent-insert-actions';
const MAX_RECENT = 4;

function getRecentIds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function recordRecentId(id: string): void {
  try {
    const next = [id, ...getRecentIds().filter(existing => existing !== id)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private browsing, quota) -- recents are a
    // convenience, not worth surfacing an error for.
  }
}

/** Wrap a leaf menu item's onAction so using it (from anywhere) marks it recently used. */
function trackRecent(id: string, item: AnyMenuItem): AnyMenuItem {
  if (typeof item.onAction !== 'function') return item;
  const original = item.onAction;
  return {
    ...item,
    onAction: (api: AnyMenuItem) => {
      recordRecentId(id);
      original(api);
    },
  };
}

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
      const [tableItems, linkItems, noteItems] = await Promise.all([
        fetchRegisteredItems(editor, 'insert-data-table'),
        fetchRegisteredItems(editor, 'insert-link'),
        fetchRegisteredItems(editor, 'insert-note'),
      ]);

      const catalog: Record<string, AnyMenuItem> = {};
      const register = (id: string, item: AnyMenuItem | null): void => {
        if (item) catalog[id] = trackRecent(id, { ...item, text: item.text ?? id });
      };

      register('date', buttonAsMenuItem(editor, 'adddate', 'Insert date'));
      register('title', buttonAsMenuItem(editor, 'experiment-title', 'Insert title'));
      register('divider', buttonAsMenuItem(editor, 'horizontal-rule', 'Insert divider'));
      noteItems.forEach((item, index) => register(`note-${index}`, item));
      tableItems.forEach((item, index) => register(`table-${index}`, item));
      linkItems.forEach((item, index) => register(`link-${index}`, item));
      register('template', buttonAsMenuItem(editor, 'inserttemplate', 'Insert template'));

      const recentItems = getRecentIds()
        .map(id => catalog[id])
        .filter((item): item is AnyMenuItem => Boolean(item));

      const items: AnyMenuItem[] = [];
      if (recentItems.length > 0) {
        items.push({ type: 'menuitem', text: 'Recently used', enabled: false });
        items.push(...recentItems);
        items.push({ type: 'separator' });
      }
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
          getSubmenuItems: () => tableItems.map((_, index) => catalog[`table-${index}`]).filter(Boolean),
        },
        {
          type: 'nestedmenuitem',
          text: 'Links',
          getSubmenuItems: () => linkItems.map((_, index) => catalog[`link-${index}`]).filter(Boolean),
        },
        {
          type: 'nestedmenuitem',
          text: 'Laboratory',
          getSubmenuItems: () => [catalog.template].filter(Boolean),
        },
      );
      callback(items);
    },
  });
}
