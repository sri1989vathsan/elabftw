/**
 * Compare digests of the sequence of the editor: several combinations of restriction enzymes, each one a lane of a simulated
 * gel next to a ladder, with the sizes of the fragments. Click a fragment to select it on the sequence.
 * Needs the sequence utilities of the editor (vendor/sequence-utils.umd.js). Exposed as window.DigestCompare.
 */
(function () {
  'use strict';
  // the ladders of the vendors, in bp (the sizes of the bands as published; check them against the data sheet of the lot you use)
  const LADDER_GROUPS = {
    'Thermo GeneRuler': {
      'GeneRuler 1 kb': [20000, 10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 750, 500, 250],
      'GeneRuler 1 kb Plus': [20000, 10000, 7000, 5000, 4000, 3000, 2000, 1500, 1000, 700, 500, 400, 300, 200, 75],
      'GeneRuler 100 bp': [1031, 900, 800, 700, 600, 500, 400, 300, 200, 100],
      'GeneRuler 100 bp Plus': [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
      'GeneRuler 50 bp': [1000, 900, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50],
      'GeneRuler Low Range': [700, 500, 400, 300, 200, 150, 100, 75, 50, 25],
      'GeneRuler Ultra Low Range': [300, 200, 150, 100, 75, 50, 35, 25, 20, 15, 10],
      'GeneRuler Mix': [10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
    },
    'NEB': {
      'NEB 1 kb': [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500],
      'NEB 100 bp': [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
    },
    'Invitrogen': {
      'Invitrogen 1 Kb Plus': [12000, 5000, 2000, 1650, 1000, 850, 650, 500, 400, 300, 200, 100],
    },
  };
  // the names used before the ladders were grouped
  const LEGACY = { '1 kb': 'NEB 1 kb', '100 bp': 'NEB 100 bp', '1 kb plus': 'Invitrogen 1 Kb Plus' };
  const VENDORS = { B: 'Thermo', E: 'Agilent', I: 'SibEnzyme', J: 'Nippon Gene', K: 'Takara', M: 'Roche', N: 'NEB', O: 'Toyobo', Q: 'CHIMERx', R: 'Promega', S: 'Sigma', V: 'Vivantis', X: 'EURx', Z: 'Enzynomics' };
  const CUSTOM_KEY = 'sequence-editor-custom-ladders';

  // the ladders made or imported by the user are kept in the browser: {name: [sizes]}
  function loadCustomLadders() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CUSTOM_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (error) {
      return {};
    }
  }

  function saveCustomLadders(ladders) {
    try {
      window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(ladders));
    } catch (error) {
      // not remembered
    }
  }

  // sizes from a text: numbers separated by commas, spaces, semicolons or lines; the bands are in bp, the biggest first
  function parseSizes(text) {
    return Array.from(new Set(String(text).split(/[\s,;]+/).map(Number).filter(function (n) {
      return Number.isFinite(n) && n > 0;
    }))).sort(function (a, b) {
      return b - a;
    });
  }

  /**
   * Ladders from the content of a file: JSON ({name: [sizes]} or [{name, sizes}]) or text, where a line is "name: 1000, 500 ..."
   * or "name,1000,500" (a line of numbers alone is a ladder named after the file).
   *
   * @returns {Object<string, number[]>}
   */
  function parseLadders(text, fileName) {
    const found = {};
    const base = String(fileName || 'Imported ladder').replace(/\.[^.]+$/, '');
    const trimmed = String(text).trim();
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      try {
        const data = JSON.parse(trimmed);
        const entries = Array.isArray(data) ? data.map(function (item) {
          return [item.name, item.sizes || item.bands];
        }) : Object.keys(data).map(function (key) {
          return [key, data[key]];
        });
        entries.forEach(function (entry) {
          const sizes = parseSizes(Array.isArray(entry[1]) ? entry[1].join(' ') : '');
          if (entry[0] && sizes.length > 0) {
            found[String(entry[0])] = sizes;
          }
        });
        return found;
      } catch (error) {
        return found;
      }
    }
    const lines = trimmed.split(/\r?\n/);
    const named = lines.some(function (line) {
      return /^\s*[^\d\s,;:\t][^,;:\t]*?\s*[,;:\t]/.test(line);
    });
    if (!named) {
      // no names: all the sizes of the file are one ladder, named after the file
      const sizes = parseSizes(trimmed);
      if (sizes.length > 0) {
        found[base] = sizes;
      }
      return found;
    }
    lines.forEach(function (line) {
      const match = line.match(/^\s*([^\d\s,;:\t][^,;:\t]*?)\s*[,;:\t]\s*(.*)$/);
      const sizes = parseSizes(match ? match[2] : line);
      if (sizes.length === 0) {
        return;
      }
      found[match ? match[1].trim() : base + ' ' + (Object.keys(found).length + 1)] = sizes;
    });
    return found;
  }

  // the colour of a lane, in the order the lanes are added
  const COLORS = ['#2f6fed', '#d6455d', '#1fa35a', '#f0a202', '#9b5de5', '#0fa3a3', '#e07a1f', '#d6409f'];

  /**
   * The fragments from the positions of the cuts: a circular sequence gives as many fragments as cuts (one cut: the
   * linearised plasmid), a linear one gives one more. Positions are the places where the top strand is cut.
   *
   * @returns {Array<{size: number, start: number, end: number}>} start and end are bases, 0-based, end included
   */
  function fragments(cuts, length, circular) {
    const positions = Array.from(new Set(cuts.map(function (c) {
      return ((c % length) + length) % length;
    }))).sort(function (a, b) {
      return a - b;
    });
    if (positions.length === 0) {
      return [{ size: length, start: 0, end: length - 1 }];
    }
    const result = [];
    if (circular) {
      positions.forEach(function (position, index) {
        const next = positions[(index + 1) % positions.length];
        const size = positions.length === 1 ? length : ((next - position + length) % length) || length;
        result.push({ size: size, start: position, end: (position + size - 1) % length });
      });
    } else {
      const bounds = [0].concat(positions.filter(function (p) {
        return p > 0;
      }), [length]);
      for (let i = 0; i < bounds.length - 1; i++) {
        result.push({ size: bounds[i + 1] - bounds[i], start: bounds[i], end: bounds[i + 1] - 1 });
      }
    }
    return result;
  }

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

  function setup(editor, context) {
    const utils = window.sequenceUtils;
    if (!utils || !window.ToolSidebar) {
      return;
    }
    const storageKey = 'sequence-editor-digests-' + (context.entryId || 'tool');
    // the area of the sidebar that is shown
    let panel = element('div');

    // the combinations are kept in the browser, per plasmid
    let lanes = [];
    let ladder = 'GeneRuler 1 kb';
    let customLadders = loadCustomLadders();
    const bands = function (name) {
      const groups = Object.keys(LADDER_GROUPS);
      for (let i = 0; i < groups.length; i++) {
        if (LADDER_GROUPS[groups[i]][name]) {
          return LADDER_GROUPS[groups[i]][name];
        }
      }
      return customLadders[name] || LADDER_GROUPS['Thermo GeneRuler']['GeneRuler 1 kb'];
    };
    const known = function (name) {
      return !!name && (Object.keys(LADDER_GROUPS).some(function (group) {
        return !!LADDER_GROUPS[group][name];
      }) || !!customLadders[name]);
    };
    let showUncut = false;
    let openLadders = false;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
      if (saved && Array.isArray(saved.lanes)) {
        lanes = saved.lanes;
        const wanted = LEGACY[saved.ladder] || saved.ladder;
        ladder = known(wanted) ? wanted : ladder;
        showUncut = !!saved.showUncut;
      }
    } catch (error) {
      // the combinations are just not remembered
    }
    if (lanes.length === 0) {
      lanes = [{ enzymes: [] }];
    }
    const save = function () {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ lanes: lanes, ladder: ladder, showUncut: showUncut }));
      } catch (error) {
        // not remembered
      }
    };

    // the cuts of every enzyme on the sequence of the editor, worked out again when the sequence changes
    let cache = { sequence: null, circular: null, cuts: {} };
    // the enzymes of the editor and the commercial ones of the library (enzymes-library.js), with their vendors
    const library = window.EnzymeLibrary ? window.EnzymeLibrary.enzymes : {};
    const enzymeList = Object.values(Object.assign({}, library, utils.defaultEnzymesByName));
    const vendorsOf = function (name) {
      const entry = library[String(name).toLowerCase()];
      return entry ? entry.vendors.split('').map(function (code) {
        return VENDORS[code];
      }).filter(Boolean).join(', ') : '';
    };
    function cutsOf() {
      const data = editor.getState().sequenceData;
      const sequence = String(data.sequence || '').toLowerCase();
      const circular = !!data.circular;
      if (cache.sequence !== sequence || cache.circular !== circular) {
        const found = utils.getCutsitesFromSequence(sequence, circular, enzymeList);
        const cuts = {};
        Object.keys(found).forEach(function (name) {
          cuts[name] = found[name].map(function (site) {
            return site.topSnipPosition;
          });
        });
        cache = { sequence: sequence, circular: circular, cuts: cuts };
      }
      return { cuts: cache.cuts, length: sequence.length, circular: circular };
    }

    function digest(enzymes, state) {
      const cuts = [];
      enzymes.forEach(function (name) {
        (state.cuts[name] || []).forEach(function (position) {
          cuts.push(position);
        });
      });
      return fragments(cuts, state.length, state.circular);
    }

    // the gel: a ladder and a lane for each combination, bands placed on a logarithmic scale
    function gel(state, results) {
      const ns = 'http://www.w3.org/2000/svg';
      const laneWidth = 62;
      const left = 54;
      const top = 14;
      const height = bands(ladder).length > 14 ? 360 : 280;
      const sizes = results.reduce(function (all, r) {
        return all.concat(r.fragments.map(function (f) {
          return f.size;
        }));
      }, bands(ladder).slice());
      const max = Math.max.apply(null, sizes) * 1.15;
      const min = Math.min(80, Math.min.apply(null, sizes) * 0.8);
      const y = function (size) {
        return top + (1 - (Math.log(size) - Math.log(min)) / (Math.log(max) - Math.log(min))) * height;
      };
      const width = left + laneWidth * (results.length + 1) + 10;
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height + top * 2));
      svg.setAttribute('class', 'digest-gel');
      const background = document.createElementNS(ns, 'rect');
      background.setAttribute('x', String(left - 6));
      background.setAttribute('y', String(top - 8));
      background.setAttribute('width', String(width - left));
      background.setAttribute('height', String(height + 16));
      background.setAttribute('rx', '6');
      background.setAttribute('fill', '#1d242c');
      svg.append(background);

      const band = function (x, size, color, label, onClick) {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y(size) - 2));
        rect.setAttribute('width', String(laneWidth - 20));
        rect.setAttribute('height', '4');
        rect.setAttribute('rx', '2');
        rect.setAttribute('fill', color);
        rect.setAttribute('class', onClick ? 'digest-band clickable' : 'digest-band');
        const title = document.createElementNS(ns, 'title');
        title.textContent = label;
        rect.append(title);
        if (onClick) {
          rect.addEventListener('click', onClick);
        }
        svg.append(rect);
      };
      const text = function (x, yy, content, anchor, color) {
        const node = document.createElementNS(ns, 'text');
        node.setAttribute('x', String(x));
        node.setAttribute('y', String(yy));
        node.setAttribute('text-anchor', anchor);
        node.setAttribute('font-size', '10');
        node.setAttribute('fill', color);
        node.textContent = content;
        svg.append(node);
      };

      // the ladder
      bands(ladder).forEach(function (size) {
        band(left + 4, size, '#cfd6de', size + ' bp');
        text(left - 8, y(size) + 3, String(size), 'end', '#6b7785');
      });
      text(left + 4 + (laneWidth - 20) / 2, top + height + 14, 'ladder', 'middle', '#6b7785');
      results.forEach(function (lane, index) {
        const x = left + laneWidth * (index + 1) + 4;
        lane.fragments.forEach(function (fragment) {
          band(x, fragment.size, lane.color, fragment.size + ' bp', function () {
            editor.updateEditor({ selectionLayer: { start: fragment.start, end: fragment.end } });
          });
        });
        text(x + (laneWidth - 20) / 2, top + height + 14, lane.label, 'middle', lane.color);
      });
      return svg;
    }

    // a ladder of your own: typed, or imported from a file (a text or CSV file with the sizes, or a JSON file)
    function ladderEditor() {
      const details = element('details', 'digest-ladders');
      details.append(element('summary', '', 'My ladders (' + Object.keys(customLadders).length + ')'));
      const note = element('p', 'digest-help', '');
      const nameInput = element('input', 'digest-input');
      nameInput.placeholder = 'Name of the ladder';
      const sizesInput = element('textarea', 'digest-input');
      sizesInput.rows = 3;
      sizesInput.placeholder = 'Sizes in bp: 3000 2000 1500 1000 ...';
      const store = function (found) {
        const names = Object.keys(found);
        names.forEach(function (name) {
          customLadders[name] = found[name];
        });
        saveCustomLadders(customLadders);
        if (names.length > 0) {
          ladder = names[0];
          save();
        }
        return names;
      };
      const saveButton = element('button', 'digest-add', 'Save the ladder');
      saveButton.type = 'button';
      saveButton.addEventListener('click', function () {
        const sizes = parseSizes(sizesInput.value);
        const name = nameInput.value.trim();
        if (name === '' || sizes.length === 0) {
          note.textContent = 'Give the ladder a name and at least one size.';
          return;
        }
        const found = {};
        found[name] = sizes;
        store(found);
        details.dataset.open = '1';
        render();
      });
      const importButton = element('button', 'digest-add', 'Import from a file...');
      importButton.type = 'button';
      const chooser = element('input');
      chooser.type = 'file';
      chooser.accept = '.txt,.csv,.tsv,.json,text/plain';
      chooser.hidden = true;
      importButton.addEventListener('click', function () {
        chooser.click();
      });
      chooser.addEventListener('change', async function () {
        const file = chooser.files && chooser.files[0];
        chooser.value = '';
        if (!file) {
          return;
        }
        const found = parseLadders(await file.text(), file.name);
        const names = store(found);
        details.dataset.open = '1';
        if (names.length === 0) {
          note.textContent = file.name + ' has no ladder: it should list sizes in bp, one ladder per line ("name: 1000, 500, 250").';
          return;
        }
        render();
      });
      const row = element('div', 'digest-controls');
      row.append(saveButton, importButton, chooser);
      details.append(nameInput, sizesInput, row, note);
      Object.keys(customLadders).forEach(function (name) {
        const line = element('div', 'digest-lane-top');
        line.append(element('span', '', name + ' (' + customLadders[name].length + ' bands)'));
        const remove = element('button', 'digest-remove', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', function () {
          delete customLadders[name];
          saveCustomLadders(customLadders);
          if (ladder === name) {
            ladder = 'GeneRuler 1 kb';
            save();
          }
          details.dataset.open = '1';
          render();
        });
        line.append(remove);
        details.append(line);
      });
      details.open = openLadders;
      details.addEventListener('toggle', function () {
        openLadders = details.open;
      });
      return details;
    }

    function render() {
      if (window.ToolSidebar.active() !== 'digest') {
        return;
      }
      panel.textContent = '';
      const state = cutsOf();
      panel.append(element('p', 'digest-help', state.length + ' bases, ' + (state.circular ? 'circular' : 'linear') + '. Add the enzymes of each combination; every combination is a lane of the gel.'));

      const results = [];
      lanes.forEach(function (lane, index) {
        const color = COLORS[index % COLORS.length];
        const card = element('div', 'digest-lane');
        card.style.borderLeftColor = color;
        const top = element('div', 'digest-lane-top');
        const name = element('strong', '', lane.enzymes.length === 0 ? 'Empty combination' : lane.enzymes.join(' + '));
        top.append(name);
        const remove = element('button', 'digest-remove', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', function () {
          lanes.splice(index, 1);
          if (lanes.length === 0) {
            lanes.push({ enzymes: [] });
          }
          save();
          render();
        });
        top.append(remove);
        card.append(top);

        const chips = element('div', 'digest-chips');
        lane.enzymes.forEach(function (enzyme) {
          const count = (state.cuts[enzyme] || []).length;
          const chip = element('span', 'digest-chip', enzyme + (count === 0 ? ' (no cut)' : ' · ' + count));
          const x = element('button', '', '×');
          x.type = 'button';
          x.setAttribute('aria-label', 'Remove ' + enzyme);
          x.addEventListener('click', function () {
            lane.enzymes = lane.enzymes.filter(function (e) {
              return e !== enzyme;
            });
            save();
            render();
          });
          chip.append(x);
          chips.append(chip);
        });
        card.append(chips);

        // add an enzyme: names that start with what is typed come first, with the number of cuts
        const input = element('input', 'digest-input');
        input.type = 'search';
        input.placeholder = 'Add an enzyme (EcoRI, HindIII...)';
        input.autocomplete = 'off';
        const options = element('div', 'digest-options');
        options.hidden = true;
        input.addEventListener('input', function () {
          const term = input.value.trim().toLowerCase();
          options.textContent = '';
          if (term === '') {
            options.hidden = true;
            return;
          }
          const names = Object.keys(state.cuts).concat(enzymeList.map(function (e) {
            return e.name;
          })).filter(function (n, i, all) {
            return all.indexOf(n) === i;
          }).filter(function (n) {
            return n.toLowerCase().indexOf(term) !== -1 && lane.enzymes.indexOf(n) === -1;
          }).sort(function (a, b) {
            const pa = a.toLowerCase().indexOf(term) === 0 ? 0 : 1;
            const pb = b.toLowerCase().indexOf(term) === 0 ? 0 : 1;
            return pa - pb || a.localeCompare(b);
          }).slice(0, 12);
          names.forEach(function (n) {
            const count = (state.cuts[n] || []).length;
            const option = element('button', '', n + '  ·  ' + (count === 0 ? 'no cut' : count + (count === 1 ? ' cut' : ' cuts')) + (vendorsOf(n) ? '  ·  ' + vendorsOf(n) : ''));
            option.type = 'button';
            option.addEventListener('click', function () {
              lane.enzymes.push(n);
              save();
              render();
            });
            options.append(option);
          });
          if (names.length === 0) {
            options.append(element('div', 'digest-none', 'No enzyme with this name.'));
          }
          options.hidden = false;
        });
        card.append(input, options);

        const done = lane.enzymes.length === 0 ? [] : digest(lane.enzymes, state);
        if (done.length > 0) {
          const list = element('div', 'digest-sizes');
          done.slice().sort(function (a, b) {
            return b.size - a.size;
          }).forEach(function (fragment) {
            const size = element('button', 'digest-size', fragment.size + ' bp');
            size.type = 'button';
            size.title = 'Select this fragment on the sequence (' + (fragment.start + 1) + '..' + (fragment.end + 1) + ')';
            size.addEventListener('click', function () {
              editor.updateEditor({ selectionLayer: { start: fragment.start, end: fragment.end } });
            });
            list.append(size);
          });
          card.append(list);
          results.push({ label: lane.enzymes.length > 2 ? lane.enzymes.slice(0, 2).join('+') + '+' : lane.enzymes.join('+'), color: color, fragments: done });
        }
        panel.append(card);
      });

      const controls = element('div', 'digest-controls');
      const add = element('button', 'digest-add', '+ Add a combination');
      add.type = 'button';
      add.addEventListener('click', function () {
        lanes.push({ enzymes: [] });
        save();
        render();
      });
      const duplicate = element('button', 'digest-add', 'Duplicate the last');
      duplicate.type = 'button';
      duplicate.addEventListener('click', function () {
        lanes.push({ enzymes: lanes[lanes.length - 1].enzymes.slice() });
        save();
        render();
      });
      const ladderSelect = element('select', 'digest-select');
      const addGroup = function (label, names) {
        if (names.length === 0) {
          return;
        }
        const group = element('optgroup');
        group.label = label;
        names.forEach(function (name) {
          const option = element('option', '', name);
          option.value = name;
          group.append(option);
        });
        ladderSelect.append(group);
      };
      Object.keys(LADDER_GROUPS).forEach(function (label) {
        addGroup(label, Object.keys(LADDER_GROUPS[label]));
      });
      addGroup('My ladders', Object.keys(customLadders));
      ladderSelect.value = ladder;
      ladderSelect.addEventListener('change', function () {
        ladder = ladderSelect.value;
        save();
        render();
      });
      const uncutLabel = element('label', 'digest-check');
      const uncut = element('input');
      uncut.type = 'checkbox';
      uncut.checked = showUncut;
      uncut.addEventListener('change', function () {
        showUncut = uncut.checked;
        save();
        render();
      });
      uncutLabel.append(uncut, document.createTextNode(' show the uncut plasmid'));
      controls.append(add, duplicate, ladderSelect, uncutLabel);
      panel.append(controls);
      panel.append(ladderEditor());

      if (showUncut) {
        results.unshift({ label: 'uncut', color: '#8a93a0', fragments: [{ size: state.length, start: 0, end: state.length - 1 }] });
      }
      if (results.length > 0) {
        panel.append(element('h4', '', 'Gel'));
        const wrap = element('div', 'digest-gel-wrap');
        wrap.append(gel(state, results));
        panel.append(wrap);
        panel.append(element('p', 'digest-help', 'Click a band or a size to select that fragment on the sequence.'));
      }
    }

    window.ToolSidebar.register({ id: 'digest', icon: 'digest', label: 'Compare digests', show: function (host) {
      panel = host;
      render();
    } });
  }

  window.DigestCompare = { setup: setup, fragments: fragments, parseLadders: parseLadders, parseSizes: parseSizes };
})();
