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

  // the primers: those attached to the plasmid are drawn on the map, and the primers designed in the editor can be added to the database
  function setupPrimers(editor) {
    const tools = window.PrimerTools;
    const menu = document.getElementById('primers-menu');
    if (!tools || !menu) {
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cutter-button primers-button';
    button.textContent = 'Primers';
    const panel = document.createElement('div');
    panel.id = 'primers-panel';
    panel.hidden = true;
    menu.append(button);
    document.body.append(panel);
    let databasePrimers = null;

    const sequenceState = function () {
      const data = editor.getState().sequenceData;
      return { sequence: String(data.sequence || ''), circular: !!data.circular, data: data, name: data.name || fileName };
    };

    // the primers attached to the entry are drawn on the map, as temporary annotations that are not saved in the file
    async function drawAttached() {
      if (!entryId) {
        return [];
      }
      const state = await tools.attached(entryId);
      const current = sequenceState();
      const length = current.sequence.length;
      const drawn = {};
      state.primers.forEach(function (primer) {
        tools.findSites(current.sequence, primer.sequence, current.circular).forEach(function (site, index) {
          const id = 'dbprimer-' + primer.id + '-' + index;
          drawn[id] = {
            id: id,
            name: primer.title,
            type: 'primer',
            start: site.start % length,
            end: (site.end - 1) % length,
            forward: site.forward,
            strand: site.forward ? 1 : -1,
          };
        });
      });
      editor.updateEditor({ temporaryAnnotations: { primers: drawn }, annotationVisibility: { primers: true } });
      return state.primers;
    }

    const element = function (tag, className, text) {
      const node = document.createElement(tag);
      if (className) {
        node.className = className;
      }
      if (text) {
        node.textContent = text;
      }
      return node;
    };

    // the bases of a primer drawn in the file or selected: the reverse strand gives the reverse complement
    const basesOf = function (sequence, start, end, forward) {
      const length = sequence.length;
      const span = start <= end ? sequence.slice(start, end + 1) : sequence.slice(start) + sequence.slice(0, end + 1);
      return forward ? span : tools.reverseComplement(span);
    };

    async function render() {
      panel.textContent = '';
      const message = element('p', 'primers-message');
      const current = sequenceState();
      if (databasePrimers === null) {
        databasePrimers = await tools.allPrimers().catch(function () {
          return [];
        });
      }
      const inDatabase = function (bases) {
        const clean = tools.clean(bases);
        const reverse = tools.reverseComplement(clean);
        return databasePrimers.find(function (p) {
          return p.sequence === clean || p.sequence === reverse;
        });
      };

      // attached to the plasmid
      if (entryId) {
        panel.append(element('h4', '', 'Attached to this plasmid'));
        let attached = [];
        try {
          attached = await drawAttached();
        } catch (error) {
          panel.append(element('p', 'primers-message error', error.message));
        }
        if (attached.length === 0) {
          panel.append(element('p', 'primers-muted', 'No primer is attached. Attach some from the primers section of the entry.'));
        }
        attached.forEach(function (primer) {
          const row = element('div', 'primers-row');
          row.append(element('strong', '', primer.title));
          const sites = tools.findSites(current.sequence, primer.sequence, current.circular);
          row.append(element('span', 'primers-muted', sites.length === 0 ? 'no binding site' : sites.map(function (site) {
            return (site.start + 1) + '..' + site.end + (site.forward ? ' (+)' : ' (\u2212)');
          }).join('; ')));
          if (sites.length > 0) {
            const show = element('button', 'cutter-button', 'Show');
            show.type = 'button';
            show.addEventListener('click', function () {
              editor.updateEditor({ selectionLayer: { start: sites[0].start, end: sites[0].end - 1 } });
            });
            row.append(show);
          }
          const order = element('button', 'cutter-button', 'Order');
          order.type = 'button';
          order.addEventListener('click', function () {
            tools.sendToOrder([primer.id]);
          });
          row.append(order);
          panel.append(row);
        });
      }

      // the primers of the file (annotated in the editor) that are not in the database yet
      const fileData = current.data;
      const own = Object.values(fileData.primers || {});
      panel.append(element('h4', '', 'Primers designed in this file'));
      if (own.length === 0) {
        panel.append(element('p', 'primers-muted', 'None yet. Select the bases of a primer on the sequence, then use "New primer from the selection" below, or add a primer with the editor (Edit menu).'));
      }
      own.forEach(function (primer) {
        const forward = primer.forward !== false && primer.strand !== -1;
        const bases = basesOf(current.sequence, primer.start, primer.end, forward);
        const known = inDatabase(bases);
        const row = element('div', 'primers-row');
        row.append(element('strong', '', primer.name || 'primer'), element('span', 'primers-muted', bases.length + ' bases'));
        if (known) {
          const link = element('a', 'primers-muted', 'in the database: ' + known.title);
          link.href = '../registry.php?mode=view&id=' + known.id;
          link.target = '_blank';
          row.append(link);
        } else {
          const add = element('button', 'cutter-button', 'Add to the database');
          add.type = 'button';
          add.addEventListener('click', async function () {
            add.disabled = true;
            try {
              const id = await tools.createPrimer(primer.name || 'primer', bases, forward, current.name);
              if (entryId) {
                await tools.attach(entryId, id);
              }
              databasePrimers = null;
              await render();
            } catch (error) {
              message.textContent = error.message || String(error);
              message.className = 'primers-message error';
              add.disabled = false;
            }
          });
          row.append(add);
        }
        panel.append(row);
      });

      // a primer from the bases selected on the sequence
      panel.append(element('h4', '', 'New primer from the selection'));
      const selection = editor.getState().selectionLayer || { start: -1, end: -1 };
      if (selection.start < 0 || selection.end < 0) {
        panel.append(element('p', 'primers-muted', 'Select the bases of the primer on the sequence first.'));
      } else {
        const reverse = element('input');
        reverse.type = 'checkbox';
        const reverseLabel = element('label', 'primers-muted');
        reverseLabel.append(reverse, document.createTextNode(' reverse primer (reverse complement of the selection)'));
        const name = element('input', 'primers-name');
        name.type = 'text';
        name.placeholder = 'Name of the primer';
        const info = element('span', 'primers-muted');
        const refresh = function () {
          const bases = basesOf(current.sequence, selection.start, selection.end, !reverse.checked);
          info.textContent = bases.length + ' bases, Tm ' + tools.tm(bases) + '\u00b0C' + (bases.length < tools.minLength ? ' (too short)' : '');
        };
        reverse.addEventListener('change', refresh);
        refresh();
        const add = element('button', 'cutter-button', 'Add to the database');
        add.type = 'button';
        add.addEventListener('click', async function () {
          const bases = basesOf(current.sequence, selection.start, selection.end, !reverse.checked);
          if (bases.length < tools.minLength) {
            message.textContent = 'A primer has at least ' + tools.minLength + ' bases.';
            message.className = 'primers-message error';
            return;
          }
          const known = inDatabase(bases);
          if (known) {
            message.textContent = 'This primer is already in the database: ' + known.title + '.';
            message.className = 'primers-message error';
            return;
          }
          add.disabled = true;
          try {
            const title = name.value.trim() || (current.name + (reverse.checked ? ' reverse ' : ' forward ') + (selection.start + 1));
            const id = await tools.createPrimer(title, bases, !reverse.checked, current.name);
            if (entryId) {
              await tools.attach(entryId, id);
            }
            databasePrimers = null;
            await render();
          } catch (error) {
            message.textContent = error.message || String(error);
            message.className = 'primers-message error';
            add.disabled = false;
          }
        });
        const row = element('div', 'primers-row');
        row.append(name, info, reverseLabel, add);
        panel.append(row);
      }
      panel.append(message);
    }

    button.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        render();
      }
    });
    // the primers of the plasmid are drawn from the start
    drawAttached().catch(function () {
      // the map just has no database primers
    });
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
