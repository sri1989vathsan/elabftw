/**
 * Draws the oligos (primers) of the sequence map like SnapGene does: a pale box with the bases of the oligo as its text, and
 * a half arrow at its 3' end, so they cannot be taken for features. The editor draws them as plain shapes with their name;
 * this redraws each shape in place when it appears. Needs window.sequenceEditor.
 */
(function () {
  'use strict';
  const HEIGHT = 16;
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
    const top = barb ? 5 : 3;
    if (!barb) {
      return 'M' + x0 + ',' + top + ' L' + x1 + ',' + top + ' L' + x1 + ',' + HEIGHT + ' L' + x0 + ',' + HEIGHT + ' Z';
    }
    return forward
      ? 'M' + x0 + ',' + top + ' L' + (x1 - 9) + ',' + top + ' L' + (x1 - 9) + ',0 L' + x1 + ',' + top + ' L' + x1 + ',' + HEIGHT + ' L' + x0 + ',' + HEIGHT + ' Z'
      : 'M' + x0 + ',0 L' + x1 + ',0 L' + x1 + ',' + (HEIGHT - top) + ' L' + (x0 + 9) + ',' + (HEIGHT - top) + ' L' + (x0 + 9) + ',' + HEIGHT + ' L' + x0 + ',' + (HEIGHT - top) + ' Z';
  }

  // the overhang (the tail that does not bind) as a second, hatched box next to the bound part
  function overhangShape(x0, x1) {
    return 'M' + x0 + ',3 L' + x1 + ',3 L' + x1 + ',' + HEIGHT + ' L' + x0 + ',' + HEIGHT + ' Z';
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
      const width = numbers ? parseFloat(numbers[1]) + 4 : 0;
      if (!(width > 0) && !g.dataset.oligoWidth) {
        return;
      }
      const w = g.dataset.oligoWidth ? parseFloat(g.dataset.oligoWidth) : width;
      const forward = primer.forward !== false && primer.strand !== -1;
      // whole: the oligo is on one row (the rows are drawn when they scroll into view, so the other pieces of an oligo that
      // goes over the end of a row may not be there yet: its width, against the width of its bases, tells)
      const bound = primer.end - primer.start + 1;
      const whole = primer.end >= primer.start && charWidth > 0 && Math.abs(w - bound * charWidth) < charWidth * 1.5;
      const tail = whole && primer.tail ? primer.tail : 0;
      const char = w / bound;
      // the part that binds, and its overhang: on the left for a forward oligo (its 5' end), on the right for a reverse one
      const x0 = 0;
      const x1 = w;
      const d = shape(x0, x1, forward, whole) + (tail ? ' ' + (forward ? overhangShape(-tail * char, 0) : overhangShape(w, w + tail * char)) : '');
      if (path.getAttribute('d') === d) {
        return;
      }
      g.dataset.oligoWidth = String(w);
      path.setAttribute('d', d);
      path.setAttribute('fill', '#fde8e2');
      path.setAttribute('stroke', '#e0806a');
      path.setAttribute('stroke-width', '1');
      path.removeAttribute('stroke-dasharray');
      if (text && whole) {
        // the bases as they stand under the top strand: the complement for an oligo on the other strand
        let bases = sequence.slice(primer.start, primer.end + 1);
        if (!forward) {
          bases = bases.replace(/[ACGT]/g, function (b) {
            return COMPLEMENT[b];
          });
        }
        text.textContent = bases;
        text.setAttribute('transform', 'translate(2,' + (forward ? 14 : 12) + ')');
        text.setAttribute('textLength', String(Math.max(0, w - 4)));
        text.setAttribute('lengthAdjust', 'spacing');
        text.setAttribute('class', 'veLabelText ve-monospace-font oligo-bases');
        // the overhang bases, beside them (the bases of the oligo from 5' to 3': the overhang is its first ones)
        g.querySelectorAll(':scope > text.oligo-tail').forEach(function (old) {
          old.remove();
        });
        if (tail && primer.bases && primer.bases.length >= tail) {
          const overhang = element('text', forward ? primer.bases.slice(0, tail) : primer.bases.slice(0, tail).split('').reverse().join('').replace(/[ACGT]/g, function (b) {
            return COMPLEMENT[b];
          }));
          overhang.setAttribute('class', 'veLabelText ve-monospace-font oligo-tail');
          overhang.setAttribute('transform', 'translate(' + (forward ? -tail * char + 2 : w + 2) + ',' + (forward ? 14 : 12) + ')');
          overhang.setAttribute('textLength', String(Math.max(0, tail * char - 4)));
          overhang.setAttribute('lengthAdjust', 'spacing');
          g.append(overhang);
        }
      }
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
