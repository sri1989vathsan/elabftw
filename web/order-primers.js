/**
 * On the orders page: a button on each Excel sheet attached to an order (the sheet of IDT, the form of Microsynth) that adds the
 * primers of the sheet to the database. The sheet is read on the server (primers.php?order_sheet=1); the primers are listed with
 * a tick each, the ones that are already in the database are recognised by their sequence, and the ticked ones are created in the
 * module of primers (the others are only linked) and linked to the order. Needs primer-tools.js (loaded here when it is not).
 */
(function () {
  'use strict';
  const own = document.currentScript;
  const stamp = own && own.src.indexOf('?v=') !== -1 ? own.src.split('?v=')[1] : '1';

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

  let loading = null;
  function loadTools() {
    if (window.PrimerTools) {
      return Promise.resolve();
    }
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = 'primer-tools.js?v=' + stamp;
        script.onload = resolve;
        script.onerror = function () {
          loading = null;
          reject(new Error('The primer tools could not be loaded.'));
        };
        document.head.append(script);
      });
      if (!document.querySelector('link[href^="sequence-add.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'sequence-add.css?v=' + stamp;
        document.head.append(link);
      }
    }
    return loading;
  }

  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  };

  function say(text, error) {
    const toast = element('div', 'sa-toast', text);
    toast.setAttribute('role', 'status');
    if (error) {
      toast.style.background = '#8a1f2d';
    }
    document.body.append(toast);
    window.setTimeout(function () {
      toast.remove();
    }, error ? 7000 : 5000);
  }

  async function openSheet(orderId, fileName, longName) {
    await loadTools();
    const tools = window.PrimerTools;
    const response = await fetch('primers.php?order_sheet=1&order=' + orderId + '&f=' + encodeURIComponent(longName), { credentials: 'same-origin' });
    const answer = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      throw new Error(answer.error || 'The sheet could not be read (' + response.status + ').');
    }
    const oligos = answer.oligos || [];
    if (oligos.length === 0) {
      throw new Error('No sequence was found in ' + fileName + '.');
    }
    const database = await tools.allPrimers();
    const known = function (sequence) {
      const forward = tools.clean(sequence);
      const reverse = tools.reverseComplement(forward);
      return database.find(function (primer) {
        return primer.sequence === forward || primer.sequence === reverse;
      });
    };

    const backdrop = element('div', 'sa-backdrop');
    const dialog = element('div', 'sa-dialog op-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.append(element('h4', '', 'Primers of ' + fileName));
    const rows = oligos.map(function (oligo, index) {
      return { oligo: oligo, existing: known(oligo.sequence), chosen: true, index: index };
    });
    const table = element('table', 'table table-sm op-table');
    const head = element('tr');
    ['', 'Name', 'Sequence 5\'-3\'', 'Bases', 'Tm', 'In the database'].forEach(function (label) {
      head.append(element('th', '', label));
    });
    const thead = element('thead');
    thead.append(head);
    const body = element('tbody');
    const message = element('p', 'sa-message');
    const send = element('button', 'btn btn-primary', '');
    send.type = 'button';
    const refresh = function () {
      const fresh = rows.filter(function (row) {
        return row.chosen && !row.existing;
      }).length;
      const linked = rows.filter(function (row) {
        return row.chosen && row.existing;
      }).length;
      send.textContent = (fresh > 0 ? 'Add ' + fresh + ' to the database' : 'Link') + (linked > 0 && fresh > 0 ? ', link ' + linked : '') + (fresh === 0 && linked > 0 ? ' ' + linked : '') + ' to the order';
      send.disabled = fresh + linked === 0;
    };
    rows.forEach(function (row) {
      const tr = element('tr');
      const tick = element('td');
      const box = element('input');
      box.type = 'checkbox';
      box.checked = true;
      box.setAttribute('aria-label', 'Select ' + row.oligo.name);
      box.addEventListener('change', function () {
        row.chosen = box.checked;
        refresh();
      });
      tick.append(box);
      row.box = box;
      const name = element('input', 'op-name');
      name.type = 'text';
      name.value = row.oligo.name || 'Primer ' + (row.index + 1);
      name.disabled = !!row.existing;
      name.setAttribute('aria-label', 'Name of the primer');
      name.addEventListener('input', function () {
        row.oligo.name = name.value;
      });
      const nameCell = element('td');
      nameCell.append(name);
      const sequence = element('td', 'op-sequence', row.oligo.sequence);
      sequence.title = row.oligo.sequence;
      const state = element('td', 'op-state');
      if (row.existing) {
        const link = element('a', '', row.existing.title);
        link.href = 'registry.php?mode=view&id=' + row.existing.id;
        link.target = '_blank';
        link.rel = 'noopener';
        state.append(link);
      } else {
        state.append(element('span', 'text-muted', 'new'));
      }
      tr.append(tick, nameCell, sequence, element('td', '', String(row.oligo.sequence.length)), element('td', '', tools.tm(row.oligo.sequence) === null ? '' : tools.tm(row.oligo.sequence) + '°C'), state);
      body.append(tr);
    });
    table.append(thead, body);
    const wrap = element('div', 'op-wrap');
    wrap.append(table);
    const actions = element('div', 'sa-actions');
    const cancel = element('button', 'btn btn-secondary', 'Cancel');
    cancel.type = 'button';
    actions.append(cancel, send);
    dialog.append(element('p', 'text-muted', 'The new ones are added to the primers of the database and everything ticked is linked to this order.'), wrap, message, actions);
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
    refresh();
    send.addEventListener('click', async function () {
      send.disabled = true;
      message.textContent = '';
      message.className = 'sa-message';
      try {
        const ids = [];
        let created = 0;
        for (const row of rows) {
          if (!row.chosen) {
            continue;
          }
          if (row.existing) {
            ids.push(row.existing.id);
          } else {
            // the direction of an ordered primer is not known from the sheet: no orientation is written
            ids.push(await tools.createPrimer(row.oligo.name.trim() || 'Primer ' + (row.index + 1), row.oligo.sequence, null, ''));
            created++;
          }
        }
        const linked = await fetch('primers.php', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
          body: JSON.stringify({ action: 'order', primers: ids, order: orderId }),
        });
        if (!linked.ok) {
          throw new Error('The primers could not be linked to the order (' + linked.status + ').');
        }
        close();
        say(created + ' primer' + (created === 1 ? '' : 's') + ' added to the database; ' + ids.length + ' linked to the order.');
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'sa-message error';
        send.disabled = false;
      }
    });
  }

  // a button on each sheet (.xlsx) attached to an order
  function enhance() {
    document.querySelectorAll('li.orders-upload').forEach(function (item) {
      if (item.querySelector('.op-add')) {
        return;
      }
      const link = item.querySelector('a[href*="download.php"]');
      if (!link) {
        return;
      }
      const url = new URL(link.href, window.location.href);
      const fileName = url.searchParams.get('name') || '';
      const longName = url.searchParams.get('f') || '';
      if (!/\.xlsx$/i.test(fileName)) {
        return;
      }
      const card = item.closest('li.orders-card, li.orders-item');
      const found = card ? /#(\d+)/.exec(card.textContent || '') : null;
      if (!found) {
        return;
      }
      const orderId = Number(found[1]);
      const button = element('button', 'btn btn-ghost btn-sm orders-icon-button op-add');
      button.type = 'button';
      button.title = 'Add the primers of this sheet to the database';
      button.setAttribute('aria-label', 'Add the primers of this sheet to the database');
      button.append(element('i', 'fas fa-plus fa-fw'));
      button.addEventListener('click', function () {
        button.disabled = true;
        openSheet(orderId, fileName, longName).catch(function (error) {
          say(error.message || String(error), true);
        }).finally(function () {
          button.disabled = false;
        });
      });
      const first = item.querySelector('.orders-icon-button');
      if (first) {
        first.before(button);
      } else {
        item.append(button);
      }
    });
  }

  let pending = 0;
  const schedule = function () {
    window.clearTimeout(pending);
    pending = window.setTimeout(enhance, 120);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  enhance();
})();
