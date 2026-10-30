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
  // a Sanger trace (ab1) is an instrument file: it is only looked at, never written back
  const isTrace = /\.ab1$/i.test(fileName);
  const canWrite = body.canWrite === '1' && !isTrace;
  // the tool of the Tools menu: an editor with no file of the database behind it, nothing is saved
  const toolMode = body.tool === '1';
  // after a save the file to replace is the new version, and a SnapGene file is saved as a GenBank file next to it
  let uploadId = Number(body.upload) || 0;
  let saveName = fileName;
  const AUTOSAVE_AFTER_MS = 3000;
  const WATCH_EVERY_MS = 1000;

  // colours of the annotations, for the display only: they are not written to the file unless the user sets them
  const FEATURE_COLORS = {
    cds: '#2f6fed',
    gene: '#1b4fc4',
    promoter: '#1fa35a',
    terminator: '#d6455d',
    rep_origin: '#7a8699',
    origin: '#7a8699',
    misc_feature: '#9b5de5',
    primer_bind: '#f0a202',
    regulatory: '#0fa3a3',
    protein_bind: '#d6409f',
    misc_binding: '#d6409f',
    rbs: '#e07a1f',
    sig_peptide: '#43a047',
    misc_recomb: '#8d6e63',
    mobile_element: '#8d6e63',
    // the feature that covers the whole plasmid is a background
    source: '#dfe3e8',
  };
  // the labels of the cut sites: red for the enzymes that cut once, orange twice, purple three times or more
  const CUTSITE_COLORS = { single: '#d32f2f', double: '#ef6c00', multi: '#7b1fa2' };
  const paletteKeys = new Set();
  const featureKey = function (feature) {
    return [feature.type, feature.start, feature.end, feature.name].join('|');
  };
  const featuresOf = function (sequenceData) {
    const features = sequenceData.features || [];
    return Array.isArray(features) ? features : Object.values(features);
  };
  function applyPalette(sequenceData) {
    featuresOf(sequenceData).forEach(function (feature) {
      const color = FEATURE_COLORS[String(feature.type || '').toLowerCase()];
      if (!feature.color && color) {
        feature.color = color;
        paletteKeys.add(featureKey(feature));
      }
    });
    sequenceData.cutsiteLabelColors = CUTSITE_COLORS;
  }
  // what is written to the file has none of the colours of the display
  function withoutPalette(sequenceData) {
    const clone = JSON.parse(JSON.stringify(sequenceData));
    featuresOf(clone).forEach(function (feature) {
      if (paletteKeys.has(featureKey(feature)) && feature.color === FEATURE_COLORS[String(feature.type || '').toLowerCase()]) {
        delete feature.color;
      }
    });
    delete clone.cutsiteLabelColors;
    return clone;
  }

  document.title = fileName + ' - Sequence editor';
  const titleElement = document.getElementById('title');
  if (titleElement) {
    titleElement.textContent = fileName;
  }

  function fail(message) {
    status.textContent = message;
    status.className = 'error';
  }

  function setSaveState(text, kind) {
    saveState.textContent = text;
    saveState.className = kind || '';
  }

  // the format of the file decides how it is written back
  function serialize(rawSequenceData) {
    const sequenceData = withoutPalette(rawSequenceData);
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

  // the restriction enzymes shown on the sequence, by the number of times they cut: one button per combination
  const CUTTERS = {
    single: { value: 'single', label: 'Single cutters', cutsThisManyTimes: 1 },
    double: { value: 'double', label: 'Double cutters', cutsThisManyTimes: 2 },
    triple: { value: 'triple', label: 'Triple cutters', cutsThisManyTimes: 3 },
  };
  const CUTTER_PRESETS = [
    { label: 'Single', keys: ['single'] },
    { label: 'Double', keys: ['double'] },
    { label: 'Triple', keys: ['triple'] },
    { label: 'Single + double', keys: ['single', 'double'] },
    { label: 'Double + triple', keys: ['double', 'triple'] },
    { label: 'Single + double + triple', keys: ['single', 'double', 'triple'] },
  ];
  function buildCutterButtons(editor) {
    const holder = document.getElementById('cutters');
    if (!holder) {
      return;
    }
    holder.textContent = '';
    const title = document.createElement('span');
    title.className = 'cutters-label';
    title.textContent = 'Enzymes that cut:';
    holder.append(title);
    const buttons = [];
    CUTTER_PRESETS.forEach(function (preset, index) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cutter-button';
      button.textContent = preset.label;
      button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
      button.addEventListener('click', function () {
        editor.updateEditor({
          restrictionEnzymes: { isEnzymeFilterAnd: false, filteredRestrictionEnzymes: preset.keys.map(function (key) {
            return CUTTERS[key];
          }) },
        });
        buttons.forEach(function (other) {
          other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
        });
      });
      buttons.push(button);
      holder.append(button);
    });
  }

  // a new, empty sequence to start from: File > Import Sequence opens a file of the computer
  function loadTool() {
    status.className = 'hidden';
    document.title = 'Sequence editor';
    const sequenceData = { name: 'New sequence', circular: true, sequence: '', features: [] };
    applyPalette(sequenceData);
    const editor = window.createVectorEditor(document.getElementById('root'), {
      editorName: 'sequence-tool',
      showMenuBar: true,
      readOnly: false,
    });
    window.sequenceEditor = editor;
    buildCutterButtons(editor);
    setupPrimers(editor);
    editor.updateEditor({ sequenceData: sequenceData, annotationVisibility: { features: true, cutsites: true, orfs: false } });
    setSaveState('Nothing is stored here: use File > Export Sequence to keep your work', '');
  }

  // the primers panel (primers-panel.js): the primers of the database attached to the sequence, and the design of new ones
  function setupPrimers(editor) {
    if (window.PrimerPanel) {
      window.PrimerPanel.setup(editor, { entryId: entryId, fileName: fileName });
    }
  }

  async function load() {
    if (toolMode) {
      return loadTool();
    }
    const download = new URLSearchParams({ f: params.get('f') || '', name: fileName, storage: params.get('storage') || '1' });
    if (params.get('access_key')) {
      download.set('access_key', params.get('access_key'));
    }
    const response = await fetch('../app/download.php?' + download.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error('The file could not be downloaded (' + response.status + ').');
    }
    // SnapGene and ab1 files are binary, the other formats are text
    const isSnapgene = /\.dna$/i.test(fileName);
    const input = isSnapgene || isTrace ? new File([await response.blob()], fileName) : await response.text();
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
    applyPalette(result.parsedSequence);

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
    buildCutterButtons(editor);
    editor.updateEditor({
      sequenceData: result.parsedSequence,
      readOnly: !canWrite,
      annotationVisibility: { features: true, cutsites: true, orfs: false },
    });
    setupPrimers(editor);

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
      setSaveState(isTrace ? 'Sanger trace: read only' : 'Read only: you cannot edit this entry', '');
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
