/**
 * The calculations of the cloning tools of the sequence editor, with no page in them (so they can be checked in node, see
 * tests/manual/cloning-engine-check.js). Exposed as window.CloningEngine (module.exports in node).
 *
 * designHomology: the primers of a Gibson / In-Fusion / NEBuilder HiFi assembly of one insert into a vector. The vector is opened
 * at a place (the bases from..to are replaced, or nothing is removed when from equals to); each primer carries a tail equal to the
 * vector next to the place, followed by the bases that bind the insert.
 */
(function (root) {
  'use strict';
  const COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };

  function clean(text) {
    return String(text || '').toUpperCase().replace(/[^ACGTN]/g, '');
  }

  function reverseComplement(text) {
    return clean(text).split('').reverse().map(function (base) {
      return COMPLEMENT[base];
    }).join('');
  }

  // a rough Tm when the page gives none (the editor passes PrimerTools.tm)
  function fallbackTm(sequence) {
    const gc = (sequence.match(/[GC]/g) || []).length;
    return sequence.length < 14 ? 2 * (sequence.length - gc) + 4 * gc : 64.9 + (41 * (gc - 16.4)) / sequence.length;
  }

  // the presets of the methods: overlap in bases between the two ends that are joined
  const METHODS = {
    infusion: { label: 'In-Fusion', overlap: 15 },
    nebuilder: { label: 'NEBuilder HiFi', overlap: 20 },
    gibson: { label: 'Gibson', overlap: 25 },
  };

  /**
   * The bases of the insert's end that bind: from the end on, as many as it takes to reach the target Tm (never fewer than minBind
   * or more than maxBind).
   */
  function bindingRegion(insert, fromStart, tm, targetTm, minBind, maxBind) {
    const source = fromStart ? insert : reverseComplement(insert);
    const limit = Math.min(maxBind, source.length);
    let size = Math.min(minBind, limit);
    while (size < limit && tm(source.slice(0, size)) < targetTm) {
      size++;
    }
    return source.slice(0, size);
  }

  function runs(sequence) {
    return /(A{6,}|C{6,}|G{6,}|T{6,})/.test(sequence);
  }

  /**
   * @param {object} options vector (bases), circular (bool, the vector must be circular), from, to (positions on the vector: the
   *   bases from..to-1 are replaced; to smaller than from means the range wraps over the origin), insert (bases), overlap (bases),
   *   tm (function), targetTm (Tm of the binding part, default 60)
   * @returns {{forward: object, reverse: object, left: string, right: string, productLength: number, warnings: string[]}}
   */
  function designHomology(options) {
    const vector = clean(options.vector);
    const insert = clean(options.insert);
    const overlap = options.overlap;
    const tm = options.tm || fallbackTm;
    const targetTm = options.targetTm || 60;
    const length = vector.length;
    const warnings = [];
    if (!options.circular) {
      throw new Error('The vector has to be circular.');
    }
    if (insert.length < 20) {
      throw new Error('The insert needs at least 20 bases.');
    }
    if (length < 4 * overlap) {
      throw new Error('The vector is too short for an overlap of ' + overlap + ' bases.');
    }
    const from = ((options.from % length) + length) % length;
    const removed = options.to >= options.from ? options.to - options.from : options.to - options.from + length;
    if (removed >= length - 2 * overlap) {
      throw new Error('The part that is replaced leaves too little of the vector.');
    }
    // the vector that stays, read from the end of the place round to its start: its start is the right of the place, its end the left
    const kept = (vector + vector).slice(from + removed, from + length);
    const left = kept.slice(kept.length - overlap);
    const right = kept.slice(0, overlap);
    const bindForward = bindingRegion(insert, true, tm, targetTm, 18, 35);
    const bindReverse = bindingRegion(insert, false, tm, targetTm, 18, 35);
    const forward = left + bindForward;
    const reverse = reverseComplement(right) + bindReverse;
    const info = function (sequence, tail, bind) {
      return { sequence: sequence, tail: tail, binding: bind, tm: Math.round(tm(bind) * 10) / 10, length: sequence.length };
    };
    const result = {
      forward: info(forward, left, bindForward),
      reverse: info(reverse, reverseComplement(right), bindReverse),
      left: left,
      right: right,
      productLength: length - removed + insert.length,
      overlapTm: Math.round(tm(left) * 10) / 10,
      overlapTmRight: Math.round(tm(right) * 10) / 10,
      warnings: warnings,
    };
    // what to look at before ordering
    [['forward', result.forward], ['reverse', result.reverse]].forEach(function (pair) {
      if (Math.abs(pair[1].tm - targetTm) > 5) {
        warnings.push('The binding part of the ' + pair[0] + ' primer has a Tm of ' + pair[1].tm + ' °C, far from ' + targetTm + ' °C.');
      }
      if (pair[1].length > 60) {
        warnings.push('The ' + pair[0] + ' primer is ' + pair[1].length + ' bases long, a long oligo costs more and fails more often.');
      }
      if (runs(pair[1].sequence)) {
        warnings.push('The ' + pair[0] + ' primer has a run of 6 or more equal bases.');
      }
    });
    if (Math.abs(bindForward.length - bindReverse.length) > 8) {
      warnings.push('The two binding parts differ a lot in length (' + bindForward.length + ' and ' + bindReverse.length + ').');
    }
    // In-Fusion does not depend on the Tm of its short overlap; a Gibson or NEBuilder overlap is long enough to have one
    if (overlap >= 20 && Math.min(result.overlapTm, result.overlapTmRight) < 45) {
      warnings.push('The overlaps have a low Tm (' + Math.min(result.overlapTm, result.overlapTmRight) + ' °C); use a longer overlap.');
    }
    if (left === right) {
      warnings.push('The two overlaps are equal, the insert could join in either direction.');
    }
    return result;
  }

  const api = { METHODS: METHODS, designHomology: designHomology, clean: clean, reverseComplement: reverseComplement };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CloningEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
