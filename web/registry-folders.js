/**
 * The folders of the database: a tree of their own, apart from the folders of the experiments and the resources.
 * - a "Database folders" tab in the rail of the side panels, with the tree: all entries, unfiled, the folders (with their number of
 *   entries); a click filters the list, a folder can be made, renamed, moved (drag it) and removed; entries are dragged from the
 *   list on a folder;
 * - on the page of an entry: its folder as a path (a link to the list of that folder), and a choice of the folder on the edit page.
 * The server part is registry-folders.php.
 */
(function () {
  'use strict';
  if (window.RegistryFolders) {
    return;
  }
  const SCOPE_KEY = 'registry-folder-scope';
  const OPEN_KEY = 'registry-folder-open';
  const isList = /registry\.php$/.test(window.location.pathname) && !/mode=(view|edit)/.test(window.location.search);
  const params = new URLSearchParams(window.location.search);
  const entryId = Number(params.get('id')) || 0;
  const mode = params.get('mode') || '';

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

  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  };

  async function call(body) {
    const response = await fetch('registry-folders.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
      body: JSON.stringify(body),
    });
    const answer = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      throw new Error(answer.error || 'The request failed (' + response.status + ').');
    }
    return answer;
  }

  let state = { folders: [], assignments: {}, userid: 0 };
  const listeners = [];
  async function load() {
    const response = await fetch('registry-folders.php', { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error('The folders could not be loaded.');
    }
    state = await response.json();
    listeners.forEach(function (listener) {
      listener();
    });
  }

  const byId = function (id) {
    return state.folders.find(function (folder) {
      return folder.id === id;
    });
  };
  const childrenOf = function (parent) {
    return state.folders.filter(function (folder) {
      return folder.parent_id === parent;
    }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  };
  // the folder and all the folders inside it
  const subtree = function (id) {
    const found = new Set([id]);
    const queue = [id];
    while (queue.length > 0) {
      childrenOf(queue.shift()).forEach(function (child) {
        found.add(child.id);
        queue.push(child.id);
      });
    }
    return found;
  };
  const pathOf = function (id) {
    const names = [];
    let folder = byId(id);
    for (let guard = 0; folder && guard < 100; guard++) {
      names.unshift(folder);
      folder = folder.parent_id === null ? null : byId(folder.parent_id);
    }
    return names;
  };

  // ---- what is chosen in the panel: all, unfiled or a folder
  const readScope = function () {
    try {
      return window.localStorage.getItem(SCOPE_KEY) || 'all';
    } catch (error) {
      return 'all';
    }
  };
  let scope = readScope();
  const setScope = function (value) {
    scope = String(value);
    try {
      window.localStorage.setItem(SCOPE_KEY, scope);
    } catch (error) {
      // not remembered
    }
    listeners.forEach(function (listener) {
      listener();
    });
  };
  const openSet = new Set();
  try {
    JSON.parse(window.localStorage.getItem(OPEN_KEY) || '[]').forEach(function (id) {
      openSet.add(Number(id));
    });
  } catch (error) {
    // all closed
  }
  const saveOpen = function () {
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify(Array.from(openSet)));
    } catch (error) {
      // not remembered
    }
  };

  // ---- the filter of the list: the rows of the entries that are not in the chosen folder are hidden
  function entryVisible(id) {
    if (scope === 'all') {
      return true;
    }
    const folder = state.assignments[id];
    if (scope === 'unfiled') {
      return folder === undefined;
    }
    return folder !== undefined && subtree(Number(scope)).has(folder);
  }

  let chip = null;
  function filterList() {
    if (!isList) {
      return;
    }
    const table = document.querySelector('.expandable-table');
    if (!table) {
      return;
    }
    const visible = [];
    table.querySelectorAll('tbody tr').forEach(function (row) {
      if (row.classList.contains('expandable-row')) {
        const id = Number((row.querySelector('.id-cell') || {}).textContent);
        const show = entryVisible(id);
        row.hidden = !show;
        row.dataset.entry = String(id);
        row.draggable = true;
        row.dataset.folderHidden = show ? '' : '1';
        if (show) {
          visible.push(id);
        }
      } else if (row.classList.contains('expandable-detail-row')) {
        // the opened part of a row follows its row
        const owner = row.previousElementSibling;
        row.hidden = !!(owner && owner.dataset.folderHidden === '1');
      }
    });
    // a line above the list tells what the filter is
    const holder = table.closest('.table-responsive');
    if (!holder || !holder.parentNode) {
      return;
    }
    if (!chip) {
      chip = element('div', 'rf-chip');
    }
    if (scope === 'all') {
      chip.remove();
      return;
    }
    chip.textContent = '';
    const label = scope === 'unfiled' ? 'Unfiled entries' : pathOf(Number(scope)).map(function (folder) {
      return folder.name;
    }).join(' / ');
    chip.append(element('i', 'fas fa-folder mr-1'), document.createTextNode(label + ' (' + visible.length + ')'));
    const clear = element('button', 'rf-chip-clear', '×');
    clear.type = 'button';
    clear.title = 'Show all the entries';
    clear.setAttribute('aria-label', 'Show all the entries');
    clear.addEventListener('click', function () {
      setScope('all');
    });
    chip.append(clear);
    if (chip.nextSibling !== holder) {
      holder.parentNode.insertBefore(chip, holder);
    }
  }

  // ---- the panel
  let panel = null;
  let message = null;
  const dragged = { kind: '', id: 0 };

  function say(text, error) {
    if (!message) {
      return;
    }
    message.textContent = text;
    message.className = 'rf-message' + (error ? ' rf-error' : '');
    window.clearTimeout(say.timer);
    if (text) {
      say.timer = window.setTimeout(function () {
        message.textContent = '';
      }, 6000);
    }
  }

  async function act(body, done) {
    try {
      await call(body);
      await load();
      if (done) {
        done();
      }
    } catch (error) {
      say(error.message || String(error), true);
    }
  }

  // a row of the tree: the name with its number, and the actions that show when the pointer is on it
  function row(label, count, selected, depth, onSelect) {
    const line = element('div', 'rf-row' + (selected ? ' selected' : ''));
    line.style.paddingLeft = (8 + depth * 14) + 'px';
    const main = element('button', 'rf-main');
    main.type = 'button';
    main.addEventListener('click', onSelect);
    line.append(main);
    return { line: line, main: main, label: label, count: count };
  }

  function dropTarget(line, accept, onDrop) {
    line.addEventListener('dragover', function (event) {
      if (dragged.kind && accept()) {
        event.preventDefault();
        line.classList.add('drop');
      }
    });
    line.addEventListener('dragleave', function () {
      line.classList.remove('drop');
    });
    line.addEventListener('drop', function (event) {
      event.preventDefault();
      line.classList.remove('drop');
      if (dragged.kind && accept()) {
        onDrop();
      }
    });
  }

  function renderPanel() {
    if (!panel) {
      return;
    }
    const body = panel.querySelector('.rf-body');
    body.textContent = '';
    const total = Object.keys(state.assignments).length;
    const unfiledCount = null;

    const make = function (label, count, key, icon) {
      const r = row(label, count, scope === key, 0, function () {
        setScope(key);
      });
      r.main.append(element('i', 'fas ' + icon + ' fa-fw mr-2'), element('span', 'rf-name', label));
      if (count !== null) {
        r.main.append(element('span', 'rf-count', String(count)));
      }
      return r;
    };
    const all = make('All entries', null, 'all', 'fa-layer-group');
    // everything can be taken out of a folder by dropping it on "Unfiled"
    const unfiled = make('Unfiled', unfiledCount, 'unfiled', 'fa-inbox');
    dropTarget(unfiled.line, function () {
      return dragged.kind === 'entry';
    }, function () {
      act({ action: 'assign', entry: dragged.id, folder: null }, function () {
        say('The entry is unfiled.');
      });
    });
    dropTarget(all.line, function () {
      return dragged.kind === 'folder';
    }, function () {
      act({ action: 'move', id: dragged.id, parent: null }, function () {
        say('The folder is at the top.');
      });
    });
    body.append(all.line, unfiled.line);
    body.append(element('div', 'rf-title', 'Folders'));

    const tree = element('div', 'rf-tree');
    const add = function (parent, depth) {
      childrenOf(parent).forEach(function (folder) {
        const kids = childrenOf(folder.id);
        const opened = openSet.has(folder.id);
        const r = row(folder.name, folder.entries, scope === String(folder.id), depth, function () {
          setScope(folder.id);
        });
        const caret = element('span', 'rf-caret', kids.length === 0 ? '' : (opened ? '▾' : '▸'));
        if (kids.length > 0) {
          caret.addEventListener('click', function (event) {
            event.stopPropagation();
            if (openSet.has(folder.id)) {
              openSet.delete(folder.id);
            } else {
              openSet.add(folder.id);
            }
            saveOpen();
            renderPanel();
          });
        }
        r.main.append(caret, element('i', 'fas ' + (opened && kids.length > 0 ? 'fa-folder-open' : 'fa-folder') + ' fa-fw mr-1'), element('span', 'rf-name', folder.name), element('span', 'rf-count', String(folder.entries)));
        r.line.draggable = folder.mine;
        r.line.addEventListener('dragstart', function (event) {
          dragged.kind = 'folder';
          dragged.id = folder.id;
          event.dataTransfer.setData('text/plain', folder.name);
          event.dataTransfer.effectAllowed = 'move';
        });
        r.line.addEventListener('dragend', function () {
          dragged.kind = '';
        });
        dropTarget(r.line, function () {
          return dragged.kind === 'entry' || (dragged.kind === 'folder' && dragged.id !== folder.id);
        }, function () {
          if (dragged.kind === 'entry') {
            act({ action: 'assign', entry: dragged.id, folder: folder.id }, function () {
              say('The entry is in ' + folder.name + '.');
            });
          } else {
            openSet.add(folder.id);
            saveOpen();
            act({ action: 'move', id: dragged.id, parent: folder.id }, function () {
              say('The folder is in ' + folder.name + '.');
            });
          }
        });
        const actions = element('span', 'rf-actions');
        const button = function (icon, title, handler) {
          const b = element('button', 'rf-action');
          b.type = 'button';
          b.title = title;
          b.setAttribute('aria-label', title + ' ' + folder.name);
          b.append(element('i', 'fas ' + icon + ' fa-fw'));
          b.addEventListener('click', function (event) {
            event.stopPropagation();
            handler(b);
          });
          actions.append(b);
        };
        button('fa-plus', 'New folder in', function () {
          openSet.add(folder.id);
          saveOpen();
          newFolderInput(folder.id);
        });
        if (folder.mine) {
          button('fa-pencil-alt', 'Rename', function () {
            renameInput(r.main, folder);
          });
          button('fa-trash', 'Remove', function (b) {
            // a second click removes: no native box that can be blocked
            if (b.dataset.armed !== '1') {
              b.dataset.armed = '1';
              b.classList.add('armed');
              b.title = 'Click again to remove the folder and the folders in it';
              window.setTimeout(function () {
                b.dataset.armed = '';
                b.classList.remove('armed');
              }, 3500);
              return;
            }
            act({ action: 'delete', id: folder.id }, function () {
              if (scope === String(folder.id)) {
                setScope('all');
              }
              say('The folder is removed; its entries are unfiled.');
            });
          });
        }
        r.line.append(actions);
        tree.append(r.line);
        if (opened) {
          add(folder.id, depth + 1);
        }
      });
    };
    add(null, 0);
    if (state.folders.length === 0) {
      tree.append(element('p', 'rf-empty', 'No folder yet.'));
    }
    body.append(tree);

    const create = element('div', 'rf-create');
    create.id = 'rfCreate';
    body.append(create);
    renderCreate(create, scope !== 'all' && scope !== 'unfiled' ? Number(scope) : null);
    message = element('p', 'rf-message');
    body.append(message);
    // the number of the entries that are not in a folder is known from the list
    void total;
  }

  // the field to make a folder, in the chosen folder or at the top
  function renderCreate(holder, parent) {
    holder.textContent = '';
    const where = parent === null ? 'at the top' : 'in ' + (byId(parent) ? byId(parent).name : 'the folder');
    const input = element('input', 'rf-input');
    input.type = 'text';
    input.placeholder = 'New folder ' + where;
    input.setAttribute('aria-label', 'Name of the new folder');
    const add = element('button', 'rf-button', 'Add');
    add.type = 'button';
    const submit = function () {
      const name = input.value.trim();
      if (name === '') {
        return;
      }
      input.value = '';
      act({ action: 'create', name: name, parent: parent }, function () {
        if (parent !== null) {
          openSet.add(parent);
          saveOpen();
        }
        renderPanel();
      });
    };
    add.addEventListener('click', submit);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        submit();
      }
    });
    holder.append(input, add);
    return input;
  }

  function newFolderInput(parent) {
    const holder = panel.querySelector('#rfCreate');
    if (holder) {
      const input = renderCreate(holder, parent);
      input.focus();
    }
  }

  function renameInput(main, folder) {
    const input = element('input', 'rf-input rf-rename');
    input.type = 'text';
    input.value = folder.name;
    main.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = function (save) {
      if (done) {
        return;
      }
      done = true;
      if (save && input.value.trim() !== '' && input.value.trim() !== folder.name) {
        act({ action: 'rename', id: folder.id, name: input.value.trim() });
      } else {
        renderPanel();
      }
    };
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        finish(true);
      } else if (event.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('blur', function () {
      finish(true);
    });
  }

  // ---- the panel in the rail of the side panels
  const WIDTH_PROPERTY = '--side-panel-width';
  function showPanel(open) {
    const opener = document.getElementById('registryFoldersPanelOpener');
    if (open) {
      // the tabs share one panel viewport: the others are closed
      document.querySelectorAll('.side-panel').forEach(function (other) {
        if (other.id === panel.id) {
          return;
        }
        other.setAttribute('hidden', '');
        const otherOpener = document.getElementById(other.id + 'Opener');
        if (otherOpener) {
          otherOpener.classList.add('sidepanel-closed');
          otherOpener.classList.remove('sidepanel-opened');
          otherOpener.setAttribute('aria-expanded', 'false');
        }
      });
      const container = document.getElementById('container');
      if (container) {
        container.style.width = 'calc(100% - var(' + WIDTH_PROPERTY + ', max(24%, 330px)))';
        container.style.marginLeft = 'var(' + WIDTH_PROPERTY + ', max(24%, 330px))';
      }
      panel.removeAttribute('hidden');
      renderPanel();
    } else {
      panel.setAttribute('hidden', '');
      const container = document.getElementById('container');
      if (container) {
        container.style.width = '100%';
        container.style.marginLeft = 'auto';
      }
    }
    if (opener) {
      opener.classList.toggle('sidepanel-opened', open);
      opener.classList.toggle('sidepanel-closed', !open);
      opener.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    window.dispatchEvent(new Event('resize'));
  }

  function build() {
    const rail = document.getElementById('sidepanel-buttons');
    if (!rail || document.getElementById('registryFoldersPanel')) {
      return;
    }
    panel = element('div', 'side-panel rf-panel');
    panel.id = 'registryFoldersPanel';
    panel.setAttribute('hidden', '');
    const header = element('div', 'rf-header');
    header.append(element('h3', '', 'Database folders'));
    const close = element('button', 'rf-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.append(element('i', 'fas fa-times'));
    close.addEventListener('click', function () {
      showPanel(false);
    });
    header.append(close);
    panel.append(header, element('div', 'rf-body'));
    const first = document.getElementById('foldersPanel');
    if (first && first.parentNode) {
      first.parentNode.insertBefore(panel, first.nextSibling);
    } else {
      document.getElementById('realContainer').before(panel);
    }
    const opener = element('button', 'sidepanel-btn sidepanel-closed');
    opener.type = 'button';
    opener.id = 'registryFoldersPanelOpener';
    opener.title = 'Database folders';
    opener.setAttribute('aria-label', 'Database folders');
    opener.setAttribute('aria-expanded', 'false');
    opener.append(element('i', 'fas fa-folder-tree'));
    opener.addEventListener('click', function () {
      showPanel(panel.hasAttribute('hidden'));
    });
    // on the pages of the database the folders are those of the database: the tab of the folders of the experiments is not offered
    const experiments = document.getElementById('foldersPanelOpener');
    if (experiments) {
      experiments.hidden = true;
      experiments.before(opener);
    } else {
      rail.prepend(opener);
    }
    listeners.push(function () {
      if (!panel.hasAttribute('hidden')) {
        renderPanel();
      }
    });
  }

  // ---- the page of an entry: its folder
  function entryFolder() {
    const holder = element('div', 'd-flex mb-2 align-items-center rf-entry');
    holder.append(element('span', 'rf-entry-label', 'Folder'));
    const value = element('span', 'rf-entry-value');
    holder.append(value);
    const draw = function () {
      value.textContent = '';
      const id = state.assignments[entryId];
      if (mode === 'edit') {
        const select = element('select', 'form-control form-control-sm rf-select');
        select.setAttribute('aria-label', 'Folder of this entry');
        const none = element('option', '', 'Unfiled');
        none.value = '';
        select.append(none);
        const walk = function (parent, depth) {
          childrenOf(parent).forEach(function (folder) {
            const option = element('option', '', '  '.repeat(depth) + folder.name);
            option.value = String(folder.id);
            select.append(option);
            walk(folder.id, depth + 1);
          });
        };
        walk(null, 0);
        select.value = id === undefined ? '' : String(id);
        select.addEventListener('change', function () {
          call({ action: 'assign', entry: entryId, folder: select.value === '' ? null : Number(select.value) }).then(load).catch(function (error) {
            select.value = id === undefined ? '' : String(id);
            value.append(element('span', 'text-danger ml-2', error.message));
          });
        });
        value.append(select);
        return;
      }
      if (id === undefined) {
        value.append(element('span', 'text-muted', 'Unfiled'));
        return;
      }
      pathOf(id).forEach(function (folder, index) {
        if (index > 0) {
          value.append(document.createTextNode(' / '));
        }
        const link = element('a', '', folder.name);
        link.href = 'registry.php';
        link.title = 'Show the entries of this folder';
        link.addEventListener('click', function () {
          try {
            window.localStorage.setItem(SCOPE_KEY, String(folder.id));
          } catch (error) {
            // the list opens unfiltered
          }
        });
        value.append(link);
      });
    };
    listeners.push(draw);
    draw();
    return holder;
  }

  function placeEntryFolder() {
    if (!entryId || (mode !== 'view' && mode !== 'edit') || document.querySelector('.rf-entry')) {
      return;
    }
    // under the owner and the team on the view page, after the tags on the edit page
    const rows = [...document.querySelectorAll('#realContainer div.d-flex.mb-2.align-items-center')];
    const team = rows.find(function (node) {
      return /^\s*Team\b/.test(node.textContent);
    });
    const tags = document.getElementById('tags_div') || (document.querySelector('input[placeholder="Add a tag"]') || {}).closest && document.querySelector('input[placeholder="Add a tag"]').closest('div.row, div.d-flex, div');
    const holder = entryFolder();
    if (team) {
      team.after(holder);
    } else if (tags && tags.parentNode) {
      tags.parentNode.insertBefore(holder, tags);
    }
  }

  const style = element('style');
  style.textContent = `
.rf-panel { display: flex; flex-direction: column; }
.rf-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1rem 0.5rem; }
.rf-header h3 { margin: 0; font-size: 1.25rem; }
.rf-close { border: 0; background: transparent; color: inherit; font-size: 1.1rem; cursor: pointer; }
.rf-body { padding: 0.5rem 0.75rem 1rem; overflow-y: auto; }
.rf-title { margin: 0.9rem 0 0.3rem 0.5rem; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.65; }
.rf-row { position: relative; display: flex; align-items: center; border-radius: 6px; }
.rf-row:hover { background: rgba(255, 255, 255, 0.08); }
.rf-row.selected { background: rgba(88, 150, 255, 0.28); }
.rf-row.drop { outline: 2px dashed #8ab4ff; outline-offset: -2px; }
.rf-main { flex: 1; display: flex; align-items: center; min-width: 0; padding: 0.3rem 0.4rem 0.3rem 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.rf-caret { width: 0.9rem; flex: 0 0 0.9rem; font-size: 0.75rem; opacity: 0.75; }
.rf-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rf-count { margin-left: 0.4rem; font-size: 0.75rem; opacity: 0.65; }
.rf-actions { display: none; padding-right: 0.2rem; }
.rf-row:hover .rf-actions { display: inline-flex; }
.rf-action { border: 0; background: transparent; color: inherit; opacity: 0.8; padding: 0 0.25rem; cursor: pointer; }
.rf-action:hover { opacity: 1; }
.rf-action.armed { color: #ff8a7a; opacity: 1; }
.rf-empty { margin: 0.4rem 0.6rem; font-size: 0.85rem; opacity: 0.65; }
.rf-create { display: flex; gap: 0.35rem; margin: 0.9rem 0.25rem 0; }
.rf-input { flex: 1; min-width: 0; padding: 0.25rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 6px; background: rgba(255, 255, 255, 0.08); color: inherit; font-size: 0.85rem; }
.rf-button { border: 1px solid rgba(255, 255, 255, 0.4); border-radius: 6px; background: transparent; color: inherit; padding: 0.2rem 0.7rem; cursor: pointer; }
.rf-message { margin: 0.6rem 0.4rem 0; font-size: 0.82rem; opacity: 0.9; }
.rf-message.rf-error { color: #ff8a7a; }
.rf-chip { display: inline-flex; align-items: center; margin: 0.3rem 0 0.4rem; padding: 0.15rem 0.3rem 0.15rem 0.7rem; border: 1px solid #c4cad1; border-radius: 1rem; background: #eef3fb; color: #1d4c96; font-size: 0.85rem; }
.rf-chip-clear { margin-left: 0.4rem; border: 0; background: transparent; color: inherit; font-size: 1.1rem; line-height: 1; cursor: pointer; }
.rf-entry-label { min-width: 5.5rem; color: #6b7785; }
.rf-select { width: auto; min-width: 12rem; }
tr.expandable-row[draggable="true"] { cursor: grab; }
`;
  document.head.append(style);

  window.RegistryFolders = { reload: load };

  function start() {
    build();
    load().then(function () {
      placeEntryFolder();
      filterList();
    }).catch(function () {
      // the folders are not shown
    });
    listeners.push(filterList);
    // the list is drawn again when it is sorted, filtered or reloaded: the filter of the folder is applied again
    let pending = 0;
    new MutationObserver(function () {
      window.clearTimeout(pending);
      pending = window.setTimeout(function () {
        filterList();
        placeEntryFolder();
      }, 80);
    }).observe(document.body, { childList: true, subtree: true });
    // an entry of the list is dragged on a folder of the panel
    document.addEventListener('dragstart', function (event) {
      const rowEl = event.target.closest ? event.target.closest('tr.expandable-row') : null;
      if (!rowEl || !rowEl.dataset.entry) {
        return;
      }
      dragged.kind = 'entry';
      dragged.id = Number(rowEl.dataset.entry);
      event.dataTransfer.setData('text/plain', rowEl.dataset.entry);
      event.dataTransfer.effectAllowed = 'move';
      // the panel is opened to drop on it
      if (panel && panel.hasAttribute('hidden')) {
        showPanel(true);
      }
    });
    document.addEventListener('dragend', function () {
      dragged.kind = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
