/**
 * Contents panel, select mode: several headings can be ticked (the first ticked one must not hide the others).
 * Run on a view page of an entry with headings (the local scratch experiment 206 has 8: Goals > Background > Detail one/two, Methods > Cells/Plasmids,
 * Notes): load this file in the console and call `await tocSelectCheck()`.
 */
window.tocSelectCheck = async function tocSelectCheck() {
  const results = [];
  const ok = (name, pass, detail) => results.push({ name, ok: !!pass, detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const panel = document.getElementById('tocPanel');
  if (panel.hidden) { document.getElementById('tocPanelOpener').click(); await sleep(1500); }
  document.getElementById('tocSelectToggle').pressed || document.getElementById('tocSelectToggle').click();
  await sleep(300);
  const row = text => [...document.querySelectorAll('#tocItems .toc-item-section')].find(li => li.querySelector('.toc-link').textContent.trim() === text);
  const click = (text, opts = {}) => { row(text).querySelector('.toc-link').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...opts })); return sleep(250); };
  const visibleRows = () => [...document.querySelectorAll('#tocItems .toc-item')].filter(li => !li.hidden).length;
  const total = document.querySelectorAll('#tocItems .toc-item-section').length;
  // three headings that are not next to each other (a sub-heading, a heading of another branch, the last one)
  await click('Detail one');
  ok('after the first tick every row is still listed', visibleRows() === document.querySelectorAll('#tocItems .toc-item').length, `${visibleRows()} rows visible`);
  await click('Cells');
  await click('Notes');
  const label = document.getElementById('tocSelectedLabel').textContent;
  const showing = document.getElementById('tocShowingLabel').textContent;
  const ticked = [...document.querySelectorAll('#tocItems .toc-row-check')].filter(c => c.checked).length;
  ok('three non-adjacent headings stay ticked', ticked === 3, `${ticked} ticked`);
  ok('the count says 3 selected', /^3 selected/.test(label), label);
  ok(`'Showing 3 of ${total} sections'`, showing === `Showing 3 of ${total} sections`, showing);
  const body = document.getElementById('body_view');
  if (body) {
    const hidden = body.querySelectorAll('.toc-section-filter-hidden').length;
    ok('the page is filtered to the three sections', body.classList.contains('toc-main-text-filtered') && hidden > 0, `${hidden} hidden blocks`);
  }
  // un-ticking one leaves the other two
  await click('Cells');
  ok('un-ticking one leaves two', document.getElementById('tocSelectedLabel').textContent.startsWith('2 selected'), document.getElementById('tocSelectedLabel').textContent);
  // select all / none
  document.getElementById('tocSelectAll').click(); await sleep(250);
  ok('Select all ticks every section', document.getElementById('tocSelectedLabel').textContent.startsWith(`${total} selected`), document.getElementById('tocSelectedLabel').textContent);
  document.getElementById('tocSelectNone').click(); await sleep(250);
  ok('None clears the selection and the page filter', document.getElementById('tocSelectBar').hidden && !(body && body.classList.contains('toc-main-text-filtered')), '');
  // text filter chip together with the selection: the selection is not reset
  await click('Detail one'); await click('Notes');
  const input = document.getElementById('tocSearchInput');
  input.value = 'Notes'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300);
  ok('a text filter chip does not reset the selection', /selected/.test(document.getElementById('tocSelectedLabel').textContent) && document.querySelectorAll('#tocItems .toc-row-check:checked').length >= 1, document.getElementById('tocSelectedLabel').textContent);
  document.getElementById('tocSearchClear').click(); await sleep(200);
  document.getElementById('tocSelectToggle').click(); await sleep(200);
  return { pass: results.every(r => r.ok), results };
};
