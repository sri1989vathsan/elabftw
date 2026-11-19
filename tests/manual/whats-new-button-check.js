/**
 * The "What's new" button of the navbar (head.html #navWhatsNewButton, src/ts/whats-new-popup.ts, whats-new.php?popup=1). Logged in, on any page (the
 * dashboard is fine), in the browser console or through Chrome DevTools / Marionette:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/whats-new-button-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await whatsNewButtonCheck();      // {pass, results}
 * It changes the user's "seen" state and the popup opt-out through the same API the page uses (experiments_folders, set_user_pref) and leaves the
 * user with everything seen and the popup switched on. Nothing else is changed.
 *   1. the button is in the navbar of the dashboard, a list page, a view page, an edit page and the admin panel (the pages are fetched and read);
 *   2. with unseen entries: the page has the dot; a click opens the popup with entries, a link "Open the full guide", no dimming layer and a z-index
 *      below the other dialogs; Esc closes it and does not change the seen state; opening it twice works (one popup in the page);
 *   3. "Got it" with unseen entries stores the seen state: the dot is gone at once and on the next page;
 *   4. with nothing unseen: the popup opens and lists the latest seen entries, without a dot and without storing anything;
 *   5. the popup switched off (opt-out): the button still opens the popup.
 * The automatic popup after login (and the opt-out for it) is checked by whats-new-popup-check.js.
 */
window.whatsNewButtonCheck = async function whatsNewButtonCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content ?? '';
  const pref = async (key, value) => {
    const body = { action: 'set_user_pref', key, notifOnSaved: 0, notifOnError: 0 };
    if (value !== null) body.value = value;
    const r = await fetch('/api/v2/experiments_folders', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf() }, body: JSON.stringify(body) });
    return r.ok;
  };
  const page = async url => new DOMParser().parseFromString(await (await fetch(url, { credentials: 'same-origin' })).text(), 'text/html');
  const serverDot = async () => { const d = (await page('/dashboard.php')).querySelector('[data-whats-new-dot]'); return !!d && !d.hidden; };
  const popupEl = () => document.getElementById('whatsNewPopup');
  const shownPopup = () => { const p = popupEl(); return p && p.classList.contains('show') ? p : null; };
  const button = document.getElementById('navWhatsNewButton');
  const dot = () => document.querySelector('[data-whats-new-dot]');
  const closeAny = async () => { if (shownPopup()) { (shownPopup() ?? document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true })); await waitFor(() => !popupEl(), 2000); } };
  const unseenAll = JSON.stringify({ id: '__none__', date: '2000-01-01' });

  // 1. the button on the pages
  check('the button is on this page, labelled', button && button.getAttribute('aria-label') && button.title, 'no #navWhatsNewButton with a label');
  const mine = await (await fetch('/api/v2/experiments?limit=1', { credentials: 'same-origin' })).json().catch(() => []);
  const pages = ['/dashboard.php', '/experiments.php', '/database.php', '/admin.php', '/team.php'];
  if (Array.isArray(mine) && mine[0]) pages.push(`/experiments.php?mode=view&id=${mine[0].id}`, `/experiments.php?mode=edit&id=${mine[0].id}`);
  for (const url of pages) {
    const doc = await page(url);
    check(`the button is in the navbar of ${url}`, doc.getElementById('navWhatsNewButton') || /login\.php|403|Forbidden/i.test(doc.title) , 'missing');
  }

  // 2. unseen entries
  await closeAny();
  check('set: nothing seen yet, popup switched on', await pref('whats-new-seen', unseenAll) && await pref('whats-new-popup-off', null), 'could not set the preferences');
  check('the next page has the dot', await serverDot(), 'no dot in the dashboard');
  if (dot()) dot().hidden = false;
  button.click();
  let popup = await waitFor(shownPopup);
  check('a click opens the popup', popup, 'no .show popup');
  if (!popup) return { pass: false, results };
  const entries = popup.querySelectorAll('.whats-new-popup-featured, .whats-new-popup-compact li').length;
  check('it lists entries', entries > 0, 'no entries');
  check('it knows it has unseen entries', Number(popup.dataset.unseen) > 0 && popup.dataset.onDemand === '1', JSON.stringify(popup.dataset));
  check('it has "Open the full guide" to whats-new.php', [...popup.querySelectorAll('a')].some(a => /whats-new\.php$/.test(a.getAttribute('href') || '') && /full guide/i.test(a.textContent)), 'no link');
  check('its z-index is below the other dialogs (1050)', Number(getComputedStyle(popup).zIndex) < 1050, getComputedStyle(popup).zIndex);
  check('no dimming layer (the Back-to pill and the reminder chip stay usable)', !document.querySelector('.modal-backdrop'), 'a .modal-backdrop exists');
  check('keyboard focus is inside the popup', await waitFor(() => popup.contains(document.activeElement)), String(document.activeElement?.id || document.activeElement?.tagName));
  await closeAny();
  check('Esc closes it', !shownPopup(), 'still open');
  await sleep(500);
  check('Esc did not store the seen state (the dot is still there)', await serverDot(), 'the dot is gone');
  button.click();
  popup = await waitFor(shownPopup);
  check('opening it a second time works, with one popup in the page', popup && document.querySelectorAll('#whatsNewPopup').length === 1, 'second open failed');
  button.click();
  await sleep(300);
  check('clicking the button while it is open does not stack a second popup', document.querySelectorAll('#whatsNewPopup').length === 1, 'two popups');

  // 3. Got it
  popup.querySelector('[data-whats-new-got-it]').click();
  check('Got it closes it', await waitFor(() => !popup.classList.contains('show')), 'still open');
  check('the dot is gone at once', dot().hidden, 'dot still visible');
  await sleep(800);
  check('and on the next page', !(await serverDot()), 'the dashboard still has the dot');

  // 4. nothing unseen: the latest seen entries
  button.click();
  popup = await waitFor(shownPopup);
  check('with nothing unseen the button still opens the popup', popup, 'no popup');
  if (popup) {
    check('it lists the latest seen entries', popup.querySelectorAll('.whats-new-popup-featured, .whats-new-popup-compact li').length > 0 && Number(popup.dataset.unseen) === 0, JSON.stringify(popup.dataset));
    popup.querySelector('[data-whats-new-got-it]').click();
    await waitFor(() => !popup.classList.contains('show'));
  }
  check('Got it with nothing unseen leaves no dot', !(await serverDot()), 'dot appeared');

  // 5. opt-out: only the automatic popup is stopped
  await pref('whats-new-popup-off', '1');
  const fresh = await page('/dashboard.php');
  check('opted out: the button is still in the navbar', fresh.getElementById('navWhatsNewButton'), 'missing');
  check('opted out: the page has no popup of its own', !fresh.getElementById('whatsNewPopup'), 'a popup is drawn');
  button.click();
  popup = await waitFor(shownPopup);
  check('opted out: the button still opens the popup', popup && popup.querySelectorAll('.whats-new-popup-featured, .whats-new-popup-compact li').length > 0, 'no popup');
  await closeAny();

  // put the user back: switched on, everything seen
  await pref('whats-new-popup-off', null);
  const newest = (await (await fetch('/whats-new.php?popup=1', { credentials: 'same-origin' })).text()).match(/data-newest-id='([^']*)' data-newest-date='([^']*)'/);
  if (newest) await pref('whats-new-seen', JSON.stringify({ id: newest[1], date: newest[2] }));
  const pass = results.every(r => r.ok);
  console.table(results);
  return { pass, results };
};
