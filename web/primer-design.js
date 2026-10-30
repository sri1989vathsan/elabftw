/**
 * Primer design on a sequence: primers that amplify a region (exactly the selection, or with some room around it), ranked by
 * how close they are to the wanted melting temperature and by the usual checks (GC share, 3' end, repeats, self-binding,
 * binding elsewhere on the sequence). No server is needed. Needs primer-tools.js. Exposed as window.PrimerDesign.
 */
(function () {
  'use strict';
  const tools = window.PrimerTools;
  if (!tools) {
    return;
  }

  const DEFAULTS = {
    minLength: 18,
    maxLength: 30,
    optimalTm: 60,
    minTm: 55,
    maxTm: 65,
    minGc: 40,
    maxGc: 60,
    // 'exact': the primers start at the ends of the region, 'flank': they can start before and after it
    mode: 'exact',
    flank: 100,
    tailForward: '',
    tailReverse: '',
    // how many pairs are given
    pairs: 6,
  };

  // the longest stretch of a sequence that is also in another one
  function longestCommon(a, b) {
    let best = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        let k = 0;
        while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) {
          k++;
        }
        if (k > best) {
          best = k;
        }
      }
    }
    return best;
  }

  // a hairpin: a part of the primer can fold back on another part (a stem of 4 or more with a loop of 3 or more)
  function hairpinStem(primer) {
    let best = 0;
    for (let i = 0; i + 4 <= primer.length; i++) {
      for (let length = 4; i + length <= primer.length; length++) {
        const partner = tools.reverseComplement(primer.slice(i, i + length));
        if (primer.indexOf(partner, i + length + 3) !== -1 && length > best) {
          best = length;
        }
      }
    }
    return best;
  }

  /**
   * Checks a primer and gives its penalty: the lower, the better.
   *
   * @returns {{penalty: number, notes: string[], tm: number, gc: number}}
   */
  function judge(core, sequence, circular, options) {
    const notes = [];
    const tm = tools.tm(core);
    const gc = tools.gc(core);
    let penalty = Math.abs(tm - options.optimalTm);
    if (tm < options.minTm || tm > options.maxTm) {
      penalty += 6;
      notes.push('Tm ' + tm + ' is out of ' + options.minTm + '-' + options.maxTm);
    }
    if (gc < options.minGc || gc > options.maxGc) {
      penalty += Math.min(10, Math.abs(gc < options.minGc ? options.minGc - gc : gc - options.maxGc) * 0.4);
      notes.push('GC ' + gc + '%');
    }
    // the 3' end: a G or C holds the primer on the template, too many of them in the last bases mispair
    const last = core[core.length - 1];
    if (last === 'A' || last === 'T') {
      penalty += 1;
    }
    const lastFive = core.slice(-5);
    const strong = (lastFive.match(/[GC]/g) || []).length;
    if (strong > 3) {
      penalty += 2;
      notes.push("GC-rich 3' end");
    }
    if (/(A{5,}|T{5,}|G{5,}|C{5,})/.test(core)) {
      penalty += 3;
      notes.push('long run of one base');
    }
    if (/(..)\1{3,}/.test(core)) {
      penalty += 2;
      notes.push('dinucleotide repeat');
    }
    // binding to itself: its own reverse complement
    const self = longestCommon(core, tools.reverseComplement(core));
    if (self >= 6) {
      penalty += (self - 4) * 1.5;
      notes.push('can bind itself (' + self + ' bases)');
    }
    const stem = hairpinStem(core);
    if (stem >= 5) {
      penalty += (stem - 3) * 1.2;
      notes.push('may fold (stem of ' + stem + ')');
    }
    // binding elsewhere on the sequence: the 3' end found at more than one place
    const sites = tools.findSites(sequence, core, circular);
    if (sites.length > 1) {
      penalty += 5 * (sites.length - 1);
      notes.push('binds at ' + sites.length + ' places');
    }
    return { penalty: Math.round(penalty * 10) / 10, notes: notes, tm: tm, gc: gc };
  }

  // the bases from a start to an end (inclusive), on a circular sequence a stretch can run over the origin
  function slice(sequence, start, end, circular) {
    const length = sequence.length;
    if (start < 0 || end < 0 || start >= length || end >= length) {
      if (!circular) {
        return null;
      }
      start = ((start % length) + length) % length;
      end = ((end % length) + length) % length;
    }
    return start <= end ? sequence.slice(start, end + 1) : sequence.slice(start) + sequence.slice(0, end + 1);
  }

  /**
   * Primer pairs for the region [start, end] (inclusive, 0-based) of a sequence.
   *
   * @returns {{pairs: Array, forward: number, reverse: number}}
   */
  function design(rawSequence, start, end, circular, rawOptions) {
    const options = Object.assign({}, DEFAULTS, rawOptions || {});
    const sequence = tools.clean(rawSequence);
    const length = sequence.length;
    if (length < options.minLength * 2 || start < 0 || end >= length || end - start + 1 < options.minLength) {
      return { pairs: [], forward: 0, reverse: 0, error: 'The region is too short or outside the sequence.' };
    }
    const flank = options.mode === 'flank' ? options.flank : 0;
    const forwards = [];
    const reverses = [];
    const wide = options.maxLength - options.minLength;
    for (let offset = 0; offset <= flank; offset++) {
      for (let size = options.minLength; size <= options.minLength + wide; size++) {
        // forward: starts at the start of the region or before it
        const fs = start - offset;
        const fe = fs + size - 1;
        if (fs >= 0 && fe <= end) {
          const core = sequence.slice(fs, fe + 1);
          const verdict = judge(core, sequence, circular, options);
          forwards.push({ start: fs, end: fe, core: core, verdict: verdict });
        }
        // reverse: ends at the end of the region or after it, read on the other strand
        const re = end + offset;
        const rs = re - size + 1;
        if (re < length && rs >= start) {
          const core = tools.reverseComplement(sequence.slice(rs, re + 1));
          const verdict = judge(core, sequence, circular, options);
          reverses.push({ start: rs, end: re, core: core, verdict: verdict });
        }
      }
    }
    const byPenalty = function (a, b) {
      return a.verdict.penalty - b.verdict.penalty;
    };
    forwards.sort(byPenalty);
    reverses.sort(byPenalty);
    const bestForwards = forwards.slice(0, 10);
    const bestReverses = reverses.slice(0, 10);

    const pairs = [];
    bestForwards.forEach(function (f) {
      bestReverses.forEach(function (r) {
        let penalty = f.verdict.penalty + r.verdict.penalty + Math.abs(f.verdict.tm - r.verdict.tm) * 1.5;
        const notes = [];
        if (Math.abs(f.verdict.tm - r.verdict.tm) > 3) {
          notes.push('Tm differ by ' + Math.round(Math.abs(f.verdict.tm - r.verdict.tm) * 10) / 10);
        }
        // the two primers binding each other at their 3' ends
        const tailF = f.core.slice(-5);
        const tailR = r.core.slice(-5);
        if (r.core.indexOf(tools.reverseComplement(tailF)) !== -1 || f.core.indexOf(tools.reverseComplement(tailR)) !== -1) {
          penalty += 4;
          notes.push("3' ends bind each other");
        }
        pairs.push({
          forward: { name: 'F', sequence: options.tailForward + f.core, core: f.core, start: f.start, end: f.end, tm: f.verdict.tm, gc: f.verdict.gc, notes: f.verdict.notes },
          reverse: { name: 'R', sequence: options.tailReverse + r.core, core: r.core, start: r.start, end: r.end, tm: r.verdict.tm, gc: r.verdict.gc, notes: r.verdict.notes },
          product: r.end - f.start + 1 + options.tailForward.length + options.tailReverse.length,
          penalty: Math.round(penalty * 10) / 10,
          notes: notes,
        });
      });
    });
    pairs.sort(function (a, b) {
      return a.penalty - b.penalty;
    });
    return { pairs: pairs.slice(0, options.pairs), forward: forwards.length, reverse: reverses.length };
  }

  window.PrimerDesign = { design: design, defaults: DEFAULTS, judge: judge, slice: slice };
})();
