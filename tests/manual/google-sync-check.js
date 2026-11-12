/**
 * End-to-end check of the Google Tasks two-way sync against the Google stand-in.
 *
 * On http://localhost:8973/dashboard.php, logged in (see TEST-ACCOUNTS.md), run:
 *   for (const f of ['google-stub.js', 'google-sync-check.js']) {
 *     await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/' + f; s.onload = r; document.head.appendChild(s); });
 *   }
 *   await googleSyncCheck();      // returns {pass, results}
 *
 * The administrator switch must be ON first (Sysconfig > Google Tasks sync), or the
 * panel row does not exist and the check stops at once.
 *
 * It creates four "GSTUB" to-dos, plays "the user in Google" (tick, rename,
 * move a date, add, delete) and checks what eLabFTW and the fake Google list
 * end up with. It deletes its to-dos and its settings afterwards.
 */
window.googleSyncCheck = async function () {
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
  async function sync() { button('Sync now').click(); await wait(4500); }
  function day(n, h, m) { var d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); }
  function ld(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function google() { return __gstub.tasks().filter(function (t) { return /GSTUB/.test(t.title); }); }
  async function todo(id) { return (await api('GET', 'todolist/' + id)).json; }

  try {
    __gstub.reset();
    ['googleSyncDetails', 'googleSyncSnapshot'].forEach(function (k) { localStorage.removeItem(k); });
    for (var spec of [{ content: 'GSTUB alpha', deadline: day(1, 14, 30) }, { content: 'GSTUB beta' }, { content: 'GSTUB gamma', deadline: day(2, 9, 0) }]) {
      created.push(Number((await api('POST', 'todolist', spec)).loc.split('/').pop()));
    }
    localStorage.setItem('googleSyncTwoWay', '1');
    // typing the client ID re-draws the panel, so it shows Connect and the saved box states
    var input = document.querySelector('#googleSyncRow input[type=text]');
    input.value = 'stub-client';
    input.dispatchEvent(new Event('change'));
    button('Connect').click();
    await wait(3000);
    var g = google();
    check('S1 first sync copies the to-dos with markers', g.length === 3 && g.every(function (t) { return /\[elabftw:todo:\d+\]/.test(t.notes); }), g);

    __gstub.tick('GSTUB alpha');
    __gstub.edit('GSTUB beta', { title: 'GSTUB beta renamed' });
    __gstub.edit('GSTUB gamma', { due: ld(5) });
    __gstub.add('GSTUB from google <b>bold</b>', ld(7), 'google note');
    await sync();
    await wait(4000);
    check('S2 tick in Google completes the to-do', (await todo(created[0])).completed_at !== null);
    check('S3 rename in Google renames the to-do', (await todo(created[1])).body === 'GSTUB beta renamed');
    var gamma = await todo(created[2]);
    var moved = new Date(gamma.deadline);
    check('S4 date moved in Google keeps the time of day', moved.getHours() === 9 && moved.getMinutes() === 0 && moved.getFullYear() + '-' + String(moved.getMonth() + 1).padStart(2, '0') + '-' + String(moved.getDate()).padStart(2, '0') === ld(5), gamma.deadline);
    var list = (await api('GET', 'todolist?scope=assigned&limit=300')).json;
    var imported = list.filter(function (t) { return t.body === 'GSTUB from google bold'; });
    check('S5 a task added in Google becomes one to-do, HTML stripped', imported.length === 1, imported);
    if (imported.length) { created.push(imported[0].id); }
    check('S6 the new Google task gets its marker', google().some(function (t) { return /GSTUB from google/.test(t.title) && /\[elabftw:todo:\d+\]/.test(t.notes); }));

    __gstub.remove('GSTUB gamma');
    await sync();
    check('S7 a task deleted in Google is not recreated', !google().some(function (t) { return t.title === 'GSTUB gamma'; }));
    check('S8 ... and the to-do stays open in eLabFTW', (await todo(created[2])).completed_at === null);

    var before = JSON.stringify(__gstub.tasks());
    await sync();
    check('S9 a second sync changes nothing', before === JSON.stringify(__gstub.tasks()));

    await api('PATCH', 'todolist/' + created[1], { completed: true });
    window.dispatchEvent(new CustomEvent('todolist-changed'));
    await wait(6500);
    check('S10 completing in eLabFTW completes the Google task', google().some(function (t) { return t.title === 'GSTUB beta renamed' && t.status === 'completed'; }));
    await api('PATCH', 'todolist/' + created[1], { completed: false });
    window.dispatchEvent(new CustomEvent('todolist-changed'));
    await wait(6500);
    check('S11 reopening in eLabFTW is not undone by the old Google tick', (await todo(created[1])).completed_at === null);

    sessionStorage.removeItem('googleSyncToken');
    await sync();
    check('S12 a missing Google token is renewed quietly', !!sessionStorage.getItem('googleSyncToken'));
  } catch (error) {
    check('script ran to the end', false, String(error));
  } finally {
    for (var id of created) { await fetch('/api/v2/todolist/' + id, { method: 'DELETE', credentials: 'same-origin' }); }
    ['googleSyncClientId', 'googleSyncEnabled', 'googleSyncTwoWay', 'googleSyncSnapshot', 'googleSyncDetails', '__gstub'].forEach(function (k) { localStorage.removeItem(k); });
    sessionStorage.removeItem('googleSyncToken');
  }
  return { pass: results.every(function (r) { return r.ok; }), results: results };
};
