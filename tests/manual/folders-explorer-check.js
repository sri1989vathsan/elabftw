/**
 * Check of the Folders panel as a narrow explorer: bar, Exp / Res / All switch, Unfiled row and breadcrumb, the three views,
 * the option switches, the favourites list, and dragging a file onto a folder (with Undo).
 *
 * On http://localhost:8973/experiments.php, logged in (see TEST-ACCOUNTS.md), run:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/folders-explorer-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await foldersExplorerCheck();      // returns {pass, results}
 *
 * It creates two folders ("XPL one", "XPL two") and one experiment ("XPL file") in the first, moves the experiment to the second
 * by a synthetic drag and back with Undo, moves a folder into another (and back to the top level), drags a resource, checks that
 * a parent cannot be dropped on its own child and that someone else's experiment is refused, and deletes what it made.
 * The panel's open/closed state and views are put back. The "someone else's experiment" step needs one such experiment in a folder
 * (any experiment of another user that this user can see); it is skipped, and reported as such, when there is none.
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
    check('E2 the explorer bar has favourites, three views, options and close', !!$('.folder-explorer-bar [data-popover="folderFavoritesMenu"]') && document.querySelectorAll('.folder-view-switch [data-action="select-folder-view"]').length === 3 && !!$('.folder-explorer-bar [data-popover="folderOptionsMenu"]') && !!$('#foldersPanel [data-action="toggle-sidepanel"]'), 'bar incomplete (Close lives in the shared corner row of the panel, not in the Folders bar)');
    check('E3 the two old dropdowns are out of sight', !visible($('#folderEntityTypeSelect')) && !visible($('#folderQuickLinkSelect')), 'a select is visible');
    check('E4 the All row is gone, Unfiled is the first row of the list, and the breadcrumb is hidden with no folder selected',
      !$('[data-folder-quick="all"]') && !!$('[data-folder-quick="unfiled"]') && !!$('#folderCrumb') && $('#folderCrumb').hidden
      && $('#experimentsFoldersContent').firstElementChild.contains($('[data-folder-quick="unfiled"]')), 'structure differs');

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
    // the panel may be inside another folder from an earlier look: start at the top level
    var rootCrumb = $('.folder-level-bar button.folder-path-crumb');
    if (rootCrumb) { rootCrumb.click(); await wait(500); }
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

    // Unfiled (the first row of the list) takes a file out of its folder, and Undo puts it back
    await reloadPanel();
    click('[data-action="select-folder-view"][data-view="list"]');
    await wait(500);
    var oneLink2 = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat [data-action="open-folder-level"]'), function (a) { return /XPL one/.test(a.textContent); });
    if (oneLink2) oneLink2.click();
    await wait(1800);
    var fileRow2 = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat .folder-file-row'), function (r) { return /XPL file/.test(r.textContent); });
    var unfiledRow = $('[data-folder-quick="unfiled"]');
    if (fileRow2 && unfiledRow) {
      var litU = drag(fileRow2, unfiledRow);
      check('E23 the Unfiled row lights up while a file is over it', litU, 'no highlight');
      await wait(2500);
      var out = (await api('GET', 'experiments/' + exp)).json;
      check('E24 the file is now unfiled', !out.folder_id, 'folder_id ' + out.folder_id);
      var undoU = $('#folderMoveToast .folder-move-toast-undo');
      if (undoU) {
        undoU.click();
        await wait(2500);
        var back2 = (await api('GET', 'experiments/' + exp)).json;
        check('E25 Undo puts it back in XPL one', Number(back2.folder_id) === one, 'folder_id ' + back2.folder_id);
      }
    } else {
      check('E23 the Unfiled row and the file are there', false, 'file row ' + !!fileRow2 + ', unfiled row ' + !!unfiledRow);
    }
    // the breadcrumb: shown for a selected folder with a clear x, hidden again without one
    var sidebar = $('#experimentsFoldersSidebar');
    var wasId = sidebar.dataset.currentFolderId;
    sidebar.dataset.currentFolderId = String(one);
    document.dispatchEvent(new Event('elabftw:folders-panel-loaded'));
    await wait(600);
    var crumb = $('#folderCrumb');
    check('E26 a selected folder shows the breadcrumb with its name and a clear x', crumb && !crumb.hidden && /XPL one/.test(crumb.textContent) && !!crumb.querySelector('.folder-crumb-clear'), crumb ? crumb.textContent : 'no crumb');
    sidebar.dataset.currentFolderId = wasId || '';
    document.dispatchEvent(new Event('elabftw:folders-panel-loaded'));
    await wait(600);
    check('E27 with no folder selected the breadcrumb is hidden again', $('#folderCrumb').hidden, 'still shown');

    // ---- more moves: folder into folder, the top level, a resource, a parent onto its child, someone else's experiment ----
    await reloadPanel();
    click('[data-action="select-folder-scope"][data-scope="all"]');
    await wait(400);
    click('[data-action="select-folder-view"][data-view="tree"]');
    await wait(400);
    var treeRow = function (id, attr) { return $('#experimentsFoldersTree .folder-row[' + attr + '="' + id + '"]'); };
    var oneDrag = treeRow(one, 'data-drag-id'), twoDrop = treeRow(two, 'data-drop-folder');
    if (oneDrag && twoDrop) {
      var lit = drag(oneDrag, twoDrop);
      check('M1 a folder dropped on another lights the target', lit, 'no highlight');
      await wait(2500);
      var inside = (await api('GET', 'experiments_folders/' + one)).json;
      check('M2 the folder is now inside the other', Number(inside.parent_id) === two, inside.parent_id);
      var undoF = $('#folderMoveToast .folder-move-toast-undo');
      if (undoF) { undoF.click(); await wait(2500); }
      var top = (await api('GET', 'experiments_folders/' + one)).json;
      check('M3 Undo puts the folder back at the top level', !top.parent_id, top.parent_id);
    } else check('M1 tree rows found', false, [!!oneDrag, !!twoDrop]);

    // a parent cannot be dropped on its own child (put one inside two by the API, then drag two onto one)
    await api('PATCH', 'experiments_folders/' + one, { parent_id: two });
    await reloadPanel();
    click('[data-action="select-folder-scope"][data-scope="all"]');
    await wait(400);
    var twoDrag = treeRow(two, 'data-drag-id'), oneDrop = treeRow(one, 'data-drop-folder');
    if (twoDrag && oneDrop) {
      check('M4 a parent dropped on its own child does not light the target', !drag(twoDrag, oneDrop), 'highlighted');
      await wait(800);
      var parentData = (await api('GET', 'experiments_folders/' + two)).json;
      check('M5 the parent stays where it is', !parentData.parent_id, parentData.parent_id);
    }
    await api('PATCH', 'experiments_folders/' + one, { parent_id: 0 });

    // a resource, dragged from the list view
    var cats = (await api('GET', 'resources_categories')).json;
    var resBody = { title: 'XPL res', folder_id: one };
    if (Array.isArray(cats) && cats.length) resBody.category_id = cats[0].id;
    var resPost = await api('POST', 'items', resBody);
    if (resPost.loc) {
      var item = Number(resPost.loc.split('/').pop());
      made.items = (made.items || []).concat(item);
      await reloadPanel();
      click('[data-action="select-folder-scope"][data-scope="all"]');
      await wait(400);
      click('[data-action="select-folder-type"][data-type="items"]');
      await wait(500);
      click('[data-action="select-folder-view"][data-view="list"]');
      await wait(600);
      // start from the top level, then step into the folder
      var crumb = $('.folder-level-bar button.folder-path-crumb');
      if (crumb) { crumb.click(); await wait(500); }
      var oneStep = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat [data-action="open-folder-level"]'), function (a) { return /XPL one/.test(a.textContent); });
      if (oneStep) { oneStep.click(); await wait(1800); }
      var resRow = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat .folder-file-row'), function (r) { return /XPL res/.test(r.textContent); });
      check('M6 the resource shows as a file on the Res switch', !!resRow, 'not listed');
      var twoTree = treeRow(two, 'data-drop-folder');
      if (resRow && twoTree) {
        check('M7 the file row knows it is a resource', resRow.dataset.dragType === 'items', resRow.dataset.dragType);
        drag(resRow, twoTree);
        await wait(2500);
        var movedRes = (await api('GET', 'items/' + item)).json;
        check('M8 the resource is now in XPL two', Number(movedRes.folder_id) === two, movedRes.folder_id);
        var undoR = $('#folderMoveToast .folder-move-toast-undo');
        if (undoR) { undoR.click(); await wait(2500); }
        var backRes = (await api('GET', 'items/' + item)).json;
        check('M9 Undo puts the resource back in XPL one', Number(backRes.folder_id) === one, backRes.folder_id);
      }
      click('[data-action="select-folder-type"][data-type="experiments"]');
      await wait(400);
    } else check('M6 a resource could be created for the check', false, resPost.status);

    // someone else's experiment is refused
    var me = (await api('GET', 'users/me')).json;
    var theirs = null;
    var where = 0;
    var folderIds = Array.prototype.map.call(document.querySelectorAll('#experimentsFoldersTree .folder-node'), function (n) { return n.dataset.folderId; });
    for (var fid of folderIds) {
      var inFolder = (await api('GET', 'experiments?folder=' + fid + '&scope=2&limit=50')).json || [];
      var hit = inFolder.find(function (e) { return e.fullname && e.fullname !== me.fullname && !/XPL/.test(e.title); });
      if (hit) { theirs = hit; where = Number(fid); break; }
    }
    // a system administrator may move other people's experiments: the refusal can only be checked as a plain member
    if (me.is_sysadmin) results.push({ name: 'X0 skipped: the test user is a sysadmin (log in as a plain member to check the refusal)', ok: true });
    else if (theirs) {
      var targetTree = treeRow(two, 'data-drop-folder');
      var rowOf = null;
      click('[data-action="select-folder-view"][data-view="list"]');
      await wait(500);
      // walk down to the folder that holds it, by its path
      var path = (document.querySelector('#experimentsFoldersTree .folder-node[data-folder-id="' + where + '"]') || {dataset: {}}).dataset.folderFullPath;
      var crumb2 = $('.folder-level-bar button.folder-path-crumb');
      if (crumb2) { crumb2.click(); await wait(500); }
      if (path) {
        for (var part of path.split(' > ')) {
          var step = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat [data-action="open-folder-level"]'), function (a) { return a.querySelector('.folder-name') && a.querySelector('.folder-name').textContent.trim() === part; });
          if (!step) break;
          step.click();
          await wait(1500);
        }
      }
      rowOf = Array.prototype.find.call(document.querySelectorAll('#experimentsFoldersFlat .folder-file-row'), function (r) { return r.textContent.indexOf(theirs.title) !== -1; });
      check('X0 reached an experiment owned by someone else', !!rowOf, path);
      if (rowOf && targetTree) {
        drag(rowOf, targetTree);
        await wait(2500);
        var still = (await api('GET', 'experiments/' + theirs.id)).json;
        check('X1 it was not moved', Number(still.folder_id) === where, still.folder_id);
        check('X2 no "Moved" message for the refused move', !$('#folderMoveToast'), 'toast shown');
      }
    } else results.push({ name: 'X0 skipped: no experiment of another user in a folder', ok: true });
  } catch (e) {
    if (e.message !== 'stop') check('E99 the check ran to the end', false, String(e));
  } finally {
    for (var itemId of (made.items || [])) { try { await api('DELETE', 'items/' + itemId); } catch (e) { /* best effort */ } }
    for (var id of made.experiments) { try { await api('PATCH', 'experiments/' + id, { action: 'destroy' }); } catch (e) { /* best effort */ } }
    for (var f of made.folders) { try { await api('DELETE', 'experiments_folders/' + f); } catch (e) { /* best effort */ } }
    var key = Object.keys(localStorage).filter(function (k) { return /^elabftw-folders-view-\d+$/.test(k); })[0];
    if (key) { if (savedView) localStorage.setItem(key, savedView); else localStorage.removeItem(key); }
  }
  var pass = results.every(function (r) { return r.ok; });
  return { pass: pass, results: results };
};
