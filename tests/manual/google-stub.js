/**
 * A stand-in for Google sign-in and the Google Tasks API, for testing
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
                config.callback({ access_token: 'stub-token', expires_in: 3600 });
              }, 50);
            },
          };
        },
        revoke: function (token, done) { if (done) { done(); } },
      },
    },
  };

  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, init) {
    url = String(url);
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
    if (path === '/users/@me/tasklists' && method === 'GET') { return json(200, { items: db.lists }); }
    if (path === '/users/@me/tasklists' && method === 'POST') {
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
    reset: function () { localStorage.removeItem(KEY); },
    expireToken: function () { var db = load(); db.expired = true; save(db); },
  };
}());
