/**
 * The chat bubble (bottom right of every page, loaded by footer.html only when a sysadmin turned the chat on): asks questions about the entries and gets
 * suggestions. The model runs on the lab's own machines. The conversation is kept in this browser tab only (sessionStorage).
 * On the page of an entry, the entry is what the questions are about.
 */
(function () {
  'use strict';
  if (document.getElementById('aiChatBubble')) {
    return;
  }
  const KEY = 'aiChatConversation';
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

  let state = { open: false, turns: [] };
  try {
    state = Object.assign(state, JSON.parse(sessionStorage.getItem(KEY) || '{}'));
  } catch (error) {
    state = { open: false, turns: [] };
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
    '@media print{#aiChatBubble,#aiChatPanel{display:none!important}}',
  ].join('\n');
  document.head.append(style);

  const bubble = make('button', { id: 'aiChatBubble', type: 'button', 'aria-label': 'Open the chat', title: 'Ask the assistant' });
  bubble.append(make('i', { class: 'fas fa-comments', 'aria-hidden': 'true' }));
  const panel = make('div', { id: 'aiChatPanel', role: 'dialog', 'aria-label': 'Assistant', hidden: 'hidden' });
  const head = make('div', { class: 'ai-head' });
  head.append(make('strong', {}, 'Ask your lab'));
  const tools = make('span');
  const fresh = make('button', { type: 'button', title: 'New conversation', 'aria-label': 'New conversation' });
  fresh.append(make('i', { class: 'fas fa-rotate-right', 'aria-hidden': 'true' }));
  const close = make('button', { type: 'button', title: 'Close', 'aria-label': 'Close the chat' });
  close.append(make('i', { class: 'fas fa-xmark', 'aria-hidden': 'true' }));
  tools.append(fresh, close);
  head.append(tools);
  const log = make('div', { class: 'ai-log' });
  const note = make('div', { class: 'ai-note' }, (focus ? 'About the entry on this page. ' : '') + 'Answers come from entries you can read, on the lab\'s own model. Kept in this tab only.');
  const form = make('form');
  const input = make('input', { type: 'text', class: 'form-control', placeholder: 'Ask about plasmids, antibodies, experiments...', 'aria-label': 'Your question', autocomplete: 'off' });
  const send = make('button', { type: 'submit', class: 'btn btn-primary' }, 'Send');
  form.append(input, send);
  panel.append(head, log, note, form);
  document.body.append(panel, bubble);

  const add = function (role, text) {
    const row = make('div', { class: 'ai-msg ' + (role === 'user' ? 'ai-user' : 'ai-bot') });
    row.append(make('div', {}, text));
    log.append(row);
    log.scrollTop = log.scrollHeight;
    return row;
  };
  const show = function (open) {
    state.open = open;
    panel.hidden = !open;
    bubble.setAttribute('aria-label', open ? 'Close the chat' : 'Open the chat');
    remember();
    if (open) {
      input.focus();
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
  show(!!state.open);
})();
