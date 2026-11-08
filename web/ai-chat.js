/**
 * The assistant bubble (bottom right of every page, loaded by footer.html only when a sysadmin turned the search by meaning on): a Find tab (describe what
 * is needed, get the entries that fit) and, when the chat is on too, a Chat tab (ask questions about the entries). The model runs on the lab's own machines.
 * The conversation is kept in this browser tab only (sessionStorage). On the page of an entry, the entry is what the chat's questions are about.
 */
(function () {
  'use strict';
  if (document.getElementById('aiChatBubble')) {
    return;
  }
  const KEY = 'aiChatConversation';
  const chatOn = !!document.currentScript && document.currentScript.dataset.chat === '1';
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
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
  // the entry of the page, when the page shows one
  const focus = (function () {
    const params = new URLSearchParams(window.location.search);
    const id = parseInt(params.get('id'), 10);
    const page = window.location.pathname.split('/').pop();
    const types = { 'registry.php': 'inventory', 'experiments.php': 'experiments', 'database.php': 'items' };
    return types[page] && id > 0 && ['view', 'edit'].indexOf(params.get('mode')) >= 0 ? { type: types[page], id: id } : null;
  })();

  let state = { open: false, turns: [], tab: 'find', query: '', must: [] };
  try {
    state = Object.assign(state, JSON.parse(sessionStorage.getItem(KEY) || '{}'));
  } catch (error) {
    state = { open: false, turns: [], tab: 'find', query: '', must: [] };
  }
  if (!Array.isArray(state.must)) {
    state.must = [];
  }
  if (!chatOn || ['find', 'chat'].indexOf(state.tab) < 0) {
    state.tab = 'find';
  }
  const remember = function () {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch (error) {
      // the conversation is only not kept
    }
  };

  const style = make('style');
  style.textContent = [
    '#aiChatBubble{position:fixed;right:20px;bottom:20px;z-index:1040;width:56px;height:56px;border-radius:50%;border:0;background:var(--primary,#167b85);color:#fff;font-size:22px;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer}',
    '#aiChatBubble:hover{filter:brightness(1.1)}',
    '#aiChatPanel{position:fixed;right:20px;bottom:88px;z-index:1040;width:390px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 110px);display:flex;flex-direction:column;background:var(--white,#fff);color:inherit;border:1px solid rgba(128,128,128,.4);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.3);overflow:hidden}',
    '#aiChatPanel[hidden]{display:none}',
    '#aiChatPanel .ai-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--primary,#167b85);color:#fff}',
    '#aiChatPanel .ai-head button{background:none;border:0;color:#fff;font-size:15px;margin-left:10px;cursor:pointer}',
    '#aiChatPanel .ai-log{flex:1;overflow-y:auto;padding:12px}',
    '#aiChatPanel .ai-msg{margin-bottom:10px;padding:8px 10px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word;font-size:14px}',
    '#aiChatPanel .ai-user{background:rgba(22,123,133,.15);margin-left:34px}',
    '#aiChatPanel .ai-bot{border:1px solid rgba(128,128,128,.35);margin-right:20px}',
    '#aiChatPanel .ai-src{font-size:12px;margin-top:6px;white-space:normal}',
    '#aiChatPanel .ai-src a{display:inline-block;margin-right:8px}',
    '#aiChatPanel .ai-note{font-size:12px;opacity:.7;padding:0 12px 6px}',
    '#aiChatPanel form{display:flex;padding:10px;border-top:1px solid rgba(128,128,128,.3)}',
    '#aiChatPanel input[type=text]{flex:1;margin-right:8px}',
    '#aiChatPanel .ai-tabs{display:flex;border-bottom:1px solid rgba(128,128,128,.3)}',
    '#aiChatPanel .ai-tabs button{flex:1;background:none;border:0;border-bottom:3px solid transparent;padding:8px;cursor:pointer;color:inherit;font-weight:600;opacity:.65}',
    '#aiChatPanel .ai-tabs button.on{border-bottom-color:var(--primary,#167b85);opacity:1}',
    '#aiChatPanel .ai-view{flex:1;display:flex;flex-direction:column;min-height:0}',
    '#aiChatPanel .ai-view[hidden]{display:none}',
    '#aiChatPanel .ai-hit{display:block;padding:8px 10px;margin-bottom:8px;border:1px solid rgba(128,128,128,.35);border-radius:10px;color:inherit;text-decoration:none}',
    '#aiChatPanel .ai-hit:hover{background:rgba(22,123,133,.1);color:inherit;text-decoration:none}',
    '#aiChatPanel .ai-hit small{display:block;opacity:.7}',
    '#aiChatPanel .ai-filters{padding:0 12px 6px;font-size:12px}',
    '#aiChatPanel .ai-filters:empty{display:none}',
    '#aiChatPanel .ai-chip{display:inline-block;margin:0 6px 6px 0;padding:2px 8px;border-radius:12px;border:1px solid var(--primary,#167b85);background:none;color:inherit;font-size:12px;cursor:pointer}',
    '#aiChatPanel .ai-chip.must{background:var(--primary,#167b85);color:#fff}',
    '#aiChatPanel .ai-chip.maybe{border-style:dashed;opacity:.85}',
    '#aiChatPanel .ai-filters select{max-width:100%;font-size:12px;padding:2px 6px;height:auto;margin-bottom:4px}',
    '#aiChatPanel .ai-has{color:#1a7f37}',
    '#aiChatPanel .ai-lacks{color:#b35900}',
    '@media print{#aiChatBubble,#aiChatPanel{display:none!important}}',
  ].join('\n');
  document.head.append(style);

  const bubble = make('button', { id: 'aiChatBubble', type: 'button', 'aria-label': 'Open the assistant', title: chatOn ? 'Find or ask' : 'Find in your lab' });
  bubble.append(make('i', { class: 'fas fa-comments', 'aria-hidden': 'true' }));
  const panel = make('div', { id: 'aiChatPanel', role: 'dialog', 'aria-label': 'Assistant', hidden: 'hidden' });
  const head = make('div', { class: 'ai-head' });
  head.append(make('strong', {}, chatOn ? 'Ask your lab' : 'Find in your lab'));
  const tools = make('span');
  const fresh = make('button', { type: 'button', title: 'New conversation', 'aria-label': 'New conversation' });
  fresh.append(make('i', { class: 'fas fa-rotate-right', 'aria-hidden': 'true' }));
  const close = make('button', { type: 'button', title: 'Close', 'aria-label': 'Close' });
  close.append(make('i', { class: 'fas fa-xmark', 'aria-hidden': 'true' }));
  tools.append(fresh, close);
  head.append(tools);
  // Find: describe what is needed, get the entries that fit
  const findView = make('div', { class: 'ai-view' });
  const results = make('div', { class: 'ai-log' });
  const findNote = make('div', { class: 'ai-note' }, 'Describe what you need in your own words. Only entries you can read are shown.');
  const findForm = make('form');
  const findInput = make('input', { type: 'text', class: 'form-control', placeholder: 'For example: GFP plasmid with puromycin resistance', 'aria-label': 'What do you need', autocomplete: 'off' });
  const findGo = make('button', { type: 'submit', class: 'btn btn-primary' }, 'Find');
  findForm.append(findInput, findGo);
  const filters = make('div', { class: 'ai-filters' });
  findView.append(results, filters, findNote, findForm);
  // Chat: questions about the entries (only when the chat is on)
  const chatView = make('div', { class: 'ai-view' });
  const log = make('div', { class: 'ai-log' });
  const note = make('div', { class: 'ai-note' }, (focus ? 'About the entry on this page. ' : '') + 'Answers come from entries you can read, on the lab\'s own model. Kept in this tab only.');
  const form = make('form');
  const input = make('input', { type: 'text', class: 'form-control', placeholder: 'Ask about plasmids, antibodies, experiments...', 'aria-label': 'Your question', autocomplete: 'off' });
  const send = make('button', { type: 'submit', class: 'btn btn-primary' }, 'Send');
  form.append(input, send);
  chatView.append(log, note, form);
  const tabs = make('div', { class: 'ai-tabs' });
  const tabFind = make('button', { type: 'button' }, 'Find');
  const tabChat = make('button', { type: 'button' }, 'Chat');
  tabs.append(tabFind, tabChat);
  panel.append(head);
  if (chatOn) {
    panel.append(tabs);
  }
  panel.append(findView);
  if (chatOn) {
    panel.append(chatView);
  }
  document.body.append(panel, bubble);

  const add = function (role, text) {
    const row = make('div', { class: 'ai-msg ' + (role === 'user' ? 'ai-user' : 'ai-bot') });
    row.append(make('div', {}, text));
    log.append(row);
    log.scrollTop = log.scrollHeight;
    return row;
  };
  const setTab = function (name) {
    state.tab = chatOn && name === 'chat' ? 'chat' : 'find';
    findView.hidden = state.tab !== 'find';
    chatView.hidden = state.tab !== 'chat';
    tabFind.className = state.tab === 'find' ? 'on' : '';
    tabChat.className = state.tab === 'chat' ? 'on' : '';
    fresh.hidden = state.tab !== 'chat';
    remember();
    if (!panel.hidden) {
      (state.tab === 'chat' ? input : findInput).focus();
    }
  };
  const show = function (open) {
    state.open = open;
    panel.hidden = !open;
    bubble.setAttribute('aria-label', open ? 'Close the assistant' : 'Open the assistant');
    remember();
    if (open) {
      (state.tab === 'chat' ? input : findInput).focus();
      log.scrollTop = log.scrollHeight;
    }
  };
  const redraw = function () {
    log.textContent = '';
    if (!state.turns.length) {
      add('assistant', 'Hello. Ask me what the lab has: for example "which plasmids carry a tet-inducible promoter?" or "what could replace this entry?". I only know the entries you can read, and I say so when nothing fits.');
    }
    state.turns.forEach(function (turn) {
      add(turn.role, turn.content);
    });
  };

  tabFind.addEventListener('click', function () {
    setTab('find');
  });
  tabChat.addEventListener('click', function () {
    setTab('chat');
  });
  const labels = { inventory: 'Database', experiments: 'Experiment', items: 'Resource' };
  findInput.value = state.query || '';
  // the parts that can be asked for (GFP, Puromycin resistance ...), read once from the server
  let vocab = null;
  let understood = [];
  const post = function (body) {
    return fetch('ai-search.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json();
    });
  };
  const drawFilters = function () {
    filters.textContent = '';
    if (!state.query) {
      return;
    }
    // must: every result has to carry it (filled); maybe: the question mentions it, results that carry more of them come first (dashed)
    state.must.forEach(function (name) {
      const chip = make('button', { type: 'button', class: 'ai-chip must', title: 'Only entries that contain this. Click to remove.' }, name + ' ✕');
      chip.addEventListener('click', function () {
        state.must = state.must.filter(function (x) {
          return x !== name;
        });
        search(state.query);
      });
      filters.append(chip);
    });
    understood.filter(function (name) {
      return state.must.indexOf(name) < 0;
    }).forEach(function (name) {
      const chip = make('button', { type: 'button', class: 'ai-chip maybe', title: 'Asked for in your words. Click to require it in every result.' }, name);
      chip.addEventListener('click', function () {
        state.must.push(name);
        search(state.query);
      });
      filters.append(chip);
    });
    if (vocab && vocab.length) {
      const pick = make('select', { class: 'form-select form-select-sm', 'aria-label': 'Only entries that contain' });
      pick.append(make('option', { value: '' }, '+ Only entries that contain...'));
      let group = null;
      let optgroup = null;
      vocab.forEach(function (item) {
        if (state.must.indexOf(item.name) >= 0) {
          return;
        }
        if (item.group !== group) {
          group = item.group;
          optgroup = make('optgroup', { label: group });
          pick.append(optgroup);
        }
        optgroup.append(make('option', { value: item.name }, item.name));
      });
      pick.addEventListener('change', function () {
        if (pick.value) {
          state.must.push(pick.value);
          search(state.query);
        }
      });
      filters.append(pick);
    }
  };
  const search = function (text) {
    state.query = text;
    remember();
    results.textContent = '';
    results.append(make('div', { class: 'ai-msg', style: 'opacity:.7' }, 'Searching...'));
    findGo.disabled = true;
    post({ action: 'search', query: text, limit: 8, must: state.must }).then(function (data) {
      findGo.disabled = false;
      results.textContent = '';
      if (data.error) {
        results.append(make('div', { class: 'ai-msg ai-bot' }, data.message || data.error));
        return;
      }
      understood = Array.isArray(data.understood) ? data.understood : [];
      drawFilters();
      if (!data.hits.length) {
        results.append(make('div', { class: 'ai-msg ai-bot' }, 'Nothing fits' + (state.must.length ? ' with all of: ' + state.must.join(', ') + '. Remove one below.' : (data.searched ? '.' : ' (no entries are read by the model yet: an admin has to build the index).'))));
        return;
      }
      data.hits.forEach(function (hit) {
        const link = make('a', { class: 'ai-hit', href: hit.url });
        link.append(make('strong', {}, hit.title || '(no title)'));
        link.append(make('small', {}, (labels[hit.type] || hit.type) + ' #' + hit.id + ' · ' + Math.round(hit.score * 100) + '%'));
        if ((hit.has && hit.has.length) || (hit.lacks && hit.lacks.length)) {
          const parts = make('small', {});
          if (hit.has && hit.has.length) {
            parts.append(make('span', { class: 'ai-has' }, '✓ ' + hit.has.join(' · ')));
          }
          if (hit.lacks && hit.lacks.length) {
            parts.append(make('span', { class: 'ai-lacks' }, (hit.has && hit.has.length ? '   ' : '') + '✗ no ' + hit.lacks.join(' · ')));
          }
          link.append(parts);
        }
        const snippet = hit.snippet || '';
        link.append(make('small', {}, snippet.length > 130 ? snippet.slice(0, 130) + '...' : snippet));
        results.append(link);
      });
      results.scrollTop = 0;
    }).catch(function () {
      findGo.disabled = false;
      results.textContent = '';
      results.append(make('div', { class: 'ai-msg ai-bot' }, 'The server did not answer.'));
    });
  };
  findForm.addEventListener('submit', function (event) {
    event.preventDefault();
    const text = findInput.value.trim();
    if (!text || findGo.disabled) {
      return;
    }
    // a new question starts without the parts that were required for the last one
    if (text !== state.query) {
      state.must = [];
    }
    search(text);
  });
  fetch('ai-search.php?status=1', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(function (response) {
    return response.json();
  }).then(function (data) {
    vocab = Array.isArray(data.vocab) ? data.vocab : null;
    drawFilters();
  }).catch(function () {
    // without the list only the parts found in the question are offered
  });

  bubble.addEventListener('click', function () {
    show(panel.hidden);
  });
  close.addEventListener('click', function () {
    show(false);
  });
  fresh.addEventListener('click', function () {
    state.turns = [];
    remember();
    redraw();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden && panel.contains(document.activeElement)) {
      show(false);
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) {
      return;
    }
    input.value = '';
    const history = state.turns.map(function (turn) {
      return { role: turn.role, content: turn.content };
    });
    history.push({ role: 'user', content: text });
    state.turns.push({ role: 'user', content: text });
    add('user', text);
    const row = add('assistant', 'Thinking...');
    const textNode = row.firstChild;
    send.disabled = true;
    let answer = '';
    let failed = false;
    const finish = function () {
      send.disabled = false;
      if (failed || !answer) {
        state.turns.pop();
      } else {
        state.turns.push({ role: 'assistant', content: answer });
      }
      remember();
    };
    const handle = function (line) {
      if (line.error) {
        textNode.textContent = (answer ? answer + '\n\n' : '') + line.error;
        failed = true;
        return;
      }
      if (line.sources) {
        textNode.textContent = 'Writing the answer...';
      }
      if (line.delta) {
        answer += line.delta;
        textNode.textContent = answer;
      }
      log.scrollTop = log.scrollHeight;
    };
    fetch('ai-search.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
      body: JSON.stringify({ action: 'chat', messages: history, focus: focus, stream: true }),
    }).then(function (response) {
      if (!response.body || (response.headers.get('Content-Type') || '').indexOf('json') >= 0) {
        return response.json().then(function (data) {
          textNode.textContent = data.message || data.error || 'No answer.';
          failed = true;
        });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      const pump = function () {
        return reader.read().then(function (step) {
          pending += decoder.decode(step.value || new Uint8Array(), { stream: !step.done });
          let at = pending.indexOf('\n');
          while (at >= 0) {
            const raw = pending.slice(0, at).trim();
            pending = pending.slice(at + 1);
            if (raw) {
              try {
                handle(JSON.parse(raw));
              } catch (error) {
                failed = true;
              }
            }
            at = pending.indexOf('\n');
          }
          return step.done ? undefined : pump();
        });
      };
      return pump();
    }).catch(function () {
      textNode.textContent = (answer ? answer + '\n\n' : '') + 'The server did not answer.';
      failed = true;
    }).then(function () {
      if (!answer && !failed) {
        textNode.textContent = '(no answer)';
      }
      finish();
    });
  });

  redraw();
  setTab(state.tab);
  show(!!state.open);
})();
