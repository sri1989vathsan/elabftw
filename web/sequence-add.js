/**
 * Adding the sequence to a plasmid of the database:
 * - a dialog for a new plasmid (name, parents, sequence from a file or pasted), opened by the button of the module of the plasmids;
 * - on the edit page of a plasmid, a control to attach a sequence file or paste a sequence.
 * The sequence is kept as a file of the entry (GenBank or FASTA), which the sequence editor opens.
 */
(function () {
  'use strict';
  const SEQUENCE_FILES = '.gb,.gbk,.gbff,.genbank,.fasta,.fa,.fna,.dna';
  const SEQUENCE_FILE_NAME = /\.(gb|gbk|gbff|genbank|fasta|fa|fna|dna)$/i;
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  };

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

  // a name that is fine for a file
  const safeName = function (name) {
    return (name || 'sequence').trim().replace(/[^A-Za-z0-9._() +-]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'sequence';
  };

  // the text pasted becomes a file: GenBank when it looks like one, else FASTA (bases only, with or without a header)
  function fileFromText(title, text) {
    const trimmed = text.trim();
    const name = safeName(title);
    if (/^LOCUS\b/m.test(trimmed)) {
      return new File([trimmed + '\n'], name + '.gb', { type: 'text/plain' });
    }
    const lines = trimmed.split(/\r?\n/);
    const header = lines[0].startsWith('>') ? lines.shift().slice(1).trim() : '';
    const bases = lines.join('').replace(/[^A-Za-z*-]/g, '').toUpperCase();
    if (bases.length === 0) {
      return null;
    }
    const wrapped = bases.match(/.{1,70}/g).join('\n');
    return new File(['>' + (header || title || name) + '\n' + wrapped + '\n'], name + '.fasta', { type: 'text/plain' });
  }

  async function createEntry(category, title, register) {
    const response = await fetch('api/v2/inventory', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token() },
      body: JSON.stringify(Object.assign(title ? { category: category, title: title } : { category: category }, register ? { register: register, registered: register === 'both' || register === 'lab' } : { registered: true })),
    });
    if (!response.ok) {
      throw new Error('The entry could not be created (' + response.status + ').');
    }
    return Number((response.headers.get('Location') || '').split('/').pop());
  }

  async function uploadFile(entryId, file) {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('api/v2/inventory/' + entryId + '/uploads', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': token() },
      body: form,
    });
    if (!response.ok) {
      // a plasmid has one primary sequence: the server says so when there is one already
      const said = await response.json().catch(function () {
        return null;
      });
      throw new Error(said && said.message ? said.message : 'The sequence could not be attached (' + response.status + ').');
    }
  }

  async function addParent(entryId, parentId) {
    await fetch('lineage.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
      body: JSON.stringify({ action: 'add', entry: entryId, parent: parentId }),
    });
  }

  // ---- the primers written in a GenBank file: after a plasmid got its sequence from one, the user is asked whether to attach the
  // primers that are in the database and to add the ones that are missing (genbank-primers.js reads the file, primer-tools.js talks
  // to the database; both are loaded when they are needed)
  const GENBANK_FILE = /\.(gb|gbk|gbff|genbank)$/i;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const tag = document.createElement('script');
      tag.src = src + '?v=' + Math.floor(Date.now() / 60000);
      tag.onload = resolve;
      tag.onerror = function () {
        reject(new Error(src + ' could not be loaded.'));
      };
      document.head.append(tag);
    });
  }

  // what a GenBank file says about the plasmid (its name, size, resistance...), null for another kind of file
  async function summaryOf(file) {
    if (!file || !GENBANK_FILE.test(file.name || '')) {
      return null;
    }
    try {
      if (!window.GenbankPrimers) {
        await loadScript('genbank-primers.js');
      }
      return window.GenbankPrimers.summary(await file.text());
    } catch (error) {
      return null;
    }
  }

  // the fields of the module that the file answers are filled in (the resistance, when the genes of the file show one antibiotic);
  // what the file does not say is left as it is
  async function applyDetails(entryId, details) {
    if (!details || details.resistance === '') {
      return;
    }
    try {
      const entry = await (await fetch('api/v2/inventory/' + entryId, { credentials: 'same-origin' })).json();
      const metadata = JSON.parse(entry.metadata || '{"extra_fields":{}}');
      const fields = metadata.extra_fields || {};
      const key = Object.keys(fields).find(function (field) {
        return /^resistance/i.test(field);
      });
      if (!key || (Array.isArray(fields[key].options) && fields[key].options.indexOf(details.resistance) === -1)) {
        return;
      }
      fields[key].value = details.resistance;
      metadata.extra_fields = fields;
      await fetch('api/v2/inventory/' + entryId, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token() },
        body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
      });
    } catch (error) {
      console.warn('The details of the file could not be filled in:', error);
    }
  }

  // the Backbone the sequence points to: the server compares it with the plasmids of the lab that have a Backbone and fills the empty field
  // (an entry that has one keeps it); returns {filled, backbone, score, reason} or null
  async function fillBackbone(entryId) {
    try {
      const response = await fetch('backbone.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token() },
        body: JSON.stringify({ entry: entryId }),
      });
      return response.ok ? await response.json() : null;
    } catch (error) {
      return null;
    }
  }

  // a line that tells what was read from the file
  function describeDetails(details) {
    const parts = [];
    if (details.name) {
      parts.push('name ' + details.name);
    }
    if (details.length > 0) {
      parts.push(details.length + ' bp' + (details.topology ? ', ' + details.topology : ''));
    }
    if (details.resistance) {
      parts.push('resistance ' + details.resistance + ' (' + details.resistanceFrom + ')');
    }
    return parts.length > 0 ? 'Read from the file: ' + parts.join('; ') + '.' : '';
  }

  // items: [{ entry: id of the plasmid, title, file: the sequence file that was attached }]. Resolves when the user is done.
  async function offerPrimers(items) {
    let rows = [];
    let tools = null;
    try {
      if (!window.GenbankPrimers) {
        await loadScript('genbank-primers.js');
      }
      if (!window.PrimerTools) {
        await loadScript('primer-tools.js');
      }
      tools = window.PrimerTools;
      const reader = window.GenbankPrimers;
      const found = [];
      for (const item of items) {
        if (!GENBANK_FILE.test(item.file.name || '')) {
          continue;
        }
        const seen = new Set();
        reader.read(await item.file.text()).forEach(function (primer) {
          const key = reader.key(primer.bases);
          if (primer.bases.length >= reader.minLength && !seen.has(key)) {
            seen.add(key);
            found.push(Object.assign({ entry: item.entry, plasmid: item.title, key: key }, primer));
          }
        });
      }
      if (found.length === 0) {
        return;
      }
      // the primers and probes of the database, by their letters (either strand)
      const known = new Map();
      (await tools.allPrimers()).forEach(function (primer) {
        const letters = reader.clean(primer.sequence);
        if (letters.length >= reader.minLength) {
          const key = reader.key(letters);
          known.set(key, (known.get(key) || []).concat(primer));
        }
      });
      rows = found.map(function (primer) {
        const same = known.get(primer.key) || [];
        const ids = Array.from(new Set(same.map(function (item) {
          return item.id;
        })));
        // a primer that is only in My entries (no number of the lab) can be put in the lab database when it is the user's own
        const only = ids.length === 1 ? same[0] : null;
        return Object.assign(primer, { id: ids.length === 1 ? ids[0] : null, several: ids.length > 1, toLab: only !== null && !only.lab && only.own });
      });
    } catch (error) {
      // the sequence is attached: the question about the primers is not worth stopping for
      console.warn('The primers of the file could not be read:', error);
      return;
    }

    // every primer of the file is listed with a box: what is ticked is attached (and added to the database when it is not there yet)
    rows.forEach(function (row) {
      row.picked = !row.several;
    });
    await new Promise(function (resolve) {
      const backdrop = element('div', 'sa-backdrop');
      const dialog = element('div', 'sa-dialog');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      const plasmids = new Set(rows.map(function (row) {
        return row.entry;
      }));
      const inDatabase = rows.filter(function (row) {
        return row.id !== null;
      }).length;
      const notThere = rows.filter(function (row) {
        return row.id === null && !row.several;
      }).length;
      dialog.append(element('h4', '', 'Primers in the GenBank file' + (plasmids.size > 1 ? 's' : '')));
      dialog.append(element('p', '', rows.length + (rows.length === 1 ? ' primer is' : ' primers are') + ' written in the file' + (plasmids.size > 1 ? 's' : '') + ': '
        + inDatabase + ' already in the database' + (notThere > 0 ? ', ' + notThere + ' not in the database yet' : '') + '. Tick the ones to add to the database and attach to the plasmid.'));
      const message = element('p', 'sa-message');
      const actions = element('div', 'sa-actions');
      const go = element('button', 'btn btn-primary', '');
      go.type = 'button';
      const refresh = function () {
        const add = rows.filter(function (row) {
          return row.picked && row.id === null && !row.several;
        }).length;
        const have = rows.filter(function (row) {
          return row.picked && row.id !== null;
        }).length;
        // the primers that are only in My entries go to the lab database when that is the choice of "New primers go to"
        const lab = tools.inLab() ? rows.filter(function (row) {
          return row.picked && row.toLab;
        }).length : 0;
        go.disabled = add + have === 0;
        go.textContent = add + have === 0 ? 'Nothing is ticked' : (add > 0 ? 'Add ' + add + ' to the database' + (have > 0 ? ' and attach ' + (add + have) : ' and attach ' + (add === 1 ? 'it' : 'them')) : 'Attach ' + have) + (lab > 0 ? ', put ' + lab + ' in the lab database' : '');
      };
      const bar = element('div', 'small mb-1');
      [['Tick all', true], ['Tick none', false]].forEach(function (choice) {
        const node = element('button', 'btn btn-link btn-sm p-0 mr-3', choice[0]);
        node.type = 'button';
        node.addEventListener('click', function () {
          rows.forEach(function (row) {
            row.picked = choice[1] && !row.several;
          });
          list.querySelectorAll('input').forEach(function (box, index) {
            box.checked = rows[index].picked;
          });
          refresh();
        });
        bar.append(node);
      });
      const list = element('div', 'small');
      list.style.maxHeight = '16rem';
      list.style.overflow = 'auto';
      list.style.border = '1px solid #dee2e6';
      list.style.borderRadius = '4px';
      list.style.padding = '0.3rem 0.5rem';
      rows.forEach(function (row) {
        const line = element('label', 'd-flex align-items-baseline');
        line.style.fontWeight = '400';
        line.style.marginBottom = '0.2rem';
        const box = element('input', 'mr-2');
        box.type = 'checkbox';
        box.checked = row.picked;
        box.disabled = row.several;
        box.addEventListener('change', function () {
          row.picked = box.checked;
          refresh();
        });
        const state = row.id !== null ? (row.toLab ? 'in My entries only, not in the lab database' : 'in the database') : row.several ? 'several in the database have these letters: left alone' : 'not in the database yet';
        const text = element('span', '', row.name + (plasmids.size > 1 ? ' (' + row.plasmid + ')' : ''));
        text.style.flex = '1';
        const detail = element('span', 'text-muted ml-2', row.bases.length + ' bases, ' + state);
        detail.style.whiteSpace = 'nowrap';
        line.append(box, text, detail);
        list.append(line);
      });
      const where = tools.destinationControl();
      // the choice changes what the button says
      where.addEventListener('change', function () {
        refresh();
      });
      dialog.append(bar, list, where, message, actions);
      backdrop.append(dialog);
      document.body.append(backdrop);

      const close = function () {
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        resolve();
      };
      const onKey = function (event) {
        if (event.key === 'Escape') {
          close();
        }
      };
      document.addEventListener('keydown', onKey);
      const notNow = element('button', 'btn btn-secondary', 'Not now');
      notNow.type = 'button';
      notNow.addEventListener('click', close);
      actions.append(notNow, go);
      refresh();
      go.addEventListener('click', async function () {
        actions.querySelectorAll('button').forEach(function (node) {
          node.disabled = true;
        });
        message.className = 'sa-message';
        message.textContent = 'Working...';
        const made = new Map();
        const titles = new Map();
        let attached = 0;
        let created = 0;
        let inLab = 0;
        const registered = new Set();
        const notInLab = [];
        try {
          for (const row of rows.filter(function (item) {
            return item.picked && !item.several;
          })) {
            let id = row.id;
            if (id === null) {
              id = made.get(row.key) || null;
              if (id === null) {
                // two different primers with one name are told apart by the plasmid and the place
                let title = row.name;
                if (titles.has(title.toLowerCase()) && titles.get(title.toLowerCase()) !== row.key) {
                  title += ' (' + row.plasmid + ' ' + row.start + '-' + row.end + ')';
                }
                id = await tools.createPrimer(title, row.bases, row.forward, row.plasmid, row.entry);
                titles.set(title.toLowerCase(), row.key);
                made.set(row.key, id);
                created += 1;
              }
            }
            await tools.attach(row.entry, id);
            attached += 1;
            // a primer that is only in My entries goes into the lab database too, when that is the choice
            if (row.toLab && tools.inLab() && !registered.has(id)) {
              registered.add(id);
              try {
                await tools.registerInLab(id);
                inLab += 1;
              } catch (error) {
                notInLab.push(row.name + ': ' + (error.message || error));
              }
            }
          }
          message.textContent = attached + (attached === 1 ? ' primer' : ' primers') + ' attached' + (created > 0 ? ', ' + created + ' of them added to the database' : '') + (inLab > 0 ? ', ' + inLab + ' put in the lab database' : '') + '.' + (notInLab.length > 0 ? ' Not put in the lab database: ' + notInLab.join('; ') : '');
        } catch (error) {
          message.textContent = (error.message || String(error)) + (attached > 0 ? ' (' + attached + ' attached before that.)' : '');
          message.className = 'sa-message error';
        }
        actions.textContent = '';
        const done = element('button', 'btn btn-primary', 'Close');
        done.type = 'button';
        done.addEventListener('click', close);
        actions.append(done);
      });
    });
  }

  // a search of the entries of the database, to pick the parents of a plasmid
  function parentPicker(onChange) {
    const wrap = element('div', 'sa-parents');
    const chips = element('div', 'sa-chips');
    const input = element('input', 'sa-input');
    input.type = 'search';
    input.placeholder = 'Search the plasmid it was made from...';
    input.autocomplete = 'off';
    const results = element('div', 'sa-results');
    results.hidden = true;
    const picked = new Map();
    const draw = function () {
      chips.textContent = '';
      picked.forEach(function (entry, id) {
        const chip = element('span', 'sa-chip', entry.title);
        const remove = element('button', '', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove');
        remove.addEventListener('click', function () {
          picked.delete(id);
          draw();
          onChange();
        });
        chip.append(remove);
        chips.append(chip);
      });
    };
    let timer = 0;
    input.addEventListener('input', function () {
      window.clearTimeout(timer);
      const term = input.value.trim();
      if (term === '') {
        results.hidden = true;
        return;
      }
      timer = window.setTimeout(async function () {
        const response = await fetch('api/v2/inventory?limit=8&q=' + encodeURIComponent(term), { credentials: 'same-origin' });
        const entries = response.ok ? await response.json() : [];
        results.textContent = '';
        entries.forEach(function (entry) {
          const button = element('button', '', '#' + entry.id + ' ' + entry.title + (entry.category_title ? ' (' + entry.category_title + ')' : ''));
          button.type = 'button';
          button.addEventListener('click', function () {
            picked.set(entry.id, entry);
            results.hidden = true;
            input.value = '';
            draw();
            onChange();
          });
          results.append(button);
        });
        if (entries.length === 0) {
          results.append(element('div', 'sa-none', 'Nothing found.'));
        }
        results.hidden = false;
      }, 250);
    });
    wrap.append(chips, input, results);
    return { element: wrap, ids: function () { return Array.from(picked.keys()); } };
  }

  // the dialog of a new plasmid
  function openNewEntry(categoryId, categoryTitle) {
    const backdrop = element('div', 'sa-backdrop');
    const dialog = element('div', 'sa-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.append(element('h4', '', 'New entry: ' + categoryTitle));

    const nameLabel = element('label', '', 'Name');
    const name = element('input', 'sa-input');
    name.type = 'text';
    name.placeholder = 'pMyPlasmid';
    nameLabel.append(name);

    const parents = parentPicker(function () {});
    const parentsLabel = element('label', '', 'Made from (optional)');
    parentsLabel.append(parents.element);

    const sequenceTitle = element('div', 'sa-section', 'Sequence');
    const choices = element('div', 'sa-choices');
    const radios = {};
    [['none', 'Add it later'], ['file', 'Attach a file (GenBank, FASTA or SnapGene), or drop it here (several files dropped together make one entry each)'], ['paste', 'Paste the sequence']].forEach(function (choice, index) {
      const label = element('label', 'sa-radio');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'sa-sequence';
      radio.value = choice[0];
      radio.checked = index === 0;
      radios[choice[0]] = radio;
      label.append(radio, document.createTextNode(' ' + choice[1]));
      choices.append(label);
    });
    const file = element('input');
    file.type = 'file';
    file.accept = SEQUENCE_FILES;
    const paste = element('textarea', 'sa-input');
    paste.rows = 6;
    paste.placeholder = 'GenBank text, FASTA, or the bases alone';
    const showChoice = function () {
      file.hidden = !radios.file.checked;
      paste.hidden = !radios.paste.checked;
    };
    Object.values(radios).forEach(function (radio) {
      radio.addEventListener('change', showChoice);
    });
    showChoice();

    const message = element('p', 'sa-message');
    // the name was filled in from the file, not typed: a new file may replace it
    let nameFromFile = false;
    name.addEventListener('input', function () {
      nameFromFile = false;
    });
    const fillFromFile = async function (chosen) {
      const details = await summaryOf(chosen);
      if (!details) {
        return;
      }
      if (details.name && (name.value.trim() === '' || nameFromFile)) {
        name.value = details.name;
        nameFromFile = true;
      }
      const said = describeDetails(details);
      if (said !== '') {
        message.className = 'sa-message';
        message.textContent = chosen.name + ' chosen. ' + said;
      }
    };
    const actions = element('div', 'sa-actions');
    const cancel = element('button', 'btn btn-secondary', 'Cancel');
    cancel.type = 'button';
    const create = element('button', 'btn btn-primary', 'Create');
    create.type = 'button';
    actions.append(cancel, create);
    dialog.append(nameLabel, parentsLabel, sequenceTitle, choices, file, paste, message, actions);

    // a sequence file dropped on the dialog is chosen as the file of the new entry. The drop stops here: the list behind the dialog
    // would otherwise make one entry per file dropped (see the drop of files on the list below)
    const hasFiles = function (event) {
      return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1;
    };
    backdrop.addEventListener('dragover', function (event) {
      if (hasFiles(event)) {
        event.preventDefault();
        event.stopPropagation();
        dialog.classList.add('sa-drop-target');
      }
    });
    backdrop.addEventListener('dragleave', function (event) {
      if (!backdrop.contains(event.relatedTarget)) {
        dialog.classList.remove('sa-drop-target');
      }
    });
    backdrop.addEventListener('drop', function (event) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dialog.classList.remove('sa-drop-target');
      const dropped = event.dataTransfer.files[0];
      message.className = 'sa-message';
      message.textContent = '';
      if (!dropped) {
        return;
      }
      if (!SEQUENCE_FILE_NAME.test(dropped.name)) {
        message.textContent = dropped.name + ' is not a sequence file (GenBank, FASTA or SnapGene).';
        message.className = 'sa-message error';
        return;
      }
      // several sequence files dropped together: one new entry each, in the lab database (like this dialog makes its entry), named from the files
      const sequences = Array.from(event.dataTransfer.files).filter(function (candidate) {
        return SEQUENCE_FILE_NAME.test(candidate.name);
      });
      if (sequences.length > 1) {
        close();
        addFiles(sequences.slice(0, 50), 0, categoryId, 'both');
        return;
      }
      const list = new DataTransfer();
      list.items.add(dropped);
      file.files = list.files;
      radios.file.checked = true;
      showChoice();
      message.textContent = dropped.name + ' chosen.';
      fillFromFile(dropped);
    });
    // a GenBank file chosen or dropped fills the name (unless the user typed one) and tells what else it says
    file.addEventListener('change', function () {
      if (file.files && file.files[0]) {
        fillFromFile(file.files[0]);
      }
    });
    backdrop.append(dialog);
    document.body.append(backdrop);
    name.focus();

    const close = function () {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = function (event) {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    cancel.addEventListener('click', close);
    backdrop.addEventListener('mousedown', function (event) {
      if (event.target === backdrop) {
        close();
      }
    });

    create.addEventListener('click', async function () {
      message.textContent = '';
      message.className = 'sa-message';
      let title = name.value.trim();
      let sequenceFile = null;
      if (radios.file.checked) {
        sequenceFile = file.files && file.files[0] ? file.files[0] : null;
        if (!sequenceFile) {
          message.textContent = 'Choose the sequence file, or pick "Add it later".';
          message.className = 'sa-message error';
          return;
        }
        if (title === '') {
          // the name the GenBank file carries, else the name of the file
          const found = await summaryOf(sequenceFile);
          title = (found && found.name) || sequenceFile.name.replace(/\.[^.]+$/, '');
        }
      } else if (radios.paste.checked) {
        if (title === '' && /^LOCUS\b/m.test(paste.value)) {
          const found = await summaryOf(new File([paste.value], 'pasted.gb'));
          title = (found && found.name) || '';
        }
        sequenceFile = fileFromText(title, paste.value);
        if (!sequenceFile) {
          message.textContent = 'There is no sequence in the text.';
          message.className = 'sa-message error';
          return;
        }
      }
      create.disabled = true;
      try {
        const id = await createEntry(categoryId, title);
        if (sequenceFile) {
          await uploadFile(id, sequenceFile);
          // what the GenBank file says is filled in the fields of the entry
          await applyDetails(id, await summaryOf(sequenceFile));
          await fillBackbone(id);
        }
        for (const parentId of parents.ids()) {
          await addParent(id, parentId);
        }
        // a GenBank file can carry primers: ask whether to attach them and add the missing ones to the database
        if (sequenceFile) {
          await offerPrimers([{ entry: id, title: title, file: sequenceFile }]);
        }
        window.location.href = 'registry.php?mode=edit&id=' + id;
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'sa-message error';
        create.disabled = false;
      }
    });
  }

  // the button of a new plasmid opens the dialog, instead of creating an empty entry at once
  document.addEventListener('click', function (event) {
    const button = event.target.closest ? event.target.closest('[data-with-sequence]') : null;
    if (!button) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openNewEntry(Number(button.dataset.category), button.dataset.categoryTitle || 'Plasmid');
  }, true);

  // on the edit page of a plasmid: attach a sequence file or paste a sequence
  function bindAttach() {
    const holder = document.getElementById('sequenceAttach');
    if (!holder) {
      return;
    }
    const entryId = Number(holder.dataset.entry);
    const title = holder.dataset.title || 'sequence';
    const message = element('span', 'sa-message');
    const input = element('input');
    input.type = 'file';
    input.accept = SEQUENCE_FILES;
    input.setAttribute('aria-label', 'Attach a sequence file');
    const pasteButton = element('button', 'btn btn-secondary btn-sm ml-2', 'Paste a sequence');
    pasteButton.type = 'button';
    const area = element('textarea', 'sa-input mt-2');
    area.rows = 6;
    area.hidden = true;
    area.placeholder = 'GenBank text, FASTA, or the bases alone';
    const save = element('button', 'btn btn-primary btn-sm mt-2', 'Attach this sequence');
    save.type = 'button';
    save.hidden = true;
    const done = async function (file) {
      message.textContent = 'Attaching...';
      message.className = 'sa-message';
      try {
        await uploadFile(entryId, file);
        message.textContent = '';
        await offerPrimers([{ entry: entryId, title: title, file: file }]);
        window.location.reload();
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'sa-message error';
      }
    };
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) {
        done(input.files[0]);
      }
    });
    pasteButton.addEventListener('click', function () {
      area.hidden = !area.hidden;
      save.hidden = area.hidden;
    });
    save.addEventListener('click', function () {
      const file = fileFromText(title, area.value);
      if (!file) {
        message.textContent = 'There is no sequence in the text.';
        message.className = 'sa-message error';
        return;
      }
      done(file);
    });
    holder.append(input, pasteButton, area, save, message);
  }
  bindAttach();

  // the x next to a sequence or a sequencing read removes the file from the entry (it stays in the history of the entry).
  // No native confirm box (it can be blocked): the first click asks "Remove?" on the button, the second one removes.
  document.addEventListener('click', async function (event) {
    const button = event.target.closest ? event.target.closest('[data-remove-upload]') : null;
    if (!button) {
      return;
    }
    if (button.dataset.armed !== '1') {
      const original = button.innerHTML;
      button.dataset.armed = '1';
      button.classList.add('btn-danger');
      button.innerHTML = 'Remove ' + (button.dataset.removeName || 'the file') + '?';
      button.title = 'Click again to remove the file from this entry';
      window.setTimeout(function () {
        if (button.dataset.armed === '1') {
          button.dataset.armed = '';
          button.classList.remove('btn-danger');
          button.innerHTML = original;
        }
      }, 4000);
      return;
    }
    button.disabled = true;
    try {
      const response = await fetch('api/v2/inventory/' + button.dataset.removeEntry + '/uploads/' + button.dataset.removeUpload, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
      });
      if (!response.ok) {
        throw new Error('The file could not be removed (' + response.status + ').');
      }
      window.location.reload();
    } catch (error) {
      button.disabled = false;
      button.dataset.armed = '';
      button.textContent = error.message || String(error);
    }
  });
  function toast(text, failed, seconds) {
    const note = element('div', 'sa-toast', text);
    note.setAttribute('role', 'status');
    if (failed) {
      note.style.background = '#b3261e';
    }
    document.body.append(note);
    window.setTimeout(function () {
      note.remove();
    }, (seconds || 6) * 1000);
  }

  // files given to a module: one new entry each (named by the GenBank file, with what it says), or all of them to one entry that is there.
  // The GenBank files can carry primers: one question for all of them. Used by the drop on the list and by the Import dialog.
  async function addFiles(files, entry, category, register) {
    toast('Adding ' + files.length + (files.length === 1 ? ' file' : ' files') + '...');
    let done = 0;
    const failed = [];
    const withPrimers = [];
    const backbones = [];
    const made = [];
    // where the new entries go: 'both' the lab database (with the number of the lab), 'personal' the own database of the user (My entries,
    // private), 'none' no number yet (My entries)
    const where = register || 'personal';
    for (const file of files) {
      try {
        const details = await summaryOf(file);
        const named = (details && details.name) || file.name.replace(/\.[^.]+$/, '');
        const target = entry > 0 ? entry : await createEntry(category, named, where);
        if (entry === 0) {
          made.push(target);
        }
        await uploadFile(target, file);
        done += 1;
        // a new entry takes the name and the resistance the GenBank file carries; an entry that is there keeps what it has
        if (entry === 0) {
          await applyDetails(target, details);
        }
        // the Backbone from the sequence (an entry that has one keeps it)
        const backbone = await fillBackbone(target);
        if (backbone && backbone.filled) {
          backbones.push(named + ': ' + backbone.backbone);
        }
        if (GENBANK_FILE.test(file.name)) {
          withPrimers.push({ entry: target, title: named, file: file });
        }
      } catch (error) {
        failed.push(file.name + ': ' + (error.message || error));
      }
    }
    // the GenBank files dropped can carry primers: one question for all of them
    if (withPrimers.length > 0) {
      await offerPrimers(withPrimers);
    }
    // a new entry that is one, with nothing that failed, is opened (like the dialog of a new entry does)
    if (entry === 0 && made.length === 1 && done === 1 && failed.length === 0) {
      window.location.href = 'registry.php?mode=edit&id=' + made[0];
      return;
    }
    const placed = where === 'both' || where === 'lab' ? 'in the lab database' : where === 'none' ? 'in My entries, without a number yet' : 'in My entries, in your own database (private)';
    toast((entry > 0 ? done + ' attached to the entry.' : done + ' new ' + (done === 1 ? 'entry' : 'entries') + ' ' + placed + ', one per file.') + (backbones.length ? ' Backbone filled in from the sequence (check it): ' + backbones.slice(0, 5).join('; ') + (backbones.length > 5 ? ' ...' : '') + '.' : '') + (failed.length ? ' Not added: ' + failed.join('; ') : ''), failed.length > 0, 10);
    if (done > 0) {
      window.setTimeout(function () {
        window.location.reload();
      }, 4000);
    }
  }

  window.SequenceAdd = { addFiles: function (category, files, register) { return addFiles(files, 0, category, register); } };

  // ---- drag and drop of files on the list of a module: a file dropped on a row is attached to that entry (a sequence file opens in
  // the sequence editor); files dropped elsewhere on the list make one entry each in the module that is open, in your own database
  (function () {
    if (!/registry\.php$/.test(location.pathname) || new URLSearchParams(location.search).get('mode')) {
      return;
    }
    const hasFiles = function (event) {
      return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1;
    };
    const rowOf = function (target) {
      let row = target.closest ? target.closest('tr.expandable-row, tr.expandable-detail-row') : null;
      if (row && row.classList.contains('expandable-detail-row')) {
        row = row.previousElementSibling;
      }
      return row;
    };
    const entryOfRow = function (row) {
      const link = row ? row.querySelector('a[href*="id="]') : null;
      const match = link ? /[?&]id=(\d+)/.exec(link.getAttribute('href')) : null;
      return match ? Number(match[1]) : 0;
    };
    let marked = null;
    const mark = function (node) {
      if (marked && marked !== node) {
        marked.classList.remove('sa-drop-target');
      }
      marked = node;
      if (node) {
        node.classList.add('sa-drop-target');
      }
    };
    document.addEventListener('dragover', function (event) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      mark(rowOf(event.target) || document.getElementById('container'));
    });
    document.addEventListener('dragleave', function (event) {
      if (event.relatedTarget === null) {
        mark(null);
      }
    });
    document.addEventListener('drop', async function (event) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      mark(null);
      const files = Array.from(event.dataTransfer.files).slice(0, 50);
      if (files.length === 0) {
        return;
      }
      const row = rowOf(event.target);
      const entry = entryOfRow(row);
      const category = Number(new URLSearchParams(location.search).get('category'));
      if (entry === 0 && !(category > 0)) {
        toast('Open a module first: files dropped on the list make new entries in the module that is open.', true);
        return;
      }
      await addFiles(files, entry, category);
    });
  })();
})();
