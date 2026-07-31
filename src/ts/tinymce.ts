/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import tinymce from 'tinymce/tinymce';
import { Editor } from 'tinymce/tinymce';
import { DateTime } from 'luxon';
import i18next from './i18n';
import type { DropzoneFile } from 'dropzone';
import 'tinymce/models/dom';
import 'tinymce/icons/default';
import 'tinymce/themes/silver';
// Note about tinymce css stuff: this page https://www.tiny.cloud/docs/tinymce/6/webpack-es6-npm/ just doesn't work as advertised
// so it's easier to simply copy/extract the css files to web/assets/tinymce_skins instead via the yarn-plugin-tinymce.js
import 'tinymce/plugins/accordion';
import 'tinymce/plugins/advlist';
import 'tinymce/plugins/anchor';
import 'tinymce/plugins/autolink';
import 'tinymce/plugins/autoresize';
import 'tinymce/plugins/autosave';
import 'tinymce/plugins/charmap';
import 'tinymce/plugins/code';
import 'tinymce/plugins/codesample';
import 'tinymce/plugins/emoticons';
import 'tinymce/plugins/fullscreen';
import 'tinymce/plugins/image';
import 'tinymce/plugins/insertdatetime';
import 'tinymce/plugins/link';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/media';
import 'tinymce/plugins/pagebreak';
import 'tinymce/plugins/preview';
import 'tinymce/plugins/save';
import 'tinymce/plugins/searchreplace';
import 'tinymce/plugins/table';
import 'tinymce/plugins/template';
import 'tinymce/plugins/visualblocks';
import 'tinymce/plugins/visualchars';
import '../js/tinymce-langs/ca_ES.js';
import '../js/tinymce-langs/cs_CZ.js';
import '../js/tinymce-langs/de_DE.js';
import '../js/tinymce-langs/el_GR.js';
import '../js/tinymce-langs/en_GB.js';
import '../js/tinymce-langs/en_US.js';
import '../js/tinymce-langs/es_ES.js';
import '../js/tinymce-langs/et_EE.js';
import '../js/tinymce-langs/fi_FI.js';
import '../js/tinymce-langs/fr_FR.js';
import '../js/tinymce-langs/id_ID.js';
import '../js/tinymce-langs/it_IT.js';
import '../js/tinymce-langs/ja_JP.js';
import '../js/tinymce-langs/ko_KR.js';
import '../js/tinymce-langs/nl_BE.js';
import '../js/tinymce-langs/pl_PL.js';
import '../js/tinymce-langs/pt_BR.js';
import '../js/tinymce-langs/pt_PT.js';
import '../js/tinymce-langs/ru_RU.js';
import '../js/tinymce-langs/sk_SK.js';
import '../js/tinymce-langs/sl_SI.js';
import '../js/tinymce-langs/uz_UZ.js';
import '../js/tinymce-langs/zh_CN.js';
import '../js/tinymce-langs/zh_TW.js';
import '../js/tinymce-plugins/mention/plugin.js';
import { EntityType, Model } from './interfaces';
import { reloadElements, escapeExtendedQuery, updateEntityBody, getNewIdFromPostRequest } from './misc';
import { ApiC } from './api';
import { isSortable } from './TableSorting.class';
import {
  createNotebookSpreadsheetData,
  createWellPlateSpreadsheetData,
  emptySpreadsheetData,
  extractFromTable,
  openSpreadsheetModal,
  spreadsheetFromClipboard,
  spreadsheetToHTML,
  SpreadsheetData,
  WELL_PLATE_PRESETS,
} from './inline-spreadsheet';
import TableIndentation from './TableIndentation.class';
import DateReferenceEditor from './DateReferenceEditor.class';
import ExperimentTitleEditor from './ExperimentTitleEditor.class';
import { MathJaxObject } from 'mathjax-full/js/components/startup';
declare const MathJax: MathJaxObject;
import { entity } from './getEntity';

// AUTOSAVE
const doneTypingInterval = 7000;  // time in ms between end of typing and save

function getNow(): DateTime {
  const locale = document.getElementById('user-prefs').dataset.jslang;
  return DateTime.now().setLocale(locale);
}

function getDatetime(): string {
  const useIso = document.getElementById('user-prefs').dataset.isodate;
  if (useIso === '1') {
    const fullDatetime = getNow().toISO({ includeOffset: false });
    // now we remove the milliseconds from that string
    // 2021-04-23T18:57:28.633  ->  2021-04-23T18:57:28
    return fullDatetime.slice(0, -4);
  }
  return getNow().toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
}

