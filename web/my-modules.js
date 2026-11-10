/**
 * Personal modules of the Database: the "My modules..." item of the Database menu opens a box to make, rename, recolour and remove the
 * modules only you see. A personal module can start as a copy of a module of the lab (its fields and columns). Its entries stay private,
 * get only your own numbers and are filed in "Module Folders". The server side is registry-my-modules.php. Fork-only file.
 */
(function () {
  'use strict';
  const link = document.getElementById('myModulesLink');
  if (!link) {
    return;
  }
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  };
  const call = function (url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() } : { 'X-Requested-With': 'XMLHttpRequest' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (response) {
      return response.json().catch(function () {
        return { error: 'Your session has probably ended. Reload the page and sign in again.' };
      });
    });
  };
  const make = function (tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  };
  const colors = ['5b8def', '2ea44f', 'f0a202', 'd9534f', '8e5bd9', '1abc9c', '7f8c8d', 'e67e22'];

  const open = function () {
    const back = make('div');
    back.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
    const box = make('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.style.cssText = 'background:var(--white,#fff);color:inherit;border-radius:10px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.35)';
    back.append(box);
    const close = function () {
      back.remove();
    };
    back.addEventListener('click', function (event) {
      if (event.target === back) {
        close();
      }
    });

    const draw = async function (message) {
      box.textContent = '';
      box.append(make('h4', 'mb-1', 'My modules'));
      box.append(make('p', 'small text-muted', 'Only you see these modules. Their entries stay private to you: they never get a number of the lab, only your own (register them individually), and they are filed in the folder "Module Folders" of your folders. You can put them in your own storage.'));
      const mine = await call('registry-my-modules.php');
      const lab = await call('registry-modules.php');
      const list = make('div', 'mb-3');
      (mine.modules || []).forEach(function (module) {
        const row = make('div', 'd-flex align-items-center mb-2');
        const color = make('input');
        color.type = 'color';
        color.value = '#' + module.color;
        color.style.cssText = 'width:32px;height:28px;padding:0;border:0;background:none';
        color.title = 'Colour';
        color.addEventListener('change', async function () {
          await call('registry-my-modules.php', { action: 'update', id: module.id, color: color.value.replace('#', '') });
        });
        const name = make('input', 'form-control form-control-sm mx-2');
        name.value = module.title;
        name.setAttribute('aria-label', 'Name of the module');
        name.addEventListener('change', async function () {
          const answer = await call('registry-my-modules.php', { action: 'update', id: module.id, title: name.value });
          draw(answer.error ? answer.error : 'Renamed. Reload the page to see the new name in the menu.');
        });
        const count = make('span', 'small text-muted text-nowrap mr-2', module.entries + (Number(module.entries) === 1 ? ' entry' : ' entries'));
        const remove = make('button', 'btn btn-outline-danger btn-sm', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', function () {
          // removing needs a second, deliberate step: the name of the module has to be typed
          const ask = make('div', 'border border-danger rounded p-2 mb-2');
          ask.append(make('div', 'small mb-1', 'Type the name of the module to remove it: ' + module.title));
          const typed = make('input', 'form-control form-control-sm mb-2');
          typed.setAttribute('aria-label', 'Name of the module to remove');
          const sure = make('button', 'btn btn-danger btn-sm mr-2', 'Remove for good');
          sure.type = 'button';
          sure.disabled = true;
          typed.addEventListener('input', function () {
            sure.disabled = typed.value.trim() !== module.title.trim();
          });
          sure.addEventListener('click', async function () {
            const answer = await call('registry-my-modules.php', { action: 'delete', id: module.id, confirm_title: typed.value });
            draw(answer.error ? answer.error : 'Removed. Reload the page to update the menu.');
          });
          const cancel = make('button', 'btn btn-outline-secondary btn-sm', 'Cancel');
          cancel.type = 'button';
          cancel.addEventListener('click', function () { ask.remove(); });
          ask.append(typed, sure, cancel);
          list.insertBefore(ask, row.nextSibling);
          typed.focus();
        });
        row.append(color, name, count, remove);
        list.append(row);
      });
      if ((mine.modules || []).length === 0) {
        list.append(make('p', 'text-muted', 'You have no personal module yet.'));
      }
      box.append(list);

      box.append(make('h5', 'mt-2', 'New personal module'));
      const form = make('div', 'd-flex flex-wrap align-items-center mb-2');
      const title = make('input', 'form-control form-control-sm mr-2 mb-2');
      title.placeholder = 'Name, for example My plasmids';
      title.style.maxWidth = '230px';
      const color = make('input', 'mr-2 mb-2');
      color.type = 'color';
      color.value = '#' + colors[(mine.modules || []).length % colors.length];
      color.style.cssText = 'width:32px;height:30px;padding:0;border:0;background:none';
      const copy = make('select', 'form-control form-control-sm mr-2 mb-2');
      copy.style.maxWidth = '230px';
      copy.append(new Option('Start with no fields', ''));
      (lab.modules || []).forEach(function (module) {
        copy.append(new Option('Copy the fields of ' + module.title + (module.is_personal ? ' (mine)' : ''), String(module.id)));
      });
      const create = make('button', 'btn btn-primary btn-sm mb-2', 'Create');
      create.type = 'button';
      create.addEventListener('click', async function () {
        create.disabled = true;
        const answer = await call('registry-my-modules.php', { action: 'create', title: title.value, color: color.value.replace('#', ''), copy_from: copy.value ? Number(copy.value) : 0 });
        if (answer.error) {
          draw(answer.error);
          return;
        }
        window.location.href = 'registry.php?category=' + answer.id;
      });
      form.append(title, color, copy, create);
      box.append(form);
      if (message) {
        box.append(make('p', 'small mb-2 ' + (/\.$/.test(message) && !/cannot|exists|needs|still|not|session/i.test(message) ? 'text-success' : 'text-danger'), message));
      }
      const done = make('button', 'btn btn-secondary btn-sm', 'Close');
      done.type = 'button';
      done.addEventListener('click', close);
      box.append(done);
    };
    draw('');
    document.body.append(back);
  };
  link.addEventListener('click', function (event) {
    event.preventDefault();
    open();
  });
})();
