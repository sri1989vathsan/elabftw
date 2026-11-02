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

  async function listPage(nav) {
    viewSwitch(nav);
    const tab = element('button', 'category-nav-item planned-tab', 'Plan / register');
    tab.type = 'button';
    tab.title = 'Plan something, add an intermediate, or register or move your entries that have no number yet';
    nav.append(tab);
    const panel = element('div', 'planned-panel card card-body my-2');
    panel.hidden = true;
    nav.insertAdjacentElement('afterend', panel);

    async function draw() {
      panel.textContent = '';
      panel.append(element('p', 'text-muted mb-2', 'The Database lists show the registered entries only. Here are all your entries; the ones without a number (planned: Planned, Ordered, Being made, and intermediates) come first and only you see them. Move a planned one to the Database when it is made, or register an intermediate: it gets the next number of its module.'));
      const form = element('form', 'form-inline mb-2');
      const title = element('input', 'form-control form-control-sm mr-2');
      title.type = 'text';
      title.placeholder = 'Name of what you plan';
      title.required = true;
      const kind = element('select', 'form-control form-control-sm mr-2');
      [['plan', 'Planned (not made yet)'], ['intermediate', 'Intermediate (made, no number)']].forEach(function (option) {
        const o = element('option', '', option[1]);
        o.value = option[0];
        kind.append(o);
      });
      const category = element('select', 'form-control form-control-sm mr-2');
      const add = element('button', 'btn btn-primary btn-sm', 'Add');
      add.type = 'submit';
      const message = element('span', 'ml-2 text-danger');
      form.append(title, kind, category, add, message);
      panel.append(form);
      try {
        const categories = await (await fetch('api/v2/teams/current/registry_categories', { credentials: 'same-origin' })).json();
        categories.forEach(function (c) {
          const option = element('option', '', c.title);
          option.value = c.id;
          category.append(option);
        });
      } catch (error) {
        message.textContent = 'The modules could not be loaded.';
      }
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        add.disabled = true;
        try {
          const made = await post({ action: kind.value, title: title.value, category: Number(category.value) });
          location.href = 'registry.php?mode=edit&id=' + made.id;
        } catch (error) {
          message.textContent = error.message;
          add.disabled = false;
        }
      });
      const holder = element('div');
      panel.append(holder);
      try {
        const planned = (await call()).planned;
        if (planned.length === 0) {
          holder.append(element('p', 'text-muted mb-0', 'You have no entries yet.'));
        }
        planned.forEach(function (entry) {
          const row = element('div', 'd-flex align-items-center py-1 border-top');
          const link = element('a', '', entry.title);
          link.href = 'registry.php?mode=view&id=' + entry.id;
          const badge = element('span', 'badge badge-secondary ml-2', entry.category_title || 'no module');
          const isPlanned = Number(entry.is_planned) === 1;
          const registered = !isPlanned && entry.custom_id !== null;
          const state = element('span', 'badge ml-2 text-white', registered ? 'No. ' + entry.custom_id : (isPlanned ? (entry.status_title || 'Planned') : 'Intermediate'));
          state.style.backgroundColor = '#' + (registered ? '6b7785' : (isPlanned ? (entry.status_color || 'b0b7c3') : 'c9a227'));
          const ready = element('button', 'btn btn-outline-success btn-sm ml-auto', isPlanned ? 'Move to the Database' : 'Register to number');
          ready.title = isPlanned ? (entry.custom_id ? 'It comes back with its number ' + entry.custom_id : 'It gets the next number of its module') : 'It gets the next number of its module when it has what the module requires';
          ready.type = 'button';
          ready.addEventListener('click', async function () {
            ready.disabled = true;
            try {
              const done = await post({ action: isPlanned ? 'ready' : 'register', id: entry.id });
              ready.textContent = 'Number ' + done.number;
              window.setTimeout(draw, 800);
            } catch (error) {
              ready.textContent = error.message;
            }
          });
          row.append(link, badge, state);
          if (!registered) {
            row.append(ready);
          }
          holder.append(row);
        });
      } catch (error) {
        holder.append(element('p', 'text-danger', error.message));
      }
    }
    tab.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      tab.classList.toggle('active', !panel.hidden);
      if (!panel.hidden) {
        draw();
      }
    });
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
      bar.append(element('span', 'mr-2', 'Not registered: no number yet (an intermediate). Only you see it, and it is not in the lists of the Database.'));
      const register = element('button', 'btn btn-success btn-sm ml-auto', 'Register to number');
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
      bar.append(register, message);
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

  const params = new URLSearchParams(location.search);
  const id = Number(params.get('id'));
  const nav = document.querySelector('nav.category-nav');
  if (nav) {
    listPage(nav);
  } else if (id > 0 && /registry\.php$/.test(location.pathname)) {
    entryPage(id);
  }
})();
