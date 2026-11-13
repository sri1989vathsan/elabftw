/**
 * PCR parts of the Tools panel (tools-tab.js): the products of two primers on the sequence (with their tails), the fusion of two
 * fragments by overlap extension PCR, and mutagenesis (replace, insert or delete bases of the sequence). A product can be sent to the
 * gel of "Compare digests". Needs primer-tools.js. Exposed as window.ToolsPcr.
 */
(function () {
  'use strict';
  if (!window.ToolsTab || !window.PrimerTools) {
    return;
  }
  const tools = window.PrimerTools;
  const MAX_PRODUCT = 20000;

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

  function copyButton(getText) {
    const button = element('button', 'tool-btn', 'Copy the sequence');
    button.type = 'button';
    button.addEventListener('click', function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(getText()).then(function () {
          button.textContent = 'Copied';
        });
      }
    });
    return button;
  }

  /**
   * The products two primers can make on a sequence: one primer binds the top strand, the other the bottom strand downstream.
   * A tail (the 5' bases that do not bind) is part of the product.
   *
   * @returns {Array<{start: number, end: number, size: number, sequence: string, forward: object, reverse: object}>} start and end on the sequence (end included)
   */
  function products(sequence, circular, primerA, primerB) {
    const seq = tools.clean(sequence);
    const length = seq.length;
    const text = circular ? seq + seq : seq;
    const bindings = function (primer) {
      const clean = tools.clean(primer);
      return { primer: clean, sites: tools.findSites(seq, clean, circular) };
    };
    const found = [];
    [[bindings(primerA), bindings(primerB)], [bindings(primerB), bindings(primerA)]].forEach(function (pair) {
      pair[0].sites.filter(function (s) {
        return s.forward;
      }).forEach(function (f) {
        pair[1].sites.filter(function (s) {
          return !s.forward;
        }).forEach(function (r) {
          let rEnd = r.end;
          if (rEnd <= f.start && circular) {
            rEnd += length;
          }
          if (rEnd <= f.start || rEnd - f.start > MAX_PRODUCT || rEnd > text.length) {
            return;
          }
          const tailF = pair[0].primer.slice(0, f.tail || 0);
          const tailR = pair[1].primer.slice(0, r.tail || 0);
          const body = text.slice(f.start, rEnd);
          const sequenceOut = tailF + body + tools.reverseComplement(tailR);
          found.push({ start: f.start % length, end: (rEnd - 1) % length, size: sequenceOut.length, sequence: sequenceOut, forward: { primer: pair[0].primer, site: f }, reverse: { primer: pair[1].primer, site: r } });
        });
      });
    });
    return found.filter(function (item, index) {
      return found.findIndex(function (other) {
        return other.start === item.start && other.end === item.end && other.size === item.size;
      }) === index;
    }).sort(function (a, b) {
      return a.size - b.size;
    });
  }

  function primerChooser(label, list) {
    const box = element('div');
    const select = element('select', 'tools-select');
    select.append(Object.assign(element('option', '', label + ': type a sequence below'), { value: '' }));
    list.forEach(function (primer) {
      select.append(Object.assign(element('option', '', primer.title + ' (' + primer.sequence.length + ' b)'), { value: primer.sequence }));
    });
    const input = element('input');
    input.type = 'text';
    input.placeholder = label + ', 5′ to 3′';
    box.append(select, input);
    return { box: box, value: function () {
      return select.value || input.value;
    }, set: function (sequence) {
      // a primer of the list is chosen; any other bases are typed
      const known = Array.from(select.options).some(function (option) {
        return option.value === sequence;
      });
      select.value = known ? sequence : '';
      input.value = known ? '' : sequence;
    } };
  }

  // ---- a product is made an entry of the Database: a linear sequence (the features of the template that it holds and the two primers
  // drawn on it) in the module of the plasmids, made from the plasmid it was amplified from, with the two primers attached to it
  function genbankOf(item, template, name, names) {
    const features = {};
    const tailF = item.forward.site.tail || 0;
    const wraps = item.start > item.end;
    let counter = 0;
    if (!wraps) {
      Object.keys(template.features || {}).forEach(function (key) {
        const f = template.features[key];
        if (!f || f.start > f.end || f.end < item.start || f.start > item.end) {
          return;
        }
        counter += 1;
        features['f' + counter] = Object.assign({}, f, { id: 'f' + counter, start: Math.max(f.start, item.start) - item.start + tailF, end: Math.min(f.end, item.end) - item.start + tailF });
      });
    }
    // the oligos, whole (the tail included), on the product
    const lengthF = item.forward.primer.length;
    const lengthR = item.reverse.primer.length;
    features.pf = { id: 'pf', name: names.forward, type: 'primer_bind', start: 0, end: Math.min(item.size, lengthF) - 1, strand: 1 };
    features.pr = { id: 'pr', name: names.reverse, type: 'primer_bind', start: Math.max(0, item.size - lengthR), end: item.size - 1, strand: -1 };
    return window.bioParsers.jsonToGenbank({ name: name, circular: false, sequence: item.sequence, features: features, primers: {}, parts: {}, translations: {} });
  }

  function saveProduct(item, card, context, editor, byBases) {
    const csrf = document.body.dataset.csrf || '';
    const form = element('div', 'tool-card');
    const names = {
      forward: (byBases[item.forward.primer] || {}).title || 'Primer 1',
      reverse: (byBases[item.reverse.primer] || {}).title || 'Primer 2',
    };
    const template = String(context.name || 'plasmid').replace(/\.[^.]+$/, '');
    const name = element('input', 'tools-select');
    name.type = 'text';
    name.value = template + ' PCR ' + names.forward + ' + ' + names.reverse + ' (' + item.size + ' bp)';
    const where = element('select', 'tools-select');
    [['none', 'My entries (private, no number yet)'], ['lab', 'The lab database (it is locked)']].forEach(function (choice) {
      where.append(Object.assign(element('option', '', choice[1]), { value: choice[0] }));
    });
    const parent = element('label', 'tool-muted');
    const parentBox = element('input');
    parentBox.type = 'checkbox';
    parentBox.checked = Boolean(context.entryId);
    parentBox.disabled = !context.entryId;
    parent.append(parentBox, document.createTextNode(' Made from this plasmid'));
    const primersLabel = element('label', 'tool-muted');
    const primersBox = element('input');
    primersBox.type = 'checkbox';
    const ids = [byBases[item.forward.primer], byBases[item.reverse.primer]].filter(function (entry) {
      return entry && entry.id;
    });
    primersBox.checked = ids.length > 0;
    primersBox.disabled = ids.length === 0;
    primersLabel.append(primersBox, document.createTextNode(' Attach the two primers to it'));
    const message = element('div', 'tool-muted');
    const save = element('button', 'tool-btn tool-btn-primary', 'Save the product');
    save.type = 'button';
    save.addEventListener('click', async function () {
      if (name.value.trim() === '') {
        message.textContent = 'A name is needed.';
        return;
      }
      save.disabled = true;
      message.textContent = 'Saving...';
      const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf };
      try {
        // the module of the plasmids: the one that needs a sequence file
        const modules = (await (await fetch('../registry-modules.php', { credentials: 'same-origin' })).json()).modules || [];
        const module = modules.find(function (m) {
          return m.settings && m.settings.requires_sequence_file;
        }) || modules.find(function (m) {
          return /plasmid/i.test(m.title);
        });
        if (!module) {
          throw new Error('There is no module of plasmids to put it in.');
        }
        const made = await fetch('../api/v2/inventory', { method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({ category: module.id, title: name.value.trim(), register: where.value }) });
        if (!made.ok) {
          throw new Error('The entry could not be made (' + made.status + ').');
        }
        const id = Number((made.headers.get('Location') || '').split('/').pop());
        const text = genbankOf(item, editor.getState().sequenceData, name.value.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 40), names);
        const data = new FormData();
        data.append('file', new File([text], name.value.trim().replace(/[^A-Za-z0-9_.-]+/g, '_') + '.gb', { type: 'text/plain' }));
        const uploaded = await fetch('../api/v2/inventory/' + id + '/uploads', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, 'X-Requested-With': 'XMLHttpRequest' }, body: data });
        if (!uploaded.ok) {
          throw new Error('The sequence could not be saved (' + uploaded.status + ').');
        }
        if (parentBox.checked && context.entryId) {
          await fetch('../lineage.php', { method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({ action: 'add', entry: id, parent: context.entryId }) });
        }
        if (primersBox.checked) {
          for (const entry of ids) {
            await tools.attach(id, entry.id);
          }
        }
        if (where.value === 'lab') {
          await fetch('../registry-lock.php', { method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({ id: id }) });
        }
        message.textContent = '';
        const open = element('a', 'tool-btn', 'Open the new entry');
        open.href = '../registry.php?mode=view&id=' + id;
        open.target = '_blank';
        open.rel = 'noopener';
        message.append(document.createTextNode('Saved. '), open);
      } catch (error) {
        message.textContent = error.message || String(error);
        save.disabled = false;
      }
    });
    form.append(element('div', 'tool-muted', 'Name'), name, element('div', 'tool-muted', 'Where it goes'), where, parent, primersLabel, save, message);
    card.append(form);
  }

  async function pcr(editor, context) {
    const box = element('div', 'tools-block');
    box.append(element('p', 'tool-muted', 'The products two primers make on this sequence, tails included. Choose primers attached to the entry or type them.'));
    let list = [];
    try {
      if (context.entryId) {
        list = (await tools.attached(context.entryId)).primers.filter(function (p) {
          return p.sequence;
        });
      }
    } catch (error) {
      list = [];
    }
    const one = primerChooser('Primer 1', list);
    const two = primerChooser('Primer 2', list);
    // the primers of the list by their bases (the products name them and attach them)
    const byBases = {};
    list.forEach(function (primer) {
      byBases[tools.clean(primer.sequence)] = primer;
    });
    const result = element('div');
    const go = element('button', 'tool-btn tool-btn-primary', 'Find the products');
    go.type = 'button';
    go.addEventListener('click', function () {
      result.textContent = '';
      const a = tools.clean(one.value());
      const b = tools.clean(two.value());
      if (a.length < 12 || b.length < 12) {
        result.append(element('p', 'tool-message error', 'Both primers need at least 12 bases.'));
        return;
      }
      const data = editor.getState().sequenceData;
      const found = products(data.sequence, !!data.circular, a, b);
      if (found.length === 0) {
        result.append(element('p', 'tool-message error', 'No product: the primers do not face each other on the sequence (or do not bind it).'));
        return;
      }
      result.append(element('p', 'tool-muted', found.length + (found.length === 1 ? ' product' : ' products') + ':'));
      window.DigestCompare = window.DigestCompare || {};
      window.DigestCompare.pcrLanes = found.slice(0, 6).map(function (item, index) {
        return { label: 'PCR ' + (index + 1), size: item.size, start: item.start, end: item.end };
      });
      found.slice(0, 6).forEach(function (item, index) {
        const card = element('div', 'tool-card');
        const gcCount = item.sequence.replace(/[^GC]/g, '').length;
        card.append(element('strong', '', 'Product ' + (index + 1) + ': ' + item.size + ' bp'), element('div', 'tool-muted', 'on the sequence ' + (item.start + 1) + '..' + (item.end + 1) + ', GC ' + (gcCount / item.size * 100).toFixed(1) + ' %'));
        const actions = element('div', 'tool-actions');
        const select = element('button', 'tool-btn', 'Select it');
        select.type = 'button';
        select.addEventListener('click', function () {
          editor.updateEditor({ selectionLayer: { start: item.start, end: item.end }, caretPosition: -1 });
        });
        const gel = element('button', 'tool-btn', 'Show on the gel');
        gel.type = 'button';
        gel.addEventListener('click', function () {
          if (window.ToolSidebar) {
            window.ToolSidebar.open('digest');
          }
        });
        const make = element('button', 'tool-btn', 'Save as a new entry');
        make.type = 'button';
        make.title = 'Make this product an entry of the Database (a linear sequence, made from this plasmid)';
        make.addEventListener('click', function () {
          make.disabled = true;
          saveProduct(item, card, context, editor, byBases);
        });
        actions.append(select, copyButton(function () {
          return item.sequence;
        }), gel, make);
        card.append(actions);
        result.append(card);
      });
    });
    box.append(one.box, two.box, go, result);
    // two primers chosen elsewhere (the Primers tab): they are put in and the products are looked for
    window.ToolsPcr.fill = function (a, b) {
      one.set(a);
      two.set(b);
      go.click();
    };
    if (window.ToolsPcr.pending) {
      const wanted = window.ToolsPcr.pending;
      window.ToolsPcr.pending = null;
      window.setTimeout(function () {
        window.ToolsPcr.fill(wanted.a, wanted.b);
      }, 0);
    }
    return box;
  }

  // ---- overlap extension PCR ----
  function overlapExtension() {
    const box = element('div', 'tools-block');
    box.append(element('p', 'tool-muted', 'Fuses two fragments that share an end: the end of fragment 1 equals the start of fragment 2 (at least 15 bases). Both written 5′ to 3′ on the same strand.'));
    const first = element('textarea');
    const second = element('textarea');
    [first, second].forEach(function (area, index) {
      area.rows = 2;
      area.placeholder = 'Fragment ' + (index + 1);
      area.style.cssText = 'width:100%;margin:0 0 0.4rem;font-family:ui-monospace,Menlo,monospace;font-size:0.78rem';
      box.append(area);
    });
    const result = element('div');
    const go = element('button', 'tool-btn tool-btn-primary', 'Fuse them');
    go.type = 'button';
    go.addEventListener('click', function () {
      result.textContent = '';
      const a = tools.clean(first.value);
      const b = tools.clean(second.value);
      let overlap = 0;
      for (let n = Math.min(a.length, b.length); n >= 15; n--) {
        if (a.slice(-n) === b.slice(0, n)) {
          overlap = n;
          break;
        }
      }
      if (overlap === 0) {
        result.append(element('p', 'tool-message error', 'No overlap of 15 bases or more between the end of fragment 1 and the start of fragment 2.'));
        return;
      }
      const fused = a + b.slice(overlap);
      result.append(element('p', 'tool-muted', 'Fused product: ' + fused.length + ' bp, overlap ' + overlap + ' bases.'), element('div', 'tools-out', fused), copyButton(function () {
        return fused;
      }));
    });
    box.append(go, result);
    return box;
  }

  // ---- mutagenesis ----
  function mutagenesis(editor) {
    const box = element('div', 'tools-block');
    box.append(element('p', 'tool-muted', 'Changes the sequence: the selected bases are replaced by the bases below (leave it empty to delete them); with no selection the bases are inserted at the cursor. The features move with the change; Undo restores it.'));
    const input = element('input');
    input.type = 'text';
    input.placeholder = 'New bases (A, C, G, T)';
    const result = element('div');
    const go = element('button', 'tool-btn tool-btn-primary', 'Apply the change');
    go.type = 'button';
    go.addEventListener('click', function () {
      result.textContent = '';
      const utils = window.sequenceUtils;
      const state = editor.getState();
      const bases = tools.clean(input.value);
      const selection = state.selectionLayer || {};
      const hasSelection = selection.start >= 0 && selection.end >= 0;
      if (!utils || typeof utils.insertSequenceDataAtPositionOrRange !== 'function') {
        result.append(element('p', 'tool-message error', 'The sequence utilities are not loaded.'));
        return;
      }
      if (!hasSelection && (state.caretPosition === undefined || state.caretPosition < 0)) {
        result.append(element('p', 'tool-message error', 'Select the bases to change, or click where the new bases go.'));
        return;
      }
      if (!hasSelection && bases === '') {
        result.append(element('p', 'tool-message error', 'Type the bases to insert.'));
        return;
      }
      let data;
      if (hasSelection) {
        data = bases === '' ? utils.deleteSequenceDataAtRange(state.sequenceData, { start: selection.start, end: selection.end }) : utils.insertSequenceDataAtPositionOrRange({ sequence: bases }, state.sequenceData, { start: selection.start, end: selection.end });
      } else {
        data = utils.insertSequenceDataAtPositionOrRange({ sequence: bases }, state.sequenceData, state.caretPosition);
      }
      const before = state.sequenceData.sequence.length;
      editor.updateEditor({ sequenceData: data, selectionLayer: { start: -1, end: -1 }, caretPosition: -1 });
      result.append(element('p', 'tool-message', 'Done: the sequence went from ' + before + ' to ' + data.sequence.length + ' bases.'));
    });
    box.append(input, go, result);
    return box;
  }

  window.ToolsTab.add({ id: 'pcr', title: 'PCR products of two primers', build: pcr });
  window.ToolsTab.add({ id: 'oe-pcr', title: 'Overlap extension PCR', build: overlapExtension });
  window.ToolsTab.add({ id: 'mutagenesis', title: 'Mutagenesis', build: mutagenesis });
  window.ToolsPcr = {
    products: products,
    // the PCR section of the Tools panel is opened with two primers in it (called by the Primers tab)
    show: function (a, b) {
      window.ToolsPcr.pending = { a: a, b: b };
      window.ToolSidebar.open('tools');
      window.setTimeout(function () {
        const part = Array.from(document.querySelectorAll('details.tools-part')).find(function (node) {
          return /PCR products of two primers/.test((node.querySelector('summary') || {}).textContent || '');
        });
        if (!part) {
          return;
        }
        if (part.open && window.ToolsPcr.fill) {
          // it was built already: it is filled in at once
          const wanted = window.ToolsPcr.pending;
          window.ToolsPcr.pending = null;
          window.ToolsPcr.fill(wanted.a, wanted.b);
        } else {
          part.open = true;
        }
      }, 150);
    },
  };
})();
