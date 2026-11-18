/**
 * The Labels tab of the Admin panel: the printer, and the sizes of label with their lines. Talks to label-print.php. The look is in planned.css (.lf-*),
 * on the shared --fx sizes.
 */
(function () {
  'use strict';
  const root = document.getElementById('labelFormatsApp');
  if (!root) {
    return;
  }
  if (!document.querySelector('link[href^="planned.css?v=lf"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'planned.css?v=lf' + Math.floor(Date.now() / 60000);
    document.head.append(link);
  }
  // the fields that exist only for the entries of the Database are shown only where the Database exists
  const hasDatabase = Boolean(document.getElementById('navRegistryDropdown'));
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
  const icon = function (classes) {
    const node = element('i', classes);
    node.setAttribute('aria-hidden', 'true');
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
  let counter = 0;
  // a row of the label / value grid: a muted label, the control, and the help as small muted text under the control
  const field = function (labelText, control, hint) {
    const row = element('div', 'lf-row');
    counter += 1;
    control.id = control.id || 'lf-' + counter;
    const label = element('label', 'lf-label', labelText);
    label.htmlFor = control.id;
    const box = element('div', 'lf-control');
    box.append(control);
    if (hint) {
      box.append(element('div', 'lf-hint', hint));
    }
    row.append(label, box);
    return row;
  };
  const check = function (input, text) {
    const label = element('label', 'lf-check');
    label.append(input, element('span', '', text));
    return label;
  };
  const input = function (type, value, extra) {
    const node = element('input', type === 'checkbox' ? 'lf-checkbox' : 'form-control lf-input' + (type === 'number' ? ' lf-number' : ''));
    node.type = type;
    node.value = value === undefined || value === null ? '' : value;
    Object.assign(node, extra || {});
    return node;
  };
  const button = function (text, variant, iconClass) {
    const node = element('button', 'btn lf-btn btn-' + variant);
    node.type = 'button';
    if (iconClass) {
      node.append(icon(iconClass));
    }
    node.append(document.createTextNode(text));
    return node;
  };
  const iconButton = function (iconClass, title, variant) {
    const node = element('button', 'btn lf-icon-btn btn-' + variant);
    node.type = 'button';
    node.title = title;
    node.setAttribute('aria-label', title);
    node.append(icon(iconClass));
    return node;
  };
  const heading = function (text) {
    return element('h3', 'lf-h', text);
  };

  // the short intro and the fields that can be used in the lines of a format
  const intro = function () {
    const wrap = element('div', 'lf-intro');
    wrap.append(element('p', 'mb-1', 'Label formats set the size, margins and text lines of the labels people print. Add one format per label size; people pick one when they print.'));
    const details = element('details', 'lf-fields');
    details.append(element('summary', '', 'Available fields'));
    const chips = element('div', 'lf-chips');
    const fields = [
      ['{id_line}', hasDatabase ? 'the ID, and My ID for entries in the Database' : 'the ID of the entry'],
      ['{id}', 'the ID of the entry'],
    ];
    if (hasDatabase) {
      fields.push(['{my_id}', 'the My ID of an entry in the Database'], ['{module}', 'the module of an entry in the Database']);
    }
    fields.push(['{title}', 'the title'], ['{date}', 'the date'], ['{field:Name}', 'a field of the entry, by its name']);
    fields.forEach(function (f) {
      const chip = element('code', 'lf-chip', f[0]);
      chip.title = f[1];
      chips.append(chip);
    });
    details.append(chips, element('p', 'lf-hint mb-0', 'A line whose field is empty is left out.'));
    wrap.append(details);
    return wrap;
  };

  async function draw() {
    root.textContent = '';
    root.classList.add('lf-app');
    let data;
    try {
      data = await call();
    } catch (error) {
      root.append(element('p', 'text-danger', error.message));
      return;
    }
    const message = element('p', 'lf-message');
    message.setAttribute('role', 'status');
    const say = function (text, failed) {
      message.className = 'lf-message ' + (failed ? 'text-danger' : 'text-success');
      message.textContent = text;
    };
    root.append(intro(), message);

    // the printer
    const printer = element('section', 'lf-section');
    printer.append(heading('Printer'));
    const host = input('text', data.settings.printer_host, { placeholder: 'for example 192.168.1.50' });
    const port = input('number', data.settings.printer_port, { min: 1, max: 65535 });
    const dpi = element('select', 'form-control lf-input lf-number');
    [203, 300, 600].forEach(function (value) {
      const option = element('option', '', value + ' dpi' + (value === 300 ? ' (GX430t)' : ''));
      option.value = String(value);
      option.selected = Number(data.settings.dpi) === value;
      dpi.append(option);
    });
    const base = input('text', data.settings.qr_base_url, { placeholder: 'https://elab.example.org (the address people open the site with)' });
    const savePrinter = button('Save the printer', 'primary', 'fas fa-floppy-disk fa-fw');
    savePrinter.addEventListener('click', async function () {
      try {
        await call({ action: 'save_settings', printer_host: host.value, printer_port: Number(port.value), dpi: Number(dpi.value), qr_base_url: base.value });
        say('The printer is saved.');
      } catch (error) {
        say(error.message, true);
      }
    });
    const grid = element('div', 'lf-grid');
    grid.append(field('Address', host, 'The labels are sent to this address, port 9100 for a Zebra.'), field('Port', port), field('Resolution', dpi), field('QR web address', base, 'The QR code of a label opens the entry at this address. Empty: the address of this page.'));
    const actions = element('div', 'lf-actions');
    actions.append(savePrinter);
    printer.append(grid, actions);
    root.append(printer);

    // the formats
    const formats = element('section', 'lf-section');
    formats.append(heading('Formats'));
    const list = element('div', 'lf-formats');
    data.formats.forEach(function (format) {
      const row = element('div', 'lf-format');
      const nameCell = element('span', 'lf-format-name', format.name);
      nameCell.title = format.name;
      row.append(nameCell, element('span', 'lf-format-size', Number(format.width_mm) + ' x ' + Number(format.height_mm) + ' mm'));
      row.append(Number(format.is_default) === 1 ? element('span', 'lf-badge', 'default') : element('span', ''));
      const tools = element('span', 'lf-format-tools');
      const edit = iconButton('fas fa-pen fa-fw', 'Edit ' + format.name, 'link');
      edit.addEventListener('click', function () {
        form(format);
      });
      tools.append(edit);
      if (Number(format.id) > 0) {
        const remove = iconButton('fas fa-trash-can fa-fw', 'Delete ' + format.name, 'link');
        remove.classList.add('lf-danger');
        remove.addEventListener('click', async function () {
          if (remove.dataset.armed !== '1') {
            remove.dataset.armed = '1';
            remove.classList.add('lf-armed');
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
        tools.append(remove);
      }
      row.append(tools);
      list.append(row);
    });
    const add = button('Add a format', 'primary', 'fas fa-plus fa-fw');
    const addRow = element('div', 'lf-actions');
    addRow.append(add);
    add.addEventListener('click', function () {
      form(null);
    });
    const holder = element('section', 'lf-section lf-edit');
    holder.hidden = true;
    formats.append(list, addRow);
    root.append(formats, holder);

    function form(format) {
      holder.hidden = false;
      holder.textContent = '';
      holder.append(heading(format ? 'Edit ' + format.name : 'A new format'));
      const name = input('text', format ? format.name : '', { placeholder: 'for example Cryo tube 50 x 25' });
      const width = input('number', format ? format.width_mm : 50, { min: 10, max: 120, step: 0.5 });
      const height = input('number', format ? format.height_mm : 25, { min: 5, max: 200, step: 0.5 });
      const margin = input('number', format ? format.margin_mm : 1.5, { min: -10, max: 10, step: 0.5 });
      const sideOf = function (key) {
        return input('number', format && format[key] !== null && format[key] !== undefined ? format[key] : '', { min: -10, max: 10, step: 0.5, placeholder: 'as margin' });
      };
      const left = sideOf('margin_left_mm');
      const top = sideOf('margin_top_mm');
      const right = sideOf('margin_right_mm');
      const bottom = sideOf('margin_bottom_mm');
      const offsetX = input('number', format ? format.offset_x_mm : 0, { min: -40, max: 40, step: 0.5 });
      const offsetY = input('number', format ? format.offset_y_mm : 0, { min: -40, max: 40, step: 0.5 });
      const font = input('number', format ? format.font_mm : 3.2, { min: 1, max: 20, step: 0.1 });
      const qr = input('checkbox');
      qr.checked = format ? Number(format.qr) === 1 : true;
      const rotate = input('checkbox');
      rotate.checked = format ? Number(format.rotate_180) === 1 : false;
      const isDefault = input('checkbox');
      isDefault.checked = format ? Number(format.is_default) === 1 : false;
      const lines = element('textarea', 'form-control lf-input lf-lines');
      lines.rows = 3;
      lines.value = (format ? format.lines : ['{id_line}', '{title}']).join('\n');
      const save = button('Save the format', 'primary', 'fas fa-floppy-disk fa-fw');
      save.addEventListener('click', async function () {
        try {
          await call({ action: 'save_format', id: format ? Number(format.id) : 0, name: name.value, width_mm: Number(width.value), height_mm: Number(height.value), margin_mm: Number(margin.value), margin_left_mm: left.value, margin_top_mm: top.value, margin_right_mm: right.value, margin_bottom_mm: bottom.value, offset_x_mm: Number(offsetX.value), offset_y_mm: Number(offsetY.value), font_mm: Number(font.value), qr: qr.checked, rotate_180: rotate.checked, is_default: isDefault.checked, lines: lines.value });
          draw();
        } catch (error) {
          say(error.message, true);
        }
      });
      const fieldsGrid = element('div', 'lf-grid');
      fieldsGrid.append(
        field('Name', name),
        field('Width (mm)', width),
        field('Height (mm)', height),
        field('Margin (mm)', margin, 'Used for the sides left empty.'),
        field('Left margin', left),
        field('Top margin', top),
        field('Right margin', right),
        field('Bottom margin', bottom),
        field('Move right (mm)', offsetX, 'Raise it if the print is too far left; a negative number moves it left.'),
        field('Move down (mm)', offsetY, 'Raise it if the print starts above the label; a negative number moves it up.'),
        field('Text height (mm)', font),
        field('Lines of text', lines, 'One per line, for example {id_line}, {title}, Lot {field:Lot number}.'),
      );
      const checks = element('div', 'lf-checks');
      checks.append(check(qr, 'A QR code to the entry on the label'), check(rotate, 'Printed turned by 180 degrees (the label is read upside down)'), check(isDefault, 'The format that is chosen first'));
      const left_ = element('div', 'lf-edit-fields');
      const cancel = button('Cancel', 'secondary');
      cancel.addEventListener('click', function () {
        holder.hidden = true;
        holder.textContent = '';
      });
      const saveRow = element('div', 'lf-actions');
      saveRow.append(save, cancel);
      left_.append(fieldsGrid, checks, saveRow);
      // a template of the label: the margins are the dashed lines, drag them to change the margins; the sample can be printed to check them
      const SVGNS = 'http://www.w3.org/2000/svg';
      const template = element('div', 'lf-preview');
      const drawing = element('div', '');
      const templateMessage = element('p', 'lf-hint mb-1', 'Drag the dashed lines to change the margins; the numbers follow. Save the format to keep them.');
      templateMessage.setAttribute('role', 'status');
      const sideValue = function (field) {
        return field.value === '' ? Number(margin.value) || 0 : Number(field.value);
      };
      // the drawing is made once and only moved afterwards, so that a line being dragged stays under the pointer
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.classList.add('lf-svg');
      svg.style.cssText = 'width:100%;max-width:440px;border:1px solid #888;background:#fff;display:block;touch-action:none;user-select:none';
      const texts = [['1374', 0], ['Title of the entry', 1]].map(function (row) {
        const text = document.createElementNS(SVGNS, 'text');
        text.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
        text.textContent = row[0];
        svg.append(text);
        return { node: text, row: row[1] };
      });
      const frame = document.createElementNS(SVGNS, 'rect');
      frame.setAttribute('fill', 'none');
      frame.setAttribute('stroke', '#5b8def');
      frame.setAttribute('stroke-dasharray', '4 3');
      frame.setAttribute('vector-effect', 'non-scaling-stroke');
      frame.style.pointerEvents = 'none';
      svg.append(frame);
      const caption = element('p', 'lf-hint mb-2');
      const handles = [];
      const sizes = function () {
        return { w: Number(width.value) || 1, h: Number(height.value) || 1 };
      };
      const drawTemplate = function () {
        const { w, h } = sizes();
        const m = { left: sideValue(left), top: sideValue(top), right: sideValue(right), bottom: sideValue(bottom) };
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        const size = Number(font.value) || 3;
        texts.forEach(function (t) {
          t.node.setAttribute('x', m.left);
          t.node.setAttribute('y', m.top + size * 0.8 + t.row * size * 1.15);
          t.node.setAttribute('font-size', String(size));
        });
        frame.setAttribute('x', m.left);
        frame.setAttribute('y', m.top);
        frame.setAttribute('width', Math.max(0.1, w - m.left - m.right));
        frame.setAttribute('height', Math.max(0.1, h - m.top - m.bottom));
        handles.forEach(function (hd) {
          const pos = { left: m.left, right: w - m.right, top: m.top, bottom: h - m.bottom }[hd.side];
          const vertical = hd.side === 'left' || hd.side === 'right';
          hd.node.setAttribute('x1', vertical ? pos : 0);
          hd.node.setAttribute('x2', vertical ? pos : w);
          hd.node.setAttribute('y1', vertical ? 0 : pos);
          hd.node.setAttribute('y2', vertical ? h : pos);
          hd.node.setAttribute('stroke-width', String(Math.max(2, w / 18)));
        });
        caption.textContent = w + ' x ' + h + ' mm; margins left / top / right / bottom: ' + [m.left, m.top, m.right, m.bottom].join(' / ') + ' mm';
      };
      [['left', left, 'ew-resize'], ['right', right, 'ew-resize'], ['top', top, 'ns-resize'], ['bottom', bottom, 'ns-resize']].forEach(function (def) {
        const line = document.createElementNS(SVGNS, 'line');
        line.setAttribute('stroke', 'rgba(0,0,0,0)');
        line.style.cursor = def[2];
        let dragging = false;
        line.addEventListener('pointerdown', function (event) {
          event.preventDefault();
          dragging = true;
          line.setPointerCapture(event.pointerId);
        });
        line.addEventListener('pointermove', function (event) {
          if (!dragging) {
            return;
          }
          const { w, h } = sizes();
          const box = svg.getBoundingClientRect();
          const x = (event.clientX - box.left) / box.width * w;
          const y = (event.clientY - box.top) / box.height * h;
          const mm = { left: x, top: y, right: w - x, bottom: h - y }[def[0]];
          def[1].value = String(Math.round(Math.max(-10, Math.min(10, mm)) * 10) / 10);
          drawTemplate();
        });
        const stop = function () {
          dragging = false;
        };
        line.addEventListener('pointerup', stop);
        line.addEventListener('pointercancel', stop);
        svg.append(line);
        handles.push({ side: def[0], node: line });
      });
      drawing.append(svg, caption);
      [width, height, margin, left, top, right, bottom, font].forEach(function (f) {
        f.addEventListener('input', drawTemplate);
      });
      const printSample = button('Print this template as a sample label', 'secondary', 'fas fa-print fa-fw');
      printSample.addEventListener('click', async function () {
        printSample.disabled = true;
        templateMessage.className = 'lf-hint mb-1';
        templateMessage.textContent = 'Sending to the printer...';
        try {
          const response = await fetch('label-print.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': (document.querySelector('meta[name="csrf-token"]') || {}).content || '' },
            body: JSON.stringify({ sample: true, copies: 1, custom: '', format: -1, design: { width_mm: width.value, height_mm: height.value, margin_mm: margin.value, margin_left_mm: left.value, margin_top_mm: top.value, margin_right_mm: right.value, margin_bottom_mm: bottom.value, offset_x_mm: offsetX.value, offset_y_mm: offsetY.value, font_mm: font.value, qr: qr.checked, rotate_180: rotate.checked, lines: lines.value } }),
          });
          const answer = await response.json().catch(function () { return { error: 'Your session has probably ended. Reload the page.' }; });
          templateMessage.className = 'lf-hint mb-1 ' + (answer.error ? 'text-danger' : 'text-success');
          templateMessage.textContent = answer.error ? answer.error : 'A sample label is sent: ' + (answer.lines || []).join(' / ') + '.';
        } catch (error) {
          templateMessage.className = 'lf-hint mb-1 text-danger';
          templateMessage.textContent = error.message;
        }
        printSample.disabled = false;
      });
      template.append(templateMessage, drawing, printSample);
      holder.append(left_, template);
      drawTemplate();
    }
  }
  draw();
})();
