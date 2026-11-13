/**
 * The insert chooser of the cloning tools: a sequence of the Database (searched by name or number, its oldest sequence file is read)
 * or bases typed in. Exposed as window.CloningInsert.create(); the result holds the nodes to put in a panel and get(), which gives
 * {data: editor data of the sequence, entry: the Database entry or null} or null when nothing is chosen. Needs primer-tools.js
 * (base cleaning) and the bio-parsers of the editor.
 */
(function () {
  'use strict';
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

  // the sequence of a Database entry (its oldest sequence file) as editor data, with its features
  async function entrySequence(entry) {
    const response = await fetch('../api/v2/inventory/' + entry.id + '/uploads', { credentials: 'same-origin' });
    const files = (response.ok ? await response.json() : []).filter(function (file) {
      return Number(file.state) === 1 && SEQUENCE_FILE.test(file.real_name || '') && !/\.read\.(fasta|fa)$/i.test(file.real_name);
    });
    if (files.length === 0) {
      throw new Error('This entry has no sequence file.');
    }
    const file = files[0];
    const params = new URLSearchParams({ f: file.long_name, name: file.real_name, storage: String(file.storage) });
    const download = await fetch('../app/download.php?' + params.toString(), { credentials: 'same-origin' });
    if (!download.ok) {
      throw new Error('The sequence file could not be read (' + download.status + ').');
    }
    const parsed = await window.bioParsers.anyToJson(await download.text(), { fileName: file.real_name });
    const data = parsed && parsed[0] && parsed[0].parsedSequence;
    if (!data || !data.sequence) {
      throw new Error('The sequence file could not be understood.');
    }
    return data;
  }

  function create() {
    let data = null;
    let entry = null;
    const box = element('div');
    const chosen = element('div', 'tool-muted', 'No insert chosen yet.');
    const search = element('input');
    search.type = 'text';
    search.placeholder = 'Insert: search the Database by name or number';
    const found = element('div');
    const paste = element('textarea');
    paste.rows = 2;
    paste.placeholder = 'or the bases of the insert, 5′ to 3′';
    paste.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:0.78rem';
    let timer = 0;
    search.addEventListener('input', function () {
      window.clearTimeout(timer);
      const term = search.value.trim();
      found.textContent = '';
      if (term === '') {
        return;
      }
      timer = window.setTimeout(async function () {
        let entries = [];
        try {
          const response = await fetch('../api/v2/inventory?limit=8&q=' + encodeURIComponent(term), { credentials: 'same-origin' });
          entries = response.ok ? await response.json() : [];
        } catch (error) {
          entries = [];
        }
        found.textContent = '';
        entries.forEach(function (candidate) {
          const pick = element('button', 'tool-btn', (candidate.custom_id ? '#' + candidate.custom_id + ' ' : '') + candidate.title);
          pick.type = 'button';
          pick.addEventListener('click', async function () {
            chosen.textContent = 'Reading ' + candidate.title + '...';
            try {
              data = await entrySequence(candidate);
              entry = candidate;
              paste.value = '';
              found.textContent = '';
              chosen.textContent = 'Insert: ' + candidate.title + ', ' + data.sequence.length + ' bases' + (data.circular ? ' (circular)' : '') + '.';
            } catch (error) {
              chosen.textContent = error.message || String(error);
            }
          });
          found.append(pick);
        });
        if (entries.length === 0) {
          found.append(element('div', 'tool-muted', 'Nothing found.'));
        }
      }, 250);
    });
    paste.addEventListener('input', function () {
      data = null;
      entry = null;
      chosen.textContent = paste.value.trim() === '' ? 'No insert chosen yet.' : 'Insert: typed, ' + window.PrimerTools.clean(paste.value).length + ' bases.';
    });
    box.append(search, found, paste, chosen);
    return {
      node: box,
      get: function () {
        if (data) {
          return { data: data, entry: entry };
        }
        const bases = window.PrimerTools.clean(paste.value);
        return bases ? { data: { sequence: bases, features: {}, circular: false }, entry: null } : null;
      },
    };
  }

  window.CloningInsert = { create: create };
})();
