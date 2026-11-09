/**
 * Database list: the "Attach reads" button (many sequencing files to their plasmids) is only shown where it makes sense: on the tab of a module whose rules say
 * that sequencing reads can be attached to it (plasmids), and on "All" when at least one module takes them. Fork-only file; the setting is in the rules of a module.
 */
(function () {
  'use strict';
  if (window.location.pathname.split('/').pop() !== 'registry.php') {
    return;
  }
  let modules = null;
  const takesReads = function (m) {
    const s = m.settings || {};
    return s.allows_reads !== undefined ? Boolean(s.allows_reads) : /^plasmids?$/i.test(String(m.title || ''));
  };
  const apply = function () {
    if (!modules) {
      return;
    }
    const selected = new URLSearchParams(window.location.search).get('category') || '';
    const show = selected !== '' && /^\d+$/.test(selected)
      ? modules.some(function (m) {
        return String(m.id) === selected && takesReads(m);
      })
      : modules.some(takesReads);
    document.querySelectorAll('button').forEach(function (b) {
      if (b.textContent.trim() === 'Attach reads' && b.hidden === show) {
        b.hidden = !show;
      }
    });
  };
  fetch('registry-modules.php', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(function (response) {
    return response.json();
  }).then(function (data) {
    modules = Array.isArray(data.modules) ? data.modules : null;
    apply();
    let pending = false;
    new MutationObserver(function () {
      if (!pending) {
        pending = true;
        setTimeout(function () {
          pending = false;
          apply();
        }, 100);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }).catch(function () {
    // without the list the button stays as it is
  });
}());
