/**
 * Admin panel, Database tab: the three parts (modules, transfer of ownership, rules of a module) are shown one at a time; the last one shown
 * is remembered.
 */
(function () {
  'use strict';
  const bar = document.getElementById('databaseSubtabs');
  if (!bar) {
    return;
  }
  const show = function (name) {
    document.querySelectorAll('[data-dbpane]').forEach(function (pane) {
      pane.hidden = pane.dataset.dbpane !== name;
    });
    bar.querySelectorAll('[data-dbsub]').forEach(function (button) {
      button.className = 'btn btn-sm mr-1 ' + (button.dataset.dbsub === name ? 'btn-primary' : 'btn-secondary');
    });
    try {
      localStorage.setItem('databaseSubtab', name);
    } catch (error) {
      // nothing to remember
    }
  };
  bar.addEventListener('click', function (event) {
    const button = event.target.closest('[data-dbsub]');
    if (button) {
      show(button.dataset.dbsub);
    }
  });
  let last = 'modules';
  try {
    last = localStorage.getItem('databaseSubtab') || 'modules';
  } catch (error) {
    last = 'modules';
  }
  show(['modules', 'owners', 'rules'].indexOf(last) >= 0 ? last : 'modules');
})();

/**
 * Admins, Admin panel, Database tab: the people of LabCollector are matched to the users of eLabFTW from two lists that fill themselves (the same person can
 * have another name or e-mail address in each tool). The match is by e-mail, then by name, and it can be corrected by hand. What is saved is used by
 * the import (owner from the file): each entry goes to the user matched to its LabCollector owner. "Wild Card" is not a person: its entries are
 * open for all the users. Talks to registry-transfer.php.
 */
