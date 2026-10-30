/**
 * Shows a sequence file attached to an entry in the Open Vector Editor, read only.
 * The page is opened in a frame of the entry page with ?f=<long name>&name=<real name>&storage=<storage>
 */
(function () {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const status = document.getElementById('status');

  function fail(message) {
    status.textContent = message;
    status.className = 'error';
  }

  async function load() {
    const name = params.get('name') || 'sequence';
    const download = new URLSearchParams({ f: params.get('f') || '', name: name, storage: params.get('storage') || '1' });
    if (params.get('access_key')) {
      download.set('access_key', params.get('access_key'));
    }
    const response = await fetch('../app/download.php?' + download.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error('The file could not be downloaded (' + response.status + ').');
    }
    // SnapGene files are binary, the other formats are text
    const input = /\.dna$/i.test(name) ? new File([await response.blob()], name) : await response.text();
    const results = await window.bioParsers.anyToJson(input, { fileName: name });
    const result = Array.isArray(results) ? results[0] : results;
    if (!result || !result.success || !result.parsedSequence) {
      const messages = (result && result.messages ? result.messages : []).join(' ');
      throw new Error('This file could not be read as a sequence. ' + messages);
    }
    status.className = 'hidden';
    const editor = window.createVectorEditor(document.getElementById('root'), {
      editorName: 'sequence-viewer',
      showMenuBar: true,
      readOnly: true,
    });
    editor.updateEditor({
      sequenceData: result.parsedSequence,
      readOnly: true,
      annotationVisibility: { features: true, cutsites: true, orfs: false },
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
