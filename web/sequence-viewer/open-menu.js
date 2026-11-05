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
  // a button of the toolbar, before Save: the search of the Database (opens or closes the panel of the tabs)
  function addButton() {
    if (document.querySelector('[data-open-database-button]')) {
      return;
    }
    const save = document.querySelector('.ve-tool-container-saveTool');
    // each tool sits in a box of its own in the row of the toolbar: the button goes in front of the box of Save
    const wrapper = save ? save.closest('.bp3-popover-wrapper') : null;
    const slot = wrapper ? wrapper.parentNode : null;
    if (!slot || !slot.parentNode) {
      return;
    }
    const outer = document.createElement('div');
    outer.className = 'veToolbarItemOuter';
    outer.setAttribute('data-open-database-button', '1');
    const button = document.createElement('a');
    button.setAttribute('role', 'button');
    button.className = 'bp3-button bp3-minimal bp3-intent-primary';
    button.tabIndex = 0;
    button.title = 'Search the Database and open a plasmid in a new tab';
    button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 10l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      window.parent.postMessage({ type: 'elab-open-from-database', toggle: true }, window.location.origin);
    });
    outer.appendChild(button);
    const box = document.createElement('div');
    box.setAttribute('data-open-database-button', '1');
    outer.removeAttribute('data-open-database-button');
    box.appendChild(outer);
    slot.parentNode.insertBefore(box, slot);
  }
  new MutationObserver(function () {
    document.querySelectorAll('.bp3-menu').forEach(addItem);
    addButton();
  }).observe(document.body, { childList: true, subtree: true });
}());
