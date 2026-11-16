/**
 * A stand-in for Google sign-in, the Google Tasks API and the Google Calendar API, for testing
 * src/ts/googleSync.ts without a Google account or internet access.
 *
 * Load it on the dashboard BEFORE clicking Connect:
 *   var s = document.createElement('script'); s.src = '/__tests/google-stub.js'; document.head.appendChild(s);
 * (served by tests/manual/dev-proxy.js; eval is blocked by the CSP).
 *
 * It defines window.google (so the real Google script is never loaded) and
 * wraps window.fetch for https://tasks.googleapis.com only. The fake Google
 * data lives in localStorage ('__gstub') so it survives page reloads, and
 * window.__gstub lets a test act as "the user in Google":
 *   __gstub.tasks()              all tasks in the eLabFTW list
 *   __gstub.add(title, due, notes)   add a task by hand
 *   __gstub.tick(idOrTitle)      tick a task
 *   __gstub.edit(idOrTitle, {title, due})
 *   __gstub.remove(idOrTitle)    delete a task
 *   __gstub.reset()              empty the fake Google
 *   __gstub.expireToken()        make the next call answer 401
 * Calendar (three fake calendars: alice@example.test = primary, lab@group.calendar = read only, work@x = writable):
 *   __gstub.events(calendarId)   the events of a calendar
 *   __gstub.addEvent(calendarId, summary, startISO, endISO)
 *   __gstub.editEvent(summaryOrId, {summary, start, end})   (start and end as ISO strings)
 *   __gstub.removeEvent(summaryOrId)   deleted in Google
 */
