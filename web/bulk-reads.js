/**
 * "Attach sequencing files": many sequencing reads (.ab1 and the like) are dropped at once, each is matched to a plasmid by its file name
 * (the name of the plasmid is part of the name of the file), the matches are checked in a table, and the ticked files are attached to
 * their plasmids. window.BulkReads.open()
 */
(function () {
  'use strict';

  const READ_FILES = /\.(ab1|abi|scf|seq|fasta|fa)$/i;
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  };
  const element = function (tag, className, text, style) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    if (style) {
      node.setAttribute('style', style);
    }
    return node;
  };
  const json = async function (url) {
    const response = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!response.ok) {
      throw new Error('Could not load ' + url + ' (' + response.status + ').');
    }
    return response.json();
  };
  // letters and digits only, lower case: "pLKO.1 - Cas9_2" and "plko1-cas9-2" are the same name
  const squash = function (text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  };
  // the file name without its extension and without the primer or the well that follows it ("..._M13F", "-T7", "_A01")
  const nameOfFile = function (fileName) {
    return fileName.replace(/\.[^.]+$/, '');
  };

  // the plasmids: the modules that need a sequence file
  async function loadPlasmids() {
    const categories = await json('api/v2/teams/current/registry_categories');
    const wanted = categories.filter(function (c) {
      let settings = c.settings;
      if (typeof settings === 'string') {
        try {
          settings = JSON.parse(settings);
        } catch (error) {
          settings = null;
        }
      }
      return /plasmid/i.test(c.title) || Boolean(settings && settings.requires_sequence_file);
    });
    const all = [];
    for (const category of wanted) {
      for (let offset = 0; ; offset += 500) {
        const page = await json('api/v2/inventory?limit=500&offset=' + offset + '&category=' + category.id);
        page.forEach(function (e) {
          if (e.custom_id !== null && e.custom_id !== undefined) {
            all.push({ id: e.id, title: e.title, number: e.custom_id, key: squash(e.title) });
          }
        });
        if (page.length < 500) {
          break;
        }
      }
    }
    return all;
  }

  // the plasmid whose name is in the name of the file; the longest name wins ("pX" must not take "pX-Cas9")
  const match = function (plasmids, fileName) {
    const base = squash(nameOfFile(fileName));
    let best = null;
    plasmids.forEach(function (p) {
      if (p.key.length >= 3 && base.indexOf(p.key) !== -1 && (best === null || p.key.length > best.key.length)) {
        best = p;
      }
    });
    return best;
  };

  function open() {
    const back = element('div', 'planned-backdrop');
    const box = element('div', 'planned-dialog');
    box.setAttribute('role', 'dialog');
    box.style.maxWidth = '60rem';
    const close = function () {
      back.remove();
    };
    box.append(element('h5', '', 'Attach sequencing files'));
    box.append(element('p', 'small text-muted', 'Drop many reads (.ab1 and similar) here. Each is matched to the plasmid whose name is part of the name of the file, for example "pLKO-Cas9_M13F.ab1" goes to "pLKO-Cas9". Check the table, then attach the ticked ones.'));
    const chooser = element('input', 'form-control-file mb-2');
    chooser.type = 'file';
    chooser.multiple = true;
    chooser.accept = '.ab1,.abi,.scf,.seq,.fasta,.fa';
    chooser.setAttribute('aria-label', 'Sequencing files');
    const drop = element('div', 'border rounded p-3 mb-2 text-center text-muted', 'Drop the files here, or choose them below', 'border-style:dashed !important');
    const message = element('p', 'small mb-2');
    const tableBox = element('div', '', '', 'max-height:50vh;overflow:auto');
    const buttons = element('div', 'd-flex flex-wrap justify-content-end mt-2', '', 'gap:.5rem');
    box.append(drop, chooser, message, tableBox, buttons);
    back.append(box);
    document.body.append(back);
    back.addEventListener('mousedown', function (event) {
      if (event.target === back) {
        close();
      }
    });

    let plasmids = [];
    // each row: {file, plasmid (or null), ticked, state}
    let rows = [];
    const titles = element('datalist');
    titles.id = 'bulk-reads-titles';
    box.append(titles);
    const byLabel = new Map();
    const labelOf = function (p) {
      return p.title + ' (#' + p.number + ')';
    };

    const draw = function () {
      tableBox.replaceChildren();
      buttons.replaceChildren();
      const cancel = element('button', 'btn btn-secondary btn-sm', 'Close');
      cancel.type = 'button';
      cancel.addEventListener('click', close);
      buttons.append(cancel);
      if (rows.length === 0) {
        return;
      }
      const table = element('table', 'table table-sm');
      const head = element('tr');
      ['', 'File', 'Plasmid', ''].forEach(function (h) {
        head.append(element('th', '', h));
      });
      const thead = element('thead');
      thead.append(head);
      table.append(thead);
      const body = element('tbody');
      rows.forEach(function (row) {
        const tr = element('tr');
        const tickCell = element('td');
        const tick = element('input');
        tick.type = 'checkbox';
        tick.checked = row.ticked && row.plasmid !== null && row.state !== 'done';
        tick.disabled = row.plasmid === null || row.state === 'done';
        tick.setAttribute('aria-label', 'Attach ' + row.file.name);
        tick.addEventListener('change', function () {
          row.ticked = tick.checked;
          count();
        });
        tickCell.append(tick);
        const where = element('td');
        const input = element('input', 'form-control form-control-sm');
        input.setAttribute('list', 'bulk-reads-titles');
        input.placeholder = 'type the name of a plasmid';
        input.setAttribute('aria-label', 'Plasmid for ' + row.file.name);
        input.value = row.plasmid ? labelOf(row.plasmid) : '';
        input.disabled = row.state === 'done';
        input.addEventListener('change', function () {
          const chosen = byLabel.get(input.value);
          row.plasmid = chosen || null;
          row.ticked = Boolean(chosen);
          draw();
        });
        where.append(input);
        const status = element('td', 'small ' + (row.state === 'failed' ? 'text-danger' : 'text-success'), row.state === 'done' ? 'Attached' : (row.state === 'failed' ? row.error : (row.plasmid === null ? 'No match' : '')));
        tr.append(tickCell, element('td', '', row.file.name), where, status);
        body.append(tr);
      });
      table.append(body);
      tableBox.append(table);
      const attach = element('button', 'btn btn-primary btn-sm');
      attach.type = 'button';
      const count = function () {
        const n = rows.filter(function (r) {
          return r.ticked && r.plasmid !== null && r.state !== 'done';
        }).length;
        attach.textContent = 'Attach ' + n + (n === 1 ? ' file' : ' files');
        attach.disabled = n === 0;
      };
      attach.addEventListener('click', async function () {
        attach.disabled = true;
        let done = 0;
        for (const row of rows) {
          if (!row.ticked || row.plasmid === null || row.state === 'done') {
            continue;
          }
          const form = new FormData();
          // a fasta read is named *.read.fasta: the entry then lists it as a sequencing read and not as the sequence of the plasmid
          form.append('file', /\.(fasta|fa)$/i.test(row.file.name) && !/\.read\.(fasta|fa)$/i.test(row.file.name) ? new File([row.file], row.file.name.replace(/\.(fasta|fa)$/i, '.read.$1'), { type: row.file.type }) : row.file);
          try {
            const response = await fetch('api/v2/inventory/' + row.plasmid.id + '/uploads', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'X-CSRF-Token': token(), 'X-Requested-With': 'XMLHttpRequest' },
              body: form,
            });
            if (!response.ok) {
              throw new Error('not attached (' + response.status + ')');
            }
            row.state = 'done';
            done++;
          } catch (error) {
            row.state = 'failed';
            row.error = error.message;
          }
        }
        message.className = 'small mb-2 text-success';
        message.textContent = done + (done === 1 ? ' file' : ' files') + ' attached.';
        draw();
      });
      buttons.append(attach);
      count();
      const unmatched = rows.filter(function (r) {
        return r.plasmid === null;
      }).length;
      message.className = 'small mb-2';
      message.textContent = rows.length + ' files read, ' + (rows.length - unmatched) + ' matched to a plasmid' + (unmatched > 0 ? ', ' + unmatched + ' without a match (type the name of the plasmid to give it one)' : '') + '.';
    };

    const take = function (files) {
      const list = Array.from(files).filter(function (f) {
        return READ_FILES.test(f.name);
      });
      rows = rows.concat(list.map(function (file) {
        const plasmid = match(plasmids, file.name);
        return { file: file, plasmid: plasmid, ticked: plasmid !== null, state: '', error: '' };
      }));
      draw();
    };
    chooser.addEventListener('change', function () {
      take(chooser.files || []);
      chooser.value = '';
    });
    ['dragover', 'dragenter'].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
      });
    });
    drop.addEventListener('drop', function (event) {
      event.preventDefault();
      take(event.dataTransfer ? event.dataTransfer.files : []);
    });
    message.textContent = 'Loading the plasmids...';
    chooser.disabled = true;
    loadPlasmids().then(function (loaded) {
      plasmids = loaded;
      plasmids.forEach(function (p) {
        const label = labelOf(p);
        byLabel.set(label, p);
        const option = element('option');
        option.value = label;
        titles.append(option);
      });
      chooser.disabled = false;
      message.textContent = plasmids.length + ' plasmids loaded.';
    }).catch(function (error) {
      message.className = 'small mb-2 text-danger';
      message.textContent = error.message;
    });
    draw();
  }

  window.BulkReads = { open: open, match: match, squash: squash };
})();
