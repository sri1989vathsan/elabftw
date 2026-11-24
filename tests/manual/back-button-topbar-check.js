#!/usr/bin/env node
/**
 * The "Back to ..." control (src/ts/back-to-link.ts) is an arrow button in the top bar, left of the eLabFTW logo, and no longer floats over the page.
 * Headless Chrome (DevTools protocol, tests/manual/cdp-lib.js):
 *
 *   node tests/manual/back-button-topbar-check.js http://localhost:8973 EMAIL PASSWORD [shots-dir]
 *
 * The place to go back to is stored the way the page stores it after a click on an internal link (sessionStorage elabftw-back-stack), then the
 * page is loaded again. Asserts, at 1400 px, 800 px and 480 px wide, in the compact and the comfortable interface size:
 *  (a) the control is a button inside <nav id="main-navbar">, its box is inside the bar's box, and it lies left of the logo;
 *  (b) it overlaps no other item of the bar (logo, home icon, the narrow window's sidebar button, menu links, icons on the right);
 *  (c) it is not position: fixed, and nothing of the page content area (below the bar) lies under it;
 *  (d) the logo, the bar's height, the right-hand icons and the page width are exactly as without the control (no layout jump);
 *  (e) it shows no text (the arrow only); the tooltip and the aria-label name the place ("Back to Dashboard");
 *  (f) a click goes to the stored page (the dashboard) and the control is gone there;
 *  (g) on a page that is not where the link led, the control is not offered, and the stored places are dropped.
 * Screenshots of the top bar (without, with) go to shots-dir when given. Prints PASS/FAIL; exit code 1 on any failure.
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
      const logo = bar.querySelector('.logo-header');
      const out = { barH: r(bar).h, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, logoL: logo ? Math.round(r(logo).l * 10) / 10 : null };
      const secondary = document.getElementById('navbar-secondary-nav');
      if (secondary) out.secondaryInside = r(secondary).r <= r(bar).r + 1 && r(secondary).b <= r(bar).b + 1;
      out.secondaryL = secondary ? Math.round(r(secondary).l) : null;
      if (!el) return out;
      const b = r(el), bb = r(bar), cs = getComputedStyle(el);
      Object.assign(out, { present: true, isButton: el.tagName === 'BUTTON', parentIsBar: el.parentElement === bar, box: b,
        within: b.l >= bb.l - 1 && b.r <= bb.r + 1 && b.t >= bb.t - 1 && b.b <= bb.b + 1,
        leftOfLogo: !!logo && b.r <= r(logo).l + 0.5,
        fixed: cs.position === 'fixed', text: el.textContent.trim(), title: el.title, aria: el.getAttribute('aria-label') });
      // other items of the bar under the control's box
      out.overlaps = [...bar.querySelectorAll('a, button, img, .nav-item')].filter(e => {
        if (e === el || el.contains(e)) return false; const q = e.getBoundingClientRect();
        return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== 'hidden' && q.left < b.r && q.right > b.l && q.top < b.b && q.bottom > b.t;
      }).slice(0, 3).map(e => e.id || String(e.className).split(' ')[0] || e.tagName);
      // anything of the page content (below the bar) under the control's box
      out.covered = [...document.querySelectorAll('#container > *:not(nav), main *, #content-start ~ *')].filter(e => {
        if (bar.contains(e)) return false; const q = e.getBoundingClientRect();
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
        check(`${tag}: the control is a button in the top bar`, m.present && m.isButton && m.parentIsBar, JSON.stringify(m));
        if (!m.present) continue;
        check(`${tag}: its box is inside the bar's box`, m.within, JSON.stringify(m.box));
        check(`${tag}: it lies left of the logo`, m.leftOfLogo, `${JSON.stringify(m.box)} logo at ${m.logoL}`);
        check(`${tag}: it overlaps no other item of the bar`, m.overlaps.length === 0, m.overlaps.join(' | '));
        check(`${tag}: it is not floating (position is not fixed)`, !m.fixed, 'fixed');
        check(`${tag}: nothing of the page content lies under it`, m.covered.length === 0, m.covered.join(' | '));
        check(`${tag}: the logo does not move (${without.logoL} -> ${m.logoL})`, m.logoL === without.logoL, `${without.logoL} vs ${m.logoL}`);
        check(`${tag}: the bar keeps its height (${without.barH} -> ${m.barH})`, Math.abs(m.barH - without.barH) < 1, `${without.barH} vs ${m.barH}`);
        check(`${tag}: the right-hand icons and the width of the page are as without it`, m.secondaryInside === without.secondaryInside && m.secondaryL === without.secondaryL && m.scrollW <= Math.max(without.scrollW, m.innerW) + 1, `scrollW ${without.scrollW} -> ${m.scrollW}, secondary ${without.secondaryL} -> ${m.secondaryL}`);
        check(`${tag}: arrow only, the tooltip and aria-label name the place`, m.text === '' && /^Back to .*Dashboard/.test(m.title) && m.aria === m.title, `text "${m.text}", title "${m.title}", aria "${m.aria}"`);
      }
    }

    // behaviour, once, at the default size
    await size(1400, 800, 'compact');
    await seed(); await go();
    await c.js(`document.getElementById('elabftwBackButton').click(); return 1`);
    await sleep(2500);
    const where = await c.js('return location.pathname + "|" + !!document.getElementById("elabftwBackButton")');
    check('a click goes to the stored page (dashboard) and the control is gone there', /dashboard\.php\|false$/.test(where), where);
    await seed(); await c.nav(`${base}/team.php`); await sleep(700);
    const other = await c.js(`return { el: !!document.getElementById('elabftwBackButton'), stack: sessionStorage.getItem('elabftw-back-stack') }`);
    check('on a page the link did not lead to, it is not offered and the stored places are dropped', !other.el && !other.stack, JSON.stringify(other));
  } finally {
    await c.close();
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
