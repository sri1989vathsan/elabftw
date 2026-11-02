/**
 * The history tool of the sidebar: the versions of the sequence file of the entry. Every save keeps the earlier version as an archived
 * file of the entry; this lists them (the date, who saved it, the size), compares one with what is in the editor (the bases, the
 * features) and restores it: the version is loaded in the editor and saved like any other edit, so the version that was current is
 * kept in the history too. Needs bio-parsers. Exposed as window.HistoryTab.
 */
(function () {
  'use strict';

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

  const when = function (stamp) {
    const date = new Date(String(stamp).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? String(stamp) : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const size = function (bytes) {
    return bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
  };
  const featuresOf = function (data) {
    return Array.isArray(data.features) ? data.features : Object.values(data.features || {});
  };
  const keyOf = function (feature) {
    return [feature.name, feature.start, feature.end, feature.strand].join(':');
  };

  function setup(editor, context) {
    if (!window.ToolSidebar || !context.entryId) {
      return;
    }
    const entryId = context.entryId;
    let panel = null;
    let message = '';
    let busy = false;

    async function listing() {
      const response = await fetch('../api/v2/inventory/' + entryId + '/uploads?state=1,2', { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error('The versions could not be listed (' + response.status + ').');
      }
      const name = context.fileName();
      return (await response.json()).filter(function (upload) {
        return upload.real_name === name;
      }).sort(function (a, b) {
        return Number(b.id) - Number(a.id);
      });
    }

    async function read(upload) {
      const params = new URLSearchParams({ f: upload.long_name, name: upload.real_name, storage: String(upload.storage) });
      const response = await fetch('../app/download.php?' + params.toString(), { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error('This version could not be downloaded (' + response.status + ').');
      }
      const binary = /\.(dna|ab1)$/i.test(upload.real_name);
      const input = binary ? new File([await response.blob()], upload.real_name) : await response.text();
      const results = await window.bioParsers.anyToJson(input, { fileName: upload.real_name });
      const parsed = Array.isArray(results) ? results[0] : results;
      if (!parsed || !parsed.success) {
        throw new Error('This version could not be read.');
      }
      return parsed.parsedSequence;
    }

    // what restoring the version would change in the editor
    function compare(old) {
      const now = editor.getState().sequenceData;
      const a = String(now.sequence || '').toLowerCase();
      const b = String(old.sequence || '').toLowerCase();
      const notes = [];
      if (a === b) {
        notes.push(['same sequence', 'good']);
      } else if (a.length === b.length) {
        let different = 0;
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) {
            different++;
          }
        }
        notes.push([different + ' base' + (different === 1 ? '' : 's') + ' differ', 'diff']);
      } else {
        notes.push([a.length + ' → ' + b.length + ' bp', 'diff']);
      }
      const current = new Map(featuresOf(now).map(function (f) {
        return [keyOf(f), f.name];
      }));
      const earlier = new Map(featuresOf(old).map(function (f) {
        return [keyOf(f), f.name];
      }));
      const added = Array.from(earlier.keys()).filter(function (k) {
        return !current.has(k);
      }).map(function (k) {
        return earlier.get(k);
      });
      const removed = Array.from(current.keys()).filter(function (k) {
        return !earlier.has(k);
      }).map(function (k) {
        return current.get(k);
      });
      const names = function (list) {
        return list.slice(0, 3).join(', ') + (list.length > 3 ? ' +' + (list.length - 3) : '');
      };
      if (added.length > 0) {
        notes.push(['brings back ' + names(added), 'site']);
      }
      if (removed.length > 0) {
        notes.push(['removes ' + names(removed), 'diff']);
      }
      if (added.length === 0 && removed.length === 0) {
        notes.push(['same features', 'good']);
      }
      return notes;
    }

    async function restore(upload) {
      const parsed = await read(upload);
      if (window.ViewerPalette) {
        window.ViewerPalette(parsed);
      }
      editor.updateEditor({ sequenceData: parsed, selectionLayer: { start: -1, end: -1 }, caretPosition: -1 });
      message = 'The version of ' + when(upload.created_at) + ' is in the editor. It is saved as a new version in a moment; the one you had stays in the history.';
    }

    // a version as a row of the table, with a second row for the result of Compare
    function row(upload, index, list) {
      const tr = element('tr');
      const cell = function (text) {
        const td = element('td', '', text);
        tr.append(td);
        return td;
      };
      cell(index === 0 ? 'current' : 'v' + (list.length - index)).className = index === 0 ? 'history-current' : '';
      cell(when(upload.created_at));
      cell(upload.fullname || '');
      cell(size(Number(upload.filesize) || 0));
      if (index === 0) {
        return [tr];
      }
      const notesRow = element('tr', 'history-notes');
      const holder = element('td');
      holder.colSpan = 4;
      const actions = element('div', 'history-actions');
      const notes = element('div', 'tool-tags');
      holder.append(actions, notes);
      notesRow.append(holder);
      tr.classList.add('history-main');
      const compareButton = element('button', 'tool-btn', 'Compare');
      compareButton.type = 'button';
      compareButton.addEventListener('click', async function () {
        compareButton.disabled = true;
        notes.textContent = '';
        try {
          compare(await read(upload)).forEach(function (note) {
            notes.append(element('span', 'tool-tag tool-tag-' + note[1], note[0]));
          });
        } catch (error) {
          notes.append(element('span', 'tool-tag tool-tag-bad', error.message || String(error)));
        }
        compareButton.disabled = false;
      });
      const restoreButton = element('button', 'tool-btn tool-btn-primary', 'Restore');
      restoreButton.type = 'button';
      restoreButton.disabled = !context.canWrite;
      restoreButton.title = context.canWrite ? 'Put this version in the editor' : 'You cannot edit this entry';
      // a second click restores: no native box that can be blocked
      restoreButton.addEventListener('click', async function () {
        if (restoreButton.dataset.armed !== '1') {
          restoreButton.dataset.armed = '1';
          restoreButton.textContent = 'Sure?';
          window.setTimeout(function () {
            restoreButton.dataset.armed = '';
            restoreButton.textContent = 'Restore';
          }, 4000);
          return;
        }
        restoreButton.disabled = true;
        try {
          await restore(upload);
          render(true);
        } catch (error) {
          message = error.message || String(error);
          render();
        }
      });
      const download = element('a', 'tool-btn', 'Download');
      download.href = '../app/download.php?' + new URLSearchParams({ f: upload.long_name, name: upload.real_name, storage: String(upload.storage) }).toString();
      download.download = upload.real_name;
      actions.append(compareButton, restoreButton, download);
      return [tr, notesRow];
    }

    function table(list) {
      const t = element('table', 'history-table');
      const head = element('thead');
      const hr = element('tr');
      ['Version', 'Saved', 'By', 'Size'].forEach(function (label) {
        hr.append(element('th', '', label));
      });
      head.append(hr);
      const body = element('tbody');
      list.forEach(function (upload, index) {
        body.append(...row(upload, index, list));
      });
      t.append(head, body);
      return t;
    }

    async function render(later) {
      if (!panel || window.ToolSidebar.active() !== 'history') {
        return;
      }
      panel.textContent = '';
      panel.append(element('p', 'tool-muted', 'Every save keeps the version before it. Restore one to put it back in the editor: the version you have now stays in this list.'));
      const note = element('p', 'tool-message', message);
      panel.append(note);
      const holder = element('div', 'tool-results');
      panel.append(holder);
      holder.append(element('p', 'tool-muted', 'Loading the versions...'));
      try {
        const list = await listing();
        holder.textContent = '';
        if (list.length === 0) {
          holder.append(element('p', 'tool-muted', 'No version of this file yet.'));
        }
        if (list.length > 0) {
          holder.append(table(list));
        }
        if (list.length === 1) {
          holder.append(element('p', 'tool-muted', 'This is the only version: the next save will keep it here.'));
        }
      } catch (error) {
        holder.textContent = '';
        holder.append(element('p', 'tool-message error', error.message || String(error)));
      }
      // after a restore the editor saves it a moment later: the list is read again then
      if (later && !busy) {
        busy = true;
        window.setTimeout(function () {
          busy = false;
          message = '';
          render();
        }, 7000);
      }
    }

    window.ToolSidebar.register({ id: 'history', icon: 'history', label: 'Version history', show: function (host) {
      panel = host;
      message = '';
      render();
    } });
  }

  window.HistoryTab = { setup: setup };
})();
