/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import {
  escapeRegExp,
  getNewIdFromPostRequest,
  reloadElements,
  updateEntityBody,
} from './misc';
import { Target, Model, Action } from './interfaces';
import './doodle';
import { getEditor } from './Editor.class';
import DOMPurify from 'dompurify';
import { ApiC } from './api';
import { Uploader } from './uploader';
import { entity } from './getEntity';
import { on } from './handlers';
import { buildLabCollectorUrl, createLabCollectorLink, lookupLabCollectorRecord } from './labcollector-link';
import { platformSmbHref } from './file-folder-references';
import { spreadsheetToHTML, SpreadsheetData } from './inline-spreadsheet';
import {
  clearRecoveryDraft,
  isSameRecoveryContent,
  readRecoveryDraft,
} from './RecoveryDraft.class';

// remove exclusive edit mode when leaving the page
window.onbeforeunload = function() {
  ApiC.keepalive = true;
  ApiC.patch(`${entity.type}/${entity.id}`, { notifOnSaved: 0, action: Action.RemoveExclusiveEditMode });
};
// Which editor are we using? md or tiny
const editor = getEditor();
// Capture the server-rendered value before TinyMCE replaces the textarea.
const serverBody = (document.getElementById('body_area') as HTMLTextAreaElement | null)?.value ?? '';
editor.init('edit');

type WorkbookCell = string | number | boolean | null;
interface WorkbookWorksheet {
  data: WorkbookCell[][];
  name: string;
}

function trimWorksheetData(data: WorkbookCell[][]): WorkbookCell[][] {
  let lastRow = -1;
  let lastColumn = -1;
  data.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    if (value !== null && String(value).length > 0) {
      lastRow = Math.max(lastRow, rowIndex);
      lastColumn = Math.max(lastColumn, columnIndex);
    }
  }));
  if (lastRow < 0 || lastColumn < 0) return [['']];
  return data.slice(0, lastRow + 1).map(row => (
    Array.from({ length: lastColumn + 1 }, (_unused, index) => row[index] ?? '')
  ));
}

function workbookSheetToInlineSpreadsheet(
  worksheet: WorkbookWorksheet,
  includeCaption: boolean,
): string {
  const data = trimWorksheetData(worksheet.data);
  const raw: SpreadsheetData = {
    data,
    rows: data.length,
    cols: data.reduce((maximum, row) => Math.max(maximum, row.length), 1),
    kind: 'standard',
    caption: includeCaption ? worksheet.name : '',
  };
  // spreadsheetToHTML evaluates supported formulas for display and embeds
  // the untouched formula data so reopening the inline editor restores it.
  return spreadsheetToHTML(raw, data);
}

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.data?.type !== 'jss-insert-main-text') return;
  const spreadsheetIframe = document.getElementById('spreadsheetIframe') as HTMLIFrameElement | null;
  if (!spreadsheetIframe || event.source !== spreadsheetIframe.contentWindow) return;
  const worksheets = event.data.detail?.worksheets as WorkbookWorksheet[] | undefined;
  if (!Array.isArray(worksheets) || worksheets.length === 0) return;
  if (editor.type !== 'tiny') {
    window.alert('Formula spreadsheets can only be inserted in the rich text editor.');
    return;
  }
  const html = worksheets
    .filter(worksheet => Array.isArray(worksheet?.data))
    .map(worksheet => workbookSheetToInlineSpreadsheet(worksheet, worksheets.length > 1))
    .join('<p><br></p>');
  if (html) editor.setContent(html);
});
// initialize the file uploader
(new Uploader()).init();

type EditFolderScope = 'mine' | 'bookmarked' | 'all';

const editFolderSelect = document.getElementById('folderSelect') as HTMLSelectElement | null;
const editFolderScopeButtons = document.querySelectorAll<HTMLButtonElement>('[data-edit-folder-scope]');
let activeEditFolderScope: EditFolderScope = 'mine';

