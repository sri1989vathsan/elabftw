/**
 * The rules of a module of the database (admins, Modules page): the custom fields of its entries, the columns of its list, and what an
 * entry needs to be registered. Talks to registry-modules.php.
 */
(function () {
  'use strict';
  const root = document.getElementById('moduleRulesApp');
  if (!root) {
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
  const call = async function (payload) {
    const response = await fetch('registry-modules.php', payload ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify(payload) } : { credentials: 'same-origin' });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'The request failed.');
    }
    return body;
  };
  const TYPES = [['text', 'Text'], ['number', 'Number'], ['select', 'Choice list'], ['radio', 'Radio buttons'], ['checkbox', 'Yes / no'], ['date', 'Date'], ['url', 'Link'], ['email', 'E-mail'], ['time', 'Time']];
  const BUILT_IN = [['files', 'Sequence files'], ['quantity', 'Quantity'], ['owner', 'Owner'], ['calc:length', 'Length (from the sequence field)'], ['calc:gc', 'GC % (from the sequence field)']];

  let modules = [];
  let chosen = 0;
  const message = element('p', 'small mb-2');
  const say = function (text, failed) {
    message.className = 'small mb-2 ' + (failed ? 'text-danger' : 'text-success');
    message.textContent = text;
  };

  function move(list, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= list.length) {
      return;
    }
    const item = list.splice(index, 1)[0];
    list.splice(target, 0, item);
  }

  async function load(keep) {
    try {
      modules = (await call()).modules;
    } catch (error) {
      root.textContent = error.message;
      return;
    }
    if (!keep && modules.length > 0) {
      chosen = modules[0].id;
    }
    draw();
  }

  function draw() {
    root.textContent = '';
    const pick = element('select', 'form-control form-control-sm w-auto mb-3');
    modules.forEach(function (module) {
      const option = element('option', '', module.title);
      option.value = String(module.id);
      option.selected = module.id === chosen;
      pick.append(option);
    });
    pick.addEventListener('change', function () {
      chosen = Number(pick.value);
      draw();
    });
    root.append(pick, message);
    const module = modules.find(function (m) {
      return m.id === chosen;
    });
    if (!module) {
      root.append(element('p', 'text-muted', 'There is no module yet.'));
      return;
    }
    // working copies: nothing changes until Save
    const fields = module.fields.map(function (f) {
      return Object.assign({}, f, { options: (f.options || []).slice() });
    });
    const settings = JSON.parse(JSON.stringify(module.settings));
    settings.columns = settings.columns || [];

    const fieldsBox = element('div', 'card card-body mb-3');
    fieldsBox.append(element('h5', '', 'Fields'));
    fieldsBox.append(element('p', 'small text-muted', 'The custom fields of an entry of this module. A required field has to be filled to register an entry in the lab Database.'));
    const fieldsList = element('div');
    fieldsBox.append(fieldsList);
    const columnsBox = element('div', 'card card-body mb-3');
    const rulesBox = element('div', 'card card-body mb-3');

    function drawFields() {
      fieldsList.textContent = '';
      fields.forEach(function (field, index) {
        const row = element('div', 'd-flex flex-wrap align-items-center py-1 border-top');
        const name = element('input', 'form-control form-control-sm mr-2 mb-1');
        name.style.width = '14em';
        name.value = field.name;
        name.placeholder = 'Name of the field';
        name.addEventListener('input', function () {
          // a column that used the old name follows the new one
          settings.columns.forEach(function (c) {
            if (c.key === 'field:' + field.name) {
              c.key = 'field:' + name.value;
            }
          });
          if (settings.sequence_field === field.name) {
            settings.sequence_field = name.value;
          }
          field.name = name.value;
        });
        // when the name is written, the lists of columns and of the sequence field offer the field
        name.addEventListener('change', function () {
          drawColumns();
          drawRules();
        });
        const type = element('select', 'form-control form-control-sm mr-2 mb-1 w-auto');
        TYPES.forEach(function (t) {
          const option = element('option', '', t[1]);
          option.value = t[0];
          option.selected = field.type === t[0];
          type.append(option);
        });
        const options = element('input', 'form-control form-control-sm mr-2 mb-1');
        options.style.width = '16em';
        options.placeholder = 'Choices, separated by commas';
        options.value = (field.options || []).join(', ');
        options.hidden = !(field.type === 'select' || field.type === 'radio');
        options.addEventListener('input', function () {
          field.options = options.value.split(',').map(function (o) {
            return o.trim();
          }).filter(Boolean);
        });
        type.addEventListener('change', function () {
          field.type = type.value;
          options.hidden = !(field.type === 'select' || field.type === 'radio');
          unit.hidden = field.type !== 'number';
        });
        const unit = element('input', 'form-control form-control-sm mr-2 mb-1');
        unit.style.width = '6em';
        unit.placeholder = 'Unit';
        unit.value = field.unit || '';
        unit.hidden = field.type !== 'number';
        unit.addEventListener('input', function () {
          field.unit = unit.value;
        });
        const initial = element('input', 'form-control form-control-sm mr-2 mb-1');
        initial.style.width = '9em';
        initial.placeholder = 'Starts as';
        initial.value = field.value || '';
        initial.addEventListener('input', function () {
          field.value = initial.value;
        });
        const requiredLabel = element('label', 'mr-2 mb-1 small');
        const required = element('input');
        required.type = 'checkbox';
        required.checked = Boolean(field.required);
        required.addEventListener('change', function () {
          field.required = required.checked;
        });
        requiredLabel.append(required, document.createTextNode(' Required'));
        const up = element('button', 'btn btn-outline-secondary btn-sm mr-1 mb-1', '↑');
        const down = element('button', 'btn btn-outline-secondary btn-sm mr-1 mb-1', '↓');
        const remove = element('button', 'btn btn-outline-danger btn-sm mb-1', 'Remove');
        [up, down, remove].forEach(function (b) {
          b.type = 'button';
        });
        up.addEventListener('click', function () {
          move(fields, index, -1);
          drawFields();
        });
        down.addEventListener('click', function () {
          move(fields, index, 1);
          drawFields();
        });
        remove.addEventListener('click', function () {
          fields.splice(index, 1);
          settings.columns = settings.columns.filter(function (c) {
            return c.key !== 'field:' + field.name;
          });
          drawFields();
          drawColumns();
        });
        row.append(name, type, options, unit, initial, requiredLabel, up, down, remove);
        fieldsList.append(row);
      });
      const add = element('button', 'btn btn-outline-primary btn-sm mt-2', 'Add a field');
      add.type = 'button';
      add.addEventListener('click', function () {
        fields.push({ name: '', type: 'text', options: [], required: false, value: '', unit: '' });
        drawFields();
        drawColumns();
      });
      fieldsList.append(add);
      drawRules();
    }

    function drawColumns() {
      columnsBox.textContent = '';
      columnsBox.append(element('h5', '', 'Columns of the list'));
      columnsBox.append(element('p', 'small text-muted', 'The ID and the title are always the first columns. Tick what else the list of this module shows, put it in order and give each column its heading.'));
      const available = BUILT_IN.map(function (b) {
        return { key: b[0], label: b[1] };
      }).concat(fields.filter(function (f) {
        return f.name.trim() !== '';
      }).map(function (f) {
        return { key: 'field:' + f.name, label: f.name };
      }));
      // the ticked ones in their order, then the others
      const ticked = settings.columns.filter(function (c) {
        return available.some(function (a) {
          return a.key === c.key;
        });
      });
      settings.columns = ticked;
      const rows = ticked.map(function (c) {
        return { key: c.key, heading: c.label, on: true };
      }).concat(available.filter(function (a) {
        return !ticked.some(function (c) {
          return c.key === a.key;
        });
      }).map(function (a) {
        return { key: a.key, heading: a.label, on: false };
      }));
      rows.forEach(function (item, index) {
        const row = element('div', 'd-flex align-items-center py-1 border-top');
        const on = element('input', 'mr-2');
        on.type = 'checkbox';
        on.checked = item.on;
        const heading = element('input', 'form-control form-control-sm mr-2');
        heading.style.width = '16em';
        heading.value = item.heading;
        heading.disabled = !item.on;
        const what = element('span', 'small text-muted mr-2', item.key.indexOf('field:') === 0 ? 'field' : 'built in');
        const up = element('button', 'btn btn-outline-secondary btn-sm mr-1', '↑');
        const down = element('button', 'btn btn-outline-secondary btn-sm', '↓');
        up.type = down.type = 'button';
        up.disabled = down.disabled = !item.on;
        const sync = function () {
          settings.columns = rows.filter(function (r) {
            return r.on;
          }).map(function (r) {
            return { key: r.key, label: r.heading };
          });
        };
        on.addEventListener('change', function () {
          item.on = on.checked;
          // ticking puts a column at the end of the ticked ones
          rows.splice(index, 1);
          const lastOn = rows.map(function (r) {
            return r.on;
          }).lastIndexOf(true);
          rows.splice(item.on ? lastOn + 1 : rows.length, 0, item);
          sync();
          drawColumns();
        });
        heading.addEventListener('input', function () {
          item.heading = heading.value;
          sync();
        });
        up.addEventListener('click', function () {
          if (index > 0 && rows[index - 1].on) {
            move(rows, index, -1);
            sync();
            drawColumns();
          }
        });
        down.addEventListener('click', function () {
          if (index + 1 < rows.length && rows[index + 1].on) {
            move(rows, index, 1);
            sync();
            drawColumns();
          }
        });
        row.append(on, heading, what, up, down);
        columnsBox.append(row);
      });
    }

    function drawRules() {
      rulesBox.textContent = '';
      rulesBox.append(element('h5', '', 'Rules'));
      const sequenceLabel = element('label', 'd-block mb-2');
      sequenceLabel.append(element('span', 'd-block small text-muted', 'The field that holds a sequence (for the length and GC columns)'));
      const sequence = element('select', 'form-control form-control-sm w-auto');
      const none = element('option', '', 'None');
      none.value = '';
      sequence.append(none);
      fields.filter(function (f) {
        return f.name.trim() !== '';
      }).forEach(function (f) {
        const option = element('option', '', f.name);
        option.value = f.name;
        option.selected = settings.sequence_field === f.name;
        sequence.append(option);
      });
      sequence.addEventListener('change', function () {
        settings.sequence_field = sequence.value || null;
      });
      sequenceLabel.append(sequence);
      const needFile = element('label', 'd-block mb-2');
      const need = element('input');
      need.type = 'checkbox';
      need.checked = Boolean(settings.requires_sequence_file);
      need.addEventListener('change', function () {
        settings.requires_sequence_file = need.checked;
      });
      needFile.append(need, document.createTextNode(' A sequence file (GenBank, FASTA, SnapGene) is needed to register an entry in the lab Database'));
      rulesBox.append(sequenceLabel, needFile);
    }

    const apply = element('label', 'd-block mb-2');
    const applyBox = element('input');
    applyBox.type = 'checkbox';
    applyBox.checked = true;
    apply.append(applyBox, document.createTextNode(' Add the new fields to the entries of this module that exist'));
    const save = element('button', 'btn btn-primary', 'Save the rules of ' + module.title);
    save.type = 'button';
    save.addEventListener('click', async function () {
      save.disabled = true;
      try {
        const done = await call({ action: 'save', id: module.id, fields: fields, settings: settings, apply_existing: applyBox.checked });
        say('Saved.' + (done.entries_updated ? ' ' + done.entries_updated + ' entries got the new fields.' : ''));
        await load(true);
      } catch (error) {
        say(error.message, true);
        save.disabled = false;
      }
    });
    root.append(fieldsBox, columnsBox, rulesBox, apply, save);
    drawFields();
    drawColumns();
  }

  load(false);
})();
