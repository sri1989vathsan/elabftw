/**
 * The sidebar of the sequence editor, on the right of the sequence: a rail of icons, one for each tool (primers, primer
 * design, digests, alignment of reads), and the panel of the tool that is open, to the left of the rail. A tool registers
 * with an icon, a label (the tooltip) and a function that fills the panel. Exposed as window.ToolSidebar.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  // the icons are drawn here: 24 x 24, lines only
  const ICONS = {
    primers: '<path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/>',
    design: '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>',
    digest: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.5 8.5L20 19M8.5 15.5L20 5"/>',
    annotate: '<path d="M4 12l8-8h8v8l-8 8z"/><circle cx="15.5" cy="8.5" r="1.2"/>',
    enzymes: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
    align: '<path d="M3 6h18M3 12h11M8 18h13"/>',
  };
  const tabs = [];
  let activeId = null;
  let aside = null;
  let panel = null;
  let content = null;
  let rail = null;

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

  function icon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  // the sequence view has to measure itself again when the panel opens or closes
  const relayout = function () {
    window.setTimeout(function () {
      window.dispatchEvent(new Event('resize'));
    }, 30);
  };

  function build() {
    aside = document.getElementById('tool-sidebar');
    if (!aside) {
      return false;
    }
    if (aside.dataset.built) {
      return true;
    }
    aside.dataset.built = '1';
    panel = element('div', 'tool-panel');
    panel.hidden = true;
    const header = element('div', 'tool-header');
    header.append(element('strong', 'tool-title', ''));
    const close = element('button', 'tool-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the panel');
    close.addEventListener('click', function () {
      toggle(false);
    });
    header.append(close);
    content = element('div', 'tool-content');
    panel.append(header, content);
    rail = element('nav', 'tool-rail');
    rail.setAttribute('aria-label', 'Tools');
    aside.append(panel, rail);
    return true;
  }

  function drawRail() {
    rail.textContent = '';
    tabs.forEach(function (tab) {
      const b = element('button', 'tool-icon');
      b.type = 'button';
      b.title = tab.label;
      b.setAttribute('aria-label', tab.label);
      b.setAttribute('aria-pressed', !panel.hidden && tab.id === activeId ? 'true' : 'false');
      b.append(icon(tab.icon));
      b.addEventListener('click', function () {
        // a second click on the icon of the open tool closes the panel
        if (!panel.hidden && tab.id === activeId) {
          toggle(false);
        } else {
          open(tab.id);
        }
      });
      rail.append(b);
    });
  }

  function open(id) {
    const tab = tabs.find(function (t) {
      return t.id === id;
    });
    if (!tab || !build()) {
      return;
    }
    activeId = id;
    panel.hidden = false;
    panel.querySelector('.tool-title').textContent = tab.label;
    drawRail();
    content.textContent = '';
    tab.show(content);
    relayout();
  }

  function toggle(force) {
    if (!build()) {
      return;
    }
    const show = force === undefined ? panel.hidden : force;
    if (show) {
      open(activeId || (tabs[0] && tabs[0].id));
    } else {
      panel.hidden = true;
      drawRail();
      relayout();
    }
  }

  window.ToolSidebar = {
    register: function (tab) {
      tabs.push(tab);
      if (build()) {
        drawRail();
      }
    },
    open: open,
    toggle: toggle,
    // the tool that is open, null when the panel is closed
    active: function () {
      return panel && !panel.hidden ? activeId : null;
    },
  };
})();