function syncEditFolderBookmarks(): void {
  if (!editFolderSelect) return;
  const favoriteIds = new Set(
    (document.getElementById('experimentsFoldersSidebar')?.dataset.favoriteFolderIds ?? '')
      .split(',')
      .filter(Boolean),
  );
  Array.from(editFolderSelect.options).slice(1).forEach(option => {
    option.dataset.folderBookmarked = String(favoriteIds.has(option.value));
  });
}

function applyEditFolderScope(scope: EditFolderScope): void {
  if (!editFolderSelect) return;
  activeEditFolderScope = scope;
  const currentUserId = editFolderSelect.dataset.currentUserId ?? '';
  Array.from(editFolderSelect.options).forEach((option, index) => {
    if (index === 0) {
      option.hidden = false;
      option.disabled = false;
      return;
    }
    // Always retain the current assignment in the list. Changing which
    // folders are displayed must never silently move the entity to Unfiled.
    const isVisible = option.selected
      || scope === 'all'
      || (scope === 'mine' && option.dataset.folderOwnerId === currentUserId)
      || (scope === 'bookmarked' && option.dataset.folderBookmarked === 'true');
    option.hidden = !isVisible;
    option.disabled = !isVisible;
  });
  editFolderScopeButtons.forEach(button => {
    const isActive = button.dataset.editFolderScope === scope;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
}

editFolderScopeButtons.forEach(button => {
  button.addEventListener('click', () => {
    const scope = button.dataset.editFolderScope;
    if (scope === 'mine' || scope === 'bookmarked' || scope === 'all') {
      applyEditFolderScope(scope);
    }
  });
});

editFolderSelect?.addEventListener('change', () => applyEditFolderScope(activeEditFolderScope));
document.addEventListener('elabftw:folders-refreshed', () => {
  syncEditFolderBookmarks();
  applyEditFolderScope(activeEditFolderScope);
});
applyEditFolderScope('mine');

////////////////
// DATA RECOVERY

// Check whether a failed save left content for this entity to recover.
const recoveryDraft = readRecoveryDraft(entity.type, entity.id);
if (recoveryDraft && isSameRecoveryContent(recoveryDraft.body, serverBody)) {
  // The server already contains this content, so prompting would be a false positive.
  clearRecoveryDraft(entity.type, entity.id, recoveryDraft.body);
} else if (recoveryDraft) {
  const savedDate = recoveryDraft.savedAt;
  const savedBody = recoveryDraft.body;

  const savedSpan = document.createElement('span');
  const savedTimestamp = Date.parse(savedDate);
  savedSpan.innerText = Number.isFinite(savedTimestamp)
    ? new Date(savedTimestamp).toLocaleString()
    : savedDate;

  const bodyRecovery = document.createElement('div');
  bodyRecovery.id = 'recoveryDiv';
  bodyRecovery.classList.add('alert', 'alert-warning');

  const bodyHtml = document.createElement('div');
  bodyHtml.innerHTML = DOMPurify.sanitize(savedBody, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'form'],
  });

  const recoverYes = document.createElement('button');
  recoverYes.type = 'button';
  recoverYes.classList.add('btn', 'btn-primary');
  recoverYes.dataset.action = 'recover-yes';
  recoverYes.innerText = 'YES';

  const recoverNo = document.createElement('button');
  recoverNo.type = 'button';
  recoverNo.classList.add('button', 'btn', 'btn-danger');
  recoverNo.dataset.action = 'recover-no';
  recoverNo.innerText = 'NO';

  bodyRecovery.append(
    document.createTextNode('Recovery data found (saved on '),
    savedSpan,
    document.createTextNode('). It was probably saved because your session timed out and it could not be saved in the database. Do you want to recover it?'),
    document.createElement('br'),
    recoverYes,
    document.createTextNode(' '),
    recoverNo,
    document.createElement('br'),
    document.createElement('br'),
    document.createTextNode('Here is what it looks like: '),
    bodyHtml,
  );

  document.querySelector('#main_section').before(bodyRecovery);

}