(function () {
  'use strict';
  const anchor = document.getElementById('databaseOwnersApp');
  if (!anchor) {
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
  // a line of a list: a name and an e-mail address, in any order ("Name <mail>", "Name, mail", "mail<TAB>Name", or just a name)
  const parseList = function (text) {
    const people = [];
    text.split(/\r?\n/).forEach(function (line) {
      const found = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(line);
      const email = found ? found[0].toLowerCase() : '';
      const name = line.replace(found ? found[0] : '', ' ').replace(/[<>"\t;,|]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (name === '' && email === '') {
        return;
      }
      // a heading of a table
      if (email === '' && /^(name|names|user|users|e-?mail)\b/i.test(name)) {
        return;
      }
      people.push({ name: name, email: email });
    });
    return people;
  };
  const tokens = function (name) {
    return name.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^\p{L}]+/u).filter(Boolean).sort();
  };
  const isWildCard = function (person) {
    return /^wild\s*card$/i.test(person.name);
  };
  // the user of eLabFTW for a person of LabCollector: by e-mail, then by name, then by the first and the last name
  const match = function (person, users) {
    if (person.email !== '') {
      const byMail = users.find(function (u) {
        return u.email !== '' && u.email === person.email;
      });
      if (byMail) {
        return { user: byMail, how: 'e-mail' };
      }
    }
    const mine = tokens(person.name);
    if (mine.length > 0) {
      const same = users.find(function (u) {
        return tokens(u.name).join(' ') === mine.join(' ');
      });
      if (same) {
        return { user: same, how: 'name' };
      }
      if (mine.length >= 2) {
        const similar = users.find(function (u) {
          const other = tokens(u.name);
          return other.length >= 2 && (other.every(function (t) { return mine.indexOf(t) >= 0; }) || mine.every(function (t) { return other.indexOf(t) >= 0; }));
        });
        if (similar) {
          return { user: similar, how: 'similar name: check it' };
        }
      }
    }
    return null;
  };
  const holder = element('section', 'mt-4 mb-4');
  anchor.append(holder);
  holder.append(element('h4', '', 'People of LabCollector and users of eLabFTW'));
  holder.append(element('p', 'small text-muted', 'Both lists fill themselves (the users of this eLabFTW, and the people found in the entries) and are matched by e-mail, then by name. Change a list or a match by hand if it is wrong, then save. "Change the owners of the entries now" saves the matches and, after you confirm, gives the existing entries to the matched users; the import with "owner from the file" uses the same matches.'));
  const grid = element('div', 'row');
  const column = function (title, hint) {
    const cell = element('div', 'col-md-6 mb-2');
    cell.append(element('label', 'font-weight-bold', title));
    const area = element('textarea', 'form-control form-control-sm');
    area.rows = 8;
    area.placeholder = hint;
    cell.append(area);
    grid.append(cell);
    return area;
  };
  const elabArea = column('Users of eLabFTW', 'Name <e-mail>, one per line');
  const lcArea = column('People of LabCollector', 'Name <e-mail>, one per line');
  holder.append(grid);
  const message = element('p', 'small mb-2');
  const tools = element('div', 'mb-2');
  const fill = element('button', 'btn btn-outline-secondary btn-sm mr-2', 'Detect the people again');
  fill.type = 'button';
  const run = element('button', 'btn btn-secondary btn-sm mr-2', 'Match the names');
  run.type = 'button';
  tools.append(fill, run);
  const result = element('div', 'mt-2');
  holder.append(tools, message, result);
  const say = function (text, failed) {
    message.className = 'small mb-2 ' + (failed ? 'text-danger' : 'text-success');
    message.textContent = text;
  };
  const textOf = function (list) {
    return list.map(function (p) {
      return p.name + (p.email ? ' <' + p.email + '>' : '');
    }).join('\n');
  };

  // both lists are filled by themselves: the users of this eLabFTW, and the people found in the entries (their "LabCollector owner"); the
  // matches that were saved before are chosen again. All of it can be changed by hand
  let saved = [];
  let detected = null;
  const autofill = function () {
    elabArea.value = textOf(detected.users.map(function (u) {
      return { name: u.name, email: String(u.email || '').toLowerCase() };
    }));
    const known = detected.people.slice();
    saved.forEach(function (p) {
      const there = known.some(function (k) {
        return (k.email !== '' && k.email === p.lc_email) || (k.email === '' && tokens(k.name).join(' ') === tokens(p.lc_name).join(' '));
      });
      if (!there) {
        known.push({ name: p.lc_name, email: p.lc_email });
      }
    });
    lcArea.value = textOf(known);
  };
  fetch('registry-transfer.php?owner_map=1', { credentials: 'same-origin' }).then(function (response) {
    return response.json();
  }).then(function (body) {
    if (!body.users) {
      return;
    }
    saved = body.pairs || [];
    detected = { users: body.users, people: body.people || [] };
    autofill();
    fill.addEventListener('click', function () {
      autofill();
      run.click();
    });
    run.click();
    if (saved.length > 0) {
      say(saved.length + ' matches are saved and chosen again below.', false);
    }
  }).catch(function () {
    holder.hidden = true;
  });

  run.addEventListener('click', function () {
    const users = parseList(elabArea.value);
    const people = parseList(lcArea.value);
    result.textContent = '';
    if (users.length === 0 || people.length === 0) {
      say('Both lists are empty: nothing was found. Paste them.', true);
      return;
    }
    message.textContent = '';
    const table = element('table', 'table table-sm');
    const head = element('tr');
    ['Person of LabCollector', 'User of eLabFTW', 'Matched by'].forEach(function (title) {
      head.append(element('th', '', title));
    });
    table.append(head);
    const rows = [];
    people.forEach(function (person) {
      const row = element('tr');
      row.append(element('td', '', person.name + (person.email ? ' <' + person.email + '>' : '')));
      let found = isWildCard(person) ? { user: null, how: 'a shared account: open for all' } : match(person, users);
      const before = saved.find(function (p) {
        return (person.email !== '' && p.lc_email === person.email) || (p.lc_name !== '' && tokens(p.lc_name).join(' ') === tokens(person.name).join(' '));
      });
      if (before) {
        const chosen = before.elab_name === '*' ? { open: true } : users.find(function (u) {
          return (before.elab_email !== '' && u.email === before.elab_email) || tokens(u.name).join(' ') === tokens(before.elab_name).join(' ');
        });
        if (chosen) {
          found = chosen.open ? { user: null, open: true, how: 'saved' } : { user: chosen, how: 'saved' };
        }
      }
      const select = element('select', 'form-control form-control-sm');
      const none = element('option', '', 'Not matched');
      none.value = '-1';
      const open = element('option', '', 'Open for all the users');
      open.value = 'open';
      select.append(none, open);
      users.forEach(function (u, index) {
        const option = element('option', '', u.name + (u.email ? ' <' + u.email + '>' : ''));
        option.value = String(index);
        select.append(option);
      });
      select.value = found ? (found.open || found.user === null ? 'open' : String(users.indexOf(found.user))) : '-1';
      const how = element('td', 'small ' + (found ? (found.how === 'e-mail' || found.how === 'name' || found.how === 'saved' ? 'text-muted' : 'text-warning') : 'text-danger'), found ? found.how : 'no match: choose a user');
      select.addEventListener('change', function () {
        how.textContent = select.value === '-1' ? 'not matched' : 'chosen';
        how.className = 'small text-muted';
      });
      const cell = element('td');
      cell.append(select);
      row.append(cell, how);
      table.append(row);
      rows.push({ person: person, select: select });
    });
    const post = async function (body) {
      const response = await fetch('registry-transfer.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify(body) });
      const answer = await response.json();
      if (!response.ok) {
        throw new Error(answer.error || 'It did not work.');
      }
      return answer;
    };
    const savePairs = async function () {
      const pairs = rows.filter(function (r) {
        return r.select.value !== '-1';
      }).map(function (r) {
        if (r.select.value === 'open') {
          return { lc_name: r.person.name, lc_email: r.person.email, elab_name: '*', elab_email: '' };
        }
        const user = users[Number(r.select.value)];
        return { lc_name: r.person.name, lc_email: r.person.email, elab_name: user.name, elab_email: user.email };
      });
      const answer = await post({ action: 'save_owner_map', pairs: pairs });
      saved = pairs.map(function (p) {
        return p;
      });
      return answer.saved;
    };
    const save = element('button', 'btn btn-primary btn-sm mr-2', 'Save the matches');
    save.type = 'button';
    const apply = element('button', 'btn btn-outline-primary btn-sm', 'Change the owners of the entries now');
    apply.type = 'button';
    const report = element('div', 'mt-3');
    save.addEventListener('click', async function () {
      save.disabled = true;
      try {
        say((await savePairs()) + ' matches saved. The import with "owner from the file" uses them.', false);
      } catch (error) {
        say(error.message, true);
      }
      save.disabled = false;
    });
    // the matches are saved, then shown what would change; the owners change only when it is confirmed
    apply.addEventListener('click', async function () {
      apply.disabled = true;
      report.textContent = '';
      try {
        await savePairs();
        const plan = await post({ action: 'apply_owner_map', dry_run: true });
        const lines = element('ul', 'small mb-2 list-unstyled');
        const boxes = [];
        const confirm = element('button', 'btn btn-danger btn-sm', '');
        confirm.type = 'button';
        const count = function () {
          const n = boxes.filter(function (b) {
            return b.checked;
          }).length;
          confirm.textContent = 'Apply to the ' + n + ' ticked entries';
          confirm.disabled = n === 0;
        };
        // the entries of a line, by module: all of a module or one by one can be ticked off
        const listed = function (text, items) {
          const line = element('li');
          const details = element('details');
          details.append(element('summary', '', text));
          const modules = {};
          items.forEach(function (item) {
            (modules[item.module || 'No module'] = modules[item.module || 'No module'] || []).push(item);
          });
          Object.keys(modules).forEach(function (name) {
            const group = element('div', 'ml-3 mt-1');
            const all = element('input');
            all.type = 'checkbox';
            all.checked = true;
            const title = element('label', 'font-weight-bold mr-2 mb-0');
            title.append(all, document.createTextNode(' ' + name + ' (' + modules[name].length + ')'));
            group.append(title);
            const mine = [];
            const list = element('div', 'ml-3 text-muted');
            list.style.maxHeight = '12rem';
            list.style.overflow = 'auto';
            modules[name].forEach(function (item) {
              const box = element('input');
              box.type = 'checkbox';
              box.checked = true;
              box.dataset.id = String(item.id);
              box.addEventListener('change', count);
              boxes.push(box);
              mine.push(box);
              const label = element('label', 'd-block mb-0');
              label.append(box, document.createTextNode(' #' + item.id + ' ' + item.title));
              list.append(label);
            });
            all.addEventListener('change', function () {
              mine.forEach(function (box) {
                box.checked = all.checked;
              });
              count();
            });
            group.append(list);
            details.append(group);
          });
          line.append(details);
          lines.append(line);
        };
        plan.moves.forEach(function (move) {
          listed(move.entries + ' entries go to ' + move.user, move.items);
        });
        if (plan.would_open > 0) {
          listed(plan.would_open + ' entries are opened for all the users (Wild Card and the people set to open)', plan.wild_items);
        }
        lines.append(element('li', 'text-muted', plan.already + ' entries already belong to the matched user'));
        const missing = Object.keys(plan.unmatched);
        if (missing.length > 0) {
          lines.append(element('li', 'text-warning', 'Not matched, left as they are: ' + missing.map(function (name) {
            return name + ' (' + plan.unmatched[name] + ')';
          }).join(', ')));
        }
        report.append(element('p', 'small mb-1', 'Open a line to choose: a whole module, or single entries. Everything is ticked at first.'), lines);
        if (plan.would_change + plan.would_open === 0) {
          say('Nothing to change.', false);
        } else {
          confirm.addEventListener('click', async function () {
            confirm.disabled = true;
            try {
              const ids = boxes.filter(function (b) {
                return b.checked;
              }).map(function (b) {
                return Number(b.dataset.id);
              });
              const done = await post({ action: 'apply_owner_map', ids: ids });
              report.textContent = '';
              say(done.changed + ' entries have a new owner, ' + done.opened + ' were opened for all the users.', false);
            } catch (error) {
              say(error.message, true);
              confirm.disabled = false;
            }
          });
          count();
          report.append(confirm);
        }
      } catch (error) {
        say(error.message, true);
      }
      apply.disabled = false;
    });
    result.append(table, save, apply, report);
  });
})();
