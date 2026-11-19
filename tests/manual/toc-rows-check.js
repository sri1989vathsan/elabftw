/**
 * The rows of the Contents panel (toc-rows): no H1..H6 tag, the level shown by indent, weight and size, "Heading N" for the tooltip and
 * screen readers, titles of two lines, hover buttons as an overlay. On a view page of an entry with at least two heading levels:
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/toc-rows-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await tocRowsCheck();      // {pass, results}
 *
 * Nothing is changed or sent; the panel is opened if it is closed.
 */
window.tocRowsCheck = async function tocRowsCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const panel = document.getElementById('tocPanel');
  if (panel && panel.hidden) { document.getElementById('tocPanelOpener')?.click(); await sleep(800); }
  const sections = [...document.querySelectorAll('#tocItems .toc-item-section')];
  check('the panel has heading rows', sections.length > 1, `${sections.length} rows`);
  if (sections.length < 2) return { pass: false, results };

  check('no H1..H6 tag column on a heading row', sections.every(li => !li.querySelector('.toc-kind')) && !sections.some(li => /^H[1-6]$/.test(li.querySelector('.toc-entry')?.firstElementChild?.textContent || '')), 'a .toc-kind is still there');
  check('every heading row keeps data-toc-level', sections.every(li => /^[1-6]$/.test(li.dataset.tocLevel || '')), 'data-toc-level missing');
  check('every heading link says "Heading N" for screen readers', sections.every(li => new RegExp(`^Heading ${li.dataset.tocLevel}: `).test(li.querySelector('.toc-link').getAttribute('aria-label') || '')), 'aria-label');

  const levels = [...new Set(sections.map(li => Number(li.dataset.tocLevel)))].sort((a, b) => a - b);
  const byRank = rank => sections.find(li => li.classList.contains(`toc-rank-${rank}`));
  const css = li => getComputedStyle(li.querySelector('.toc-link'));
  const top = byRank(0);
  check('the top-most level present is rank 0 and bold (600)', !!top && Number(top.dataset.tocLevel) === levels[0] && Number(css(top).fontWeight) >= 600, top ? css(top).fontWeight : 'no rank 0');
  const second = byRank(1);
  if (levels.length > 1) {
    check('the second level is rank 1, normal weight', !!second && Number(second.dataset.tocLevel) === levels[1] && Number(css(second).fontWeight) <= 500, second ? css(second).fontWeight : 'no rank 1');
    check('the second level is indented more than the first', !!second && second.querySelector('.toc-link').getBoundingClientRect().left > top.querySelector('.toc-link').getBoundingClientRect().left + 3, 'same x');
  }
  const deep = byRank(2);
  if (levels.length > 2) {
    check('the third and deeper levels are smaller than the top level', !!deep && parseFloat(css(deep).fontSize) < parseFloat(css(top).fontSize), deep ? css(deep).fontSize : 'no rank 2');
    check('the deeper levels are muted by colour, not opacity', !!deep && css(deep).opacity === '1' && css(deep).color !== css(top).color, deep ? `${css(deep).opacity} ${css(deep).color}` : 'no rank 2');
  }

  // titles: the tooltip is the level; the whole title only when it is cut off
  const links = sections.map(li => li.querySelector('.toc-link'));
  const cut = links.filter(a => a.scrollHeight > a.clientHeight + 1);
  check('a title that fits has only the level as tooltip', links.filter(a => !cut.includes(a)).every(a => /^Heading \d$/.test(a.title)), links.filter(a => !cut.includes(a) && !/^Heading \d$/.test(a.title)).map(a => a.title).join(' | '));
  check('a title that is cut off has its whole text in the tooltip', cut.every(a => a.title.includes(a.dataset.tocFullTitle || a.textContent)), 'tooltip lacks the text');
  check('no title is taller than two lines', links.every(a => a.clientHeight <= parseFloat(getComputedStyle(a).lineHeight) * 2 + parseFloat(getComputedStyle(a).paddingTop) * 2 + 2), 'a third line shows');
  check('no row is cut off sideways', links.every(a => a.scrollWidth <= a.clientWidth + 1), 'scrollWidth > clientWidth');

  // spreadsheet and picture rows keep their icon slot
  const leaves = [...document.querySelectorAll('#tocItems .toc-item-table, #tocItems .toc-item-image')];
  check('spreadsheet and picture rows keep their icon or thumbnail', leaves.every(li => !!li.querySelector('.toc-kind .fa-table, .toc-kind .fa-image, .toc-kind .toc-thumb')), 'icon slot missing');

  // the hover buttons: an overlay with a solid background at the right edge, not in the flow
  const entry = sections[0].querySelector('.toc-entry');
  const actions = entry.querySelector('.toc-entry-actions');
  check('the row has an actions overlay', !!actions && getComputedStyle(actions).position === 'absolute', 'no overlay');
  if (actions) {
    entry.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const link = entry.querySelector('.toc-link').getBoundingClientRect();
    const box = actions.getBoundingClientRect();
    check('the overlay sits at the right edge of the row', Math.abs(entry.getBoundingClientRect().right - box.right) <= 2, `${entry.getBoundingClientRect().right} vs ${box.right}`);
    check('the title is not narrowed by the buttons (it spans under the overlay)', link.right >= box.left, `${link.right} < ${box.left}`);
  }
  return { pass: results.every(r => r.ok), results };
};
