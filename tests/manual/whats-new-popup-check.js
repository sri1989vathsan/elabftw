#!/usr/bin/env node
/**
 * Check of the "What's new" popup after login (templates/whats-new-popup.html, src/Services/WhatsNewPopup.php). Needs Node 18+ and a running instance
 * with a local account:
 *
 *     BASE=http://127.0.0.1:8982 EMAIL=alice.tester@example.test PASSWORD='...' node tests/manual/whats-new-popup-check.js
 *
 * It logs in several times (every login is a new session), sets the user's "seen" state and the opt-out through the same API the page uses
 * (experiments_folders, action set_user_pref), and reads the first and a second page of each session:
 *   1. unseen entries: the popup is on the first page after login, lists exactly the entries newer than the stored one, not on a second page;
 *   2. dismiss (stores the newest entry as seen): after logout and login again, no popup;
 *   3. a newer entry (simulated by storing the second-newest entry as seen): the popup returns with only that entry;
 *   4. opt-out: no popup; opted in again (preference removed): the popup is back;
 *   5. first-ever login (nothing stored): only featured entries of the last 30 days, not the history.
 * The user's own stored state is put back at the end. The entries are read from src/whats-new.json (the instance's own file when SRC_JSON is set).
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE || 'http://127.0.0.1:3148').replace(/\/$/, '');
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const entries = JSON.parse(fs.readFileSync(process.env.SRC_JSON || path.join(__dirname, '../../src/whats-new.json'), 'utf8'));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };

class Client {
  constructor() { this.cookies = {}; }
  async fetch(url, options = {}) {
    let target = url.startsWith('http') ? url : BASE + '/' + url.replace(/^\//, '');
    for (let hops = 0; hops < 10; hops++) {
      const response = await fetch(target, { ...options, redirect: 'manual', headers: { ...(options.headers || {}), Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';'); const i = pair.indexOf('=');
        this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
      }
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        target = new URL(location, target).href;
        options = { method: 'GET' };
        continue;
      }
      return { status: response.status, text: await response.text(), url: target };
    }
    throw new Error('too many redirects');
  }
  async login() {
    const page = await this.fetch('login.php');
    const csrf = (page.text.match(/<input[^>]*name=['"]csrf['"][^>]*value=['"]([^'"]+)/) || page.text.match(/<input[^>]*value=['"]([^'"]+)['"][^>]*name=['"]csrf['"]/) || [])[1];
    const body = new URLSearchParams({ auth_type: 'local', email: EMAIL, password: PASSWORD, csrf: csrf || '', Submit: 'Login' });
    const first = await this.fetch('app/controllers/LoginController.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    this.firstPage = first.text;
    return first;
  }
  async logout() { await this.fetch('app/logout.php'); this.cookies = {}; }
  async api(body) {
    const page = await this.fetch('dashboard.php');
    const token = (page.text.match(/name=['"]csrf-token['"] content=['"]([^'"]+)/) || page.text.match(/content=['"]([^'"]+)['"] name=['"]csrf-token/) || [])[1];
    const response = await fetch(`${BASE}/api/v2/experiments_folders`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token, Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no body */ }
    return { status: response.status, json };
  }
}

const popupTitles = html => {
  if (!html.includes("id='whatsNewPopup'")) return null;
  const body = html.split("id='whatsNewPopup'")[1].split("class='modal-footer'")[0];
  const titles = [...body.matchAll(/<h6 class='whats-new-popup-title'>([^<]*)</g)].map(m => m[1]);
  const compact = [...body.matchAll(/<li><strong>([^<]*)</g)].map(m => m[1]);
  return { titles, compact, all: [...titles, ...compact] };
};
const decode = s => s.replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const seenOf = e => JSON.stringify({ id: e.id, date: e.date });
const newest = entries[0];

