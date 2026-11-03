/**
 * On the page of an entry of the database: next to where it is stored, what is known of the storage place (where it is, its conditions,
 * who looks after it). Reads storage-info.php?all=1.
 */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (!/registry\.php$/.test(location.pathname) || !params.get('id') || (params.get('mode') !== 'view' && params.get('mode') !== 'edit')) {
    return;
  }
  const show = async function () {
    const links = Array.from(document.querySelectorAll('.storage-group-head a[href*="storage_unit="]'));
    if (links.length === 0) {
      return;
    }
    let info = {};
    try {
      const response = await fetch('storage-info.php?all=1', { credentials: 'same-origin' });
      info = (await response.json()).info || {};
    } catch (error) {
      return;
    }
    links.forEach(function (link) {
      const match = /storage_unit=(\d+)/.exec(link.getAttribute('href'));
      const head = link.closest('.storage-group-head');
      if (!match || !head || head.querySelector('.storage-info-line') || !info[match[1]]) {
        return;
      }
      const data = info[match[1]];
      const parts = [data.location, data.conditions, data.contact_name ? 'looked after by ' + data.contact_name : ''].filter(Boolean);
      const line = document.createElement('div');
      line.className = 'storage-info-line small text-muted w-100';
      line.textContent = parts.join(' · ');
      head.append(line);
    });
  };
  // the storage section is drawn with the page and again when it changes
  show();
  new MutationObserver(function () {
    show();
  }).observe(document.body, { childList: true, subtree: true });
})();
