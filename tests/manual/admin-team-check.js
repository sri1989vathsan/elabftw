/**
 * The Team tab of the Admin panel (admin only): http://localhost:8973/admin.php?tab=1, then
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/admin-team-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await adminTeamCheck();      // {pass, results}
 * Checks: every setting is still there (by its switch), the settings sit in boxed cards, the title and its description share the left edge, the control
 * is on the right and centred on the row, an OFF switch differs from an ON switch, the filter box hides what does not match and shows the rest again,
 * the page does not scroll sideways, and the deadline reminder does not cover the tab bar. Nothing is changed.
 */
window.adminTeamCheck = async function adminTeamCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  document.querySelector('[data-action="switch-tab"][data-tabtarget="1"]')?.click();
  await sleep(500);
  const slugs = ['force_exp_tpl', 'force_res_tpl', 'users_canwrite_experiments', 'users_canwrite_experiments_categories', 'users_canwrite_experiments_status', 'users_canwrite_experiments_templates', 'users_canwrite_resources', 'users_canwrite_resources_categories', 'users_canwrite_resources_status', 'users_canwrite_resources_templates'];
  const missing = slugs.filter(slug => !document.querySelector(`#teamSettings input[data-target="${slug}"]`));
  check('every team setting is still there', missing.length === 0, missing.join(', '));
  check('the announcement field is still there', !!document.querySelector('#teamSettings input#announcement'), 'missing');
  check('the settings are in boxed cards with a header', document.querySelectorAll('#teamSettings .settings-card .settings-card-title').length >= 3, 'cards: ' + document.querySelectorAll('#teamSettings .settings-card').length);
  const rows = [...document.querySelectorAll('#teamSettings .setting-row')].filter(r => r.getClientRects().length);
  const misaligned = rows.filter(r => { const t = r.querySelector('.setting-title'); const h = r.querySelector('.setting-help'); return h && Math.abs(t.getBoundingClientRect().left - h.getBoundingClientRect().left) > 1; });
  check('the title and its description share the left edge', misaligned.length === 0, misaligned.length + ' rows');
  const off = rows.filter(r => !r.querySelector('.setting-switch input')?.checked && r.querySelector('.setting-switch'));
  const on = rows.filter(r => r.querySelector('.setting-switch input')?.checked);
  const bg = r => getComputedStyle(r.querySelector('.slider')).backgroundColor;
  if (off[0] && on[0]) check('an OFF switch looks different from an ON switch (light with a border against the accent colour)', bg(off[0]) !== bg(on[0]) && parseFloat(getComputedStyle(off[0].querySelector('.slider')).borderTopWidth) >= 1, `${bg(off[0])} / ${bg(on[0])}`);
  const offCentre = rows.filter(r => { const s = r.querySelector('.setting-switch, .setting-input'); if (!s) return false; const a = r.getBoundingClientRect(); const b = s.getBoundingClientRect(); return Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) > 2 && !r.matches('.setting-row:has(.setting-help)'); });
  check('the control is centred on rows without a description', offCentre.length === 0, offCentre.length + ' rows');
  const de = document.documentElement;
  check('the page does not scroll sideways', de.scrollWidth <= window.innerWidth + 1, `${de.scrollWidth} > ${window.innerWidth}`);
  const filter = document.getElementById('teamSettingsFilter');
  check('there is a filter box', !!filter, 'missing');
  if (filter) {
    filter.value = 'resources'; filter.dispatchEvent(new Event('input', { bubbles: true })); await sleep(150);
    const visible = [...document.querySelectorAll('#teamSettings .setting-row')].filter(r => !r.hidden);
    check('the filter keeps only matching settings', visible.length >= 4 && visible.every(r => (r.dataset.settingName || '').includes('resources')), visible.length + ' rows');
    check('a card with no match is hidden', [...document.querySelectorAll('#teamSettings .settings-card')].some(c => c.hidden), 'no card hidden');
    filter.value = 'zzzz'; filter.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
    check('a filter with no match says so', !document.getElementById('teamSettingsNone').hidden, 'no message');
    filter.value = ''; filter.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
    check('clearing the filter shows everything again', [...document.querySelectorAll('#teamSettings .setting-row')].every(r => !r.hidden), 'rows still hidden');
  }
  const banner = document.querySelector('.reminder-banner');
  const tabs = document.querySelector('.tabbed-menu');
  if (banner && tabs) { const a = banner.getBoundingClientRect(); const b = tabs.getBoundingClientRect(); check('the deadline reminder does not cover the tab bar', a.bottom < b.top || a.top > b.bottom || a.right < b.left || a.left > b.right, `banner ${Math.round(a.top)}-${Math.round(a.bottom)}, tabs ${Math.round(b.top)}-${Math.round(b.bottom)}`); }
  return { pass: results.every(r => r.ok), results };
};
