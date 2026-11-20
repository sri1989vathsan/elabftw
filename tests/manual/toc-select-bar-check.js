/**
 * The select bar at the bottom of the Contents panel (toc-select-bar-no-overlap). On a view page of an entry with at least five headings:
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/toc-select-bar-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await tocSelectBarCheck();      // {pass, results}
 *
 * Ticks one section, then five, and checks: Copy and the clear button are visible (Print and PDF exist once, in the header, and name the count) and do not touch each other; no text of the bar
 * is cut off (scrollWidth > clientWidth); the bar is inside the panel; no fixed or absolute thing of the page (the "Back to ..." pill, a toast)
 * lies over the bar; the always-visible Print and PDF buttons of the header are there. Nothing is printed or sent.
 */
window.tocSelectBarCheck = async function tocSelectBarCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const click = el => el && el.click();
  const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const touches = (a, b) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;
  const panel = document.getElementById('tocPanel');
  if (panel && panel.hidden) { click(document.getElementById('tocPanelOpener')); await sleep(700); }
  const toggle = document.getElementById('tocSelectToggle');
  check('Select mode exists', !!toggle, 'no #tocSelectToggle');
  if (!toggle) return { pass: false, results };
  if (toggle.getAttribute('aria-pressed') !== 'true') { click(toggle); await sleep(300); }
  click(document.getElementById('tocSelectNone')); await sleep(300);
  const checks = () => [...document.querySelectorAll('#tocItems .toc-item-section [data-toc-section-checkbox]')];
  const measure = async (n) => {
    click(document.getElementById('tocSelectNone')); await sleep(300);
    // Ticking a heading selects its whole branch, so a child that a ticked parent already selected shows as ticked, and clicking it would UNtick it.
    // Click only boxes that are not ticked yet: n clicks, n headings chosen by the person.
    let clicked = 0;
    for (let guard = 0; guard < 200 && clicked < n; guard++) {
      const next = checks().find(c => !c.checked);
      if (!next) break;
      click(next); clicked++;
      await sleep(60);
    }
    await sleep(500);
    const bar = document.getElementById('tocSelectBar');
    check(`${n} selected: the bar shows`, !!bar && !bar.hidden, 'hidden');
    if (!bar || bar.hidden) return;
    const ids = ['tocCopySelection', 'tocSelectClear'];
    const els = ids.map(id => document.getElementById(id));
    check(`${n} selected: Copy and clear are in the bar and visible`, els.every(e => e && e.offsetWidth > 0 && e.offsetHeight > 0), ids.filter((id, i) => !els[i] || !els[i].offsetWidth).join(','));
    // Print and PDF exist once, in the header, and say how many sections they take
    check(`${n} selected: the bar has no Print or PDF of its own`, !bar.querySelector('#tocPrintSelection, #tocPdfSelection'), 'Print/PDF still in the bar');
    const headerPrint = document.getElementById('tocPrintAll'); const headerPdf = document.getElementById('tocPdfAll');
    // the rule: ticking a heading selects its section and every section below it, so with nested entries N ticks can be more than N sections
    const shown = parseInt((document.getElementById('tocSelectedLabel') || {}).textContent, 10);
    const tickedBoxes = checks().filter(c => c.checked).length;
    check(`${n} selected: the count is the number of ticked headings (a ticked parent ticks its sub-sections)`, shown === tickedBoxes && shown >= Math.min(clicked, n), `clicked ${clicked}, ticked boxes ${tickedBoxes}, counted ${shown}`);
    const word = `${shown} ${shown === 1 ? 'section' : 'sections'}`;
    check(`${n} selected: the header Print and PDF say "(${word})"`, !!headerPrint && !!headerPdf && headerPrint.title === `Print (${word})` && headerPdf.title === `PDF (${word})`, `${headerPrint && headerPrint.title} | ${headerPdf && headerPdf.title}`);
    const boxes = els.filter(Boolean).map(box);
    let overlap = '';
    boxes.forEach((a, i) => boxes.forEach((b, j) => { if (j > i && touches(a, b)) overlap += `${ids[i]}/${ids[j]} `; }));
    check(`${n} selected: the buttons do not touch each other`, overlap === '', overlap);
    const barBox = box(bar);
    const panelBox = box(document.getElementById('tocPanel'));
    check(`${n} selected: every button is inside the panel`, boxes.every(b => b.l >= panelBox.l - 0.5 && b.r <= panelBox.r + 0.5 && b.b <= innerHeight + 0.5), JSON.stringify({ boxes, panelBox }));
    const clipped = [...bar.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.clientWidth > 0).map(e => e.id || e.className);
    const textClipped = [...bar.querySelectorAll('.toc-select-text, #tocSelectedLabel, #tocShowingLabel, .toc-bar-btn')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.className);
    check(`${n} selected: no text of the bar is cut off`, clipped.length === 0 && textClipped.length === 0, clipped.concat(textClipped).join(' | '));
    const over = [...document.querySelectorAll('body *')].filter(e => {
      if (bar.contains(e) || e.contains(bar)) return false;
      const cs = getComputedStyle(e);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
      const b = e.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || (b.width > innerWidth * 0.9 && b.height > innerHeight * 0.5)) return false;
      // an element of the panel itself, laid out inside it (the popovers of the bar)
      if (panel && panel.contains(e) && cs.position === 'absolute') return false;
      return touches(barBox, { l: b.left, t: b.top, r: b.right, b: b.bottom });
    }).filter(e => {
      // only what sits over the bar counts: higher in the stack
      const z = parseInt(getComputedStyle(e).zIndex, 10) || 0;
      return z >= (parseInt(getComputedStyle(bar).zIndex, 10) || 0);
    }).map(e => (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ').slice(0, 2).join('.'));
    check(`${n} selected: nothing floating lies over the bar`, over.length === 0, over.join(' | '));
  };
  // the "Back to ..." pill (back-to-link.ts): shown after following an internal link; here it is made the way the page makes it
  const keyList = Object.keys(sessionStorage).filter(k => /back/i.test(k));
  const pillCheck = (when) => {
    const pill = document.getElementById('elabftwBackButton');
    if (!pill || getComputedStyle(pill).display === 'none') { check(`${when}: the Back pill is not over the panel (hidden or absent)`, true); return; }
    const pb = box(pill);
    const hits = [...document.querySelectorAll('.side-panel:not([hidden]) *')].filter(e => {
      const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return b.width > 1 && b.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && touches(pb, { l: b.left, t: b.top, r: b.right, b: b.bottom });
    }).map(e => e.id || String(e.className).split(' ')[0]);
    check(`${when}: the Back pill does not touch anything in the open panel`, hits.length === 0, hits.slice(0, 5).join(' | '));
    const scrollTop = document.getElementById('scrollButtons');
    if (scrollTop) [...scrollTop.children].forEach(c => { const cb = c.getBoundingClientRect(); if (cb.width > 1 && touches(pb, { l: cb.left, t: cb.top, r: cb.right, b: cb.bottom })) check(`${when}: the Back pill does not cover a scroll button`, false, 'covers a scroll button'); });
  };
  const available = checks().length;
  check('the panel lists at least five sections', available >= 5, `${available} sections`);
  await measure(1);
  pillCheck('Contents panel, 1 selected');
  if (available >= 5) { await measure(5); pillCheck('Contents panel, 5 selected'); }
  // the Folders and Search panels too
  for (const [id, name] of [['foldersPanelOpener', 'Folders'], ['favoritesPanelOpener', 'Search']]) {
    const opener = document.getElementById(id);
    if (!opener) continue;
    click(opener); await sleep(600);
    pillCheck(`${name} panel`);
    click(opener); await sleep(300);
  }
  check('the header has Print and PDF with a selection too', !!document.getElementById('tocPrintAll') && /\(\d+ section/.test(document.getElementById('tocPrintAll').title), document.getElementById('tocPrintAll')?.title);
  click(document.getElementById('tocSelectClear')); await sleep(300);
  check('with the selection cleared the tooltip says whole entry again', /whole entry/i.test(document.getElementById('tocPrintAll')?.title || ''), document.getElementById('tocPrintAll')?.title);
  return { pass: results.every(r => r.ok), results };
};
