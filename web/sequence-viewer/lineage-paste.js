/**
 * Lineage from copy and paste: a sequence copied in the editor of one entry and pasted in the editor of another makes the first
 * one a parent (mother) of the second (daughter), recorded with lineage.php. The copy carries a stamp of the entry it came from;
 * a paste of the reverse complement is flagged as such.
 */
(function () {
  'use strict';
  const body = document.body.dataset;
  const entryId = Number(body.entry) || 0;
  const STAMP = 'application/x-elab-source';
  // shorter pieces (a site, a few bases) are not a lineage
  const MIN_BASES = 20;
  if (!entryId || body.canWrite !== '1' || body.tool === '1') {
    return;
  }

  function bases(text) {
    return String(text || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  }

  function reverseComplement(sequence) {
    const pairs = { A: 'T', T: 'A', G: 'C', C: 'G', U: 'A', N: 'N', R: 'Y', Y: 'R', K: 'M', M: 'K', S: 'S', W: 'W', B: 'V', V: 'B', D: 'H', H: 'D' };
    let out = '';
    for (let i = sequence.length - 1; i >= 0; i--) {
      out += pairs[sequence[i]] || 'N';
    }
    return out;
  }

  function notice(message, isError) {
    let box = document.getElementById('lineage-notice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'lineage-notice';
      box.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;max-width:80%;padding:8px 14px;border-radius:6px;font:13px sans-serif;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      document.body.appendChild(box);
    }
    box.style.background = isError ? '#b3261e' : '#2e6b3a';
    box.textContent = message;
    box.style.display = 'block';
    window.clearTimeout(box.hideTimer);
    box.hideTimer = window.setTimeout(function () {
      box.style.display = 'none';
    }, 6000);
  }

  // the last copy is also kept in the browser (shared by the tabs of the editor): a clipboard that does not carry the stamp
  // (another browser, or the stamp taken off) still finds its source, by the bases that were copied
  const LAST_KEY = 'sequence-editor-last-copy';
  const FRESH_MS = 10 * 60 * 1000;

  function remember(record) {
    try {
      window.localStorage.setItem(LAST_KEY, JSON.stringify(record));
    } catch (error) {
      // the stamp of the clipboard is all there is
    }
  }

  function recall() {
    try {
      return JSON.parse(window.localStorage.getItem(LAST_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  // the copy: OVE fills the clipboard first, the stamp is added after it
  window.addEventListener('copy', function (event) {
    if (!event.clipboardData) {
      return;
    }
    let text = '';
    try {
      text = event.clipboardData.getData('text/plain');
    } catch (error) {
      text = '';
    }
    const record = { entry: entryId, name: (document.getElementById('entry-title') || {}).textContent || '', bases: bases(text), at: Date.now() };
    remember(record);
    try {
      event.clipboardData.setData(STAMP, JSON.stringify(record));
    } catch (error) {
      // no stamp: the copy kept in the browser is used
    }
  });

  window.addEventListener('paste', function (event) {
    if (!event.clipboardData) {
      return;
    }
    const pasted = bases(event.clipboardData.getData('text/plain'));
    if (pasted.length < MIN_BASES) {
      return;
    }
    let source = null;
    try {
      source = JSON.parse(event.clipboardData.getData(STAMP) || 'null');
    } catch (error) {
      source = null;
    }
    if (!source) {
      const last = recall();
      if (last && Date.now() - Number(last.at) < FRESH_MS) {
        // the same bases (or their reverse complement); a copy whose bases could not be read counts when it is recent
        if (!last.bases || last.bases === pasted || reverseComplement(last.bases) === pasted) {
          source = last;
        }
      }
    }
    if (!source || !source.entry || Number(source.entry) === entryId) {
      return;
    }
    let direction = 'forward';
    if (source.bases && pasted !== source.bases && pasted === reverseComplement(source.bases)) {
      direction = 'reverse complement';
    }
    link(source, direction);
  }, true);

  async function link(source, direction) {
    const label = source.name || '#' + source.entry;
    const note = 'Sequence pasted from #' + source.entry + (direction === 'forward' ? '' : ' as ' + direction);
    try {
      const response = await fetch('../lineage.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': body.csrf },
        body: JSON.stringify({ action: 'add', entry: entryId, parent: Number(source.entry), note: note }),
      });
      const result = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        notice(result.error || 'The lineage could not be recorded.', true);
        return;
      }
      notice(label + ' is now a parent of this entry' + (direction === 'forward' ? '.' : ' (pasted as ' + direction + ').'), false);
    } catch (error) {
      notice('The lineage could not be recorded.', true);
    }
  }
}());
