/**
 * The align tool of the sidebar: aligns the sequencing reads (ab1 files) of the entry to the sequence in the editor, on the
 * server (align.php), and lists where each read sits and its differences. A click on a position selects it on the sequence.
 * The traces are shown on the alignment page. Needs bio-parsers. Exposed as window.AlignTab.
 */
(function () {
  'use strict';
  const body = document.body.dataset;

  // the algorithm of the alignment, kept for the next time and shared with the alignment view
  const ALGORITHMS = [['builtin', 'Built-in'], ['mafft', 'MAFFT'], ['clustalo', 'Clustal Omega']];
  function algorithmChoice() {
    try {
      const saved = window.localStorage.getItem('elabftw-aligner');
      return ALGORITHMS.some(function (a) {
        return a[0] === saved;
      }) ? saved : 'builtin';
    } catch (e) {
      return 'builtin';
    }
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

    function card(name, alignment, referenceLength) {
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
      if (alignment.wraps) {
        // a read over the origin of a circular plasmid: the end of the plasmid and then its start
        const beyond = alignment.refEnd - referenceLength;
        where.append(tag((alignment.refStart + 1) + '..' + referenceLength + ' + 1..' + beyond, 'site', alignment.refStart, beyond - 1));
        where.append(element('span', 'tool-chip', 'over the origin'));
      } else {
        where.append(tag((alignment.refStart + 1) + '..' + alignment.refEnd, 'site', alignment.refStart, alignment.refEnd - 1));
      }
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
          body: JSON.stringify({ entry: entryId, reference: reference, reads: reads, algorithm: algorithmChoice(), circular: editor.getState().sequenceData.circular === true }),
        });
        if (!response.ok) {
          // the answer says why, for example that a program is missing on the server
          const failure = await response.json().catch(function () {
            return {};
          });
          throw new Error(failure.error || 'The alignment failed (' + response.status + ').');
        }
        const reply = await response.json();
        const answer = reply.results;
        answer.forEach(function (result, index) {
          const box = card(reads[index].name, result.alignment, reference.length);
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
        message.textContent = reply.algorithm && reply.algorithm !== 'builtin' ? 'Aligned with ' + reply.label + '.' : '';
        // the result stays with the entry and is there the next time the tool is opened
        if (window.AlignmentStore && entryId) {
          window.AlignmentStore.save(entryId, body.csrf, {
            referenceLength: reference.length,
            results: answer.map(function (result, index) {
              return { name: reads[index].name, source: items[index].file ? 'dropped' : 'entry', alignment: result.alignment };
            }),
          }).then(function (saved) {
            if (saved) {
              message.textContent = 'Saved with the entry.';
            }
          });
        }
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
      let clustals = [];
      try {
        const response = await fetch('../api/v2/inventory/' + entryId + '/uploads', { credentials: 'same-origin' });
        const uploads = response.ok ? await response.json() : [];
        list = uploads.filter(function (u) {
          return /\.ab1$/i.test(u.real_name);
        });
        // the alignments attached to the entry (Clustal files, for example from Benchling)
        clustals = uploads.filter(function (u) {
          return /\.(aln|clustal|clw)$/i.test(u.real_name);
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
      // the algorithm: the built-in aligner, MAFFT or Clustal Omega; a new choice aligns the reads again
      const choice = element('label', 'tool-muted', 'Algorithm ');
      choice.title = 'The program that aligns the reads to the sequence';
      const menu = element('select', 'tool-btn');
      menu.setAttribute('aria-label', 'Algorithm');
      ALGORITHMS.forEach(function (a) {
        const option = element('option', '', a[1]);
        option.value = a[0];
        menu.append(option);
      });
      menu.value = algorithmChoice();
      menu.addEventListener('change', function () {
        try {
          window.localStorage.setItem('elabftw-aligner', menu.value);
        } catch (e) {
          // the choice is then only kept until the page is closed: nothing else to do
        }
        if (results.children.length > 0) {
          run(everything(), results, message);
        }
      });
      choice.append(menu);
      actions.append(align, view, choice);
      host.append(actions, message, results);
      // the alignments attached to the entry: each opens in the alignment view
      if (clustals.length > 0) {
        host.append(element('p', 'tool-muted', 'Alignments attached to this entry (Clustal files):'));
        const attached = element('div', 'tool-actions');
        clustals.forEach(function (upload) {
          const open = element('a', 'tool-btn', upload.real_name);
          open.href = 'alignment.php?entry=' + entryId + '&clustal=' + upload.id;
          open.title = 'Open this alignment';
          attached.append(open);
        });
        host.append(attached);
      }
      // the last alignment of the entry, saved when the reads were aligned
      if (window.AlignmentStore && entryId) {
        window.AlignmentStore.load(entryId).then(function (saved) {
          if (!saved || results.children.length > 0) {
            return;
          }
          saved.results.forEach(function (item) {
            const box = card(item.name + (item.source === 'dropped' ? ' (dropped)' : ''), item.alignment);
            results.append(box);
          });
          const length = String(editor.getState().sequenceData.sequence || '').length;
          const when = new Date(saved.savedAt);
          message.textContent = 'Saved alignment of ' + saved.results.length + (saved.results.length === 1 ? ' read' : ' reads') + ', ' + (Number.isNaN(when.getTime()) ? '' : when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })) + '.' + (saved.referenceLength && saved.referenceLength !== length ? ' The sequence has changed since (' + saved.referenceLength + ' bases then, ' + length + ' now): align again.' : '');
          message.className = 'tool-message' + (saved.referenceLength && saved.referenceLength !== length ? ' error' : '');
        });
      }
    }

    window.ToolSidebar.register({ id: 'align', icon: 'align', label: 'Align sequencing reads', show: show });
  }

  window.AlignTab = { setup: setup };
})();
