/**
 * Restriction cloning part of the Tools panel (tools-tab.js): the sequence in the editor is the vector, the insert is a sequence of
 * the Database or typed bases. One or two enzymes cut the vector and the insert (other enzymes with fitting ends may cut the insert);
 * the tool lists the fragments, chooses the backbone and the piece of the insert, shows the plasmids the ends allow (one for each
 * direction of the insert), what the junctions look like, and can save a plasmid as an entry made from the vector and the insert.
 * Needs cloning-engine.js, cloning-insert.js, enzymes-library.js and tools-pcr.js (the save form).
 */
(function () {
  'use strict';
  if (!window.ToolsTab || !window.CloningEngine || !window.CloningInsert || !window.ToolsPcr) {
    return;
  }
  const engine = window.CloningEngine;

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

  // the enzymes of the commercial library, by name, for the choice lists
  function library() {
    return window.EnzymeLibrary || { enzymes: {} };
  }

  function enzymeList(editor) {
    const all = library().enzymes;
    const names = Object.keys(all).map(function (key) {
      return all[key].name;
    }).sort(function (a, b) {
      return a.localeCompare(b);
    });
    // the enzymes that cut the vector once come first (they are the ones that open it in one place)
    const vector = editor.getState().sequenceData;
    const once = names.filter(function (name) {
      return engine.findCuts(vector.sequence, !!vector.circular, all[name.toLowerCase()] || engine.findEnzyme(library(), name)).cuts.length === 1;
    });
    return { once: once, rest: names.filter(function (name) {
      return once.indexOf(name) < 0;
    }) };
  }

  function chooser(label, list, optional) {
    const select = element('select', 'tools-select');
    select.title = label;
    if (optional) {
      select.append(Object.assign(element('option', '', label + ': none'), { value: '' }));
    }
    const group = function (title, names) {
      const holder = element('optgroup');
      holder.label = title;
      names.forEach(function (name) {
        holder.append(Object.assign(element('option', '', name), { value: name }));
      });
      select.append(holder);
    };
    group('Cut the vector once', list.once);
    group('Others', list.rest);
    if (!optional && list.once.length > 0) {
      select.value = list.once[0];
    } else if (optional) {
      select.value = '';
    }
    return select;
  }

  function build(editor, context) {
    const box = element('div', 'tools-block');
    box.append(element('p', 'tool-muted', 'Cuts the vector (the sequence in the editor) and an insert with one or two enzymes and joins them. The enzymes that cut the vector once are listed first. If the ends of the insert were made by other enzymes with the same overhang (BamHI and BglII), choose them for the insert.'));
    const list = enzymeList(editor);
    const one = chooser('Enzyme 1', list, false);
    const two = chooser('Enzyme 2', list, true);
    const insertDiffers = element('label', 'tool-muted');
    const differs = element('input');
    differs.type = 'checkbox';
    insertDiffers.append(differs, document.createTextNode(' The insert is cut by other enzymes'));
    const insertOne = chooser('Insert enzyme 1', list, true);
    const insertTwo = chooser('Insert enzyme 2', list, true);
    const insertEnzymes = element('div');
    insertEnzymes.hidden = true;
    insertEnzymes.append(insertOne, insertTwo);
    differs.addEventListener('change', function () {
      insertEnzymes.hidden = !differs.checked;
    });
    const picker = window.CloningInsert.create();
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

    const run = function () {
      result.textContent = '';
      const fail = function (text) {
        result.append(element('p', 'tool-message error', text));
      };
      const chosenInsert = picker.get();
      if (!chosenInsert) {
        fail('Choose the insert: search the Database or type its bases.');
        return;
      }
      const state = editor.getState();
      const vectorData = state.sequenceData;
      const find = function (select) {
        return select.value ? engine.findEnzyme(library(), select.value) : null;
      };
      const vectorEnzymes = [find(one), find(two)];
      const options = {
        vector: { sequence: vectorData.sequence, features: vectorData.features, circular: !!vectorData.circular },
        insert: { sequence: chosenInsert.data.sequence, features: chosenInsert.data.features, circular: !!chosenInsert.data.circular },
        vectorEnzymes: vectorEnzymes,
        insertEnzymes: differs.checked ? [find(insertOne), find(insertTwo)] : vectorEnzymes,
        backbone: picks.backbone,
        insertFragment: picks.insertFragment,
      };
      let design;
      try {
        design = engine.designRestriction(options);
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      const again = function () {
        run();
      };
      if (design.vectorFragments.length > 1) {
        result.append(fragmentSelect('Vector piece kept', design.vectorFragments, design.backbone, function (index) {
          picks.backbone = index;
          again();
        }));
      }
      if (design.insertFragments.length > 1) {
        result.append(fragmentSelect('Insert piece', design.insertFragments, design.insertFragment, function (index) {
          picks.insertFragment = index;
          again();
        }));
      }
      const insertName = (chosenInsert.entry && chosenInsert.entry.title) || 'insert';
      if (design.products.length === 0) {
        fail('No plasmid: the ends of the vector and of the insert do not fit.');
      }
      design.products.forEach(function (product, index) {
        const card = element('div', 'tool-card');
        card.append(element('strong', '', (design.products.length > 1 ? 'Plasmid ' + (index + 1) + ', insert ' + product.orientation + ': ' : 'Plasmid: ') + product.length + ' bp'));
        const joints = product.junctions.map(function (joint) {
          const names = joint.enzymes.filter(function (name, i, all) {
            return name && all.indexOf(name) === i;
          }).join(' / ');
          return names + ' ' + (joint.restored.length > 0 ? '(site made again)' : '(scar, cut by neither)');
        });
        card.append(element('div', 'tool-muted', 'Junctions: ' + joints.join(', ')));
        const actions = element('div', 'tool-actions');
        const save = element('button', 'tool-btn', 'Save the plasmid as a new entry');
        save.type = 'button';
        save.addEventListener('click', function () {
          save.disabled = true;
          const parents = [context.entryId, chosenInsert.entry && chosenInsert.entry.id].filter(function (id, i, all) {
            return id && all.indexOf(id) === i;
          });
          const names = [one.value, two.value].filter(Boolean).join(' + ');
          window.ToolsPcr.saveEntryForm(card, {
            name: String(context.name || 'plasmid').replace(/\.[^.]+$/, '') + ' + ' + insertName + ' (' + names + ')',
            genbank: function (fileName) {
              return window.bioParsers.jsonToGenbank({ name: fileName, circular: true, sequence: product.sequence, features: product.features, primers: {}, parts: {}, translations: {} });
            },
            parents: parents,
            parentLabel: 'Made from the vector' + (chosenInsert.entry ? ' and the insert' : ''),
            primers: [],
            primersLabel: 'No primers',
            saveLabel: 'Save the plasmid',
          });
        });
        actions.append(save);
        card.append(actions);
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
    box.append(one, two, insertDiffers, insertEnzymes, picker.node, go, result);
    return box;
  }

  window.ToolsTab.add({ id: 'restriction', title: 'Restriction cloning', build: build });
})();
