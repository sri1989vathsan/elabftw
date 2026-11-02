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
    } };
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
        actions.append(select, copyButton(function () {
          return item.sequence;
        }), gel);
        card.append(actions);
        result.append(card);
      });
    });
    box.append(one.box, two.box, go, result);
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
  window.ToolsPcr = { products: products };
})();