(async () => {
  if (!EMAIL || !PASSWORD) { console.error('Set EMAIL and PASSWORD (a local account).'); process.exit(2); }
  const setup = new Client();
  await setup.login();
  const before = (await setup.api({ action: 'get_user_prefs' })).json?.prefs ?? {};
  const put = async (key, value) => setup.api(value === undefined ? { action: 'set_user_pref', key } : { action: 'set_user_pref', key, value });
  const state = async ({ seen, off }) => { await put('whats-new-seen', seen); await put('whats-new-popup-off', off); };
  // the state is set through the setup session; the session under test is a new login, so its first page is the first page of a session
  const session = async stateToSet => {
    await state(stateToSet);
    const fresh = new Client(); const first = await fresh.login();
    const second = await fresh.fetch('dashboard.php');
    return { fresh, first: popupTitles(first.text), second: popupTitles(second.text), firstHtml: first.text };
  };
  try {
    // 1. unseen entries
    let r = await session({ seen: seenOf(entries[2]) });
    check('unseen entries: the popup is on the first page after login', r.first, 'no popup in the first page');
    check('it lists exactly the entries newer than the stored one', r.first && JSON.stringify(r.first.all.map(decode).sort()) === JSON.stringify([entries[0].title, entries[1].title].sort()), JSON.stringify(r.first));
    check('not on a second page of the same session', r.second === null, 'popup on the second page');
    check('the popup is part of the page (no empty modal flash): it has a Got it button and the close X', r.firstHtml.includes('data-whats-new-got-it') && r.firstHtml.includes('data-dismiss=\'modal\' aria-label'), '');

    // 2. dismiss stores the newest as seen (what the page sends on any way of closing it)
    await r.fresh.api({ action: 'set_user_pref', key: 'whats-new-seen', value: seenOf(newest) });
    const stored = (await r.fresh.api({ action: 'get_user_prefs' })).json?.prefs?.['whats-new-seen'];
    check('dismiss stores the newest entry per user on the server', stored === seenOf(newest), stored);
    await r.fresh.fetch('dashboard.php');
    await r.fresh.logout();
    const again = new Client(); const firstAgain = await again.login();
    check('after reload and logout/login: no popup', popupTitles(firstAgain.text) === null, 'popup shown again');
    const other = new Client(); const firstOther = await other.login();
    check('another browser (a fresh session) of the same user: no popup', popupTitles(firstOther.text) === null, 'popup shown');

    // 3. a newer entry appears: only that entry
    r = await session({ seen: seenOf(entries[1]) });
    check('a newer entry: the popup is shown again with only that entry', r.first && r.first.all.length === 1 && decode(r.first.all[0]) === newest.title, JSON.stringify(r.first));

    // 4. opt-out and opt-in
    r = await session({ seen: seenOf(entries[2]), off: '1' });
    check('opted out: no popup although there are unseen entries', r.first === null, 'popup shown');
    r = await session({ seen: seenOf(entries[2]), off: undefined });
    check('opted in again: the popup is back', r.first !== null, 'no popup');

    // 5. first-ever login
    r = await session({ seen: undefined, off: undefined });
    const limit = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const expected = entries.filter(e => e.featured && e.date >= limit).map(e => e.title).sort();
    if (expected.length === 0) check('first-ever login: nothing featured in the last 30 days, so no popup', r.first === null, JSON.stringify(r.first));
    else check('first-ever login: only the featured entries of the last 30 days (not the history)', r.first && JSON.stringify(r.first.titles.map(decode).sort()) === JSON.stringify(expected.slice(0, 6)), JSON.stringify({ got: r.first, expected }));
    check('first-ever login: no compact list of old entries', !r.first || r.first.compact.length === 0, JSON.stringify(r.first));
  } finally {
    await put('whats-new-seen', before['whats-new-seen']);
    await put('whats-new-popup-off', before['whats-new-popup-off']);
  }
  const failed = results.filter(x => !x.ok);
  console.log(failed.length ? `\n${failed.length} of ${results.length} FAILED` : `\nall ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
