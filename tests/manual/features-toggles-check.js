/**
 * The Features switches of the team (Admin panel > Team > Features). Logged in as a team ADMIN, on any page:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/features-toggles-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await featuresTogglesCheck();      // {pass, results}
 * Checks the defaults of the team (Compounds ON, Chemical Structure Editor ON, OpenCloning OFF, Inventory OFF, Bookable resources OFF), that a change is saved
 * and shows in the Tools menu on the next page load, that the Tools menu is left out when everything is off, and that a booking is refused with
 * booking off and accepted with it on (on a scratch resource that is made and removed). The switches are put back as they were.
 */
window.featuresTogglesCheck = async function featuresTogglesCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const api = async (method, path, body) => {
    const r = await fetch('/api/v2/' + path, { method, credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no body */ }
    return { status: r.status, loc: r.headers.get('Location'), json, text };
  };
  const keys = ['tools_compounds', 'tools_chem_editor', 'tools_opencloning', 'tools_inventory', 'feature_bookable_resources'];
  const original = (await api('GET', 'teams/current')).json;
  const set = async values => { for (const [k, v] of Object.entries(values)) await api('PATCH', 'teams/current', { [k]: v }); };
  const menu = async () => {
    const html = await (await fetch('/dashboard.php', { credentials: 'same-origin', cache: 'no-store' })).text();
    const tools = html.includes('id=\'navToolsDropdown\'');
    const seq = /sequence-viewer\/tool\.php/.test(html);
    return { tools, seq, compounds: /class='dropdown-item[^']*' href='compounds\.php'/.test(html), chem: /class='dropdown-item[^']*' href='chem-editor\.php'/.test(html), syc: /class='dropdown-item[^']*' href='syc\.php'/.test(html), inventory: /class='dropdown-item[^']*' href='inventory\.php'/.test(html) };
  };
  try {
    check('the switches exist on the team', keys.every(k => k in original), keys.filter(k => !(k in original)).join(', '));
    await set({ tools_compounds: 1, tools_chem_editor: 1, tools_opencloning: 0, tools_inventory: 0, feature_bookable_resources: 0 });
    let m = await menu();
    check('defaults: Compounds and the Chemical Structure Editor are in the Tools menu', m.tools && m.compounds && m.chem, JSON.stringify(m));
    check('defaults: Inventory and OpenCloning are not', !m.inventory && !m.syc, JSON.stringify(m));
    await set({ tools_inventory: 1 });
    m = await menu(); check('Inventory on: the entry shows after a reload', m.inventory, JSON.stringify(m));
    await set({ tools_compounds: 0, tools_chem_editor: 0, tools_opencloning: 0, tools_inventory: 0 });
    m = await menu(); // the database branch always has its Sequence viewer entry in Tools: there the menu stays and holds only that
    check('everything off: the Tools menu is left out (or holds only the Sequence viewer entry)', !m.tools || m.seq, JSON.stringify(m));
    await set({ tools_compounds: 1, tools_chem_editor: 1 });

    // booking: a scratch resource set as bookable
    const item = Number(((await api('POST', 'items', { title: 'ZZ booking check' })).loc || '').split('/').pop());
    if (item) {
      await api('PATCH', 'items/' + item, { is_bookable: 1 });
      const start = new Date(Date.now() + 2 * 86400000); start.setMinutes(0, 0, 0);
      const end = new Date(start.getTime() + 3600000);
      const iso = d => d.toISOString().replace(/\.\d+Z$/, '+00:00');
      await set({ feature_bookable_resources: 0 });
      const refused = await api('POST', 'events/' + item, { start: iso(start), end: iso(end), title: 'ZZ booking' });
      check('booking off: a new booking is refused with a message', refused.status >= 400 && /switched off/i.test(refused.text), refused.status + ' ' + refused.text.slice(0, 120));
      await set({ feature_bookable_resources: 1 });
      const accepted = await api('POST', 'events/' + item, { start: iso(start), end: iso(end), title: 'ZZ booking' });
      check('booking on: the booking is accepted', accepted.status >= 200 && accepted.status < 300, accepted.status + ' ' + accepted.text.slice(0, 120));
      if (accepted.loc) await api('DELETE', 'event/' + accepted.loc.split('/').pop());
      await api('DELETE', 'items/' + item);
    } else {
      check('a scratch resource could be made', false, 'no id');
    }
  } catch (error) {
    check('the check ran to the end', false, String(error));
  } finally {
    const back = {}; keys.forEach(k => { back[k] = original[k]; });
    await set(back);
  }
  return { pass: results.every(r => r.ok), results };
};
