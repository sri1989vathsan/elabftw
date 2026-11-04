/**
 * "Add from an order": the lines of an order (the name, the vendor, the link, the catalog number, the clone, the sequence of a primer...) are
 * read into a short table with a tick each; the other columns of an entry are in a window that opens for a row. The ticked rows become
 * entries of the modules of the database, in My entries or in the Database. Opened from the Database page and from the orders page.
 * Exposed as window.OrderToDatabase.open({ orderId }).
 */
(function () {
  'use strict';

  const VENDORS = {
    'thermofisher.com': 'Thermo Fisher Scientific',
    'fishersci.com': 'Thermo Fisher Scientific',
    'cellsignal.com': 'Cell Signaling Technology',
    'abcam.com': 'Abcam',
    'biolegend.com': 'BioLegend',
    'sigmaaldrich.com': 'Sigma-Aldrich',
    'merckmillipore.com': 'Merck',
    'scbt.com': 'Santa Cruz Biotechnology',
    'addgene.org': 'Addgene',
    'idtdna.com': 'IDT',
    'microsynth.com': 'Microsynth',
    'corning.com': 'Corning',
    'bio-rad.com': 'Bio-Rad',
    'rndsystems.com': 'R&D Systems',
    'bdbiosciences.com': 'BD Biosciences',
    'novusbio.com': 'Novus Biologicals',
    'invitrogen.com': 'Thermo Fisher Scientific',
    'neb.com': 'New England Biolabs',
    'sarstedt.com': 'Sarstedt',
    'eppendorf.com': 'Eppendorf',
    'vwr.com': 'VWR',
  };
  const HOSTS = ['Mouse', 'Rabbit', 'Rat', 'Goat', 'Donkey', 'Sheep', 'Hamster', 'Chicken'];

  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  };
  const element = function (tag, className, text, style) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    if (style) {
      node.setAttribute('style', style);
    }
    return node;
  };

  // ---- reading an order
  function linesOf(html) {
    const prepared = String(html || '').replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n');
    const doc = new DOMParser().parseFromString(prepared, 'text/html');
    doc.querySelectorAll('a[href]').forEach(function (a) {
      a.replaceWith(doc.createTextNode(a.getAttribute('href')));
    });
    return (doc.body.textContent || '').split(/\n+/).map(function (l) {
      return l.trim();
    }).filter(Boolean);
  }

  function vendorOfLink(link) {
    try {
      const host = new URL(link).hostname.replace(/^www\./, '');
      const known = Object.keys(VENDORS).find(function (domain) {
        return host === domain || host.endsWith('.' + domain);
      });
      return known ? VENDORS[known] : '';
    } catch (error) {
      return '';
    }
  }

  // the catalog number a vendor puts in the address of a product
  function catalogOfLink(link) {
    const patterns = [/abcam\.com\/.*?\b(ab\d{3,7})\b/i, /thermofisher\.com\/.*\/([A-Za-z0-9-]{4,})\/?(?:\?.*)?$/i, /sigmaaldrich\.com\/.*\/product\/[^/]+\/([A-Za-z0-9-]+)/i, /cellsignal\.com\/products\/.*?\/(\d{3,6})(?:\?|$)/i, /biolegend\.com\/.*?\/(\d{5,7})(?:\?|$)/i, /corning\.com\/.*\/([A-Za-z0-9-]{4,})\.html/i];
    for (const pattern of patterns) {
      const found = pattern.exec(link);
      if (found) {
        return found[1];
      }
    }
    return '';
  }

  // a vendor typed with a slip ("Simga") is put right when the link says which vendor it is
  function distance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) {
      d[i] = [i];
    }
    for (let j = 1; j <= b.length; j++) {
      d[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  function fixVendor(typed, link) {
    const known = vendorOfLink(link);
    if (typed === '' || known === '') {
      return typed || known;
    }
    const word = typed.toLowerCase().replace(/[^a-z0-9]/g, '');
    const near = known.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).some(function (token) {
      return word.length >= 4 && distance(word, token) <= 2;
    });
    return near ? known : typed;
  }

  function guessModule(row) {
    if (row.sequence) {
      return 'Primers';
    }
    if (/\bplasmid\b/i.test(row.name)) {
      return 'Plasmids';
    }
    if (/antibod|\banti[- ]|\bmAb\b|monoclonal|polyclonal|\bIgG\b|streptavidin/i.test(row.name)) {
      return 'Antibodies';
    }
    if (/\b(tubes?|tips?|plates?|flasks?|dish(es)?|pipettes?|gloves?|filters?|falcon|eppendorf|syringes?|needles?|slides?|coverslips?)\b/i.test(row.name)) {
      return 'Consumables';
    }
    return 'Reagents';
  }

  function parseOrder(order) {
    const titleParts = String(order.title || '').split(';').map(function (p) {
      return p.trim();
    });
    const base = { name: titleParts[0] || '', vendor: titleParts[1] || '', link: '', catalog: '', clone: '', host: '', sequence: '' };
    const keyed = {};
    const primers = [];
    linesOf(order.notes).forEach(function (line) {
      const primer = /^(.*?):\s*5'?\s*-?\s*([ACGTUNacgtun\s]{8,}?)\s*-?\s*3'?/.exec(line);
      if (primer) {
        primers.push({ name: primer[1].trim(), sequence: primer[2].replace(/\s+/g, '').toUpperCase() });
        return;
      }
      const field = /^(link|url|clone|catalog(?: number)?|amount|vendor|supplier|host|sequence|target)\s*:\s*(.+)$/i.exec(line);
      if (field) {
        keyed[field[1].toLowerCase().replace(/ number$/, '')] = field[2].trim();
      }
    });
    const rows = [];
    const make = function (extra) {
      const row = Object.assign({}, base, extra);
      row.link = row.link || keyed.link || keyed.url || '';
      if (!row.link) {
        const found = /https?:\/\/\S+/.exec(String(order.notes || ''));
        row.link = found ? found[0].replace(/["'<>)]+$/, '') : '';
      }
      row.vendor = fixVendor(row.vendor || keyed.vendor || keyed.supplier || '', row.link);
      row.catalog = row.catalog || keyed.catalog || catalogOfLink(row.link);
      row.clone = row.clone || keyed.clone || ((/\bclone\s+([A-Za-z0-9-]+)/i.exec(row.name) || [])[1] || '');
      const hostFound = new RegExp('(?<!anti[- ])\\b(' + HOSTS.join('|') + ')\\b(?=[^,;]*\\b(?:anti|mAb|monoclonal|polyclonal|IgG|antibody)\\b)', 'i').exec(row.name);
      row.host = row.host || keyed.host || (hostFound ? hostFound[1][0].toUpperCase() + hostFound[1].slice(1).toLowerCase() : '');
      row.moduleTitle = guessModule(row);
      row.fields = null;
      row.ticked = row.name.trim() !== '';
      rows.push(row);
    };
    if (primers.length > 0) {
      primers.forEach(function (p) {
        make({ name: p.name, sequence: p.sequence });
      });
    } else {
      make({});
    }
    return rows;
  }

  // the value that goes in each field of a module, from what the line said
  function defaultsFor(module, row) {
    const values = {};
    (module.fields || []).forEach(function (f) {
      let value = '';
      if (/^(supplier|vendor)/i.test(f.name)) {
        value = row.vendor;
      } else if (/^(link|url|website)/i.test(f.name)) {
        value = row.link;
      } else if (/^catalog/i.test(f.name)) {
        value = row.catalog;
      } else if (/^clone/i.test(f.name)) {
        value = row.clone;
      } else if (/^host/i.test(f.name)) {
        value = row.host;
      } else if (/^sequence/i.test(f.name)) {
        value = row.sequence;
      }
      if (f.type === 'select' && value !== '' && (f.options || []).indexOf(value) === -1) {
        value = '';
      }
      values[f.name] = value;
    });
    return values;
  }

  // ---- the window
  function open(options) {
    const settings = options || {};
    const back = element('div', '', '', 'position:fixed;inset:0;z-index:1055;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:2rem 1rem');
    const box = element('div', '', '', 'background:var(--bg,#fff);color:inherit;border-radius:8px;max-width:980px;width:100%;padding:1rem 1.25rem;box-shadow:0 8px 30px rgba(0,0,0,.3)');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    back.append(box);
    document.body.append(back);
    const close = function () {
      back.remove();
    };
    back.addEventListener('mousedown', function (event) {
      if (event.target === back) {
        close();
      }
    });
    box.append(element('h5', '', 'Add from an order'));
    const search = element('input', 'form-control form-control-sm mb-1');
    search.type = 'search';
    search.placeholder = 'Search an order by number, title, vendor or status';
    search.setAttribute('aria-label', 'Search orders');
    // my orders or everyone's, and the order of the list: the newest first or the oldest first
    let mineOnly = true;
    let newestFirst = true;
    try {
      mineOnly = window.localStorage.getItem('orderToDatabaseMine') !== '0';
    } catch (error) {
      mineOnly = true;
    }
    const filters = element('div', 'd-flex flex-wrap align-items-center mb-1', '', 'gap:.5rem');
    const scope = element('div', 'btn-group btn-group-sm');
    const scopeButtons = [['My orders', true], ['All orders', false]].map(function (item) {
      const b = element('button', 'btn btn-outline-secondary', item[0]);
      b.type = 'button';
      b.addEventListener('click', function () {
        mineOnly = item[1];
        try {
          window.localStorage.setItem('orderToDatabaseMine', mineOnly ? '1' : '0');
        } catch (error) {
          // not remembered
        }
        syncScope();
        if (typeof refill === 'function') {
          refill();
        }
      });
      scope.append(b);
      return b;
    });
    const syncScope = function () {
      scopeButtons[0].classList.toggle('active', mineOnly);
      scopeButtons[1].classList.toggle('active', !mineOnly);
    };
    syncScope();
    const sorter = element('select', 'form-control form-control-sm w-auto');
    sorter.setAttribute('aria-label', 'Sort the orders');
    [['new', 'Newest first'], ['old', 'Oldest first']].forEach(function (o) {
      const option = element('option', '', o[1]);
      option.value = o[0];
      sorter.append(option);
    });
    sorter.addEventListener('change', function () {
      newestFirst = sorter.value === 'new';
      if (typeof refill === 'function') {
        refill();
      }
    });
    let refill = null;
    let myId = 0;
    filters.append(scope, sorter);
    const pick = element('select', 'form-control form-control-sm mb-2');
    pick.setAttribute('aria-label', 'Order');
    const info = element('p', 'small text-muted mb-2', 'Loading the orders...');
    const tableBox = element('div');
    const message = element('p', 'small mb-2');
    const buttons = element('div', 'd-flex flex-wrap justify-content-end mt-2', '', 'gap:.5rem');
    box.append(filters, search, pick, info, tableBox, message, buttons);

    let modules = [];
    let rows = [];
    const moduleByTitle = function (title) {
      return modules.find(function (m) {
        return m.title === title;
      }) || modules[0];
    };

    const detail = function (row) {
      const module = moduleByTitle(row.moduleTitle);
      if (!row.fields) {
        row.fields = defaultsFor(module, row);
      }
      const layer = element('div', '', '', 'position:fixed;inset:0;z-index:1060;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:3rem 1rem');
      const card = element('div', '', '', 'background:var(--bg,#fff);border-radius:8px;max-width:560px;width:100%;padding:1rem 1.25rem;box-shadow:0 8px 30px rgba(0,0,0,.3)');
      layer.append(card);
      card.append(element('h6', '', row.name || 'New entry'), element('p', 'small text-muted', 'All the columns of ' + module.title + '. What the order said is filled in.'));
      const inputs = {};
      (module.fields || []).forEach(function (f) {
        const label = element('label', 'd-block mb-2');
        label.append(element('span', 'd-block small text-muted', f.name));
        let input;
        if (f.type === 'select') {
          input = element('select', 'form-control form-control-sm');
          const blank = element('option', '', '');
          blank.value = '';
          input.append(blank);
          (f.options || []).forEach(function (o) {
            const option = element('option', '', o);
            option.value = o;
            input.append(option);
          });
        } else {
          input = element('input', 'form-control form-control-sm');
          input.type = f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text');
        }
        input.value = row.fields[f.name] || '';
        inputs[f.name] = input;
        label.append(input);
        card.append(label);
      });
      const done = element('button', 'btn btn-primary btn-sm', 'Done');
      done.type = 'button';
      done.addEventListener('click', function () {
        Object.keys(inputs).forEach(function (name) {
          row.fields[name] = inputs[name].value;
        });
        layer.remove();
        draw();
      });
      card.append(element('div', 'text-right', '', '').appendChild(done) && done.parentNode);
      document.body.append(layer);
    };

    const draw = function () {
      tableBox.replaceChildren();
      if (rows.length === 0) {
        tableBox.append(element('p', 'text-muted', 'Choose an order.'));
        buttons.replaceChildren();
        return;
      }
      const table = element('table', 'table table-sm mb-0', '', 'table-layout:fixed;width:100%');
      const head = element('tr');
      [['', '5%'], ['Name', '38%'], ['Vendor', '22%'], ['Module', '18%'], ['', '17%']].forEach(function (h) {
        const th = element('th', '', h[0]);
        th.style.width = h[1];
        head.append(th);
      });
      const thead = element('thead');
      thead.append(head);
      const all = element('input');
      all.type = 'checkbox';
      all.checked = rows.every(function (r) {
        return r.ticked;
      });
      all.setAttribute('aria-label', 'Select all');
      all.addEventListener('change', function () {
        rows.forEach(function (r) {
          r.ticked = all.checked && r.name.trim() !== '';
        });
        draw();
      });
      head.firstChild.append(all);
      const body = element('tbody');
      rows.forEach(function (row) {
        const tr = element('tr', '', '', row.ticked ? '' : 'opacity:.5');
        const tick = element('input');
        tick.type = 'checkbox';
        tick.checked = row.ticked;
        tick.setAttribute('aria-label', 'Add this row');
        tick.addEventListener('change', function () {
          row.ticked = tick.checked;
          draw();
        });
        const c0 = element('td');
        c0.append(tick);
        const name = element('input', 'form-control form-control-sm');
        name.type = 'text';
        name.value = row.name;
        name.addEventListener('input', function () {
          row.name = name.value;
        });
        const c1 = element('td');
        c1.append(name);
        const vendor = element('input', 'form-control form-control-sm');
        vendor.type = 'text';
        vendor.value = row.vendor;
        vendor.addEventListener('input', function () {
          row.vendor = vendor.value;
          if (row.fields) {
            Object.keys(row.fields).forEach(function (k) {
              if (/^(supplier|vendor)/i.test(k)) {
                row.fields[k] = row.vendor;
              }
            });
          }
        });
        const c2 = element('td');
        c2.append(vendor);
        const mod = element('select', 'form-control form-control-sm');
        modules.forEach(function (m) {
          const option = element('option', '', m.title);
          option.value = m.title;
          mod.append(option);
        });
        mod.value = row.moduleTitle;
        mod.addEventListener('change', function () {
          row.moduleTitle = mod.value;
          row.fields = null;
        });
        const c3 = element('td');
        c3.append(mod);
        const more = element('button', 'btn btn-secondary btn-sm', 'Details...');
        more.type = 'button';
        more.title = 'Catalog number, clone, link and the other columns';
        more.addEventListener('click', function () {
          detail(row);
        });
        const hint = element('div', 'small text-muted', [row.catalog ? 'cat. ' + row.catalog : '', row.link ? 'link' : 'no link'].filter(Boolean).join(' · '));
        const c4 = element('td');
        c4.append(more, hint);
        tr.append(c0, c1, c2, c3, c4);
        body.append(tr);
      });
      table.append(thead, body);
      tableBox.append(table);
      const ticked = rows.filter(function (r) {
        return r.ticked && r.name.trim() !== '';
      });
      info.textContent = rows.length + (rows.length === 1 ? ' line' : ' lines') + ' read, ' + ticked.length + ' ticked. Untick a row to leave it out. Details... shows the other columns.';
      buttons.replaceChildren();
      const cancel = element('button', 'btn btn-secondary btn-sm', 'Close');
      cancel.type = 'button';
      cancel.addEventListener('click', close);
      const mine = element('button', 'btn btn-secondary btn-sm', 'Add ' + ticked.length + ' to My entries');
      const lab = element('button', 'btn btn-primary btn-sm', 'Add ' + ticked.length + ' to the Database');
      [mine, lab].forEach(function (b) {
        b.type = 'button';
        b.disabled = ticked.length === 0;
      });
      mine.addEventListener('click', function () {
        add(ticked, 'personal');
      });
      lab.addEventListener('click', function () {
        add(ticked, 'both');
      });
      buttons.append(cancel, mine, lab);
    };

    const add = async function (ticked, register) {
      message.className = 'small mb-2';
      message.textContent = 'Adding...';
      const groups = {};
      ticked.forEach(function (row) {
        const module = moduleByTitle(row.moduleTitle);
        if (!row.fields) {
          row.fields = defaultsFor(module, row);
        }
        (groups[module.id] = groups[module.id] || { module: module, rows: [] }).rows.push(row);
      });
      let made = 0;
      const problems = [];
      try {
        for (const key of Object.keys(groups)) {
          const group = groups[key];
          const response = await fetch('registry-transfer.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
            body: JSON.stringify({
              category: group.module.id,
              register: register,
              rows: group.rows.map(function (r) {
                const fields = {};
                Object.keys(r.fields).forEach(function (k) {
                  if (r.fields[k] !== '') {
                    fields[k] = r.fields[k];
                  }
                });
                return { title: r.name.trim(), fields: fields };
              }),
            }),
          });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error || 'The entries could not be added.');
          }
          made += body.created || 0;
          (body.skipped || []).forEach(function (s) {
            problems.push(group.rows[Number(s.row) - 1] ? group.rows[Number(s.row) - 1].name + ': ' + s.reason : s.reason);
          });
        }
        message.className = problems.length > 0 ? 'small mb-2 text-danger' : 'small mb-2 text-success';
        message.textContent = made + (made === 1 ? ' entry' : ' entries') + ' added.' + (problems.length > 0 ? ' Not added: ' + problems.join(' ') : '');
        if (made > 0 && /registry\.php/.test(window.location.pathname)) {
          window.setTimeout(function () {
            window.location.reload();
          }, problems.length > 0 ? 3500 : 900);
        }
      } catch (error) {
        message.className = 'small mb-2 text-danger';
        message.textContent = error.message;
      }
    };

    const load = async function (orderId) {
      const order = await (await fetch('api/v2/orders/' + orderId, { credentials: 'same-origin' })).json();
      rows = parseOrder(order);
      draw();
    };

    Promise.all([
      fetch('registry-modules.php', { credentials: 'same-origin' }).then(function (r) {
        return r.json();
      }),
      fetch('api/v2/orders?limit=200', { credentials: 'same-origin' }).then(function (r) {
        return r.json();
      }),
      fetch('registry-transfer.php?users=1', { credentials: 'same-origin' }).then(function (r) {
        return r.json();
      }).catch(function () {
        return {};
      }),
    ]).then(function (loaded) {
      myId = Number(loaded[2] && loaded[2].me) || 0;
      modules = loaded[0].modules || [];
      const orders = (Array.isArray(loaded[1]) ? loaded[1] : []).filter(function (o) {
        return !o.archived;
      });
      // the list of orders, narrowed by what is typed above it
      const fill = function () {
        const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
        const dateOf = function (o) {
          return String(o.order_date || o.created_at || '');
        };
        const shown = orders.filter(function (o) {
          if (mineOnly && myId > 0 && Number(o.userid) !== myId) {
            return false;
          }
          const text = ('#' + o.id + ' ' + o.title + ' ' + o.status + ' ' + (o.order_number || '')).toLowerCase();
          return words.every(function (w) {
            return text.indexOf(w) !== -1;
          });
        });
        shown.sort(function (a, b) {
          return newestFirst ? dateOf(b).localeCompare(dateOf(a)) : dateOf(a).localeCompare(dateOf(b));
        });
        const current = pick.value;
        pick.replaceChildren();
        const blank = element('option', '', shown.length === 0 ? 'No order matches' : 'Choose an order (' + shown.length + ')');
        blank.value = '';
        pick.append(blank);
        shown.forEach(function (o) {
          const option = element('option', '', '#' + o.id + ' ' + o.title + ' · ' + o.status + ' · ' + dateOf(o).slice(0, 10));
          option.value = String(o.id);
          pick.append(option);
        });
        if (shown.some(function (o) {
          return String(o.id) === current;
        })) {
          pick.value = current;
        }
      };
      search.addEventListener('input', fill);
      refill = fill;
      fill();
      info.textContent = orders.length === 0 ? 'There are no orders.' : 'Choose an order to read its lines.';
      pick.addEventListener('change', function () {
        if (pick.value === '') {
          rows = [];
          draw();
          return;
        }
        load(pick.value).catch(function (error) {
          message.className = 'small mb-2 text-danger';
          message.textContent = error.message;
        });
      });
      const wanted = settings.orderId || Number(new URLSearchParams(window.location.search).get('order')) || 0;
      if (wanted > 0 && orders.some(function (o) {
        return o.id === wanted;
      })) {
        // an order of someone else that was opened on purpose is shown even in "My orders"
        const target = orders.find(function (o) {
          return o.id === wanted;
        });
        if (target && mineOnly && myId > 0 && Number(target.userid) !== myId) {
          mineOnly = false;
          syncScope();
          refill();
        }
        pick.value = String(wanted);
        load(wanted).catch(function () {});
      } else {
        draw();
      }
    }).catch(function (error) {
      info.textContent = 'The orders could not be loaded: ' + error.message;
    });
  }

  window.OrderToDatabase = { open: open, parse: parseOrder };

  // on the orders page: a button under the title; an order opened there (?order=) is the one that is read
  if (/orders\.php$/.test(window.location.pathname)) {
    const root = document.getElementById('ordersRoot');
    if (root && !document.getElementById('orderToDatabaseButton')) {
      const button = element('button', 'btn btn-secondary btn-sm mb-2', 'Add an order to the Database');
      button.type = 'button';
      button.id = 'orderToDatabaseButton';
      button.title = 'Read the lines of an order and add them as entries of the Database';
      button.addEventListener('click', function () {
        open({});
      });
      root.parentNode.insertBefore(button, root);
    }
  }
})();
