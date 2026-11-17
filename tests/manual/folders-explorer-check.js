/**
 * Check of the Folders panel as a narrow explorer: bar, Exp / Res / All switch, All / Unfiled rows, the three views,
 * the option switches, the favourites list, and dragging a file onto a folder (with Undo).
 *
 * On http://localhost:8973/experiments.php, logged in (see TEST-ACCOUNTS.md), run:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/folders-explorer-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await foldersExplorerCheck();      // returns {pass, results}
 *
 * It creates two folders ("XPL one", "XPL two") and one experiment ("XPL file") in the first, moves the experiment to the second
 * by a synthetic drag and back with Undo, and deletes what it made. The panel's open/closed state and views are put back.
 */
window.foldersExplorerCheck = async function () {
  var results = [];
  var made = { folders: [], experiments: [] };
  function check(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: ok ? undefined : detail }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function api(method, path, body) {
    var r = await fetch('/api/v2/' + path, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, loc: r.headers.get('Location'), json: method === 'GET' ? await r.json() : null };
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function visible(el) { return !!el && !el.hidden && el.getClientRects().length > 0; }
  function click(sel) { var el = $(sel); if (el) el.click(); return el; }
  async function reloadPanel() { click('#foldersPanel [data-action="refresh-folders"]'); await wait(1500); }
  function drag(source, target) {
    var data = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    var over = target.classList.contains('is-drop-target');
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    return over;
  }
  var savedView = localStorage.getItem(Object.keys(localStorage).filter(function (k) { return /^elabftw-folders-view-\d+$/.test(k); })[0] || '');

  try {
    // open the panel (the opener sits in the page's left rail)
    var opener = $('[data-action="toggle-sidepanel"][data-target="folders"]:not([data-purpose="hide"])');
    check('E0 the Folders opener exists', !!opener, 'no opener on this page');
    if (!opener) throw new Error('stop');
    if (!visible($('#foldersPanel'))) opener.click();
    await wait(2500);
    var panel = $('#foldersPanel');
    check('E1 the panel is open', visible(panel), 'panel hidden');
    check('E2 the explorer bar has favourites, three views, options and close', !!$('.folder-explorer-bar [data-popover="folderFavoritesMenu"]') && document.querySelectorAll('.folder-view-switch [data-action="select-folder-view"]').length === 3 && !!$('.folder-explorer-bar [data-popover="folderOptionsMenu"]') && !!$('.folder-explorer-bar [data-action="toggle-sidepanel"]'), 'bar incomplete');
    check('E3 the two old dropdowns are out of sight', !visible($('#folderEntityTypeSelect')) && !visible($('#folderQuickLinkSelect')), 'a select is visible');
    check('E4 All and Unfiled rows exist', !!$('[data-folder-quick="all"]') && !!$('[data-folder-quick="unfiled"]'), 'rows missing');

    // Exp / Res / All
    click('[data-action="select-folder-type"][data-type="items"]');
    await wait(400);
    check('E5 Res switch: pressed, quick links go to the resources page', $('[data-action="select-folder-type"][data-type="items"]').getAttribute('aria-pressed') === 'true' && /database\.php/.test($('[data-folder-quick="unfiled"]').getAttribute('href')), $('[data-folder-quick="unfiled"]').getAttribute('href'));
    click('[data-action="select-folder-type"][data-type="all"]');
    await wait(400);
    check('E6 All switch: pressed', $('[data-action="select-folder-type"][data-type="all"]').getAttribute('aria-pressed') === 'true', 'not pressed');
    click('[data-action="select-folder-type"][data-type="experiments"]');
    await wait(400);
    check('E7 Exp switch: pressed, quick links go to the experiments page', $('[data-action="select-folder-type"][data-type="experiments"]').getAttribute('aria-pressed') === 'true' && /experiments\.php/.test($('[data-folder-quick="unfiled"]').getAttribute('href')), $('[data-folder-quick="unfiled"]').getAttribute('href'));

    // fixtures
    var one = Number((await api('POST', 'experiments_folders', { name: 'XPL one', parent_id: null })).loc.split('/').pop());
    var two = Number((await api('POST', 'experiments_folders', { name: 'XPL two', parent_id: null })).loc.split('/').pop());
    made.folders.push(one, two);
    var exp = Number((await api('POST', 'experiments', { title: 'XPL file', folder_id: one })).loc.split('/').pop());
    made.experiments.push(exp);
    await reloadPanel();
    // see everyone's folders in case "My folders" hides the new ones
    click('[data-action="select-folder-scope"][data-scope="all"]');
    await wait(400);

    // views
    click('[data-action="select-folder-view"][data-view="list"]');
    await wait(500);
    check('E8 list view: the flat list shows, the tree hides', visible($('#experimentsFoldersFlat')) && !visible($('#experimentsFoldersTree')), 'flat/tree visibility wrong');
    var oneLink = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat [data-action="open-folder-level"]'), function (a) { return /XPL one/.test(a.textContent); });
    check('E9 the folder XPL one is listed', !!oneLink, 'not listed');
    if (oneLink) oneLink.click();
    await wait(1800);
    var fileRow = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat .folder-file-row'), function (r) { return /XPL file/.test(r.textContent); });
    check('E10 inside the folder, its experiment shows as a file row', !!fileRow, 'file row missing');
    if (fileRow) fileRow.click();
    await wait(400);
    check('E11 picking the file shows its preview with a title', /XPL file/.test(($('#experimentsFoldersFlat .folder-preview-title') || {}).textContent || ''), 'no preview');
    click('[data-action="select-folder-view"][data-view="cards"]');
    await wait(500);
    check('E12 cards view shows the file as a card', Array.prototype.some.call(document.querySelectorAll('#experimentsFoldersFlat .folder-file-card'), function (c) { return /XPL file/.test(c.textContent); }), 'no card');

    // option switches
    click('[data-popover="folderOptionsMenu"]');
    check('E13 the options list opens', visible($('#folderOptionsMenu')), 'not open');
    click('[data-folder-pref="counts"]');
    check('E14 turning Counts off hides the count badges (panel class)', $('#foldersPanel').classList.contains('folders-no-counts'), 'class missing');
    click('[data-folder-pref="counts"]');
    click('[data-folder-pref="favorites"]');
    check('E15 turning Favourites off hides the star button', $('#foldersPanel').classList.contains('folders-no-favorites') && !visible($('[data-popover="folderFavoritesMenu"]')), 'star still shown');
    click('[data-folder-pref="favorites"]');
    click('[data-popover="folderOptionsMenu"]');

    // favourites list
    click('[data-popover="folderFavoritesMenu"]');
    check('E16 the favourites list opens', visible($('#folderFavoritesMenu')) && $('#folderFavoritesMenu').children.length > 0, 'empty or hidden');
    click('[data-popover="folderFavoritesMenu"]');

    // drag the file from XPL one onto XPL two (list view, inside XPL one) via the up row's sibling: go up and drop on the folder row
    click('[data-action="select-folder-view"][data-view="list"]');
    await wait(500);
    var up = $('#experimentsFoldersFlat .folder-up-button');
    if (up) up.click();
    await wait(500);
    // the file lives in XPL one, so step into it again, then use the path bar's parent to reach a level that lists both folders
    oneLink = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat [data-action="open-folder-level"]'), function (a) { return /XPL one/.test(a.textContent); });
    if (oneLink) oneLink.click();
    await wait(1800);
    fileRow = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat .folder-file-row'), function (r) { return /XPL file/.test(r.textContent); });
    // a drop target for XPL two exists in the tree (hidden) and in the flat list one level up; use the tree row, which is always in the page
    var twoRow = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersTree .folder-row[data-drop-folder="' + two + '"]'), function () { return true; });
    check('E17 the tree row of XPL two accepts drops', !!twoRow && twoRow.getAttribute('draggable') === 'true', 'row not draggable/droppable');
    if (fileRow && twoRow) {
      var highlighted = drag(fileRow, twoRow);
      check('E18 the target row lights up while a file is over it', highlighted, 'no highlight');
      await wait(2500);
      var moved = (await api('GET', 'experiments/' + exp)).json;
      check('E19 the file is now in XPL two', Number(moved.folder_id) === two, 'folder_id ' + moved.folder_id);
      var undo = $('#folderMoveToast .folder-move-toast-undo');
      check('E20 a message with Undo is shown', !!undo, 'no toast');
      if (undo) {
        undo.click();
        await wait(2500);
        var back = (await api('GET', 'experiments/' + exp)).json;
        check('E21 Undo puts it back in XPL one', Number(back.folder_id) === one, 'folder_id ' + back.folder_id);
      }
    }
    // a folder cannot be dropped into itself
    var oneTreeRow = $('#experimentsFoldersTree .folder-row[data-drop-folder="' + one + '"]');
    if (oneTreeRow) {
      drag(oneTreeRow, oneTreeRow);
      await wait(800);
      var oneData = (await api('GET', 'experiments_folders/' + one)).json;
      check('E22 a folder dropped onto itself is not moved', !oneData.parent_id, 'parent_id ' + oneData.parent_id);
    }
  } catch (e) {
    if (e.message !== 'stop') check('E99 the check ran to the end', false, String(e));
  } finally {
    for (var id of made.experiments) { try { await api('PATCH', 'experiments/' + id, { action: 'destroy' }); } catch (e) { /* best effort */ } }
    for (var f of made.folders) { try { await api('DELETE', 'experiments_folders/' + f); } catch (e) { /* best effort */ } }
    var key = Object.keys(localStorage).filter(function (k) { return /^elabftw-folders-view-\d+$/.test(k); })[0];
    if (key) { if (savedView) localStorage.setItem(key, savedView); else localStorage.removeItem(key); }
  }
  var pass = results.every(function (r) { return r.ok; });
  return { pass: pass, results: results };
};
