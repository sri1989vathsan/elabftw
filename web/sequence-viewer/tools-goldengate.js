/**
 * Golden Gate part of the Tools panel (tools-tab.js): the sequence in the editor is the destination vector; the parts are sequences of
 * the Database or typed bases. A Type IIS enzyme (BsaI, BsmBI, BbsI, SapI ...) cuts the vector and the parts, the overhangs chain the
 * pieces into a ring. The tool shows the assembly (the order of the parts, the overhang at each junction, warnings for overhangs that
 * repeat or are palindromic, sites that are left) and can save the plasmid as an entry made from the vector and the parts.
 * Needs cloning-engine.js, cloning-insert.js, enzymes-library.js and tools-pcr.js (the save form).
 */
(function () {
  'use strict';
  if (!window.ToolsTab || !window.CloningEngine || !window.CloningInsert || !window.ToolsPcr) {
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

  function build(editor, context) {
    const box = element('div', 'tools-block');
    box.append(element('p', 'tool-muted', 'Assembles parts into this plasmid (the destination vector) with a type IIS enzyme. The parts are put in the order of their overhangs, whatever order or strand they are given in; a part may be a PCR product or sit in its own plasmid.'));
    const enzyme = enzymeChooser();
    const rows = element('div');
    const pickers = [];
    const addPart = function () {
      const row = element('div', 'tool-card');
      const head = element('div', 'tool-card-top');
      const title = element('strong', '', 'Part ' + (pickers.length + 1));
      const remove = element('button', 'tool-btn', 'Remove');
      remove.type = 'button';
      head.append(title, remove);
      const picker = window.CloningInsert.create();
      const item = { picker: picker, row: row };
      pickers.push(item);
      remove.addEventListener('click', function () {
        pickers.splice(pickers.indexOf(item), 1);
        row.remove();
        pickers.forEach(function (other, index) {
          other.row.querySelector('strong').textContent = 'Part ' + (index + 1);
        });
      });
      row.append(head, picker.node);
      rows.append(row);
    };
    addPart();
    addPart();
    const more = element('button', 'tool-btn', 'Add a part');
    more.type = 'button';
    more.addEventListener('click', addPart);

    const result = element('div');
    const go = element('button', 'tool-btn tool-btn-primary', 'Find the assembly');
    go.type = 'button';
    go.addEventListener('click', function () {
      result.textContent = '';
      const fail = function (text) {
        result.append(element('p', 'tool-message error', text));
      };
      const chosen = pickers.map(function (item) {
        return item.picker.get();
      });
      if (chosen.length === 0 || chosen.some(function (entry) {
        return !entry;
      })) {
        fail('Every part needs a sequence: search the Database or type its bases.');
        return;
      }
      const vector = editor.getState().sequenceData;
      const record = engine.findEnzyme(window.EnzymeLibrary || { enzymes: {} }, enzyme.value);
      const names = chosen.map(function (entry, index) {
        return (entry.entry && entry.entry.title) || 'Part ' + (index + 1);
      });
      let design;
      try {
        design = engine.designGoldenGate({
          enzyme: record,
          destination: { name: 'Destination vector', sequence: vector.sequence, features: vector.features, circular: !!vector.circular },
          parts: chosen.map(function (entry, index) {
            return { name: names[index], sequence: entry.data.sequence, features: entry.data.features, circular: !!entry.data.circular };
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
          list.append(element('div', 'tools-out', '→ ' + assembly.overhangs[k].sequence + ' →'));
        });
        card.append(list);
        (assembly.warn || []).forEach(function (text) {
          card.append(element('p', 'tool-message error', text));
        });
        const save = element('button', 'tool-btn', 'Save the plasmid as a new entry');
        save.type = 'button';
        save.addEventListener('click', function () {
          save.disabled = true;
          const parents = [context.entryId].concat(chosen.map(function (entry) {
            return entry.entry && entry.entry.id;
          })).filter(function (id, i, all) {
            return id && all.indexOf(id) === i;
          });
          window.ToolsPcr.saveEntryForm(card, {
            name: String(context.name || 'plasmid').replace(/\.[^.]+$/, '') + ' Golden Gate (' + enzyme.value + ', ' + chosen.length + ' parts)',
            genbank: function (fileName) {
              return window.bioParsers.jsonToGenbank({ name: fileName, circular: true, sequence: assembly.sequence, features: assembly.features, primers: {}, parts: {}, translations: {} });
            },
            parents: parents,
            parentLabel: 'Made from the vector and the parts',
            primers: [],
            primersLabel: 'No primers',
            saveLabel: 'Save the plasmid',
          });
        });
        card.append(save);
        result.append(card);
      });
      design.warnings.forEach(function (text) {
        result.append(element('p', 'tool-message error', text));
      });
    });
    box.append(enzyme, rows, more, go, result);
    return box;
  }

  window.ToolsTab.add({ id: 'golden-gate', title: 'Golden Gate assembly', build: build });
})();
