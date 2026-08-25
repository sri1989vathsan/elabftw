/** Fork-owned link-menu additions. */
import { Editor } from 'tinymce/tinymce';
import { ApiC } from '../api';
import { entity } from '../getEntity';
import { Model } from '../interfaces';
import { buildLabCollectorUrl } from '../labcollector-link';
import { createLocalFolderLink, localFolderUrl } from '../local-folder-links';
import {
  escapeHTML,
  getNewIdFromPostRequest,
  reloadElements,
  updateEntityBody,
} from '../misc';

interface LabCollectorDialogData {
  labcollectorType: string;
  labcollectorId: string;
}

interface LocalFolderDialogData {
  folderName: string;
}

interface UploadedLocalFile {
  long_name: string;
  real_name: string;
  storage: string | number;
}

function uploadedFileUrl(upload: UploadedLocalFile): string {
  const params = new URLSearchParams({
    name: upload.real_name,
    f: upload.long_name,
    storage: String(upload.storage),
  });
  return `app/download.php?${params.toString()}`;
}

export function registerLinkExtension(editor: Editor): void {
  const chooseAndLinkLocalFiles = (directory: boolean): void => {
    const bookmark = editor.selection.getBookmark(2, true);
    const hasSelection = !editor.selection.getRng().collapsed;
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    if (directory) {
      input.multiple = true;
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }

    input.addEventListener('cancel', () => input.remove(), { once: true });
    input.addEventListener('change', async() => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length === 0) return;

      try {
        const uploaded: Array<{ upload: UploadedLocalFile; label: string }> = [];
        // Upload sequentially so a large folder does not overwhelm the server
        // and so the links retain the operating system's file order.
        for (const file of files) {
          const formData = new FormData();
          formData.set('file', file);
          formData.set('extraParam', 'noRedirect');
          const response = await fetch(`api/v2/${entity.type}/${entity.id}/${Model.Upload}`, {
            method: 'POST',
            body: formData,
          });
          if (!response.ok) throw new Error(`Upload failed for ${file.name}`);
          const uploadId = getNewIdFromPostRequest(response);
          const upload = await ApiC.getJson<UploadedLocalFile>(
            `${entity.type}/${entity.id}/${Model.Upload}/${uploadId}`,
          );
          uploaded.push({
            upload,
            label: file.webkitRelativePath || file.name,
          });
        }

        await reloadElements(['uploadsDiv', 'filesFoldersLinksSection']);
        editor.focus();
        editor.selection.moveToBookmark(bookmark);
        editor.undoManager.transact(() => {
          if (uploaded.length === 1 && hasSelection) {
            editor.execCommand('mceInsertLink', false, {
              href: uploadedFileUrl(uploaded[0].upload),
              target: '_blank',
            });
            return;
          }

          const anchors = uploaded.map(({ upload, label }) => (
            `<a href="${escapeHTML(uploadedFileUrl(upload))}" target="_blank" rel="noopener">${escapeHTML(label)}</a>`
          ));
          const html = anchors.length === 1
            ? anchors[0]
            : `<ul>${anchors.map(anchor => `<li>${anchor}</li>`).join('')}</ul>`;
          editor.execCommand('mceInsertContent', false, html);
        });
        updateEntityBody();
        editor.notificationManager.open({
          text: directory
            ? `${uploaded.length} folder files attached and linked`
            : 'Local file attached and linked',
          type: 'success',
          timeout: 2200,
        });
      } catch (error) {
        editor.notificationManager.open({
          text: error instanceof Error ? error.message : 'Unable to attach local file',
          type: 'error',
          timeout: 3500,
        });
      }
    }, { once: true });

    document.body.append(input);
    input.click();
  };

  const openLocalFolderShortcutDialog = (): void => {
    const bookmark = editor.selection.getBookmark(2, true);
    const hasSelection = !editor.selection.getRng().collapsed;
    const selectedText = editor.selection.getContent({ format: 'text' }).trim();
    editor.windowManager.open({
      title: 'Insert local folder shortcut',
      size: 'normal',
      body: {
        type: 'panel',
        items: [{
          type: 'input',
          name: 'folderName',
          label: 'Shortcut name',
        }],
      },
      initialData: { folderName: selectedText },
      buttons: [
        { type: 'cancel', text: 'Cancel' },
        { type: 'submit', text: 'Create shortcut', primary: true },
      ],
      onSubmit: async api => {
        try {
          const data = api.getData() as LocalFolderDialogData;
          const folder = await createLocalFolderLink(data.folderName);
          const url = localFolderUrl(folder.id);
          editor.focus();
          editor.selection.moveToBookmark(bookmark);
          editor.undoManager.transact(() => {
            if (hasSelection) {
              editor.execCommand('mceInsertLink', false, { href: url });
              return;
            }
            editor.execCommand(
              'mceInsertContent',
              false,
              `<a href="${escapeHTML(url)}">${escapeHTML(folder.name)}</a>`,
            );
          });
          await updateEntityBody(false);
          api.close();
          editor.notificationManager.open({
            text: 'Folder shortcut created. Use it once to choose the folder on this computer.',
            type: 'success',
            timeout: 3500,
          });
        } catch (error) {
          editor.notificationManager.open({
            text: error instanceof Error ? error.message : 'Unable to create folder shortcut',
            type: 'error',
            timeout: 3500,
          });
        }
      },
    });
  };

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
    tooltip: 'Insert a web, uploaded file/folder, local folder shortcut, or LabCollector link',
    fetch: callback => {
      const items = [{
        type: 'menuitem' as const,
        text: 'Web link…',
        onAction: () => {
          editor.execCommand('mceLink');
        },
      }];
      if (document.getElementById('filesDiv')) {
        items.push({
          type: 'menuitem' as const,
          text: 'Upload and link file…',
          onAction: () => chooseAndLinkLocalFiles(false),
        });
        items.push({
          type: 'menuitem' as const,
          text: 'Upload and link folder…',
          onAction: () => chooseAndLinkLocalFiles(true),
        });
        items.push({
          type: 'menuitem' as const,
          text: 'Local folder shortcut…',
          onAction: openLocalFolderShortcutDialog,
        });
      }
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
