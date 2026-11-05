/**
 * Tabs of the sequence editor: each plasmid is its own editor page in a frame (so each keeps its own state and saves by itself),
 * the bar on top switches between them. File > Open of an editor asks this page (postMessage) for the list of the Database.
 */
(function () {
  'use strict';
  const bar = document.getElementById('tab-list');
  const stage = document.getElementById('stage');
  const panel = document.getElementById('open-panel');
  const search = document.getElementById('open-search');
  const results = document.getElementById('open-results');
  const SEQUENCE_FILE = /\.(gb|gbk|gbff|genbank|fasta|fa|fna|dna)$/i;
  const tabs = [];
  let current = null;

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

  function select(tab) {
    current = tab;
    tabs.forEach(function (other) {
      other.frame.hidden = other !== tab;
      other.button.classList.toggle('active', other === tab);
    });
    document.title = tab.label.textContent + ' - Sequence editor';
  }

  function frameOf(tab) {
    return tab.frame.contentWindow;
  }

  function isDirty(tab) {
    try {
      const state = frameOf(tab).document.getElementById('save-state');
      return Boolean(state) && state.classList.contains('dirty');
    } catch (error) {
      return false;
    }
  }

  function close(tab) {
    if (isDirty(tab) && !window.confirm('This plasmid has changes that are not saved yet. Close it anyway?')) {
      return;
    }
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);
    tab.frame.remove();
    tab.button.remove();
    if (tabs.length === 0) {
      window.location.href = '../registry.php?mode=view&id=' + tab.entry;
      return;
    }
    if (current === tab) {
      select(tabs[Math.min(index, tabs.length - 1)]);
    }
  }

  function add(entry, query, title) {
    // the same file of the same entry is one tab, whatever the link that opened it looked like
    const file = new URLSearchParams(query).get('name') || '';
    const existing = tabs.find(function (tab) {
      return tab.entry === entry && tab.file === file;
    });
    if (existing) {
      select(existing);
      return;
    }
    const frame = element('iframe', 'editor-frame');
    frame.src = 'index.php?' + query + '&embedded=1';
    frame.title = title || 'Plasmid';
    stage.appendChild(frame);
    const button = element('div', 'tab');
    const label = element('span', 'tab-label', title || 'Plasmid');
    const mark = element('span', 'tab-dirty', '●');
    mark.hidden = true;
    const closer = element('button', 'tab-close', '×');
    closer.type = 'button';
    closer.title = 'Close this tab';
    button.append(label, mark, closer);
    bar.appendChild(button);
    const tab = { entry: entry, file: file, query: query, frame: frame, button: button, label: label, mark: mark };
    tabs.push(tab);
    button.addEventListener('click', function (event) {
      if (event.target === closer) {
        close(tab);
        return;
      }
      select(tab);
    });
    select(tab);
  }

  // the name of the entry and whether it has unsaved changes follow the editor of each tab
  window.setInterval(function () {
    tabs.forEach(function (tab) {
      try {
        const doc = frameOf(tab).document;
        const name = doc.getElementById('entry-title');
        if (name && name.textContent && tab.label.textContent !== name.textContent) {
          tab.label.textContent = name.textContent;
          tab.button.title = name.textContent;
          if (tab === current) {
            document.title = name.textContent + ' - Sequence editor';
          }
        }
        tab.mark.hidden = !isDirty(tab);
      } catch (error) {
        // the frame is still loading
      }
    });
  }, 700);

  // File > Open
  let searchRun = 0;
  async function find(text) {
    const run = ++searchRun;
    results.textContent = 'Searching...';
    let entries = [];
    try {
      const response = await fetch('../api/v2/inventory?limit=25&q=' + encodeURIComponent(text), { credentials: 'same-origin' });
      entries = response.ok ? await response.json() : [];
    } catch (error) {
      entries = [];
    }
    const rows = await Promise.all(entries.map(async function (entry) {
      try {
        const response = await fetch('../api/v2/inventory/' + entry.id + '/uploads', { credentials: 'same-origin' });
        const files = (response.ok ? await response.json() : []).filter(function (file) {
          return Number(file.state) === 1 && SEQUENCE_FILE.test(file.real_name || '');
        });
        return { entry: entry, files: files };
      } catch (error) {
        return { entry: entry, files: [] };
      }
    }));
    if (run !== searchRun) {
      return;
    }
    results.textContent = '';
    const withFiles = rows.filter(function (row) {
      return row.files.length > 0;
    });
    if (withFiles.length === 0) {
      results.appendChild(element('p', 'open-empty', 'No entry with a sequence file found.'));
      return;
    }
    withFiles.forEach(function (row) {
      // the newest file of each name
      const newest = {};
      row.files.forEach(function (file) {
        if (!newest[file.real_name] || Number(file.id) > Number(newest[file.real_name].id)) {
          newest[file.real_name] = file;
        }
      });
      Object.keys(newest).forEach(function (name) {
        const file = newest[name];
        const item = element('button', 'open-item');
        item.type = 'button';
        item.append(
          element('strong', '', (row.entry.custom_id ? '#' + row.entry.custom_id + ' ' : '') + row.entry.title),
          element('span', 'open-file', name),
        );
        item.addEventListener('click', function () {
          const query = new URLSearchParams({
            entry: String(row.entry.id),
            upload: String(file.id),
            f: file.long_name,
            name: file.real_name,
            storage: String(file.storage || 1),
          }).toString();
          add(row.entry.id, query, row.entry.title);
          item.classList.add('opened');
        });
        results.appendChild(item);
      });
    });
  }

  // the panel stays open while plasmids are opened one after the other
  let panelLoaded = false;
  function showPanel(show) {
    panel.hidden = !show;
    if (show) {
      search.focus();
      if (!panelLoaded) {
        panelLoaded = true;
        find('');
      }
    }
  }

  let typing = 0;
  search.addEventListener('input', function () {
    window.clearTimeout(typing);
    typing = window.setTimeout(function () {
      find(search.value.trim());
    }, 250);
  });
  document.getElementById('open-close').addEventListener('click', function () {
    showPanel(false);
  });
  window.addEventListener('message', function (event) {
    if (event.origin === window.location.origin && event.data && event.data.type === 'elab-open-from-database') {
      // the button of the toolbar opens and closes the panel, the File menu opens it
      showPanel(event.data.toggle ? panel.hidden : true);
    }
  });

  const start = JSON.parse(document.getElementById('first-tab').textContent);
  add(start.entry, start.query, start.title);
}());
