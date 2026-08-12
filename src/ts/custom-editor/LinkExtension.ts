/** Fork-owned link-menu additions. */
import { Editor } from 'tinymce/tinymce';
import { buildLabCollectorUrl } from '../labcollector-link';
import { escapeHTML } from '../misc';

interface LabCollectorDialogData {
  labcollectorType: string;
  labcollectorId: string;
}

export function registerLinkExtension(editor: Editor): void {
  const openLabCollectorLinkDialog = (): void => {
    const helperType = document.getElementById('labcollectorType') as HTMLSelectElement | null;
    const helperId = document.getElementById('labcollectorId') as HTMLInputElement | null;
    if (!helperType || !helperId) return;
    const bookmark = editor.selection.getBookmark(2, true);
    const hasSelection = !editor.selection.getRng().collapsed;
    const typeItems = Array.from(helperType.options, option => ({
      text: option.textContent ?? option.value,
      value: option.value,
    }));

    editor.windowManager.open({
      title: 'Insert LabCollector link',
      size: 'normal',
      body: {
        type: 'panel',
        items: [
          {
            type: 'selectbox',
            name: 'labcollectorType',
            label: 'LabCollector type',
            items: typeItems,
          },
          {
            type: 'input',
            name: 'labcollectorId',
            label: 'LabCollector ID',
          },
        ],
      },
      initialData: {
        labcollectorType: helperType.value,
        labcollectorId: helperId.value,
      },
      buttons: [
        { type: 'cancel', text: 'Cancel' },
        { type: 'submit', text: 'Insert link', primary: true },
      ],
      onSubmit: api => {
        const data = api.getData() as LabCollectorDialogData;
        const id = data.labcollectorId.trim();
        let url: string;
        try {
          url = buildLabCollectorUrl(data.labcollectorType, id);
        } catch {
          editor.notificationManager.open({
            text: 'Enter a valid positive LabCollector ID.',
            type: 'error',
            timeout: 2500,
          });
          return;
        }

        const selectedType = Array.from(helperType.options)
          .find(option => option.value === data.labcollectorType);
        const label = `LabCollector ${selectedType?.textContent ?? data.labcollectorType} #${id}`;
        helperType.value = data.labcollectorType;
        helperId.value = id;
        editor.focus();
        editor.selection.moveToBookmark(bookmark);
        editor.undoManager.transact(() => {
          if (hasSelection) {
            editor.execCommand('mceInsertLink', false, { href: url, target: '_blank' });
            return;
          }
          editor.execCommand(
            'mceInsertContent',
            false,
            `<a href="${escapeHTML(url)}" target="_blank">${escapeHTML(label)}</a>`,
          );
        });
        api.close();
      },
    });
  };

  editor.ui.registry.addMenuButton('insert-link', {
    icon: 'link',
    text: 'Link',
    tooltip: 'Insert a web, file, or LabCollector link',
    fetch: callback => {
      const items = [{
        type: 'menuitem' as const,
        text: 'Web or file link…',
        onAction: () => editor.execCommand('mceLink'),
      }];
      if (document.getElementById('labcollectorHelper')) {
        items.push({
          type: 'menuitem' as const,
          text: 'LabCollector link…',
          onAction: openLabCollectorLinkDialog,
        });
      }
      callback(items);
    },
  });
}