// ctrl-shift-D will add the date in the tinymce editor
function addDatetimeOnCursor(): void {
  tinymce.activeEditor.execCommand('mceInsertContent', false, `${getDatetime()} `);
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

const CHECKLIST_CLASS = 'elabftw-checklist';
const CHECKLIST_ITEM_CLASS = 'elabftw-checklist-item';

function checklistFromSelection(editor: Editor): HTMLUListElement | null {
  const node = editor.selection.getNode() as HTMLElement;
  return node.closest(`ul.${CHECKLIST_CLASS}`) as HTMLUListElement | null;
}

function normalizeChecklist(list: HTMLUListElement): void {
  list.classList.add(CHECKLIST_CLASS);
  list.querySelectorAll<HTMLUListElement>('ul').forEach(nestedList => {
    nestedList.classList.add(CHECKLIST_CLASS);
  });
  list.querySelectorAll<HTMLLIElement>('li').forEach(item => {
    if (!item.parentElement?.matches(`ul.${CHECKLIST_CLASS}`)) return;
    item.classList.add(CHECKLIST_ITEM_CLASS);
    const checked = item.dataset.checked === 'true';
    item.dataset.checked = checked ? 'true' : 'false';
  });
}

function normalizeChecklists(editor: Editor): void {
  editor.getBody().querySelectorAll<HTMLUListElement>(`ul.${CHECKLIST_CLASS}`)
    .forEach(normalizeChecklist);
}

function applyChecklist(editor: Editor, checked = false): void {
  let list = checklistFromSelection(editor);
  if (!list) {
    const currentList = (editor.selection.getNode() as HTMLElement)
      .closest('ul,ol') as HTMLOListElement | HTMLUListElement | null;
    if (!currentList || currentList.tagName === 'OL') {
      editor.execCommand('InsertUnorderedList');
    }
    list = (editor.selection.getNode() as HTMLElement)
      .closest('ul') as HTMLUListElement | null;
  }
  if (!list) return;

  normalizeChecklist(list);
  const selectedItem = (editor.selection.getNode() as HTMLElement)
    .closest(`li.${CHECKLIST_ITEM_CLASS}`) as HTMLLIElement | null;
  if (checked && selectedItem) {
    selectedItem.dataset.checked = 'true';
  }
}

function removeChecklist(editor: Editor): void {
  const list = checklistFromSelection(editor);
  if (!list) return;
  list.querySelectorAll<HTMLLIElement>(`li.${CHECKLIST_ITEM_CLASS}`).forEach(item => {
    item.classList.remove(CHECKLIST_ITEM_CLASS);
    delete item.dataset.checked;
  });
  list.querySelectorAll<HTMLUListElement>(`ul.${CHECKLIST_CLASS}`).forEach(nestedList => {
    nestedList.classList.remove(CHECKLIST_CLASS);
  });
  list.classList.remove(CHECKLIST_CLASS);
  editor.execCommand('RemoveList');
}

function toggleChecklist(editor: Editor): void {
  editor.undoManager.transact(() => {
    if (checklistFromSelection(editor)) {
      removeChecklist(editor);
    } else {
      applyChecklist(editor);
    }
  });
  editor.setDirty(true);
  editor.nodeChanged();
  editor.focus();
}

function handleChecklistClick(editor: Editor, event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const item = target?.closest(`li.${CHECKLIST_ITEM_CLASS}`) as HTMLLIElement | null;
  if (!item || !item.closest(`ul.${CHECKLIST_CLASS}`)) return;

  // The checkbox is a CSS marker occupying the first 1.4rem of the list item.
  // Only clicks in that marker area toggle state; clicks on the text still edit.
  const markerWidth = 24;
  const offset = event.clientX - item.getBoundingClientRect().left;
  if (offset < -2 || offset > markerWidth) return;

  event.preventDefault();
  event.stopPropagation();
  editor.undoManager.transact(() => {
    const checked = item.dataset.checked !== 'true';
    item.dataset.checked = checked ? 'true' : 'false';
  });
  editor.setDirty(true);
  editor.nodeChanged();
}

/**
 * Convert a list marker followed by Space at the start of an otherwise empty
 * paragraph. This is explicit because TinyMCE text patterns are not reliable
 * across every editor configuration used by eLabFTW.
 */
function handleListShortcut(editor: Editor, event: KeyboardEvent): void {
  if ((event.key !== ' ' && event.code !== 'Space')
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || event.isComposing) {
    return;
  }

  const range = editor.selection.getRng();
  if (!range.collapsed) return;

  const block = editor.dom.getParent(range.startContainer, 'p,div') as HTMLElement | null;
  if (!block || block.closest('li,pre,code,table')) return;

  const marker = block.textContent ?? '';
  let command: 'InsertUnorderedList' | 'InsertOrderedList' | 'Checklist' | null = null;
  let checklistChecked = false;
  if (marker === '-') {
    command = 'InsertUnorderedList';
  } else if (marker === '1' || marker === '1.') {
    command = 'InsertOrderedList';
  } else if (marker === '[]' || marker === '[ ]' || marker === '- [ ]') {
    command = 'Checklist';
  } else if (/^(?:- )?\[[xX]\]$/.test(marker)) {
    command = 'Checklist';
    checklistChecked = true;
  }
  if (!command) return;

  // Confirm the cursor is immediately after the marker, not before it.
  const beforeCursor = range.cloneRange();
  beforeCursor.selectNodeContents(block);
  beforeCursor.setEnd(range.startContainer, range.startOffset);
  if (beforeCursor.toString() !== marker) return;

  event.preventDefault();
  editor.undoManager.transact(() => {
    editor.dom.setHTML(block, '<br data-mce-bogus="1">');
    editor.selection.setCursorLocation(block, 0);
    if (command === 'Checklist') {
      applyChecklist(editor, checklistChecked);
    } else {
      editor.execCommand(command);
    }
  });
}

/**
 * Use Tab/Shift+Tab for structural indentation without allowing keyboard focus
 * to escape the editor. Table cells keep TinyMCE's native Tab navigation.
 */
function handleBlockIndentShortcut(editor: Editor, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab'
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || event.defaultPrevented
    || event.isComposing) {
    return false;
  }

  const selectionNode = editor.selection.getNode() as HTMLElement;
  if (selectionNode.closest('td,th,[contenteditable="false"]')) return false;

  const listItem = selectionNode.matches('li')
    ? selectionNode
    : selectionNode.closest('li');
  const block = editor.dom.getParent(
    selectionNode,
    'p,h1,h2,h3,h4,h5,h6,blockquote,div,pre',
  );
  if (!listItem && (!block || block === editor.getBody())) return false;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  editor.undoManager.transact(() => {
    editor.execCommand(event.shiftKey ? 'Outdent' : 'Indent');
  });
  editor.nodeChanged();
  return true;
}

