/**
 * Database: who can edit an entry (the owner stays the owner), for one entry or for a selection of the list.
 * - list (registry.php): "Who can edit..." in the "Actions on selected" menu, after "Assign owner"
 * - entry page (view / edit): a "Who can edit" button
 * The server side is registry-permissions.php: the owner of an entry or an admin may change it. Fork-only file.
 */
(function () {
  'use strict';
  if (window.location.pathname.split('/').pop() !== 'registry.php') {
    return;
  }
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  };
  const call = function (body) {
    return fetch('registry-permissions.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
      body: JSON.stringify(body),
    }).then(function (response) {
      // an error page and not data usually means the session ended (signed out, or the account was removed)
      return response.json().catch(function () {
        return { error: 'Your session has probably ended. Reload the page and sign in again.' };
      });
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
  const style = make('style');
  style.textContent = [
    '#rpOverlay{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}',
    '#rpBox{background:var(--white,#fff);color:inherit;border-radius:10px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.35)}',
    '#rpBox h4{margin:0 0 6px}',
    '#rpBox .rp-list{max-height:170px;overflow:auto;border:1px solid rgba(128,128,128,.35);border-radius:6px;padding:6px 8px;margin-bottom:10px}',
    '#rpBox .rp-list label{display:block;margin:0;font-weight:400}',
    '#rpBox .rp-now{font-size:13px;margin-bottom:10px;padding:8px 10px;border-radius:6px;background:rgba(128,128,128,.12)}',
    '#rpBox .rp-row{margin-bottom:10px}',
    '#rpBox .rp-msg{margin-top:10px}',
  ].join('\n');
  document.head.append(style);

  const baseNames = { 10: 'only the owner', 20: 'the owner and the admins', 30: 'all the users of the team' };
  let people = null;
  const loadPeople = function () {
    if (people) {
      return Promise.resolve(people);
    }
    return call({ action: 'people' }).then(function (data) {
      people = data;
      return data;
    });
  };

  // make, change or delete one of my groups (only I and its members see it)
  const editGroup = function (overlay, group, back) {
    const box = overlay.querySelector('#rpBox');
    box.textContent = '';
    box.append(make('h4', {}, group ? 'My group' : 'New group'), make('div', { class: 'text-muted mb-2' }, 'Only you and the people in it can see this group. You can give it editing rights on your entries.'));
    const name = make('input', { type: 'text', class: 'form-control form-control-sm mb-2', placeholder: 'Name of the group', 'aria-label': 'Name of the group', maxlength: '100' });
    name.value = group ? group.name : '';
    const filter = make('input', { type: 'text', class: 'form-control form-control-sm mb-2', placeholder: 'Search a person', 'aria-label': 'Search a person' });
    const list = make('div', { class: 'rp-list' });
    const message = make('div', { class: 'rp-msg' });
    const save = make('button', { type: 'button', class: 'btn btn-primary mr-2' }, 'Save');
    const backButton = make('button', { type: 'button', class: 'btn btn-secondary mr-2' }, 'Back');
    box.append(name, make('strong', {}, 'People in the group'), filter, list, save, backButton);
    let remove = null;
    if (group) {
      remove = make('button', { type: 'button', class: 'btn btn-outline-danger' }, 'Delete the group');
      box.append(remove);
    }
    box.append(message);
    const members = group ? group.members.map(function (m) {
      return m.id;
    }) : [];
    const boxes = [];
    loadPeople().then(function (data) {
      data.users.forEach(function (u) {
        const l = make('label');
        const cb = make('input', { type: 'checkbox', class: 'mr-2' });
        cb.checked = members.indexOf(u.id) >= 0;
        l.append(cb, u.name);
        list.append(l);
        boxes.push({ id: u.id, cb: cb, label: l, name: u.name.toLowerCase() });
      });
    });
    filter.addEventListener('input', function () {
      const q = filter.value.trim().toLowerCase();
      boxes.forEach(function (b) {
        b.label.hidden = q !== '' && b.name.indexOf(q) < 0;
      });
    });
    backButton.addEventListener('click', back);
    save.addEventListener('click', function () {
      save.disabled = true;
      call({ action: 'save_group', id: group ? group.id : 0, name: name.value, users: boxes.filter(function (b) {
        return b.cb.checked;
      }).map(function (b) {
        return b.id;
      }) }).then(function (data) {
        save.disabled = false;
        if (data.error) {
          message.className = 'rp-msg text-danger';
          message.textContent = data.error;
          return;
        }
        people = null;
        back();
      });
    });
    if (remove) {
      remove.addEventListener('click', function () {
        if (remove.dataset.sure !== '1') {
          remove.dataset.sure = '1';
          remove.textContent = 'Click again to delete it for good';
          return;
        }
        call({ action: 'delete_group', id: group.id }).then(function (data) {
          if (data.error) {
            message.className = 'rp-msg text-danger';
            message.textContent = data.error;
            return;
          }
          people = null;
          back();
        });
      });
    }
  };

  // the small "i" that opens the guide card about who can edit
  const guideButton = function () {
    const b = make('button', { type: 'button', class: 'btn btn-link guide-info-btn p-0 ml-2', 'data-action': 'open-guide-card', 'data-card': 'guide-database-sharing', title: 'About who can edit in the guide', 'aria-label': 'About who can edit in the guide' });
    b.append(make('i', { class: 'fas fa-circle-info', 'aria-hidden': 'true' }));
    // the box sits outside #container, where the page's click handlers listen: pass the click on to the guide handler from a button inside it
    b.addEventListener('click', function () {
      const relay = make('button', { type: 'button', hidden: '', 'data-action': 'open-guide-card', 'data-card': 'guide-database-sharing' });
      document.getElementById('container').append(relay);
      relay.click();
      relay.remove();
    });
    return b;
  };
  // ids: the entries to change; title: what the box says it is about; current: {owner, users, teamgroups, base} for one entry
  const openBox = function (ids, title, current, done) {
    const overlay = make('div', { id: 'rpOverlay' });
    const box = make('div', { id: 'rpBox', role: 'dialog', 'aria-label': 'Who can edit' });
    overlay.append(box);
    const heading = make('h4', {}, 'Who can edit');
    heading.append(guideButton());
    box.append(heading, make('div', { class: 'text-muted mb-2' }, title));
    if (current) {
      const names = current.users.map(function (u) {
        return u.name;
      }).concat(current.teamgroups.map(function (g) {
        return 'group ' + g.name;
      }));
      box.append(make('div', { class: 'rp-now' }, 'Owner: ' + (current.owner || '?') + '. Can edit: ' + (baseNames[current.base] || 'the owner and the admins') + (names.length ? ', and ' + names.join(', ') : '') + '.'));
    }
    const mode = make('select', { class: 'form-control form-control-sm', 'aria-label': 'What to do' });
    [['add', 'Add these people'], ['remove', 'Take these people away'], ['replace', 'Only these people (the owner always can)']].forEach(function (o) {
      mode.append(make('option', { value: o[0] }, o[1]));
    });
    const modeRow = make('div', { class: 'rp-row' });
    modeRow.append(mode);
    const groupsBox = make('div', { class: 'rp-list' });
    const usersBox = make('div', { class: 'rp-list' });
    const filter = make('input', { type: 'text', class: 'form-control form-control-sm mb-2', placeholder: 'Search a person', 'aria-label': 'Search a person' });
    const base = make('select', { class: 'form-control form-control-sm', 'aria-label': 'Who can edit as a whole' });
    [['', 'Keep as it is'], ['owner', 'Only the owner can edit'], ['owner_admins', 'The owner and the admins can edit'], ['team', 'All the users of the team can edit']].forEach(function (o) {
      base.append(make('option', { value: o[0] }, o[1]));
    });
    // my own groups: made here by anybody, seen only by me and by their members
    const manage = make('div', { class: 'mb-3 small' });
    const again = function () {
      overlay.remove();
      openBox(ids, title, current, done);
    };
    const newGroup = make('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm mr-2' }, 'New group...');
    newGroup.addEventListener('click', function () {
      editGroup(overlay, null, again);
    });
    manage.append(newGroup);
    call({ action: 'my_groups' }).then(function (data) {
      (data.groups || []).forEach(function (g) {
        const b = make('button', { type: 'button', class: 'btn btn-link btn-sm p-0 mr-3' }, 'Edit "' + g.name + '"');
        b.addEventListener('click', function () {
          editGroup(overlay, g, again);
        });
        manage.append(b);
      });
    });
    const message = make('div', { class: 'rp-msg' });
    const apply = make('button', { type: 'button', class: 'btn btn-primary mr-2' }, 'Apply to ' + ids.length + (ids.length === 1 ? ' entry' : ' entries'));
    const cancel = make('button', { type: 'button', class: 'btn btn-secondary' }, 'Close');
    box.append(modeRow, make('strong', {}, 'User groups'), groupsBox, manage, make('strong', {}, 'People'), filter, usersBox, make('strong', {}, 'Everyone in the team'), base, make('div', { class: 'mt-3' }), apply, cancel, message);
    document.body.append(overlay);
    cancel.addEventListener('click', function () {
      overlay.remove();
    });
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) {
        overlay.remove();
      }
    });
    const checks = { users: [], teamgroups: [] };
    loadPeople().then(function (list) {
      list.groups.forEach(function (g) {
        const l = make('label');
        const cb = make('input', { type: 'checkbox', class: 'mr-2' });
        l.append(cb, g.name + ' (' + g.members + ')' + (g.personal ? (g.mine ? ' - my group' : ' - private group') : ''));
        groupsBox.append(l);
        checks.teamgroups.push({ id: g.id, cb: cb });
      });
      if (!list.groups.length) {
        groupsBox.append(make('span', { class: 'text-muted' }, 'No groups yet. Make one with "New group..." below.'));
      }
      list.users.forEach(function (u) {
        const l = make('label');
        const cb = make('input', { type: 'checkbox', class: 'mr-2' });
        l.append(cb, u.name);
        usersBox.append(l);
        checks.users.push({ id: u.id, cb: cb, label: l, name: u.name.toLowerCase() });
      });
    });
    filter.addEventListener('input', function () {
      const q = filter.value.trim().toLowerCase();
      checks.users.forEach(function (u) {
        u.label.hidden = q !== '' && u.name.indexOf(q) < 0;
      });
    });
    apply.addEventListener('click', function () {
      const body = {
        action: 'set_editors',
        ids: ids,
        mode: mode.value,
        base: base.value,
        users: checks.users.filter(function (u) {
          return u.cb.checked;
        }).map(function (u) {
          return u.id;
        }),
        teamgroups: checks.teamgroups.filter(function (g) {
          return g.cb.checked;
        }).map(function (g) {
          return g.id;
        }),
      };
      apply.disabled = true;
      message.textContent = 'Saving...';
      call(body).then(function (data) {
        apply.disabled = false;
        if (data.error) {
          message.className = 'rp-msg text-danger';
          message.textContent = data.message ? data.error + ' ' + data.message : data.error;
          return;
        }
        message.className = 'rp-msg text-success';
        message.textContent = data.changed + ' changed, ' + data.unchanged + ' already like that' + (data.skipped.length ? ', ' + data.skipped.length + ' skipped: ' + data.skipped.slice(0, 3).map(function (s) {
          return s.title + ' (' + s.why + ')';
        }).join('; ') + (data.skipped.length > 3 ? '...' : '') : '') + '.';
        if (done) {
          done();
        }
      }).catch(function () {
        apply.disabled = false;
        message.className = 'rp-msg text-danger';
        message.textContent = 'The server did not answer.';
      });
    });
  };

  // ---- list: the entries whose box is ticked
  const idOfRow = function (tr) {
    const a = tr.querySelector('a[href*="mode=view"]');
    const m = a ? /[?&]id=(\d+)/.exec(a.getAttribute('href')) : null;
    return m ? parseInt(m[1], 10) : 0;
  };
  const selectedIds = function () {
    const ids = [];
    document.querySelectorAll('tbody tr').forEach(function (tr) {
      const cb = tr.querySelector('td.expandable-select-cell input[type=checkbox]');
      const id = idOfRow(tr);
      if (cb && cb.checked && id) {
        ids.push(id);
      }
    });
    return ids;
  };
  // the list has an "Actions on selected" menu (Assign owner, Archive ...): "Who can edit..." goes right after "Assign owner"
  const mountList = function () {
    document.querySelectorAll('.columns-panel').forEach(function (panel) {
      if (panel.querySelector('[data-rp]')) {
        return;
      }
      const owner = Array.from(panel.children).find(function (b) {
        return b.tagName === 'BUTTON' && b.textContent.trim() === 'Assign owner';
      });
      if (!owner) {
        return;
      }
      const item = make('button', { type: 'button', class: 'btn btn-transparent btn-sm text-left', style: 'width: 100%;', 'data-rp': '1', title: 'Choose who can edit the selected entries' }, 'Who can edit...');
      item.addEventListener('click', function () {
        const ids = selectedIds();
        if (!ids.length) {
          return;
        }
        openBox(ids, 'The selected entries keep their owner. Only entries you own can be changed (admins: all).', null, null);
      });
      owner.after(item);
    });
  };

  // ---- entry page
  const params = new URLSearchParams(window.location.search);
  const entryId = parseInt(params.get('id'), 10);
  const mountEntry = function () {
    if (!(entryId > 0) || ['view', 'edit'].indexOf(params.get('mode')) < 0 || document.getElementById('rpEntryButton')) {
      return;
    }
    call({ action: 'current', id: entryId }).then(function (current) {
      if (!current || current.error || !current.can_change || document.getElementById('rpEntryButton')) {
        return;
      }
      const button = make('button', { type: 'button', id: 'rpEntryButton', class: 'btn btn-secondary btn-sm ml-2', title: 'Choose who can edit this entry' }, 'Who can edit');
      button.insertBefore(make('i', { class: 'fas fa-user-pen mr-1', 'aria-hidden': 'true' }), button.firstChild);
      button.addEventListener('click', function () {
        call({ action: 'current', id: entryId }).then(function (now) {
          openBox([entryId], 'This entry is owned by ' + (now.owner || 'someone') + ' and stays theirs.', now, null);
        });
      });
      const target = document.getElementById('entityToolbar') || document.querySelector('h1, h2, .page-title');
      if (target) {
        target.append(button);
      }
    });
  };

  const start = function () {
    mountList();
    mountEntry();
    // the menu is drawn when it is opened: look again whenever the page changes
    let pending = false;
    new MutationObserver(function () {
      if (!pending) {
        pending = true;
        setTimeout(function () {
          pending = false;
          mountList();
        }, 100);
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
