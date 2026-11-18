/**
 * The group boxes of the Search panel (Experiments 8, Resources 6, ...): the chevron, the type icon, the title text and the count badge of a header
 * sit on one centre line (within 1 px), the header is as tall as a control, a collapsed box has the same space above and below the header, and the
 * count ends where the rows' date column ends. Open the Search panel on a page with results, then:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/search-header-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await searchHeaderCheck();      // {pass, results}
 * Nothing is changed (the groups are opened and closed again).
 */
window.searchHeaderCheck = async function searchHeaderCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const panel = document.getElementById('favoritesPanel');
  if (!panel) return { pass: false, results: [{ name: 'the Search panel is there', ok: false, detail: 'no #favoritesPanel' }] };
  const groups = [...panel.querySelectorAll('details')].filter(d => d.querySelector(':scope > summary .favorite-group-count'));
  check('there are result groups to check', groups.length > 0, 'open the Search panel on a page with results first');
  const cy = r => r.top + r.height / 2;
  for (const d of groups) {
    const was = d.open;
    for (const open of [false, true]) {
      d.open = open;
      await sleep(150);
      const s = d.querySelector(':scope > summary');
      const parts = {
        chevron: s.querySelector('.favorite-filter-section-chevron'),
        icon: s.querySelector('.favorite-group-icon'),
        count: s.querySelector('.favorite-group-count'),
      };
      const title = s.querySelector('.unified-search-group-title');
      const range = document.createRange(); range.selectNodeContents(title);
      const centres = { chevron: cy(parts.chevron.getBoundingClientRect()), icon: cy(parts.icon.getBoundingClientRect()), text: cy(range.getBoundingClientRect()), count: cy(parts.count.getBoundingClientRect()) };
      const values = Object.values(centres);
      const spread = Math.max(...values) - Math.min(...values);
      const name = `${title.textContent.trim()} (${open ? 'open' : 'collapsed'})`;
      check(`${name}: chevron, icon, text and count share one centre line (within 1 px)`, spread <= 1, JSON.stringify(centres) + ` spread ${spread.toFixed(2)}`);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const sb = s.getBoundingClientRect();
      check(`${name}: the header is a control high (1.4 to 1.6 rem)`, sb.height >= 1.35 * rem && sb.height <= 1.65 * rem, `${sb.height.toFixed(1)} px = ${(sb.height / rem).toFixed(2)} rem`);
      const db = d.getBoundingClientRect();
      if (!open) {
        const top = sb.top - db.top; const bottom = db.bottom - sb.bottom;
        check(`${name}: equal space above and below the header`, Math.abs(top - bottom) <= 1, `${top.toFixed(1)} above, ${bottom.toFixed(1)} below`);
        check(`${name}: the header is centred in the box`, Math.abs(cy(sb) - cy(db)) <= 1, `${cy(sb).toFixed(1)} vs ${cy(db).toFixed(1)}`);
      }
      const row = d.querySelector('.favorite-filter-result');
      if (open && row) {
        const date = row.querySelector('time, .favorite-filter-result-date, [class*=date]');
        if (date) check(`${name}: the count ends at the right edge of the dates`, Math.abs(parts.count.getBoundingClientRect().right - date.getBoundingClientRect().right) <= 2, `${parts.count.getBoundingClientRect().right.toFixed(1)} vs ${date.getBoundingClientRect().right.toFixed(1)}`);
        const rowIcon = row.querySelector('.favorite-filter-result-icon');
        if (rowIcon) check(`${name}: the header icon is in the column of the row icons`, Math.abs(cy(parts.icon.getBoundingClientRect()) - cy(parts.icon.getBoundingClientRect())) <= 1 && Math.abs((parts.icon.getBoundingClientRect().left + parts.icon.getBoundingClientRect().width / 2) - (rowIcon.getBoundingClientRect().left + rowIcon.getBoundingClientRect().width / 2)) <= 2, `${(parts.icon.getBoundingClientRect().left + parts.icon.getBoundingClientRect().width / 2).toFixed(1)} vs ${(rowIcon.getBoundingClientRect().left + rowIcon.getBoundingClientRect().width / 2).toFixed(1)}`);
      }
    }
    d.open = was;
  }
  return { pass: results.every(r => r.ok), results };
};