function isOverCharLimit(): boolean {
  const body = tinymce.get(0).getBody();
  const text = tinymce.trim(body.innerText || body.textContent);
  return text.length > 1000000;
}

// user finished typing, save work
function doneTyping(): void {
  if (isOverCharLimit()) {
    alert('Too many characters!!! Cannot save properly!!!');
    return;
  }
  updateEntityBody();
}

// Object to hold control data for selected image
const tinymceEditImage = {
  selected: false,
  uploadId: 0,
  filename: 'unknown.png',
  reset: function(): void {
    this.selected = false;
    this.uploadId = 0;
    this.filename = 'unknown.png';
  },
};

// see issue about adding an interface for this object: https://github.com/tinymce/tinymce/issues/7982
interface TinyMCEBlobInfo {
  blob(): Blob;
  name(): string;
}

/**
 * This function handles image uploads dropped in the editor or uploaded with the Image plugin
 */
const imagesUploadHandler = (blobInfo: TinyMCEBlobInfo) => new Promise((resolve, reject) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dropzoneEl = document.getElementById('elabftw-dropzone') as any;
  const dropZone = dropzoneEl.dropzone;
  // when a file is added to dropZone (and uploaded), hook into the "complete" event
  // and reload uploadsDiv so we can grab the image url to replace the blob in the editor
  dropZone.on('complete', () => {
    if (dropZone.getUploadingFiles().length === 0 && dropZone.getQueuedFiles().length === 0) {
      reloadElements(['uploadsDiv']).then(() => {
        resolve(document.getElementById('last-uploaded-link').dataset.url);
      });
    }
  });
  // Edgecase for editing an image using tinymce ImageTools
  // Check if it was selected. This is set by an event hook below
  if (tinymceEditImage.selected === true) {
    // Note: confirm will trigger the SelectionChange event hook below again
    if (confirm(i18next.t('replace-edited-file'))) {
      const formData = new FormData();
      const newfilecontent = new File(
        [blobInfo.blob()],
        tinymceEditImage.filename,
        { lastModified: new Date().getTime(), type: blobInfo.blob().type },
      );
      formData.set('file', newfilecontent);
      // prevent the browser from redirecting us
      formData.set('extraParam', 'noRedirect');
      // because the upload id is set this will replace the file directly
      fetch(`api/v2/${entity.type}/${entity.id}/${Model.Upload}/${tinymceEditImage.uploadId}`, {
        method: 'POST',
        body: formData,
      }).then(resp => {
        const newId = getNewIdFromPostRequest(resp);
        // fetch info about the newly created upload
        return ApiC.getJson(`${entity.type}/${entity.id}/${Model.Upload}/${newId}`);
      }).then(json => {
        resolve(`app/download.php?f=${json.long_name}&storage=${json.storage}`);
        // save here because using the old real_name will not return anything from the db (status is archived now)
        updateEntityBody();
        reloadElements(['uploadsDiv']);
      });
    } else {
      // Revert changes if confirm is cancelled
      // ToDo: several times undo, e.g. if user rotated twice 90° but does not confirm the change
      tinymce.activeEditor.undoManager.undo();
      reject('Action cancelled');
    }
  // If the blob has no filename, ask for one. (Firefox edgecase: Embedded image in Data URL)
  } else if (typeof blobInfo.name() === 'undefined') {
    const filename = prompt('Enter filename with extension e.g. .jpeg');
    if (typeof filename !== 'undefined' && filename !== null) {
      const file = new File([blobInfo.blob()], filename, { lastModified: new Date().getTime(), type: blobInfo.blob().type }) as DropzoneFile;
      dropZone.addFile(file);
    } else {
      // Just disregard the edit if the name prompt is cancelled
      tinymce.activeEditor.undoManager.undo();
      reject('Action cancelled');
    }
  } else {
    dropZone.addFile(blobInfo.blob());
  }
});

