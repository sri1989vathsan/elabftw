/**
 * The annotate tool of the sidebar: finds the common features of the sequence in the editor (annotate.js, with the library
 * features-library.js), lists them with their place, and adds the chosen ones to the features of the plasmid, so they are
 * saved with it. A search through the library shows what it knows. Exposed as window.AnnotateTab.
 */
(function () {
  'use strict';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  // the library is a script (nginx serves no json files): it is loaded the first time it is needed
  let libraryPromise = null;
  function loadLibrary() {
    if (!libraryPromise) {
      libraryPromise = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = document.body.dataset.libraryUrl || 'features-library.js';
        script.onload = function () {
          resolve(window.FeatureLibrary);
        };
        script.onerror = function () {
          libraryPromise = null;
          reject(new Error('The feature library could not be loaded.'));
        };
        document.head.append(script);
      });
    }
    return libraryPromise;
  }

  const listOf = function (features) {
    return Array.isArray(features) ? features : Object.values(features || {});
  };

  function setup(editor) {
    if (!window.ToolSidebar || !window.Annotator) {
      return;
    }
    let panel = null;
    let found = null;
    let message = '';

    const select = function (start, end) {
      editor.updateEditor({ selectionLayer: { start: start, end: end } });
    };

    // is the feature already one of the features of the plasmid
    const present = function (hit, data) {
      return listOf(data.features).some(function (feature) {
        return feature.start === hit.start && feature.end === (hit.end - 1) % data.sequence.length && (feature.strand || 1) === hit.strand;
      });
    };

    async function run() {
      message = 'Looking...';
      render();
      try {
        const library = await loadLibrary();
        const data = editor.getState().sequenceData;
        const hits = window.Annotator.annotate(data.sequence, !!data.circular, library);
        found = hits.map(function (hit) {
          return { hit: hit, existing: present(hit, data), chosen: !present(hit, data) };
        });
        message = hits.length === 0 ? 'No common feature was found.' : '';
      } catch (error) {
        found = null;
        message = error.message || String(error);
      }
      render();
    }

    function addChosen() {
      const data = editor.getState().sequenceData;
      const features = listOf(data.features).slice();
      let added = 0;
      found.forEach(function (row) {
        if (!row.chosen || row.existing) {
          return;
        }
        const hit = row.hit;
        features.push({
          id: 'auto-' + Date.now().toString(36) + '-' + added,
          name: hit.name,
          type: hit.type,
          start: hit.start,
          end: (hit.end - 1) % data.sequence.length,
          strand: hit.strand,
          notes: hit.description ? { note: [hit.description] } : {},
        });
        row.existing = true;
        row.chosen = false;
        added++;
      });
      editor.updateEditor({ sequenceData: Object.assign({}, data, { features: features }) });
      message = added + ' feature' + (added === 1 ? '' : 's') + ' added to the plasmid.';
      render();
    }

    function results() {
      const box = element('div', 'annotate-results');
      found.forEach(function (row) {
        const hit = row.hit;
        const line = element('label', 'tool-card annotate-row');
        const check = element('input');
        check.type = 'checkbox';
        check.checked = row.chosen;
        check.disabled = row.existing;
        check.addEventListener('change', function () {
          row.chosen = check.checked;
          counter();
        });
        const text = element('span', 'annotate-text');
        const name = element('strong', '', hit.name);
        name.title = hit.description || '';
        const where = element('button', 'tool-tag', (hit.start + 1) + '..' + hit.end + (hit.strand > 0 ? ' (+)' : ' (−)'));
        where.type = 'button';
        where.title = 'Select it on the sequence';
        where.addEventListener('click', function (event) {
          event.preventDefault();
          select(hit.start, (hit.end - 1) % editor.getState().sequenceData.sequence.length);
        });
        text.append(name, element('small', 'text-muted', ' ' + hit.type + (row.existing ? ', already a feature' : '')), document.createElement('br'), where);
        line.append(check, text);
        box.append(line);
      });
      return box;
    }

    let addButton = null;
    function counter() {
      if (addButton) {
        const n = found.filter(function (row) {
          return row.chosen && !row.existing;
        }).length;
        addButton.textContent = 'Add ' + n + ' to the features';
        addButton.disabled = n === 0;
      }
    }

    function browser() {
      const wrap = element('div', 'annotate-library');
      const input = element('input');
      input.type = 'search';
      input.placeholder = 'Search the library of features...';
      input.setAttribute('aria-label', 'Search the library of features');
      const list = element('div', 'annotate-library-list');
      input.addEventListener('input', async function () {
        const term = input.value.trim().toLowerCase();
        list.textContent = '';
        if (term === '') {
          return;
        }
        const library = await loadLibrary();
        const names = new Map();
        library.forEach(function (f) {
          if (f.n.toLowerCase().indexOf(term) !== -1 || (f.d || '').toLowerCase().indexOf(term) !== -1) {
            names.set(f.n, f);
          }
        });
        Array.from(names.values()).slice(0, 15).forEach(function (f) {
          const row = element('div', 'annotate-library-row');
          row.append(element('strong', '', f.n), element('small', 'text-muted', ' ' + f.t + ', ' + f.s.length + ' bp'), element('div', 'text-muted', f.d || ''));
          list.append(row);
        });
        if (names.size === 0) {
          list.append(element('p', 'text-muted', 'Nothing found.'));
        }
      });
      wrap.append(input, list);
      return wrap;
    }

    function render() {
      if (!panel || window.ToolSidebar.active() !== 'annotate') {
        return;
      }
      panel.textContent = '';
      panel.append(element('p', 'digest-help', 'Finds the common features of this sequence (resistance genes, origins, promoters, tags, reporters ...) and adds the ones you choose to its features.'));
      const run1 = element('button', 'tool-btn tool-btn-primary', found ? 'Find again' : 'Find the features');
      run1.type = 'button';
      run1.addEventListener('click', run);
      panel.append(run1);
      if (message) {
        panel.append(element('p', 'text-muted', message));
      }
      if (found && found.length > 0) {
        addButton = element('button', 'tool-btn', '');
        addButton.type = 'button';
        addButton.addEventListener('click', addChosen);
        panel.append(addButton, results());
        counter();
      }
      panel.append(element('h4', '', 'Library'), browser());
    }

    window.ToolSidebar.register({ id: 'annotate', icon: 'annotate', label: 'Find and add features', show: function (host) {
      panel = host;
      found = null;
      message = '';
      render();
    } });
  }

  window.AnnotateTab = { setup: setup };
})();
