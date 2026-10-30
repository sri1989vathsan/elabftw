/**
 * The align tool of the sidebar: aligns the sequencing reads (ab1 files) of the entry to the sequence in the editor, on the
 * server (align.php), and lists where each read sits and its differences. A click on a position selects it on the sequence.
 * The traces are shown on the alignment page. Needs bio-parsers. Exposed as window.AlignTab.
 */
(function () {
  'use strict';
  const body = document.body.dataset;

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

  async function readSequence(upload) {
    const params = new URLSearchParams({ f: upload.long_name, name: upload.real_name, storage: String(upload.storage) });
    const response = await fetch('../app/download.php?' + params.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(upload.real_name + ' could not be downloaded.');
    }
    const results = await window.bioParsers.anyToJson(new File([await response.blob()], upload.real_name), { fileName: upload.real_name });
    const parsed = Array.isArray(results) ? results[0] : results;
    if (!parsed || !parsed.success) {
      throw new Error(upload.real_name + ' could not be read.');
    }
    return String(parsed.parsedSequence.sequence).toUpperCase();
  }

  function setup(editor, context) {
    if (!window.ToolSidebar || !context.entryId) {
      return;
    }
    const entryId = context.entryId;
    const select = function (start, end) {
      editor.updateEditor({ selectionLayer: { start: start, end: end } });
    };

    // a place or a difference as a tag: a click selects it on the sequence
    const tag = function (text, kind, start, end) {
      const b = element('button', 'tool-tag tool-tag-' + kind, text);
      b.type = 'button';
      b.title = 'Select it on the sequence';
      b.addEventListener('click', function () {
        select(start, end);
      });
      return b;
    };

    function card(name, alignment) {
      const box = element('div', 'tool-card');
      const top = element('div', 'tool-card-top');
      top.append(element('strong', '', name));
      box.append(top);
      if (!alignment) {
        box.append(element('div', 'tool-tags').appendChild(element('span', 'tool-tag tool-tag-bad', 'not found on this sequence')).parentNode);
        return box;
      }
      const chips = element('span', 'tool-chips');
      [(alignment.strand === '-' ? 'reverse strand' : 'forward strand'), 'identity ' + (alignment.identity * 100).toFixed(1) + '%'].forEach(function (text) {
        chips.append(element('span', 'tool-chip', text));
      });
      top.append(chips);
      const where = element('div', 'tool-tags');
      where.append(tag((alignment.refStart + 1) + '..' + alignment.refEnd, 'site', alignment.refStart, alignment.refEnd - 1));
      box.append(where);
      const differences = element('div', 'tool-tags');
      alignment.mismatches.forEach(function (m) {
        differences.append(tag(m.position + ' ' + m.reference + '→' + m.read, 'diff', m.position - 1, m.position - 1));
      });
      alignment.deletions.forEach(function (position) {
        differences.append(tag('missing ' + position, 'diff', position - 1, position - 1));
      });
      alignment.insertions.forEach(function (position) {
        differences.append(tag('extra after ' + position, 'diff', Math.max(0, position - 1), Math.max(0, position - 1)));
      });
      alignment.unknown.forEach(function (position) {
        differences.append(tag('unread ' + position, 'unknown', position - 1, position - 1));
      });
      if (differences.children.length === 0) {
        differences.append(element('span', 'tool-tag tool-tag-good', 'no difference'));
      }
      box.append(differences);
      return box;
    }

    // a file dropped on the tool is read from the computer: it is not in the entry unless it is saved there
    async function readLocal(file) {
      const results = await window.bioParsers.anyToJson(file, { fileName: file.name });
      const parsed = Array.isArray(results) ? results[0] : results;
      if (!parsed || !parsed.success) {
        throw new Error(file.name + ' could not be read.');
      }
      return String(parsed.parsedSequence.sequence).toUpperCase();
    }

    async function saveToEntry(file, button) {
      button.disabled = true;
      button.textContent = 'Saving...';
      const form = new FormData();
      form.append('file', file);
      try {
        const response = await fetch('../api/v2/inventory/' + entryId + '/uploads', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-CSRF-Token': body.csrf },
          body: form,
        });
        if (!response.ok) {
          throw new Error('not saved (' + response.status + ')');
        }
        button.textContent = 'Saved in the entry';
      } catch (error) {
        button.textContent = 'Could not save';
        button.disabled = false;
      }
    }

    // items: {name, load(): the sequence, file?: a dropped file}
    async function run(items, results, message) {
      message.textContent = 'Reading and aligning...';
      message.className = 'tool-message';
      results.textContent = '';
      try {
        const reads = [];
        for (const item of items) {
          reads.push({ name: item.name, sequence: await item.load() });
        }
        const reference = String(editor.getState().sequenceData.sequence || '').toUpperCase();
        const response = await fetch('align.php', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': body.csrf },
          body: JSON.stringify({ entry: entryId, reference: reference, reads: reads }),
        });
        if (!response.ok) {
          throw new Error('The alignment failed (' + response.status + ').');
        }
        const answer = (await response.json()).results;
        answer.forEach(function (result, index) {
          const box = card(reads[index].name, result.alignment);
          if (items[index].file && body.canWrite === '1') {
            const save = element('button', 'tool-btn', 'Save in the entry');
            save.type = 'button';
            save.addEventListener('click', function () {
              saveToEntry(items[index].file, save);
            });
            box.append(save);
          }
          results.append(box);
        });
        message.textContent = '';
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'tool-message error';
      }
    }

    async function show(host) {
      host.append(element('p', 'tool-muted', 'Aligns sequencing reads (ab1 files) to the sequence in the editor.'));
      const message = element('p', 'tool-message');
      const results = element('div', 'tool-results');
      const dropped = [];
      let list = [];
      try {
        const response = await fetch('../api/v2/inventory/' + entryId + '/uploads', { credentials: 'same-origin' });
        list = (response.ok ? await response.json() : []).filter(function (u) {
          return /\.ab1$/i.test(u.real_name);
        });
      } catch (error) {
        message.textContent = 'The files of the entry could not be listed.';
        message.className = 'tool-message error';
      }
      const everything = function () {
        return list.map(function (upload) {
          return { name: upload.real_name, load: function () {
            return readSequence(upload);
          } };
        }).concat(dropped.map(function (file) {
          return { name: file.name + ' (dropped)', file: file, load: function () {
            return readLocal(file);
          } };
        }));
      };

      // drop the files here, or click to choose them
      const zone = element('div', 'tool-drop', 'Drop ab1 files here, or click to choose them');
      zone.tabIndex = 0;
      const chooser = element('input');
      chooser.type = 'file';
      chooser.multiple = true;
      chooser.accept = '.ab1,.abi,.scf,.fasta,.fa';
      chooser.hidden = true;
      const take = function (files) {
        const accepted = Array.from(files).filter(function (file) {
          return /\.(ab1|abi|scf|fasta|fa)$/i.test(file.name);
        });
        if (accepted.length === 0) {
          message.textContent = 'Only sequencing files (ab1) can be used.';
          message.className = 'tool-message error';
          return;
        }
        accepted.forEach(function (file) {
          dropped.push(file);
        });
        names();
        run(everything(), results, message);
      };
      zone.addEventListener('click', function () {
        chooser.click();
      });
      zone.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          chooser.click();
        }
      });
      chooser.addEventListener('change', function () {
        take(chooser.files);
        chooser.value = '';
      });
      ['dragenter', 'dragover'].forEach(function (name) {
        zone.addEventListener(name, function (event) {
          event.preventDefault();
          zone.classList.add('over');
        });
      });
      zone.addEventListener('dragleave', function () {
        zone.classList.remove('over');
      });
      zone.addEventListener('drop', function (event) {
        event.preventDefault();
        zone.classList.remove('over');
        take(event.dataTransfer.files);
      });
      // a drop anywhere on the sidebar works too
      host.addEventListener('dragover', function (event) {
        event.preventDefault();
      });
      host.addEventListener('drop', function (event) {
        if (event.target !== zone && !zone.contains(event.target)) {
          event.preventDefault();
          take(event.dataTransfer.files);
        }
      });

      const nameBox = element('div', 'tool-tags');
      const names = function () {
        nameBox.textContent = '';
        list.forEach(function (upload) {
          nameBox.append(element('span', 'tool-chip', upload.real_name));
        });
        dropped.forEach(function (file) {
          nameBox.append(element('span', 'tool-chip', file.name + ' (dropped)'));
        });
      };
      names();
      host.append(zone, chooser, nameBox);
      const actions = element('div', 'tool-actions');
      const align = element('button', 'tool-btn tool-btn-primary', 'Align the reads of the entry');
      align.type = 'button';
      align.disabled = list.length === 0;
      align.addEventListener('click', function () {
        run(everything(), results, message);
      });
      const view = element('a', 'tool-btn', 'Open the alignment view');
      view.href = 'alignment.php?entry=' + entryId;
      view.title = 'Switch to the alignment view, with the traces';
      actions.append(align, view);
      host.append(actions, message, results);
    }

    window.ToolSidebar.register({ id: 'align', icon: 'align', label: 'Align sequencing reads', show: show });
  }

  window.AlignTab = { setup: setup };
})();
