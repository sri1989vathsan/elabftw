/**
 * End-to-end check of the Google Calendar sync against the Google stand-in (google-stub.js).
 *
 * On http://localhost:8973/dashboard.php, logged in (see TEST-ACCOUNTS.md), with the administrator switch ON and the client ID
 * set in Sysconfig, run:
 *   for (const f of ['google-stub.js', 'google-calendar-check.js']) {
 *     await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/' + f; s.onload = r; document.head.appendChild(s); });
 *   }
 *   await googleCalendarCheck();      // returns {pass, results}
 *
 * It creates "GCAL" to-dos, plays "the user in Google" (move, lengthen, delete, add events) and checks the fake calendars and
 * the to-dos. It deletes its to-dos and settings afterwards.
 */
window.googleCalendarCheck = async function () {
  var results = [];
  var created = [];
  function check(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: ok ? undefined : detail }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function api(method, path, body) {
    var r = await fetch('/api/v2/' + path, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, loc: r.headers.get('Location'), json: method === 'GET' ? await r.json() : null };
  }
  function button(label) {
    return Array.prototype.find.call(document.querySelectorAll('#googleSyncRow button'), function (b) { return b.textContent.trim().indexOf(label) === 0; });
  }
  function box(text) {
    var l = Array.prototype.find.call(document.querySelectorAll('#googleSyncRow label'), function (x) { return x.textContent.indexOf(text) !== -1; });
    return l ? l.querySelector('input') : null;
  }
  async function sync() { button('Sync now').click(); await wait(4500); }
  function at(n, h, m) { var d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; }
  function mine() { return __gstub.events('alice@example.test').filter(function (e) { return /GCAL/.test(e.summary || '') && e.status !== 'cancelled'; }); }
  async function todo(id) { return (await api('GET', 'todolist/' + id)).json; }
  var minutes = function (e) { return (new Date(e.end.dateTime) - new Date(e.start.dateTime)) / 60000; };

  try {
    __gstub.reset();
    Object.keys(localStorage).filter(function (k) { return /^googleSync(Calendar|Target|ImportEvents|CalendarsShown)/.test(k); }).forEach(function (k) { localStorage.removeItem(k); });
    for (var spec of [{ content: 'GCAL alpha', deadline: at(1, 14, 30).toISOString(), duration_minutes: 90 }, { content: 'GCAL beta', deadline: at(2, 9, 0).toISOString() }]) {
      created.push(Number((await api('POST', 'todolist', spec)).loc.split('/').pop()));
    }
    localStorage.setItem('googleSyncTwoWay', '1');
    box('Google Calendar (').click();
    await wait(300);
    box('New events of that calendar').click();
    button('Connect').click();
    await wait(3500);
    var events = mine();
    check('C1 the to-dos become events with the right length', events.length === 2 && events.some(function (e) { return /alpha/.test(e.summary) && minutes(e) === 90; }) && events.some(function (e) { return /beta/.test(e.summary) && minutes(e) === 30; }), events);
    check('C1b the events carry the task marker and a link back', events.every(function (e) { return e.extendedProperties && e.extendedProperties.private.elabftwTask && /projectmanagement\.php\?task=/.test(e.description); }), events);
    check('C1c the panel lists the calendars', document.querySelectorAll('#googleSyncRow input[name^="googleCal-"]').length === 3, document.getElementById('googleSyncRow').textContent);

    await api('PATCH', 'todolist/' + created[1], { duration_minutes: 120 });
    await sync();
    var beta = mine().find(function (e) { return /beta/.test(e.summary); });
    check('C3 a longer task makes a longer event', beta && minutes(beta) === 120, beta);

    __gstub.editEvent(mine().find(function (e) { return /alpha/.test(e.summary); }).id, { start: at(1, 16, 0).toISOString(), end: at(1, 18, 0).toISOString() });
    await sync();
    var alpha = await todo(created[0]);
    check('C4 an event moved and lengthened in Google changes the task', new Date(alpha.deadline).getTime() === at(1, 16, 0).getTime() && alpha.duration_minutes === 120, alpha);

    __gstub.removeEvent(mine().find(function (e) { return /beta/.test(e.summary); }).id);
    await sync();
    check('C5 an event deleted in Google is not made again', !mine().some(function (e) { return /beta/.test(e.summary); }), mine());
    await api('PATCH', 'todolist/' + created[1], { duration_minutes: 60 });
    await sync();
    check('C5b changing the task makes it again', mine().some(function (e) { return /beta/.test(e.summary) && minutes(e) === 60; }), mine());

    await api('PATCH', 'todolist/' + created[0], { completed: true });
    await sync();
    check('C6 a done task gets a tick in front of its event', mine().concat(__gstub.events('alice@example.test')).some(function (e) { return /^✓ GCAL alpha/.test(e.summary || ''); }), __gstub.events('alice@example.test'));

    __gstub.addEvent('alice@example.test', 'GCAL from google', at(3, 11, 0).toISOString(), at(3, 12, 30).toISOString());
    await sync();
    await wait(1500);
    var list = (await api('GET', 'todolist?scope=assigned&limit=100&offset=0')).json;
    var imported = list.find(function (t) { return t.body === 'GCAL from google'; });
    if (imported) { created.push(imported.id); }
    check('C7 a new event becomes a to-do with its length', imported && imported.duration_minutes === 90, imported);

    // the calendar page: events of a shown calendar come through, the tasks are not doubled
    __gstub.addEvent('lab@group.calendar', 'GCAL seminar', at(2, 15, 0).toISOString(), at(2, 16, 0).toISOString());
    var got = null;
    window.addEventListener('elabftw:calendar-events', function (e) { got = e.detail.events; }, { once: false });
    box('Lab calendar').click();
    window.dispatchEvent(new CustomEvent('elabftw:calendar-range', { detail: { from: at(-3, 0, 0).toISOString(), to: at(10, 0, 0).toISOString() } }));
    await wait(2500);
    check('C8 events of a shown calendar are sent to the calendar page', got && got.some(function (e) { return e.title === 'GCAL seminar' && e.source === 'Lab calendar'; }), got);
    check('C8b the events that are tasks are not sent again', got && !got.some(function (e) { return /GCAL (alpha|beta|from)/.test(e.title); }), got);
  } catch (error) {
    check('no error', false, String(error && error.stack || error));
  }
  for (var id of created) { await api('DELETE', 'todolist/' + id); }
  Object.keys(localStorage).filter(function (k) { return /^googleSync(Calendar|Target|ImportEvents|CalendarsShown)/.test(k); }).forEach(function (k) { localStorage.removeItem(k); });
  __gstub.reset();
  return { pass: results.every(function (r) { return r.ok; }), results: results };
};