/**
 * TinyMCE renders editable content in an iframe, so account palette variables
 * do not inherit from the eLabFTW page. Copy the resolved application palette
 * into the editor document to keep the writing surface coordinated too.
 */
function getEditorPaletteStyle(): string {
  const rootStyle = getComputedStyle(document.documentElement);
  const variableNames = [
    '--white',
    '--mainbackground',
    '--highlighted',
    '--superlight',
    '--firstlevel',
    '--secondlevel',
    '--thirdlevel',
    '--medium',
    '--mediumstrong',
    '--strongest',
    '--primary',
    '--secondary',
    '--secondary-muted',
    '--elabblue',
    '--lightblue',
    '--darkblue',
  ];
  const variables = variableNames
    .map(name => `${name}:${rootStyle.getPropertyValue(name).trim()}`)
    .join(';');
  return `:root{${variables}}html,body{background-color:var(--white);color:var(--strongest)}a{color:var(--primary)}`;
}

// options for tinymce to pass to tinymce.init()
export function getTinymceBaseConfig(page: string): object {
  let plugins = 'accordion advlist anchor autolink autoresize table searchreplace code fullscreen insertdatetime charmap lists save image media link pagebreak codesample template mention visualblocks visualchars emoticons preview';
  let toolbar1 = 'custom-save preview | undo redo | styles fontsize bold italic underline strikethrough | alignleft aligncenter alignright alignjustify | superscript subscript | bullist numlist checklist outdent indent | forecolor backcolor | charmap emoticons adddate horizontal-rule | codesample | link | inline-sheet table-properties cell-properties table-outdent table-indent sort-table';
  if (document.getElementById('documentTitle')) {
    toolbar1 = toolbar1.replace('adddate', 'experiment-title adddate');
  }
  let removedMenuItems = 'newdocument, image, anchor';
  let fileMenuItems = 'preview | print';
  if (page === 'edit') {
    fileMenuItems = 'restoredraft | saveAndGoBack ' + fileMenuItems;
    plugins += ' autosave';
    // add Image button in toolbar
    toolbar1 = toolbar1.replace('link |', 'link image |');
    // let Image in menu
    removedMenuItems = 'newdocument, anchor';
  }

  const isDark = document.documentElement.classList.contains('dark-mode');
  const templateEndpoint = (entity.type === EntityType.Experiment || entity.type === EntityType.Template)
    ? EntityType.Template
    : EntityType.ItemType;

  return {
    selector: '.mceditable',
    table_default_styles: {
      'min-width':'25%',
    },
    // The table width is changed when manipulating columns, the size of other columns is maintained.
    table_column_resizing: 'resizetable',
    browser_spellcheck: true,
    // location of the skin directory
    skin_url: isDark ? '/assets/tinymce_skins_dark' : '/assets/tinymce_skins',
    skin: isDark ? 'oxide-dark' : 'oxide',
    content_css: isDark ? ['/assets/tinymce_skins/content/dark/content.min.css', '/assets/tinymce_content.min.css'] : ['/assets/tinymce_content.min.css'],
    content_style: getEditorPaletteStyle(),
    emoticons_database_url: 'assets/tinymce_emojis.js',
    // remove the "Upgrade" button
    promotion: false,
    autoresize_bottom_margin: 50,
    // autoresize plugin will disallow manually resizing, but setting resize to true will make the scrollbar disappear
    //resize: true,
    plugins: plugins,
    // A custom handler below also supports paragraphs/headings and keeps focus
    // inside the editor, so disable the lists plugin's overlapping Tab handler.
    lists_indent_on_tab: false,
    pagebreak_split_block: true,
    pagebreak_separator: '<div class="page-break"></div>',
    toolbar1: toolbar1,
    // this addresses CVE-2024-29881, it defaults to true in 7.0, so can be removed in tiny 7.0 TODO
    convert_unsafe_embeds: true,
    // Keep TinyMCE's general heading/format text patterns disabled. Focused
    // list shortcuts are implemented in setup() below.
    text_patterns: false,
    removed_menuitems: removedMenuItems,
    image_caption: true,
    images_reuse_filename: false, // if set to true the src url gets a date appended
    images_upload_credentials: true,
    images_upload_handler: imagesUploadHandler,
    // use undocumented callback function to asynchronously get the templates
    // see https://github.com/tinymce/tinymce/issues/5637#issuecomment-624982699
    templates: (callback): void => {
      ApiC.getJson(templateEndpoint).then(json => {
        const res = [];
        json.forEach(tpl => {
          res.push({'title': tpl.title, 'description': '', 'content': tpl.body});
        });
        callback(res);
      });
    },
    contextmenu: false,
    paste_data_images: Boolean(page === 'edit'),
    // use the preprocessing function on paste event to fix the bgcolor attribute from libreoffice into proper background-color style
    paste_preprocess: function(plugin, args) {
      args.content = args.content.replaceAll('bgcolor="', 'style="background-color:');
    },
    // also add it to Filter.php in Attr.AllowedClasses
    codesample_languages: [
      {text: 'Bash', value: 'bash'},
      {text: 'C', value: 'c'},
      {text: 'C++', value: 'cpp'},
      {text: 'CSS', value: 'css'},
      {text: 'Diff', value: 'diff'},
      {text: 'Fortran', value: 'fortran'},
      {text: 'Go', value: 'go'},
      {text: 'Igor', value: 'igor'},
      {text: 'Java', value: 'java'},
      {text: 'JavaScript', value: 'javascript'},
      {text: 'Json', value: 'json'},
      {text: 'Julia', value: 'julia'},
      {text: 'Latex', value: 'latex'},
      {text: 'Lua', value: 'lua'},
      {text: 'Makefile', value: 'makefile'},
      {text: 'Matlab', value: 'matlab'},
      {text: 'Perl', value: 'perl'},
      {text: 'Python', value: 'python'},
      {text: 'R', value: 'r'},
      {text: 'Ruby', value: 'ruby'},
      {text: 'Rust', value: 'rust'},
      {text: 'SQL', value: 'sql'},
      {text: 'Tcl', value: 'tcl'},
      {text: 'VHDL', value: 'vhdl'},
      {text: 'YAML', value: 'yaml'},
    ],
    codesample_global_prismjs: true,
    language: document.getElementById('user-prefs').dataset.lang,
    charmap_append: [
      [0x2640, 'female sign'],
      [0x2642, 'male sign'],
      [0x25A1, 'white square'],
      [0x2702, 'black scissors'],
      [0x21BB, 'clockwise open circle arrow'],
    ],
    height: '500',
    mentions: {
      // use # for autocompletion
      delimiter: ['#'],
      // get the source from json with get request
      source: function(query: string, process: (data) => void): void {
        query = escapeExtendedQuery(query);
        if (query.length < 1) {
          return;
        }
        // grab experiments and items
        const expjson = ApiC.getJson(`${EntityType.Experiment}?limit=12&scope=3&fastq=${query}`);
        const itemjson = ApiC.getJson(`${EntityType.Item}?limit=12&scope=3&fastq=${query}`);
        // and merge them into one
        Promise.all([expjson, itemjson]).then(values => {
          process(values[0].concat(values[1]));
        });
      },
      insert: function(selected): string {
        const endpoint = selected.type === 'items' ? 'items_links' : 'experiments_links';
        ApiC.post(`${entity.type}/${entity.id}/${endpoint}/${selected.id}`)
          .then(() => reloadElements(['linksDiv']));
        const category = selected.category_title ? `${selected.category_title} - `: '';
        return `<span><a href='${selected.page}?mode=view&id=${selected.id}'>${category}${selected.title}</a></span>`;
      },
    },
    mobile: {
      plugins: [ 'autolink', 'image', 'link', 'lists', 'save', 'table', 'mention' ],
    },
    // use a custom function for the save button in toolbar
    save_onsavecallback: (): Promise<void> => updateEntityBody(),
    // keyboard shortcut to insert today's date at cursor in editor
    menu: {
      file: { title: 'File', items: fileMenuItems },
    },
    setup: (editor: Editor): void => {
      const tableIndentation = new TableIndentation(editor);
      const dateReferenceEditor = new DateReferenceEditor(editor);
      const experimentTitleEditor = new ExperimentTitleEditor(editor);
      editor.on('init', () => dateReferenceEditor.normalizeReferences());
      editor.on('init', () => normalizeChecklists(editor));
      // holds the timer setTimeout function
      let typingTimer;
      // use event SkinLoaded instead of init so we're sure skinNode is present
      editor.on('SkinLoaded', () => {
        // prevent skin.min.css from changing appearance of .mce-preview-body element
        const skinNode = document.querySelector('[rel=stylesheet][href$="/skin.min.css"]') as HTMLLinkElement;
        const skinCSS = skinNode.sheet;
        Array.from(skinCSS.cssRules).forEach((rule, index) => {
          if (rule instanceof CSSStyleRule) {
            const selectors = rule.selectorText.split(',');
            const modifiedSelectors = selectors.map((selector) => selector.trim() + ':not(.mce-preview-body *)').join(',');
            rule.selectorText = modifiedSelectors;
            skinCSS.deleteRule(index);
            skinCSS.insertRule(rule.cssText, index);
          }
        });
      });
      // set default line height to 1 (is 1.4 for some reason)
      editor.on('init', () => {
        // doing this will give focus to the editor, which is OK for entities but on admin page it's not wanted, so avoid it
        if (page !== 'admin' && page !== 'sysconfig') {
          editor.execCommand('lineheight', false, '1');
        }
      });
      // Hook into the blur event - Finalize potential changes to images if user clicks outside of editor
      editor.on('blur', () => {
        // this will trigger the images_upload_handler event hook defined further above
        editor.uploadImages();
      });
      // Hook into the SelectionChange event - This is to make sure we reset our control variable correctly
      editor.on('SelectionChange', () => {
        // Check if the user has selected an image
        if (editor.selection.getNode().tagName === 'IMG') {
          tinymceEditImage.selected = true;
          // Save all the details needed for replacing upload
          // Then check for and get those details when you are handling file uploads
          const selectedImage = (editor.selection.getNode() as HTMLImageElement);
          const searchParams = new URL(selectedImage.src).searchParams;
          // Get all the uploads from that entity
          ApiC.getJson(`${entity.type}/${entity.id}/${Model.Upload}`).then(json => {
            // Now find the one corresponding to the image selected in the body
            const upload = json.find(upload => upload.long_name === searchParams.get('f'));
            if (!upload) {
              return;
            }
            // Get id and filename (real_name) from this
            // this allows us to know which corresponding upload is selected so we can replace it if needed (after a crop for instance)
            tinymceEditImage.uploadId = upload.id;
            tinymceEditImage.filename = upload.real_name;
          });
        } else if (tinymceEditImage.selected === true) {
          // delay reset a bit so that images_upload_handler gets called first and can finish
          setTimeout(() => {
            tinymceEditImage.reset();
          }, 50);
        }
      });
      editor.on('GetContent', (e) => {
        // prevent tables width from being set to "auto" and cause pdf export issues (see #5601)
        e.content = e.content.replace(/(<table[^>]*?)\sstyle="[^"]*?width\s*:\s*auto;?[^"]*?"([^>]*?>)/gi, '$1$2');
        // fix internal links on pasting with shortcut (&amp; → &). see #6291
        e.content = e.content.replace(/href="([^"]*\.php\?mode=(?:view|edit)[^"]*?)&amp;([^"]*?)"/g, 'href="$1&$2"');
      });

      // floppy disk icon from COLLECTION: Zest Interface Icons LICENSE: MIT License AUTHOR: zest
      editor.ui.registry.addIcon('customSave', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 5a1 1 0 0 1 1-1h2v3a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4h.172a1 1 0 0 1 .707.293l2.828 2.828a1 1 0 0 1 .293.707V19a1 1 0 0 1-1 1h-1v-7a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v7H5a1 1 0 0 1-1-1V5Zm4 15h8v-6H8v6Zm6-16H9v2h5V4ZM5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7.828a3 3 0 0 0-.879-2.12l-2.828-2.83A3 3 0 0 0 16.172 2H5Z" /></svg>'), // eslint-disable-line

      // Semantic dates retain a stable anchor and can link to another
      // experiment. Keep the original timestamp action in the same menu.
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
      editor.ui.registry.addButton('custom-save', {
        icon: 'customSave',
        tooltip: 'Save',
        onAction: function() {
          editor.execCommand('mceSave');
        },
      });
      editor.ui.registry.addIcon(
        'elabftwChecklist',
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="2"/><path d="m4.5 7 1.5 1.5L8 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7h9M12 17h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="2"/></svg>',
      );
      editor.ui.registry.addToggleButton('checklist', {
        icon: 'elabftwChecklist',
        tooltip: 'Checklist ([ ] then Space)',
        onAction: () => toggleChecklist(editor),
        onSetup: api => {
          const update = (): void => {
            api.setActive(Boolean(checklistFromSelection(editor)));
          };
          editor.on('NodeChange', update);
          update();
          return () => editor.off('NodeChange', update);
        },
      });
      // save and go back button for toolbar, inside "File" menu.
      editor.ui.registry.addMenuItem('saveAndGoBack', {
        text: i18next.t('save-and-go-back'),
        icon: 'customSave',
        onAction: () => {
          const btn = document.querySelector('[data-action="update-entity-body"][data-redirect="view"]') as HTMLButtonElement;
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          btn ? btn.click() : editor.execCommand('mceSave');
        },
      });
      editor.ui.registry.addButton('table-outdent', {
        icon: 'outdent',
        tooltip: 'Outdent table',
        onAction: () => tableIndentation.outdentSelectedTable(),
        onSetup: api => {
          const update = (event): void => {
            const table = tableIndentation.trackSelectedTable(event.element);
            api.setEnabled(tableIndentation.canOutdent(table));
          };
          api.setEnabled(tableIndentation.canOutdent(tableIndentation.trackSelectedTable()));
          editor.on('NodeChange', update);
          return () => editor.off('NodeChange', update);
        },
      });
      editor.ui.registry.addButton('table-indent', {
        icon: 'indent',
        tooltip: 'Indent table to align with nested bullets',
        onAction: () => tableIndentation.indentSelectedTable(),
        onSetup: api => {
          const update = (event): void => {
            const table = tableIndentation.trackSelectedTable(event.element);
            api.setEnabled(tableIndentation.canIndent(table));
          };
          api.setEnabled(tableIndentation.canIndent(tableIndentation.trackSelectedTable()));
          editor.on('NodeChange', update);
          return () => editor.off('NodeChange', update);
        },
      });
      editor.ui.registry.addButton('cell-properties', {
        text: 'Cell style',
        tooltip: 'Cell background, border style, color and width',
        onAction: () => editor.execCommand('mceTableCellProps'),
        onSetup: api => {
          const update = (event): void => {
            api.setEnabled(Boolean(event.element?.closest?.('td,th')));
          };
          api.setEnabled(Boolean(editor.selection.getNode().closest?.('td,th')));
          editor.on('NodeChange', update);
          return () => editor.off('NodeChange', update);
        },
      });
      editor.ui.registry.addButton('table-properties', {
        text: 'Table style',
        tooltip: 'Table size, alignment, border, background, spacing and caption',
        onAction: () => editor.execCommand('mceTableProps'),
        onSetup: api => {
          const update = (event): void => {
            api.setEnabled(Boolean(event.element?.closest?.('table')));
          };
          api.setEnabled(Boolean(editor.selection.getNode().closest?.('table')));
          editor.on('NodeChange', update);
          return () => editor.off('NodeChange', update);
        },
      });
      const openInlineSpreadsheet = (
        initial: SpreadsheetData,
        existingTable: HTMLTableElement | null = null,
      ): void => {
        const bookmark = editor.selection.getBookmark(2, true);
        openSpreadsheetModal(initial).then(({ raw, computed }) => {
          const html = spreadsheetToHTML(raw, computed);
          editor.focus();
          editor.selection.moveToBookmark(bookmark);
          if (existingTable) {
            editor.selection.select(existingTable);
          }
          editor.execCommand('mceInsertContent', false, html);
          editor.undoManager.add();
        }).catch(() => {
          // User cancelled — do nothing
        });
      };

      // INLINE SPREADSHEET — expose every layout directly from the toolbar.
      editor.ui.registry.addMenuButton('inline-sheet', {
        icon: 'table',
        text: 'Spreadsheet',
        tooltip: 'Insert or edit a formula spreadsheet',
        fetch: callback => {
          const existingTable = editor.selection.getNode()
            .closest('table.elabftw-spreadsheet') as HTMLTableElement | null;
          const items = [];
          if (existingTable) {
            items.push({
              type: 'menuitem' as const,
              text: 'Edit selected spreadsheet',
              onAction: () => openInlineSpreadsheet(extractFromTable(existingTable), existingTable),
            });
            items.push({ type: 'separator' as const });
          }

          items.push(
            {
              type: 'menuitem' as const,
              text: 'Custom size…',
              onAction: () => openInlineSpreadsheet(emptySpreadsheetData(), existingTable),
            },
            {
              type: 'menuitem' as const,
              text: 'Benchling-style data table',
              onAction: () => openInlineSpreadsheet(createNotebookSpreadsheetData(), existingTable),
            },
            {
              type: 'nestedmenuitem' as const,
              text: 'Well plate',
              getSubmenuItems: () => WELL_PLATE_PRESETS.map(preset => ({
                type: 'menuitem' as const,
                text: `${preset.wells}-well plate (${preset.rows} × ${preset.cols})`,
                onAction: () => openInlineSpreadsheet(
                  createWellPlateSpreadsheetData(preset.wells),
                  existingTable,
                ),
              })),
            },
          );
          callback(items);
        },
      });
      // Double-click on a spreadsheet table opens the editor
      editor.on('dblclick', (e) => {
        const target = (e.target as HTMLElement).closest('table.elabftw-spreadsheet') as HTMLTableElement;
        if (!target) return;
        openInlineSpreadsheet(extractFromTable(target), target);
      });
      editor.on('click', event => handleChecklistClick(editor, event));

      // some shortcuts
      editor.addShortcut('ctrl+shift+d', 'add date/time at cursor', addDatetimeOnCursor);
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
      editor.on('init', () => {
        // Capture Tab before TinyMCE or the browser can move focus to the next control.
        const editorDocument = editor.getDoc();
        const blockIndentHandler = (event: KeyboardEvent): void => {
          handleBlockIndentShortcut(editor, event);
        };
        const excelPasteHandler = (event: ClipboardEvent): void => {
          const clipboard = event.clipboardData;
          if (!clipboard) return;
          const spreadsheet = spreadsheetFromClipboard(
            clipboard.getData('text/html'),
            clipboard.getData('text/plain'),
          );
          if (!spreadsheet) return;

          event.preventDefault();
          event.stopImmediatePropagation();
          editor.undoManager.transact(() => {
            editor.insertContent(spreadsheetToHTML(spreadsheet, spreadsheet.data));
          });
        };
        editorDocument.addEventListener('keydown', blockIndentHandler, true);
        editorDocument.addEventListener('paste', excelPasteHandler, true);
        editor.on('remove', () => {
          editorDocument.removeEventListener('keydown', blockIndentHandler, true);
          editorDocument.removeEventListener('paste', excelPasteHandler, true);
        });
      });
      let tocHeadingSignature = '';
      const notifyTocHeadingChanges = (): void => {
        const signature = Array.from(editor.getBody().querySelectorAll('h1, h2, h3, h4, h5, h6'))
          .map(heading => `${heading.tagName}:${heading.textContent?.trim() ?? ''}`)
          .join('|');
        if (signature === tocHeadingSignature) return;
        tocHeadingSignature = signature;
        window.dispatchEvent(new CustomEvent('editor-headings-changed'));
      };
      editor.on('init', notifyTocHeadingChanges);
      editor.on('NodeChange', notifyTocHeadingChanges);
      editor.on('NodeChange', () => normalizeChecklists(editor));
      editor.on('keydown', event => {
        if (handleBlockIndentShortcut(editor, event)) return;
        handleListShortcut(editor, event);
      });

      // on edit page there is an autosave triggered
      if (page === 'edit') {
        editor.on('keydown', () => clearTimeout(typingTimer));
        editor.on('keyup', () => {
          clearTimeout(typingTimer);
          typingTimer = setTimeout(doneTyping, doneTypingInterval);
        });
      }

      // sort down icon from COLLECTION: Dazzle Line Icons LICENSE: CC Attribution License AUTHOR: Dazzle UI
      editor.ui.registry.addIcon('sort-amount-down-alt', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 12h8m-8-4h8m-8 8h8M6 7v10m0 0-3-3m3 3 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'), // eslint-disable-line
      // add toggle button for table sorting
      editor.ui.registry.addToggleButton('sort-table', {
        icon: 'sort-amount-down-alt',
        tooltip: 'sortable table',
        onAction: api => {
          const table = editor.selection.getNode().closest('table');
          if (table) {
            if (api.isActive()) {
              // unset sortable
              delete table.dataset.tableSort;
              api.setActive(false);
            } else {
              // show alert if table is not sortable
              if (!isSortable(table, true)) {
                editor.focus();
                return;
              }
              // set sortable
              table.dataset.tableSort = 'true';
              // here the top row could be reformatted automatically td -> th
              api.setActive(true);
            }
            editor.undoManager.add();
          }
          editor.focus();
        },
        onSetup: api => {
          // button is enabled only if table is selected
          // button is active (highlighted) only if table is set sortable
          api.setEnabled(false);

          const callback = event => {
            const table = event.element.closest('table');
            if (!table) {
              api.setEnabled(false);
              api.setActive(false);
              return;
            }

            // table is selected, enable button
            api.setEnabled(true);
            if (table.dataset.tableSort === 'true') {
              // table is set sortable, highlight button
              api.setActive(true);
              return;
            }
            api.setActive(false);
          };

          editor.on('NodeChange', callback);

          return () => {
            editor.off('NodeChange', callback);
          };
        },
      });
    },
    style_formats_merge: true,
    style_formats: [
      {
        title: 'Image Left',
        selector: 'img',
        styles: {
          'float': 'left',
          'margin': '0 10px 0 10px',
        },
      }, {
        title: 'Image Right',
        selector: 'img',
        styles: {
          'float': 'right',
          'margin': '0 0 10px 10px',
        },
      },
    ],
    toolbar_sticky: true,
    // Keep TinyMCE's sticky formatting toolbar below the main navigation and
    // the entity action bar.
    toolbar_sticky_offset:
      (document.querySelector<HTMLElement>('#container > nav.navbar')?.offsetHeight ?? 0)
      + (document.getElementById('topToolbar')?.offsetHeight ?? 0),
    // render MathJax for TinyMCE preview
    init_instance_callback: (editor) => {
      editor.on('ExecCommand', (e) => {
        if (e.command == 'mcePreview') {
          // declaration as iFrame element required to avoid errors with getting srcdoc property
          const iframe = (document.querySelector('iframe.tox-dialog__iframe') as HTMLIFrameElement);
          if (iframe) {
            iframe.onload = () => {
              const tinyDiv = document.createElement('div');
              tinyDiv.setAttribute('class', 'mce-content-body mce-preview-body');
              iframe.contentDocument.body.childNodes.forEach((node) => {
                tinyDiv.append(node);
              });
              // iframe replaced with div element because MathJax otherwise doesn't render menus properly; see #5295
              iframe.replaceWith(tinyDiv);
              MathJax.typesetPromise();
            };
          }
        }
      });
    },
  };
}
