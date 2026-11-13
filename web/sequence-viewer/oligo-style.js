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

  const SVG = 'http://www.w3.org/2000/svg';

  // the oligo as it is laid on the plasmid: its bases from 5' to 3', where it starts and ends (the overhang included), and
  // which of those places match the sequence. An oligo without an overhang is just the bases it binds.
  function layout(primer, sequence) {
    const forward = primer.forward !== false && primer.strand !== -1;
    const bound = sequence.slice(primer.start, primer.end + 1);
    const oligo = String(primer.oligo || (forward ? bound : bound.split('').reverse().join('').replace(/[ACGT]/g, function (b) {
      return COMPLEMENT[b];
    })) || '').toUpperCase();
    const tail = primer.oligo ? Math.max(0, Number(primer.tail) || 0) : 0;
    const span = primer.end - primer.start + 1;
    return {
      forward: forward,
      oligo: oligo,
      tail: tail,
      // the places that match: all of them when there is no overhang, else without the overhang
      boundStart: primer.oligo ? (primer.boundStart !== undefined ? primer.boundStart : (forward ? primer.start + tail : primer.start)) : primer.start,
      boundEnd: primer.oligo ? (primer.boundEnd !== undefined ? primer.boundEnd : (forward ? primer.end : primer.end - tail)) : primer.end,
      // the base of the oligo that stands at a place of the plasmid: the oligo is read from the 5' end, the left end of a
      // forward oligo and the right end of a reverse one; the letters are drawn as they stand under the sequence
      at: function (position) {
        const index = forward ? position - primer.start : primer.end - position;
        return index >= 0 && index < oligo.length && span === oligo.length ? oligo[index] : '';
      },
    };
  }

  // The nodes of the editor are not removed: the editor draws them again when something changes (a selection, a dialog) and it removes
  // them itself; a node that is gone makes it fail ("removeChild") and the whole editor is blank. They are hidden.
  function hide(node) {
    if (!node.classList.contains('oligo-bases')) {
      node.style.setProperty('display', 'none', 'important');
    }
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
    if (!(charWidth > 0)) {
      return;
    }
    shapes.forEach(function (g) {
      const path = g.querySelector(':scope > path');
      const primer = primers[g.dataset.id];
      const rowEl = g.closest('.veRowItem');
      if (!path || !primer || !rowEl || !(primer.end >= primer.start)) {
        return;
      }
      // the columns of the row this piece covers: the row starts where its sequence is found in the sequence, the piece where its
      // svg is
      const rowText = Array.from(rowEl.querySelectorAll('text.ve-monospace-font[textLength]')).find(function (node) {
        return node.textContent.length > 5 && !node.classList.contains('ve-sequence-reverse') && !node.classList.contains('veLabelText');
      });
      const rowStart = rowText ? sequence.indexOf(rowText.textContent.toUpperCase()) : -1;
      if (rowStart < 0) {
        return;
      }
      // the column is counted from the first letter of the sequence of the row, not from the left edge of the row: in a wide window the row has
      // a margin on its left, and counting from its edge put the oligo some columns too far to the right (letters and box shifted)
      const first = rowStart + Math.round((g.parentNode.getBoundingClientRect().left - rowText.getBoundingClientRect().left) / charWidth);
      const last = Math.min(primer.end, rowStart + rowText.textContent.length - 1);
      if (first < primer.start || first > last) {
        return;
      }
      const info = layout(primer, sequence);
      const forward = info.forward;
      // the editor draws its own letters for an oligo that has bases: they are not wanted
      g.parentNode.querySelectorAll(':scope > text.tg-primer-bases, :scope > text.tg-primer-bases-insert').forEach(hide);
      // the box: only the places that match the sequence, a little wider than its letters; the arrow of the 3' end is on the piece
      // that has that end
      const from = Math.max(first, info.boundStart);
      const to = Math.min(last, info.boundEnd);
      let d = 'M0,0';
      if (to >= from) {
        const barb = forward ? to === primer.end : from === primer.start;
        d = shape((from - first) * charWidth - PAD, (to - first + 1) * charWidth + PAD, forward, barb);
      }
      // the editor mirrors the box of a reverse oligo with a transform: the box is drawn here on its own columns
      if (path.hasAttribute('transform')) {
        path.removeAttribute('transform');
      }
      if (path.getAttribute('d') !== d) {
        path.setAttribute('d', d);
      }
      path.setAttribute('fill', to >= from ? '#fde8e2' : 'none');
      path.setAttribute('stroke', to >= from ? '#e0806a' : 'none');
      path.setAttribute('stroke-width', '1');
      path.removeAttribute('stroke-dasharray');
      // the letters of the whole piece, the overhang ones in red
      let text = g.querySelector(':scope > text.oligo-bases');
      if (!text) {
        g.querySelectorAll(':scope > text').forEach(hide);
        text = document.createElementNS(SVG, 'text');
        text.setAttribute('class', 'veLabelText ve-monospace-font oligo-bases');
        g.append(text);
      }
      let letters = '';
      for (let p = first; p <= last; p++) {
        letters += info.at(p) || ' ';
      }
      const key = letters + '|' + info.boundStart + '|' + info.boundEnd + '|' + first;
      if (text.dataset.key !== key) {
        text.dataset.key = key;
        text.textContent = '';
        let run = '';
        let over = false;
        const flush = function () {
          if (run) {
            const t = document.createElementNS(SVG, 'tspan');
            if (over) {
              t.setAttribute('class', 'oligo-overhang');
            }
            t.textContent = run;
            text.append(t);
          }
          run = '';
        };
        for (let p = first; p <= last; p++) {
          const outside = p < info.boundStart || p > info.boundEnd;
          if (outside !== over) {
            flush();
            over = outside;
          }
          run += info.at(p) || ' ';
        }
        flush();
      }
      text.setAttribute('transform', 'translate(0,' + (forward ? 14 : 11) + ')');
      text.setAttribute('textLength', String((last - first + 1) * charWidth));
      text.setAttribute('lengthAdjust', 'spacing');
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
