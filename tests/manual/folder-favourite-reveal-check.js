#!/usr/bin/env node
/**
 * Clicking a favourite (bookmarked) folder in the Folders panel opens that folder in the panel: the panel is open on the next
 * page, the tree is expanded down to the folder, its row is marked as the current one and sits inside the panel's visible box,
 * and the "Other folders" section opens when the folder is inside it. Ctrl/cmd-click leaves the sidebar's state alone.
 *
 *   node tests/manual/folder-favourite-reveal-check.js http://localhost:8973 EMAIL PASSWORD [shot.png]
 *
 * Headless Chrome by DevTools protocol (cdp-lib.js). Makes "FAV top" > "FAV mid" > "FAV deep" (the first and the third
 * bookmarked, so the third is a bookmarked folder at depth 2 whose parent is not bookmarked, but sits under a bookmarked root),
 * and "FAV other" > "FAV other child" (only the child bookmarked, opened from the star list). A bookmarked folder's whole root branch is drawn
 * in the Bookmarked section, so nothing bookmarked sits in "Other folders"; the check still requires that section open if it were.
 * Deletes them at the end.
 * Pages with ?folder= are loaded fresh for each case, and again (reload) after the click.
 */
const { startChrome, sleep } = require('./cdp-lib');
const [base = 'http://localhost:8973', email, password, shotFile] = process.argv.slice(2);
if (!email || !password) { console.error('usage: folder-favourite-reveal-check.js BASEURL EMAIL PASSWORD [shot.png]'); process.exit(2); }

