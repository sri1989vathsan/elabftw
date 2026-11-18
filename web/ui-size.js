/**
 * The size of the interface (data-ui-size on <html>: compact, the default, or comfortable), applied before the first paint.
 * A logged-in user's choice comes from the server (the attribute is already set): it is also remembered in localStorage so the
 * login page and the first paint of a logged-out page use the last choice.
 */
(function () {
  'use strict';
  try {
    var root = document.documentElement;
    var server = root.getAttribute('data-ui-size');
    if (server === 'compact' || server === 'comfortable') {
      window.localStorage.setItem('ui-size', server);
    } else if (window.localStorage.getItem('ui-size') === 'comfortable') {
      root.setAttribute('data-ui-size', 'comfortable');
    }
  } catch (error) {
    // no localStorage: the default (compact)
  }
})();
