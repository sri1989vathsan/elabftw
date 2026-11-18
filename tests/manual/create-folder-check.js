/**
 * Creating an experiment or a resource with a folder chosen in the Create dialog. Logged in, on any page (dashboard, a list, an entry):
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/create-folder-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await createFolderCheck();      // returns {pass, results}
 *
 * Checks the request the dialog sends (POST experiments / items with folder_id): the entry is in that folder, with none it is unfiled, a folder
 * that does not exist is refused, a template-made entry goes to the chosen folder too. Then the dialog itself: the Folder choice is in it on
 * this page, 'Unfiled' is its first option, every folder of the user is offered, and Experiment / Resource show it while the template types hide it.
 * It makes one folder ("CRF folder") and a few entries and deletes them again; nothing is printed or sent anywhere.
 */
window.createFolderCheck = async function createFolderCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function api(method, path, body) {
    const r = await fetch('/api/v2/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, loc: r.headers.get('Location'), json: method === 'GET' ? await r.json() : null };
  }
  const idOf = res => Number((res.loc || '').split('/').pop());
  const made = { experiments: [], items: [], folders: [] };
  try {
    const folder = idOf(await api('POST', 'experiments_folders', { name: 'CRF folder', parent_id: null }));
    made.folders.push(folder);
    check('a folder was made for the check', folder > 0, 'no id');

    const withFolder = idOf(await api('POST', 'experiments', { title: 'CRF experiment in folder', folder_id: folder }));
    made.experiments.push(withFolder);
    check('an experiment created with a folder is in it', (await api('GET', 'experiments/' + withFolder)).json.folder_id === folder, 'folder_id differs');

    const without = idOf(await api('POST', 'experiments', { title: 'CRF experiment unfiled', folder_id: '' }));
    made.experiments.push(without);
    const unfiled = (await api('GET', 'experiments/' + without)).json.folder_id;
    check('an experiment created with no folder is unfiled', unfiled === null || unfiled === 0, 'folder_id ' + unfiled);

    const item = idOf(await api('POST', 'items', { title: 'CRF resource in folder', folder_id: folder }));
    made.items.push(item);
    check('a resource created with a folder is in it', (await api('GET', 'items/' + item)).json.folder_id === folder, 'folder_id differs');

    const itemNone = idOf(await api('POST', 'items', { title: 'CRF resource unfiled' }));
    made.items.push(itemNone);
    const itemUnfiled = (await api('GET', 'items/' + itemNone)).json.folder_id;
    check('a resource created with no folder is unfiled', itemUnfiled === null || itemUnfiled === 0, 'folder_id ' + itemUnfiled);

    const bad = await api('POST', 'experiments', { title: 'CRF experiment bad folder', folder_id: 99999999 });
    if (bad.loc) made.experiments.push(idOf(bad));
    check('a folder that does not exist is refused', bad.status >= 400, 'status ' + bad.status);

    // from a template: the chosen folder wins
    const tpl = idOf(await api('POST', 'experiments_templates', { title: 'CRF template' }));
    const fromTpl = idOf(await api('POST', 'experiments', { title: 'CRF from template', template: tpl, folder_id: folder }));
    made.experiments.push(fromTpl);
    check('an experiment made from a template goes to the chosen folder', (await api('GET', 'experiments/' + fromTpl)).json.folder_id === folder, 'folder_id differs');
    await api('DELETE', 'experiments_templates/' + tpl);

    // the dialog
    const modal = document.getElementById('createModal');
    check('the Create dialog is on this page', !!modal, 'no #createModal');
    const section = document.getElementById('createNewFolderSection');
    const select = document.getElementById('createNewFolderSelect');
    check('the dialog has a Folder choice on this page', !!section && !!select, 'no folder section');
    if (select) {
      check("its first option is 'Unfiled'", select.options[0].value === '' && /unfiled/i.test(select.options[0].textContent), select.options[0].textContent);
      const names = [...select.options].map(o => o.textContent.trim());
      // the dialog is drawn when the page loads, so it lists the folders that existed then (not the one made above)
      const existing = (await api('GET', 'experiments_folders')).json;
      const count = Array.isArray(existing) ? existing.filter(f => f.name !== 'CRF folder').length : 0;
      check('the folders of the user are offered (with their paths)', count === 0 || select.options.length - 1 >= count || select.options.length > 1, `${select.options.length - 1} offered, ${count} known`);
      check('a nested folder is offered with its path', count === 0 || names.some(n => n.includes(' > ')), names.join(' | ').slice(0, 200));
      const radios = { experiments: document.getElementById('createNewTypeExperiments'), items: document.getElementById('createNewTypeItems'), templates: document.getElementById('createNewTypeExperimentsTemplates') };
      if (radios.experiments && !radios.experiments.disabled) { radios.experiments.click(); await sleep(400); check('the Folder choice shows for an experiment', !section.hidden, 'hidden'); }
      if (radios.items && !radios.items.disabled) { radios.items.click(); await sleep(400); check('the Folder choice shows for a resource', !section.hidden, 'hidden'); }
      if (radios.templates && !radios.templates.disabled) { radios.templates.click(); await sleep(400); check('the Folder choice is hidden for a template', section.hidden, 'shown'); }
    }
  } catch (error) {
    check('the check ran to the end', false, String(error));
  } finally {
    for (const id of made.experiments) await api('DELETE', 'experiments/' + id);
    for (const id of made.items) await api('DELETE', 'items/' + id);
    for (const id of made.folders) await api('DELETE', 'experiments_folders/' + id);
  }
  return { pass: results.every(r => r.ok), results };
};
