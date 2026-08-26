/** Fork-owned date, title and horizontal-rule tools for TinyMCE. */
import { DateTime } from 'luxon';
import { Editor } from 'tinymce/tinymce';
import DateReferenceEditor from '../DateReferenceEditor.class';
import ExperimentTitleEditor from '../ExperimentTitleEditor.class';

function getNow(): DateTime {
  const locale = document.getElementById('user-prefs').dataset.jslang;
  return DateTime.now().setLocale(locale);
}

function getDatetime(): string {
  const useIso = document.getElementById('user-prefs').dataset.isodate;
  if (useIso === '1') {
    const fullDatetime = getNow().toISO({ includeOffset: false });
    return fullDatetime.slice(0, -4);
  }
  return getNow().toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
}

function insertHorizontalRule(
  editor: Editor,
  style: 'single' | 'double' | 'dashed' | 'double-dashed',
): void {
  editor.execCommand(
    'mceInsertContent',
    false,
    `<hr class="elabftw-${style}-rule"><p><br data-mce-bogus="1"></p>`,
  );
}

export function registerDateTitleExtension(editor: Editor): void {
  const dateReferenceEditor = new DateReferenceEditor(editor);
  const experimentTitleEditor = new ExperimentTitleEditor(editor);
  editor.on('init', () => dateReferenceEditor.normalizeReferences());

  // Keep date editing discoverable: the split-button menu is useful for
  // insertion, but a selected date should also have an immediate edit action.
  editor.ui.registry.addButton('edit-date-reference', {
    icon: 'edit-block',
    tooltip: 'Edit selected date (or double-click a date)',
    enabled: false,
    onAction: () => {
      const selectedReference = dateReferenceEditor.getSelectedReference();
      if (selectedReference) dateReferenceEditor.openCalendar(selectedReference);
    },
    onSetup: api => {
      const updateEnabledState = (): void => {
        api.setEnabled(Boolean(dateReferenceEditor.getSelectedReference()));
      };
      editor.on('NodeChange', updateEnabledState);
      updateEnabledState();
      return () => editor.off('NodeChange', updateEnabledState);
    },
  });

  editor.ui.registry.addButton('delete-date-reference', {
    icon: 'remove',
    tooltip: 'Delete selected date (Undo restores it)',
    enabled: false,
    onAction: () => dateReferenceEditor.deleteReference(),
    onSetup: api => {
      const updateEnabledState = (): void => {
        api.setEnabled(Boolean(dateReferenceEditor.getSelectedReference()));
      };
      editor.on('NodeChange', updateEnabledState);
      updateEnabledState();
      return () => editor.off('NodeChange', updateEnabledState);
    },
  });

  editor.on('dblclick', event => {
    const target = event.target as HTMLElement;
    const reference = target.closest?.('a.elabftw-date-reference') as HTMLAnchorElement | null;
    if (!reference) return;
    event.preventDefault();
    dateReferenceEditor.openCalendar(reference);
  });

  editor.ui.registry.addSplitButton('adddate', {
    icon: 'insert-time',
    text: 'Date',
    tooltip: 'Insert today using saved defaults; open the menu for date options',
    onAction: () => dateReferenceEditor.insertToday(),
    onItemAction: (_api, value) => {
      switch (value) {
      case 'today':
        dateReferenceEditor.insertToday();
        break;
      case 'options':
        dateReferenceEditor.openCalendar();
        break;
      case 'timestamp':
        editor.insertContent(`${getDatetime()} `);
        break;
      case 'edit': {
        const selectedReference = dateReferenceEditor.getSelectedReference();
        if (selectedReference) dateReferenceEditor.openCalendar(selectedReference);
        break;
      }
      case 'copy':
        dateReferenceEditor.copySelectedReferenceLink();
        break;
      case 'delete':
        dateReferenceEditor.deleteReference();
        break;
      }
    },
    fetch: callback => {
      const items = [
        {
          type: 'choiceitem' as const,
          text: 'Insert today using saved defaults',
          value: 'today',
          icon: 'insert-time',
        },
        {
          type: 'choiceitem' as const,
          text: 'Choose date, format, heading or experiment…',
          value: 'options',
          icon: 'calendar',
        },
        {
          type: 'choiceitem' as const,
          text: 'Insert timestamp',
          value: 'timestamp',
        },
      ];
      const selectedReference = dateReferenceEditor.getSelectedReference();
      if (selectedReference) {
        items.push({ type: 'separator' as const } as unknown as typeof items[number]);
        items.push({
          type: 'choiceitem' as const,
          text: 'Edit selected date…',
          value: 'edit',
          icon: 'edit-block',
        });
        items.push({
          type: 'choiceitem' as const,
          text: 'Copy permanent link to date',
          value: 'copy',
          icon: 'copy',
        });
        items.push({
          type: 'choiceitem' as const,
          text: 'Delete selected date',
          value: 'delete',
          icon: 'remove',
        });
      }
      callback(items);
    },
  });

  editor.ui.registry.addSplitButton('experiment-title', {
    text: 'Title',
    tooltip: 'Insert experiment title as a heading (Ctrl+Alt+T)',
    onAction: () => experimentTitleEditor.insertUsingDefaults(),
    onItemAction: (_api, value) => {
      if (value === 'insert') {
        experimentTitleEditor.insertUsingDefaults();
      } else if (value === 'options') {
        experimentTitleEditor.openDialog();
      }
    },
    fetch: callback => callback([
      {
        type: 'choiceitem',
        text: 'Insert title using saved defaults',
        value: 'insert',
      },
      {
        type: 'choiceitem',
        text: 'Title heading and font options…',
        value: 'options',
      },
    ]),
  });

  editor.ui.registry.addMenuButton('horizontal-rule', {
    text: 'Line',
    tooltip: 'Insert solid or dashed horizontal lines',
    fetch: callback => callback([
      {
        type: 'menuitem',
        text: 'Single solid line (Ctrl+Shift+H)',
        onAction: () => insertHorizontalRule(editor, 'single'),
      },
      {
        type: 'menuitem',
        text: 'Double solid line (Ctrl+Alt+Shift+H)',
        onAction: () => insertHorizontalRule(editor, 'double'),
      },
      { type: 'separator' },
      {
        type: 'menuitem',
        text: 'Single dashed line',
        onAction: () => insertHorizontalRule(editor, 'dashed'),
      },
      {
        type: 'menuitem',
        text: 'Double dashed line',
        onAction: () => insertHorizontalRule(editor, 'double-dashed'),
      },
    ]),
  });

  editor.addShortcut(
    'ctrl+shift+d',
    'add date/time at cursor',
    () => editor.execCommand('mceInsertContent', false, `${getDatetime()} `),
  );
  editor.addShortcut(
    'ctrl+alt+t',
    'insert experiment title as a heading',
    () => experimentTitleEditor.insertUsingDefaults(),
  );
  editor.addShortcut(
    'ctrl+shift+h',
    'insert single horizontal line',
    () => insertHorizontalRule(editor, 'single'),
  );
  editor.addShortcut(
    'ctrl+alt+shift+h',
    'insert double horizontal line',
    () => insertHorizontalRule(editor, 'double'),
  );
  editor.addShortcut('ctrl+=', 'subscript', () => editor.execCommand('subscript'));
  editor.addShortcut('ctrl+shift+=', 'superscript', () => editor.execCommand('superscript'));
}
