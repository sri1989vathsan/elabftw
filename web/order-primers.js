/**
 * On the orders page: a button on each Excel sheet attached to an order (the sheet of IDT, the form of Microsynth) that adds the
 * primers of the sheet to the database. The sheet is read on the server (primers.php?order_sheet=1); the primers are listed with
 * a tick each, the ones that are already in the database are recognised by their sequence, and the ticked ones are created in the
 * module of primers (the others are left as they are; nothing is linked to the order). Needs primer-tools.js (loaded here when it is not).
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
      // only the new primers are added; the ones that are in the database already are left as they are (nothing is linked to the order)
      send.textContent = fresh > 0 ? 'Add ' + fresh + ' new ' + (fresh === 1 ? 'primer' : 'primers') + ' to the database' : 'Nothing new to add';
      send.disabled = fresh === 0;
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
    dialog.append(element('p', 'text-muted', 'Primers marked "new" are not in the database yet: ticked ones are added to it. Primers that are in the database already are left as they are.'), wrap, tools.destinationControl(), message, actions);
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
        let created = 0;
        for (const row of rows) {
          if (!row.chosen || row.existing) {
            continue;
          }
          // the direction of an ordered primer is not known from the sheet: no orientation is written
          await tools.createPrimer(row.oligo.name.trim() || 'Primer ' + (row.index + 1), row.oligo.sequence, null, '');
          created++;
        }
        close();
        say(created + ' primer' + (created === 1 ? '' : 's') + ' added to the database.');
        // the cards of the orders are told: "3 of 4 in the database" becomes "In the database" and the button goes
        window.dispatchEvent(new CustomEvent('otd:added'));
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'sa-message error';
        send.disabled = false;
      }
    });
  }

  // the look of the files attached to an order: a soft card, the icon of the kind of file, the size as a small pill (the styles are
  // here, not in the orders page: the page is not changed)
  function ensureRowStyles() {
    if (document.getElementById('op-row-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'op-row-styles';
    style.textContent = [
      'li.orders-upload.op-row { align-items: center; background: rgba(127, 127, 127, 0.07); border: 1px solid rgba(127, 127, 127, 0.22); border-radius: 8px; column-gap: 0.15rem; padding: 0.3rem 0.4rem 0.3rem 0.6rem; }',
      // the "On LabCollector" pill and its button are not shown: the state "In the database" (order-to-database.js) is in their place. The
      // elements stay in the page (hidden), so nothing of the orders page is changed
      '.orders-card .orders-labcollector-toggle { display: none !important; }',
      // the entries and resources that the order is linked to are shown as tags with their names in the title row: not shown (the state "In the database"
      // and its link are in the header); the links are kept
      '.orders-card .orders-item-header a.badge { display: none !important; }',
      // the rows of the filters (All, Requested, ... Archived) when they wrap onto a second line: a space between the lines, so the buttons do not touch
      '.orders-toolbar-row .btn-group { row-gap: 0.4rem; }',
      'li.orders-upload.op-row:hover { background: rgba(127, 127, 127, 0.12); }',
      'li.orders-upload.op-row > a:first-of-type { font-weight: 600; text-decoration: none; }',
      'li.orders-upload.op-row > a:first-of-type:hover { text-decoration: underline; }',
      'li.orders-upload.op-row .op-icon { font-size: 1.15rem; margin-right: 0.5rem !important; }',
      'li.orders-upload.op-row .op-size { background: rgba(127, 127, 127, 0.16); border-radius: 999px; font-size: 0.72rem; margin-left: 0.5rem !important; padding: 0.05rem 0.5rem; white-space: nowrap; }',
      'li.orders-upload.op-row .op-add { align-items: center; border: 1px solid #1a9bb0; border-radius: 999px; color: #1a9bb0; display: inline-flex; font-size: 0.78rem; gap: 0.35rem; line-height: 1.2; margin-left: auto; padding: 0.2rem 0.7rem; white-space: nowrap; }',
      'li.orders-upload.op-row .op-add:hover:not(:disabled) { background: #1a9bb0; color: #fff; }',
    ].join('\n');
    document.head.append(style);
      // a card with "Add primers to database" has one button for the sheet: the one of the sheet is not shown twice (the card button clicks it)
      'li.orders-card:has(.otd-add-primers) .op-add { display: none !important; }',
  }

  // the icon of a file by its kind
  const KINDS = [
    [/\.(xlsx|xls|csv|tsv)$/i, 'fa-file-excel', '#1d8348'],
    [/\.pdf$/i, 'fa-file-pdf', '#c0392b'],
    [/\.(docx?|rtf|odt)$/i, 'fa-file-word', '#2b6cb0'],
    [/\.(png|jpe?g|gif|svg|tiff?)$/i, 'fa-file-image', '#8e44ad'],
    [/\.(zip|7z|gz|tar)$/i, 'fa-file-zipper', '#b9770e'],
  ];

  // The form of a new order: what links it to a resource of the old resources ("Link an existing resource...", the new resource title, the
  // template and the category, "Add a new resource instead") is not shown: the entries of the Database take their place ("Link an entry of
  // the database..."). The elements stay in the page, hidden, so nothing of the orders page is changed.
  function hideResourceLinking() {
    const firsts = Array.from(document.querySelectorAll('input[placeholder^="Link an existing resource"]'));
    const lasts = Array.from(document.querySelectorAll('input[placeholder^="Link an entry of the database"]'));
    firsts.forEach(function (first) {
      if (first.dataset.otdHidden) {
        return;
      }
      // the field of the entries of the Database that follows it (the form of a new order and the form that edits an order have both)
      const last = lasts.find(function (candidate) {
        return first.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING;
      });
      if (!last) {
        return;
      }
      // the lowest element that holds both fields; what is between them in it is hidden
      let common = first.parentElement;
      while (common && !common.contains(last)) {
        common = common.parentElement;
      }
      if (!common) {
        return;
      }
      const branch = function (node) {
        let child = node;
        while (child && child.parentElement !== common) {
          child = child.parentElement;
        }
        return child;
      };
      const from = branch(first);
      const until = branch(last);
      if (!from || !until || from === until) {
        return;
      }
      for (let node = from; node && node !== until; node = node.nextElementSibling) {
        node.style.setProperty('display', 'none', 'important');
        node.dataset.otdHidden = '1';
      }
      first.dataset.otdHidden = '1';
    });
  }

  // a button on each sheet (.xlsx) attached to an order
  function enhance() {
    ensureRowStyles();
    hideResourceLinking();
    document.querySelectorAll('li.orders-upload').forEach(function (item) {
      if (!item.classList.contains('op-row')) {
        item.classList.add('op-row');
        const name = (item.querySelector('a') || { textContent: '' }).textContent.trim();
        const icon = item.querySelector('i.fa-file');
        if (icon) {
          icon.classList.add('op-icon');
          const kind = KINDS.find(function (entry) {
            return entry[0].test(name);
          });
          if (kind) {
            icon.classList.replace('fa-file', kind[1]);
            icon.style.color = kind[2];
          }
        }
        const size = item.querySelector('span.orders-muted');
        if (size) {
          size.classList.add('op-size');
        }
      }
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
      const button = element('button', 'btn btn-sm op-add');
      button.type = 'button';
      button.title = 'Add the primers of this sheet to the database';
      button.setAttribute('aria-label', 'Add the primers of this sheet to the database');
      button.append(element('i', 'fas fa-database fa-fw'), document.createTextNode('Add to database'));
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
        // the button takes the free space of the row (to the right), the icon buttons follow it
        first.style.setProperty('margin-left', '0.4rem', 'important');
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
