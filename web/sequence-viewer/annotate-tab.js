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
    // the tab that is shown: the features that are on the plasmid, or the search for new ones
    let subTab = 'current';

    const select = function (start, end) {
      editor.updateEditor({ selectionLayer: { start: start, end: end } });
    };

    // how many bases two ranges share (a range over the origin is two ranges)
    const parts = function (start, end, length) {
      return end >= start ? [[start, end]] : [[start, length - 1], [0, end]];
    };
    const shared = function (a, b, length) {
      let total = 0;
      parts(a.start, a.end, length).forEach(function (one) {
        parts(b.start, b.end, length).forEach(function (other) {
          total += Math.max(0, Math.min(one[1], other[1]) - Math.max(one[0], other[0]) + 1);
        });
      });
      return total;
    };
    const plain = function (name) {
      return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    };
    // is the feature already one of the features of the plasmid: the same name on the same place, or the same place whatever
    // the name (a feature of the file, or one added before, is not added again)
    const present = function (hit, data) {
      const length = data.sequence.length;
      const range = { start: hit.start, end: (hit.end - 1) % length };
      const size = hit.length;
      return listOf(data.features).some(function (feature) {
        if (String(feature.type || '').toLowerCase() === 'source') {
          return false;
        }
        const overlap = shared(range, feature, length);
        if (overlap === 0) {
          return false;
        }
        const sameName = plain(feature.name) === plain(hit.name);
        const covers = overlap / size;
        // the same name: a good part of it is there; another name: almost exactly the same place and strand
        return (sameName && covers >= 0.5) || (covers >= 0.9 && shared(feature, feature, length) <= size * 1.15 && (feature.strand || 1) === hit.strand);
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
      const rowOf = function (row) {
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
        const where = element('button', 'tool-tag', (hit.start + 1) + '..' + hit.end + (hit.strand > 0 ? ' (+)' : ' (\u2212)'));
        where.type = 'button';
        where.title = 'Select it on the sequence';
        where.addEventListener('click', function (event) {
          event.preventDefault();
          select(hit.start, (hit.end - 1) % editor.getState().sequenceData.sequence.length);
        });
        text.append(name, element('small', 'text-muted', ' ' + hit.type), document.createElement('br'), where);
        line.append(check, text);
        return line;
      };
      // the new ones are listed; the ones that are already features are folded away, they are not offered again
      const fresh = found.filter(function (row) {
        return !row.existing;
      });
      const old = found.filter(function (row) {
        return row.existing;
      });
      fresh.forEach(function (row) {
        box.append(rowOf(row));
      });
      if (fresh.length === 0) {
        box.append(element('p', 'tool-muted', 'Nothing new: every feature found is already on the plasmid.'));
      }
      if (old.length > 0) {
        const folded = element('details', 'annotate-old');
        folded.append(element('summary', 'tool-muted', 'Already on the plasmid (' + old.length + ')'));
        old.forEach(function (row) {
          folded.append(rowOf(row));
        });
        box.append(folded);
      }
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

    // the properties of a feature, folded under it: the place, the length, the strand, the make-up of its bases and its notes
    function properties(feature, data) {
      const length = data.sequence.length;
      const size = ((feature.end - feature.start + length) % length) + 1;
      const bases = feature.end >= feature.start ? data.sequence.slice(feature.start, feature.end + 1) : data.sequence.slice(feature.start) + data.sequence.slice(0, feature.end + 1);
      const gc = bases.length === 0 ? 0 : (bases.replace(/[^gcGC]/g, '').length / bases.length) * 100;
      const rows = [
        ['Type', String(feature.type || 'misc_feature')],
        ['Start', String(feature.start + 1)],
        ['End', String(feature.end + 1)],
        ['Length', size + ' bp' + (size % 3 === 0 ? ' (' + size / 3 + ' codons)' : '')],
        ['Strand', (feature.strand || 1) > 0 ? 'forward (+)' : 'reverse (\u2212)'],
        ['GC content', gc.toFixed(1) + ' %'],
      ];
      if (feature.end < feature.start) {
        rows.push(['Position', 'runs over the origin']);
      }
      Object.keys(feature.notes || {}).forEach(function (key) {
        const value = [].concat(feature.notes[key]).join('; ');
        if (value !== '') {
          rows.push([key, value]);
        }
      });
      const details = element('details', 'annotate-props');
      details.append(element('summary', 'tool-muted', 'Properties'));
      const table = element('dl', 'annotate-props-list');
      rows.forEach(function (pair) {
        table.append(element('dt', '', pair[0]), element('dd', '', pair[1]));
      });
      const sequence = element('div', 'annotate-props-seq', bases.length > 60 ? bases.slice(0, 60) + '... (' + bases.length + ' bp)' : bases);
      sequence.title = 'The first bases of the feature (on the forward strand)';
      details.append(table, sequence);
      return details;
    }

    // the features of the plasmid, grouped by their type (a group can be folded), in the order of the sequence
    function currentFeatures() {
      const box = element('div', 'annotate-current');
      const data = editor.getState().sequenceData;
      const length = data.sequence.length;
      const all = listOf(data.features).filter(function (feature) {
        return String(feature.type || '').toLowerCase() !== 'source';
      });
      if (all.length === 0) {
        box.append(element('p', 'tool-muted', 'The plasmid has no features yet. Find them in the other tab.'));
        return box;
      }
      const groups = new Map();
      all.forEach(function (feature) {
        const type = String(feature.type || 'misc_feature');
        if (!groups.has(type)) {
          groups.set(type, []);
        }
        groups.get(type).push(feature);
      });
      Array.from(groups.keys()).sort(function (a, b) {
        return a.localeCompare(b);
      }).forEach(function (type) {
        const list = groups.get(type).slice().sort(function (a, b) {
          return a.start - b.start;
        });
        const group = element('details', 'annotate-group');
        group.open = true;
        group.append(element('summary', 'tool-muted', type + ' (' + list.length + ')'));
        // a table per type: a click on a row selects the feature on the sequence, the arrow opens its properties
        const table = element('table', 'annotate-table');
        const head = element('tr');
        ['', 'Name', 'Start', 'End', 'bp', 'Strand'].forEach(function (title) {
          head.append(element('th', '', title));
        });
        const thead = element('thead');
        thead.append(head);
        table.append(thead);
        const rows = element('tbody');
        list.forEach(function (feature) {
          const size = ((feature.end - feature.start + length) % length) + 1;
          const row = element('tr', 'annotate-trow');
          row.title = 'Select it on the sequence';
          const toggle = element('button', 'annotate-toggle', '\u25b8');
          toggle.type = 'button';
          toggle.setAttribute('aria-label', 'Properties');
          const first = element('td');
          first.append(toggle);
          row.append(first, element('td', 'annotate-name', feature.name || type), element('td', '', String(feature.start + 1)), element('td', '', String(feature.end + 1)), element('td', '', String(size)), element('td', '', (feature.strand || 1) > 0 ? '+' : '\u2212'));
          const more = element('tr', 'annotate-more');
          more.hidden = true;
          const cell = element('td');
          cell.colSpan = 6;
          cell.append(properties(feature, data));
          more.append(cell);
          const details = cell.firstChild;
          details.open = true;
          details.firstChild.hidden = true;
          row.addEventListener('click', function (event) {
            if (event.target === toggle) {
              more.hidden = !more.hidden;
              toggle.textContent = more.hidden ? '\u25b8' : '\u25be';
              return;
            }
            select(feature.start, feature.end);
          });
          rows.append(row, more);
        });
        table.append(rows);
        group.append(table);
        box.append(group);
      });
      return box;
    }

    function render() {
      if (!panel || window.ToolSidebar.active() !== 'annotate') {
        return;
      }
      panel.textContent = '';
      const count = listOf(editor.getState().sequenceData.features).filter(function (feature) {
        return String(feature.type || '').toLowerCase() !== 'source';
      }).length;
      const subTabs = element('div', 'primers-subtabs');
      [['current', 'On the plasmid (' + count + ')'], ['find', 'Find and add']].forEach(function (tabDef) {
        const button = element('button', 'primers-subtab' + (subTab === tabDef[0] ? ' active' : ''), tabDef[1]);
        button.type = 'button';
        button.setAttribute('aria-pressed', subTab === tabDef[0] ? 'true' : 'false');
        button.addEventListener('click', function () {
          subTab = tabDef[0];
          render();
        });
        subTabs.append(button);
      });
      panel.append(subTabs);
      if (subTab === 'current') {
        panel.append(currentFeatures());
        return;
      }
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
      subTab = 'current';
      render();
    } });
  }

  window.AnnotateTab = { setup: setup };
})();