(function () {
  var KEY = '__gstub';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { lists: [], tasks: {}, next: 1, expired: false }; } catch (e) { return { lists: [], tasks: {}, next: 1, expired: false }; }
  }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function listId(db) { return db.lists.length ? db.lists[0].id : null; }
  function tasksOf(db) { var id = listId(db); return id ? (db.tasks[id] = db.tasks[id] || []) : []; }
  function find(db, ref) {
    return tasksOf(db).find(function (t) { return t.id === ref || t.title === ref; });
  }

  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: function (config) {
          return {
            requestAccessToken: function () {
              setTimeout(function () {
                var db = load();
                db.expired = false;
                save(db);
                config.callback({ access_token: 'stub-token', expires_in: 3600, scope: config.scope });
              }, 50);
            },
          };
        },
        revoke: function (token, done) { if (done) { done(); } },
      },
    },
  };

  var realFetch = window.fetch.bind(window);
  var CAL = 'https://www.googleapis.com/calendar/v3';
  var CALENDARS = [
    { id: 'alice@example.test', summary: 'Alice', primary: true, accessRole: 'owner', backgroundColor: '#0b8043' },
    { id: 'lab@group.calendar', summary: 'Lab calendar', accessRole: 'reader', backgroundColor: '#d50000' },
    { id: 'work@x', summary: 'Work', accessRole: 'writer', backgroundColor: '#3f51b5' },
  ];
  function calendarId(raw) { var id = decodeURIComponent(raw); return id === 'primary' ? 'alice@example.test' : id; }
  function eventsOf(db, id) { db.events = db.events || {}; return (db.events[id] = db.events[id] || []); }
  function handleCalendar(url, init) {
    var db = load();
    var method = (init && init.method) || 'GET';
    var query = url.slice(CAL.length).split('?')[1] || '';
    var path = url.slice(CAL.length).split('?')[0];
    var body = init && init.body ? JSON.parse(init.body) : null;
    var params = new URLSearchParams(query);
    function json(status, data) {
      return Promise.resolve(new Response(data === null ? null : JSON.stringify(data), { status: status, headers: { 'Content-Type': 'application/json' } }));
    }
    if (db.expired) { return json(401, { error: 'expired' }); }
    if (path === '/users/me/calendarList') { return json(200, { items: CALENDARS }); }
    var m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    if (!m) { return json(404, { error: 'stub does not know ' + method + ' ' + path }); }
    var list = eventsOf(db, calendarId(m[1]));
    if (method === 'GET') {
      var from = new Date(params.get('timeMin')).getTime();
      var to = new Date(params.get('timeMax')).getTime();
      return json(200, { items: list.filter(function (e) {
        var start = e.start && e.start.dateTime ? new Date(e.start.dateTime).getTime() : null;
        return start === null || (start >= from && start < to);
      }) });
    }
    if (method === 'POST') {
      var created = Object.assign({ id: 'E' + db.next++, status: 'confirmed' }, body);
      list.push(created);
      save(db);
      return json(200, created);
    }
    if (method === 'PATCH' && m[2]) {
      var e = list.find(function (x) { return x.id === decodeURIComponent(m[2]); });
      if (!e) { return json(404, {}); }
      Object.keys(body).forEach(function (k) {
        if (k === 'extendedProperties') {
          e.extendedProperties = { private: Object.assign({}, e.extendedProperties && e.extendedProperties.private, body.extendedProperties.private) };
        } else { e[k] = body[k]; }
      });
      save(db);
      return json(200, e);
    }
    return json(404, {});
  }

  window.fetch = function (url, init) {
    url = String(url);
    if (url.indexOf(CAL) === 0) { return handleCalendar(url, init); }
    if (url.indexOf('https://tasks.googleapis.com/tasks/v1') !== 0) {
      return realFetch(url, init);
    }
    var db = load();
    var method = (init && init.method) || 'GET';
    var path = url.slice('https://tasks.googleapis.com/tasks/v1'.length).split('?')[0];
    var body = init && init.body ? JSON.parse(init.body) : null;
    function json(status, data) {
      return Promise.resolve(new Response(data === null ? null : JSON.stringify(data), { status: status, headers: { 'Content-Type': 'application/json' } }));
    }
    if (db.expired) { return json(401, { error: 'expired' }); }
    if (path === '/users/@me/lists' && method === 'GET') { return json(200, { items: db.lists }); }
    if (path === '/users/@me/lists' && method === 'POST') {
      var list = { id: 'L' + db.next++, title: body.title };
      db.lists.push(list);
      save(db);
      return json(200, list);
    }
    var m = /^\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/.exec(path);
    if (m) {
      var tasks = db.tasks[decodeURIComponent(m[1])] = db.tasks[decodeURIComponent(m[1])] || [];
      if (method === 'GET') { return json(200, { items: tasks }); }
      if (method === 'POST') {
        var task = { id: 'T' + db.next++, status: 'needsAction', title: body.title, notes: body.notes || '' };
        if (body.due) { task.due = body.due; }
        tasks.push(task);
        save(db);
        return json(200, task);
      }
      if (method === 'PATCH' && m[2]) {
        var t = tasks.find(function (x) { return x.id === decodeURIComponent(m[2]); });
        if (!t) { return json(404, {}); }
        Object.keys(body).forEach(function (k) { if (body[k] === null) { delete t[k]; } else { t[k] = body[k]; } });
        save(db);
        return json(200, t);
      }
    }
    return json(404, { error: 'stub does not know ' + method + ' ' + path });
  };

  window.__gstub = {
    tasks: function () { return tasksOf(load()); },
    add: function (title, due, notes) {
      var db = load();
      if (!listId(db)) { db.lists.push({ id: 'L' + db.next++, title: 'eLabFTW' }); }
      var t = { id: 'T' + db.next++, status: 'needsAction', title: title, notes: notes || '' };
      if (due) { t.due = due + 'T00:00:00.000Z'; }
      tasksOf(db).push(t);
      save(db);
    },
    tick: function (ref) { var db = load(); find(db, ref).status = 'completed'; save(db); },
    edit: function (ref, changes) {
      var db = load();
      var t = find(db, ref);
      if (changes.title !== undefined) { t.title = changes.title; }
      if (changes.due !== undefined) { t.due = changes.due + 'T00:00:00.000Z'; }
      save(db);
    },
    remove: function (ref) {
      var db = load();
      var id = listId(db);
      db.tasks[id] = tasksOf(db).filter(function (t) { return t.id !== ref && t.title !== ref; });
      save(db);
    },
    events: function (id) { return eventsOf(load(), id || 'alice@example.test'); },
    addEvent: function (id, summary, start, end) {
      var db = load();
      eventsOf(db, id).push({ id: 'E' + db.next++, status: 'confirmed', summary: summary, start: { dateTime: start }, end: { dateTime: end } });
      save(db);
    },
    editEvent: function (ref, changes) {
      var db = load();
      Object.keys(db.events || {}).forEach(function (id) {
        db.events[id].forEach(function (e) {
          if (e.id !== ref && e.summary !== ref) { return; }
          if (changes.summary !== undefined) { e.summary = changes.summary; }
          if (changes.start !== undefined) { e.start = { dateTime: changes.start }; }
          if (changes.end !== undefined) { e.end = { dateTime: changes.end }; }
        });
      });
      save(db);
    },
    removeEvent: function (ref) {
      var db = load();
      Object.keys(db.events || {}).forEach(function (id) {
        db.events[id].forEach(function (e) { if (e.id === ref || e.summary === ref) { e.status = 'cancelled'; } });
      });
      save(db);
    },
    reset: function () { localStorage.removeItem(KEY); },
    expireToken: function () { var db = load(); db.expired = true; save(db); },
  };
}());