(async () => {
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -- ' + JSON.stringify(detail)}`); };
  const c = await startChrome(1400, 900);
  const made = [];
  const api = (method, path, body) => c.js(`const r = await fetch('/api/v2/${path}', {method: '${method}', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}, body: ${body ? `JSON.stringify(${JSON.stringify(body)})` : 'undefined'}});
    return {status: r.status, loc: r.headers.get('Location')}`);
  const mk = async (name, parent) => { const r = await api('POST', 'experiments_folders', { name, parent_id: parent }); const id = Number(r.loc.split('/').pop()); made.push(id); return id; };
  const fav = id => api('PATCH', 'experiments_folders', { action: 'toggle_favorite', folder_id: id });
  try {
    await c.login(base, email, password);
    await c.nav(`${base}/experiments.php`);
    await api('PATCH', 'experiments_folders', { action: 'set_folder_view', view: 'tree' });
    const top = await mk('FAV top', null), mid = await mk('FAV mid', top), deep = await mk('FAV deep', mid);
    const other = await mk('FAV other', null), otherChild = await mk('FAV other child', other);
    await fav(top); await fav(deep); await fav(otherChild);
    const uid = await c.js(`await new Promise(r => setTimeout(r, 0)); return document.querySelector('[data-current-user-id]')?.dataset.currentUserId ?? ''`);

    // a clean start: panel closed, everything collapsed, Other folders closed, tree view
    const reset = ids => c.js(`localStorage.removeItem('opened-sidepanel'); localStorage.setItem('collapsed-experiment-folders-v2-${uid}', JSON.stringify(${JSON.stringify(ids.map(String))})); localStorage.removeItem('other-folders-collapsed-v2-${uid}'); localStorage.setItem('elabftw-folders-view-${uid}', 'tree'); sessionStorage.clear(); return 0`);
    const state = id => c.js(`
      const panel = document.getElementById('foldersPanel');
      const node = document.querySelector('#foldersPanel .folder-node[data-folder-id="${id}"]');
      const vis = e => !!e && !e.hidden && e.getClientRects().length > 0;
      const row = node?.querySelector(':scope > .folder-row');
      const p = panel.getBoundingClientRect(), r = row ? row.getBoundingClientRect() : null;
      const anc = []; let n = node?.parentElement?.closest('.folder-node'); while (n) { anc.push(vis(n.querySelector(':scope > .folder-row')) && vis(n.querySelector(':scope > .folder-children'))); n = n.parentElement.closest('.folder-node'); }
      const other = document.querySelector('.other-folders-content');
      return {open: vis(panel), stored: localStorage.getItem('opened-sidepanel'), url: location.search, found: !!node, current: !!row?.classList.contains('is-current-folder'),
        others: [...document.querySelectorAll('#foldersPanel .is-current-folder')].length, ancestors: anc, rowVisible: vis(row) && r.top >= p.top - 1 && r.bottom <= p.bottom + 1,
        inOther: !!node?.closest('.other-folders-content'), otherOpen: other ? other.style.display !== 'none' : null}`);
    const waitPanel = async id => { for (let i = 0; i < 40; i++) { if (await c.js(`return !!document.querySelector('#foldersPanel .folder-node[data-folder-id="${id}"]') && !document.getElementById('foldersPanel').hidden`)) break; await sleep(250); } await sleep(600); };

    const cases = [
      { label: 'depth 1 (Bookmarked section)', id: top, anc: [], via: 'section', inOther: false },
      { label: 'depth 3 under a bookmarked root (Bookmarked section)', id: deep, anc: [top, mid], via: 'section', inOther: false },
      { label: 'depth 2 (star list)', id: otherChild, anc: [other], via: 'popover', inOther: false },
    ];
    for (const k of cases) {
      const allParents = [top, mid, other];
      await c.nav(`${base}/experiments.php`);
      await reset(allParents.filter(x => k.via === 'popover' || !k.anc.includes(x)));
      await c.nav(`${base}/experiments.php`);
      // open the panel as a user does (the opener in the rail) and bring the hidden branch into view for the click
      await c.js(`document.querySelector('[data-action="toggle-sidepanel"][data-target="folders"]:not([data-purpose="hide"])').click(); return 0`);
      await waitPanel(k.id === otherChild ? other : top);
      if (k.via === 'section') {
        await c.js(`${JSON.stringify(k.anc)}.forEach(a => { const t = document.querySelector('#foldersPanel [data-action="toggle-folder-children"][data-folder-id="' + a + '"]'); if (t && document.querySelector('#foldersPanel .folder-node[data-folder-id="' + a + '"] > .folder-children').style.display === 'none') t.click(); }); return 0`);
      } else {
        await c.js(`document.querySelector('#foldersPanel [data-popover="folderFavoritesMenu"]').click(); return 0`);
      }
      // ctrl-click first: it must not touch the sidebar (the page does not leave, the stored panel state stays what it was)
      const sel = k.via === 'section' ? `#foldersPanel .bookmarked-folders-section .folder-node[data-folder-id="${k.id}"] > .folder-row a[data-folder-entity-link]` : `#folderFavoritesMenu a[data-folder-id="${k.id}"]`;
      await c.js(`localStorage.setItem('opened-sidepanel', 'favorites'); const a = document.querySelector('${sel}'); a.addEventListener('click', e => e.preventDefault(), {once: true}); a.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, ctrlKey: true, button: 0})); return 0`);
      check(`${k.label}: ctrl-click leaves the sidebar state alone`, await c.js(`return localStorage.getItem('opened-sidepanel') === 'favorites' && location.search === ''`), await state(k.id));
      await c.js(`localStorage.removeItem('opened-sidepanel'); return 0`);
      // the real click
      await c.js(`document.querySelector('${sel}').dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, button: 0})); return 0`);
      await sleep(1200);
      await c.js(`return document.readyState`);
      await waitPanel(k.id);
      for (const phase of ['after the click', 'after a reload']) {
        if (phase === 'after a reload') { await reset(allParents); await c.js(`localStorage.setItem('opened-sidepanel', 'folders'); return 0`); await c.nav(`${base}/experiments.php?folder=${k.id}`); await waitPanel(k.id); }
        const s = await state(k.id);
        const good = s.open && s.url.includes(`folder=${k.id}`) && s.found && s.current && s.others === 1 && s.ancestors.every(Boolean) && s.rowVisible && (!s.inOther || s.otherOpen === true);
        check(`${k.label}: ${phase}: panel open, ancestors expanded, row current and visible${' (and Other folders open if it is in there)'}`, good, s);
      }
      if (shotFile && k === cases[1]) await c.shot(shotFile);
    }
  } catch (e) {
    check('script ran to the end', false, String(e && e.stack || e));
  } finally {
    for (const id of made.slice().reverse()) { try { await api('DELETE', `experiments_folders/${id}`); } catch { /* best effort */ } }
    await c.close();
  }
  const bad = results.filter(x => !x).length;
  console.log(bad ? `${bad} FAILED of ${results.length}` : `all ${results.length} passed`);
  process.exit(bad ? 1 : 0);
})();
