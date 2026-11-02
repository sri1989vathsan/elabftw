/**
 * The "Tools" panel of the sidebar: small actions on the sequence in the editor, in the way of the Actions and Tools menus of
 * SnapGene. Each action is a folded section; the sections come from window.ToolsParts (blast-tab.js, tools-basic.js, ...).
 * Exposed as window.ToolsTab.
 */
(function () {
  'use strict';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  // the parts of the panel: {id, title, build(editor, context) => node}, in the order they are added
  const parts = [];

  function setup(editor, context) {
    if (!window.ToolSidebar) {
      return;
    }
    window.ToolSidebar.register({ id: 'tools', icon: 'tools', label: 'Tools', show: function (host) {
      host.append(element('p', 'digest-help', 'Actions on the sequence, or on the part of it that is selected.'));
      parts.forEach(function (part) {
        const box = element('details', 'tools-part');
        box.append(element('summary', '', part.title));
        let built = false;
        // a part is built when it is opened first
        box.addEventListener('toggle', function () {
          if (box.open && !built) {
            built = true;
            box.append(part.build(editor, context || {}));
          }
        });
        host.append(box);
      });
    } });
  }

  window.ToolsTab = { setup: setup, add: function (part) {
    parts.push(part);
  } };
})();
