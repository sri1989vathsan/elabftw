/**
 * The sequence editor of an entry of the database: opens the sequence file attached to the entry in the Open Vector Editor.
 * Who can write the entry edits the sequence, the changes are saved as a new version of the file (the previous version is
 * kept as an archived file of the entry); the others see it read only.
 * Opened with ?entry=<entry id>&upload=<upload id>&f=<long name>&name=<real name>&storage=<storage>
 */
(function () {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const body = document.body.dataset;
  const status = document.getElementById('status');
  const saveState = document.getElementById('save-state');
  const fileName = params.get('name') || 'sequence';
  const entryId = Number(body.entry) || 0;
  const canWrite = body.canWrite === '1';
  // after a save the file to replace is the new version, and a SnapGene file is saved as a GenBank file next to it
  let uploadId = Number(body.upload) || 0;
  let saveName = fileName;
  const AUTOSAVE_AFTER_MS = 3000;
  const WATCH_EVERY_MS = 1000;

  document.title = fileName + ' - Sequence editor';
  document.getElementById('title').textContent = fileName;

  function fail(message) {
    status.textContent = message;
    status.className = 'error';
  }

  function setSaveState(text, kind) {
    saveState.textContent = text;
    saveState.className = kind || '';
  }

  // the format of the file decides how it is written back
  function serialize(sequenceData) {
    if (/\.(fasta|fa|fna)$/i.test(saveName)) {
      return window.bioParsers.jsonToFasta(sequenceData);
    }
    return window.bioParsers.jsonToGenbank(sequenceData);
  }

  async function saveSequence(sequenceData) {
    if (!canWrite || !entryId) {
      return;
    }
    setSaveState('Saving...', '');
    const text = serialize(sequenceData);
    const form = new FormData();
    form.append('file', new File([text], saveName, { type: 'text/plain' }));
    let url = '../api/v2/inventory/' + entryId + '/uploads';
    if (uploadId > 0) {
      // the previous version of the file stays in the history of the entry as an archived file
      url += '/' + uploadId;
      form.append('action', 'replace');
    }
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': body.csrf },
      body: form,
    });
    if (!response.ok) {
      throw new Error('The sequence could not be saved (' + response.status + ').');
    }
    const location = response.headers.get('Location') || '';
    const newId = Number(location.split('/').pop());
    if (newId > 0) {
      uploadId = newId;
    }
  }

  async function load() {
    const download = new URLSearchParams({ f: params.get('f') || '', name: fileName, storage: params.get('storage') || '1' });
    if (params.get('access_key')) {
      download.set('access_key', params.get('access_key'));
    }
    const response = await fetch('../app/download.php?' + download.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error('The file could not be downloaded (' + response.status + ').');
    }
    // SnapGene files are binary, the other formats are text
    const isSnapgene = /\.dna$/i.test(fileName);
    const input = isSnapgene ? new File([await response.blob()], fileName) : await response.text();
    const results = await window.bioParsers.anyToJson(input, { fileName: fileName });
    const result = Array.isArray(results) ? results[0] : results;
    if (!result || !result.success || !result.parsedSequence) {
      const messages = (result && result.messages ? result.messages : []).join(' ');
      throw new Error('This file could not be read as a sequence. ' + messages);
    }
    if (isSnapgene) {
      // a SnapGene file cannot be written back: the changes go to a GenBank file of the same name, next to it
      saveName = fileName.replace(/\.dna$/i, '') + '.gb';
      uploadId = 0;
    }
    status.className = 'hidden';

    // what the editor holds once it has loaded the file is the starting point: only later changes are saved
    let lastSaved = '';
    let lastSeen = '';
    let ready = false;
    let timer = 0;
    let saving = false;

    const editor = window.createVectorEditor(document.getElementById('root'), {
      editorName: 'sequence-editor',
      showMenuBar: true,
      readOnly: !canWrite,
      onSave: function (opts, sequenceData) {
        saveNow(sequenceData);
      },
    });
    // kept reachable for tests and for the browser console
    window.sequenceEditor = editor;
    editor.updateEditor({
      sequenceData: result.parsedSequence,
      readOnly: !canWrite,
      annotationVisibility: { features: true, cutsites: true, orfs: false },
    });

    async function saveNow(sequenceData) {
      if (saving) {
        return;
      }
      window.clearTimeout(timer);
      const data = sequenceData || editor.getState().sequenceData;
      const snapshot = JSON.stringify(data);
      saving = true;
      try {
        await saveSequence(data);
        lastSaved = snapshot;
        const now = new Date();
        const saved = isSnapgene ? 'Saved as ' + saveName : 'Saved';
        setSaveState(saved + ' ' + now.toLocaleTimeString(), 'saved');
      } catch (error) {
        setSaveState(error.message || String(error), 'failed');
      } finally {
        saving = false;
      }
    }

    if (!canWrite) {
      setSaveState('Read only: you cannot edit this entry', '');
      return;
    }
    setSaveState('No changes yet', '');
    window.setTimeout(function () {
      lastSaved = JSON.stringify(editor.getState().sequenceData);
      lastSeen = lastSaved;
      ready = true;
    }, 1500);
    // the editor does not tell when the sequence changes: look at it, and save a few seconds after the last change
    window.setInterval(function () {
      if (!ready) {
        return;
      }
      const current = JSON.stringify(editor.getState().sequenceData);
      if (current === lastSeen) {
        return;
      }
      lastSeen = current;
      if (current === lastSaved) {
        setSaveState('Saved', 'saved');
        return;
      }
      setSaveState('Unsaved changes', 'dirty');
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        saveNow();
      }, AUTOSAVE_AFTER_MS);
    }, WATCH_EVERY_MS);
    window.addEventListener('beforeunload', function (event) {
      if (ready && JSON.stringify(editor.getState().sequenceData) !== lastSaved) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  if (typeof window.createVectorEditor !== 'function' || !window.bioParsers) {
    fail('The sequence editor is not installed. Run bin/fetch-ove.sh once.');
    return;
  }
  load().catch(function (error) {
    fail(error.message || String(error));
  });
})();
