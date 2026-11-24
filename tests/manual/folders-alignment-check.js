/**
 * Alignment check of the Folders panel in tree view: every row type shares the caret, icon and label columns of its level,
 * counts and stars end on the same right-hand edges, nothing moves when a row's buttons appear, and "All folders" is a quiet
 * toggle (no grey fill after a click, caret in the caret column).
 *
 * On http://localhost:8973/experiments.php (or http://inventory.localhost:8975), logged in (see TEST-ACCOUNTS.md), run:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/folders-alignment-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await foldersAlignmentCheck();      // returns {pass, results, measures}
 * Run it once at each interface size (Settings > Display: compact / comfortable): the columns are compared inside one page, so the size
 * only changes the numbers, not the verdict.
 *
 * It creates "ALN root" (bookmarked) and "ALN other" (not), each with a child, and an experiment in three of them (so counts show), and removes
 * all of it afterwards. The view and the "All folders" state are put back.
 */
window.foldersAlignmentCheck = async function () {
  var results = [];
  var made = { folders: [], experiments: [] };
  var TOL = 1.01; // px
  function check(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: ok ? undefined : detail }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function visible(el) { return !!el && !el.hidden && el.getClientRects().length > 0; }
  async function api(method, path, body) {
    var r = await fetch('/api/v2/' + path, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, loc: r.headers.get('Location') };
  }
  function same(values) { values = values.filter(function (v) { return v !== null && v !== undefined; }); return values.length > 0 && Math.max.apply(null, values) - Math.min.apply(null, values) <= TOL; }
  var viewKey = Object.keys(localStorage).filter(function (k) { return /^elabftw-folders-view-\d+$/.test(k); })[0];
  var savedView = viewKey ? localStorage.getItem(viewKey) : null;
  var measures = {};

  try {
    var opener = $('[data-action="toggle-sidepanel"][data-target="folders"]:not([data-purpose="hide"])');
    if (!visible($('#foldersPanel')) && opener) opener.click();
    await wait(2500);
    var root = Number((await api('POST', 'experiments_folders', { name: 'ALN root', parent_id: null })).loc.split('/').pop());
    var child = Number((await api('POST', 'experiments_folders', { name: 'ALN child', parent_id: root })).loc.split('/').pop());
    // an unbookmarked top-level folder with a child, so "All folders" always has something to show
    var otherRoot = Number((await api('POST', 'experiments_folders', { name: 'ALN other', parent_id: null })).loc.split('/').pop());
    var otherChild = Number((await api('POST', 'experiments_folders', { name: 'ALN other child', parent_id: otherRoot })).loc.split('/').pop());
    made.folders.push(otherChild, otherRoot, child, root);
    for (var f of [root, child, otherRoot]) made.experiments.push(Number((await api('POST', 'experiments', { title: 'ALN file', folder_id: f })).loc.split('/').pop()));
    $('#foldersPanel [data-action="refresh-folders"]').click();
    await wait(1800);
    $('[data-action="select-folder-view"][data-view="tree"]').click();
    await wait(600);
    // bookmark the root (a star click), then reopen so the Bookmarked section is built
    var rootRow = $('#experimentsFoldersTree .folder-node[data-folder-id="' + root + '"] > .folder-row');
    var star = $('.favorite-folder-star', rootRow);
    if (star.querySelector('.far')) { star.click(); await wait(1500); $('#foldersPanel [data-action="refresh-folders"]').click(); await wait(1800); }
    var other = $('.other-folders-header');
    if (other.getAttribute('aria-expanded') !== 'true') other.click();
    document.querySelectorAll('#experimentsFoldersTree .folder-toggle').forEach(function (t) {
      var c = t.closest('.folder-node').querySelector(':scope > .folder-children');
      if (c && c.style.display === 'none') t.click();
    });
    await wait(500);

    var P = $('#foldersPanel').getBoundingClientRect().left;
    function left(e) { return e ? Math.round((e.getBoundingClientRect().left - P) * 10) / 10 : null; }
    function right(e) { return e ? Math.round((e.getBoundingClientRect().right - P) * 10) / 10 : null; }
    function rowsAt(depth) {
      return Array.prototype.filter.call(document.querySelectorAll('#experimentsFoldersTree .folder-node[data-folder-depth="' + depth + '"] > .folder-row'), function (r) { return visible(r); });
    }
    function cols(r) { return { caret: left(r.querySelector('.folder-toggle, :scope > span:first-child')), icon: left(r.querySelector('.folder-icon')), label: left(r.querySelector('.folder-name')) }; }
    var d0 = rowsAt(0), d1 = rowsAt(1);
    // the Bookmarked section holds shortcut rows (same layout as a folder row); the tree below lists every folder
    var bm0 = Array.prototype.filter.call(document.querySelectorAll('.bookmarked-folders-section .folder-shortcut'), function (r) { return visible(r); });
    var other0 = d0.filter(function (r) { return r.closest('.other-folders-wrapper'); });
    check('A0 the page has bookmarked and other top-level rows and a child row', bm0.length > 0 && other0.length > 0 && d1.length > 0, bm0.length + ' / ' + other0.length + ' / ' + d1.length);

    // columns of one level
    var c0 = d0.concat(bm0).map(cols);
    check('A1 top-level rows (bookmarked and other) share the icon and label columns', same(c0.map(function (c) { return c.icon; })) && same(c0.map(function (c) { return c.label; })), JSON.stringify(c0));
    check('A2 top-level rows that have a caret share the caret column', same(d0.concat(bm0).filter(function (r) { return r.querySelector('.folder-toggle') || bm0.indexOf(r) >= 0; }).map(function (r) { return cols(r).caret; })), JSON.stringify(c0));
    var c1 = d1.map(cols);
    check('A3 child rows share the icon and label columns', same(c1.map(function (c) { return c.icon; })) && same(c1.map(function (c) { return c.label; })), JSON.stringify(c1));
    check('A4 a child is indented from its parent by the same step in both sections', c1.length < 1 || same(d1.map(function (r) { return cols(r).icon - cols(r.closest('.folder-node').parentElement.closest('.folder-node').querySelector(':scope > .folder-row')).icon; })), JSON.stringify(c1));

    // the rows that are not folders
    var iconCol = c0[0].icon, labelCol = c0[0].label;
    var unf = $('[data-folder-quick="unfiled"]');
    check('A5 Unfiled: icon in the folders\' icon column, label in their label column', Math.abs(left(unf.querySelector('i')) - iconCol) <= TOL && Math.abs(left(unf.querySelector('span')) - labelCol) <= TOL, left(unf.querySelector('i')) + '/' + left(unf.querySelector('span')) + ' vs ' + iconCol + '/' + labelCol);
    var head = $('.bookmarked-folders-section .folder-tree-section-label');
    check('A6 Bookmarked heading: star in the icon column', !!head && Math.abs(left(head.querySelector('i')) - iconCol) <= TOL, head && left(head.querySelector('i')) + ' vs ' + iconCol);
    var nf = $('.folder-create-tree summary');
    check('A7 New folder: icon in the icon column', Math.abs(left(nf.querySelector('i')) - iconCol) <= TOL, left(nf.querySelector('i')) + ' vs ' + iconCol);
    var hd = $('.other-folders-header');
    var withCaret = d0.filter(function (r) { return r.querySelector('.folder-toggle'); })[0];
    var hc = [left(hd.children[0]), left(hd.children[1]), left(hd.children[2])];
    check('A8 All folders: caret, folder icon and label in the same columns as a folder row with children', !!withCaret && Math.abs(hc[0] - cols(withCaret).caret) <= TOL && Math.abs(hc[1] - iconCol) <= TOL && Math.abs(hc[2] - labelCol) <= TOL, JSON.stringify(hc) + ' vs ' + JSON.stringify(withCaret && cols(withCaret)));
    // quiet toggle: no fill after a click (focus left on it)
    hd.focus({ focusVisible: false });
    var bg = getComputedStyle(hd).backgroundColor;
    check('A9 All folders has no fill when merely focused', /rgba\(0, 0, 0, 0\)|transparent/.test(bg), bg);
    hd.blur();

    // right-hand columns
    var all = rowsAt(0).concat(rowsAt(1), rowsAt(2), bm0);
    var counts = all.map(function (r) { var c = $('.folder-entity-count', r); return c && !c.hidden && visible(c) ? right(c) : null; });
    var rowR = all.map(right);
    check('A10 counts end on the same right edge in every row (any depth, any star state)', same(counts), JSON.stringify(counts));
    check('A11 every row ends on the same right edge', same(rowR), JSON.stringify(rowR));
    var stars = all.map(function (r) { var s = $('.favorite-folder-star', r); return s && visible(s) ? right(s) : null; });
    check('A12 stars (bookmarked rows) end on the same right edge', same(stars), JSON.stringify(stars));
    var starRow = all.filter(function (r) { var s = $('.favorite-folder-star', r); return s && visible(s); })[0];
    var countRow = all.filter(function (r) { var c = $('.folder-entity-count', r); return c && !c.hidden && !$('.favorite-folder-star .fas', r); })[0];
    var withStar = starRow && $('.folder-entity-count', starRow) && !$('.folder-entity-count', starRow).hidden ? right($('.folder-entity-count', starRow)) : null;
    var withoutStar = countRow ? right($('.folder-entity-count', countRow)) : null;
    check('A13 a count sits in the same place with or without a visible star', withStar === null || withoutStar === null || Math.abs(withStar - withoutStar) <= TOL, withStar + ' vs ' + withoutStar);

    // nothing moves when the row's buttons appear (keyboard focus shows them like the pointer does)
    var probe = all.filter(function (r) { var c = $('.folder-entity-count', r); return c && !c.hidden; })[0] || all[0];
    function snap(r) { return JSON.stringify([left($('.folder-icon', r)), left($('.folder-name', r)), $('.folder-name', r).getBoundingClientRect().width, right($('.folder-entity-count', r) || r)]); }
    var before = snap(probe);
    var btn = $('[data-action="open-folder-readme"]', probe);
    $('[data-folder-entity-link]', probe).focus(); // the row's link: focus-within shows the buttons like the pointer does
    await wait(150);
    var after = snap(probe);
    check('A14 the buttons appearing on a row move nothing (icon, name start and width, count)', before === after, before + ' -> ' + after);
    check('A15 the README and three-dot buttons are visible on the focused row and stay inside it', visible(btn) && right(btn) <= right(probe) + TOL && left(btn) >= left(probe) - TOL, btn && JSON.stringify([left(btn), right(btn)]));
    $('[data-folder-entity-link]', probe).blur();
    measures = { iconCol: iconCol, labelCol: labelCol, headerCols: hc, countRight: counts, starRight: stars };
  } catch (e) {
    check('A99 the check ran to the end', false, String(e));
  } finally {
    for (var id of made.experiments) { try { await api('PATCH', 'experiments/' + id, { action: 'destroy' }); } catch (e) { /* best effort */ } }
    for (var f of made.folders) { try { await api('DELETE', 'experiments_folders/' + f); } catch (e) { /* best effort */ } }
    if (viewKey) { if (savedView) localStorage.setItem(viewKey, savedView); else localStorage.removeItem(viewKey); }
    var rb = $('#foldersPanel [data-action="refresh-folders"]'); if (rb) rb.click();
  }
  return { pass: results.every(function (r) { return r.ok; }), results: results, measures: measures };
};
