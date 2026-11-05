/**
 * File > Open from Database: an item added to the File menu of the editor, it asks the frame of the tabs (tabs.js) to open its list.
 * The menu is drawn by the editor when it opens, so the item is added when the menu appears.
 */
(function () {
  'use strict';
  if (window.parent === window) {
    return;
  }
  function addItem(menu) {
    if (menu.querySelector('[data-open-database]')) {
      return;
    }
    const items = Array.prototype.slice.call(menu.querySelectorAll('li'));
    const anchor = items.find(function (item) {
      return /Import Sequence/i.test(item.textContent);
    });
    if (!anchor) {
      return;
    }
    const item = anchor.cloneNode(true);
    item.setAttribute('data-open-database', '1');
    // the command of the copy would start an import: it has none of its own
    item.querySelectorAll('[cmd]').forEach(function (node) {
      node.removeAttribute('cmd');
    });
    const text = item.querySelector('.bp3-text-overflow-ellipsis, .bp3-fill') || item;
    // the text node of the copy is replaced, its icon and look stay
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (/Import Sequence/i.test(node.nodeValue)) {
        node.nodeValue = 'Open from Database...';
        break;
      }
      node = walker.nextNode();
    }
    // the menu is taken away when the mouse goes down on an item (it dismisses itself), so the click may never arrive
    let asked = 0;
    function ask(event) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - asked < 400) {
        return;
      }
      asked = Date.now();
      window.parent.postMessage({ type: 'elab-open-from-database' }, window.location.origin);
    }
    item.addEventListener('mousedown', ask, true);
    item.addEventListener('click', ask, true);
    anchor.parentNode.insertBefore(item, anchor);
  }
  new MutationObserver(function () {
    document.querySelectorAll('.bp3-menu').forEach(addItem);
  }).observe(document.body, { childList: true, subtree: true });
}());
