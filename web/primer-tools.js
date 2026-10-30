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

  // nearest-neighbour parameters (SantaLucia 1998): enthalpy in kcal/mol, entropy in cal/(K mol)
  const NN = {
    AA: [-7.9, -22.2], TT: [-7.9, -22.2], AT: [-7.2, -20.4], TA: [-7.2, -21.3], CA: [-8.5, -22.7], TG: [-8.5, -22.7],
    GT: [-8.4, -22.4], AC: [-8.4, -22.4], CT: [-7.8, -21.0], AG: [-7.8, -21.0], GA: [-8.2, -22.2], TC: [-8.2, -22.2],
    CG: [-10.6, -27.2], GC: [-9.8, -24.4], GG: [-8.0, -19.9], CC: [-8.0, -19.9],
  };

  // melting temperature in degrees C: nearest neighbour for 14 bases or more (50 mM Na+, 0.25 uM primer), Wallace rule below
  function tm(sequence) {
    const s = clean(sequence);
    if (s.length === 0) {
      return null;
    }
    const gc = (s.match(/[GC]/g) || []).length;
    if (s.length < 14 || /[^ACGT]/.test(s)) {
      return s.length < 14 ? 2 * (s.length - gc) + 4 * gc : Math.round((64.9 + (41 * (gc - 16.4)) / s.length) * 10) / 10;
    }
    let dh = 0;
    let ds = 0;
    for (let i = 0; i < s.length - 1; i++) {
      const pair = NN[s.slice(i, i + 2)];
      dh += pair[0];
      ds += pair[1];
    }
    // the two ends: a G or C at the end and an A or T at the end are not the same
    [s[0], s[s.length - 1]].forEach(function (end) {
      if (end === 'G' || end === 'C') {
        dh += 0.1;
        ds += -2.8;
      } else {
        dh += 2.3;
        ds += 4.1;
      }
    });
    ds += 0.368 * (s.length - 1) * Math.log(0.05);
    const gas = 1.987;
    return Math.round((((dh * 1000) / (ds + gas * Math.log(0.25e-6 / 4))) - 273.15) * 10) / 10;
  }

  // the share of G and C, in percent
  function gcPercent(sequence) {
    const s = clean(sequence);
    return s.length === 0 ? 0 : Math.round(((s.match(/[GC]/g) || []).length / s.length) * 1000) / 10;
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

  // the modules whose entries are sequences that bind: the primers and the probes
  const BINDING_MODULE = /^(primers?|probes?)$/i;
  let bindingCategories = null;
  async function categoriesOf(pattern) {
    if (bindingCategories === null) {
      bindingCategories = await json('api/v2/teams/current/registry_categories');
    }
    return bindingCategories.filter(function (c) {
      return pattern.test(c.title);
    });
  }
  async function primersCategoryId() {
    const found = (await categoriesOf(/^primers?$/i))[0];
    return found ? found.id : 0;
  }

  // every primer and probe of the database that has a sequence
  async function allPrimers() {
    const categories = await categoriesOf(BINDING_MODULE);
    const lists = await Promise.all(categories.map(function (category) {
      return json('api/v2/inventory?limit=1000&category=' + category.id);
    }));
    return lists.flat().map(function (entry) {
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
   * sent to the maker in the order sheet that can be attached to the order.
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
    title.value = 'Oligos';
    const existingRadio = element('input');
    existingRadio.type = 'radio';
    existingRadio.name = 'po-order';
    const existingLabel = element('label', 'sa-radio');
    existingLabel.append(existingRadio, document.createTextNode(' An open order'));
    const select = element('select', 'sa-input');
    select.disabled = true;
    choices.append(newLabel, title, existingLabel, select);
    // the order sheet of a supplier, filled with the names and sequences, is attached to the order
    const SHEETS = {
      idt: { label: 'IDT (to paste in the bulk input)', scales: ['25nm', '100nm', '250nm', '1um', '2um', '5um', '10um'], purifications: ['STD', 'PAGE', 'HPLC', 'IEHPLC', 'PAGEHPLC'] },
      microsynth: { label: 'Microsynth (their upload form)', scales: ['0.04', '0.2', '1.0', '15'], purifications: ['DES', 'HPL', 'HPD', 'IEX', 'PAG'] },
    };
    const sheetBox = element('div', 'sa-sheet');
    sheetBox.append(element('div', 'sa-sheet-title', 'Order sheet (Excel), attached to the order'));
    const vendor = element('select', 'sa-input');
    [['', 'No sheet'], ['idt', SHEETS.idt.label], ['microsynth', SHEETS.microsynth.label]].forEach(function (choice) {
      const option = element('option', '', choice[1]);
      option.value = choice[0];
      vendor.append(option);
    });
    const scale = element('select', 'sa-input sa-small');
    scale.setAttribute('aria-label', 'Scale');
    const purification = element('select', 'sa-input sa-small');
    purification.setAttribute('aria-label', 'Purification');
    const fillOptions = function () {
      const choice = SHEETS[vendor.value];
      [[scale, choice ? choice.scales : []], [purification, choice ? choice.purifications : []]].forEach(function (pair) {
        pair[0].textContent = '';
        pair[1].forEach(function (value) {
          const option = element('option', '', value);
          option.value = value;
          pair[0].append(option);
        });
        pair[0].hidden = !choice;
      });
    };
    vendor.addEventListener('change', fillOptions);
    fillOptions();
    try {
      // IDT unless another choice was made before ('none' is remembered too)
      const remembered = window.localStorage.getItem('order-sheet-vendor');
      vendor.value = remembered === null ? 'idt' : (remembered === 'none' ? '' : remembered);
      fillOptions();
    } catch (error) {
      vendor.value = 'idt';
      fillOptions();
    }
    sheetBox.append(vendor, scale, purification);
    choices.append(sheetBox);
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
            body: JSON.stringify({ title: title.value.trim() || 'Oligos' }),
          });
          if (!response.ok) {
            throw new Error('The order could not be created (' + response.status + ').');
          }
          orderId = Number((response.headers.get('Location') || '').split('/').pop());
        } else {
          orderId = Number(select.value);
        }
        const result = await json('primers.php', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ action: 'order', primers: primerIds, order: orderId }) });
        let done = 'Sent to the order "' + result.order.title + '".';
        try {
          window.localStorage.setItem('order-sheet-vendor', vendor.value || 'none');
        } catch (error) {
          // not remembered
        }
        if (vendor.value) {
          // the sheet is made on the server and attached to the order, like a quote: nothing is downloaded
          const sheetResponse = await fetch(base + 'primers.php?' + new URLSearchParams({ sheet: vendor.value, ids: primerIds.join(','), scale: scale.value, purification: purification.value }).toString(), { credentials: 'same-origin' });
          if (!sheetResponse.ok) {
            throw new Error('The order sheet could not be made (' + sheetResponse.status + ').');
          }
          const form = new FormData();
          form.append('file', new File([await sheetResponse.blob()], 'oligo-order-' + vendor.value + '-' + new Date().toISOString().slice(0, 10) + '.xlsx'));
          const attached = await fetch(base + 'api/v2/orders/' + result.order.id + '/uploads', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': token() },
            body: form,
          });
          if (!attached.ok) {
            throw new Error('The order sheet could not be attached to the order (' + attached.status + ').');
          }
          done += ' The ' + SHEETS[vendor.value].label.split(' ')[0] + ' order sheet is attached to it.';
        }
        // the dialog closes; a short note tells what was done
        close();
        const toast = element('div', 'sa-toast', done);
        toast.setAttribute('role', 'status');
        document.body.append(toast);
        window.setTimeout(function () {
          toast.remove();
        }, 5000);
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
    gc: gcPercent,
    findSites: findSites,
    allPrimers: allPrimers,
    createPrimer: createPrimer,
    attach: attach,
    detach: detach,
    attached: attached,
    minLength: MIN_LENGTH,
  };
})();
