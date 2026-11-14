/**
 * Golden Gate part of the Tools panel: a destination vector (an open plasmid) and any number of parts, each the whole of an open plasmid,
 * its selected bases, a file or typed bases. A Type IIS enzyme (BsaI, BsmBI, BbsI, SapI ...) cuts the vector and the parts (a virtual digest),
 * the overhangs chain the pieces into a ring. The tool shows the assembly (the order of the parts, the overhang at each junction, warnings for
 * overhangs that repeat or are palindromic, sites that are left) and offers the plasmid as a new tab made from the vector and the parts.
 * Needs cloning-engine.js, cloning-source.js, enzymes-library.js and cloning-output.js.
 */
(function () {
  'use strict';
  if (!window.ToolsTab || !window.CloningEngine || !window.CloningSource || !window.CloningOutput) {
    return;
  }
  const engine = window.CloningEngine;
  const COMMON = ['BsaI', 'BsmBI', 'BbsI', 'SapI', 'Esp3I', 'AarI', 'PaqCI', 'BtgZI'];

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

  // the enzymes that cut outside of their site (Type IIS), the usual ones first
  function enzymeChooser() {
    const all = (window.EnzymeLibrary || { enzymes: {} }).enzymes;
    const outside = Object.keys(all).map(function (key) {
      return all[key];
    }).filter(function (enzyme) {
      return enzyme.topSnipOffset > enzyme.site.length || enzyme.bottomSnipOffset > enzyme.site.length || enzyme.topSnipOffset < 0 || enzyme.bottomSnipOffset < 0;
    }).map(function (enzyme) {
      return enzyme.name;
    }).sort(function (a, b) {
      return a.localeCompare(b);
    });
    const select = element('select', 'tools-select');
    select.title = 'Enzyme';
    [['Usual', COMMON.filter(function (name) {
      return outside.indexOf(name) >= 0;
    })], ['Other type IIS enzymes', outside.filter(function (name) {
      return COMMON.indexOf(name) < 0;
    })]].forEach(function (group) {
      const holder = element('optgroup');
      holder.label = group[0];
      group[1].forEach(function (name) {
        holder.append(Object.assign(element('option', '', name), { value: name }));
      });
      select.append(holder);
    });
    select.value = outside.indexOf('BsaI') >= 0 ? 'BsaI' : (outside[0] || '');
    return select;
  }

  function build() {
    const box = element('div', 'tools-block');
        box.append(element('p', 'tool-muted', 'Assemble parts into a destination vector with a type IIS enzyme. Open a plasmid in the editor and click This plasmid under Destination vector; then, for each part, open its plasmid, select what you want and click Add the selection (or Add this plasmid). The parts are ordered by their overhangs.'));
    const enzyme = enzymeChooser();
    const vector = window.CloningSource.create({ label: 'Destination vector', ring: true });
    const parts = window.CloningSource.createList({ label: 'Parts', single: 'Part' });

    const result = element('div');
    const go = element('button', 'tool-btn tool-btn-primary', 'Find the assembly');
    go.type = 'button';
    go.addEventListener('click', function () {
      result.textContent = '';
      const fail = function (text) {
        result.append(element('p', 'tool-message error', text));
      };
      let v;
      let chosen;
      try {
        v = vector.get();
        chosen = parts.get();
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      if (chosen.length === 0) {
        fail('Add at least one part.');
        return;
      }
      const record = engine.findEnzyme(window.EnzymeLibrary || { enzymes: {} }, enzyme.value);
      let design;
      try {
        design = engine.designGoldenGate({
          enzyme: record,
          destination: { name: v.name, sequence: v.data.sequence, features: v.data.features, circular: !!v.data.circular },
          parts: chosen.map(function (item) {
            return { name: item.name, sequence: item.data.sequence, features: item.data.features, circular: !!item.data.circular };
          }),
        });
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      design.assemblies.forEach(function (assembly, index) {
        const card = element('div', 'tool-card');
        card.append(element('strong', '', (design.assemblies.length > 1 ? 'Assembly ' + (index + 1) + ': ' : 'Assembly: ') + assembly.length + ' bp' + (assembly.stable ? '' : ', still holds a site')));
        const list = element('div', 'tool-muted');
        assembly.order.forEach(function (item, k) {
          list.append(element('div', '', (k + 1) + '. ' + item.name + (item.group === 0 ? ' (backbone, ' : ' (') + item.orientation + ', ' + item.size + ' bp)'));
          const joint = element('div', '', '→ ' + assembly.overhangs[k].sequence + ' →');
          joint.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:0.78rem;margin:0.15rem 0 0.15rem 1rem;color:var(--text-accent,#1a5fb4)';
          list.append(joint);
        });
        card.append(list);
        (assembly.warn || []).forEach(function (text) {
          card.append(element('p', 'tool-message error', text));
        });
          window.CloningOutput.offer(card, {
            info: window.CloningOutput.info(assembly.sequence, assembly.features),
            name: v.name + ' Golden Gate (' + enzyme.value + ', ' + chosen.length + ' parts)',
            genbank: function (fileName) {
              return window.bioParsers.jsonToGenbank({ name: fileName, circular: true, sequence: assembly.sequence, features: assembly.features, primers: {}, parts: {}, translations: {} });
            },
            parents: [v].concat(chosen).map(function (item) {
              return { id: item.id, name: item.name };
            }),
          });
        result.append(card);
      });
      design.warnings.forEach(function (text) {
        result.append(element('p', 'tool-message error', text));
      });
    });
    box.append(enzyme, vector.node, parts.node, go, result);
    return box;
  }

  window.ToolsTab.add({ id: 'golden-gate', title: 'Golden Gate assembly', build: build });
})();
