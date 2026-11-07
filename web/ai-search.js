/**
 * Find by meaning (find.php): a box to describe what is needed, the entries that fit best, and (when an admin turned it on) a short note on why each fits.
 */
(function () {
  'use strict';
  const root = document.getElementById('findApp');
  if (!root) {
    return;
  }
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : (root.dataset.csrf || '');
  };
  const api = function (body) {
    return fetch('ai-search.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json().then(function (data) {
        data.status = response.status;
        return data;
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
  const labels = { inventory: 'Database', experiments: 'Experiment', items: 'Resource' };

  fetch('ai-search.php?status=1', { credentials: 'same-origin' }).then(function (response) {
    return response.json();
  }).then(function (status) {
    root.textContent = '';
    if (!status.enabled) {
      root.append(make('div', { class: 'alert alert-info' }, status.forced_off
        ? 'The search by meaning is switched off on this server.'
        : 'The search by meaning is turned off. A sysadmin can turn it on in the admin panel (Database tab, Find by meaning).'));
      return;
    }
    const form = make('form', { class: 'mb-3' });
    const area = make('textarea', { class: 'form-control mb-2', rows: '3', placeholder: 'For example: a plasmid with GFP and puromycin resistance for mammalian cells', 'aria-label': 'What do you need' });
    const boxes = make('div', { class: 'mb-2' });
    const picks = {};
    [['inventory', 'Database'], ['experiments', 'Experiments'], ['items', 'Resources']].forEach(function (pair) {
      const label = make('label', { class: 'mr-3' });
      const box = make('input', { type: 'checkbox', checked: 'checked', class: 'mr-1' });
      picks[pair[0]] = box;
      label.append(box, pair[1]);
      boxes.append(label);
    });
    const button = make('button', { type: 'submit', class: 'btn btn-primary' }, 'Find');
    form.append(area, boxes, button);
    const out = make('div', { id: 'findResults' });
    root.append(form, out);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const types = Object.keys(picks).filter(function (key) {
        return picks[key].checked;
      });
      out.textContent = '';
      out.append(make('span', { class: 'text-muted' }, 'Searching...'));
      button.disabled = true;
      api({ action: 'search', query: area.value, types: types }).then(function (data) {
        button.disabled = false;
        out.textContent = '';
        if (data.error) {
          out.append(make('div', { class: 'alert alert-warning' }, data.message || data.error));
          return;
        }
        if (data.explanation) {
          const note = make('div', { class: 'alert alert-secondary', style: 'white-space: pre-wrap' }, data.explanation);
          out.append(note);
        }
        if (!data.hits.length) {
          out.append(make('div', { class: 'text-muted' }, 'Nothing fits' + (data.searched ? '' : ' (no entries are read by the model yet: an admin has to build the index)') + '.'));
          return;
        }
        const list = make('div', { class: 'list-group' });
        data.hits.forEach(function (hit) {
          const item = make('a', { class: 'list-group-item list-group-item-action', href: hit.url });
          const head = make('div', { class: 'd-flex justify-content-between' });
          head.append(make('strong', {}, hit.title || '(no title)'), make('span', { class: 'text-muted small' }, (labels[hit.type] || hit.type) + ' #' + hit.id + ' · ' + Math.round(hit.score * 100) + '%'));
          item.append(head, make('div', { class: 'small text-muted' }, hit.snippet.length > 220 ? hit.snippet.slice(0, 220) + '...' : hit.snippet));
          list.append(item);
        });
        out.append(list);
      });
    });
  });
})();
