/**
 * Fork-only: an expandable table of the lists gets the height that is left below it in the window, so that its horizontal scrollbar is
 * always in view (not at the bottom of a long list). The style is in table-scroll.css.
 */
(function () {
  'use strict';
  const size = function () {
    document.querySelectorAll('.table-responsive').forEach(function (wrap) {
      if (!wrap.querySelector(':scope > .expandable-table')) {
        return;
      }
      const top = wrap.getBoundingClientRect().top + window.scrollY;
      // the table is below the fold already (a tall page header): keep a usable height
      const room = window.innerHeight - Math.min(top, window.innerHeight * 0.6) - 16;
      wrap.style.maxHeight = Math.max(260, Math.round(room)) + 'px';
    });
  };
  let timer = 0;
  const later = function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(size, 100);
  };
  window.addEventListener('resize', later);
  window.addEventListener('load', later);
  // the tables are drawn after the page has loaded
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  later();
})();
