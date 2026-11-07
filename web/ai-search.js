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

  // the chat: asks questions about the entries and gets suggestions with the entries as sources; the conversation stays in this page only
  const addChat = function () {
    const params = new URLSearchParams(window.location.search);
    const focus = ['inventory', 'experiments', 'items'].indexOf(params.get('type')) >= 0 && parseInt(params.get('id'), 10) > 0
      ? { type: params.get('type'), id: parseInt(params.get('id'), 10) } : null;
    const history = [];
    const box = make('div', { class: 'mt-5' });
    const head = make('div', { class: 'd-flex justify-content-between align-items-center' });
    head.append(make('h3', {}, 'Chat'));
    const reset = make('button', { type: 'button', class: 'btn btn-sm btn-secondary' }, 'New conversation');
    head.append(reset);
    box.append(head, make('p', { class: 'text-muted' }, (focus ? 'It knows the entry you came from. ' : '') + 'Ask for a plasmid, an antibody or an experiment, or for alternatives to an entry. It answers only from the entries of this lab that you can read, and says when nothing fits. The conversation is not saved.'));
    const log = make('div', { class: 'mb-3' });
    const form = make('form', { class: 'd-flex' });
    const input = make('input', { type: 'text', class: 'form-control mr-2', placeholder: 'For example: what could I use instead of EF1 as a promoter?', 'aria-label': 'Your question' });
    const send = make('button', { type: 'submit', class: 'btn btn-primary' }, 'Send');
    form.append(input, send);
    box.append(log, form);
    root.append(box);
    const bubble = function (who, text) {
      const row = make('div', { class: 'mb-2 p-2 rounded ' + (who === 'user' ? 'bg-light' : 'border') });
      row.append(make('div', { class: 'small text-muted' }, who === 'user' ? 'You' : 'Assistant'), make('div', { style: 'white-space: pre-wrap' }, text));
      log.append(row);
      return row;
    };
    reset.addEventListener('click', function () {
      history.length = 0;
      log.textContent = '';
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) {
        return;
      }
      input.value = '';
      history.push({ role: 'user', content: text });
      bubble('user', text);
      const waiting = bubble('assistant', 'Thinking... (a local model can take 10 to 30 seconds)');
      send.disabled = true;
      api({ action: 'chat', messages: history, focus: focus }).then(function (data) {
        send.disabled = false;
        if (data.error) {
          waiting.lastChild.textContent = data.message || data.error;
          history.pop();
          return;
        }
        waiting.lastChild.textContent = data.answer || '(no answer)';
        history.push({ role: 'assistant', content: data.answer || '' });
        if (data.sources && data.sources.length) {
          const list = make('div', { class: 'small mt-2' });
          list.append(make('span', { class: 'text-muted mr-1' }, 'Entries it looked at:'));
          data.sources.forEach(function (hit, n) {
            const link = make('a', { href: hit.url, class: 'mr-2' }, '[' + (n + 1) + '] ' + (hit.title || '#' + hit.id));
            list.append(link);
          });
          waiting.append(list);
        }
      }).catch(function () {
        send.disabled = false;
        waiting.lastChild.textContent = 'The server did not answer.';
        history.pop();
      });
    });
  };

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
    if (status.chat) {
      addChat();
    }
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