// RECOVER YES
on('recover-yes', () => {
  const params = {};
  const draft = readRecoveryDraft(entity.type, entity.id);
  if (!draft) return;
  params[Target.Body] = draft.body;

  ApiC.patch(`${entity.type}/${entity.id}`, params).then(() => {
    editor.replaceContent(draft.body);
    clearRecoveryDraft(entity.type, entity.id, draft.body);
    document.getElementById('recoveryDiv')?.remove();
  });
});

// RECOVER NO
on('recover-no', () => {
  clearRecoveryDraft(entity.type, entity.id);
  document.getElementById('recoveryDiv')?.remove();
});
// END DATA RECOVERY
////////////////////

on('get-next-custom-id', (el: HTMLElement) => {
  const inputEl = document.getElementById('custom_id_input') as HTMLInputElement;
  inputEl.classList.remove('is-invalid');
  // lock the button
  const button = el as HTMLButtonElement;
  button.disabled = true;
  ApiC.patch(`${entity.type}/${entity.id}`, {action: Action.SetNextCustomId}).then(res => res.json()).then(json => {
    inputEl.value = String(json.custom_id);
  }).finally(() => button.disabled = false);
});

on('annotate-image', (el: HTMLElement) => {
  // show doodle canvas
  const doodleDiv = document.getElementById('doodleDiv');
  doodleDiv.removeAttribute('hidden');
  doodleDiv.scrollIntoView({behavior: 'smooth'});
  // adjust caret icon
  const doodleDivIcon = document.getElementById('doodleDivIcon');
  doodleDivIcon.classList.remove('fa-caret-right');
  doodleDivIcon.classList.add('fa-caret-down');

  const context: CanvasRenderingContext2D = (document.getElementById('doodleCanvas') as HTMLCanvasElement).getContext('2d');
  const img = new Image();
  // set src attribute to image path
  img.addEventListener('load', function() {
    // make canvas bigger than image
    context.canvas.width = (this as HTMLImageElement).width * 2;
    context.canvas.height = (this as HTMLImageElement).height * 2;
    // add image to canvas
    context.drawImage(img, (this as HTMLImageElement).width / 2, (this as HTMLImageElement).height / 2);
  });
  img.src = `app/download.php?storage=${el.dataset.storage}&f=${el.dataset.path}`;
});

on('import-link-body', (el: HTMLElement) => {
  // this is in this file and not in steps-links-edit because here `editor`
  // exists and is reachable
  ApiC.getJson(`${el.dataset.endpoint}/${el.dataset.target}`).then(json => {
    editor.setContent(json.body);
  });
});
on('import-step-body', (el: HTMLElement) => {
  ApiC.getJson(`${entity.type}/${entity.id}/${Model.Step}/${el.dataset.stepid}`).then(json => {
    let content = `<a href='?mode=view&id=${entity.id}&highlightstep=${el.dataset.stepid}#step_view_${el.dataset.stepid}'>${json.body}</a>`;
    // markdown
    if (editor.type === 'md') {
      content = `[${json.body}](?mode=view&id=${entity.id}&highlightstep=${el.dataset.stepid}#step_view_${el.dataset.stepid})`;
    }
    return editor.setContent(content);
  });
});

// INSERT IN BODY
const insertImageInBody = (url: string): void => {
  // switch for markdown or tinymce editor
  let content: string;
  if (editor.type === 'md') {
    content = '\n![image](' + url + ')\n';
  } else if (editor.type === 'tiny') {
    content = '<img src="' + url + '" />';
  }
  editor.setContent(content);
  // save to prevent destroy/archive actions on the uploads before they're considered part of the body
  updateEntityBody();
};

const insertVideoInBody = (url: string): void => {
  // no syntax for video in markdown; use plain html in both cases
  const video = document.createElement('video');
  const source = document.createElement('source');
  source.src = url;
  video.width = 640;
  video.controls = true;
  video.appendChild(source);
  editor.setContent(video.outerHTML);
};

const insertAudioInBody = (url: string): void => {
  // no syntax for audio in markdown; use plain html in both cases
  const audio = document.createElement('audio');
  audio.src = url;
  audio.controls = true;
  editor.setContent(audio.outerHTML);
};

