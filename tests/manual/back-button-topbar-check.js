#!/usr/bin/env node
/**
 * The "Back to ..." control (src/ts/back-to-link.ts) sits in the top bar, after the logo and the home icon, and no longer floats over the page.
 * Headless Chrome (DevTools protocol, tests/manual/cdp-lib.js):
 *
 *   node tests/manual/back-button-topbar-check.js http://localhost:8973 EMAIL PASSWORD [shots-dir]
 *
 * The place to go back to is stored the way the page stores it after a click on an internal link (sessionStorage elabftw-back-stack), then the
 * page is loaded again. Asserts, at 1400 px, 800 px and 480 px wide, in the compact and the comfortable interface size:
 *  (a) the control is inside <nav id="main-navbar">, its box is inside the bar's box, it is a flex item of the bar's row after the home icon;
 *  (b) it is not position: fixed, and nothing of the page content area (below the bar) lies under its box;
 *  (c) the bar has the same height with and without it, and the right-hand icons stay inside the bar (no wrapping, no overflow);
 *  (d) the label is shown on wide windows, hidden on narrow ones, and the tooltip always names the place;
 *  (e) a click on the main button goes to the stored page (the dashboard);
 *  (f) the × removes it, the stored places are dropped, and after a reload it stays away.
 * Screenshots of the top bar (before: without, after: with) go to shots-dir when given. Prints PASS/FAIL; exit code 1 on any failure.
 * EMAIL/PASSWORD: see tests/manual/TEST-ACCOUNTS.md.
 */
const fs = require('fs');
const path = require('path');
const { startChrome, sleep } = require('./cdp-lib');

const [base0, email, password, shots] = process.argv.slice(2);
if (!base0 || !email || !password) { console.error('usage: back-button-topbar-check.js BASEURL EMAIL PASSWORD [shots-dir]'); process.exit(2); }
const base = base0.replace(/\/$/, '');
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };

(async () => {
  const c = await startChrome(1400, 800);
  try {
    await c.login(base, email, password);
    const target = `${base}/experiments.php`;
    let curUi = 'compact';
    const seed = () => c.js(`sessionStorage.setItem('elabftw-back-stack', JSON.stringify([{ url: ${JSON.stringify(base + '/dashboard.php')}, y: 0, label: 'Dashboard', target: ${JSON.stringify(target)}, at: Date.now() }])); return 1`);
    const size = async (w, h, ui) => {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      curUi = ui;
    };
    // the server decides the size on load: set it after the page is there, then let the layout settle
    const go = async () => { await c.nav(target); await c.js(`document.documentElement.dataset.uiSize = ${JSON.stringify(curUi)}; return 1`); await sleep(700); };
    const measure = () => c.js(`
      const bar = document.getElementById('main-navbar'); const el = document.getElementById('elabftwBackButton');
      const r = n => { const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const out = { barH: bar ? r(bar).h : 0, scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
      const secondary = document.getElementById('navbar-secondary-nav');
      if (secondary && bar) out.secondaryInside = r(secondary).r <= r(bar).r + 1 && r(secondary).b <= r(bar).b + 1;
      if (!el) return out;
      const b = r(el), bb = r(bar), cs = getComputedStyle(el);
      const home = [...bar.querySelectorAll('a.navbar-left-group')].pop();
      const label = el.querySelector('.elabftw-back-button-label');
      Object.assign(out, { present: true, inBar: bar.contains(el), parentIsBar: el.parentElement === bar, box: b,
        within: b.l >= bb.l - 1 && b.r <= bb.r + 1 && b.t >= bb.t - 1 && b.b <= bb.b + 1,
        afterHome: !!home && (home.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && b.l >= r(home).r - 1,
        fixed: cs.position === 'fixed', labelShown: !!label && getComputedStyle(label).display !== 'none',
        title: el.querySelector('.elabftw-back-button-go').title });
      // anything of the page content (below the bar) under the control's box
      out.covered = [...document.querySelectorAll('#container > *:not(nav), main *, #content-start ~ *')].filter(e => {
        if (bar.contains(e) || el.contains(e)) return false; const q = e.getBoundingClientRect();
        return q.width > 0 && q.height > 0 && q.top < b.b && q.bottom > b.t && q.left < b.r && q.right > b.l && getComputedStyle(e).visibility !== 'hidden';
      }).slice(0, 3).map(e => e.id || String(e.className).split(' ')[0] || e.tagName);
      return out;`);

    for (const ui of ['compact', 'comfortable']) {
      for (const w of [1400, 800, 480]) {
        const tag = `${ui}, ${w}px`;
        await size(w, 800, ui);
        await go(); // without: the bar as it is
        const without = await measure();
        if (shots) await c.shot(path.join(shots, `topbar-without-${ui}-${w}.png`));
        await seed(); await go();
        const m = await measure();
        if (shots) await c.shot(path.join(shots, `topbar-with-${ui}-${w}.png`));
        check(`${tag}: the control is in the top bar, as a child of it`, m.present && m.inBar && m.parentIsBar, JSON.stringify(m));
        if (!m.present) continue;
        check(`${tag}: its box is inside the bar's box`, m.within, JSON.stringify(m.box));
        check(`${tag}: it comes after the logo and the home icon`, m.afterHome, JSON.stringify(m.box));
        check(`${tag}: it is not floating (position is not fixed)`, !m.fixed, 'fixed');
        check(`${tag}: nothing of the page content lies under it`, m.covered.length === 0, m.covered.join(' | '));
        check(`${tag}: the bar keeps its height (${without.barH} -> ${m.barH})`, Math.abs(m.barH - without.barH) < 1, `${without.barH} vs ${m.barH}`);
        check(`${tag}: the right-hand icons stay inside the bar, no sideways scroll`, m.secondaryInside !== false && m.scrollW <= m.innerW + 1, `scrollW ${m.scrollW} > ${m.innerW}, secondaryInside ${m.secondaryInside}`);
        check(`${tag}: label ${w >= 992 ? 'shown' : 'hidden'}, tooltip names the place`, m.labelShown === (w >= 992) && /Dashboard/.test(m.title), `labelShown ${m.labelShown}, title ${m.title}`);
      }
    }

    // behaviour, once, at the default size
    await size(1400, 800, 'compact');
    await seed(); await go();
    await c.js(`document.querySelector('#elabftwBackButton .elabftw-back-button-go').click(); return 1`);
    await sleep(2500);
    const where = await c.js('return location.pathname');
    check('a click goes to the stored page (dashboard)', /dashboard\.php$/.test(where), where);
    await seed(); await go();
    await c.js(`document.querySelector('#elabftwBackButton .elabftw-back-button-close').click(); return 1`);
    const gone = await c.js(`return { el: !!document.getElementById('elabftwBackButton'), stack: sessionStorage.getItem('elabftw-back-stack') }`);
    check('the x removes the control and drops the stored places', !gone.el && !gone.stack, JSON.stringify(gone));
    await go();
    check('after a reload it stays away', !(await c.js(`return !!document.getElementById('elabftwBackButton')`)), 'came back');
  } finally {
    await c.close();
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
