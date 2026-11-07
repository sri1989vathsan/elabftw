/**
 * Admin panel, Database tab, "Find by meaning": the switch, the address of the model server (a model that runs on the lab's own machines), the
 * models, a test, and the button that makes the model read the entries (the index). Only a sysadmin changes the settings; admins can read the entries.
 */
(function () {
  'use strict';
  const anchor = document.getElementById('aiSearchApp');
  if (!anchor) {
    return;
  }
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : (anchor.dataset.csrf || '');
  };
  const sysadmin = anchor.dataset.sysadmin === '1';
  const api = function (body) {
    return fetch('ai-search.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json();
    });
  };
  const make = function (tag, attributes, text) {
    const node = document.createElement(tag);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, attributes[key]);
    });
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  };
  const row = function (label, input, help) {
    const group = make('div', { class: 'form-group' });
    group.append(make('label', { class: 'font-weight-bold' }, label), input);
    if (help) {
      group.append(make('small', { class: 'form-text text-muted' }, help));
    }
    return group;
  };

  const render = function (status) {
    anchor.textContent = '';
    anchor.append(make('p', { class: 'text-muted' }, 'Search the entries (experiments and the Database) by describing what is needed. A language model that runs on a machine of the lab reads the entries; nothing is sent to an outside service. It is off until it is turned on here.'));
    if (status.forced_off) {
      anchor.append(make('div', { class: 'alert alert-warning' }, 'It is switched off for good on this server (AI_SEARCH_DISABLED=1 in the environment).'));
    }
    const state = make('div', { class: 'mb-3' });
    state.append(make('span', { class: 'badge ' + (status.enabled ? 'badge-success' : 'badge-secondary') + ' mr-2' }, status.enabled ? 'On' : 'Off'));
    anchor.append(state);

    const settings = status.settings;
    if (sysadmin && settings) {
      const enabled = make('input', { type: 'checkbox', class: 'mr-2' });
      enabled.checked = settings.enabled;
      const enabledLabel = make('label', { class: 'font-weight-bold d-block mb-3' });
      enabledLabel.append(enabled, 'Turn on the search by meaning');
      const url = make('input', { type: 'text', class: 'form-control', value: settings.url });
      const embed = make('input', { type: 'text', class: 'form-control', value: settings.embed_model });
      const chat = make('input', { type: 'text', class: 'form-control', value: settings.chat_model });
      const explain = make('input', { type: 'checkbox', class: 'mr-2' });
      explain.checked = settings.explain;
      const explainLabel = make('label', { class: 'd-block mb-3' });
      explainLabel.append(explain, 'Also write a short note on why each entry fits (slower; needs the chat model)');
      const message = make('div', { class: 'mb-3' });
      const save = make('button', { type: 'button', class: 'btn btn-primary mr-2' }, 'Save');
      const test = make('button', { type: 'button', class: 'btn btn-secondary' }, 'Test the model server');
      const body = function () {
        return { enabled: enabled.checked, url: url.value, embed_model: embed.value, chat_model: chat.value, explain: explain.checked };
      };
      save.addEventListener('click', function () {
        api(Object.assign({ action: 'save_settings' }, body())).then(function (data) {
          message.className = 'mb-3 ' + (data.error ? 'text-danger' : 'text-success');
          message.textContent = data.error || 'Saved.';
          if (!data.error) {
            reload();
          }
        });
      });
      test.addEventListener('click', function () {
        message.className = 'mb-3 text-muted';
        message.textContent = 'Testing...';
        api(Object.assign({ action: 'save_settings' }, body())).then(function (saved) {
          if (saved.error) {
            throw new Error(saved.error);
          }
          return api({ action: 'test' });
        }).then(function (data) {
          message.className = 'mb-3 ' + (data.ok ? 'text-success' : 'text-danger');
          message.textContent = data.ok ? 'The model server answers (' + data.dims + ' numbers per entry).' : (data.message || data.error);
        }).catch(function (error) {
          message.className = 'mb-3 text-danger';
          message.textContent = error.message;
        });
      });
      anchor.append(enabledLabel,
        row('Address of the model server', url, 'On your own computer with Docker: http://host.docker.internal:11434 (Ollama). Keep it inside the institute network: the server has no login of its own.'),
        row('Model that reads the entries', embed, 'For example nomic-embed-text. The same model must be used until the entries are read again.'),
        row('Chat model', chat, 'For example qwen2.5:7b. Only used for the short notes.'),
        explainLabel, message, save, test);
    } else if (!sysadmin) {
      anchor.append(make('p', { class: 'text-muted' }, 'Only a sysadmin can change the settings.'));
    }

    if (status.enabled) {
      const box = make('div', { class: 'mt-4' });
      box.append(make('h4', {}, 'Entries read by the model'));
      const table = make('table', { class: 'table table-sm w-auto' });
      Object.keys(status.counts).forEach(function (type) {
        const names = { inventory: 'Database', experiments: 'Experiments', items: 'Resources' };
        const line = make('tr');
        line.append(make('td', {}, names[type] || type), make('td', {}, status.counts[type].indexed + ' of ' + status.counts[type].entries));
        table.append(line);
      });
      const progress = make('div', { class: 'mb-2 text-muted' });
      const build = make('button', { type: 'button', class: 'btn btn-secondary' }, 'Read the new and changed entries now');
      build.addEventListener('click', function () {
        build.disabled = true;
        let total = 0;
        const step = function () {
          api({ action: 'reindex' }).then(function (data) {
            if (data.error) {
              progress.className = 'mb-2 text-danger';
              progress.textContent = data.message || data.error;
              build.disabled = false;
              return;
            }
            total += data.indexed;
            progress.textContent = 'Read ' + total + ' entries...';
            if (data.done) {
              progress.textContent = 'Done: ' + total + ' entries read.';
              build.disabled = false;
              reload();
              return;
            }
            step();
          }).catch(function () {
            progress.className = 'mb-2 text-danger';
            progress.textContent = 'Stopped: the server did not answer. Click again to go on where it stopped.';
            build.disabled = false;
          });
        };
        step();
      });
      box.append(table, progress, build);
      anchor.append(box);
    }
  };
  const reload = function () {
    fetch('ai-search.php?status=1', { credentials: 'same-origin' }).then(function (response) {
      return response.json();
    }).then(render);
  };
  reload();
})();
