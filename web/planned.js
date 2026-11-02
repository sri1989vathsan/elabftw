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
  async function listPage(nav) {
    const tab = element('button', 'category-nav-item planned-tab', 'My planned');
    tab.type = 'button';
    tab.title = 'Plasmids, primers and stocks that are not made or ordered yet: private, without a number';
    nav.append(tab);
    const panel = element('div', 'planned-panel card card-body my-2');
    panel.hidden = true;
    nav.insertAdjacentElement('afterend', panel);

    async function draw() {
      panel.textContent = '';
      panel.append(element('p', 'text-muted mb-2', 'Planned entries (Planned, Ordered, Being made) are private to you, are not in the lists of the Database and show no number. Move one to the Database when it is made or arrives: it gets the next number of its module (or the number it had before).'));
      const form = element('form', 'form-inline mb-2');
      const title = element('input', 'form-control form-control-sm mr-2');
      title.type = 'text';
      title.placeholder = 'Name of what you plan';
      title.required = true;
      const category = element('select', 'form-control form-control-sm mr-2');
      const add = element('button', 'btn btn-primary btn-sm', 'Plan it');
      add.type = 'submit';
      const message = element('span', 'ml-2 text-danger');
      form.append(title, category, add, message);
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
          const made = await post({ action: 'plan', title: title.value, category: Number(category.value) });
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
          holder.append(element('p', 'text-muted mb-0', 'Nothing is planned yet.'));
        }
        planned.forEach(function (entry) {
          const row = element('div', 'd-flex align-items-center py-1 border-top');
          const link = element('a', '', entry.title);
          link.href = 'registry.php?mode=view&id=' + entry.id;
          const badge = element('span', 'badge badge-secondary ml-2', entry.category_title || 'no module');
          const state = element('span', 'badge ml-2 text-white', entry.status_title || 'Planned');
          state.style.backgroundColor = '#' + (entry.status_color || 'b0b7c3');
          const ready = element('button', 'btn btn-outline-success btn-sm ml-auto', 'Move to the Database');
          ready.title = entry.custom_id ? 'It comes back with its number ' + entry.custom_id : 'It gets the next number of its module';
          ready.type = 'button';
          ready.addEventListener('click', async function () {
            ready.disabled = true;
            try {
              const done = await post({ action: 'ready', id: entry.id });
              ready.textContent = 'Number ' + done.number;
              window.setTimeout(draw, 800);
            } catch (error) {
              ready.textContent = error.message;
            }
          });
          row.append(link, badge, state, ready);
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
      bar.append(element('span', 'mr-2', 'Not registered: no number yet (an intermediate).'));
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
