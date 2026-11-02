/**
 * Planned entries of the database (see planned.php): things that are not made or ordered yet. On the list page of the Database a
 * "My planned" tab shows the planned entries of the user and a form to plan a new one; on the page of a planned entry a bar says
 * it is planned (no number yet, private) and "Mark as ready" gives it the next number of its module. Needs nothing else.
 */
(function () {
  'use strict';
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
      panel.append(element('p', 'text-muted mb-2', 'Planned entries are private to you, are not in the lists of the Database and have no number yet. Mark one ready when it is made or arrives: it gets the next number of its module.'));
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
          const ready = element('button', 'btn btn-outline-success btn-sm ml-auto', 'Mark as ready');
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
          row.append(link, badge, ready);
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

  // ---- the page of an entry: a bar when it is planned
  async function entryPage(id) {
    let entry;
    try {
      entry = await (await fetch('api/v2/inventory/' + id, { credentials: 'same-origin' })).json();
    } catch (error) {
      return;
    }
    if (Number(entry.is_planned) !== 1) {
      return;
    }
    const bar = element('div', 'alert alert-info d-flex align-items-center my-2');
    bar.append(element('span', '', 'Planned: private to you, not in the lists of the Database, no number yet.'));
    const ready = element('button', 'btn btn-success btn-sm ml-auto', 'Mark as ready');
    ready.type = 'button';
    const message = element('span', 'ml-2');
    ready.addEventListener('click', async function () {
      ready.disabled = true;
      try {
        const done = await post({ action: 'ready', id: id });
        message.textContent = 'It is ready: number ' + done.number + '.';
        window.setTimeout(function () {
          location.reload();
        }, 900);
      } catch (error) {
        message.textContent = error.message;
        ready.disabled = false;
      }
    });
    bar.append(ready, message);
    const container = document.getElementById('container');
    if (container) {
      container.prepend(bar);
    }
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
