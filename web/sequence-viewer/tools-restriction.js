/**
 * Restriction cloning part of the Tools panel: a vector and one or several inserts, each the whole of an open plasmid or its selected bases
 * (or a file, an example, typed bases). One or two enzymes cut the vector; each insert is cut with the same enzymes or with enzymes of its own
 * (other enzymes with fitting ends, or the enzyme of the junction between two inserts): a virtual digest and ligation. One insert: the tool
 * lists the fragments, chooses the backbone and the piece of the insert and shows the plasmid for each direction. Several inserts: they are
 * chained by their ends, in the order the ends fit. A plasmid is offered as a new tab made from the vector and the inserts.
 * Needs cloning-engine.js, cloning-source.js, enzymes-library.js and cloning-output.js.
 */
(function () {
  'use strict';
  if (!window.ToolsTab || !window.CloningEngine || !window.CloningSource || !window.CloningOutput) {
    return;
  }
  const engine = window.CloningEngine;
  const source = window.CloningSource;

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

  const safeGet = function (chooser) {
    try {
      return chooser.get();
    } catch (error) {
      return null;
    }
  };

  function build() {
    const box = element('div', 'tools-block');
        box.append(element('p', 'tool-muted', 'Cut a vector and one or more inserts with enzymes and join them. Open a plasmid in the editor and click This plasmid (or select bases and click Selection) under Vector; do the same for each insert. Give an insert enzymes of its own when its ends were made by others.'));
    const vector = source.create({ label: 'Vector', ring: true });
    const one = element('select', 'tools-select');
    const two = element('select', 'tools-select');
    const fillVector = function () {
      const chosen = safeGet(vector);
      const names = chosen ? source.enzymeNames(chosen.data) : { once: [], more: [] };
      source.fillEnzymeSelect(one, names, false, 'Enzyme 1');
      source.fillEnzymeSelect(two, names, true, 'Enzyme 2');
      if (one.value === '' && names.once.length > 0) {
        one.value = names.once[0];
      }
    };
    vector.node.addEventListener('change', fillVector);
    fillVector();

    // the inserts: one is added for each click; each can be cut with enzymes of its own (default: the vector's enzymes)
    const inserts = source.createList({ label: 'Inserts', single: 'Insert', onAdd: function (item) {
      item.one = element('select', 'tools-select');
      item.two = element('select', 'tools-select');
      const names = source.enzymeNames(item.captured.data);
      source.fillEnzymeSelect(item.one, names, true, 'Cut with (default: the vector\'s enzymes)');
      source.fillEnzymeSelect(item.two, names, true, 'and with');
      item.node.append(item.one, item.two);
    } });

    const result = element('div');
    let picks = { backbone: undefined, insertFragment: undefined };
    const fragmentSelect = function (title, fragments, chosen, onChange) {
      const select = element('select', 'tools-select');
      select.title = title;
      fragments.forEach(function (fragment) {
        select.append(Object.assign(element('option', '', title + ': ' + fragment.size + ' bp (' + fragment.left + ' to ' + fragment.right + ')'), { value: String(fragment.index) }));
      });
      select.value = String(chosen);
      select.addEventListener('change', function () {
        onChange(Number(select.value));
      });
      return select;
    };
    const toGenbank = function (sequence, features) {
      return function (fileName) {
        return window.bioParsers.jsonToGenbank({ name: fileName, circular: true, sequence: sequence, features: features, primers: {}, parts: {}, translations: {} });
      };
    };

    const run = function () {
      result.textContent = '';
      const fail = function (text) {
        result.append(element('p', 'tool-message error', text));
      };
      let v;
      let chosen;
      try {
        v = vector.get();
        chosen = inserts.get();
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      const find = function (select) {
        return select.value ? engine.findEnzyme(window.EnzymeLibrary || { enzymes: {} }, select.value) : null;
      };
      const vectorEnzymes = [find(one), find(two)];
      const ownEnzymes = inserts.items().map(function (item) {
        return [find(item.one), find(item.two)].filter(Boolean);
      });
      const parents = [v].concat(chosen).map(function (item) {
        return { id: item.id, name: item.name };
      });
      const names = [one.value, two.value].filter(Boolean).join(' + ');
      const vectorData = { name: v.name, sequence: v.data.sequence, features: v.data.features, circular: !!v.data.circular };
      const insertData = chosen.map(function (item, index) {
        return { name: item.name, sequence: item.data.sequence, features: item.data.features, circular: !!item.data.circular, enzymes: ownEnzymes[index] };
      });

      if (chosen.length > 1) {
        let design;
        try {
          design = engine.designRestrictionMulti({ vector: vectorData, vectorEnzymes: vectorEnzymes, inserts: insertData });
        } catch (error) {
          fail(error.message || String(error));
          return;
        }
        design.assemblies.forEach(function (assembly, index) {
          const card = element('div', 'tool-card');
          card.append(element('strong', '', (design.assemblies.length > 1 ? 'Plasmid ' + (index + 1) + ': ' : 'Plasmid: ') + assembly.length + ' bp'));
          const list = element('div', 'tool-muted');
          assembly.order.forEach(function (entry, k) {
            list.append(element('div', '', (k + 1) + '. ' + entry.name + (k === 0 ? ' (backbone, ' : ' (') + entry.orientation + ', ' + entry.size + ' bp)'));
            const joint = element('div', '', '→ ' + assembly.junctions[k].enzymes.join(' / ') + ' →');
            joint.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:0.78rem;margin:0.15rem 0 0.15rem 1rem;color:var(--text-accent,#1a5fb4)';
            list.append(joint);
          });
          card.append(list);
          (assembly.warn || []).forEach(function (text) {
            card.append(element('p', 'tool-message error', text));
          });
            window.CloningOutput.offer(card, { info: window.CloningOutput.info(assembly.sequence, assembly.features), name: v.name + ' + ' + chosen.map(function (item) {
              return item.name;
            }).join(' + ') + ' (' + names + ')', genbank: toGenbank(assembly.sequence, assembly.features), parents: parents });
          result.append(card);
        });
        design.warnings.forEach(function (text) {
          result.append(element('p', 'tool-message error', text));
        });
        return;
      }

      // one insert: the fragments, and the plasmid for each direction
      let design;
      try {
        design = engine.designRestriction({
          vector: vectorData,
          insert: insertData[0],
          vectorEnzymes: vectorEnzymes,
          insertEnzymes: ownEnzymes[0].length > 0 ? ownEnzymes[0] : vectorEnzymes,
          backbone: picks.backbone,
          insertFragment: picks.insertFragment,
        });
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      if (design.vectorFragments.length > 1) {
        result.append(fragmentSelect('Vector piece kept', design.vectorFragments, design.backbone, function (index) {
          picks.backbone = index;
          run();
        }));
      }
      if (design.insertFragments.length > 1) {
        result.append(fragmentSelect('Insert piece', design.insertFragments, design.insertFragment, function (index) {
          picks.insertFragment = index;
          run();
        }));
      }
      if (design.products.length === 0) {
        fail('No plasmid: the ends of the vector and of the insert do not fit.');
      }
      design.products.forEach(function (product, index) {
        const card = element('div', 'tool-card');
        card.append(element('strong', '', (design.products.length > 1 ? 'Plasmid ' + (index + 1) + ', insert ' + product.orientation + ': ' : 'Plasmid: ') + product.length + ' bp'));
        const joints = product.junctions.map(function (joint) {
          const label = joint.enzymes.filter(function (name, k, all) {
            return name && all.indexOf(name) === k;
          }).join(' / ');
          return label + ' ' + (joint.restored.length > 0 ? '(site made again)' : '(scar, cut by neither)');
        });
        card.append(element('div', 'tool-muted', 'Junctions: ' + joints.join(', ')));
          window.CloningOutput.offer(card, { info: window.CloningOutput.info(product.sequence, product.features), name: v.name + ' + ' + chosen[0].name + ' (' + names + ')', genbank: toGenbank(product.sequence, product.features), parents: parents });
        result.append(card);
      });
      design.warnings.forEach(function (text) {
        result.append(element('p', 'tool-message error', text));
      });
    };

    const go = element('button', 'tool-btn tool-btn-primary', 'Find the plasmids');
    go.type = 'button';
    go.addEventListener('click', function () {
      picks = { backbone: undefined, insertFragment: undefined };
      run();
    });
    box.append(vector.node, one, two, inserts.node, go, result);
    return box;
  }

  window.ToolsTab.add({ id: 'restriction', title: 'Restriction cloning', build: build });
})();
