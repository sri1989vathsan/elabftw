/**
 * Shop sheet PDF matched to orders: the team setting "move that order from Ordered to Collected automatically" (default ON). Logged in as a
 * team admin, on any page:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/orders-autocollect-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await ordersAutocollectCheck();      // {pass, results}
 * A procurement number is only set on an order by the PDF of its confirmation, so seed the orders first (SQL on the test database; team = yours):
 *   INSERT INTO custom_orders (team, userid, title, status, procurement_id) VALUES
 *     (1, 4, 'ZZ auto ordered', 'ordered', '7654321'), (1, 4, 'ZZ auto requested', 'requested', '7654321'),
 *     (1, 4, 'ZZ auto collected', 'collected', '7654321'), (1, 4, 'ZZ auto ordered B', 'ordered', '7654322');
 * then call ordersAutocollectCheck({ on: { number: '7654321', ordered: <id>, requested: <id>, collected: <id> }, off: { number: '7654322', ordered: <id> } }).
 * It drops a generated one-page PDF ("Rustschein <number>") through the same endpoint as the board (POST order_sheets): with the setting on (the default)
 * the Ordered order of that PDF becomes Collected and nothing else moves; with it off nothing moves. The setting is put back to what it was.
 * Nothing is sent anywhere; the PDFs are attached to the test orders (delete them afterwards).
 */
window.ordersAutocollectCheck = async function ordersAutocollectCheck(seeded) {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const api = async (method, path, body) => {
    const r = await fetch('/api/v2/' + path, { method, credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, loc: r.headers.get('Location'), json: method === 'GET' ? await r.json() : null };
  };
  const sheet = number => {
    const bin = atob('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA3NyA+PgpzdHJlYW0KQlQgL0YxIDE0IFRmIDcyIDcyMCBUZCAoUnVzdHNjaGVpbiA3NjU0MzIxIGFydGljbGUgSFBBMDI5Mzk3LTEwMFUgMjAyNikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzNjggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MzgKJSVFT0Y=').replace('7654321', number);
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'application/pdf' });
  };
  const drop = async (number, name) => {
    const form = new FormData(); form.append('file', sheet(number), name);
    const r = await fetch('/api/v2/order_sheets', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const statusOf = async id => (await api('GET', 'orders/' + id)).json.status;
  const original = (await api('GET', 'teams/current')).json.orders_autocollect_on_sheet;
  check('the setting exists on the team (default 1)', original === 0 || original === 1, JSON.stringify(original));
  check('the seeded orders were given', !!(seeded && seeded.on && seeded.off), 'call ordersAutocollectCheck({ on, off }) as described above');
  if (!(seeded && seeded.on && seeded.off)) return { pass: false, results };
  try {
    const on = seeded.on.number; const off = seeded.off.number; const a = seeded.on; const b = seeded.off;
    await api('PATCH', 'teams/current', { orders_autocollect_on_sheet: 1 });
    const dropOn = await drop(on, 'ZZ-autocollect-on-' + Date.now() + '.pdf');
    check('the PDF is matched to the three orders', dropOn.body && dropOn.body.status === 'attached' && dropOn.body.orders.length === 3, JSON.stringify(dropOn));
    check('on: the drop result says 1 order moved to Collected', dropOn.body && dropOn.body.collected === 1, JSON.stringify(dropOn.body));
    check('on: the Ordered order is now Collected', await statusOf(a.ordered) === 'collected', await statusOf(a.ordered));
    check('on: the Requested order is left alone', await statusOf(a.requested) === 'requested', await statusOf(a.requested));
    check('on: the Collected order stays Collected (never backwards or sideways)', await statusOf(a.collected) === 'collected', await statusOf(a.collected));

    await api('PATCH', 'teams/current', { orders_autocollect_on_sheet: 0 });
    const dropOff = await drop(off, 'ZZ-autocollect-off-' + Date.now() + '.pdf');
    check('off: the PDF is attached', dropOff.body && dropOff.body.status === 'attached', JSON.stringify(dropOff));
    check('off: nothing is moved (the drop result says 0)', dropOff.body && !dropOff.body.collected, JSON.stringify(dropOff.body));
    check('off: the Ordered order stays Ordered', await statusOf(b.ordered) === 'ordered', await statusOf(b.ordered));
  } catch (error) {
    check('the check ran to the end', false, String(error));
  } finally {
    await api('PATCH', 'teams/current', { orders_autocollect_on_sheet: original === 0 ? 0 : 1 });
  }
  return { pass: results.every(r => r.ok), results };
};
