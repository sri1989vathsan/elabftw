/**
 * What the cloning tools take their sequences from: buttons that capture the plasmid that is active in the editor (the whole plasmid, or its
 * selected bases), or a file. Exposed as window.CloningSource:
 *   create({label, ring, place}) -> {node, get()}: one sequence (a vector, a donor); ring: a vector can be the selected bases closed into a
 *   circle; place: the vector of a Gibson assembly also keeps where the inserts go;
 *   createList({label, single, onAdd}) -> {node, items(), get()}: several (the inserts, the parts), one is added for each click.
 * get() returns {data, name, id, kind, place, description, lostFeatures} (a list: an array of them) or throws an Error that says what is missing.
 */
(function () {
  'use strict';
  const engine = window.CloningEngine;
  const FILE_VALUE = 'file';

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

  const library = function () {
    return window.EnzymeLibrary || { enzymes: {} };
  };

  async function parse(input, fileName) {
    const results = await window.bioParsers.anyToJson(input, { fileName: fileName });
    const result = Array.isArray(results) ? results[0] : results;
    if (!result || !result.success || !result.parsedSequence || !result.parsedSequence.sequence) {
      throw new Error('This file could not be read as a sequence.');
    }
    return result.parsedSequence;
  }

  // the enzymes of the library that cut a sequence, those that cut once first
  function enzymeNames(data) {
    const all = library().enzymes;
    const once = [];
    const more = [];
    Object.keys(all).forEach(function (key) {
      const cuts = engine.findCuts(data.sequence, !!data.circular, all[key]).cuts.length;
      if (cuts === 1) {
        once.push(all[key].name);
      } else if (cuts > 1) {
        more.push(all[key].name);
      }
    });
    const order = function (a, b) {
      return a.localeCompare(b);
    };
    return { once: once.sort(order), more: more.sort(order) };
  }

  // fills a select with enzyme names (those that cut once first); keeps the choice when it is still there
  function fillEnzymeSelect(select, names, optional, label) {
    const previous = select.value;
    select.textContent = '';
    select.append(Object.assign(element('option', '', label + (optional ? ': none' : ': choose')), { value: '' }));
    [['Cut once', names.once], ['Cut more than once', names.more]].forEach(function (group) {
      if (group[1].length === 0) {
        return;
      }
      const holder = element('optgroup');
      holder.label = group[0];
      group[1].forEach(function (name) {
        holder.append(Object.assign(element('option', '', name), { value: name }));
      });
      select.append(holder);
    });
    select.value = Array.from(select.options).some(function (option) {
      return option.value === previous;
    }) ? previous : '';
  }

  const fmt = function (n) {
    return n.toLocaleString('en');
  };

  // What the buttons capture, from the plasmid that is active in the editor at the moment of the click (a copy: later changes do not follow):
  // the whole plasmid, its selected bases, or a file. A vector (options.ring) can be the selected bases closed into a circle; the vector of a
  // Gibson assembly (options.place) also keeps where the inserts go (the selected bases that are replaced, or the cursor).
  function capture(kind, options) {
    const id = window.CloningDocs.active();
    const doc = id ? window.CloningDocs.get(id) : null;
    if (!doc) {
      throw new Error('No plasmid is open: open a file first.');
    }
    let spec = { mode: 'whole' };
    if (kind !== 'whole') {
      if (!doc.selection) {
        throw new Error('Select the bases in ' + doc.name + ' first.');
      }
      spec = { mode: 'range', from: doc.selection.start, to: doc.selection.end + 1 };
    }
    const piece = engine.extractPiece(doc.data, spec);
    let place = null;
    if (options.place && kind === 'whole') {
      // where the inserts go: the selected bases are replaced, or the cursor is a place that removes nothing
      if (doc.selection) {
        place = { from: doc.selection.start, to: doc.selection.end + 1, text: 'inserts replace the selection, ' + fmt(doc.selection.start + 1) + ' to ' + fmt(doc.selection.end + 1) };
      } else if (doc.caret !== null) {
        place = { from: doc.caret, to: doc.caret, text: 'inserts go at the cursor, after base ' + fmt(doc.caret) };
      } else {
        throw new Error('In ' + doc.name + ', select the bases to replace or click where the inserts go, then click again.');
      }
    }
    if (kind === 'ring') {
      // a vector made of the selected bases: its end is joined to its start, the inserts join at the junction
      piece.circular = true;
      place = { from: 0, to: 0, text: 'inserts join at the two ends of the selection' };
    }
    const size = fmt(piece.sequence.length) + ' bp';
    const selection = kind !== 'whole';
    return {
      data: piece,
      name: doc.name,
      id: doc.id,
      kind: kind,
      place: place,
      lostFeatures: piece.lostFeatures,
      partialFeatures: piece.partialFeatures || 0,
      description: selection ? 'selection ' + fmt(doc.selection.start + 1) + ' to ' + fmt(doc.selection.end + 1) + ', ' + size + (kind === 'ring' ? ', closed into a circle' : '') : 'whole plasmid, ' + size,
    };
  }

  function summaryOf(item, options) {
    return item.name + ': ' + item.description + (item.partialFeatures ? '; ' + item.partialFeatures + ' feature' + (item.partialFeatures === 1 ? '' : 's') + ' cut by the selection (kept as partial)' : '') + (options.place && item.place ? '. ' + item.place.text.charAt(0).toUpperCase() + item.place.text.slice(1) : '') + '.';
  }

  // the buttons: This plasmid, Selection, File. choose(item) is given what was captured (or an Error message in text)
  function buttons(options, choose, fail) {
    const row = element('div', 'tool-actions');
    row.style.margin = '0.2rem 0';
    const make = function (text, title, action) {
      const button = element('button', 'tool-btn', text);
      button.type = 'button';
      button.title = title;
      button.addEventListener('click', async function () {
        try {
          choose(await action());
        } catch (error) {
          fail(error.message || String(error));
        }
      });
      return button;
    };
    row.append(
      make(options.add ? 'Add this plasmid' : 'This plasmid', 'The plasmid that is open in the editor now', function () {
        return capture('whole', options);
      }),
      make(options.add ? 'Add the selection' : (options.ring ? 'Selection (closed into a circle)' : 'Selection'), 'The bases that are selected in the plasmid that is open in the editor now', function () {
        return capture(options.ring ? 'ring' : 'range', options);
      })
    );
    const file = element('input');
    file.type = 'file';
    file.accept = '.gb,.gbk,.gbff,.genbank,.fasta,.fa,.fna,.dna';
    file.hidden = true;
    file.addEventListener('change', async function () {
      const picked = file.files && file.files[0];
      file.value = '';
      if (!picked) {
        return;
      }
      try {
        const data = await parse(/\.dna$/i.test(picked.name) ? picked : await picked.text(), picked.name);
        const piece = engine.extractPiece(data, { mode: 'whole' });
        choose({ data: piece, name: picked.name.replace(/\.[^.]+$/, ''), id: null, kind: 'whole', place: null, lostFeatures: 0, description: 'file, ' + fmt(piece.sequence.length) + ' bp' });
      } catch (error) {
        fail(error.message || String(error));
      }
    });
    const fileButton = element('button', 'tool-btn', 'File…');
    fileButton.type = 'button';
    fileButton.title = 'A GenBank, FASTA or SnapGene file';
    fileButton.addEventListener('click', function () {
      file.click();
    });
    row.append(fileButton, file);
    return row;
  }

  // one thing to choose (a vector, a donor ...): the buttons set it, a line says what it is
  function create(options) {
    const box = element('div');
    box.style.cssText = 'margin:0.2rem 0 0.8rem';
    box.append(element('strong', '', options.label || 'Sequence'));
    const info = element('div', 'tool-muted');
    info.style.fontSize = '0.82rem';
    info.textContent = 'Not chosen yet.';
    let chosen = null;
    const row = buttons(options, function (item) {
      chosen = item;
      info.textContent = summaryOf(item, options);
      box.dispatchEvent(new Event('change'));
    }, function (message) {
      info.textContent = message;
    });
    box.append(row, info);
    return {
      node: box,
      get: function () {
        if (!chosen) {
          throw new Error('Choose the ' + (options.label || 'sequence').toLowerCase() + ': click This plasmid or Selection.');
        }
        return chosen;
      },
    };
  }

  // several of one kind (the inserts, the parts): the buttons add one each time, each can be removed; options.onAdd(item) can add controls to it
  function createList(options) {
    const box = element('div');
    box.style.cssText = 'margin:0.2rem 0 0.8rem';
    box.append(element('strong', '', options.label || 'Sequences'));
    const rows = element('div');
    const info = element('div', 'tool-muted');
    info.style.fontSize = '0.82rem';
    const items = [];
    const renumber = function () {
      items.forEach(function (item, index) {
        item.title.textContent = (options.single || 'Item') + ' ' + (index + 1) + ': ' + item.captured.name;
      });
    };
    const add = function (captured) {
      info.textContent = '';
      const item = { captured: captured, node: element('div'), extra: null };
      item.node.style.cssText = 'border:1px solid #dde2e8;border-radius:0.4rem;padding:0.3rem 0.5rem;margin:0.3rem 0';
      const head = element('div');
      head.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
      item.title = element('strong');
      const remove = element('button', 'tool-btn', '×');
      remove.type = 'button';
      remove.title = 'Remove';
      remove.style.cssText = 'padding:0 0.5rem;line-height:1.3';
      remove.addEventListener('click', function () {
        items.splice(items.indexOf(item), 1);
        item.node.remove();
        renumber();
      });
      head.append(item.title, remove);
      const line = element('div', 'tool-muted', summaryOf(captured, options));
      line.style.fontSize = '0.82rem';
      item.node.append(head, line);
      items.push(item);
      rows.append(item.node);
      renumber();
      if (options.onAdd) {
        options.onAdd(item);
      }
    };
    const row = buttons(Object.assign({}, options, { add: true, ring: false, place: false }), add, function (message) {
      info.textContent = message;
    });
    box.append(rows, row, info);
    return {
      node: box,
      items: function () {
        return items;
      },
      get: function () {
        if (items.length === 0) {
          throw new Error('Add at least one ' + (options.single || 'item').toLowerCase() + ': click Add this plasmid or Add the selection.');
        }
        return items.map(function (item) {
          return item.captured;
        });
      },
    };
  }

  window.CloningSource = { create: create, createList: createList, enzymeNames: enzymeNames, fillEnzymeSelect: fillEnzymeSelect };
})();
