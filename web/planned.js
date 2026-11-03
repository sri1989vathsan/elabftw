/**
 * Planned entries of the database (see planned.php): things that are not made or ordered yet. On the list page of the Database a
 * "My planned" tab shows the planned entries of the user and a form to plan a new one; on the page of a planned entry a bar says
 * it is planned (no number yet, private) and "Mark as ready" gives it the next number of its module. Needs nothing else.
 */
(function () {
  'use strict';
  if (!document.querySelector('link[href^="planned.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'planned.css';
    document.head.append(link);
  }
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : (document.body.dataset.csrf || '');
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

  async function call(options) {
    const response = await fetch('planned.php', Object.assign({ credentials: 'same-origin' }, options || {}));
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'The request failed.');
    }
    return body;
  }
  const post = function (payload) {
    return call({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify(payload) });
  };

  // ---- the list page: a tab "My planned" with the planned entries and a form to plan one
  // the switch between All entries (the registered Database) and My entries (everything of the user, the ones without a number
  // included): it sets or removes planned=1 in the address and keeps the module and the folder
  function viewSwitch(nav) {
    const params = new URLSearchParams(location.search);
    const mine = params.get('planned') === '1';
    const box = element('div', 'btn-group btn-group-sm view-switch mt-2');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Which entries');
    const go = function (wantMine) {
      const next = new URLSearchParams(location.search);
      if (wantMine) {
        next.set('planned', '1');
      } else {
        next.delete('planned');
      }
      location.search = next.toString();
    };
    [['All entries', false, 'The Database: the registered entries of everyone'], ['My entries', true, 'Everything of yours, with the entries that have no number yet (planned and intermediates)']].forEach(function (item) {
      const b = element('button', 'btn btn-outline-primary' + (mine === item[1] ? ' active' : ''), item[0]);
      b.type = 'button';
      b.title = item[2];
      b.setAttribute('aria-pressed', mine === item[1] ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (mine !== item[1]) {
          go(item[1]);
        }
      });
      box.append(b);
    });
    nav.insertAdjacentElement('beforebegin', box);
    // in My entries: the toggle In database filters the entries by whether they are in the lab Database
    if (mine) {
      const toggle = element('div', 'btn-group btn-group-sm ml-2 mt-2 id-filter');
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', 'In database');
      const current = params.get('idstate') || '';
      [['', 'All', 'All of my entries'], ['lab', 'In database', 'Only the entries that are in the lab Database'], ['notlab', 'Not in database', 'Only the entries that are not in the lab Database: planned, intermediates and the ones in my database only']].forEach(function (item) {
        const b2 = element('button', 'btn btn-outline-secondary' + (current === item[0] ? ' active' : ''), item[1]);
        b2.type = 'button';
        b2.title = item[2];
        b2.setAttribute('aria-pressed', current === item[0] ? 'true' : 'false');
        b2.addEventListener('click', function () {
          const next = new URLSearchParams(location.search);
          if (item[0]) {
            next.set('idstate', item[0]);
          } else {
            next.delete('idstate');
          }
          location.search = next.toString();
        });
        toggle.append(b2);
      });
      box.insertAdjacentElement('afterend', toggle);
    }
    // the entry pages remember which of the two the list was in
    try {
      sessionStorage.setItem('registryMine', mine ? '1' : '0');
    } catch (error) {
      // no storage: the entry goes back to its module
    }
    // the links of the modules and of the folders keep the choice
    if (mine) {
      const keep = function (link) {
        const url = new URL(link.getAttribute('href'), location.href);
        if (/registry\.php$/.test(url.pathname) && !url.searchParams.has('planned') && !url.searchParams.has('id')) {
          url.searchParams.set('planned', '1');
          link.setAttribute('href', url.pathname.replace(/^\//, '') + url.search);
        }
      };
      nav.querySelectorAll('a[href]').forEach(keep);
      const rewrite = function () {
        document.querySelectorAll('#foldersPanel a[href], .folder-path-bar a[href]').forEach(keep);
      };
      rewrite();
      document.addEventListener('elabftw:folders-panel-loaded', rewrite);
      new MutationObserver(rewrite).observe(document.body, { childList: true, subtree: true });
    }
    return mine;
  }

  // the list page: the switch between All entries and My entries, and in My entries the toggle In database
  function listPage(nav) {
    viewSwitch(nav);
  }

  // a dialog of our own: the native box of the browser can be blocked
  function confirmDialog(title, text, ok) {
    return new Promise(function (resolve) {
      const back = element('div', 'planned-backdrop');
      const box = element('div', 'planned-dialog');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.append(element('h5', '', title), element('p', '', text));
      const buttons = element('div', 'planned-dialog-buttons');
      const cancel = element('button', 'btn btn-secondary btn-sm', 'Cancel');
      cancel.type = 'button';
      const yes = element('button', 'btn btn-danger btn-sm', ok);
      yes.type = 'button';
      const done = function (value) {
        back.remove();
        resolve(value);
      };
      cancel.addEventListener('click', function () {
        done(false);
      });
      yes.addEventListener('click', function () {
        done(true);
      });
      back.addEventListener('click', function (event) {
        if (event.target === back) {
          done(false);
        }
      });
      buttons.append(cancel, yes);
      box.append(buttons);
      back.append(box);
      document.body.append(back);
      cancel.focus();
    });
  }

  // ---- the page of an entry: a bar says where it is, planned or in the Database, and moves it
  async function entryPage(id) {
    let entry;
    let me = null;
    try {
      entry = await (await fetch('api/v2/inventory/' + id, { credentials: 'same-origin' })).json();
      me = (await (await fetch('api/v2/users/me', { credentials: 'same-origin' })).json()).userid;
    } catch (error) {
      return;
    }
    const container = document.getElementById('container');
    if (!container) {
      return;
    }
    const planned = Number(entry.is_planned) === 1;
    const mine = Number(entry.userid) === Number(me);
    // an entry without a number is in My entries: the folders of the path bar and of the panel lead to My entries
    if (planned || entry.custom_id === null) {
      const keepMine = function () {
        document.querySelectorAll('#foldersPanel a[href], .folder-path-bar a[href]').forEach(function (link) {
          const url = new URL(link.getAttribute('href'), location.href);
          if (/registry\.php$/.test(url.pathname) && !url.searchParams.has('planned') && !url.searchParams.has('id')) {
            url.searchParams.set('planned', '1');
            link.setAttribute('href', url.pathname.replace(/^\//, '') + url.search);
          }
        });
      };
      keepMine();
      document.addEventListener('elabftw:folders-panel-loaded', keepMine);
      new MutationObserver(keepMine).observe(document.body, { childList: true, subtree: true });
    }
    // an entry opened from My entries goes back to its folder, in My entries
    let fromMine = false;
    try {
      fromMine = sessionStorage.getItem('registryMine') === '1';
    } catch (error) {
      fromMine = false;
    }
    if (fromMine && Number(entry.folder_id) > 0) {
      const target = 'registry.php?folder=' + Number(entry.folder_id) + '&planned=1';
      document.querySelectorAll('a[title="Go back"], a[title="Back to listing"]').forEach(function (link) {
        link.setAttribute('href', target);
      });
      document.querySelectorAll('[data-action="update-entity-body"][data-folder-url]').forEach(function (button) {
        button.dataset.redirect = 'folder';
        button.dataset.folderUrl = target;
      });
    }
    const bar = element('div', 'alert d-flex align-items-center flex-wrap my-2 ' + (planned ? 'alert-info' : 'alert-light border'));
    const message = element('span', 'ml-2');
    if (planned) {
      bar.append(element('span', 'mr-2', 'Not in the Database yet: private to you, no number shown.'));
      const status = element('select', 'form-control form-control-sm w-auto mr-2');
      ['Planned', 'Ordered', 'Being made'].forEach(function (title) {
        const option = element('option', '', title);
        option.value = title;
        option.selected = title === entry.status_title;
        status.append(option);
      });
      status.disabled = !mine;
      status.addEventListener('change', async function () {
        try {
          await post({ action: 'status', id: id, status: status.value });
          message.textContent = 'Status: ' + status.value + '.';
        } catch (error) {
          message.textContent = error.message;
        }
      });
      const move = element('button', 'btn btn-success btn-sm ml-auto', 'Move to the Database');
      move.type = 'button';
      move.disabled = !mine;
      move.title = entry.custom_id ? 'It comes back with its number ' + entry.custom_id : 'It gets the next number of its module';
      move.addEventListener('click', async function () {
        move.disabled = true;
        try {
          const done = await post({ action: 'ready', id: id });
          message.textContent = 'It is in the Database now: number ' + done.number + '.';
          window.setTimeout(function () {
            location.reload();
          }, 900);
        } catch (error) {
          message.textContent = error.message;
          move.disabled = false;
        }
      });
      bar.append(status, move, message);
    } else if (mine && !entry.custom_id) {
      // in the Database without a number: an intermediate. Register gives it the next number of its module, when it has what the
      // module requires (the required fields, and for the plasmids a sequence).
      bar.classList.add('alert-warning');
      bar.append(element('span', 'mr-2', 'Not registered in the lab (an intermediate). Only you see it, and it is not in the lists of the Database.'));
      const register = element('button', 'btn btn-success btn-sm ml-auto', 'Register in the lab Database');
      register.type = 'button';
      register.addEventListener('click', async function () {
        register.disabled = true;
        try {
          const done = await post({ action: 'register', id: id });
          message.textContent = 'Registered: number ' + done.number + '.';
          window.setTimeout(function () {
            location.reload();
          }, 900);
        } catch (error) {
          message.textContent = error.message;
          register.disabled = false;
        }
      });
      const own = element('button', 'btn btn-outline-secondary btn-sm ml-2', entry.personal_id ? String(entry.personal_id) : 'Register for myself');
      own.type = 'button';
      own.disabled = Boolean(entry.personal_id);
      own.title = 'It gets your next number of the module and stays private to you';
      own.addEventListener('click', async function () {
        own.disabled = true;
        try {
          const done = await post({ action: 'personal', id: id });
          message.textContent = 'Registered for you: number ' + done.number + '.';
          window.setTimeout(function () {
            location.reload();
          }, 900);
        } catch (error) {
          message.textContent = error.message;
          own.disabled = false;
        }
      });
      bar.append(register, own, message);
    } else if (mine) {
      bar.append(element('span', 'text-muted mr-2', 'In the Database' + (entry.custom_id ? ' as number ' + entry.custom_id : '') + '.'));
      const back = element('button', 'btn btn-outline-secondary btn-sm ml-auto', 'Move back to planned');
      back.type = 'button';
      back.addEventListener('click', async function () {
        const yes = await confirmDialog('Move it out of the Database?', 'It becomes private to you and disappears from the lists, the searches and the pickers of everyone else, including the orders and plasmids that use it. It keeps its number ' + (entry.custom_id || '') + ': when you move it back into the Database it has the same one.', 'Move back to planned');
        if (!yes) {
          return;
        }
        try {
          await post({ action: 'revert', id: id });
          location.reload();
        } catch (error) {
          message.textContent = error.message;
        }
      });
      bar.append(back, message);
    } else {
      return;
    }
    container.prepend(bar);
  }

  // the rows ticked in the list go into the lab Database: each is registered (or moved from planned) and gets its number
  // and its folder; the ones that cannot (a plasmid needs a sequence, a module its required fields) are listed
  window.RegistryTools = {
    addToDatabase: async function (ids, done) {
      if (!(await confirmDialog('Add ' + ids.length + (ids.length === 1 ? ' entry' : ' entries') + ' to the Database?', 'Each gets the next number of its module and is filed in Database items, in the folder of its module, visible to everyone with an account.', 'Add to the Database'))) {
        return;
      }
      const failed = [];
      for (const entryId of ids) {
        try {
          await post({ action: 'lab', id: entryId });
        } catch (error) {
          failed.push('#' + entryId + ': ' + error.message);
        }
      }
      if (failed.length > 0) {
        await confirmDialog('Not all could be added', (ids.length - failed.length) + ' added. ' + failed.join(' '), 'OK');
      }
      done();
    },
  };

  // an antibody or a reagent is ordered: a dialog asks for the amount (and the link or the vendor when they are not in the entry), then an
  // order is made, "Name; Vendor", with the link, the clone and the amount in its description, and linked to the entry
  window.addEventListener('registry:order-entry', function (event) {
    const entry = event.detail;
    const field = function (pattern) {
      const found = (entry.fields || []).find(function (f) {
        return pattern.test(f.name);
      });
      return found && found.value ? String(found.value) : '';
    };
    const back = element('div', 'planned-backdrop');
    const box = element('div', 'planned-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    // each module has its own order: what is asked, and what the description of the order says
    const isAntibody = /^antibod/i.test(entry.category || '');
    const kind = isAntibody ? 'antibody' : 'reagent';
    box.append(element('h5', '', 'Order ' + kind + ' ' + entry.title));
    const form = [['vendor', 'Vendor', field(/^(supplier|vendor)/i), true]].concat(
      isAntibody ? [['clone', 'Clone', field(/^clone/i), true]] : [['catalog', 'Catalog number', field(/^catalog/i), true]],
      [['link', 'Link', field(/^(link|url|product link|website)/i), true], ['amount', 'Amount', field(/^(order )?amount/i), true]]
    );
    const inputs = {};
    const labels = {};
    form.forEach(function (item) {
      const label = element('label', 'd-block');
      label.append(element('span', 'd-block small text-muted', item[1]));
      const input = element('input', 'form-control form-control-sm');
      input.type = 'text';
      input.value = item[2];
      if (item[0] === 'amount') {
        input.placeholder = isAntibody ? 'for example 100 µl' : 'for example 500 g, or 1 bottle';
      }
      inputs[item[0]] = input;
      labels[item[0]] = item[1];
      label.append(input);
      box.append(label);
    });
    const message = element('p', 'small text-danger mb-0');
    const buttons = element('div', 'planned-dialog-buttons');
    const cancel = element('button', 'btn btn-secondary btn-sm', 'Cancel');
    cancel.type = 'button';
    const make = element('button', 'btn btn-primary btn-sm', 'Make the order');
    make.type = 'button';
    cancel.addEventListener('click', function () {
      back.remove();
    });
    back.addEventListener('click', function (e) {
      if (e.target === back) {
        back.remove();
      }
    });
    make.addEventListener('click', async function () {
      make.disabled = true;
      message.textContent = '';
      try {
        const vendor = inputs.vendor.value.trim();
        // the description is a rich text: the link is a clickable badge with the title of its page, like a link pasted in an order
        const esc = function (text) {
          return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        };
        const lines = [];
        for (const key of ['link', 'clone', 'catalog', 'amount']) {
          const value = inputs[key] ? inputs[key].value.trim() : '';
          if (value === '') {
            continue;
          }
          let shown = esc(value);
          if (key === 'link' && /^https?:\/\/\S+$/i.test(value)) {
            let label = value;
            try {
              const preview = await (await fetch('api/v2/link_preview?url=' + encodeURIComponent(value), { credentials: 'same-origin' })).json();
              label = preview.title || preview.hostname || value;
            } catch (error) {
              label = value;
            }
            shown = '<a href="' + esc(value) + '" target="_blank" rel="noreferrer noopener" class="elabftw-link-preview">' + esc(label) + '</a>';
          }
          lines.push('<p>' + labels[key] + ': ' + shown + '</p>');
        }
        const response = await fetch('api/v2/orders', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token() },
          body: JSON.stringify({ title: entry.title + (vendor ? '; ' + vendor : ''), notes: lines.join('') }),
        });
        if (!response.ok) {
          throw new Error('The order could not be made (' + response.status + ').');
        }
        const orderId = Number((response.headers.get('Location') || '').split('/').pop());
        const linked = await fetch('primers.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token() }, body: JSON.stringify({ action: 'order', primers: [entry.id], order: orderId }) });
        if (!linked.ok) {
          throw new Error('The order was made, but it could not be linked to the entry (' + linked.status + ').');
        }
        back.remove();
        window.location.href = 'orders.php?order=' + orderId;
      } catch (error) {
        message.textContent = error.message;
        make.disabled = false;
      }
    });
    buttons.append(cancel, make);
    box.append(message, buttons);
    back.append(box);
    document.body.append(back);
    inputs.amount.focus();
  });

  // the print button of a row: the label of the entry is printed on the label printer of the lab (see label-print.php)
  window.addEventListener('registry:print-label', function (event) {
    const entry = event.detail;
    const back = element('div', 'planned-backdrop');
    const box = element('div', 'planned-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.append(element('h5', '', 'Print a label for ' + entry.title));
    const label = element('label', 'd-block');
    label.append(element('span', 'd-block small text-muted', 'Copies'));
    const copies = element('input', 'form-control form-control-sm');
    copies.type = 'number';
    copies.min = '1';
    copies.max = '100';
    copies.value = '1';
    label.append(copies);
    box.append(label);
    const message = element('p', 'small mb-0');
    const buttons = element('div', 'planned-dialog-buttons');
    const cancel = element('button', 'btn btn-secondary btn-sm', 'Close');
    cancel.type = 'button';
    const print = element('button', 'btn btn-primary btn-sm', 'Print');
    print.type = 'button';
    cancel.addEventListener('click', function () {
      back.remove();
    });
    back.addEventListener('click', function (e) {
      if (e.target === back) {
        back.remove();
      }
    });
    print.addEventListener('click', async function () {
      print.disabled = true;
      message.className = 'small mb-0';
      message.textContent = 'Sending to the printer...';
      try {
        const response = await fetch('label-print.php', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token() },
          body: JSON.stringify({ id: entry.id, copies: Number(copies.value) || 1 }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || 'The label could not be printed.');
        }
        message.className = 'small mb-0 text-success';
        message.textContent = 'Sent: ' + body.printed + (body.printed === 1 ? ' label' : ' labels') + ' (' + body.lines.join(' / ') + ').';
      } catch (error) {
        message.className = 'small mb-0 text-danger';
        message.textContent = error.message;
      }
      print.disabled = false;
    });
    buttons.append(cancel, print);
    box.append(message, buttons);
    back.append(box);
    document.body.append(back);
    print.focus();
  });

  const params = new URLSearchParams(location.search);
  const id = Number(params.get('id'));
  const nav = document.querySelector('nav.category-nav');
  if (nav) {
    listPage(nav);
  } else if (id > 0 && /registry\.php$/.test(location.pathname)) {
    entryPage(id);
  }
})();
