/**
 * The cloning panel of the tab page (tabs.js): the cloning tools (Gibson / In-Fusion, restriction, Golden Gate, Gateway) take their
 * sequences from the plasmids that are open in the tabs, so they live here, next to all of them, and not inside one editor frame.
 * It gives the tools window.CloningDocs (the open plasmids, their selections), a button in the tab bar that opens the panel, and
 * window.CloningOutput.saveTarget: the plasmid a tool made is added to the Database with its sequence file, its parents (the plasmids the
 * sequences came from, as lineage) and its primers, and opened in a new tab. Needs tabs.js (window.CloningTabs), tools-tab.js and the
 * cloning tools.
 */
(function () {
  'use strict';
  const tabsApi = window.CloningTabs;
  if (!tabsApi || !window.ToolsTab || !window.CloningOutput) {
    return;
  }
  const SEQUENCE_FILE = /\.(gb|gbk|gbff|genbank|fasta|fa|fna|dna)$/i;

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

  // ---- what is open ------------------------------------------------------------------------------------------------------------
  // a plasmid is named by the entry and the file of its tab: 'entry:<entry id>:<file name>'
  const docId = function (tab) {
    return 'entry:' + tab.entry + ':' + tab.file;
  };
  const entryOfDoc = function (id) {
    const match = /^entry:(\d+):/.exec(String(id || ''));
    return match ? Number(match[1]) : 0;
  };
  const editorOf = function (tab) {
    try {
      return tabsApi.frame(tab).sequenceEditor || null;
    } catch (error) {
      return null;
    }
  };

  window.CloningDocs = {
    list: function () {
      const current = tabsApi.current();
      return tabsApi.list().map(function (tab) {
        const editor = editorOf(tab);
        const data = editor ? editor.getState().sequenceData : null;
        return { id: docId(tab), name: tab.label.textContent, active: tab === current, length: data ? data.sequence.length : 0, circular: data ? !!data.circular : false, entry: tab.entry };
      });
    },
    // what the tools need of one: its sequence data, the selection (end included, start larger than end wraps) and the cursor
    get: function (id) {
      const tab = tabsApi.list().find(function (candidate) {
        return docId(candidate) === id;
      });
      const editor = tab ? editorOf(tab) : null;
      if (!editor) {
        return null;
      }
      const state = editor.getState();
      const selection = state.selectionLayer || {};
      return {
        id: id,
        entry: tab.entry,
        name: tab.label.textContent,
        data: state.sequenceData,
        selection: selection.start >= 0 && selection.end >= 0 ? { start: selection.start, end: selection.end } : null,
        caret: state.caretPosition >= 0 ? state.caretPosition : null,
        parents: [],
      };
    },
    active: function () {
      const current = tabsApi.current();
      return current ? docId(current) : null;
    },
    onChange: function () {
      // the tools read the plasmids when a button is clicked: nothing follows the changes
    },
  };

  // ---- adding the plasmid to the Database --------------------------------------------------------------------------------------
  const csrf = function () {
    return document.body.dataset.csrf || '';
  };
  const jsonHeaders = function () {
    return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf() };
  };

  async function plasmidModule() {
    const response = await fetch('../registry-modules.php', { credentials: 'same-origin' });
    const modules = (response.ok ? await response.json() : {}).modules || [];
    const found = modules.find(function (m) {
      return m.settings && m.settings.requires_sequence_file;
    }) || modules.find(function (m) {
      return /plasmid/i.test(m.title);
    });
    if (!found) {
      throw new Error('There is no module of plasmids to put it in.');
    }
    return found;
  }

  // the file of the entry that was just uploaded, as the tab page wants it
  async function newestSequenceFile(id) {
    const response = await fetch('../api/v2/inventory/' + id + '/uploads', { credentials: 'same-origin' });
    const files = (response.ok ? await response.json() : []).filter(function (file) {
      return Number(file.state) === 1 && SEQUENCE_FILE.test(file.real_name || '');
    });
    return files.length === 0 ? null : files.reduce(function (newest, file) {
      return Number(file.id) > Number(newest.id) ? file : newest;
    });
  }

  const where = function () {
    try {
      return window.localStorage.getItem('cloningDestination') === 'lab' ? 'lab' : 'none';
    } catch (error) {
      return 'none';
    }
  };

  // the choices next to the button: where the entry goes, whether the parents and the primers go with it
  function controls(form, spec) {
    const box = element('div');
    const place = element('select', 'tools-select');
    [['none', 'My entries (private, no number yet)'], ['lab', 'The lab database (it is locked)']].forEach(function (choice) {
      place.append(Object.assign(element('option', '', choice[1]), { value: choice[0] }));
    });
    place.value = where();
    place.addEventListener('change', function () {
      try {
        window.localStorage.setItem('cloningDestination', place.value);
      } catch (error) {
        // the choice is just not remembered
      }
    });
    const check = function (text, enabled) {
      const label = element('label', 'tool-muted');
      const input = element('input');
      input.type = 'checkbox';
      input.checked = enabled;
      input.disabled = !enabled;
      label.append(input, document.createTextNode(' ' + text));
      box.append(label);
      return input;
    };
    const known = (spec.parents || []).filter(function (parent) {
      return entryOfDoc(parent.id) > 0;
    });
    const parents = check('Made from ' + (known.length ? known.map(function (parent) {
      return parent.name;
    }).join(', ') : 'no entry of the Database (parents are not linked)'), known.length > 0);
    const primers = check('Add the ' + ((spec.primers || []).length) + ' primers to the Database and attach them', (spec.primers || []).length > 0);
    box.prepend(element('div', 'tool-muted', 'Where it goes'), place);
    const actions = form.querySelector('.tool-actions');
    form.insertBefore(box, actions);
    return function () {
      return { where: place.value, parents: parents.checked, primers: primers.checked };
    };
  }

  async function save(spec, text, settings) {
    const headers = jsonHeaders();
    const module = await plasmidModule();
    const made = await fetch('../api/v2/inventory', { method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({ category: module.id, title: spec.name, register: settings.where }) });
    if (!made.ok) {
      throw new Error('The entry could not be made (' + made.status + ').');
    }
    const id = Number((made.headers.get('Location') || '').split('/').pop());
    const fileName = spec.name.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60) || 'plasmid';
    const data = new FormData();
    data.append('file', new File([text], fileName + '.gb', { type: 'text/plain' }));
    const uploaded = await fetch('../api/v2/inventory/' + id + '/uploads', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf(), 'X-Requested-With': 'XMLHttpRequest' }, body: data });
    if (!uploaded.ok) {
      throw new Error('The entry ' + id + ' was made but its sequence could not be saved (' + uploaded.status + ').');
    }
    const notes = [];
    if (settings.parents) {
      let linked = 0;
      for (const parent of spec.parents || []) {
        const parentId = entryOfDoc(parent.id);
        if (parentId > 0 && parentId !== id) {
          const response = await fetch('../lineage.php', { method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({ action: 'add', entry: id, parent: parentId }) });
          linked += response.ok ? 1 : 0;
        }
      }
      notes.push(linked + ' parent' + (linked === 1 ? '' : 's') + ' linked');
    }
    if (settings.primers && window.PrimerTools && (spec.primers || []).length > 0) {
      let added = 0;
      for (const primer of spec.primers) {
        try {
          const primerId = await window.PrimerTools.createPrimer(primer.name, primer.sequence, / F$/.test(primer.name) || /\sF\s/.test(primer.name) ? true : (/ R$/.test(primer.name) ? false : null), spec.name, id);
          await window.PrimerTools.attach(id, primerId);
          added++;
        } catch (error) {
          notes.push(error.message || String(error));
        }
      }
      notes.push(added + ' primer' + (added === 1 ? '' : 's') + ' added');
    }
    if (settings.where === 'lab') {
      await fetch('../registry-lock.php', { method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({ id: id }) });
    }
    // the new plasmid is shown in a tab of its own
    const file = await newestSequenceFile(id);
    if (file) {
      tabsApi.add(id, new URLSearchParams({ entry: String(id), upload: String(file.id), f: file.long_name, name: file.real_name, storage: String(file.storage || 1) }).toString(), spec.name);
    }
    return 'Added to the Database (entry ' + id + ') and opened in a new tab' + (notes.length ? ': ' + notes.join(', ') : '') + '.';
  }

  window.CloningOutput.saveTarget = { label: 'Add to the Database and open', save: save, controls: controls };

  // ---- the panel ---------------------------------------------------------------------------------------------------------------
  const main = document.getElementById('main');
  const bar = document.getElementById('tab-bar');
  if (!main || !bar) {
    return;
  }
  const panel = element('aside');
  panel.id = 'cloning-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Cloning');
  const head = element('div', 'cloning-head');
  head.append(element('strong', '', 'Cloning'));
  const closer = element('button', 'cloning-close', '×');
  closer.type = 'button';
  closer.title = 'Close the cloning panel';
  head.append(closer);
  const host = element('div', 'cloning-host');
  host.append(element('p', 'tool-muted', 'The sequences come from the plasmids that are open in the tabs: open them, select what you want in one, then click the buttons here. The plasmid that is made is added to the Database with its parents and primers.'));
  panel.append(head, host);
  main.append(panel);

  // the Tools panel of the editor (tools-tab.js) fills a host through window.ToolSidebar: here the host is this panel
  let built = false;
  const build = function () {
    if (built) {
      return;
    }
    built = true;
    const previous = window.ToolSidebar;
    window.ToolSidebar = { register: function (definition) {
      definition.show(host);
    } };
    window.ToolsTab.setup(null, {});
    if (previous) {
      window.ToolSidebar = previous;
    } else {
      delete window.ToolSidebar;
    }
    // the title line of tools-tab.js is not needed here
    const help = host.querySelector('.digest-help');
    if (help) {
      help.remove();
    }
  };

  const button = element('button', 'cloning-open', 'Cloning');
  button.type = 'button';
  button.title = 'Gibson, In-Fusion, restriction, Golden Gate and Gateway cloning from the plasmids that are open';
  const toggle = function (show) {
    panel.hidden = !show;
    button.classList.toggle('active', show);
    if (show) {
      build();
    }
  };
  button.addEventListener('click', function () {
    toggle(panel.hidden);
  });
  closer.addEventListener('click', function () {
    toggle(false);
  });
  bar.append(button);
})();
