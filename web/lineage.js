/**
 * The lineage of an entry of the database: its parents (what it was made from), its daughters (what was made from it) and
 * the family tree around it. The data and the changes are in lineage.php.
 */
(function () {
  'use strict';
  const holder = document.getElementById('lineageDiv');
  const root = document.getElementById('lineageRoot');
  if (!holder || !root) {
    return;
  }
  const entryId = Number(holder.dataset.entry);
  const csrf = holder.dataset.csrf || '';
  let data = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  const viewUrl = function (id) {
    return 'registry.php?mode=view&id=' + id;
  };

  async function load() {
    const response = await fetch('lineage.php?entry=' + entryId, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error('The lineage could not be loaded (' + response.status + ').');
    }
    data = await response.json();
    render();
  }

  async function change(action, child, parent, messageBox) {
    const response = await fetch('lineage.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ action: action, entry: child, parent: parent }),
    });
    if (!response.ok) {
      let message = 'This could not be done (' + response.status + ').';
      try {
        message = (await response.json()).error || message;
      } catch (error) {
        // the message stays generic
      }
      messageBox.textContent = message;
      messageBox.className = 'lineage-message error';
      return;
    }
    await load();
  }

  function chip(node, onRemove) {
    const holderElement = element('span', 'lineage-chip');
    const dot = element('span', 'lineage-dot');
    dot.style.backgroundColor = node.color ? '#' + node.color : '#bdbdbd';
    const link = element('a', '', node.title);
    link.href = viewUrl(node.id);
    holderElement.append(dot, link);
    if (node.category) {
      holderElement.append(element('small', 'text-muted', node.category));
    }
    if (onRemove) {
      const remove = element('button', '', '×');
      remove.type = 'button';
      remove.title = 'Remove this link';
      remove.setAttribute('aria-label', 'Remove this link');
      remove.addEventListener('click', onRemove);
      holderElement.append(remove);
    }
    return holderElement;
  }

  // a search to add an entry as a parent or a daughter
  function adder(placeholder, onPick) {
    const wrap = element('span', 'lineage-add');
    const input = element('input');
    input.type = 'search';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', placeholder);
    const results = element('div', 'lineage-results');
    results.hidden = true;
    let timer = 0;
    input.addEventListener('input', function () {
      window.clearTimeout(timer);
      const term = input.value.trim();
      if (term === '') {
        results.hidden = true;
        return;
      }
      timer = window.setTimeout(async function () {
        const response = await fetch('api/v2/inventory?limit=10&q=' + encodeURIComponent(term), { credentials: 'same-origin' });
        const entries = response.ok ? await response.json() : [];
        results.textContent = '';
        entries.filter(function (entry) {
          return entry.id !== entryId;
        }).forEach(function (entry) {
          const button = element('button', '', '#' + entry.id + ' ' + entry.title + (entry.category_title ? ' (' + entry.category_title + ')' : ''));
          button.type = 'button';
          button.addEventListener('click', function () {
            results.hidden = true;
            input.value = '';
            onPick(entry);
          });
          results.append(button);
        });
        if (results.children.length === 0) {
          results.append(element('div', 'p-2 text-muted', 'Nothing found.'));
        }
        results.hidden = false;
      }, 250);
    });
    document.addEventListener('click', function (event) {
      if (!wrap.contains(event.target)) {
        results.hidden = true;
      }
    });
    wrap.append(input, results);
    return wrap;
  }

  // the generation of every entry of the family: parents above (negative), daughters below
  function generations() {
    const level = { [entryId]: 0 };
    const queue = [entryId];
    while (queue.length > 0) {
      const current = queue.shift();
      data.links.forEach(function (link) {
        const daughter = link[0];
        const parent = link[1];
        if (daughter === current && level[parent] === undefined) {
          level[parent] = level[current] - 1;
          queue.push(parent);
        }
        if (parent === current && level[daughter] === undefined) {
          level[daughter] = level[current] + 1;
          queue.push(daughter);
        }
      });
    }
    return level;
  }

  function tree() {
    const level = generations();
    const rows = {};
    data.nodes.forEach(function (node) {
      if (level[node.id] !== undefined) {
        (rows[level[node.id]] = rows[level[node.id]] || []).push(node);
      }
    });
    const wrap = element('div', 'lineage-tree');
    const rowsBox = element('div', 'lineage-tree-rows');
    const boxes = {};
    Object.keys(rows).map(Number).sort(function (a, b) {
      return a - b;
    }).forEach(function (generation) {
      const row = element('div', 'lineage-generation');
      rows[generation].forEach(function (node) {
        const box = element('a', 'lineage-node' + (node.id === entryId ? ' current' : ''));
        box.href = viewUrl(node.id);
        const dot = element('span', 'lineage-dot');
        dot.style.backgroundColor = node.color ? '#' + node.color : '#bdbdbd';
        box.append(dot, document.createTextNode(node.title));
        boxes[node.id] = box;
        row.append(box);
      });
      rowsBox.append(row);
    });
    const svgNs = 'http://www.w3.org/2000/svg';
    const lines = document.createElementNS(svgNs, 'svg');
    lines.setAttribute('class', 'lineage-lines');
    wrap.append(lines, rowsBox);
    // the lines are drawn once the boxes have a place: from the bottom of a parent to the top of its daughter
    window.requestAnimationFrame(function () {
      const origin = rowsBox.getBoundingClientRect();
      lines.setAttribute('width', String(rowsBox.scrollWidth));
      lines.setAttribute('height', String(rowsBox.scrollHeight));
      data.links.forEach(function (link) {
        const daughterBox = boxes[link[0]];
        const parentBox = boxes[link[1]];
        if (!daughterBox || !parentBox) {
          return;
        }
        const a = parentBox.getBoundingClientRect();
        const b = daughterBox.getBoundingClientRect();
        const x1 = a.left - origin.left + a.width / 2;
        const y1 = a.bottom - origin.top;
        const x2 = b.left - origin.left + b.width / 2;
        const y2 = b.top - origin.top;
        const middle = (y1 + y2) / 2;
        const path = document.createElementNS(svgNs, 'path');
        path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + middle + ' ' + x2 + ',' + middle + ' ' + x2 + ',' + y2);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#8a93a0');
        path.setAttribute('stroke-width', '1.6');
        lines.append(path);
      });
    });
    return wrap;
  }

  function render() {
    root.textContent = '';
    const canWrite = data.entry.canWrite;
    const columns = element('div', 'lineage-columns');
    const message = element('p', 'lineage-message');

    const parents = element('div', 'lineage-column');
    parents.append(element('h4', '', 'Parents: what it was made from'));
    data.parents.forEach(function (node) {
      parents.append(chip(node, canWrite ? function () {
        change('remove', entryId, node.id, message);
      } : null));
    });
    if (data.parents.length === 0) {
      parents.append(element('p', 'text-muted mb-1', 'No parent.'));
    }
    if (canWrite) {
      parents.append(adder('Add a parent...', function (entry) {
        change('add', entryId, entry.id, message);
      }));
    }

    const daughters = element('div', 'lineage-column');
    daughters.append(element('h4', '', 'Daughters: what was made from it'));
    data.daughters.forEach(function (node) {
      daughters.append(chip(node, node.canWrite ? function () {
        change('remove', node.id, entryId, message);
      } : null));
    });
    if (data.daughters.length === 0) {
      daughters.append(element('p', 'text-muted mb-1', 'No daughter.'));
    }
    // a daughter is edited, not this entry: the server checks that the requester can edit it
    daughters.append(adder('Add a daughter...', function (entry) {
      change('add', entry.id, entryId, message);
    }));

    columns.append(parents, daughters);
    root.append(columns, message);
    if (data.nodes.length > 1) {
      root.append(element('h4', 'mt-3', 'Family tree'), tree());
    }
  }

  load().catch(function (error) {
    root.textContent = error.message || String(error);
  });
})();