const insertTextInBody = (url: string): void => {
  fetch(url).then(response => {
    return response.text();
  }).then(fileContent => {
    const specialChars = {
      '<': '&lt;',
      '>': '&gt;',
    };
    // wrap in pre element to retain whitespace, html encode '<' and '>'
    editor.setContent('<pre>' + fileContent.replace(/[<>]/g, char => specialChars[char]) + '</pre>');
  });
};

const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp'];
const videoExts = ['mkv', 'mp4', 'ogv', 'webm'];
const audioExts = ['aac', 'flac', 'mp3', 'ogg', 'opus', 'wav'];

const insertHandlers = new Map<string, (url: string) => void>([
  ...imageExts.map(ext => [ext, insertImageInBody] as const),
  ...videoExts.map(ext => [ext, insertVideoInBody] as const),
  ...audioExts.map(ext => [ext, insertAudioInBody] as const),
  ['txt', insertTextInBody],
]);

on('insert-in-body', (el: HTMLElement) => {
  const url = `app/download.php?name=${encodeURIComponent(el.dataset.name)}&f=${encodeURIComponent(el.dataset.link)}&storage=${encodeURIComponent(el.dataset.storage)}`;
  insertHandlers.get(el.dataset.ext.replace(/^\./, '').toLowerCase())?.(url);
});

// Insert a download link for any attached local file. Unlike insert-in-body,
// this remains useful for file types that cannot be embedded in the editor.
on('insert-upload-link', (el: HTMLElement) => {
  const name = el.dataset.name ?? 'Attached file';
  const storedName = el.dataset.link;
  const storage = el.dataset.storage;
  if (!storedName || !storage) return;
  const params = new URLSearchParams({
    name,
    f: storedName,
    storage,
  });
  const url = `app/download.php?${params.toString()}`;
  if (editor.type === 'md') {
    const markdownLabel = name.replace(/([\\[\]])/g, '\\$1');
    editor.setContent(`[${markdownLabel}](${url})`);
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = name;
    editor.setContent(link.outerHTML);
  }
  updateEntityBody();
});

on('insert-file-folder-reference', (el: HTMLElement) => {
  const text = el.dataset.text?.trim();
  if (!text) return;
  const label = el.dataset.label?.trim();
  const smbHref = platformSmbHref(text);
  const displayText = label || text;
  if (editor.type === 'md') {
    if (smbHref) {
      const markdownLabel = displayText.replace(/([\\[\]])/g, '\\$1');
      editor.setContent(`[${markdownLabel}](${smbHref})`);
    } else {
      editor.setContent(displayText);
    }
  } else if (smbHref) {
    const link = document.createElement('a');
    link.href = smbHref;
    link.textContent = displayText;
    editor.setContent(link.outerHTML);
  } else {
    const plainText = document.createElement('span');
    plainText.textContent = displayText;
    editor.setContent(plainText.innerHTML);
  }
  updateEntityBody();
});

on('insert-web-link', (el: HTMLElement) => {
  const label = el.dataset.label?.trim();
  const url = el.dataset.url?.trim();
  if (!label || !url) return;
  if (editor.type === 'md') {
    const markdownLabel = label.replace(/([\\[\]])/g, '\\$1');
    editor.setContent(`[${markdownLabel}](${url})`);
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = label;
    editor.setContent(link.outerHTML);
  }
  updateEntityBody();
});
// END INSERT IN BODY

async function getLabCollectorSelection(): Promise<{ id: string; label: string; url: string } | null> {
  const typeSelect = document.getElementById('labcollectorType') as HTMLSelectElement | null;
  const idInput = document.getElementById('labcollectorId') as HTMLInputElement | null;
  if (!typeSelect || !idInput) return null;
  const id = idInput.value.trim();
  idInput.classList.toggle('is-invalid', !id);
  if (!id) return null;
  const typeLabel = typeSelect.selectedOptions[0]?.textContent ?? typeSelect.value;
  const lookupEnabled = (document.getElementById('labcollectorLookup') as HTMLInputElement | null)?.checked ?? false;
  const record = lookupEnabled ? await lookupLabCollectorRecord(typeSelect.value, id) : null;
  // Callers append " #<id>" themselves, so the label here never repeats it.
  const label = record
    ? `${typeLabel}: ${record.name}${record.storage ? ` (${record.storage})` : ''}`
    : typeLabel;
  return {
    id,
    label,
    url: buildLabCollectorUrl(typeSelect.value, id),
  };
}

