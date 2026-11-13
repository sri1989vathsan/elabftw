/**
 * Planned entries of the database (see planned.php): things that are not made or ordered yet. On the list page of the Database a
 * "My planned" tab shows the planned entries of the user and a form to plan a new one; on the page of a planned entry a bar says
 * it is planned (no number yet, private) and "Mark as ready" gives it the next number of its module. Needs nothing else.
 */
(function () {
  'use strict';
  if (!document.querySelector('link[href^="planned.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    // a version in the address: the browser asks again when the file changes (the hour is enough for a stylesheet)
    link.href = 'planned.css?v=' + Math.floor(Date.now() / 3600000);
    document.head.append(link);
  }
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : (document.body.dataset.csrf || '');
  };

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

  async function call(options) {
    const response = await fetch('planned.php', Object.assign({ credentials: 'same-origin' }, options || {}));
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'The request failed.');
    }
    return body;
  }
  const post = function (payload) {
    return call({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify(payload) });
  };

  // ---- the list page: a tab "My planned" with the planned entries and a form to plan one
  // the switch between All entries (the registered Database) and My entries (everything of the user, the ones without a number
  // included): it sets or removes planned=1 in the address and keeps the module and the folder
  function viewSwitch(nav) {
    const params = new URLSearchParams(location.search);
    const mine = params.get('planned') === '1';
    const box = element('div', 'btn-group btn-group-sm view-switch mt-2');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Which entries');
    const go = function (wantMine) {
      const next = new URLSearchParams(location.search);
      if (wantMine) {
        next.set('planned', '1');
      } else {
        next.delete('planned');
      }
      location.search = next.toString();
    };
    [['All entries', false, 'The Database: the registered entries of everyone'], ['My entries', true, 'Everything of yours, with the entries that have no number yet (planned and intermediates)']].forEach(function (item) {
      const b = element('button', 'btn btn-outline-primary' + (mine === item[1] ? ' active' : ''), item[0]);
      b.type = 'button';
      b.title = item[2];
      b.setAttribute('aria-pressed', mine === item[1] ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (mine !== item[1]) {
          go(item[1]);
        }
      });
      box.append(b);
    });
    nav.insertAdjacentElement('beforebegin', box);
    // in My entries: the toggle In database filters the entries by whether they are in the lab Database
    if (mine) {
      const toggle = element('div', 'btn-group btn-group-sm ml-2 mt-2 id-filter');
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', 'In database');
      const current = params.get('idstate') || '';
      [['', 'All', 'All of my entries'], ['lab', 'In database', 'Only the entries that are in the lab Database'], ['notlab', 'Not in database', 'Only the entries that are not in the lab Database: planned, intermediates and the ones in my database only']].forEach(function (item) {
        const b2 = element('button', 'btn btn-outline-secondary' + (current === item[0] ? ' active' : ''), item[1]);
        b2.type = 'button';
        b2.title = item[2];
        b2.setAttribute('aria-pressed', current === item[0] ? 'true' : 'false');
        b2.addEventListener('click', function () {
          const next = new URLSearchParams(location.search);
          if (item[0]) {
            next.set('idstate', item[0]);
          } else {
            next.delete('idstate');
          }
          location.search = next.toString();
        });
        toggle.append(b2);
      });
      box.insertAdjacentElement('afterend', toggle);
    }
    // the entry pages remember which of the two the list was in
    try {
      sessionStorage.setItem('registryMine', mine ? '1' : '0');
    } catch (error) {
      // no storage: the entry goes back to its module
    }
    // the links of the modules and of the folders keep the choice
    if (mine) {
      const keep = function (link) {
        const url = new URL(link.getAttribute('href'), location.href);
        if (/registry\.php$/.test(url.pathname) && !url.searchParams.has('planned') && !url.searchParams.has('id')) {
          url.searchParams.set('planned', '1');
          link.setAttribute('href', url.pathname.replace(/^\//, '') + url.search);
        }
      };
      nav.querySelectorAll('a[href]').forEach(keep);
      const rewrite = function () {
        document.querySelectorAll('#foldersPanel a[href], .folder-path-bar a[href]').forEach(keep);
      };
      rewrite();
      document.addEventListener('elabftw:folders-panel-loaded', rewrite);
      new MutationObserver(rewrite).observe(document.body, { childList: true, subtree: true });
    }
    return mine;
  }

  // the list page: the switch between All entries and My entries, and in My entries the toggle In database
  function listPage(nav) {
    viewSwitch(nav);
  }

  // ---- batch import and export of the entries of the module that is open
  // a CSV file: the delimiter is found from the first line, a value can be in quotes and have line breaks
  function parseCsv(text) {
    const source = text.replace(/^\uFEFF/, '');
    const firstLine = source.split(/\r?\n/)[0] || '';
    const delimiter = [',', ';', '\t'].map(function (d) {
      return [d, firstLine.split(d).length];
    }).sort(function (a, b) {
      return b[1] - a[1];
    })[0][0];
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (quoted) {
        if (c === '"' && source[i + 1] === '"') {
          value += '"';
          i++;
        } else if (c === '"') {
          quoted = false;
        } else {
          value += c;
        }
      } else if (c === '"') {
        quoted = true;
      } else if (c === delimiter) {
        row.push(value);
        value = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && source[i + 1] === '\n') {
          i++;
        }
        row.push(value);
        value = '';
        rows.push(row);
        row = [];
      } else {
        value += c;
      }
    }
    if (value !== '' || row.length > 0) {
      row.push(value);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.some(function (v) {
        return v.trim() !== '';
      });
    });
  }

  async function importDialog(category) {
    let module;
    try {
      const response = await fetch('registry-modules.php', { credentials: 'same-origin' });
      module = (await response.json()).modules.find(function (m) {
        return m.id === category;
      });
    } catch (error) {
      module = null;
    }
    if (!module) {
      return;
    }
    const back = element('div', 'planned-backdrop');
    const box = element('div', 'planned-dialog');
    box.style.maxWidth = '46rem';
    box.style.maxHeight = '88vh';
    box.style.overflowY = 'auto';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.append(element('h5', '', 'Import into ' + module.title));
    const help = element('p', 'small text-muted');
    help.append(document.createTextNode('A CSV file with a heading row (Excel can save one), or a ZIP from an export with files (choose the file, or drop it on this window). Every row makes an entry. Sequence files (GenBank, FASTA, SnapGene) dropped here make one entry each, named after the file. '));
    const template = element('a', '', 'Download a template');
    template.href = 'registry-transfer.php?template=1&category=' + category;
    help.append(template, document.createTextNode(' with the fields of this module, or '));
    const all = element('a', '', 'the templates of all the modules');
    all.href = 'registry-transfer.php?templates=1';
    help.append(all, document.createTextNode('.'));
    box.append(help);
    const file = element('input', 'form-control-file mb-2');
    file.type = 'file';
    file.accept = '.csv,.tsv,.txt,.zip,text/csv,application/zip';
    box.append(file);
    const mapping = element('div');
    const destination = element('select', 'form-control form-control-sm w-auto mb-2');
    // the options that put the entries in the lab database (a module that needs a sequence file has them only for sequence files)
    const labOptions = [];
    [['lab', 'The lab database: everyone sees them, with the lab number'], ['both', 'Both: the lab database, and My database with my own numbers'], ['personal', 'My database: only me, my own numbers'], ['none', 'No database yet: private, no numbers until registered']].forEach(function (item) {
      const option = element('option', '', item[1]);
      option.value = item[0];
      if (item[0] === 'lab' || item[0] === 'both') {
        labOptions.push(option);
        option.dataset.plain = item[1];
      }
      if ((item[0] === 'lab' || item[0] === 'both') && module.settings && module.settings.requires_sequence_file) {
        option.disabled = true;
        option.textContent += ' (this module needs a sequence file for each: not for an import)';
      }
      destination.append(option);
    });
    // the number of the file as the lab number: an entry keeps the number it had (LabCollector, an old list)
    // admins: the storage places of the file (LabCollector) are made in the storage browser, with the entries in their boxes
    const storageLabel = element('label', 'd-block small mb-2');
    const storageBox = element('input');
    storageBox.type = 'checkbox';
    storageLabel.append(storageBox, document.createTextNode(' Make the storage places written in the file (rooms, freezers, boxes and the positions of the entries). Admins only.'));
    storageLabel.hidden = true;
    // the primers written in the GenBank files of a zip: linked to the primers of the database, and made when they are missing (off unless chosen)
    const primersLabel = element('label', 'd-block small mb-2');
    const primersChoice = element('select', 'form-control form-control-sm w-auto d-inline-block ml-1');
    [['', 'Do nothing'], ['attach', 'Attach the primers that are already in the database'], ['create', 'Attach them, and make the primers that are missing']].forEach(function (item) {
      const option = element('option', '', item[1]);
      option.value = item[0];
      primersChoice.append(option);
    });
    primersLabel.append(document.createTextNode('Primers written in the GenBank files of the zip:'), primersChoice);
    primersLabel.title = 'Each primer of a file is found in the database by its letters (either strand) and attached to the plasmid. A primer that is not there is made in the module of primers when you choose the last option; the entries made take the next numbers of that module.';
    primersLabel.hidden = true;
    const keepLabel = element('label', 'd-block small mb-2');
    const keep = element('input');
    keep.type = 'checkbox';
    keepLabel.append(keep, document.createTextNode(' Keep the numbers of the file (the ID column) as the lab numbers. A number that is already used in this module is not imported.'));
    const showKeep = function () {
      keepLabel.hidden = destination.value !== 'both' && destination.value !== 'lab';
      if (keepLabel.hidden) {
        keep.checked = false;
      }
    };
    destination.addEventListener('change', showKeep);
    showKeep();
    // who owns the new entries: the user who imports, the owner written in the file, or a user chosen (the last two for admins)
    const ownerBox = element('div', 'mb-2');
    ownerBox.append(element('p', 'small text-muted mb-1 mt-2', 'Who owns the new entries'));
    const ownerMode = element('select', 'form-control form-control-sm w-auto mb-1');
    [['me', 'Me'], ['column', 'The owner written in the file (matched by e-mail or name; the others are mine)'], ['user', 'A user of the team']].forEach(function (item) {
      const option = element('option', '', item[1]);
      option.value = item[0];
      ownerMode.append(option);
    });
    const ownerUser = element('select', 'form-control form-control-sm w-auto');
    const ownerUserLabel = element('span', 'small text-muted mr-2');
    const ownerUserRow = element('div');
    ownerUserRow.hidden = true;
    const makeDefault = element('input');
    makeDefault.type = 'checkbox';
    const makeDefaultLabel = element('label', 'small ml-3 mb-0');
    makeDefaultLabel.append(makeDefault, document.createTextNode(' make this the default owner'));
    ownerUserRow.append(ownerUserLabel, ownerUser, makeDefaultLabel);
    ownerBox.append(ownerMode, ownerUserRow);
    const showOwnerUser = function () {
      ownerUserRow.hidden = ownerMode.value === 'me';
      ownerUserLabel.textContent = ownerMode.value === 'column' ? 'Rows whose owner is not found go to' : 'The owner';
    };
    ownerMode.addEventListener('change', showOwnerUser);
    fetch('registry-transfer.php?users=1', { credentials: 'same-origin' }).then(function (response) {
      return response.json();
    }).then(function (body) {
      if (!body.is_admin) {
        ownerBox.textContent = '';
        ownerBox.append(element('p', 'small text-muted mb-1 mt-2', 'The new entries will be yours. An admin can give them to other owners.'));
        ownerMode.value = 'me';
        return;
      }
      body.users.forEach(function (u) {
        const option = element('option', '', u.name);
        option.value = String(u.id);
        option.selected = Number(u.id) === Number(body.default_owner || body.me);
        ownerUser.append(option);
      });
      if (body.default_owner) {
        ownerMode.value = 'column';
      }
      showOwnerUser();
    }).catch(function () {
      ownerMode.value = 'me';
    });
    const ownerFields = function () {
      return { owner_mode: ownerMode.value, owner_user: Number(ownerUser.value) || 0 };
    };
    // the user chosen can be kept as the default owner of the team
    const saveDefault = function () {
      if (makeDefault.checked && ownerMode.value !== 'me' && Number(ownerUser.value) > 0) {
        fetch('registry-transfer.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify({ action: 'set_default_owner', owner: Number(ownerUser.value) }) });
      }
    };
    const message = element('p', 'small mb-2');
    const buttons = element('div', 'planned-dialog-buttons');
    const cancel = element('button', 'btn btn-secondary btn-sm', 'Close');
    const run = element('button', 'btn btn-primary btn-sm', 'Import');
    cancel.type = run.type = 'button';
    run.disabled = true;
    cancel.addEventListener('click', function () {
      back.remove();
    });
    back.addEventListener('click', function (e) {
      if (e.target === back) {
        back.remove();
      }
    });
    buttons.append(cancel, run);
    box.append(mapping, element('p', 'small text-muted mb-1', 'Where the entries go'), destination, keepLabel, storageLabel, primersLabel, ownerBox, message, buttons);
    back.append(box);
    document.body.append(back);

    // a file dropped on the dialog is the file to import. The drop stops here: the list behind the dialog would otherwise take it as
    // a file to attach to a row or make an entry from. Only an outline marks the dialog (a tint would make it see-through).
    const hasFiles = function (event) {
      return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1;
    };
    const mark = function (on) {
      box.style.outline = on ? '2px dashed #5b8def' : '';
      box.style.outlineOffset = on ? '-6px' : '';
    };
    back.addEventListener('dragover', function (event) {
      if (hasFiles(event)) {
        event.preventDefault();
        event.stopPropagation();
        mark(true);
      }
    });
    back.addEventListener('dragleave', function (event) {
      if (!back.contains(event.relatedTarget)) {
        mark(false);
      }
    });
    back.addEventListener('drop', function (event) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      mark(false);
      const dropped = event.dataTransfer.files[0];
      if (!dropped) {
        return;
      }
      // sequence files (GenBank, FASTA, SnapGene): one entry each in this module, named and filled in from the file, then the question
      // about the primers of the GenBank files (the code is that of the drop on the list, see sequence-add.js)
      const sequences = Array.from(event.dataTransfer.files).filter(function (candidate) {
        return /\.(gb|gbk|gbff|genbank|fasta|fa|fna|dna)$/i.test(candidate.name);
      });
      if (sequences.length > 0 && window.SequenceAdd) {
        // the files are chosen, not imported yet: "Where the entries go" is asked first (the lab database, My database or no number yet)
        useSequences(sequences.slice(0, 50));
        return;
      }
      if (!/\.(csv|tsv|txt|zip)$/i.test(dropped.name)) {
        message.className = 'small mb-2 text-danger';
        message.textContent = dropped.name + ' cannot be imported: use a CSV file, a ZIP from an export, or sequence files (GenBank, FASTA, SnapGene).';
        return;
      }
      message.textContent = '';
      const list = new DataTransfer();
      list.items.add(dropped);
      file.files = list.files;
      file.dispatchEvent(new Event('change'));
    });

    const normal = function (text) {
      return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
    };
    let table = [];
    let zipMode = false;
    const choices = [];
    // sequence files dropped on the dialog: one entry each. A module that needs a sequence file can be registered in the lab with these
    // (they are the file), and what is asked for a csv (numbers, owners, the primers of a zip) is not.
    let sequenceFiles = [];
    const setSequenceMode = function (on) {
      sequenceFiles = on ? sequenceFiles : [];
      // the numbers to keep and the owners are for a csv or a zip; display with !important like the d-block that the label has
      if (on) {
        keepLabel.style.setProperty('display', 'none', 'important');
      } else {
        keepLabel.style.removeProperty('display');
      }
      ownerBox.style.display = on ? 'none' : '';
      if (module.settings && module.settings.requires_sequence_file) {
        labOptions.forEach(function (option) {
          option.disabled = !on;
          option.textContent = on ? option.dataset.plain : option.dataset.plain + ' (this module needs a sequence file for each: not for an import)';
        });
        // a module that needs sequence files cannot take a csv into the lab: back to My database
        if (!on && (destination.value === 'lab' || destination.value === 'both')) {
          destination.value = 'personal';
          showKeep();
        }
      }
    };
    const useSequences = function (list) {
      mapping.textContent = '';
      choices.length = 0;
      zipMode = false;
      storageLabel.hidden = true;
      primersLabel.hidden = true;
      file.value = '';
      sequenceFiles = list;
      setSequenceMode(true);
      // the lab database is the start; a module that needs sequence files has it enabled just now
      destination.value = 'lab';
      showKeep();
      message.textContent = '';
      mapping.append(element('p', 'small mb-1', list.length + (list.length === 1 ? ' sequence file' : ' sequence files') + ': one entry each, named from the file (a GenBank file gives its name and what else it says). Choose where they go, then Import.'));
      const names = element('ul', 'small text-muted mb-2');
      list.slice(0, 8).forEach(function (item) {
        names.append(element('li', '', item.name));
      });
      if (list.length > 8) {
        names.append(element('li', '', 'and ' + (list.length - 8) + ' more'));
      }
      mapping.append(names);
      run.disabled = false;
    };
    file.addEventListener('change', async function () {
      setSequenceMode(false);
      mapping.textContent = '';
      choices.length = 0;
      run.disabled = true;
      if (!file.files || !file.files[0]) {
        return;
      }
      zipMode = /\.zip$/i.test(file.files[0].name);
      storageLabel.hidden = !zipMode;
      primersLabel.hidden = !zipMode;
      if (zipMode) {
        // a zip of an export: the columns are matched by their names and the files are attached
        mapping.append(element('p', 'small text-muted mb-1', 'A ZIP from an export of this module: the columns are matched by their names, and the files of each entry are attached to it.'));
        run.disabled = false;
        return;
      }
      // the row of hints of a template starts with #
      table = parseCsv(await file.files[0].text()).filter(function (r, i) {
        return i === 0 || !/^\s*#/.test(r[0] || '');
      });
      if (table.length < 2) {
        message.className = 'small mb-2 text-danger';
        message.textContent = 'The file needs a heading row and at least one row of data.';
        return;
      }
      message.textContent = '';
      mapping.append(element('p', 'small text-muted mb-1', table.length - 1 + ' rows. Say what each column of the file is:'));
      table[0].forEach(function (heading, index) {
        const row = element('div', 'd-flex align-items-center mb-1');
        const name = element('span', 'mr-2 small');
        name.style.width = '14em';
        name.textContent = heading || '(no heading)';
        const select = element('select', 'form-control form-control-sm w-auto');
        const options = [['title', 'The title'], ['ignore', 'Leave out'], ['number', 'The lab number (ID)'], ['owner', 'The owner (e-mail or name)']].concat(module.fields.map(function (f) {
          return ['field:' + f.name, 'Field: ' + f.name];
        }), [['extra', 'Keep as a new field']]);
        options.forEach(function (o) {
          const option = element('option', '', o[1]);
          option.value = o[0];
          select.append(option);
        });
        const key = normal(heading);
        let guess = 'ignore';
        if (key === 'title' || key === 'name') {
          guess = 'title';
        } else if (key === 'id') {
          guess = 'number';
        } else if (key === 'owner' || key === 'owneremail') {
          guess = 'owner';
        } else if (['myid', 'date'].indexOf(key) === -1) {
          const found = module.fields.find(function (f) {
            return normal(f.name) === key;
          });
          if (found) {
            guess = 'field:' + found.name;
          }
        }
        select.value = guess;
        choices.push(select);
        const sample = element('span', 'ml-2 small text-muted', table[1][index] ? '(e.g. ' + table[1][index].slice(0, 30) + ')' : '');
        row.append(name, select, sample);
        mapping.append(row);
      });
      run.disabled = false;
    });

    run.addEventListener('click', async function () {
      saveDefault();
      if (sequenceFiles.length > 0) {
        // the files become entries where the user chose; a GenBank file then asks about its primers (sequence-add.js)
        const chosen = sequenceFiles;
        back.remove();
        window.SequenceAdd.addFiles(category, chosen, destination.value);
        return;
      }
      if (zipMode) {
        run.disabled = true;
        message.className = 'small mb-2';
        message.textContent = 'Importing the zip...';
        try {
          const form = new FormData();
          form.append('category', String(category));
          form.append('register', destination.value);
          form.append('keep_numbers', keep.checked ? '1' : '0');
          form.append('primers', primersChoice.value);
          form.append('owner_mode', ownerFields().owner_mode);
          form.append('owner_user', String(ownerFields().owner_user));
          form.append('file', file.files[0]);
          const response = await fetch('registry-transfer.php', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: form });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error || 'The import failed.');
          }
          message.className = 'small mb-2 text-success';
          message.textContent = body.created + ' entries made, ' + body.files + ' files attached.' + ((body.owners_not_found || []).length ? ' No user was found for: ' + body.owners_not_found.slice(0, 6).join(', ') + '; those entries are yours.' : '') + (body.skipped.length ? ' Not made (' + body.skipped.length + '): ' + body.skipped.slice(0, 6).map(function (i) {
            return i.row + ': ' + i.reason;
          }).join(' ') : '');
          if (body.primers) {
            const p = body.primers;
            message.textContent += ' Primers of the files: ' + p.attached + ' attached' + (p.already ? ', ' + p.already + ' already attached' : '') + (p.created ? ', ' + p.created + ' made' : '') + (p.missing ? ', ' + p.missing + ' not in the database' : '') + (p.too_short ? ', ' + p.too_short + ' too short' : '') + '.'
              + (p.ambiguous.length ? ' Not attached, several primers have these letters: ' + p.ambiguous.slice(0, 6).join(', ') + '.' : '')
              + (p.not_made.length ? ' Not made: ' + p.not_made.slice(0, 4).join(' ') : '')
              + (p.errors.length ? ' ' + p.errors.slice(0, 3).join(' ') : '');
          }
          if (storageBox.checked) {
            const madeResponse = await fetch('registry-transfer.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify({ action: 'build_storage', category: category }) });
            const made = await madeResponse.json();
            if (!madeResponse.ok) {
              throw new Error(made.error || 'The storage places could not be made.');
            }
            message.textContent += ' Storage: ' + made.entries_with_storage + ' entries placed, ' + made.places_created + ' places made.';
          }
          cancel.textContent = 'Close and reload';
          cancel.addEventListener('click', function () {
            window.location.reload();
          });
        } catch (error) {
          message.className = 'small mb-2 text-danger';
          message.textContent = error.message;
          run.disabled = false;
        }
        return;
      }
      const kinds = choices.map(function (c) {
        return c.value;
      });
      if (kinds.indexOf('title') === -1) {
        message.className = 'small mb-2 text-danger';
        message.textContent = 'One column has to be the title.';
        return;
      }
      const rows = table.slice(1).map(function (cells) {
        const row = { title: '', fields: {}, extra: {} };
        kinds.forEach(function (kind, index) {
          const value = (cells[index] || '').trim();
          if (kind === 'title') {
            row.title = value;
          } else if (kind === 'number') {
            row.number = value;
          } else if (kind === 'owner') {
            // an e-mail address, else a name
            if (/@/.test(value)) {
              row.owner_email = value;
            } else if (!row.owner_email) {
              row.owner = value;
            }
          } else if (kind.indexOf('field:') === 0) {
            row.fields[kind.slice(6)] = value;
          } else if (kind === 'extra') {
            row.extra[table[0][index]] = value;
          }
        });
        return row;
      });
      run.disabled = true;
      let created = 0;
      const notFound = [];
      const skipped = [];
      try {
        for (let start = 0; start < rows.length; start += 100) {
          message.className = 'small mb-2';
          message.textContent = 'Importing... ' + start + ' of ' + rows.length;
          const response = await fetch('registry-transfer.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
            body: JSON.stringify(Object.assign({ category: category, register: destination.value, keep_numbers: keep.checked, offset: start, rows: rows.slice(start, start + 100) }, ownerFields())),
          });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error || 'The import failed.');
          }
          created += body.created;
          (body.owners_not_found || []).forEach(function (o) {
            if (notFound.indexOf(o) === -1) {
              notFound.push(o);
            }
          });
          body.skipped.forEach(function (item) {
            skipped.push(item.row + ': ' + item.reason);
          });
        }
        message.className = 'small mb-2 text-success';
        message.textContent = created + ' entries made.' + (notFound.length ? ' No user was found for: ' + notFound.slice(0, 6).join(', ') + '; those entries are yours.' : '') + (skipped.length ? ' Not made (' + skipped.length + '): ' + skipped.slice(0, 8).join(' ') + (skipped.length > 8 ? ' ...' : '') : '');
        cancel.textContent = 'Close and reload';
        cancel.addEventListener('click', function () {
          window.location.reload();
        });
      } catch (error) {
        message.className = 'small mb-2 text-danger';
        message.textContent = error.message + (created ? ' (' + created + ' entries were made before it stopped.)' : '');
        run.disabled = false;
      }
    });
  }

  // a dialog of our own: the native box of the browser can be blocked
  function confirmDialog(title, text, ok) {
    return new Promise(function (resolve) {
      const back = element('div', 'planned-backdrop');
      const box = element('div', 'planned-dialog');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.append(element('h5', '', title), element('p', '', text));
      const buttons = element('div', 'planned-dialog-buttons');
      const cancel = element('button', 'btn btn-secondary btn-sm', 'Cancel');
      cancel.type = 'button';
      const yes = element('button', 'btn btn-danger btn-sm', ok);
      yes.type = 'button';
      const done = function (value) {
        back.remove();
        resolve(value);
      };
      cancel.addEventListener('click', function () {
        done(false);
      });
      yes.addEventListener('click', function () {
        done(true);
      });
      back.addEventListener('click', function (event) {
        if (event.target === back) {
          done(false);
        }
      });
      buttons.append(cancel, yes);
      box.append(buttons);
      back.append(box);
      document.body.append(back);
      cancel.focus();
    });
  }

  // ---- the page of an entry: a bar says where it is, planned or in the Database, and moves it
  async function entryPage(id) {
    let entry;
    let me = null;
    try {
      entry = await (await fetch('api/v2/inventory/' + id, { credentials: 'same-origin' })).json();
      me = (await (await fetch('api/v2/users/me', { credentials: 'same-origin' })).json()).userid;
    } catch (error) {
      return;
    }
    const container = document.getElementById('container');
    if (!container) {
      return;
    }
    const planned = Number(entry.is_planned) === 1;
    const mine = Number(entry.userid) === Number(me);
    // an entry without a number is in My entries: the folders of the path bar and of the panel lead to My entries
    if (planned || entry.custom_id === null) {
      const keepMine = function () {
        document.querySelectorAll('#foldersPanel a[href], .folder-path-bar a[href]').forEach(function (link) {
          const url = new URL(link.getAttribute('href'), location.href);
          if (/registry\.php$/.test(url.pathname) && !url.searchParams.has('planned') && !url.searchParams.has('id')) {
            url.searchParams.set('planned', '1');
            link.setAttribute('href', url.pathname.replace(/^\//, '') + url.search);
          }
        });
      };
      keepMine();
      document.addEventListener('elabftw:folders-panel-loaded', keepMine);
      new MutationObserver(keepMine).observe(document.body, { childList: true, subtree: true });
    }
    // an entry opened from My entries goes back to its folder, in My entries
    let fromMine = false;
    try {
      fromMine = sessionStorage.getItem('registryMine') === '1';
    } catch (error) {
      fromMine = false;
    }
    if (fromMine && Number(entry.folder_id) > 0) {
      const target = 'registry.php?folder=' + Number(entry.folder_id) + '&planned=1';
      document.querySelectorAll('a[title="Go back"], a[title="Back to listing"]').forEach(function (link) {
        link.setAttribute('href', target);
      });
      document.querySelectorAll('[data-action="update-entity-body"][data-folder-url]').forEach(function (button) {
        button.dataset.redirect = 'folder';
        button.dataset.folderUrl = target;
      });
    }
    const bar = element('div', 'alert d-flex align-items-center flex-wrap my-2 ' + (planned ? 'alert-info' : 'alert-light border'));
    const message = element('span', 'ml-2');
    if (planned) {
      bar.append(element('span', 'mr-2', 'Not in the Database yet: private to you, no number shown.'));
      const status = element('select', 'form-control form-control-sm w-auto mr-2');
      ['Planned', 'Ordered', 'Being made'].forEach(function (title) {
        const option = element('option', '', title);
        option.value = title;
        option.selected = title === entry.status_title;
        status.append(option);
      });
      status.disabled = !mine;
      status.addEventListener('change', async function () {
        try {
          await post({ action: 'status', id: id, status: status.value });
          message.textContent = 'Status: ' + status.value + '.';
        } catch (error) {
          message.textContent = error.message;
        }
      });
      const move = element('button', 'btn btn-success btn-sm ml-auto', 'Move to the Database');
      move.type = 'button';
      move.disabled = !mine;
      move.title = entry.custom_id ? 'It comes back with its number ' + entry.custom_id : 'It gets the next number of its module';
      move.addEventListener('click', async function () {
        move.disabled = true;
        try {
          const done = await post({ action: 'ready', id: id });
          message.textContent = 'It is in the Database now: number ' + done.number + '.';
          window.setTimeout(function () {
            location.reload();
          }, 900);
        } catch (error) {
          message.textContent = error.message;
          move.disabled = false;
        }
      });
      bar.append(status, move, message);
    } else if (mine && !entry.custom_id) {
      // in the Database without a number: an intermediate. Register gives it the next number of its module, when it has what the
      // module requires (the required fields, and for the plasmids a sequence).
      bar.classList.add('alert-warning');
      bar.append(element('span', 'mr-2', 'Not registered in the lab (an intermediate). Only you see it, and it is not in the lists of the Database.'));
      const register = element('button', 'btn btn-success btn-sm ml-auto', 'Register in the lab Database');
      register.type = 'button';
      register.addEventListener('click', async function () {
        register.disabled = true;
        try {
          const done = await post({ action: 'register', id: id });
          message.textContent = 'Registered: number ' + done.number + '.';
          window.setTimeout(function () {
            location.reload();
          }, 900);
        } catch (error) {
          message.textContent = error.message;
          register.disabled = false;
        }
      });
      const own = element('button', 'btn btn-outline-secondary btn-sm ml-2', entry.personal_id ? String(entry.personal_id) : 'Register for myself');
      own.type = 'button';
      own.disabled = Boolean(entry.personal_id);
      own.title = 'It gets your next number of the module and stays private to you';
      own.addEventListener('click', async function () {
        own.disabled = true;
        try {
          const done = await post({ action: 'personal', id: id });
          message.textContent = 'Registered for you: number ' + done.number + '.';
          window.setTimeout(function () {
            location.reload();
          }, 900);
        } catch (error) {
          message.textContent = error.message;
          own.disabled = false;
        }
      });
      bar.append(register, own, message);
    } else if (mine) {
      // a registered entry has no bar: moving it back out of the Database is an item of the "More options" menu of the entry
      const menu = document.querySelector('#entityToolbar .dropdown-menu');
      if (menu && !menu.querySelector('[data-planned-back]')) {
        const back = element('button', 'dropdown-item', 'Move back to planned');
        back.type = 'button';
        back.dataset.plannedBack = '1';
        back.title = 'It leaves the Database and becomes private to you; it keeps its number ' + (entry.custom_id || '');
        back.addEventListener('click', async function () {
          const yes = await confirmDialog('Move it out of the Database?', 'It becomes private to you and disappears from the lists, the searches and the pickers of everyone else, including the orders and plasmids that use it. It keeps its number ' + (entry.custom_id || '') + ': when you move it back into the Database it has the same one.', 'Move back to planned');
          if (!yes) {
            return;
          }
          try {
            await post({ action: 'revert', id: id });
            location.reload();
          } catch (error) {
            window.alert(error.message);
          }
        });
        menu.append(back);
      }
      return;
    } else {
      return;
    }
    container.prepend(bar);
  }

  // the rows ticked in the list go into the lab Database: each is registered (or moved from planned) and gets its number
  // and its folder; the ones that cannot (a plasmid needs a sequence, a module its required fields) are listed
  // the entries that were ticked get another owner (admins)
  async function assignOwnerDialog(ids, done) {
    let body;
    try {
      body = await (await fetch('registry-transfer.php?users=1', { credentials: 'same-origin' })).json();
    } catch (error) {
      return;
    }
    const back = element('div', 'planned-backdrop');
    const box = element('div', 'planned-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.append(element('h5', '', 'Assign an owner to ' + ids.length + (ids.length === 1 ? ' entry' : ' entries')));
    const message = element('p', 'small mb-2');
    const buttons = element('div', 'planned-dialog-buttons');
    const cancel = element('button', 'btn btn-secondary btn-sm', 'Close');
    cancel.type = 'button';
    cancel.addEventListener('click', function () {
      back.remove();
    });
    buttons.append(cancel);
    if (!body.is_admin) {
      box.append(element('p', 'mb-2', 'Only an admin can assign the owner of entries.'), buttons);
    } else {
      box.append(element('p', 'small text-muted mb-1', 'The new owner gets them with a My ID in their own count; the lab number stays.'));
      // the new owner is found by e-mail address: type it, or pick one from the list (the names are shown next to the addresses)
      const select = element('input', 'form-control form-control-sm mb-2');
      select.type = 'email';
      select.setAttribute('list', 'assignOwnerUsers');
      select.setAttribute('aria-label', 'E-mail address of the new owner');
      select.placeholder = 'E-mail address of the new owner';
      select.autocomplete = 'off';
      const list = element('datalist');
      list.id = 'assignOwnerUsers';
      body.users.forEach(function (u) {
        const option = element('option', '', u.name);
        option.value = String(u.email || '');
        list.append(option);
      });
      // open for all the users: everyone of the team can edit them (the owner can be left empty to keep it)
      const openLabel = element('label', 'd-block small mb-2');
      const open = element('input');
      open.type = 'checkbox';
      openLabel.append(open, document.createTextNode(' Open for all the users (everyone can edit them; leave the e-mail empty to keep the owner)'));
      const go = element('button', 'btn btn-primary btn-sm', 'Assign');
      go.type = 'button';
      go.addEventListener('click', async function () {
        go.disabled = true;
        try {
          const response = await fetch('registry-transfer.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify({ action: 'assign_owner', ids: ids, owner_email: select.value.trim(), open: open.checked }) });
          const answer = await response.json();
          if (!response.ok) {
            throw new Error(answer.error || 'It could not be done.');
          }
          message.className = 'small mb-2 text-success';
          message.textContent = answer.changed + ' entries changed owner' + (answer.opened ? ', ' + answer.opened + ' opened for all the users' : '') + '.';
          cancel.textContent = 'Close and reload';
          cancel.addEventListener('click', function () {
            if (done) {
              done();
            }
          });
        } catch (error) {
          message.className = 'small mb-2 text-danger';
          message.textContent = error.message;
          go.disabled = false;
        }
      });
      buttons.prepend(go);
      box.append(select, list, openLabel, message, buttons);
    }
    back.append(box);
    document.body.append(back);
  }

  window.RegistryTools = {
    assignOwner: function (ids, done) {
      return assignOwnerDialog(ids, done);
    },
    importDialog: function (category) {
      return importDialog(category);
    },
    addToDatabase: async function (ids, done) {
      if (!(await confirmDialog('Add ' + ids.length + (ids.length === 1 ? ' entry' : ' entries') + ' to the Database?', 'Each gets the next number of its module and is filed in Database items, in the folder of its module, visible to everyone with an account.', 'Add to the Database'))) {
        return;
      }
      const failed = [];
      for (const entryId of ids) {
        try {
          await post({ action: 'lab', id: entryId });
        } catch (error) {
          failed.push('#' + entryId + ': ' + error.message);
        }
      }
      if (failed.length > 0) {
        await confirmDialog('Not all could be added', (ids.length - failed.length) + ' added. ' + failed.join(' '), 'OK');
      }
      done();
    },
  };

  // an antibody or a reagent is ordered: a dialog asks for the amount (and the link or the vendor when they are not in the entry), then an
  // order is made, "Name; Vendor", with the link, the clone and the amount in its description, and linked to the entry
  window.addEventListener('registry:order-entry', function (event) {
    const entry = event.detail;
    const field = function (pattern) {
      const found = (entry.fields || []).find(function (f) {
        return pattern.test(f.name);
      });
      return found && found.value ? String(found.value) : '';
    };
    const back = element('div', 'planned-backdrop');
    const box = element('div', 'planned-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    // each module has its own order: what is asked, and what the description of the order says
    const isAntibody = /^antibod/i.test(entry.category || '');
    const kind = isAntibody ? 'antibody' : (/^consumable/i.test(entry.category || '') ? 'consumable' : 'reagent');
    box.append(element('h5', '', 'Order ' + kind + ' ' + entry.title));
    const form = [['vendor', 'Vendor', field(/^(supplier|vendor)/i), true]].concat(
      isAntibody ? [['clone', 'Clone', field(/^clone/i), true]] : [['catalog', 'Catalog number', field(/^catalog/i), true]],
      [['link', 'Link', field(/^(link|url|product link|website)/i), true], ['amount', 'Amount', field(/^(order )?amount/i), true]]
    );
    const inputs = {};
    const labels = {};
    form.forEach(function (item) {
      const label = element('label', 'd-block');
      label.append(element('span', 'd-block small text-muted', item[1]));
      const input = element('input', 'form-control form-control-sm');
      input.type = 'text';
      input.value = item[2];
      if (item[0] === 'amount') {
        input.placeholder = isAntibody ? 'for example 100 µl' : (kind === 'consumable' ? 'for example 2 boxes, or 1 case' : 'for example 500 g, or 1 bottle');
      }
      inputs[item[0]] = input;
      labels[item[0]] = item[1];
      label.append(input);
      box.append(label);
    });
    const message = element('p', 'small text-danger mb-0');
    const buttons = element('div', 'planned-dialog-buttons');
    const cancel = element('button', 'btn btn-secondary btn-sm', 'Cancel');
    cancel.type = 'button';
    const make = element('button', 'btn btn-primary btn-sm', 'Make the order');
    make.type = 'button';
    cancel.addEventListener('click', function () {
      back.remove();
    });
    back.addEventListener('click', function (e) {
      if (e.target === back) {
        back.remove();
      }
    });
    make.addEventListener('click', async function () {
      make.disabled = true;
      message.textContent = '';
      try {
        const vendor = inputs.vendor.value.trim();
        // the description is a rich text: the link is a clickable badge with the title of its page, like a link pasted in an order
        const esc = function (text) {
          return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        };
        const lines = [];
        for (const key of ['link', 'clone', 'catalog', 'amount']) {
          const value = inputs[key] ? inputs[key].value.trim() : '';
          if (value === '') {
            continue;
          }
          let shown = esc(value);
          if (key === 'link' && /^https?:\/\/\S+$/i.test(value)) {
            let label = value;
            try {
              const preview = await (await fetch('api/v2/link_preview?url=' + encodeURIComponent(value), { credentials: 'same-origin' })).json();
              label = preview.title || preview.hostname || value;
            } catch (error) {
              label = value;
            }
            shown = '<a href="' + esc(value) + '" target="_blank" rel="noreferrer noopener" class="elabftw-link-preview">' + esc(label) + '</a>';
          }
          lines.push('<p>' + labels[key] + ': ' + shown + '</p>');
        }
        const response = await fetch('api/v2/orders', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
          body: JSON.stringify({ title: entry.title + (vendor ? '; ' + vendor : ''), notes: lines.join('') }),
        });
        if (!response.ok) {
          throw new Error('The order could not be made (' + response.status + ').');
        }
        const orderId = Number((response.headers.get('Location') || '').split('/').pop());
        const linked = await fetch('primers.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify({ action: 'order', primers: [entry.id], order: orderId }) });
        if (!linked.ok) {
          throw new Error('The order was made, but it could not be linked to the entry (' + linked.status + ').');
        }
        back.remove();
        window.location.href = 'orders.php?order=' + orderId;
      } catch (error) {
        message.textContent = error.message;
        make.disabled = false;
      }
    });
    buttons.append(cancel, make);
    box.append(message, buttons);
    back.append(box);
    document.body.append(back);
    inputs.amount.focus();
  });

  // the print button of a row: the label of the entry is printed on the label printer of the lab (see label-print.php)
  window.addEventListener('registry:print-label', function (event) {
    const entry = event.detail;
    const back = element('div', 'planned-backdrop');
    const box = element('div', 'planned-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.append(element('h5', '', 'Print a label for ' + entry.title));
    const label = element('label', 'd-block');
    label.append(element('span', 'd-block small text-muted', 'Copies'));
    const copies = element('input', 'form-control form-control-sm');
    copies.type = 'number';
    copies.min = '1';
    copies.max = '100';
    copies.value = '1';
    label.append(copies);
    box.append(label);
    // the label has the ID and the title of the entry; text typed here is added below them, one line each
    const preview = element('p', 'small text-muted mb-2');
    box.append(preview);
    // margins (mm) dragged in the preview for this label; null = those of the format
    let edited = null;
    const customLabel = element('label', 'd-block');
    customLabel.append(element('span', 'd-block small text-muted', 'Extra text on the label (optional, one line each)'));
    const custom = element('textarea', 'form-control form-control-sm');
    custom.rows = 3;
    custom.maxLength = 240;
    customLabel.append(custom);
    box.append(customLabel);
    // the format of the label: the sizes the admins have made
    const formatLabel = element('label', 'd-block');
    formatLabel.append(element('span', 'd-block small text-muted', 'Label format'));
    const format = element('select', 'form-control form-control-sm');
    formatLabel.append(format);
    box.insertBefore(formatLabel, label);
    fetch('label-print.php', { credentials: 'same-origin' }).then(function (response) {
      return response.json();
    }).then(function (body) {
      body.formats.forEach(function (f) {
        const option = element('option', '', f.name + ' (' + f.width_mm + ' x ' + f.height_mm + ' mm)');
        option.value = String(f.id);
        option.selected = Number(f.is_default) === 1;
        format.append(option);
      });
      showPreview();
    }).catch(function () {
      // the default format is used
    });
    format.addEventListener('change', function () {
      edited = null;
      showPreview();
    });
    const request = function (extra) {
      return fetch('label-print.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
        body: JSON.stringify(Object.assign({ id: entry.id, copies: Number(copies.value) || 1, custom: custom.value, format: format.value === '' ? -1 : Number(format.value), margins: edited || undefined }, extra || {})),
      }).then(async function (response) {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || 'The label could not be printed.');
        }
        return body;
      });
    };
    // the label drawn as it will be printed: the same positions that go to the printer; a label read turned by 180 degrees is shown turned
    const SVGNS = 'http://www.w3.org/2000/svg';
    const draw = function (body) {
      preview.textContent = '';
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + body.width + ' ' + body.height);
      svg.setAttribute('width', String(Math.min(360, body.width)));
      svg.style.border = '1px solid #888';
      svg.style.background = '#fff';
      svg.style.display = 'block';
      const group = document.createElementNS(SVGNS, 'g');
      body.elements.forEach(function (item) {
        if (item.type === 'qr') {
          const box = document.createElementNS(SVGNS, 'rect');
          box.setAttribute('x', item.x);
          box.setAttribute('y', item.y);
          box.setAttribute('width', item.size);
          box.setAttribute('height', item.size);
          box.setAttribute('fill', '#ddd');
          box.setAttribute('stroke', '#333');
          group.append(box);
          return;
        }
        const text = document.createElementNS(SVGNS, 'text');
        text.setAttribute('transform', 'translate(' + item.x + ',' + item.y + ')' + (item.inverted ? ' rotate(180)' : ''));
        text.setAttribute('font-size', String(item.h));
        text.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
        text.textContent = item.text;
        group.append(text);
      });
      // read upside down: turn the drawing so it is seen as a person reads the label
      if (body.rotated) {
        group.setAttribute('transform', 'rotate(180 ' + (body.width / 2) + ' ' + (body.height / 2) + ')');
      }
      svg.append(group);
      // the margins, as the label is read: the dashed lines can be dragged to change them
      if (body.margins) {
        const dotsPerMm = body.width / Number(body.width_mm);
        const m = body.margins;
        const frame = document.createElementNS(SVGNS, 'rect');
        frame.setAttribute('x', m.left);
        frame.setAttribute('y', m.top);
        frame.setAttribute('width', Math.max(1, body.width - m.left - m.right));
        frame.setAttribute('height', Math.max(1, body.height - m.top - m.bottom));
        frame.setAttribute('fill', 'none');
        frame.setAttribute('stroke', '#5b8def');
        frame.setAttribute('stroke-dasharray', '4 3');
        frame.setAttribute('stroke-width', '1');
        frame.style.pointerEvents = 'none';
        svg.append(frame);
        const handle = function (side, x1, y1, x2, y2, cursor) {
          const line = document.createElementNS(SVGNS, 'line');
          line.setAttribute('x1', x1);
          line.setAttribute('y1', y1);
          line.setAttribute('x2', x2);
          line.setAttribute('y2', y2);
          line.setAttribute('stroke', 'transparent');
          line.setAttribute('stroke-width', '22');
          line.style.cursor = cursor;
          line.style.touchAction = 'none';
          line.addEventListener('pointerdown', function (event) {
            event.preventDefault();
            line.setPointerCapture(event.pointerId);
            const box = svg.getBoundingClientRect();
            const scale = body.width / box.width;
            const current = { left: m.left / dotsPerMm, top: m.top / dotsPerMm, right: m.right / dotsPerMm, bottom: m.bottom / dotsPerMm };
            const move = function (e) {
              const x = (e.clientX - box.left) * scale;
              const y = (e.clientY - box.top) * scale;
              const mm = { left: x, top: y, right: body.width - x, bottom: body.height - y }[side] / dotsPerMm;
              current[side] = Math.round(Math.max(-10, Math.min(10, mm)) * 10) / 10;
              edited = Object.assign({}, current);
              const dots = function (v) { return v * dotsPerMm; };
              const r = { left: dots(current.left), top: dots(current.top), right: dots(current.right), bottom: dots(current.bottom) };
              frame.setAttribute('x', r.left);
              frame.setAttribute('y', r.top);
              frame.setAttribute('width', Math.max(1, body.width - r.left - r.right));
              frame.setAttribute('height', Math.max(1, body.height - r.top - r.bottom));
            };
            const up = function () {
              line.removeEventListener('pointermove', move);
              line.removeEventListener('pointerup', up);
              showPreview();
            };
            line.addEventListener('pointermove', move);
            line.addEventListener('pointerup', up);
          });
          svg.append(line);
        };
        handle('left', m.left, 0, m.left, body.height, 'ew-resize');
        handle('right', body.width - m.right, 0, body.width - m.right, body.height, 'ew-resize');
        handle('top', 0, m.top, body.width, m.top, 'ns-resize');
        handle('bottom', 0, body.height - m.bottom, body.width, body.height - m.bottom, 'ns-resize');
        const mmOf = function (v) { return (Math.round(v / dotsPerMm * 10) / 10).toFixed(1); };
        preview.dataset.margins = [m.left, m.top, m.right, m.bottom].map(mmOf).join(' / ');
      }
      svg.setAttribute('overflow', 'hidden');
      preview.append(svg, document.createTextNode(body.width_mm + ' x ' + body.height_mm + ' mm' + ', the dashed lines are the margins (left / top / right / bottom: ' + preview.dataset.margins + ' mm): drag them to change' + (body.rotated ? '; shown as it is read (it prints turned by 180 degrees)' : '')));
    };
    const showPreview = function () {
      request({ dry: true }).then(draw).catch(function () {
        preview.textContent = '';
      });
    };
    custom.addEventListener('input', function () {
      window.clearTimeout(custom.timer);
      custom.timer = window.setTimeout(showPreview, 400);
    });
    const message = element('p', 'small mb-0');
    const buttons = element('div', 'planned-dialog-buttons');
    const cancel = element('button', 'btn btn-secondary btn-sm', 'Close');
    cancel.type = 'button';
    const print = element('button', 'btn btn-primary btn-sm', 'Print');
    print.type = 'button';
    cancel.addEventListener('click', function () {
      back.remove();
    });
    back.addEventListener('click', function (e) {
      if (e.target === back) {
        back.remove();
      }
    });
    print.addEventListener('click', async function () {
      print.disabled = true;
      message.className = 'small mb-0';
      message.textContent = 'Sending to the printer...';
      try {
        const body = await request();
        message.className = 'small mb-0 text-success';
        message.textContent = 'Sent: ' + body.printed + (body.printed === 1 ? ' label' : ' labels') + ' (' + body.lines.join(' / ') + ').';
      } catch (error) {
        message.className = 'small mb-0 text-danger';
        message.textContent = error.message;
      }
      print.disabled = false;
    });
    const test = element('button', 'btn btn-outline-secondary btn-sm mr-auto', 'Print a test pattern');
    test.type = 'button';
    test.title = 'A frame at the edge of the label and one at the margins: to see where the printer puts things';
    test.addEventListener('click', async function () {
      test.disabled = true;
      message.className = 'small mb-0';
      message.textContent = 'Sending the test pattern...';
      try {
        await request({ test: true, copies: 1 });
        message.className = 'small mb-0 text-success';
        message.textContent = 'The test pattern is sent: a frame at the edge of the label, and one at the margins.';
      } catch (error) {
        message.className = 'small mb-0 text-danger';
        message.textContent = error.message;
      }
      test.disabled = false;
    });
    // margins dragged in the preview: back to those of the format, or saved into the format (admins)
    const marginButtons = element('div', 'mb-2');
    const resetMargins = element('button', 'btn btn-outline-secondary btn-sm mr-2', 'Margins of the format');
    resetMargins.type = 'button';
    resetMargins.addEventListener('click', function () {
      edited = null;
      showPreview();
    });
    const saveMargins = element('button', 'btn btn-outline-secondary btn-sm', 'Save these margins in the format');
    saveMargins.type = 'button';
    saveMargins.addEventListener('click', async function () {
      message.className = 'small mb-0';
      if (!edited || Number(format.value) <= 0) {
        message.textContent = edited ? 'This format cannot be changed here.' : 'Drag a dashed line first.';
        return;
      }
      const response = await fetch('label-print.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
        body: JSON.stringify({ action: 'save_margins', id: Number(format.value), margins: edited }),
      });
      const answer = await response.json().catch(function () { return { error: 'Your session has probably ended. Reload the page.' }; });
      message.className = 'small mb-0 ' + (answer.error ? 'text-danger' : 'text-success');
      message.textContent = answer.error ? answer.error : 'The margins are saved in the format.';
      if (!answer.error) {
        edited = null;
        showPreview();
      }
    });
    marginButtons.append(resetMargins, saveMargins);
    box.append(marginButtons);
    buttons.append(test, cancel, print);
    box.append(message, buttons);
    back.append(box);
    document.body.append(back);
    print.focus();
  });

  const params = new URLSearchParams(location.search);
  const id = Number(params.get('id'));
  const nav = document.querySelector('nav.category-nav');
  if (nav) {
    listPage(nav);
  } else if (id > 0 && /registry\.php$/.test(location.pathname)) {
    entryPage(id);
  }

  // the minimum stock form on the page of an entry
  document.addEventListener('click', async function (event) {
    const save = event.target.closest ? event.target.closest('#minStockSave') : null;
    if (!save) {
      return;
    }
    const form = document.getElementById('minStockForm');
    const message = document.getElementById('minStockMessage');
    try {
      const response = await fetch('registry-transfer.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
        body: JSON.stringify({ action: 'set_min_stock', id: Number(form.dataset.entryId), min_stock: document.getElementById('minStockValue').value, unit: document.getElementById('minStockUnit').value }),
      });
      const done = await response.json();
      if (!response.ok) {
        throw new Error(done.error || 'Not saved.');
      }
      message.className = 'small ml-2 text-success';
      message.textContent = 'Saved.';
      window.setTimeout(function () {
        location.reload();
      }, 600);
    } catch (error) {
      message.className = 'small ml-2 text-danger';
      message.textContent = error.message;
    }
  });
})();
