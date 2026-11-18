/**
 * The Database switches of the team (Admin panel > Team > Database): "Allow users to create Database entries" and "Allow users to create and edit
 * Modules", both ON by default. Logged in as a NORMAL user (not an admin), on any page of the database branch:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/database-toggles-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await databaseTogglesCheck();                  // the defaults: a user can create a module and an entry (and not delete the module)
 *   await databaseTogglesCheck({ off: true });     // after an admin switched both off: both refused with 403, and no Create buttons on the pages
 * It makes one module and one entry and removes them again (the module is only deleted by an admin: it is left archived if this user cannot).
 */
window.databaseTogglesCheck = async function databaseTogglesCheck(options) {
  const off = !!(options && options.off);
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const api = async (method, path, body) => {
    const r = await fetch('/api/v2/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, loc: r.headers.get('Location') };
  };
  const team = await (await fetch('/api/v2/teams/current', { credentials: 'same-origin' })).json();
  check('the switches exist on the team', 'users_canwrite_inventory' in team && 'users_canwrite_inventory_categories' in team, JSON.stringify(Object.keys(team).filter(k => k.includes('inventory'))));
  check(off ? 'both switches are off' : 'both switches are on (the default)', off ? team.users_canwrite_inventory === 0 && team.users_canwrite_inventory_categories === 0 : team.users_canwrite_inventory === 1 && team.users_canwrite_inventory_categories === 1, `${team.users_canwrite_inventory} / ${team.users_canwrite_inventory_categories}`);
  const created = [];
  try {
    const module = await api('POST', 'teams/current/registry_categories', { name: 'ZZ switch module', color: '#7a8591' });
    if (off) {
      check('off: a normal user cannot create a module (403)', module.status === 403, 'status ' + module.status);
    } else {
      check('on: a normal user can create a module', module.status >= 200 && module.status < 300, 'status ' + module.status);
      const id = Number((module.loc || '').split('/').pop());
      if (id) {
        created.push(id);
        const rename = await api('PATCH', 'teams/current/registry_categories/' + id, { title: 'ZZ switch module renamed' });
        check('on: a normal user can edit a module', rename.status >= 200 && rename.status < 300, 'status ' + rename.status);
        const del = await api('DELETE', 'teams/current/registry_categories/' + id);
        check('deleting a module stays with the admins (403 for a normal user)', del.status === 403, 'status ' + del.status);
      }
    }
    // an entry needs a module of the lab: the first one the user can see
    const modules = await (await fetch('/api/v2/teams/current/registry_categories', { credentials: 'same-origin' })).json();
    const lab = (modules || []).find(m => !m.is_personal);
    if (lab) {
      const entry = await api('POST', 'inventory', { title: 'ZZ switch entry', category: lab.id });
      if (off) check('off: a normal user cannot create a Database entry (403)', entry.status === 403, 'status ' + entry.status);
      else {
        check('on: a normal user can create a Database entry', entry.status >= 200 && entry.status < 300, 'status ' + entry.status);
        const entryId = Number((entry.loc || '').split('/').pop());
        if (entryId) await api('DELETE', 'inventory/' + entryId);
      }
      if (off) {
        const page = await (await fetch('/registry.php?category=' + lab.id, { credentials: 'same-origin' })).text();
        check('off: no "New entry" button on the module page', !page.includes('data-action=\'create-in-category\''), 'the button is there');
        const modulesPage = await (await fetch('/registry-categories.php', { credentials: 'same-origin' })).text();
        check('off: no "Create" button on the Modules page', !modulesPage.includes("data-action='toggle-modal' data-target='createCatStatModal'"), 'the button is there');
      }
    } else {
      check('there is a module of the lab to try an entry in', false, 'none');
    }
  } catch (error) {
    check('the check ran to the end', false, String(error));
  }
  return { pass: results.every(r => r.ok), results };
};