on('add-labcollector-link', async () => {
  const selection = await getLabCollectorSelection();
  if (!selection) return;
  await createLabCollectorLink(`${selection.label} #${selection.id}`, selection.url);
  const json = await ApiC.getJson(`${entity.type}/${entity.id}`);
  const metadata = json.metadata ? JSON.parse(json.metadata) : {};
  metadata.extra_fields ??= {};
  const positions = Object.values(metadata.extra_fields)
    .map((field: { position?: number }) => field.position ?? 0);
  metadata.extra_fields[`${selection.label} #${selection.id}`] = {
    type: 'url',
    value: selection.url,
    description: '',
    position: positions.length > 0 ? Math.max(...positions) + 1 : 0,
    group_id: null,
  };
  await ApiC.patch(`${entity.type}/${entity.id}`, { metadata: JSON.stringify(metadata) });
  window.location.reload();
});

on('insert-labcollector-link', async () => {
  const selection = await getLabCollectorSelection();
  if (!selection) return;
  const linkText = `${selection.label} #${selection.id}`;
  editor.setContent(editor.type === 'md'
    ? `[${linkText}](${selection.url})`
    : `<a href="${selection.url}" target="_blank" rel="noreferrer noopener">${linkText}</a>`);
  (document.getElementById('labcollectorId') as HTMLInputElement).value = '';
  await createLabCollectorLink(linkText, selection.url);
});


// REPLACE UPLOADED FILE
// this should be in uploads but there is no good way so far to interact with the two editors there
document.getElementById('filesDiv')?.addEventListener('submit', event => {
  const el = event.target as HTMLElement;
  if (el.matches('[data-action="replace-uploaded-file"]')) {
    event.preventDefault();

    // we can identify an image by the src attribute in this context
    const searchPrefixSrc = 'src="app/download.php?f=';
    const searchPrefixMd = '![image](app/download.php?f=';
    const formElement = el as HTMLFormElement;
    const editorCurrentContent = editor.getContent();
    const formData = new FormData(formElement);
    // prevent the browser from redirecting us
    formData.set('extraParam', 'noRedirect');
    formData.append('action', Action.Replace);
    fetch(`api/v2/${entity.type}/${entity.id}/${Model.Upload}/${el.dataset.uploadid}`, {
      method: 'POST',
      body: formData,
    }).then(resp => {
      reloadElements(['uploadsDiv']);
      // return early if longName is not found in body
      if ((editorCurrentContent.indexOf(searchPrefixSrc + formElement.dataset.longName) === -1)
        && (editorCurrentContent.indexOf(searchPrefixMd + formElement.dataset.longName) === -1)
      ) {
        return true;
      }
      // now replace all occurrence of the old file in the body with the long_name of the new file
      const newId = getNewIdFromPostRequest(resp);
      // fetch info about the newly created upload
      return ApiC.getJson(`${entity.type}/${entity.id}/${Model.Upload}/${newId}`);
    }).then(json => {
      // use regExp in replace to find all occurrence
      // images are identified by 'src="app/download.php?f=' (html) and '![image](app/download.php?f=' (md)
      // '.', '?', '[' and '(' need to be escaped in js regex
      const editorNewContent = editorCurrentContent.replace(
        new RegExp(escapeRegExp(searchPrefixSrc + formElement.dataset.longName), 'g'),
        searchPrefixSrc + json.long_name,
      ).replace(
        new RegExp(escapeRegExp(searchPrefixMd + formElement.dataset.longName), 'g'),
        searchPrefixMd + json.long_name,
      );
      editor.replaceContent(editorNewContent);

      // status of previous file is archived now
      // save because using the old file will not return an id from the db
      updateEntityBody();
    });
  }
});
