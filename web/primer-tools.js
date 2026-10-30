/**
 * What is shared by the pages that deal with the primers of the database: finding where a primer binds on a sequence,
 * the melting temperature, and the calls to the database (primers of the module, new primer, attach, detach).
 * Exposed as window.PrimerTools.
 */
(function () {
  'use strict';
  const COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N', R: 'Y', Y: 'R', K: 'M', M: 'K', S: 'S', W: 'W', B: 'V', V: 'B', D: 'H', H: 'D' };
  // the 3' end of a primer decides where it binds: this many bases have to match exactly
  const ANCHOR = 12;
  const MAX_MISMATCHES = 3;
  const MIN_LENGTH = 12;

  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : (document.body.dataset.csrf || '');
  };
  // pages of the application are at the root, the sequence pages one level down
  const base = window.location.pathname.indexOf('/sequence-viewer/') !== -1 ? '../' : '';

  const clean = function (sequence) {
    return String(sequence || '').toUpperCase().replace(/[^A-Z]/g, '');
  };

  function reverseComplement(sequence) {
    return clean(sequence).split('').reverse().map(function (base2) {
      return COMPLEMENT[base2] || 'N';
    }).join('');
  }

  // melting temperature, a quick estimate: Wallace rule under 14 bases, else from the GC content
  function tm(sequence) {
    const s = clean(sequence);
    const gc = (s.match(/[GC]/g) || []).length;
    if (s.length === 0) {
      return null;
    }
    if (s.length < 14) {
      return 2 * (s.length - gc) + 4 * gc;
    }
    return Math.round((64.9 + (41 * (gc - 16.4)) / s.length) * 10) / 10;
  }

  function mismatches(a, b) {
    let count = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && a[i] !== 'N' && b[i] !== 'N') {
        count++;
      }
    }
    return count;
  }

  /**
   * Where a primer binds on a sequence: both strands, the 3' end exact, a few mismatches allowed in the rest.
   * Positions start at 0, the end is excluded. On a circular sequence a site can run over the origin.
   *
   * @returns {Array<{start: number, end: number, forward: boolean, mismatches: number, length: number}>}
   */
  function findSites(sequence, primerSequence, circular) {
    const seq = clean(sequence);
    const primer = clean(primerSequence);
    const length = primer.length;
    if (length < MIN_LENGTH || seq.length < length) {
      return [];
    }
    const anchor = Math.min(ANCHOR, length);
    // a circular sequence is read twice over so that a site can run over the origin
    const text = circular ? seq + seq.slice(0, length - 1) : seq;
    const sites = [];
    const seen = new Set();
    const scan = function (target, forward) {
      // forward: the 3' end of the primer is the end of the target; reverse: it is the start of the reverse complement
      const anchorText = forward ? target.slice(length - anchor) : target.slice(0, anchor);
      let from = 0;
      for (;;) {
        const found = text.indexOf(anchorText, from);
        if (found === -1) {
          break;
        }
        from = found + 1;
        const start = forward ? found - (length - anchor) : found;
        if (start < 0 || start + length > text.length || start >= seq.length) {
          continue;
        }
        const count = mismatches(target, text.slice(start, start + length));
        const key = start + ':' + forward;
        if (count <= MAX_MISMATCHES && !seen.has(key)) {
          seen.add(key);
          sites.push({ start: start, end: start + length, forward: forward, mismatches: count, length: length });
        }
      }
    };
    scan(primer, true);
    scan(reverseComplement(primer), false);
    return sites.sort(function (a, b) {
      return a.start - b.start;
    });
  }

  async function json(path, options) {
    const response = await fetch(base + path, Object.assign({ credentials: 'same-origin' }, options || {}));
    if (!response.ok) {
      let message = 'The request failed (' + response.status + ').';
      try {
        message = (await response.json()).error || message;
      } catch (error) {
        // the message stays generic
      }
      throw new Error(message);
    }
    return response.json();
  }

  const jsonHeaders = function () {
    return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() };
  };

  // the sequence of a primer entry: the field of the module that starts with "Sequence"
  function primerSequenceOf(entry) {
    const field = (entry.extra_fields || []).find(function (f) {
      return /^sequence/i.test(f.name);
    });
    return field ? clean(field.value) : clean(entry.sequence || '');
  }

  let primersCategory = null;
  async function primersCategoryId() {
    if (primersCategory === null) {
      const categories = await json('api/v2/teams/current/registry_categories');
      const found = categories.find(function (c) {
        return /^primers?$/i.test(c.title);
      });
      primersCategory = found ? found.id : 0;
    }
    return primersCategory;
  }

  // every primer of the database that has a sequence
  async function allPrimers() {
    const category = await primersCategoryId();
    if (!category) {
      return [];
    }
    const entries = await json('api/v2/inventory?limit=1000&category=' + category);
    return entries.map(function (entry) {
      return { id: entry.id, title: entry.title, sequence: primerSequenceOf(entry), category: entry.category_title, color: entry.category_color };
    }).filter(function (primer) {
      return primer.sequence.length >= MIN_LENGTH;
    });
  }

  // a new primer in the database, with its sequence, orientation and melting temperature
  async function createPrimer(title, sequence, forward, target) {
    const category = await primersCategoryId();
    if (!category) {
      throw new Error('There is no module of primers in the database.');
    }
    const response = await fetch(base + 'api/v2/inventory', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token() },
      body: JSON.stringify({ category: category, title: title }),
    });
    if (!response.ok) {
      throw new Error('The primer could not be created (' + response.status + ').');
    }
    const id = Number((response.headers.get('Location') || '').split('/').pop());
    // the fields of the module are filled in
    const entry = await json('api/v2/inventory/' + id);
    const metadata = JSON.parse(entry.metadata || '{"extra_fields":{}}');
    metadata.extra_fields = metadata.extra_fields || {};
    const set = function (pattern, value, type) {
      const name = Object.keys(metadata.extra_fields).find(function (n) {
        return pattern.test(n);
      });
      if (name) {
        metadata.extra_fields[name].value = value;
      } else if (type) {
        metadata.extra_fields[pattern.source.replace(/[^A-Za-z ]/g, '')] = { type: type, value: value, position: Object.keys(metadata.extra_fields).length + 1 };
      }
    };
    set(/^sequence/i, clean(sequence));
    set(/^tm/i, tm(sequence));
    set(/^orientation/i, forward ? 'Forward' : 'Reverse');
    if (target) {
      set(/^target/i, target);
    }
    await json('api/v2/inventory/' + id, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ metadata: JSON.stringify(metadata) }) });
    return id;
  }

  const attach = function (plasmid, primer) {
    return json('primers.php', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ action: 'attach', plasmid: plasmid, primer: primer }) });
  };
  const detach = function (plasmid, primer) {
    return json('primers.php', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ action: 'detach', plasmid: plasmid, primer: primer }) });
  };
  const attached = function (entryId) {
    return json('primers.php?entry=' + entryId);
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

  // the styles of the dialogs are in sequence-add.css
  function ensureStyles() {
    if (!document.querySelector('link[href^="' + base + 'sequence-add.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = base + 'sequence-add.css';
      document.head.append(link);
    }
  }

  /**
   * A dialog to send primers to an order of the team: a new order or one that is open. The sequences of the primers are
   * written in the notes of the order, to be sent to the maker.
   */
  async function sendToOrder(primerIds, onDone) {
    ensureStyles();
    const backdrop = element('div', 'sa-backdrop');
    const dialog = element('div', 'sa-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.append(element('h4', '', 'Send ' + primerIds.length + (primerIds.length === 1 ? ' primer' : ' primers') + ' to an order'));
    const message = element('p', 'sa-message');
    const choices = element('div', 'sa-choices');
    const newRadio = element('input');
    newRadio.type = 'radio';
    newRadio.name = 'po-order';
    newRadio.checked = true;
    const newLabel = element('label', 'sa-radio');
    newLabel.append(newRadio, document.createTextNode(' A new order'));
    const title = element('input', 'sa-input');
    title.type = 'text';
    title.value = 'Primers ' + new Date().toISOString().slice(0, 10);
    const existingRadio = element('input');
    existingRadio.type = 'radio';
    existingRadio.name = 'po-order';
    const existingLabel = element('label', 'sa-radio');
    existingLabel.append(existingRadio, document.createTextNode(' An open order'));
    const select = element('select', 'sa-input');
    select.disabled = true;
    choices.append(newLabel, title, existingLabel, select);
    const actions = element('div', 'sa-actions');
    const cancel = element('button', 'btn btn-secondary', 'Cancel');
    cancel.type = 'button';
    const send = element('button', 'btn btn-primary', 'Send');
    send.type = 'button';
    actions.append(cancel, send);
    dialog.append(choices, message, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    const close = function () {
      backdrop.remove();
    };
    cancel.addEventListener('click', close);
    backdrop.addEventListener('mousedown', function (event) {
      if (event.target === backdrop) {
        close();
      }
    });
    const refresh = function () {
      title.disabled = !newRadio.checked;
      select.disabled = !existingRadio.checked;
    };
    newRadio.addEventListener('change', refresh);
    existingRadio.addEventListener('change', refresh);
    try {
      const open = (await json('primers.php?orders=1')).orders;
      open.forEach(function (order) {
        const option = element('option', '', '#' + order.id + ' ' + order.title + ' (' + order.status + ')');
        option.value = String(order.id);
        select.append(option);
      });
      if (open.length === 0) {
        existingRadio.disabled = true;
        existingLabel.append(document.createTextNode(' (none is open)'));
      }
    } catch (error) {
      message.textContent = error.message;
      message.className = 'sa-message error';
    }
    send.addEventListener('click', async function () {
      send.disabled = true;
      message.textContent = '';
      message.className = 'sa-message';
      try {
        let orderId;
        if (newRadio.checked) {
          const response = await fetch(base + 'api/v2/orders', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token() },
            body: JSON.stringify({ title: title.value.trim() || 'Primers' }),
          });
          if (!response.ok) {
            throw new Error('The order could not be created (' + response.status + ').');
          }
          orderId = Number((response.headers.get('Location') || '').split('/').pop());
        } else {
          orderId = Number(select.value);
        }
        const result = await json('primers.php', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ action: 'order', primers: primerIds, order: orderId }) });
        message.textContent = 'Sent to the order "' + result.order.title + '"' + (result.notesAdded ? ', with the sequences in its notes.' : '.');
        message.className = 'sa-message';
        cancel.textContent = 'Close';
        if (onDone) {
          onDone(result);
        }
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'sa-message error';
        send.disabled = false;
      }
    });
  }

  window.PrimerTools = {
    sendToOrder: sendToOrder,
    clean: clean,
    reverseComplement: reverseComplement,
    tm: tm,
    findSites: findSites,
    allPrimers: allPrimers,
    createPrimer: createPrimer,
    attach: attach,
    detach: detach,
    attached: attached,
    minLength: MIN_LENGTH,
  };
})();
