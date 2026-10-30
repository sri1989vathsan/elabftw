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

    async function run(host, list, results, message) {
      message.textContent = 'Reading and aligning...';
      message.className = 'tool-message';
      results.textContent = '';
      try {
        const reads = [];
        for (const upload of list) {
          reads.push({ name: upload.real_name, sequence: await readSequence(upload) });
        }
        const reference = String(editor.getState().sequenceData.sequence || '').toUpperCase();
        const response = await fetch('../align.php', {
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
          results.append(card(reads[index].name, result.alignment));
        });
        message.textContent = '';
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'tool-message error';
      }
    }

    async function show(host) {
      host.append(element('p', 'tool-muted', 'Aligns the sequencing reads (ab1 files) of this entry to the sequence in the editor.'));
      const message = element('p', 'tool-message');
      const results = element('div', 'tool-results');
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
      if (list.length === 0) {
        host.append(element('p', 'tool-muted', 'No sequencing read in this entry. Attach the ab1 files in its local files.'), message);
        return;
      }
      const names = element('div', 'tool-tags');
      list.forEach(function (upload) {
        names.append(element('span', 'tool-chip', upload.real_name));
      });
      host.append(names);
      const actions = element('div', 'tool-actions');
      const align = element('button', 'tool-btn tool-btn-primary', 'Align ' + list.length + (list.length === 1 ? ' read' : ' reads'));
      align.type = 'button';
      align.addEventListener('click', function () {
        run(host, list, results, message);
      });
      const view = element('a', 'tool-btn', 'Open the alignment view');
      view.href = 'alignment.php?entry=' + entryId;
      view.target = '_blank';
      view.rel = 'noopener';
      actions.append(align, view);
      host.append(actions, message, results);
    }

    window.ToolSidebar.register({ id: 'align', icon: 'align', label: 'Align sequencing reads', show: show });
  }

  window.AlignTab = { setup: setup };
})();
