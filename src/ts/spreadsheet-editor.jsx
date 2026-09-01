/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @author Moustapha <Deltablot>
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

/**
 * Code related to the excel tables present on the view/edit pages of an entity
 * Jspreadsheet-CE integration
 */

import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Spreadsheet, Worksheet } from "@jspreadsheet-ce/react";
import "jsuites/dist/jsuites.css";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import i18next from './i18n';
import { fileToWorksheets, replaceAttachment, saveAsAttachment, getHtmlClipboardTable, extractHtmlCellStyles, columnIndexToLetters } from './spreadsheet-utils';
import { getEntity } from './misc';
import { assignKey } from './keymaster';
import { notify } from './notify';

function SpreadsheetEditor() {
  const spreadsheetRef = useRef(null);
  // disable keyboard shortcuts completely
  assignKey.filter = () => false;

  const [worksheets, setWorksheets] = useState([{ name: 'Sheet1', data: [[]] }]);
  const [currentUploadId, setCurrentUploadId] = useState(0);
  const [replaceName, setReplaceName] = useState(null);
  // loading state to prevent spamming save btn
  const [isSaving, setIsSaving] = useState(false);

  // refs that always have the latest values (for toolbar onclick)
  const replaceIdRef = useRef(null);
  const replaceNameRef = useRef(null);
  const isDirtyRef = useRef(false);
  const isSavingRef = useRef(false);

  useEffect(() => { replaceIdRef.current = currentUploadId; }, [currentUploadId]);
  useEffect(() => { replaceNameRef.current = replaceName; }, [replaceName]);

  // @jspreadsheet-ce/react initializes only while the forwarded reference is
  // empty. A keyed remount removes the old DOM but the wrapper does not clear
  // that external reference itself, so explicitly release it before loading
  // a differently shaped workbook.
  const replaceWorkbook = (nextWorksheets) => {
    spreadsheetRef.current = null;
    setWorksheets(nextWorksheets);
  };
  // on changes in the spreadsheet, notify that there's unsaved changes
  const setUnsavedWarning = (visible) => {
    isDirtyRef.current = visible;
    const unsavedChangesWarning = window.parent.document.getElementById('spreadsheetEditorUnsavedChanges');
    if (unsavedChangesWarning) {
      unsavedChangesWarning.hidden = !visible;
    }
  };

  const markUnsaved = () => setUnsavedWarning(true);

  // if Dirty state, ask user if he wants to save before leaving the page
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!isDirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };
    window.parent.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.parent.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // PASTE FORMATTING
  // jspreadsheet-ce's built-in paste only ever carries values (styles are a
  // Pro-only feature upstream). We capture the clipboard's raw HTML table
  // ourselves (Excel/LibreOffice always include one alongside plain text) in
  // the capture phase of the native paste event, before jspreadsheet-ce's own
  // paste handler consumes it, then re-apply the extracted per-cell styles
  // via setStyle() once jspreadsheet-ce's onpaste event tells us where the
  // pasted values actually landed.
  const pendingPasteStylesRef = useRef(null);
  useEffect(() => {
    const onNativePaste = (event) => {
      try {
        const html = getHtmlClipboardTable(event);
        // eslint-disable-next-line no-console
        console.debug('[paste-debug] native paste event fired. html length:', html?.length ?? 0);
        pendingPasteStylesRef.current = html ? extractHtmlCellStyles(html) : null;
        // eslint-disable-next-line no-console
        console.debug('[paste-debug] extracted style grid:', pendingPasteStylesRef.current);
      } catch (e) {
        // best-effort only: if parsing fails, just fall back to values-only paste
        // eslint-disable-next-line no-console
        console.debug('[paste-debug] extraction threw:', e);
        pendingPasteStylesRef.current = null;
      }
    };
    // capture phase so this runs before jspreadsheet-ce's own paste listener
    document.addEventListener('paste', onNativePaste, true);
    return () => document.removeEventListener('paste', onNativePaste, true);
  }, []);

  // called by jspreadsheet-ce after it has applied a paste, with the actual
  // (x, y) coordinates each pasted cell landed on
  const onPasteStyles = (_instance, pastedInfo) => {
    // eslint-disable-next-line no-console
    console.debug('[paste-debug] onpaste fired. pastedInfo:', pastedInfo);
    const styles = pendingPasteStylesRef.current;
    pendingPasteStylesRef.current = null;
    if (!styles || !pastedInfo?.length) {
      // eslint-disable-next-line no-console
      console.debug('[paste-debug] bailing out. styles present?', !!styles, 'pastedInfo present?', !!pastedInfo?.length);
      return;
    }
    const cellStyles = {};
    for (let r = 0; r < pastedInfo.length; r++) {
      const styleRow = styles[r];
      if (!styleRow) continue;
      for (let c = 0; c < pastedInfo[r].length; c++) {
        const style = styleRow[c];
        if (!style) continue;
        const { x, y } = pastedInfo[r][c];
        cellStyles[`${columnIndexToLetters(x)}${y + 1}`] = style;
      }
    }
    // eslint-disable-next-line no-console
    console.debug('[paste-debug] computed cellStyles:', cellStyles, 'instance available?', !!spreadsheetRef.current?.[0]);
    if (Object.keys(cellStyles).length) {
      spreadsheetRef.current?.[0]?.setStyle?.(cellStyles);
    }
  };

  const getWorksheets = () => worksheets.map((worksheet, index) => ({
    name: spreadsheetRef.current?.[index]?.options?.worksheetName || worksheet.name,
    data: spreadsheetRef.current?.[index]?.getData?.() ?? worksheet.data,
  }));
  const entity = getEntity(true);

  // keep tracking the latest upload info
  const keepResult = (res) => {
    if (!res) return;
    if (res.id) setCurrentUploadId(res.id);
    if (res.name) setReplaceName(res.name);
  };

  const onSaveOrReplace = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      const currentWorksheets = getWorksheets();
      const replaceId = replaceIdRef.current;
      const replaceName = replaceNameRef.current;
      let res;
      if (replaceId && replaceName) {
        // REPLACE MODE
        res = await replaceAttachment(currentWorksheets, entity.type, entity.id, replaceId, replaceName);
      } else {
        // SAVE MODE
        res = await saveAsAttachment(currentWorksheets, entity.type, entity.id);
      }
      if (!res) return;
      keepResult(res);
      setUnsavedWarning(false);
    } finally {
      window.parent.postMessage('uploadsDiv', window.location.origin);
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  // Copy the current workbook into TinyMCE as formula-enabled inline tables.
  // The parent owns the editor instance and performs the HTML conversion so
  // this standalone bundle stays independent from the main editor modules.
  const insertInMainText = () => {
    window.parent.postMessage({
      type: 'jss-insert-main-text',
      detail: { worksheets: getWorksheets() },
    }, window.location.origin);
  };

  // load an attachment into the editor, capture filename & id
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'jss-load-workbook' || event.data?.type === 'jss-load-aoa') {
        const { worksheets: loadedWorksheets, aoa, name, uploadId } = event.data.detail || {};
        replaceWorkbook(loadedWorksheets?.length
          ? loadedWorksheets
          : [{ name: 'Sheet1', data: aoa?.length ? aoa : [[]] }]);
        setReplaceName(name ?? null);
        setCurrentUploadId(typeof uploadId === 'number' ? uploadId : null);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /* actions (import, save, replace) included in the toolbar */
  // import a new file from computer
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const importedWorksheets = await fileToWorksheets(file);
    replaceWorkbook(importedWorksheets);
    // clear any current spreadsheet id tracking
    setCurrentUploadId(null);
    setReplaceName(null);
    // clear input too
    e.target.value = '';
  };

  const clearSpreadsheet = () => {
    if (!window.confirm(i18next.t('confirm-clear-spreadsheet'))) return;
    const inst = spreadsheetRef.current?.[0];
    const empty = [{ name: 'Sheet1', data: [[]] }];
    inst?.setData?.(empty[0].data);
    setWorksheets(empty);
    setCurrentUploadId(null);
    setReplaceName(null);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => notify.error(err));
    } else {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(err => notify.error(err));
      }
    }
  };
  // CUSTOM TOOLBAR ICONS (they are placed at the end)
  const buildToolbar = (tb) => {
    try {
      // we will replace the save button with ours, and add an export button that has the same behavior as default save button
      const saveBtn = tb.items.find(it => it.content === 'save');
      const originalSave = saveBtn && typeof saveBtn.onclick === 'function' ? saveBtn.onclick : null;
      // Remove CE controls whose state cannot be serialized, using their
      // semantic identifiers rather than brittle array positions.
      const unsupportedContent = new Set([
        'format_bold',
        'format_color_text',
        'format_color_fill',
        'fullscreen',
      ]);
      tb.items = tb.items.filter(item => item.type !== 'select' && !unsupportedContent.has(item.content));

      const exportBtn = {
        type: 'icon',
        class: 'ml-2 fas fa-download',
        tooltip: i18next.t('export'),
        // reuse the same handler signature (itemEl, event, spreadsheetInstance)
        onclick: (el, ev, inst) => originalSave?.(el, ev, inst),
      };
      // we render the spreadsheet in an iframe, so we'll also use a custom fullscreen button
      const fullscreenBtn = { type: 'icon', class: 'mx-2 fas fa-expand', tooltip: i18next.t('fullscreen'), onclick: () => toggleFullscreen()};
      const clearBtn = { type: 'icon', class: 'ml-2 fas fa-trash', tooltip: i18next.t('clear'), onclick: clearSpreadsheet };
      const importBtn = { type: 'icon', class: 'fas fa-upload', tooltip: i18next.t('import'), onclick: () => document.getElementById('importFileInput').click() };
      const insertInMainTextBtn = {
        type: 'icon',
        class: 'ml-2 fas fa-file-import',
        tooltip: 'Insert workbook into main text',
        onclick: insertInMainText,
      };
      // replace original save & fullscreen buttons with our custom functions
      if (saveBtn) {
        Object.assign(saveBtn, {
          content: '',
          type: 'icon',
          class: 'ml-2 fas fa-floppy-disk',
          tooltip: i18next.t('save-attachment'),
          onclick: onSaveOrReplace,
        });
      }

      tb.items.push(fullscreenBtn, importBtn, insertInMainTextBtn, exportBtn, clearBtn);
      return tb;
    } catch (error) {
      console.error('Could not customize spreadsheet toolbar, using default:', error);
      return tb;
    }
  };
  // pass a dynamic key to force SpreadsheetInner to remount when data shape changes
  const spreadsheetKey = worksheets
    .map(worksheet => `${worksheet.name}:${worksheet.data.length}:${worksheet.data[0]?.length || 0}`)
    .join('|');

  return (
    <>
      <input hidden type='file' accept='.xlsx,.csv,.ods' onChange={handleImportFile} id='importFileInput' name='file' />
      {/* move Spreadsheet into a child component to safely re-init on file uploads */}
      <SpreadsheetInner key={spreadsheetKey} worksheets={worksheets} buildToolbar={buildToolbar} onSpreadsheetChange={markUnsaved} onPasteStyles={onPasteStyles} spreadsheetRef={spreadsheetRef} />
    </>
  );
}
function SpreadsheetInner({ worksheets, buildToolbar, onSpreadsheetChange, onPasteStyles, spreadsheetRef }) {
  return (
    <Spreadsheet ref={spreadsheetRef} tabs={true} toolbar={buildToolbar} onchange={onSpreadsheetChange} onpaste={onPasteStyles}>
      {worksheets.map((worksheet, index) => (
        <Worksheet
          key={`${worksheet.name}-${index}`}
          data={worksheet.data}
          worksheetName={worksheet.name}
          minDimensions={[
            Math.max(12, worksheet.data[0]?.length || 0),
            Math.max(12, worksheet.data.length),
          ]}
        />
      ))}
    </Spreadsheet>
  );
}

const el = document.getElementById('spreadsheetEditorRoot');
if (el) {
  const root = createRoot(el);
  root.render(<SpreadsheetEditor />);
}
