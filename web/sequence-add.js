/**
 * Adding the sequence to a plasmid of the database:
 * - a dialog for a new plasmid (name, parents, sequence from a file or pasted), opened by the button of the module of the plasmids;
 * - on the edit page of a plasmid, a control to attach a sequence file or paste a sequence.
 * The sequence is kept as a file of the entry (GenBank or FASTA), which the sequence editor opens.
 */
(function () {
  'use strict';
  const SEQUENCE_FILES = '.gb,.gbk,.gbff,.genbank,.fasta,.fa,.fna,.dna';
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
    [['none', 'Add it later'], ['file', 'Attach a file (GenBank, FASTA or SnapGene)'], ['paste', 'Paste the sequence']].forEach(function (choice, index) {
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
    const actions = element('div', 'sa-actions');
    const cancel = element('button', 'btn btn-secondary', 'Cancel');
    cancel.type = 'button';
    const create = element('button', 'btn btn-primary', 'Create');
    create.type = 'button';
    actions.append(cancel, create);
    dialog.append(nameLabel, parentsLabel, sequenceTitle, choices, file, paste, message, actions);
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
          title = sequenceFile.name.replace(/\.[^.]+$/, '');
        }
      } else if (radios.paste.checked) {
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
        }
        for (const parentId of parents.ids()) {
          await addParent(id, parentId);
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
  // ---- drag and drop of files on the list of a module: a file dropped on a row is attached to that entry (a sequence file opens in
  // the sequence editor); files dropped elsewhere on the list make one entry each in the module that is open, in your own database
  (function () {
    if (!/registry\.php$/.test(location.pathname) || new URLSearchParams(location.search).get('mode')) {
      return;
    }
    const hasFiles = function (event) {
      return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1;
    };
    const toast = function (text, failed) {
      const note = element('div', 'sa-toast', text);
      note.setAttribute('role', 'status');
      if (failed) {
        note.style.background = '#b3261e';
      }
      document.body.append(note);
      window.setTimeout(function () {
        note.remove();
      }, 6000);
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
      toast('Adding ' + files.length + (files.length === 1 ? ' file' : ' files') + '...');
      let done = 0;
      const failed = [];
      for (const file of files) {
        try {
          const target = entry > 0 ? entry : await createEntry(category, file.name.replace(/\.[^.]+$/, ''), 'personal');
          await uploadFile(target, file);
          done += 1;
        } catch (error) {
          failed.push(file.name + ': ' + (error.message || error));
        }
      }
      toast((entry > 0 ? done + ' attached to the entry.' : done + ' new in your database, one entry per file.') + (failed.length ? ' Not added: ' + failed.join('; ') : ''), failed.length > 0);
      if (done > 0) {
        window.setTimeout(function () {
          window.location.reload();
        }, 1500);
      }
    });
  })();
})();
