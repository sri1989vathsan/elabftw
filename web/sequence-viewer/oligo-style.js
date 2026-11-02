/**
 * Draws the oligos (primers) of the sequence map like SnapGene does: a pale box with the bases of the oligo as its text, and
 * a half arrow at its 3' end, so they cannot be taken for features. The editor draws them as plain shapes with their name;
 * this redraws each shape in place when it appears. Needs window.sequenceEditor.
 */
(function () {
  'use strict';
  const HEIGHT = 17;
  const PAD = 2;
  const COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G' };

  function element(tag, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    node.textContent = text;
    return node;
  }

  function primersOf(state) {
    const found = {};
    const add = function (list) {
      Object.keys(list || {}).forEach(function (key) {
        const primer = list[key];
        found[primer.id || key] = primer;
        found[key] = primer;
      });
    };
    add(state.sequenceData && state.sequenceData.primers);
    add(state.temporaryAnnotations && state.temporaryAnnotations.primers);
    return found;
  }

  // the box of an oligo, from x0 to x1, with a half arrow at its 3' end (the right end for a forward oligo)
  function shape(x0, x1, forward, barb) {
    const top = 3;
    if (!barb) {
      return 'M' + x0 + ',' + top + ' L' + x1 + ',' + top + ' L' + x1 + ',' + HEIGHT + ' L' + x0 + ',' + HEIGHT + ' Z';
    }
    return forward
      ? 'M' + x0 + ',' + top + ' L' + (x1 - 9) + ',' + top + ' L' + (x1 - 9) + ',0 L' + x1 + ',' + top + ' L' + x1 + ',' + HEIGHT + ' L' + x0 + ',' + HEIGHT + ' Z'
      : 'M' + x0 + ',0 L' + x1 + ',0 L' + x1 + ',' + (HEIGHT - top) + ' L' + (x0 + 9) + ',' + (HEIGHT - top) + ' L' + (x0 + 9) + ',' + HEIGHT + ' L' + x0 + ',' + (HEIGHT - top) + ' Z';
  }

  function restyle() {
    const editor = window.sequenceEditor;
    if (!editor) {
      return;
    }
    const state = editor.getState();
    const sequence = String(state.sequenceData.sequence || '').toUpperCase();
    const primers = primersOf(state);
    const shapes = Array.from(document.querySelectorAll('g.veRowViewPrimer'));
    // the width of one base in the rows: the sequence letters are one text with a fixed length
    let charWidth = 0;
    Array.from(document.querySelectorAll('.veRowView text.ve-monospace-font[textLength]')).some(function (node) {
      const length = node.textContent.length;
      if (length > 5 && !node.classList.contains('veLabelText') && !node.classList.contains('oligo-bases')) {
        charWidth = parseFloat(node.getAttribute('textLength')) / length;
        return true;
      }
      return false;
    });
    shapes.forEach(function (g) {
      const path = g.querySelector(':scope > path');
      const text = g.querySelector(':scope > text');
      const primer = primers[g.dataset.id];
      if (!path || !primer) {
        return;
      }
      const numbers = (path.getAttribute('d') || '').match(/L\s*([\d.]+)\s*,\s*0/);
      // an oligo that has its bases (one that was designed here) is drawn by the editor with its own letters, next to the box:
      // the box is then drawn around them, the width is theirs
      const own = g.parentNode.querySelector(':scope > text.tg-primer-bases');
      const insert = g.parentNode.querySelector(':scope > text.tg-primer-bases-insert');
      const width = own ? parseFloat(own.getAttribute('textLength')) : (numbers ? parseFloat(numbers[1]) + 4 : 0);
      if (!(width > 0) && !(g.dataset.oligoD !== undefined && g.dataset.oligoWidth)) {
        return;
      }
      // the width of the box the editor drew: read from its path, or remembered when the path is the one written here (the
      // editor draws a piece again with a new path when the oligo or the row changes, then it is read again)
      const written = g.dataset.oligoD !== undefined && path.getAttribute('d') === g.dataset.oligoD;
      let w = own ? width : (written && g.dataset.oligoWidth ? parseFloat(g.dataset.oligoWidth) : width);
      const forward = primer.forward !== false && primer.strand !== -1;
      // whole: the oligo is on one row (the rows are drawn when they scroll into view, so the other pieces of an oligo that
      // goes over the end of a row may not be there yet: its width, against the width of its bases, tells)
      const bound = primer.end - primer.start + 1;
      // the columns of the row this piece covers: the row starts where its sequence is found in the sequence, the piece where its
      // svg is. The letters of the piece are the bases of those columns only.
      let piece = null;
      const rowEl = g.closest('.veRowItem');
      if (!own && rowEl && charWidth > 0 && primer.end >= primer.start) {
        const rowText = Array.from(rowEl.querySelectorAll('text.ve-monospace-font[textLength]')).find(function (node) {
          return node.textContent.length > 5 && !node.classList.contains('ve-sequence-reverse') && !node.classList.contains('veLabelText');
        });
        const rowStart = rowText ? sequence.indexOf(rowText.textContent.toUpperCase()) : -1;
        if (rowStart >= 0) {
          const first = rowStart + Math.round((g.parentNode.getBoundingClientRect().left - rowEl.getBoundingClientRect().left) / charWidth);
          const last = Math.min(primer.end, rowStart + rowText.textContent.length - 1);
          if (first >= primer.start && first <= last) {
            piece = { start: first, end: last };
          }
        }
      }
      const whole = piece ? piece.start === primer.start && piece.end === primer.end : (primer.end >= primer.start && charWidth > 0 && Math.abs(w - bound * charWidth) < charWidth * 1.5);
      // the arrow of the 3' end is on the piece that has that end
      const barb = piece ? (forward ? piece.end === primer.end : piece.start === primer.start) : whole;
      const overhang = insert ? (insert.getAttribute('data-insert-bases') || insert.textContent || '').length || primer.tail || 0 : 0;
      if (piece) {
        // the editor draws the box a little short: the bases must stand exactly under the bases of the sequence
        w = (piece.end - piece.start + 1) * charWidth;
      } else if (whole) {
        w = bound * charWidth;
      }
      const tail = whole ? (insert ? overhang : primer.tail || 0) : 0;
      const char = charWidth > 0 ? charWidth : w / bound;
      // the part that binds, and its overhang: on the left for a forward oligo (its 5' end), on the right for a reverse one
      // the box is a little wider than its bases (PAD) so the letters do not touch its edge; the bases stay under the sequence
      const x0 = whole ? -PAD : 0;
      const x1 = whole ? w + PAD : w;
      const gap = whole ? PAD : 0;
      // only the part that matches the sequence is boxed: the overhang is plain letters beside it
      const d = shape(x0, x1, forward, barb);
      if (own && whole) {
        // the letters of the editor on the line of the sequence, the bases exactly under the bases of the sequence, and the
        // overhang in line with them on the side of the 5' end
        own.setAttribute('x', '0');
        own.setAttribute('y', forward ? '14' : '11');
        own.setAttribute('textLength', String(w));
        if (insert) {
          // beside the box when there is room for it on this row, above it when the row ends first
          const row = g.closest('.veRowItem');
          const svgBox = g.parentNode.getBoundingClientRect();
          const rowBox = row ? row.getBoundingClientRect() : null;
          const room = rowBox ? (forward ? svgBox.left + x0 - rowBox.left : rowBox.right - (svgBox.left + x1)) : Infinity;
          const above = tail > 0 && room < tail * char;
          insert.setAttribute('x', String(above ? (forward ? x0 : x1 - tail * char) : (forward ? x0 - tail * char : x1)));
          insert.setAttribute('y', above ? '-3' : (forward ? '14' : '11'));
          insert.setAttribute('textLength', String(tail * char));
          insert.removeAttribute('transform');
        }
      }
      if (text && (piece || whole)) {
        // the bases as they stand under the top strand: the complement for an oligo on the other strand
        let bases = piece ? sequence.slice(piece.start, piece.end + 1) : sequence.slice(primer.start, primer.end + 1);
        if (!forward) {
          bases = bases.replace(/[ACGT]/g, function (b) {
            return COMPLEMENT[b];
          });
        }
        if (text.textContent !== bases) {
          text.textContent = bases;
        }
        text.setAttribute('transform', 'translate(0,' + (forward ? 14 : 11) + ')');
        text.setAttribute('textLength', String(w));
        text.setAttribute('lengthAdjust', 'spacing');
        text.setAttribute('class', 'veLabelText ve-monospace-font oligo-bases');
      }
      if (path.getAttribute('d') === d) {
        return;
      }
      g.dataset.oligoWidth = String(w);
      g.dataset.oligoD = d;
      path.setAttribute('d', d);
      path.setAttribute('fill', '#fde8e2');
      path.setAttribute('stroke', '#e0806a');
      path.setAttribute('stroke-width', '1');
      path.removeAttribute('stroke-dasharray');
    });
    placeOverhangs(shapes, primers, sequence, charWidth);
  }

  // an oligo with an overhang that goes over the end of a row: the editor puts the overhang on one of its pieces, which may
  // not be the one with the 5' end; it is moved there (the left end of a forward oligo, the right end of a reverse one)
  function placeOverhangs(shapes, primers, sequence, charWidth) {
    const byId = {};
    shapes.forEach(function (g) {
      (byId[g.dataset.id] = byId[g.dataset.id] || []).push(g);
    });
    const complement = function (bases) {
      return bases.replace(/[ACGT]/g, function (b) {
        return COMPLEMENT[b];
      });
    };
    Object.keys(byId).forEach(function (id) {
      const primer = primers[id];
      const pieces = byId[id].filter(function (g) {
        return g.parentNode.querySelector(':scope > text.tg-primer-bases');
      });
      if (!primer || !primer.tail || pieces.length < 2 || primer.end < primer.start) {
        return;
      }
      const forward = primer.forward !== false && primer.strand !== -1;
      const top = sequence.slice(primer.start, primer.end + 1);
      const shown = forward ? top : complement(top);
      const owns = pieces.map(function (g) {
        return g.parentNode.querySelector(':scope > text.tg-primer-bases');
      });
      const index = owns.findIndex(function (own) {
        const letters = own.textContent.toUpperCase();
        return forward ? shown.startsWith(letters) : shown.endsWith(letters);
      });
      let insert = null;
      pieces.forEach(function (g) {
        insert = insert || g.parentNode.querySelector(':scope > text.tg-primer-bases-insert');
      });
      if (index === -1 || !insert) {
        return;
      }
      const holder = pieces[index].parentNode;
      if (insert.parentNode !== holder) {
        holder.append(insert);
      }
      const letters = (insert.getAttribute('data-insert-bases') || insert.textContent || '').length;
      const width = parseFloat(owns[index].getAttribute('textLength')) || 0;
      const wide = letters * charWidth;
      const row = pieces[index].closest('.veRowItem');
      const box = holder.getBoundingClientRect();
      const rowBox = row ? row.getBoundingClientRect() : null;
      const room = rowBox ? (forward ? box.left - rowBox.left : rowBox.right - (box.left + width)) : Infinity;
      const above = room < wide;
      insert.setAttribute('x', String(above ? (forward ? 0 : width - wide) : (forward ? -wide : width)));
      insert.setAttribute('y', above ? '-3' : (forward ? '14' : '11'));
      insert.setAttribute('textLength', String(wide));
      insert.removeAttribute('transform');
    });
  }

  let queued = false;
  function schedule() {
    if (queued) {
      return;
    }
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      try {
        restyle();
      } catch (error) {
        // the editor is not ready: it is tried again at the next change
      }
    });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
})();
