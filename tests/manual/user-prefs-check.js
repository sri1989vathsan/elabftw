/**
 * Check for the per-user interface settings kept on the server (calendar page view, hidden projects, Google calendar
 * sync choices). Run it in the browser console on any eLabFTW page, logged in:
 *
 *     const result = await userPrefsCheck(); console.log(JSON.stringify(result, null, 2));
 *
 * It saves a setting, reads it back, removes it, and tries a setting that is not allowed. For the real round trip,
 * choose "Day" on the calendar page in one browser, then open the calendar in another browser (or a private window) logged
 * in as the same user: it must open on Day. The Google token and the sync snapshots stay in the browser on purpose.
 */
async function userPrefsCheck() {
  const csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
  const call = async body => {
    const response = await fetch('/api/v2/experiments_folders', {
      method: 'PATCH',
      headers: { 'X-CSRF-Token': csrf, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null; try { data = await response.json(); } catch (e) { /* no body */ }
    return { status: response.status, data };
  };
  const problems = [];
  const key = 'elabftw-calendar-page-view';
  const before = (await call({ action: 'get_user_prefs' })).data?.prefs ?? {};
  const set = await call({ action: 'set_user_pref', key, value: 'day' });
  if (set.status >= 300) problems.push(`saving failed (${set.status})`);
  const got = (await call({ action: 'get_user_prefs' })).data?.prefs ?? {};
  if (got[key] !== 'day') problems.push(`read back ${JSON.stringify(got[key])} instead of "day"`);
  const bad = await call({ action: 'set_user_pref', key: 'somethingElse', value: 'x' });
  if (bad.status < 400) problems.push('a setting that is not allowed was accepted');
  // the Boards page: board or canvas, the last project tab and the card density of a project (any project id), but not any other name
  for (const [boardKey, boardValue] of [['pm-canvas-view', '1'], ['pm-last-project', '7'], ['elabftw-pm-density-7', 'expanded'], ['elabftw-pm-density-all', 'compact']]) {
    const was = (await call({ action: 'get_user_prefs' })).data?.prefs?.[boardKey];
    const saved = await call({ action: 'set_user_pref', key: boardKey, value: boardValue });
    if (saved.status >= 300) problems.push(`saving ${boardKey} failed (${saved.status})`);
    const back = (await call({ action: 'get_user_prefs' })).data?.prefs ?? {};
    if (back[boardKey] !== boardValue) problems.push(`${boardKey}: read back ${JSON.stringify(back[boardKey])} instead of ${JSON.stringify(boardValue)}`);
    await call(was === undefined ? { action: 'set_user_pref', key: boardKey } : { action: 'set_user_pref', key: boardKey, value: was });
  }
  const badDensity = await call({ action: 'set_user_pref', key: 'elabftw-pm-density-evil', value: 'expanded' });
  if (badDensity.status < 400) problems.push('a card density key that is not a project was accepted');
  // put back what was there
  if (before[key] === undefined) await call({ action: 'set_user_pref', key }); else await call({ action: 'set_user_pref', key, value: before[key] });
  const after = (await call({ action: 'get_user_prefs' })).data?.prefs ?? {};
  if (after[key] !== before[key]) problems.push('the setting was not put back');
  return { verdict: problems.length ? 'PROBLEMS' : 'OK', problems };
}
