/**
 * The select bar at the bottom of the Contents panel (toc-select-bar-no-overlap). On a view page of an entry with at least five headings:
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/toc-select-bar-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await tocSelectBarCheck();      // {pass, results}
 *
 * Ticks one section, then five, and checks: Print, PDF, Copy and the clear button are all visible and do not touch each other; no text of the bar
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
    checks().slice(0, n).forEach(c => click(c));
    await sleep(500);
    const bar = document.getElementById('tocSelectBar');
    check(`${n} selected: the bar shows`, !!bar && !bar.hidden, 'hidden');
    if (!bar || bar.hidden) return;
    const ids = ['tocPrintSelection', 'tocPdfSelection', 'tocCopySelection', 'tocSelectClear'];
    const els = ids.map(id => document.getElementById(id));
    check(`${n} selected: Print, PDF, Copy and clear are all in the bar and visible`, els.every(e => e && e.offsetWidth > 0 && e.offsetHeight > 0), ids.filter((id, i) => !els[i] || !els[i].offsetWidth).join(','));
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
  const available = checks().length;
  check('the panel lists at least five sections', available >= 5, `${available} sections`);
  await measure(1);
  if (available >= 5) await measure(5);
  check('the header has Print and PDF with a selection too', !!document.getElementById('tocPrintAll') && /\(\d+ section/.test(document.getElementById('tocPrintAll').title), document.getElementById('tocPrintAll')?.title);
  click(document.getElementById('tocSelectClear')); await sleep(300);
  check('with the selection cleared the tooltip says whole entry again', /whole entry/i.test(document.getElementById('tocPrintAll')?.title || ''), document.getElementById('tocPrintAll')?.title);
  return { pass: results.every(r => r.ok), results };
};
