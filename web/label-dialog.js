/**
 * The label printing dialog: the item "Print label" of the Tools menu of the top bar (on every page; head.html) that opens a dialog to print labels on the label
 * printer of the lab (label-print.php): any text with {variables} and one label per row of a pasted spreadsheet table, line formats, a preview with
 * draggable margins and a test pattern. The sizes and the printer are set by admins in the Labels tab of the Admin panel (label-formats.js). Other scripts can
 * open the same dialog for an entry with window.dispatchEvent(new CustomEvent('registry:print-label', { detail: { id, title } })). Needs nothing else.
 */
(function () {
  'use strict';
  // loaded by the footer on every page; once is enough
  if (window.__labelDialogLoaded) {
    return;
  }
  window.__labelDialogLoaded = true;
  if (!document.querySelector('link[href^="planned.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'planned.css?v=' + Math.floor(Date.now() / 300000);
    document.head.append(link);
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
  // a label of any text, on any of the label sizes that exist: the item "Print label" of the Tools menu (head.html). One delegated listener, so the
  // copy of the item in the More menu of a narrow window works too. On the page of an entry, the title of the entry is put in the text.
  document.addEventListener('click', function (event) {
    const item = event.target instanceof Element ? event.target.closest('[data-print-label-open]') : null;
    if (!item) {
      return;
    }
    event.preventDefault();
    const heading = document.getElementById('documentTitle');
    const prefill = heading ? heading.textContent.trim().slice(0, 200) : '';
    window.dispatchEvent(new CustomEvent('registry:print-label', { detail: { generic: true, title: '', prefill: prefill } }));
  });

  // the print button of a row: the label of the entry is printed on the label printer of the lab (see label-print.php)
  window.addEventListener('registry:print-label', function (event) {
    const entry = event.detail;
    const back = element('div', 'planned-backdrop');
    const box = element('div', 'planned-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    // many options: the dialog is wider and scrolls when the window is low
    box.style.maxWidth = '36rem';
    box.style.maxHeight = '92vh';
    box.style.overflowY = 'auto';
    const heading = element('h5', '', entry.generic ? 'Print a label' : 'Print a label for ' + entry.title);
    // small "i" like the ones of the other pages: opens the guide cards of this area (Others: Print a label, Feedback, Announcements) in a new tab
    const guide = element('a', 'btn btn-link guide-info-btn p-0 ml-1');
    guide.href = 'whats-new.php?area=Others';
    guide.target = '_blank';
    guide.rel = 'noopener';
    guide.title = 'About printing labels in the guide';
    guide.setAttribute('aria-label', 'About printing labels in the guide');
    guide.append(element('i', 'fas fa-circle-info'));
    heading.append(guide);
    box.append(heading);
    const label = element('label', 'd-block');
    label.append(element('span', 'd-block small text-muted', 'Copies'));
    const copies = element('input', 'form-control form-control-sm');
    copies.type = 'number';
    copies.min = '1';
    copies.max = '100';
    copies.value = '1';
    label.append(copies);
    box.append(label);
    // the label has the ID and the title of the entry; text typed here is added below them, one line each
    // the preview: a visible bordered panel (inline styles, so no stylesheet can hide it), above the buttons
    const preview = element('div', 'small');
    preview.style.cssText = 'border:1px solid #888;border-radius:6px;padding:0.5rem;margin:0 0 0.6rem;min-height:4.5rem;background:rgba(128,128,128,0.08)';
    preview.textContent = 'Preview…';
    box.append(preview);
    // margins (mm) dragged in the preview for this label; null = those of the format
    let edited = null;
    const customLabel = element('label', 'd-block');
    customLabel.append(element('span', 'd-block small text-muted', entry.generic ? 'Text of the label (one line each, up to 8). Write {name} where a value changes: it becomes an input' : 'Extra text on the label (optional, one line each)'));
    const custom = element('textarea', 'form-control form-control-sm');
    custom.rows = entry.generic ? 5 : 3;
    custom.maxLength = entry.generic ? 640 : 240;
    customLabel.append(custom);
    const variablesBox = element('div', 'mb-2');
    // formatting of each line of the text: a size (mm), bold, italic, and left / centre / right; kept by the number of the line
    const styleBox = element('div', 'mb-2');
    const tableBox = element('div', 'mb-2');
    box.append(customLabel, styleBox, tableBox, variablesBox);
    if (entry.prefill) {
      custom.value = entry.prefill;
    }
    // the format of the label: the sizes the admins have made
    const formatLabel = element('label', 'd-block');
    formatLabel.append(element('span', 'd-block small text-muted', 'Label format'));
    const format = element('select', 'form-control form-control-sm');
    formatLabel.append(format);
    box.insertBefore(formatLabel, label);
    // a generic label: the size of the text can be chosen (mm); it is made smaller by itself when the lines do not fit
    const fontSize = element('input', 'form-control form-control-sm');
    fontSize.type = 'number';
    fontSize.min = '1';
    fontSize.max = '20';
    fontSize.step = '0.1';
    fontSize.placeholder = 'of the format';
    if (entry.generic) {
      const fontLabel = element('label', 'd-block');
      fontLabel.append(element('span', 'd-block small text-muted', 'Text size (mm, empty = that of the format)'), fontSize);
      box.insertBefore(fontLabel, label);
      fontSize.addEventListener('input', function () {
        window.clearTimeout(fontSize.timer);
        fontSize.timer = window.setTimeout(showPreview, 400);
      });
    }
    fetch('label-print.php', { credentials: 'same-origin' }).then(function (response) {
      return response.json();
    }).then(function (body) {
      body.formats.forEach(function (f) {
        const option = element('option', '', f.name + ' (' + f.width_mm + ' x ' + f.height_mm + ' mm)');
        option.value = String(f.id);
        option.selected = Number(f.is_default) === 1;
        format.append(option);
      });
      showPreview();
    }).catch(function () {
      // the default format is used
    });
    format.addEventListener('change', function () {
      edited = null;
      showPreview();
    });
    // variables: {name} in the text of a generic label become inputs; each row of values is one label
    const rows = [{}];
    const names = function () {
      const found = [];
      (custom.value.match(/\{[^{}]+\}/g) || []).forEach(function (m) {
        const n = m.slice(1, -1).trim();
        if (n !== '' && found.indexOf(n) < 0) {
          found.push(n);
        }
      });
      return found;
    };
    const filled = function (row) {
      return custom.value.replace(/\{([^{}]+)\}/g, function (m, n) {
        return row[n.trim()] !== undefined ? row[n.trim()] : '';
      });
    };
    const renderVariables = function () {
      variablesBox.textContent = '';
      const list = names();
      if (!entry.generic || list.length === 0) {
        return;
      }
      const table = element('table', 'table table-sm mb-1');
      const head = element('tr');
      list.forEach(function (n) {
        head.append(element('th', 'small', n));
      });
      head.append(element('th'));
      table.append(head);
      rows.forEach(function (row, index) {
        if (index >= 30) {
          return;
        }
        const tr = element('tr');
        list.forEach(function (n) {
          const td = element('td');
          const input = element('input', 'form-control form-control-sm');
          input.type = 'text';
          input.value = row[n] || '';
          input.addEventListener('input', function () {
            row[n] = input.value;
            window.clearTimeout(input.timer);
            input.timer = window.setTimeout(showPreview, 400);
          });
          // a table pasted from a spreadsheet fills the cells from here: a row of the table is a label
          input.addEventListener('paste', function (event) {
            const text = (event.clipboardData || window.clipboardData).getData('text');
            if (text.indexOf('\t') < 0 && text.indexOf('\n') < 0) {
              return;
            }
            event.preventDefault();
            const pasted = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(function (line) {
              return line.split('\t');
            });
            pasted.forEach(function (cells, r) {
              while (rows.length <= index + r) {
                rows.push({});
              }
              cells.forEach(function (cell, c) {
                if (list[list.indexOf(n) + c] !== undefined) {
                  rows[index + r][list[list.indexOf(n) + c]] = cell.trim();
                }
              });
            });
            renderVariables();
            showPreview();
          });
          td.append(input);
          tr.append(td);
        });
        const del = element('button', 'btn btn-outline-secondary btn-sm', '\u00d7');
        del.type = 'button';
        del.title = 'Remove this label';
        del.disabled = rows.length === 1;
        del.addEventListener('click', function () {
          rows.splice(index, 1);
          renderVariables();
          showPreview();
        });
        const last = element('td');
        last.append(del);
        tr.append(last);
        table.append(tr);
      });
      const add = element('button', 'btn btn-outline-secondary btn-sm', 'Add a label with other values');
      add.type = 'button';
      add.addEventListener('click', function () {
        rows.push(Object.assign({}, rows[rows.length - 1]));
        renderVariables();
      });
      variablesBox.append(table, add, element('div', 'small text-muted', rows.length + (rows.length === 1 ? ' label' : ' labels') + ' of ' + copies.value + ' copies each; the preview shows the first' + (rows.length > 30 ? ' (the first 30 are listed here, all are printed)' : '') + '.'));
    };
    const maxLines = entry.generic ? 8 : 4;
    const styles = [];
    const changedStyle = function () {
      window.clearTimeout(styleBox.timer);
      styleBox.timer = window.setTimeout(showPreview, 300);
    };
    const renderStyles = function () {
      styleBox.textContent = '';
      const texts = custom.value.split('\n').slice(0, maxLines);
      if (!texts.some(function (t) { return t.trim() !== ''; })) {
        return;
      }
      styleBox.append(element('div', 'small text-muted mb-1', 'Format each line: size (mm), bold, italic, left / centre / right'));
      texts.forEach(function (text, index) {
        if (text.trim() === '') {
          return;
        }
        const st = styles[index] || (styles[index] = {});
        const row = element('div', 'd-flex align-items-center mb-1');
        const name = element('span', 'small text-truncate mr-2', text.trim());
        name.style.flex = 'none';
        name.style.width = '8rem';
        name.title = text.trim();
        const size = element('input', 'form-control form-control-sm mr-2');
        size.type = 'number';
        size.min = '1';
        size.max = '20';
        size.step = '0.1';
        size.placeholder = 'size';
        size.title = 'Text size of this line in mm (empty = the size of the label)';
        size.style.width = '4.8rem';
        size.style.flex = 'none';
        size.value = st.size_mm ? String(st.size_mm) : '';
        size.addEventListener('input', function () {
          st.size_mm = size.value === '' ? 0 : Number(size.value);
          changedStyle();
        });
        row.append(name, size);
        const flag = function (key, content, title, css) {
          const button = element('button', 'btn btn-sm btn-outline-secondary mr-1' + (st[key] ? ' active' : ''));
          button.type = 'button';
          button.title = title;
          button.setAttribute('aria-pressed', st[key] ? 'true' : 'false');
          button.style.cssText = css;
          button.textContent = content;
          button.addEventListener('click', function () {
            st[key] = !st[key];
            button.classList.toggle('active', st[key]);
            button.setAttribute('aria-pressed', st[key] ? 'true' : 'false');
            changedStyle();
          });
          return button;
        };
        row.append(flag('bold', 'B', 'Bold', 'font-weight:bold;min-width:2rem'), flag('italic', 'I', 'Italic', 'font-style:italic;min-width:2rem'));
        const aligns = [];
        [['left', 'fa-align-left', 'Left'], ['center', 'fa-align-center', 'Centre'], ['right', 'fa-align-right', 'Right']].forEach(function (a) {
          const button = element('button', 'btn btn-sm btn-outline-secondary' + ((st.align || 'left') === a[0] ? ' active' : ''));
          button.type = 'button';
          button.title = a[2];
          button.append(element('i', 'fas ' + a[1]));
          button.addEventListener('click', function () {
            st.align = a[0];
            aligns.forEach(function (other) {
              other.node.classList.toggle('active', other.name === a[0]);
            });
            changedStyle();
          });
          aligns.push({ node: button, name: a[0] });
          row.append(button);
        });
        styleBox.append(row);
      });
    };
    const stylesPayload = function () {
      const out = custom.value.split('\n').slice(0, maxLines).map(function (text, index) {
        return text.trim() !== '' && styles[index] ? styles[index] : null;
      });
      return out.some(Boolean) ? out : undefined;
    };
    // a table copied from a spreadsheet: click a column name to put it in the text, each row of the table is one label
    if (entry.generic) {
      const pasteLabel = element('label', 'd-block mb-1');
      pasteLabel.append(element('span', 'd-block small text-muted', 'Labels from a spreadsheet: paste its cells here, then click the columns you want on the label (each row is one label)'));
      const pasted = element('textarea', 'form-control form-control-sm');
      pasted.rows = 3;
      pasted.placeholder = 'Copy cells in the spreadsheet (with the column names on top) and paste them here';
      pasteLabel.append(pasted);
      const headerLabel = element('label', 'small d-block mb-1');
      const header = element('input', 'mr-1');
      header.type = 'checkbox';
      header.checked = true;
      headerLabel.append(header, document.createTextNode('The first row has the column names'));
      const chips = element('div', 'mb-1');
      tableBox.append(pasteLabel, headerLabel, chips);
      const insert = function (token) {
        const from = custom.selectionStart === undefined ? custom.value.length : custom.selectionStart;
        const to = custom.selectionEnd === undefined ? from : custom.selectionEnd;
        custom.value = custom.value.slice(0, from) + token + custom.value.slice(to);
        custom.focus();
        custom.setSelectionRange(from + token.length, from + token.length);
        custom.dispatchEvent(new Event('input'));
      };
      const load = function () {
        chips.textContent = '';
        const text = pasted.value.replace(/\r/g, '').replace(/\n+$/, '');
        if (text.trim() === '') {
          return;
        }
        const grid = text.split('\n').map(function (line) {
          return line.split('\t');
        });
        const width = Math.max.apply(null, grid.map(function (r) { return r.length; }));
        const columns = [];
        for (let c = 0; c < width; c++) {
          let name = header.checked ? String(grid[0][c] || '').replace(/[{}]/g, '').trim() : '';
          name = name === '' ? 'Column ' + (c + 1) : name;
          while (columns.indexOf(name) >= 0) {
            name += ' ' + (c + 1);
          }
          columns.push(name);
        }
        rows.length = 0;
        grid.slice(header.checked ? 1 : 0).forEach(function (cells) {
          const row = {};
          columns.forEach(function (name, c) {
            row[name] = String(cells[c] || '').trim();
          });
          rows.push(row);
        });
        if (rows.length === 0) {
          rows.push({});
        }
        columns.forEach(function (name) {
          const chip = element('button', 'btn btn-outline-primary btn-sm mr-1 mb-1', name);
          chip.type = 'button';
          chip.title = 'Put {' + name + '} in the text of the label';
          chip.addEventListener('click', function () {
            insert('{' + name + '}');
          });
          chips.append(chip);
        });
        renderVariables();
        showPreview();
      };
      pasted.addEventListener('input', load);
      header.addEventListener('change', load);
    }
    const request = function (extra) {
      return fetch('label-print.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
        body: JSON.stringify(Object.assign({ id: entry.id, generic: entry.generic ? true : undefined, font_mm: entry.generic && fontSize.value !== '' ? Number(fontSize.value) : undefined, copies: Number(copies.value) || 1, custom: entry.generic ? filled(rows[0]) : custom.value, format: format.value === '' ? -1 : Number(format.value), margins: edited || undefined, styles: stylesPayload() }, extra || {})),
      }).then(async function (response) {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || 'The label could not be printed.');
        }
        return body;
      });
    };
    // the label drawn as it will be printed: the same positions that go to the printer; a label read turned by 180 degrees is shown turned
    const SVGNS = 'http://www.w3.org/2000/svg';
    const draw = function (body) {
      preview.textContent = '';
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + body.width + ' ' + body.height);
      svg.setAttribute('width', String(Math.min(360, body.width)));
      // a size in CSS too (an svg without one can collapse in a dialog): the label is shown at up to 360px wide, whatever the panel
      svg.style.width = Math.min(360, body.width) + 'px';
      svg.style.maxWidth = '100%';
      svg.style.height = 'auto';
      svg.style.border = '1px solid #888';
      svg.style.background = '#fff';
      svg.style.display = 'block';
      const group = document.createElementNS(SVGNS, 'g');
      body.elements.forEach(function (item) {
        if (item.type === 'qr') {
          const box = document.createElementNS(SVGNS, 'rect');
          box.setAttribute('x', item.x);
          box.setAttribute('y', item.y);
          box.setAttribute('width', item.size);
          box.setAttribute('height', item.size);
          box.setAttribute('fill', '#ddd');
          box.setAttribute('stroke', '#333');
          group.append(box);
          return;
        }
        if (item.type === 'image') {
          const picture = document.createElementNS(SVGNS, 'image');
          picture.setAttribute('x', item.x);
          picture.setAttribute('y', item.y);
          picture.setAttribute('width', item.w);
          picture.setAttribute('height', item.h);
          picture.setAttribute('href', item.src);
          group.append(picture);
          return;
        }
        const text = document.createElementNS(SVGNS, 'text');
        text.setAttribute('transform', 'translate(' + item.x + ',' + item.y + ')' + (item.inverted ? ' rotate(180)' : ''));
        text.setAttribute('font-size', String(item.h));
        text.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
        text.textContent = item.text;
        group.append(text);
      });
      // read upside down: turn the drawing so it is seen as a person reads the label
      if (body.rotated) {
        group.setAttribute('transform', 'rotate(180 ' + (body.width / 2) + ' ' + (body.height / 2) + ')');
      }
      svg.append(group);
      // the margins, as the label is read: the dashed lines can be dragged to change them
      if (body.margins) {
        const dotsPerMm = body.width / Number(body.width_mm);
        const m = body.margins;
        const frame = document.createElementNS(SVGNS, 'rect');
        frame.setAttribute('x', m.left);
        frame.setAttribute('y', m.top);
        frame.setAttribute('width', Math.max(1, body.width - m.left - m.right));
        frame.setAttribute('height', Math.max(1, body.height - m.top - m.bottom));
        frame.setAttribute('fill', 'none');
        frame.setAttribute('stroke', '#5b8def');
        frame.setAttribute('stroke-dasharray', '4 3');
        frame.setAttribute('stroke-width', '1');
        frame.style.pointerEvents = 'none';
        svg.append(frame);
        const handle = function (side, x1, y1, x2, y2, cursor) {
          const line = document.createElementNS(SVGNS, 'line');
          line.setAttribute('x1', x1);
          line.setAttribute('y1', y1);
          line.setAttribute('x2', x2);
          line.setAttribute('y2', y2);
          line.setAttribute('stroke', 'transparent');
          line.setAttribute('stroke-width', '22');
          line.style.cursor = cursor;
          line.style.touchAction = 'none';
          line.addEventListener('pointerdown', function (event) {
            event.preventDefault();
            line.setPointerCapture(event.pointerId);
            const box = svg.getBoundingClientRect();
            const scale = body.width / box.width;
            const current = { left: m.left / dotsPerMm, top: m.top / dotsPerMm, right: m.right / dotsPerMm, bottom: m.bottom / dotsPerMm };
            const move = function (e) {
              const x = (e.clientX - box.left) * scale;
              const y = (e.clientY - box.top) * scale;
              const mm = { left: x, top: y, right: body.width - x, bottom: body.height - y }[side] / dotsPerMm;
              current[side] = Math.round(Math.max(-10, Math.min(10, mm)) * 10) / 10;
              edited = Object.assign({}, current);
              const dots = function (v) { return v * dotsPerMm; };
              const r = { left: dots(current.left), top: dots(current.top), right: dots(current.right), bottom: dots(current.bottom) };
              frame.setAttribute('x', r.left);
              frame.setAttribute('y', r.top);
              frame.setAttribute('width', Math.max(1, body.width - r.left - r.right));
              frame.setAttribute('height', Math.max(1, body.height - r.top - r.bottom));
            };
            const up = function () {
              line.removeEventListener('pointermove', move);
              line.removeEventListener('pointerup', up);
              showPreview();
            };
            line.addEventListener('pointermove', move);
            line.addEventListener('pointerup', up);
          });
          svg.append(line);
        };
        handle('left', m.left, 0, m.left, body.height, 'ew-resize');
        handle('right', body.width - m.right, 0, body.width - m.right, body.height, 'ew-resize');
        handle('top', 0, m.top, body.width, m.top, 'ns-resize');
        handle('bottom', 0, body.height - m.bottom, body.width, body.height - m.bottom, 'ns-resize');
        const mmOf = function (v) { return (Math.round(v / dotsPerMm * 10) / 10).toFixed(1); };
        preview.dataset.margins = [m.left, m.top, m.right, m.bottom].map(mmOf).join(' / ');
      }
      svg.setAttribute('overflow', 'hidden');
      preview.append(svg, document.createTextNode(body.width_mm + ' x ' + body.height_mm + ' mm' + ', the dashed lines are the margins (left / top / right / bottom: ' + preview.dataset.margins + ' mm): drag them to change' + (body.rotated ? '; shown as it is read (it prints turned by 180 degrees)' : '')));
    };
    // never silent: when the preview cannot be made the panel says why, with a way to try again
    const showPreview = function () {
      request({ dry: true }).then(draw).catch(function (error) {
        preview.textContent = '';
        const note = element('span', 'text-muted', 'Preview unavailable: ' + (error && error.message ? error.message : 'the request failed') + ' ');
        const retry = element('a', '', 'Try again');
        retry.href = '#';
        retry.addEventListener('click', function (e) {
          e.preventDefault();
          showPreview();
        });
        preview.append(note, retry);
      });
    };
    custom.addEventListener('input', function () {
      renderVariables();
      renderStyles();
      window.clearTimeout(custom.timer);
      custom.timer = window.setTimeout(showPreview, 400);
    });
    const message = element('p', 'small mb-0');
    const buttons = element('div', 'planned-dialog-buttons');
    const cancel = element('button', 'btn btn-secondary btn-sm', 'Close');
    cancel.type = 'button';
    const print = element('button', 'btn btn-primary btn-sm', 'Print');
    print.type = 'button';
    cancel.addEventListener('click', function () {
      back.remove();
    });
    back.addEventListener('click', function (e) {
      if (e.target === back) {
        back.remove();
      }
    });
    print.addEventListener('click', async function () {
      print.disabled = true;
      message.className = 'small mb-0';
      message.textContent = 'Sending to the printer...';
      try {
        let body = null;
        let total = 0;
        const used = names();
        for (const row of entry.generic ? rows : [null]) {
          // a row of the table with nothing in the columns that are on the label is not printed
          if (row && used.length > 0 && used.every(function (n) { return String(row[n] || '').trim() === ''; })) {
            continue;
          }
          body = await request(row ? { custom: filled(row) } : undefined);
          total += body.printed;
        }
        if (body === null) {
          throw new Error('Nothing to print: the rows of the table are empty in the columns used on the label.');
        }
        message.className = 'small mb-0 text-success';
        message.textContent = 'Sent: ' + total + (total === 1 ? ' label' : ' labels') + ' (' + body.lines.join(' / ') + (rows.length > 1 && entry.generic ? ', ...' : '') + ').';
      } catch (error) {
        message.className = 'small mb-0 text-danger';
        message.textContent = error.message;
      }
      print.disabled = false;
    });
    const test = element('button', 'btn btn-outline-secondary btn-sm mr-auto', 'Print a test pattern');
    test.type = 'button';
    test.title = 'A frame at the edge of the label and one at the margins: to see where the printer puts things';
    test.addEventListener('click', async function () {
      test.disabled = true;
      message.className = 'small mb-0';
      message.textContent = 'Sending the test pattern...';
      try {
        await request({ test: true, copies: 1 });
        message.className = 'small mb-0 text-success';
        message.textContent = 'The test pattern is sent: a frame at the edge of the label, and one at the margins.';
      } catch (error) {
        message.className = 'small mb-0 text-danger';
        message.textContent = error.message;
      }
      test.disabled = false;
    });
    // margins dragged in the preview: back to those of the format, or saved into the format (admins)
    const marginButtons = element('div', 'mb-2');
    const resetMargins = element('button', 'btn btn-outline-secondary btn-sm mr-2', 'Margins of the format');
    resetMargins.type = 'button';
    resetMargins.addEventListener('click', function () {
      edited = null;
      showPreview();
    });
    const saveMargins = element('button', 'btn btn-outline-secondary btn-sm', 'Save these margins in the format');
    saveMargins.type = 'button';
    saveMargins.addEventListener('click', async function () {
      message.className = 'small mb-0';
      if (!edited || Number(format.value) <= 0) {
        message.textContent = edited ? 'This format cannot be changed here.' : 'Drag a dashed line first.';
        return;
      }
      const response = await fetch('label-print.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
        body: JSON.stringify({ action: 'save_margins', id: Number(format.value), margins: edited }),
      });
      const answer = await response.json().catch(function () { return { error: 'Your session has probably ended. Reload the page.' }; });
      message.className = 'small mb-0 ' + (answer.error ? 'text-danger' : 'text-success');
      message.textContent = answer.error ? answer.error : 'The margins are saved in the format.';
      if (!answer.error) {
        edited = null;
        showPreview();
      }
    });
    marginButtons.append(resetMargins, saveMargins);
    box.append(marginButtons);
    buttons.append(test, cancel, print);
    box.append(message, buttons);
    back.append(box);
    document.body.append(back);
    print.focus();
    // the preview at once (the label outline with its size, even with no text yet)
    showPreview();
  });
})();
