/**
 * Entries of the database linked to experiments and resources: on an experiment or a resource, a section lists the entries linked to it
 * and has a search to link more; on an entry of the database, a section lists the experiments and resources that use it.
 * Talks to registry-links.php.
 */
(function () {
  'use strict';
  const page = location.pathname.split('/').pop();
  const params = new URLSearchParams(location.search);
  const id = Number(params.get('id'));
  const mode = params.get('mode');
  const type = page === 'experiments.php' ? 'experiments' : (page === 'database.php' ? 'items' : (page === 'registry.php' ? 'inventory' : ''));
  if (!type || !(id > 0) || (mode !== 'view' && mode !== 'edit')) {
    return;
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
  const get = async function (query) {
    const response = await fetch('registry-links.php?' + query, { credentials: 'same-origin' });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'The request failed.');
    }
    return body;
  };
  const post = async function (payload) {
    const response = await fetch('registry-links.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'The request failed.');
    }
    return body;
  };
  const numberOf = function (entry) {
    return entry.custom_id !== null && entry.custom_id !== undefined ? '#' + entry.custom_id : (entry.personal_id ? 'my ' + entry.personal_id : '');
  };

  // where the section goes: with the links of the page when there are some, else before the comments, else at the end
  const holder = element('section', 'mt-3 registry-links');
  holder.id = 'registryLinksSection';
  const anchor = document.getElementById('linksDiv');
  if (anchor && anchor.parentNode) {
    anchor.insertAdjacentElement('afterend', holder);
  } else if (document.getElementById('commentsDiv')) {
    document.getElementById('commentsDiv').insertAdjacentElement('beforebegin', holder);
  } else {
    (document.getElementById('container') || document.body).append(holder);
  }

  async function drawUsedIn() {
    holder.textContent = '';
    holder.append(element('h4', 'ml-3', 'Used in'));
    const box = element('div', 'ml-4');
    holder.append(box);
    let used = [];
    try {
      used = (await get('used_in=' + id)).used_in;
    } catch (error) {
      box.append(element('p', 'text-danger', error.message));
      return;
    }
    if (used.length === 0) {
      box.append(element('p', 'text-muted', 'No experiment or resource uses this entry yet. Link it from the page of the experiment or the resource.'));
    }
    used.forEach(function (item) {
      const row = element('div', 'mb-1');
      const link = element('a', '', item.title || 'Untitled');
      link.href = (item.type === 'experiments' ? 'experiments.php' : 'database.php') + '?mode=view&id=' + item.id;
      row.append(element('span', 'badge badge-secondary mr-2', item.type === 'experiments' ? 'Experiment' : 'Resource'), link);
      box.append(row);
    });
  }

  async function draw() {
    holder.textContent = '';
    holder.append(element('h4', 'ml-3', 'Database entries'));
    const box = element('div', 'ml-4');
    holder.append(box);
    let entries = [];
    try {
      entries = (await get('entity=' + type + '&id=' + id)).entries;
    } catch (error) {
      box.append(element('p', 'text-danger', error.message));
      return;
    }
    if (entries.length === 0 && mode === 'view') {
      holder.remove();
      return;
    }
    entries.forEach(function (entry) {
      const row = element('div', 'd-flex align-items-center mb-1');
      const dot = element('span', 'round-spot mr-2');
      dot.style.backgroundColor = '#' + (entry.color || 'bdbdbd');
      const link = element('a', '', (numberOf(entry) ? numberOf(entry) + ' ' : '') + entry.title);
      link.href = 'registry.php?mode=view&id=' + entry.id;
      row.append(dot, element('span', 'text-muted small mr-2', entry.module || ''), link);
      if (mode === 'edit') {
        const remove = element('button', 'btn btn-danger-ghost btn-sm ml-2', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', async function () {
          try {
            await post({ action: 'remove', entity: type, id: id, inventory_id: entry.id });
            draw();
          } catch (error) {
            remove.textContent = error.message;
          }
        });
        row.append(remove);
      }
      box.append(row);
    });
    if (mode !== 'edit') {
      return;
    }
    // the search: by title, number or module, among the entries of the database that can be read
    const search = element('input', 'form-control form-control-sm mt-2');
    search.type = 'search';
    search.placeholder = 'Link a Database entry: type a name, a number or a module';
    search.setAttribute('aria-label', 'Search the Database to link an entry');
    const results = element('div', 'list-group mt-1');
    let timer = 0;
    search.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(async function () {
        results.textContent = '';
        if (search.value.trim() === '') {
          return;
        }
        try {
          const found = (await get('search=' + encodeURIComponent(search.value.trim()))).entries;
          if (found.length === 0) {
            results.append(element('div', 'list-group-item small text-muted', 'Nothing found.'));
          }
          found.forEach(function (entry) {
            const item = element('button', 'list-group-item list-group-item-action py-1 d-flex align-items-center');
            item.type = 'button';
            const dot = element('span', 'round-spot mr-2');
            dot.style.backgroundColor = '#' + (entry.color || 'bdbdbd');
            item.append(dot, element('span', 'text-muted small mr-2', entry.module || ''), document.createTextNode((numberOf(entry) ? numberOf(entry) + ' ' : '') + entry.title));
            item.addEventListener('click', async function () {
              try {
                await post({ action: 'add', entity: type, id: id, inventory_id: entry.id });
                draw();
              } catch (error) {
                item.textContent = error.message;
              }
            });
            results.append(item);
          });
        } catch (error) {
          results.append(element('div', 'list-group-item small text-danger', error.message));
        }
      }, 300);
    });
    box.append(search, results);
  }

  if (type === 'inventory') {
    drawUsedIn();
  } else {
    draw();
  }
})();
