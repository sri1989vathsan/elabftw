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
    // a check box stays small, next to its text (see the labels below); the other fields fill the width
    const node = element('input', type === 'checkbox' ? 'mr-2' : 'form-control form-control-sm');
    node.type = type;
    if (type === 'checkbox') {
      node.style.cssText = 'flex:none;margin:0 .6rem 0 0';
    }
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
      const margin = input('number', format ? format.margin_mm : 1.5, { min: -10, max: 10, step: 0.5 });
      const sideOf = function (key) {
        return input('number', format && format[key] !== null && format[key] !== undefined ? format[key] : '', { min: -10, max: 10, step: 0.5, placeholder: 'as the margin' });
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
      const lines = element('textarea', 'form-control form-control-sm');
      lines.rows = 5;
      lines.value = (format ? format.lines : ['{id_line}', '{title}']).join('\n');
      const save = element('button', 'btn btn-primary btn-sm', 'Save the format');
      save.type = 'button';
      save.addEventListener('click', async function () {
        try {
          await call({ action: 'save_format', id: format ? Number(format.id) : 0, name: name.value, width_mm: Number(width.value), height_mm: Number(height.value), margin_mm: Number(margin.value), margin_left_mm: left.value, margin_top_mm: top.value, margin_right_mm: right.value, margin_bottom_mm: bottom.value, offset_x_mm: Number(offsetX.value), offset_y_mm: Number(offsetY.value), font_mm: Number(font.value), qr: qr.checked, rotate_180: rotate.checked, is_default: isDefault.checked, lines: lines.value });
          draw();
        } catch (error) {
          say(error.message, true);
        }
      });
      const qrLabel = element('label', 'd-flex align-items-center mb-2');
      qrLabel.append(qr, document.createTextNode(' A QR code to the entry on the label'));
      const rotateLabel = element('label', 'd-flex align-items-center mb-2');
      rotateLabel.append(rotate, document.createTextNode(' Printed turned by 180 degrees (the label is read upside down)'));
      const defLabel = element('label', 'd-flex align-items-center mb-2');
      defLabel.append(isDefault, document.createTextNode(' The format that is chosen first'));
      holder.append(field('Name', name), field('Width (mm)', width), field('Height (mm)', height), field('Margin of the label (mm), used for the sides left empty', margin), field('Left margin (mm)', left), field('Top margin (mm)', top), field('Right margin (mm)', right), field('Bottom margin (mm)', bottom), field('Move everything to the right (mm)', offsetX, 'Raise it if the print is too far left; a negative number moves it left'), field('Move everything down (mm)', offsetY, 'Raise it if the print starts above the label; a negative number moves it up'), field('Height of the text (mm)', font), qrLabel, rotateLabel, defLabel, field('Lines of text, one per line', lines, 'For example {id_line}, {title}, Lot {field:Lot number}'), save);
      // a template of the label: the margins are the dashed lines, drag them to change the margins; the sample can be printed to check them
      const SVGNS = 'http://www.w3.org/2000/svg';
      const template = element('div', 'mb-3');
      const drawing = element('div', '');
      const templateMessage = element('p', 'small mb-1 text-muted', 'Drag the dashed lines to change the margins. They are filled in below; save the format to keep them.');
      const sideValue = function (field) {
        return field.value === '' ? Number(margin.value) || 0 : Number(field.value);
      };
      // the drawing is made once and only moved afterwards, so that a line being dragged stays under the pointer
      const svg = document.createElementNS(SVGNS, 'svg');
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
      const caption = element('p', 'small text-muted mb-1');
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
      const printSample = element('button', 'btn btn-outline-secondary btn-sm', 'Print this template as a sample label');
      printSample.type = 'button';
      printSample.addEventListener('click', async function () {
        printSample.disabled = true;
        templateMessage.className = 'small mb-1 text-muted';
        templateMessage.textContent = 'Sending to the printer...';
        try {
          const response = await fetch('label-print.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': (document.querySelector('meta[name="csrf-token"]') || {}).content || '' },
            body: JSON.stringify({ sample: true, copies: 1, custom: '', format: -1, design: { width_mm: width.value, height_mm: height.value, margin_mm: margin.value, margin_left_mm: left.value, margin_top_mm: top.value, margin_right_mm: right.value, margin_bottom_mm: bottom.value, offset_x_mm: offsetX.value, offset_y_mm: offsetY.value, font_mm: font.value, qr: qr.checked, rotate_180: rotate.checked, lines: lines.value } }),
          });
          const answer = await response.json().catch(function () { return { error: 'Your session has probably ended. Reload the page.' }; });
          templateMessage.className = 'small mb-1 ' + (answer.error ? 'text-danger' : 'text-success');
          templateMessage.textContent = answer.error ? answer.error : 'A sample label is sent: ' + (answer.lines || []).join(' / ') + '.';
        } catch (error) {
          templateMessage.className = 'small mb-1 text-danger';
          templateMessage.textContent = error.message;
        }
        printSample.disabled = false;
      });
      template.append(templateMessage, drawing, printSample);
      holder.insertBefore(template, holder.children[1]);
      drawTemplate();
    }
  }
  draw();
})();
