/**
 * The page of the label formats (admins): the printer, and the sizes of label with their lines. Talks to label-print.php.
 */
(function () {
  'use strict';
  const root = document.getElementById('labelFormatsApp');
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
    const response = await fetch('label-print.php' + (payload ? '' : '?admin=1'), payload ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() }, body: JSON.stringify(payload) } : { credentials: 'same-origin' });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'The request failed.');
    }
    return body;
  };
  const field = function (labelText, input, hint) {
    const wrap = element('label', 'd-block mb-2');
    wrap.append(element('span', 'd-block small text-muted', labelText), input);
    if (hint) {
      wrap.append(element('span', 'd-block small text-muted', hint));
    }
    return wrap;
  };
  const input = function (type, value, extra) {
    const node = element('input', 'form-control form-control-sm');
    node.type = type;
    node.value = value === undefined || value === null ? '' : value;
    Object.assign(node, extra || {});
    return node;
  };

  async function draw() {
    root.textContent = '';
    let data;
    try {
      data = await call();
    } catch (error) {
      root.append(element('p', 'text-danger', error.message));
      return;
    }
    const message = element('p', 'small mb-2');
    const say = function (text, failed) {
      message.className = 'small mb-2 ' + (failed ? 'text-danger' : 'text-success');
      message.textContent = text;
    };

    // the printer
    const printer = element('div', 'card card-body mb-3');
    printer.append(element('h5', '', 'The printer'));
    const host = input('text', data.settings.printer_host, { placeholder: 'for example 192.168.1.50' });
    const port = input('number', data.settings.printer_port, { min: 1, max: 65535 });
    const dpi = element('select', 'form-control form-control-sm');
    [203, 300, 600].forEach(function (value) {
      const option = element('option', '', value + ' dpi' + (value === 300 ? ' (GX430t)' : ''));
      option.value = String(value);
      option.selected = Number(data.settings.dpi) === value;
      dpi.append(option);
    });
    const base = input('text', data.settings.qr_base_url, { placeholder: 'https://elab.example.org (the address people open the site with)' });
    const savePrinter = element('button', 'btn btn-primary btn-sm', 'Save the printer');
    savePrinter.type = 'button';
    savePrinter.addEventListener('click', async function () {
      try {
        await call({ action: 'save_settings', printer_host: host.value, printer_port: Number(port.value), dpi: Number(dpi.value), qr_base_url: base.value });
        say('The printer is saved.');
      } catch (error) {
        say(error.message, true);
      }
    });
    printer.append(field('Address of the printer on the network', host, 'The labels are sent to this address, port 9100 for a Zebra.'), field('Port', port), field('Resolution', dpi), field('Web address for the QR code', base, 'The QR code of a label opens the entry at this address. Empty: the address of this page.'), savePrinter);
    root.append(printer, message);

    // the formats
    root.append(element('h5', '', 'Formats'));
    const list = element('div', 'mb-3');
    data.formats.forEach(function (format) {
      const row = element('div', 'd-flex align-items-center py-1 border-top');
      row.append(element('span', 'mr-2', format.name + ' (' + format.width_mm + ' x ' + format.height_mm + ' mm)' + (Number(format.is_default) === 1 ? ' - default' : '')));
      const edit = element('button', 'btn btn-outline-secondary btn-sm ml-auto', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', function () {
        form(format);
      });
      row.append(edit);
      if (Number(format.id) > 0) {
        const remove = element('button', 'btn btn-outline-danger btn-sm ml-2', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', async function () {
          if (remove.dataset.armed !== '1') {
            remove.dataset.armed = '1';
            remove.textContent = 'Sure?';
            return;
          }
          try {
            await call({ action: 'delete_format', id: format.id });
            draw();
          } catch (error) {
            say(error.message, true);
          }
        });
        row.append(remove);
      }
      list.append(row);
    });
    const add = element('button', 'btn btn-primary btn-sm', 'Add a format');
    add.type = 'button';
    add.addEventListener('click', function () {
      form(null);
    });
    const holder = element('div', 'card card-body mt-3');
    holder.hidden = true;
    root.append(list, add, holder);

    function form(format) {
      holder.hidden = false;
      holder.textContent = '';
      holder.append(element('h5', '', format ? 'Edit ' + format.name : 'A new format'));
      const name = input('text', format ? format.name : '', { placeholder: 'for example Cryo tube 50 x 25' });
      const width = input('number', format ? format.width_mm : 50, { min: 10, max: 120, step: 0.5 });
      const height = input('number', format ? format.height_mm : 25, { min: 5, max: 200, step: 0.5 });
      const margin = input('number', format ? format.margin_mm : 1.5, { min: 0, max: 10, step: 0.5 });
      const sideOf = function (key) {
        return input('number', format && format[key] !== null && format[key] !== undefined ? format[key] : '', { min: 0, max: 10, step: 0.5, placeholder: 'as the margin' });
      };
      const left = sideOf('margin_left_mm');
      const top = sideOf('margin_top_mm');
      const right = sideOf('margin_right_mm');
      const bottom = sideOf('margin_bottom_mm');
      const font = input('number', format ? format.font_mm : 3.2, { min: 1, max: 20, step: 0.1 });
      const qr = input('checkbox');
      qr.checked = format ? Number(format.qr) === 1 : true;
      const isDefault = input('checkbox');
      isDefault.checked = format ? Number(format.is_default) === 1 : false;
      const lines = element('textarea', 'form-control form-control-sm');
      lines.rows = 5;
      lines.value = (format ? format.lines : ['{id_line}', '{title}']).join('\n');
      const save = element('button', 'btn btn-primary btn-sm', 'Save the format');
      save.type = 'button';
      save.addEventListener('click', async function () {
        try {
          await call({ action: 'save_format', id: format ? Number(format.id) : 0, name: name.value, width_mm: Number(width.value), height_mm: Number(height.value), margin_mm: Number(margin.value), margin_left_mm: left.value, margin_top_mm: top.value, margin_right_mm: right.value, margin_bottom_mm: bottom.value, font_mm: Number(font.value), qr: qr.checked, is_default: isDefault.checked, lines: lines.value });
          draw();
        } catch (error) {
          say(error.message, true);
        }
      });
      const qrLabel = element('label', 'd-block mb-2');
      qrLabel.append(qr, document.createTextNode(' A QR code to the entry on the label'));
      const defLabel = element('label', 'd-block mb-2');
      defLabel.append(isDefault, document.createTextNode(' The format that is chosen first'));
      holder.append(field('Name', name), field('Width (mm)', width), field('Height (mm)', height), field('Margin of the label (mm), used for the sides left empty', margin), field('Left margin (mm)', left), field('Top margin (mm)', top), field('Right margin (mm)', right), field('Bottom margin (mm)', bottom), field('Height of the text (mm)', font), qrLabel, defLabel, field('Lines of text, one per line', lines, 'For example {id_line}, {title}, Lot {field:Lot number}'), save);
    }
  }
  draw();
})();
