/**
 * The enzymes tool of the sidebar: the vendors whose restriction enzymes are shown on the map (NEB and Thermo Fisher at first).
 * This is apart from the filter of the editor, which keeps the cut counts (single, double ...) and the groups of the user: the
 * enzymes of the chosen vendors are one more entry of that filter, combined with the cut counts. Needs enzymes-library.js.
 * Exposed as window.EnzymeTab.
 */
(function () {
  'use strict';
  const PREFIX = '__userCreatedGroupVendors: ';

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

  function setup(editor, options) {
    const vendors = window.EnzymeVendors;
    if (!vendors) {
      return;
    }

    // puts the enzymes of the chosen vendors in the filter of the editor, next to what is chosen there
    function apply(initial) {
      const state = editor.getState().restrictionEnzymes || {};
      const current = initial ? [{ value: 'single', label: 'Single cutters', cutsThisManyTimes: 1 }] : (state.filteredRestrictionEnzymes || []);
      const others = current.filter(function (entry) {
        return String(entry.value || '').indexOf(PREFIX) !== 0;
      });
      const name = vendors.groupName();
      const entries = others.concat(name ? [{ value: '__userCreatedGroup' + name }] : []);
      // the cut counts and the vendors are both needed for an enzyme to show
      editor.updateEditor({ restrictionEnzymes: { filteredRestrictionEnzymes: entries, isEnzymeFilterAnd: name !== '' && others.length > 0 } });
    }

    if (options && options.initial) {
      apply(true);
    }
    if (!window.ToolSidebar || (options && options.initial === false)) {
      return;
    }

    function show(host) {
      host.append(element('p', 'tool-muted', 'The restriction enzymes on the map are those of the vendors chosen here. The Filter Cut Sites button of the editor keeps the choice of single, double or triple cutters and your own groups.'));
      const chosen = new Set(vendors.selected());
      const list = element('div', 'enzyme-vendors');
      vendors.vendors.forEach(function (vendor) {
        const line = element('label', 'enzyme-vendor');
        const box = element('input');
        box.type = 'checkbox';
        box.checked = chosen.has(vendor);
        box.addEventListener('change', function () {
          if (box.checked) {
            chosen.add(vendor);
          } else {
            chosen.delete(vendor);
          }
          vendors.select(vendors.vendors.filter(function (v) {
            return chosen.has(v);
          }));
          apply(false);
          summary.textContent = describe();
        });
        const count = window.EnzymeLibrary.groups[vendor].length;
        line.append(box, element('span', 'enzyme-vendor-name', vendor), element('small', 'tool-muted', count + ' enzymes'));
        list.append(line);
      });
      const describe = function () {
        const n = vendors.names().length;
        return chosen.size === 0 ? 'No vendor chosen: the enzymes are not limited by vendor.' : n + ' enzymes from ' + chosen.size + (chosen.size === 1 ? ' vendor.' : ' vendors.');
      };
      const summary = element('p', 'tool-muted', describe());
      const presets = element('div', 'tool-actions');
      [['NEB and Thermo Fisher', ['NEB', 'Thermo Fisher']], ['All vendors', vendors.vendors], ['No limit', []]].forEach(function (preset) {
        const button = element('button', 'tool-btn', preset[0]);
        button.type = 'button';
        button.addEventListener('click', function () {
          vendors.select(preset[1]);
          apply(false);
          host.textContent = '';
          show(host);
        });
        presets.append(button);
      });
      host.append(presets, list, summary);
    }

    window.ToolSidebar.register({ id: 'enzymes', icon: 'enzymes', label: 'Enzymes by vendor', show: show });
  }

  window.EnzymeTab = { setup: setup };
})();
