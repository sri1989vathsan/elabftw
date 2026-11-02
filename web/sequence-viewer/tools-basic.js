/**
 * The small actions of the Tools panel (tools-tab.js): DNA calculations, make protein, make RNA, linearize, anneal oligos, and the
 * tables of letter codes and genetic codes. Needs nothing but the editor. Exposed as window.ToolsBasic.
 */
(function () {
  'use strict';
  if (!window.ToolsTab) {
    return;
  }

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

  const COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G', R: 'Y', Y: 'R', K: 'M', M: 'K', S: 'S', W: 'W', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N', U: 'A' };
  const complement = function (sequence) {
    return sequence.split('').map(function (b) {
      return COMPLEMENT[b] || 'N';
    }).join('');
  };
  const reverseComplement = function (sequence) {
    return complement(sequence).split('').reverse().join('');
  };

  // the selection (or the whole sequence), as the bases it covers
  function region(editor) {
    const state = editor.getState();
    const sequence = String(state.sequenceData.sequence || '').toUpperCase();
    const selection = state.selectionLayer || {};
    if (selection.start >= 0 && selection.end >= 0) {
      const part = selection.end >= selection.start ? sequence.slice(selection.start, selection.end + 1) : sequence.slice(selection.start) + sequence.slice(0, selection.end + 1);
      return { bases: part, selected: true };
    }
    return { bases: sequence, selected: false };
  }

  function output(text) {
    const box = element('div');
    const area = element('div', 'tools-out', text);
    const copy = element('button', 'tool-btn', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(area.textContent).then(function () {
          copy.textContent = 'Copied';
        });
      }
    });
    box.append(area, copy);
    return box;
  }

  function block(...nodes) {
    const box = element('div', 'tools-block');
    box.append(...nodes);
    return box;
  }

  // a button that redraws its result each time it is pressed
  function action(label, run) {
    const result = element('div');
    const button = element('button', 'tool-btn tool-btn-primary', label);
    button.type = 'button';
    button.addEventListener('click', function () {
      result.textContent = '';
      try {
        result.append(run());
      } catch (error) {
        result.append(element('p', 'tool-message error', error.message || String(error)));
      }
    });
    return [button, result];
  }

  // ---- DNA calculations ----
  const WEIGHT = { A: 313.21, C: 289.18, G: 329.21, T: 304.2 };
  function calculations(editor) {
    const [button, result] = action('Calculate', function () {
      const part = region(editor);
      const bases = part.bases.replace(/[^ACGT]/g, '');
      if (bases.length === 0) {
        throw new Error('There are no bases to calculate.');
      }
      const count = { A: 0, C: 0, G: 0, T: 0 };
      bases.split('').forEach(function (b) {
        count[b]++;
      });
      const gc = ((count.G + count.C) / bases.length) * 100;
      let single = -61.96;
      Object.keys(count).forEach(function (b) {
        single += count[b] * WEIGHT[b];
      });
      let double = single;
      complement(bases).split('').forEach(function (b) {
        double += WEIGHT[b];
      });
      const tm = window.PrimerTools && bases.length <= 120 ? window.PrimerTools.tm(bases) : 64.9 + (41 * (count.G + count.C - 16.4)) / bases.length;
      const rows = [
        ['Region', part.selected ? 'the selection' : 'the whole sequence'],
        ['Length', bases.length + ' bp'],
        ['A / C / G / T', count.A + ' / ' + count.C + ' / ' + count.G + ' / ' + count.T],
        ['GC content', gc.toFixed(1) + ' %'],
        ['Tm', Math.round(tm * 10) / 10 + ' °C' + (bases.length > 120 ? ' (rule for long DNA)' : ' (nearest neighbour)')],
        ['Mass, single strand', (single / 1000).toFixed(2) + ' kDa'],
        ['Mass, double strand', (double / 1000).toFixed(2) + ' kDa'],
        ['1 µg of it', (1e6 / double).toFixed(3) + ' pmol (double strand)'],
      ];
      const table = element('table', 'tools-table');
      rows.forEach(function (row) {
        const tr = element('tr');
        tr.append(element('th', '', row[0]), element('td', '', row[1]));
        table.append(tr);
      });
      return table;
    });
    return block(element('p', 'tool-muted', 'The length, base counts, GC content, melting temperature and mass of the selection, or of the whole sequence.'), button, result);
  }

  // ---- genetic codes ----
  // the codons in the order T, C, A, G for each of the three positions
  const CODES = {
    '1': ['Standard', 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'],
    '2': ['Vertebrate mitochondrial', 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG'],
    '3': ['Yeast mitochondrial', 'FFLLSSSSYY**CCWWTTTTPPPPHHQQRRRRIIMMTTTTNNKKSSRRVVVVAAAADDEEGGGG'],
    '4': ['Mold, protozoan, coelenterate mitochondrial', 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'],
    '11': ['Bacterial, archaeal, plant plastid', 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'],
  };
  const ORDER = 'TCAG';
  const codeSelect = function () {
    const select = element('select', 'tools-select');
    Object.keys(CODES).forEach(function (id) {
      const option = element('option', '', CODES[id][0] + ' (table ' + id + ')');
      option.value = id;
      select.append(option);
    });
    return select;
  };
  const translateCodon = function (codon, table) {
    const index = codon.split('').map(function (b) {
      return ORDER.indexOf(b);
    });
    return index.indexOf(-1) !== -1 ? 'X' : CODES[table][1][16 * index[0] + 4 * index[1] + index[2]];
  };

  function geneticCodes() {
    const select = codeSelect();
    const holder = element('div');
    const draw = function () {
      holder.textContent = '';
      const table = element('table', 'tools-table');
      const head = element('tr');
      head.append(element('th', '', ''));
      ORDER.split('').forEach(function (b) {
        head.append(element('th', '', 'second ' + b));
      });
      table.append(head);
      ORDER.split('').forEach(function (first) {
        ORDER.split('').forEach(function (third) {
          const tr = element('tr');
          tr.append(element('th', '', first + '…' + third));
          ORDER.split('').forEach(function (second) {
            const codon = first + second + third;
            const aa = translateCodon(codon, select.value);
            tr.append(element('td', '', codon + ' ' + (aa === '*' ? 'stop' : aa)));
          });
          table.append(tr);
        });
      });
      holder.append(table);
    };
    select.addEventListener('change', draw);
    draw();
    return block(select, holder);
  }

  // ---- letter codes ----
  const LETTERS = [['A', 'adenine'], ['C', 'cytosine'], ['G', 'guanine'], ['T', 'thymine (U in RNA)'], ['R', 'A or G (purine)'], ['Y', 'C or T (pyrimidine)'], ['S', 'G or C (strong)'], ['W', 'A or T (weak)'], ['K', 'G or T (keto)'], ['M', 'A or C (amino)'], ['B', 'C, G or T (not A)'], ['D', 'A, G or T (not C)'], ['H', 'A, C or T (not G)'], ['V', 'A, C or G (not T)'], ['N', 'any base']];
  function letterCodes() {
    const table = element('table', 'tools-table');
    LETTERS.forEach(function (row) {
      const tr = element('tr');
      tr.append(element('th', '', row[0]), element('td', '', row[1]));
      table.append(tr);
    });
    return block(table);
  }

  // ---- make protein ----
  function makeProtein(editor) {
    const select = codeSelect();
    const frame = element('select', 'tools-select');
    [['+1', 'Forward, frame 1'], ['+2', 'Forward, frame 2'], ['+3', 'Forward, frame 3'], ['-1', 'Reverse, frame 1'], ['-2', 'Reverse, frame 2'], ['-3', 'Reverse, frame 3']].forEach(function (item) {
      const option = element('option', '', item[1]);
      option.value = item[0];
      frame.append(option);
    });
    const [button, result] = action('Make the protein', function () {
      const part = region(editor);
      const reverse = frame.value[0] === '-';
      const bases = reverse ? reverseComplement(part.bases) : part.bases;
      let protein = '';
      for (let i = parseInt(frame.value[1], 10) - 1; i + 3 <= bases.length; i += 3) {
        protein += translateCodon(bases.slice(i, i + 3), select.value);
      }
      if (protein === '') {
        throw new Error('The region is too short to translate.');
      }
      const box = element('div');
      box.append(element('p', 'tool-muted', protein.length + ' amino acids (' + (protein.match(/\*/g) || []).length + ' stops, shown as *)'), output(protein));
      return box;
    });
    return block(element('p', 'tool-muted', 'Translates the selection, or the whole sequence, in the reading frame you choose.'), select, frame, button, result);
  }

  // ---- make RNA ----
  function makeRna(editor) {
    const strand = element('select', 'tools-select');
    [['same', 'The same strand (the coding strand): T becomes U'], ['other', 'The other strand: the RNA that this strand templates']].forEach(function (item) {
      const option = element('option', '', item[1]);
      option.value = item[0];
      strand.append(option);
    });
    const [button, result] = action('Make the RNA', function () {
      const part = region(editor);
      const bases = strand.value === 'other' ? reverseComplement(part.bases) : part.bases;
      return output(bases.replace(/T/g, 'U'));
    });
    return block(element('p', 'tool-muted', 'The RNA of the selection, or of the whole sequence, written 5′ to 3′.'), strand, button, result);
  }

  // ---- linearize ----
  function linearize(editor) {
    const [button, result] = action('Linearize at the cursor', function () {
      const state = editor.getState();
      const data = state.sequenceData;
      const utils = window.sequenceUtils;
      if (!data.circular) {
        throw new Error('The sequence is already linear.');
      }
      const selection = state.selectionLayer || {};
      const position = selection.start >= 0 ? selection.start : state.caretPosition;
      if (position === undefined || position < 0) {
        throw new Error('Click on the sequence where it should be cut (or select a place), then press the button.');
      }
      const rotated = utils && typeof utils.rotateSequenceDataToPosition === 'function' ? utils.rotateSequenceDataToPosition(data, position) : data;
      editor.updateEditor({ sequenceData: Object.assign({}, rotated, { circular: false }), selectionLayer: { start: -1, end: -1 }, caretPosition: -1 });
      return element('p', 'tool-message', 'The sequence is now linear, from base ' + (position + 1) + ' of the circle. Undo restores it.');
    });
    return block(element('p', 'tool-muted', 'Cuts a circular sequence open at the cursor (or at the start of the selection) and makes it linear.'), button, result);
  }

  // ---- anneal oligos ----
  function anneal() {
    const one = element('textarea');
    one.rows = 2;
    one.placeholder = 'Oligo 1, 5′ to 3′';
    const two = element('textarea');
    two.rows = 2;
    two.placeholder = 'Oligo 2, 5′ to 3′';
    [one, two].forEach(function (area) {
      area.style.cssText = 'width:100%;margin:0 0 0.4rem;font-family:ui-monospace,Menlo,monospace;font-size:0.78rem';
    });
    const [button, result] = action('Anneal them', function () {
      const a = one.value.toUpperCase().replace(/[^ACGT]/g, '');
      const b = two.value.toUpperCase().replace(/[^ACGT]/g, '');
      if (a.length < 6 || b.length < 6) {
        throw new Error('Both oligos need at least 6 bases.');
      }
      // oligo 2 lies under oligo 1 the other way round: its reverse complement lines up with oligo 1
      const under = reverseComplement(b);
      let best = null;
      for (let shift = -(under.length - 6); shift <= a.length - 6; shift++) {
        let from = Math.max(0, shift);
        let to = Math.min(a.length, shift + under.length);
        let ok = to - from >= 6;
        for (let i = from; ok && i < to; i++) {
          ok = a[i] === under[i - shift];
        }
        if (ok && (!best || to - from > best.length)) {
          best = { shift: shift, length: to - from, from: from };
        }
      }
      if (!best) {
        throw new Error('The oligos do not pair (no stretch of 6 or more bases fits).');
      }
      const left = Math.min(0, best.shift);
      const pad = function (text, n) {
        return ' '.repeat(Math.max(0, n)) + text;
      };
      const topStart = -left;
      const bottomStart = best.shift - left;
      const top = pad(a, topStart);
      const bottom = pad(complement(under), bottomStart);
      const paired = a.slice(best.from, best.from + best.length);
      const overhang5a = best.shift > 0 ? best.shift : 0;
      const box = element('div');
      const lines = ["5' " + top + " 3'", "3' " + bottom + " 5'"].join('\n');
      const tm = window.PrimerTools ? ', Tm ' + Math.round(window.PrimerTools.tm(paired) * 10) / 10 + ' °C' : '';
      box.append(element('p', 'tool-muted', 'They pair over ' + best.length + ' bases' + tm + (overhang5a || best.shift < 0 || (a.length - best.from - best.length) || (b.length - best.length) ? ', with overhangs.' : ', without overhangs (blunt).')), output(lines));
      box.querySelector('.tools-out').style.whiteSpace = 'pre';
      return box;
    });
    return block(element('p', 'tool-muted', 'Pairs two oligos into a double strand and shows the overhangs they leave.'), one, two, button, result);
  }

  window.ToolsTab.add({ id: 'calc', title: 'DNA calculations', build: calculations });
  window.ToolsTab.add({ id: 'protein', title: 'Make protein', build: makeProtein });
  window.ToolsTab.add({ id: 'rna', title: 'Make RNA', build: makeRna });
  window.ToolsTab.add({ id: 'linearize', title: 'Linearize', build: linearize });
  window.ToolsTab.add({ id: 'anneal', title: 'Anneal oligos', build: anneal });
  window.ToolsTab.add({ id: 'letters', title: 'Letter codes', build: letterCodes });
  window.ToolsTab.add({ id: 'codes', title: 'Genetic codes', build: geneticCodes });
  window.ToolsBasic = { translateCodon: translateCodon, reverseComplement: reverseComplement, complement: complement, region: region };
})();
