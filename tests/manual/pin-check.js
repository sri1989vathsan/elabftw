/**
 * The pin button and pinned entries on top. Logged in, on http://localhost:8973/experiments.php (any list page):
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/pin-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await pinCheck();      // {pass, results}
 * It pins one experiment of the user's own (the first it can), then checks in every list layout that: the pinned pin is amber, tilted, at least
 * 1.5rem wide and high and has no button chrome; an unpinned pin in a row is hidden until the row is pointed at; a "Pinned" group comes first in the
 * grouped layouts; and through the API that pinned entries come first whatever the sort. The entry is unpinned again.
 */
window.pinCheck = async function pinCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const hdr = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const mine = (await (await fetch('/api/v2/experiments?limit=30&scope=1', { credentials: 'same-origin' })).json()).find(e => !e.is_pinned);
  if (!mine) return { pass: false, results: [{ name: 'an experiment to pin was found', ok: false, detail: 'none' }] };
  await fetch('/api/v2/experiments/' + mine.id, { method: 'PATCH', credentials: 'same-origin', headers: hdr, body: JSON.stringify({ action: 'pin' }) });
  try {
    for (const layout of ['cr', 'it', 'pv', 'bd']) {
      document.querySelector(`[data-action="set-items-layout"][data-layout="${layout}"]`)?.click();
      await sleep(1600);
      const pins = [...document.querySelectorAll("button[data-action='toggle-pin']")];
      const pinned = pins.find(b => b.querySelector('.fa-thumbtack:not(.color-weak)'));
      check(`${layout}: a pinned pin is drawn`, !!pinned, `${pins.length} pins`);
      if (pinned) {
        const cs = getComputedStyle(pinned); const r = pinned.getBoundingClientRect();
        const rgb = (cs.color.match(/[\d.]+/g) || []).map(Number);
        check(`${layout}: the pinned pin is amber (red high, blue low)`, rgb[0] > 170 && rgb[2] < 120, cs.color);
        check(`${layout}: the pin is at least 1.5rem wide and high`, r.width >= 1.45 * rem && r.height >= 1.45 * rem, `${Math.round(r.width)} x ${Math.round(r.height)} px`);
        check(`${layout}: the pin has no button background or border`, cs.borderTopWidth === '0px' && (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent'), `${cs.borderTopWidth} ${cs.backgroundColor}`);
        check(`${layout}: the pinned icon is tilted`, getComputedStyle(pinned.querySelector('.fa-thumbtack')).transform !== 'none', 'no transform');
      }
      const rowPin = pins.find(b => b.classList.contains('entity-row-pin') && !b.classList.contains('is-pinned'));
      if (rowPin && (layout === 'cr' || layout === 'pv')) check(`${layout}: an unpinned pin in a row is hidden until the row is pointed at`, getComputedStyle(rowPin).opacity === '0', getComputedStyle(rowPin).opacity);
      if (layout === 'cr') {
        const first = [...document.querySelectorAll('.entity-rows *')].find(el => el.children.length === 0 && /^\s*(Pinned|[A-Z][a-z]+ \d{4}|No date)\s*$/.test(el.textContent));
        check('cr: the first group of the list is Pinned', first && /Pinned/.test(first.textContent), first ? first.textContent : 'no group heading');
      }
    }
    for (const order of ['lastchange', 'title', 'date', 'comment']) {
      const list = await (await fetch(`/api/v2/experiments?limit=40&order=${order}&sort=asc`, { credentials: 'same-origin' })).json();
      const flags = list.map(e => !!e.is_pinned);
      const firstUnpinned = flags.indexOf(false);
      check(`sorted by ${order}: every pinned entry comes before the unpinned ones`, firstUnpinned === -1 || !flags.slice(firstUnpinned).includes(true), flags.join(','));
    }
  } finally {
    await fetch('/api/v2/experiments/' + mine.id, { method: 'PATCH', credentials: 'same-origin', headers: hdr, body: JSON.stringify({ action: 'pin' }) });
  }
  return { pass: results.every(r => r.ok), results };
};
