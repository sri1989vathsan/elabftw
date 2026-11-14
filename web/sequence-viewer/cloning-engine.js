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
   * Primers of a homology assembly (Gibson, In-Fusion, NEBuilder) of one or several inserts, in the order given, into a vector. The vector is
   * opened at a place (the bases from..to-1 are replaced, from equal to to removes nothing). The forward primer of each insert carries a
   * tail equal to what comes before it (the vector, or the end of the previous insert); the reverse primer of the last insert carries the
   * vector that follows.
   *
   * @param {object} options vector, circular, from, to (to smaller than from means the range wraps over the origin), inserts (array of
   *   bases), overlap, tm (function), targetTm (default 60)
   * @returns {{inserts: object[], left: string, right: string, productLength: number, warnings: string[], overlaps: object[]}} each insert:
   *   {forward, reverse} with {sequence, tail, binding, tm, length}
   */
  function designHomologyMulti(options) {
    const vector = clean(options.vector);
    const inserts = (options.inserts || []).map(clean);
    const overlap = options.overlap;
    const tm = options.tm || fallbackTm;
    const targetTm = options.targetTm || 60;
    const length = vector.length;
    const warnings = [];
    if (!options.circular) {
      throw new Error('The vector has to be circular.');
    }
    if (inserts.length === 0) {
      throw new Error('Add an insert.');
    }
    inserts.forEach(function (insert, index) {
      if (insert.length < 20) {
        throw new Error((inserts.length > 1 ? 'Insert ' + (index + 1) : 'The insert') + ' needs at least 20 bases.');
      }
      if (index < inserts.length - 1 && insert.length < overlap) {
        throw new Error('Insert ' + (index + 1) + ' is shorter than the overlap of ' + overlap + ' bases.');
      }
    });
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
    const info = function (sequence, tail, bind) {
      return { sequence: sequence, tail: tail, binding: bind, tm: Math.round(tm(bind) * 10) / 10, length: sequence.length };
    };
    const designed = inserts.map(function (insert, index) {
      const before = index === 0 ? left : inserts[index - 1].slice(inserts[index - 1].length - overlap);
      const after = index === inserts.length - 1 ? reverseComplement(right) : '';
      const bindForward = bindingRegion(insert, true, tm, targetTm, 18, 35);
      const bindReverse = bindingRegion(insert, false, tm, targetTm, 18, 35);
      return { forward: info(before + bindForward, before, bindForward), reverse: info(after + bindReverse, after, bindReverse) };
    });
    const label = function (index) {
      return inserts.length > 1 ? 'insert ' + (index + 1) + ' ' : '';
    };
    designed.forEach(function (item, index) {
      [['forward', item.forward], ['reverse', item.reverse]].forEach(function (pair) {
        if (Math.abs(pair[1].tm - targetTm) > 5) {
          warnings.push('The binding part of the ' + label(index) + pair[0] + ' primer has a Tm of ' + pair[1].tm + ' °C, far from ' + targetTm + ' °C.');
        }
        if (pair[1].length > 60) {
          warnings.push('The ' + label(index) + pair[0] + ' primer is ' + pair[1].length + ' bases long, a long oligo costs more and fails more often.');
        }
        if (runs(pair[1].sequence)) {
          warnings.push('The ' + label(index) + pair[0] + ' primer has a run of 6 or more equal bases.');
        }
      });
      if (Math.abs(item.forward.binding.length - item.reverse.binding.length) > 8) {
        warnings.push('The two binding parts of ' + (inserts.length > 1 ? 'insert ' + (index + 1) : 'the insert') + ' differ a lot in length (' + item.forward.binding.length + ' and ' + item.reverse.binding.length + ').');
      }
    });
    // the overlaps that hold the pieces together: vector-insert, insert-insert, insert-vector
    const overlaps = [{ between: 'vector / ' + (inserts.length > 1 ? 'insert 1' : 'insert'), sequence: left }];
    for (let k = 1; k < inserts.length; k++) {
      overlaps.push({ between: 'insert ' + k + ' / insert ' + (k + 1), sequence: inserts[k - 1].slice(inserts[k - 1].length - overlap) });
    }
    overlaps.push({ between: (inserts.length > 1 ? 'insert ' + inserts.length : 'insert') + ' / vector', sequence: right });
    overlaps.forEach(function (item) {
      item.tm = Math.round(tm(item.sequence) * 10) / 10;
    });
    if (overlap >= 20 && Math.min.apply(null, overlaps.map(function (item) {
      return item.tm;
    })) < 45) {
      warnings.push('An overlap has a low Tm (' + Math.min.apply(null, overlaps.map(function (item) {
        return item.tm;
      })) + ' °C); use a longer overlap.');
    }
    if (inserts.length === 1 && left === right) {
      warnings.push('The two overlaps are equal, the insert could join in either direction.');
    }
    return {
      inserts: designed,
      left: left,
      right: right,
      overlaps: overlaps,
      productLength: length - removed + inserts.reduce(function (sum, insert) {
        return sum + insert.length;
      }, 0),
      warnings: warnings,
    };
  }

  // one insert: the old shape of the result
  function designHomology(options) {
    const result = designHomologyMulti(Object.assign({}, options, { inserts: [options.insert] }));
    return {
      forward: result.inserts[0].forward,
      reverse: result.inserts[0].reverse,
      left: result.left,
      right: result.right,
      productLength: result.productLength,
      overlapTm: result.overlaps[0].tm,
      overlapTmRight: result.overlaps[result.overlaps.length - 1].tm,
      warnings: result.warnings,
    };
  }

  /**
   * The primers of a homology assembly as annotations on the new plasmid (type primer_bind): each primer lies whole on the plasmid, its tail on
   * the vector (or the previous insert) and its binding part on the insert. from is where the first insert starts in the new plasmid (the start of
   * the replaced bases, or the cursor); names has a name for each insert. Positions that fall before the origin wrap round it (start larger than end).
   *
   * @returns {object} features keyed by id: {id, name, type: 'primer_bind', start, end, strand}
   */
  function homologyPrimerFeatures(design, names, from, insertLengths, productLength) {
    const features = {};
    let count = 0;
    const add = function (name, start, end, strand) {
      count++;
      features['primer' + count] = {
        id: 'primer' + count,
        name: name,
        type: 'primer_bind',
        start: mod(start, productLength),
        end: mod(end, productLength),
        strand: strand,
      };
    };
    let offset = from;
    design.inserts.forEach(function (item, index) {
      const length = insertLengths[index];
      add(names[index] + ' F', offset - item.forward.tail.length, offset + item.forward.binding.length - 1, 1);
      add(names[index] + ' R', offset + length - item.reverse.binding.length, offset + length + item.reverse.tail.length - 1, -1);
      offset += length;
    });
    return features;
  }

  // the two attB primers as annotations on their PCR product
  function attbPrimerFeatures(design, names) {
    const length = design.product.length;
    return {
      primer1: { id: 'primer1', name: names[0], type: 'primer_bind', start: 0, end: design.forward.length - 1, strand: 1 },
      primer2: { id: 'primer2', name: names[1], type: 'primer_bind', start: length - design.reverse.length, end: length - 1, strand: -1 },
    };
  }

  // ---- pieces of open sequences -----------------------------------------------------------------------------------------------
  /**
   * A piece of a sequence to use as an insert, a part or a vector: the whole of it, a range, or a fragment of a virtual digest.
   *
   * @param {object} data {sequence, features, circular}
   * @param {object} spec {mode: 'whole'} | {mode: 'range', from, to} (to excluded, to smaller than from wraps on a circle) |
   *   {mode: 'digest', enzymes: [records], index} (index of the fragment, see digestFragments)
   * @returns {{sequence: string, features: object, circular: boolean, lostFeatures: number, description: string}}
   */
  function extractPiece(data, spec) {
    const sequence = clean(data.sequence);
    const length = sequence.length;
    const whole = !spec || spec.mode === 'whole';
    if (whole) {
      return { sequence: sequence, features: data.features || {}, circular: !!data.circular, lostFeatures: 0, description: 'the whole sequence, ' + length + ' bases' };
    }
    let fragment;
    let description;
    if (spec.mode === 'range') {
      const size = spec.to >= spec.from ? spec.to - spec.from : spec.to - spec.from + length;
      if (size < 1 || spec.from < 0 || spec.from >= length || (spec.to < spec.from && !data.circular)) {
        throw new Error('The selected range is not valid.');
      }
      fragment = { full: (sequence + sequence).slice(spec.from, spec.from + size), start: spec.from, len: size, reversed: false };
      description = 'bases ' + (spec.from + 1) + ' to ' + (spec.to === 0 ? length : spec.to) + ', ' + size + ' bases';
    } else if (spec.mode === 'digest') {
      const fragments = digestOf(data, spec.enzymes);
      fragment = fragments[spec.index === undefined ? 0 : spec.index];
      if (!fragment) {
        throw new Error('That fragment of the digest does not exist.');
      }
      description = 'the ' + fragment.len + ' bp fragment of ' + spec.enzymes.map(function (enzyme) {
        return enzyme.name;
      }).join(' + ');
    } else {
      throw new Error('Unknown way to take a piece.');
    }
    const features = {};
    const counter = { n: 0 };
    mapFeatures(data.features, fragment, length, 0, fragment.full.length + 1, features, counter);
    // the features that the piece cuts through are kept as far as the piece has them (clipped, named partial); those wholly outside are not
    let partial = 0;
    Object.keys(data.features || {}).forEach(function (key) {
      const feature = data.features[key];
      if (!feature || feature.start > feature.end) {
        return;
      }
      const shifts = data.circular ? [0, length, -length] : [0];
      for (let i = 0; i < shifts.length; i++) {
        const start = feature.start - fragment.start + shifts[i];
        const end = feature.end - fragment.start + shifts[i];
        const low = Math.max(start, 0);
        const high = Math.min(end, fragment.len - 1);
        if (low <= high) {
          if (start < 0 || end > fragment.len - 1) {
            counter.n++;
            partial++;
            features['f' + counter.n] = Object.assign({}, feature, { id: 'f' + counter.n, name: (feature.name || feature.type) + ' (partial)', start: low, end: high });
          }
          break;
        }
      }
    });
    return { sequence: fragment.full, features: features, circular: false, lostFeatures: 0, partialFeatures: partial, description: description };
  }

  // the cuts of the enzymes in a sequence and the fragments they make
  function digestOf(data, enzymes) {
    const sequence = clean(data.sequence);
    let cuts = [];
    enzymes.filter(Boolean).forEach(function (enzyme) {
      const found = findCuts(sequence, !!data.circular, enzyme);
      if (found.cuts.length === 0) {
        throw new Error(enzyme.name + ' does not cut this sequence.');
      }
      cuts = cuts.concat(found.cuts);
    });
    cuts.sort(function (a, b) {
      return a.top - b.top;
    });
    return digest(sequence, !!data.circular, cuts);
  }

  /** The fragments of a virtual digest of a sequence, for a list: {index, size, left, right, cutBoth}. */
  function digestFragments(data, enzymes) {
    return digestOf(data, enzymes).map(summary);
  }

  /**
   * The place to open a circular vector at, from a virtual digest: the vector fragment that is kept (index, the largest by default) ends where
   * the removed part begins and starts where it ends. One cut gives a place that removes nothing.
   *
   * @returns {{from: number, to: number, index: number, fragments: object[]}}
   */
  function placeFromDigest(data, enzymes, index) {
    if (!data.circular) {
      throw new Error('The vector has to be circular.');
    }
    const fragments = digestOf(data, enzymes);
    let chosen = fragments[index];
    if (!chosen) {
      chosen = fragments.slice().sort(function (a, b) {
        return b.len - a.len;
      })[0];
    }
    return { from: chosen.cutRight, to: chosen.cutLeft, index: chosen.index, fragments: fragments.map(summary) };
  }

  // pieces one after the other as one sequence (the inserts of a Gibson assembly): the features move with their piece
  function combinePieces(pieces) {
    let sequence = '';
    const features = {};
    let counter = 0;
    pieces.forEach(function (piece) {
      Object.keys(piece.features || {}).forEach(function (key) {
        counter++;
        features['f' + counter] = Object.assign({}, piece.features[key], { id: 'f' + counter, start: piece.features[key].start + sequence.length, end: piece.features[key].end + sequence.length });
      });
      sequence += clean(piece.sequence);
    });
    return { sequence: sequence, features: features, circular: false };
  }

  // ---- restriction cloning ----------------------------------------------------------------------------------------------------
  // An enzyme of the library: its site as a regular expression for each strand (forwardRegex, reverseRegex) and where it cuts: the top strand
  // after topSnipOffset bases and the bottom strand after bottomSnipOffset bases, both counted from the start of the site on the top strand.
  function findEnzyme(library, name) {
    const wanted = String(name || '').toLowerCase();
    const enzymes = library.enzymes || library;
    return enzymes[wanted] || Object.keys(enzymes).map(function (key) {
      return enzymes[key];
    }).find(function (enzyme) {
      return enzyme.name.toLowerCase() === wanted;
    }) || null;
  }

  const mod = function (n, m) {
    return ((n % m) + m) % m;
  };

  /**
   * The cuts of an enzyme in a sequence: {top, delta, enzyme, site}: the top strand is cut at top (a position between two bases), the
   * bottom strand at top + delta. On a line, a site so near the end that a strand would be cut outside the sequence is not a cut (counted in
   * dropped).
   */
  function findCuts(sequence, circular, enzyme) {
    const seq = clean(sequence);
    const length = seq.length;
    const text = (circular ? seq + seq.slice(0, 60) : seq).toLowerCase();
    const found = {};
    let dropped = 0;
    const orientations = [{ regex: enzyme.forwardRegex, reverse: false }];
    if (enzyme.reverseRegex !== enzyme.forwardRegex) {
      orientations.push({ regex: enzyme.reverseRegex, reverse: true });
    }
    orientations.forEach(function (orientation) {
      // a look-ahead finds sites that overlap
      const pattern = new RegExp('(?=(' + orientation.regex + '))', 'gi');
      let match = pattern.exec(text);
      while (match) {
        const index = match.index;
        pattern.lastIndex = index + 1;
        if (index < length) {
          const size = match[1].length;
          const top = orientation.reverse ? index + size - enzyme.bottomSnipOffset : index + enzyme.topSnipOffset;
          const bottom = orientation.reverse ? index + size - enzyme.topSnipOffset : index + enzyme.bottomSnipOffset;
          if (!circular && (Math.min(top, bottom) < 0 || Math.max(top, bottom) > length)) {
            dropped++;
          } else {
            const position = circular ? mod(top, length) : top;
            found[position + ':' + (bottom - top)] = { top: position, delta: bottom - top, enzyme: enzyme.name, site: index };
          }
        }
        match = pattern.exec(text);
      }
    });
    return { cuts: Object.keys(found).map(function (key) {
      return found[key];
    }).sort(function (a, b) {
      return a.top - b.top;
    }), dropped: dropped };
  }

  // the end of a fragment made by a cut: the single strand it leaves is a 5' or 3' overhang of len bases, or the end is blunt
  function endOf(delta, enzyme) {
    // delta > 0: the bottom strand is cut further right than the top strand, which leaves a 5' overhang at either end of a fragment; delta < 0 a 3' overhang
    const length = Math.abs(delta);
    if (length === 0) {
      return { type: 'blunt', len: 0, enzyme: enzyme };
    }
    return { type: delta > 0 ? '5' : '3', len: length, enzyme: enzyme };
  }

  /**
   * The fragments of a digest. A fragment holds the double strand with its overhangs in full (the top-strand text of its widest extent),
   * its two ends, and where it starts in the source sequence (start, may lie before 0 or beyond the end) so that features can follow.
   */
  function digest(sequence, circular, cuts) {
    const seq = clean(sequence);
    const length = seq.length;
    const text = seq + seq + seq;
    const fragments = [];
    const free = { type: 'free', len: 0, enzyme: '' };
    const make = function (c1, c2, shift) {
      const top1 = c1 ? c1.top : 0;
      const bottom1 = c1 ? c1.top + c1.delta : 0;
      const top2 = c2 ? c2.top + shift : length;
      const bottom2 = c2 ? c2.top + shift + c2.delta : length;
      const start = Math.min(top1, bottom1);
      const end = Math.max(top2, bottom2);
      fragments.push({
        full: text.slice(length + start, length + end),
        start: start,
        len: end - start,
        cutLeft: c1 ? mod(c1.top, length) : null,
        cutRight: c2 ? mod(c2.top, length) : null,
        left: c1 ? endOf(c1.delta, c1.enzyme) : free,
        right: c2 ? endOf(c2.delta, c2.enzyme) : free,
        reversed: false,
      });
    };
    if (cuts.length === 0) {
      return circular ? [] : [{ full: seq, start: 0, len: length, left: free, right: free, reversed: false }];
    }
    if (circular) {
      cuts.forEach(function (c1, i) {
        const c2 = cuts[(i + 1) % cuts.length];
        make(c1, c2, cuts.length === 1 || c2.top <= c1.top ? length : 0);
      });
    } else {
      make(null, cuts[0], 0);
      for (let i = 0; i < cuts.length - 1; i++) {
        make(cuts[i], cuts[i + 1], 0);
      }
      make(cuts[cuts.length - 1], null, 0);
    }
    fragments.forEach(function (fragment, index) {
      fragment.index = index;
    });
    return fragments;
  }

  function reversed(fragment, sourceLength) {
    return {
      full: reverseComplement(fragment.full),
      start: fragment.start,
      len: fragment.len,
      left: fragment.right,
      right: fragment.left,
      reversed: !fragment.reversed,
      index: fragment.index,
      sourceLength: sourceLength,
    };
  }

  // can the right end of one fragment be ligated to the left end of the next: the same kind of overhang with the same bases
  function joins(a, b) {
    const x = a.right;
    const y = b.left;
    if (x.type === 'free' || y.type === 'free' || x.type !== y.type || x.len !== y.len) {
      return false;
    }
    return x.len === 0 || a.full.slice(a.full.length - x.len) === b.full.slice(0, x.len);
  }

  // the features of a source that lie whole inside a fragment, moved to where the fragment is in the new plasmid (offset)
  function mapFeatures(features, fragment, sourceLength, offset, productLength, out, counter) {
    let lost = 0;
    Object.keys(features || {}).forEach(function (key) {
      const feature = features[key];
      if (!feature || feature.start > feature.end) {
        lost += feature ? 1 : 0;
        return;
      }
      const span = feature.end - feature.start;
      const rel = mod(feature.start - fragment.start, sourceLength);
      if (rel + span >= fragment.len) {
        lost++;
        return;
      }
      const start = fragment.reversed ? offset + fragment.len - 1 - (rel + span) : offset + rel;
      if (start + span >= productLength) {
        return;
      }
      counter.n++;
      out['f' + counter.n] = Object.assign({}, feature, {
        id: 'f' + counter.n,
        start: start,
        end: start + span,
        strand: fragment.reversed && feature.strand ? -feature.strand : feature.strand,
      });
    });
    return lost;
  }

  // what a junction of the new plasmid looks like: the site of an enzyme made again, or a scar that neither enzyme cuts
  function junction(product, position, enzymes) {
    const length = product.length;
    const around = (product + product + product).slice(length + position - 12, length + position + 12).toLowerCase();
    const restored = enzymes.filter(function (enzyme) {
      return enzyme && (new RegExp(enzyme.forwardRegex, 'i').test(around) || new RegExp(enzyme.reverseRegex, 'i').test(around));
    }).map(function (enzyme) {
      return enzyme.name;
    });
    return restored;
  }

  function junctionOf(sequence, position, nameA, nameB, byName) {
    const records = [byName[String(nameA).toLowerCase()], byName[String(nameB).toLowerCase()]];
    return { position: position, enzymes: [nameA, nameB], restored: junction(sequence, position, records) };
  }

  function summary(fragment) {
    const end = function (e) {
      return e.type === 'free' ? 'end' : e.enzyme + (e.type === 'blunt' ? ' blunt' : " " + e.type + "'");
    };
    return { index: fragment.index, size: fragment.len, left: end(fragment.left), right: end(fragment.right), cutBoth: fragment.left.type !== 'free' && fragment.right.type !== 'free' };
  }

  /**
   * Restriction cloning of an insert into a vector with one enzyme or two. Every fragment of the two digests is listed; a vector fragment
   * (the backbone) and an insert fragment are chosen (by the caller or the first pair that can be ligated) and the plasmids they make
   * are returned, one for each orientation of the insert that the ends allow.
   *
   * @param {object} options vector {sequence, features, circular}, insert {sequence, features, circular}, enzymes (array of 1-2 enzyme
   *   records of the library), backbone, insertFragment (indexes, optional)
   */
  function designRestriction(options) {
    const vectorData = options.vector;
    const insertData = options.insert;
    const vector = clean(vectorData.sequence);
    const insert = clean(insertData.sequence);
    const distinctOf = function (list) {
      return (list || []).filter(function (enzyme, index, all) {
        return enzyme && all.indexOf(enzyme) === index;
      });
    };
    // the insert may be cut with other enzymes than the vector when their ends fit (BamHI and BglII, XbaI and SpeI ...)
    const vectorEnzymes = distinctOf(options.vectorEnzymes || options.enzymes);
    const insertEnzymes = distinctOf(options.insertEnzymes || options.enzymes);
    const enzymes = distinctOf(vectorEnzymes.concat(insertEnzymes));
    const warnings = [];
    if (!vectorData.circular) {
      throw new Error('The vector has to be circular.');
    }
    if (vectorEnzymes.length === 0 || insertEnzymes.length === 0) {
      throw new Error('Choose an enzyme.');
    }
    if (insert.length < 20) {
      throw new Error('The insert needs at least 20 bases.');
    }
    const collect = function (sequence, circular, label, list) {
      let cuts = [];
      list.forEach(function (enzyme) {
        const found = findCuts(sequence, circular, enzyme);
        if (found.cuts.length === 0) {
          throw new Error(enzyme.name + ' does not cut the ' + label + (found.dropped ? ' (its site is too near the end, add bases beyond it)' : '') + '.');
        }
        if (found.dropped) {
          warnings.push('A site of ' + enzyme.name + ' is too near the end of the ' + label + ' to be cut (add 4 to 6 bases beyond it).');
        }
        if (found.cuts.length > 1) {
          warnings.push(enzyme.name + ' cuts the ' + label + ' ' + found.cuts.length + ' times.');
        }
        cuts = cuts.concat(found.cuts);
      });
      return cuts.sort(function (a, b) {
        return a.top - b.top;
      });
    };
    const vectorFragments = digest(vector, true, collect(vector, true, 'vector', vectorEnzymes));
    const insertCircular = !!insertData.circular;
    const insertFragments = digest(insert, insertCircular, collect(insert, insertCircular, 'insert', insertEnzymes));

    const assemble = function (backbone, piece) {
      if (!joins(backbone, piece) || !joins(piece, backbone)) {
        return null;
      }
      const joined = backbone.full + piece.full.slice(piece.left.len);
      const sequence = joined.slice(0, joined.length - backbone.left.len);
      const offset = backbone.full.length - piece.left.len;
      return { sequence: sequence, offset: offset };
    };
    // the first pair that can be ligated: the big vector fragments with the small insert fragments first
    const byDescending = vectorFragments.slice().sort(function (a, b) {
      return b.len - a.len;
    });
    const byAscending = insertFragments.filter(function (f) {
      return f.left.type !== 'free' && f.right.type !== 'free';
    }).sort(function (a, b) {
      return insertCircular ? a.len - b.len : b.len - a.len;
    });
    let backbone = options.backbone !== undefined ? vectorFragments[options.backbone] : null;
    let piece = options.insertFragment !== undefined ? insertFragments[options.insertFragment] : null;
    if (!backbone || !piece) {
      outer: for (let i = 0; i < byDescending.length; i++) {
        for (let j = 0; j < byAscending.length; j++) {
          const candidateBackbone = backbone || byDescending[i];
          const candidatePiece = piece || byAscending[j];
          if (assemble(candidateBackbone, candidatePiece) || assemble(candidateBackbone, reversed(candidatePiece))) {
            backbone = candidateBackbone;
            piece = candidatePiece;
            break outer;
          }
        }
      }
      backbone = backbone || byDescending[0];
      piece = piece || byAscending[0] || insertFragments[0];
    }
    if (piece.left.type === 'free' || piece.right.type === 'free') {
      warnings.push('The chosen piece of the insert still has an end that was not cut.');
    }
    const products = [];
    const byName = enzymesByName(enzymes);
    [piece, reversed(piece)].forEach(function (oriented) {
      const made = assemble(backbone, oriented);
      if (!made) {
        return;
      }
      const features = {};
      const counter = { n: 0 };
      let lost = mapFeatures(vectorData.features, backbone, vector.length, 0, made.sequence.length, features, counter);
      lost += mapFeatures(insertData.features, oriented, insert.length, made.offset, made.sequence.length, features, counter);
      products.push({
        orientation: oriented.reversed === piece.reversed ? 'forward' : 'reverse',
        sequence: made.sequence,
        length: made.sequence.length,
        features: features,
        lostFeatures: lost,
        junctions: [
          junctionOf(made.sequence, made.offset, backbone.right.enzyme, oriented.left.enzyme, byName),
          junctionOf(made.sequence, made.sequence.length - backbone.left.len, oriented.right.enzyme, backbone.left.enzyme, byName),
        ],
      });
    });
    // a palindromic insert gives the same plasmid twice
    const distinct = products.filter(function (item, index) {
      return products.findIndex(function (other) {
        return (other.sequence + other.sequence).includes(item.sequence) && other.length === item.length;
      }) === index;
    });
    if (distinct.length === 0) {
      warnings.push('The ends of the vector and of the insert do not fit: they have different overhangs.');
    } else if (distinct.length > 1) {
      warnings.push('The insert can go in either direction (the ends are the same or compatible); check the plasmids by digest or colony PCR.');
    }
    const selfLigation = joins(backbone, backbone);
    if (selfLigation) {
      warnings.push('The ends of the vector fit each other, it can close again without the insert (use a phosphatase, or two enzymes that leave different ends).');
    }
    const lostMost = distinct.reduce(function (most, item) {
      return Math.max(most, item.lostFeatures);
    }, 0);
    if (lostMost > 0) {
      warnings.push(lostMost + ' feature' + (lostMost === 1 ? '' : 's') + ' cut by the enzymes or lying in the part that is dropped are not in the new plasmid.');
    }
    return {
      vectorFragments: vectorFragments.map(summary),
      insertFragments: insertFragments.map(summary),
      backbone: backbone ? backbone.index : null,
      insertFragment: piece ? piece.index : null,
      products: distinct,
      selfLigation: selfLigation,
      warnings: warnings,
    };
  }

  // ---- Golden Gate -------------------------------------------------------------------------------------------------------------
  // The rings that the pieces of the groups make: one piece of each group (every group has candidates, fragments with both ends cut), each in
  // either orientation, chained by their overhangs, the first group fixed. Each ring: order, sequence, features, overhangs, stable (no site of
  // enzyme left, when an enzyme is given).
  function chainRing(groups, enzyme) {
    // the search: pieces chain by their overhangs
    const solutions = [];
    let steps = 0;
    const extend = function (chain, used) {
      steps++;
      if (solutions.length >= 100 || steps > 300000) {
        return;
      }
      const last = chain[chain.length - 1];
      if (used.length === groups.length) {
        if (joins(last.fragment, chain[0].fragment)) {
          solutions.push(chain.slice());
        }
        return;
      }
      groups.forEach(function (group, index) {
        if (used.indexOf(index) >= 0) {
          return;
        }
        group.candidates.forEach(function (candidate) {
          [candidate, reversed(candidate)].forEach(function (oriented) {
            if (joins(last.fragment, oriented)) {
              chain.push({ group: index, fragment: oriented, original: candidate });
              used.push(index);
              extend(chain, used);
              used.pop();
              chain.pop();
            }
          });
        });
      });
    };
    groups[0].candidates.forEach(function (candidate) {
      extend([{ group: 0, fragment: candidate, original: candidate }], [0]);
    });

    const build = function (chain) {
      let joined = chain[0].fragment.full;
      const offsets = [0];
      const overhangs = [];
      for (let k = 1; k < chain.length; k++) {
        const piece = chain[k].fragment;
        offsets.push(joined.length - piece.left.len);
        overhangs.push({ between: groups[chain[k - 1].group].name + ' / ' + groups[chain[k].group].name, sequence: piece.full.slice(0, piece.left.len) });
        joined += piece.full.slice(piece.left.len);
      }
      const first = chain[0].fragment;
      overhangs.push({ between: groups[chain[chain.length - 1].group].name + ' / ' + groups[0].name, sequence: first.full.slice(0, first.left.len) });
      const sequence = joined.slice(0, joined.length - first.left.len);
      const features = {};
      const counter = { n: 0 };
      let lost = 0;
      chain.forEach(function (entry, k) {
        lost += mapFeatures(groups[entry.group].data.features, entry.fragment, groups[entry.group].sequence.length, offsets[k], sequence.length, features, counter);
      });
      return {
        order: chain.map(function (entry) {
          return { name: groups[entry.group].name, group: entry.group, orientation: entry.fragment.reversed === entry.original.reversed ? 'forward' : 'reverse', size: entry.fragment.len, left: entry.fragment.left.enzyme, right: entry.fragment.right.enzyme };
        }),
        sequence: sequence,
        length: sequence.length,
        features: features,
        lostFeatures: lost,
        overhangs: overhangs,
        stable: enzyme ? findCuts(sequence, true, enzyme).cuts.length === 0 : true,
      };
    };
    return solutions.map(build).filter(function (item, index, all) {
      return all.findIndex(function (other) {
        return other.length === item.length && (other.sequence + other.sequence).includes(item.sequence);
      }) === index;
    });
  }

  /**
   * Restriction cloning of several inserts into a vector: the vector and every insert are digested (each insert with its own enzymes when it
   * has them, else those of the vector), and the pieces are chained by their ends: the vector, then the inserts in the order their ends fit,
   * round to the vector. Of the rings that fit, those that keep the biggest piece of the vector are given.
   *
   * @param {object} options vector {sequence, features, circular, name}, vectorEnzymes (records), inserts [{name, sequence, features,
   *   circular, enzymes (records, optional)}], insertEnzymes (records, default for the inserts; the vector's when empty)
   * @returns {{assemblies: object[], warnings: string[]}} each assembly: order [{name, orientation, size, left, right}], sequence, length,
   *   features, lostFeatures, overhangs [{between, sequence}], enzymes [names]
   */
  function designRestrictionMulti(options) {
    const warnings = [];
    const vectorEnzymes = (options.vectorEnzymes || []).filter(Boolean);
    if (!options.vector || !options.vector.circular) {
      throw new Error('The vector has to be circular.');
    }
    if (vectorEnzymes.length === 0) {
      throw new Error('Choose an enzyme.');
    }
    if (!options.inserts || options.inserts.length === 0) {
      throw new Error('Add an insert.');
    }
    const defaults = (options.insertEnzymes || []).filter(Boolean);
    const groups = [{ name: options.vector.name || 'Vector', data: options.vector, enzymes: vectorEnzymes }].concat(options.inserts.map(function (insert, index) {
      const own = (insert.enzymes || []).filter(Boolean);
      return { name: insert.name || 'Insert ' + (index + 1), data: insert, enzymes: own.length > 0 ? own : (defaults.length > 0 ? defaults : vectorEnzymes) };
    }));
    groups.forEach(function (group, index) {
      const sequence = clean(group.data.sequence);
      const circular = !!group.data.circular;
      if (sequence.length < 20) {
        throw new Error(group.name + ' is too short.');
      }
      let cuts = [];
      group.enzymes.forEach(function (enzyme) {
        const found = findCuts(sequence, circular, enzyme);
        if (found.cuts.length === 0) {
          throw new Error(enzyme.name + ' does not cut ' + group.name + (found.dropped ? ' (its site is too near the end, add bases beyond it)' : '') + '.');
        }
        if (found.dropped) {
          warnings.push('A site of ' + enzyme.name + ' in ' + group.name + ' is too near the end to be cut (add 4 to 6 bases beyond it).');
        }
        if (found.cuts.length > 1) {
          warnings.push(enzyme.name + ' cuts ' + group.name + ' ' + found.cuts.length + ' times.');
        }
        cuts = cuts.concat(found.cuts);
      });
      cuts.sort(function (a, b) {
        return a.top - b.top;
      });
      group.sequence = sequence;
      group.cuts = cuts.length;
      group.candidates = digest(sequence, circular, cuts).filter(function (fragment) {
        return fragment.left.type !== 'free' && fragment.right.type !== 'free';
      });
      if (group.candidates.length === 0) {
        throw new Error(group.name + ' has no piece with both ends cut.');
      }
    });
    let assemblies = chainRing(groups, null);
    if (assemblies.length > 0) {
      // the biggest piece of the vector is the backbone; the other pieces (a stuffer) would make rings without it
      const biggest = Math.max.apply(null, assemblies.map(function (item) {
        return item.order[0].size;
      }));
      assemblies = assemblies.filter(function (item) {
        return item.order[0].size === biggest;
      });
    }
    if (assemblies.length === 0) {
      const ends = [];
      groups.forEach(function (group) {
        group.candidates.forEach(function (candidate) {
          ends.push({ name: group.name, side: 'left', f: candidate.left, text: candidate.full.slice(0, candidate.left.len) });
          ends.push({ name: group.name, side: 'right', f: candidate.right, text: candidate.full.slice(candidate.full.length - candidate.right.len) });
        });
      });
      const lonely = ends.filter(function (end) {
        return !ends.some(function (other) {
          return other.name !== end.name && other.f.type === end.f.type && other.f.len === end.f.len && ((other.side !== end.side && other.text === end.text) || (other.side === end.side && other.text === reverseComplement(end.text)));
        });
      });
      warnings.push('No assembly closes into a ring: the ends do not chain.' + (lonely.length ? ' Ends without a partner: ' + lonely.slice(0, 6).map(function (end) {
        return end.name + ' ' + end.side + ' (' + end.f.enzyme + ')';
      }).join(', ') + '.' : ''));
    } else {
      if (assemblies.length > 1) {
        warnings.push(assemblies.length + ' different assemblies fit the ends (an insert can go either way, or the order is not fixed); check the plasmids by digest or colony PCR.');
      }
      assemblies.forEach(function (item) {
        item.warn = [];
        if (item.lostFeatures > 0) {
          item.warn.push(item.lostFeatures + ' feature' + (item.lostFeatures === 1 ? '' : 's') + ' cut by the enzymes or in a dropped piece are not in the new plasmid.');
        }
        // a junction made of two different enzymes leaves a scar that neither cuts again; the same enzyme makes its site again
        item.junctions = item.order.map(function (entry, k) {
          const next = item.order[(k + 1) % item.order.length];
          return { between: entry.name + ' / ' + next.name, enzymes: [entry.right, next.left].filter(function (name, i, all) {
            return name && all.indexOf(name) === i;
          }) };
        });
      });
    }
    return { assemblies: assemblies, warnings: warnings, groups: groups.map(function (group) {
      return { name: group.name, sites: group.cuts, pieces: group.candidates.length };
    }) };
  }

  /**
   * Golden Gate assembly: a Type IIS enzyme cuts the destination vector and every part outside its recognition site, the overhangs
   * it leaves chain the pieces into a ring. Each piece (a fragment of a digest with both ends cut) is tried in both orientations; the
   * search starts with a piece of the destination and follows the overhangs until every part is used once and the ring closes. A ring that
   * still holds the site of the enzyme would be cut again, so rings without a site are preferred (this also tells the part from the
   * backbone of an entry vector, and the dropout from the backbone of the destination).
   *
   * @param {object} options enzyme (record of the library), destination {sequence, features, circular}, parts [{name, sequence,
   *   features, circular}]
   * @returns {{assemblies: object[], warnings: string[], parts: object[]}} each assembly: order [{name, orientation, size, left, right}],
   *   sequence, length, features, lostFeatures, overhangs [{between, sequence}], stable (no site of the enzyme left)
   */
  function designGoldenGate(options) {
    const enzyme = options.enzyme;
    const warnings = [];
    if (!enzyme) {
      throw new Error('Choose an enzyme.');
    }
    if (!options.destination || !options.destination.circular) {
      throw new Error('The destination vector has to be circular.');
    }
    if (!options.parts || options.parts.length === 0) {
      throw new Error('Add at least one part.');
    }
    const groups = [{ name: options.destination.name || 'Destination vector', data: options.destination }].concat(options.parts.map(function (part, index) {
      return { name: part.name || 'Part ' + (index + 1), data: part };
    }));
    groups.forEach(function (group) {
      const sequence = clean(group.data.sequence);
      const circular = !!group.data.circular;
      if (sequence.length < 20) {
        throw new Error(group.name + ' is too short.');
      }
      const found = findCuts(sequence, circular, enzyme);
      if (found.cuts.length === 0) {
        throw new Error(enzyme.name + ' does not cut ' + group.name + (found.dropped ? ' (its site is too near the end: the cut falls outside the sequence)' : '') + '.');
      }
      if (found.dropped) {
        warnings.push('A site of ' + enzyme.name + ' in ' + group.name + ' is too near the end to cut.');
      }
      group.sequence = sequence;
      group.cuts = found.cuts.length;
      group.candidates = digest(sequence, circular, found.cuts).filter(function (fragment) {
        return fragment.left.type !== 'free' && fragment.right.type !== 'free';
      });
      if (group.candidates.length === 0) {
        throw new Error(enzyme.name + ' cuts ' + group.name + ' only once or at its end: no piece has both ends cut.');
      }
      if (group.candidates.some(function (fragment) {
        return fragment.left.len === 0 || fragment.right.len === 0;
      })) {
        throw new Error(enzyme.name + ' leaves blunt ends, it cannot be used for Golden Gate.');
      }
      if (group !== groups[0] && !circular && found.cuts.length > 2) {
        warnings.push(group.name + ' has ' + found.cuts.length + ' sites of ' + enzyme.name + ' (more than the 2 at its ends): an internal site cuts the part.');
      }
    });

    let assemblies = chainRing(groups, enzyme);
    if (assemblies.length === 0) {
      // which ends have no partner: the overhangs of all the pieces, in both strands
      const ends = [];
      groups.forEach(function (group) {
        group.candidates.forEach(function (candidate) {
          ends.push({ name: group.name, side: 'left', f: candidate.left, text: candidate.full.slice(0, candidate.left.len) });
          ends.push({ name: group.name, side: 'right', f: candidate.right, text: candidate.full.slice(candidate.full.length - candidate.right.len) });
        });
      });
      const lonely = ends.filter(function (end) {
        return !ends.some(function (other) {
          return other !== end && other.name !== end.name && other.f.type === end.f.type && other.text === end.text && other.side !== end.side;
        }) && !ends.some(function (other) {
          return other !== end && other.name !== end.name && other.f.type === end.f.type && other.text === reverseComplement(end.text) && other.side === end.side;
        });
      });
      warnings.push('No assembly closes into a ring.' + (lonely.length ? ' Overhangs without a partner: ' + lonely.slice(0, 6).map(function (end) {
        return end.name + ' ' + end.side + ' ' + end.text;
      }).join(', ') + '.' : ''));
    } else {
      const stable = assemblies.filter(function (item) {
        return item.stable;
      });
      if (stable.length > 0) {
        assemblies = stable;
      } else {
        warnings.push('Every possible assembly still holds a site of ' + enzyme.name + ': it is cut again in the reaction.');
      }
      if (assemblies.length > 1) {
        warnings.push(assemblies.length + ' different assemblies fit the overhangs: some overhangs repeat or are palindromic.');
      }
      assemblies.forEach(function (item) {
        const seen = {};
        item.overhangs.forEach(function (overhang) {
          const key = overhang.sequence;
          const twin = reverseComplement(key);
          if (key === twin) {
            item.warn = (item.warn || []).concat('The overhang ' + key + ' is palindromic: it can ligate to itself.');
          }
          if (seen[key] || seen[twin]) {
            item.warn = (item.warn || []).concat('The overhang ' + key + ' is used at two junctions.');
          }
          seen[key] = true;
        });
        if (item.lostFeatures > 0) {
          item.warn = (item.warn || []).concat(item.lostFeatures + ' feature' + (item.lostFeatures === 1 ? '' : 's') + ' cut by the enzyme or in a dropped piece are not in the new plasmid.');
        }
      });
    }
    return {
      assemblies: assemblies,
      warnings: warnings,
      parts: groups.map(function (group) {
        return { name: group.name, sites: group.cuts, pieces: group.candidates.length };
      }),
    };
  }

  // ---- Gateway --------------------------------------------------------------------------------------------------------------
  // The six att specificities share the same layout: left arm, a 15 base core, right arm. The core decides which sites recombine (1 with 1, 2
  // with 2 ...); the arms tell the kind of site apart: attB (B arms on both sides), attP (P arms on both sides), attL (P arm left, B arm right)
  // and attR (B arm left, P arm right). The P arms have conserved bases next to the core (the first 9 bases before and 8 after).
  const ATT_CORES = ['TTTGTACAAAAAAGC', 'TTTGTACAAGAAAGC', 'TTTGTATAATAAAGT', 'TTTGTATAGAAAAGT', 'TTTGTATACAAAAGT', 'TTTGTATTAAAAAGT'];
  const P_LEFT = 'AATGCCAAC';
  const P_RIGHT = 'TGAACGAG';
  // attB sites for the primers (the usual 25 base attB1 and attB2, the 21 base cores of the others)
  const ATTB = {
    1: 'ACAAGTTTGTACAAAAAAGCAGGCT',
    2: 'ACCACTTTGTACAAGAAAGCTGGGT',
    3: 'CAACTTTGTATAATAAAGTTG',
    4: 'CAACTTTGTATAGAAAAGTTG',
    5: 'CAACTTTGTATACAAAAGTTG',
    6: 'CAACTTTGTATTAAAAAGTTG',
  };
  const CORE_SIZE = 15;
  const CCDB_START = 'ATGCAGTTTAAGGTTTACACC';

  // does an arm look like a P arm: the window next to the core against the signature, one base may differ (the attP1 of some vectors does)
  function looksLikeP(window, signature, fromEnd) {
    if (window.length < 5) {
      return false;
    }
    const expected = fromEnd ? signature.slice(signature.length - window.length) : signature.slice(0, window.length);
    let different = 0;
    for (let i = 0; i < window.length; i++) {
      if (window[i] !== expected[i]) {
        different++;
      }
    }
    return different <= 1;
  }

  /**
   * The att sites of a sequence: {core (1 to 6), strand (1 or -1), start, end (the core on the top strand, end excluded), type
   * ('attB', 'attP', 'attL' or 'attR'), name ('attB1' ...)}. The kind is read on the strand of the site.
   */
  function findAttSites(sequence, circular) {
    const seq = clean(sequence);
    const length = seq.length;
    const text = circular ? seq + seq + seq : seq;
    const base = circular ? length : 0;
    const sites = [];
    ATT_CORES.forEach(function (core, index) {
      [1, -1].forEach(function (strand) {
        const pattern = strand === 1 ? core : reverseComplement(core);
        let at = text.indexOf(pattern, circular ? length - 0 : 0);
        while (at >= 0 && (circular ? at < 2 * length : at < length)) {
          const start = circular ? at - length : at;
          if (!circular || start >= 0 && start < length) {
            const before = text.slice(Math.max(0, at - 9), at);
            const after = text.slice(at + CORE_SIZE, at + CORE_SIZE + 9);
            // on the strand of the site: for the other strand the arms are read the other way round (the bases nearest to the core are compared)
            const left = strand === 1 ? before : reverseComplement(after);
            const right = (strand === 1 ? after : reverseComplement(before)).slice(0, 8);
            const leftP = looksLikeP(left, P_LEFT, true);
            const rightP = looksLikeP(right, P_RIGHT, false);
            const type = leftP && rightP ? 'attP' : leftP ? 'attL' : rightP ? 'attR' : 'attB';
            sites.push({ core: index + 1, strand: strand, start: start, end: start + CORE_SIZE, type: type, name: type + (index + 1) });
          }
          at = text.indexOf(pattern, at + 1);
        }
      });
    });
    return sites.sort(function (a, b) {
      return a.start - b.start;
    });
  }

  // a molecule for the recombination: its two sites, turned so that the lower core reads on the top strand (then the other reads on the bottom strand)
  function prepareGateway(data, label) {
    const original = clean(data.sequence);
    const circular = !!data.circular;
    const found = findAttSites(original, circular);
    if (found.length !== 2) {
      throw new Error('The ' + label + ' has ' + found.length + ' att site' + (found.length === 1 ? '' : 's') + (found.length ? ' (' + found.map(function (site) {
        return site.name;
      }).join(', ') + ')' : '') + ', it needs two.');
    }
    const length = original.length;
    let sites = found.slice().sort(function (a, b) {
      return a.core - b.core;
    });
    if (sites[0].core === sites[1].core) {
      throw new Error('The two att sites of the ' + label + ' have the same core (' + sites[0].name + ' and ' + sites[1].name + ').');
    }
    if (sites[0].type !== sites[1].type) {
      throw new Error('The sites of the ' + label + ' are of different kinds (' + sites[0].name + ' and ' + sites[1].name + ').');
    }
    if (sites[0].strand === sites[1].strand) {
      throw new Error('The two att sites of the ' + label + ' point the same way, the recombination would turn or cut the DNA.');
    }
    const flipped = sites[0].strand === -1;
    let sequence = original;
    if (flipped) {
      sequence = reverseComplement(original);
      sites = sites.map(function (site) {
        return Object.assign({}, site, { strand: -site.strand, start: length - site.end, end: length - site.start });
      });
    }
    return { sequence: sequence, original: original, length: length, circular: circular, flipped: flipped, sites: sites, features: data.features || {}, type: sites[0].type, label: label };
  }

  // the part of a molecule from start (in the turned molecule) for len bases, as a fragment of the original for the features
  function gatewayFragment(molecule, start, len) {
    if (!molecule.flipped) {
      return { start: mod(start, molecule.length), len: len, reversed: false };
    }
    return { start: mod(molecule.length - (start + len), molecule.length), len: len, reversed: true };
  }

  function arc(molecule, from, to) {
    // the bases from from to to going forward (round the origin on a circle)
    const length = molecule.length;
    const size = molecule.circular ? mod(to - from, length) : to - from;
    return { text: molecule.circular ? (molecule.sequence + molecule.sequence).slice(mod(from, length), mod(from, length) + size) : molecule.sequence.slice(from, to), size: size, from: from };
  }

  /**
   * Gateway recombination of a donor (the molecule that carries the gene between its two att sites: a PCR product with attB sites or an
   * entry clone with attL sites) into a recipient (the circular vector whose two sites, attP or attR, flank the part that is replaced).
   * The cores of the sites decide: 1 with 1 and 2 with 2. BP: attB x attP gives attL sites (the entry clone); LR: attL x attR gives attB sites
   * (the expression clone). The part of the recipient between its sites is replaced by the part of the donor between its sites.
   *
   * @returns {{reaction: string, clone: object, byproduct: object|null, warnings: string[], donor: object, recipient: object}}
   */
  function designGateway(options) {
    const warnings = [];
    const donor = prepareGateway(options.donor, 'donor');
    const recipient = prepareGateway(options.recipient, 'recipient');
    if (!recipient.circular) {
      throw new Error('The recipient has to be circular.');
    }
    const reaction = donor.type === 'attB' && recipient.type === 'attP' ? 'BP' : donor.type === 'attL' && recipient.type === 'attR' ? 'LR' : null;
    if (!reaction) {
      throw new Error('A donor with ' + donor.type + ' sites and a recipient with ' + recipient.type + ' sites do not recombine (BP needs attB with attP, LR needs attL with attR).');
    }
    if (donor.sites[0].core !== recipient.sites[0].core || donor.sites[1].core !== recipient.sites[1].core) {
      throw new Error('The sites do not match: the donor has ' + donor.sites.map(function (site) {
        return site.name;
      }).join(' and ') + ', the recipient ' + recipient.sites.map(function (site) {
        return site.name;
      }).join(' and ') + '. Sites recombine only with the same number.');
    }
    const [d1, d2] = donor.sites;
    const [r1, r2] = recipient.sites;
    if (!donor.circular && d1.end > d2.start) {
      throw new Error('The sites of the donor are in the wrong order along the sequence.');
    }
    const core1 = ATT_CORES[d1.core - 1];
    const core2 = reverseComplement(ATT_CORES[d2.core - 1]);
    // the new plasmid: the backbone of the recipient (from its second site round to its first), the core of the first site, the part of
    // the donor between its sites, the core of the second site
    const backbone = arc(recipient, r2.end, r1.start);
    const cassette = arc(donor, d1.end, d2.start);
    const replaced = arc(recipient, r1.end, r2.start);
    const sequence = backbone.text + core1 + cassette.text + core2;
    const features = {};
    const counter = { n: 0 };
    let lost = mapFeatures(recipient.features, gatewayFragment(recipient, backbone.from, backbone.size), recipient.length, 0, sequence.length, features, counter);
    lost += mapFeatures(donor.features, gatewayFragment(donor, cassette.from, cassette.size), donor.length, backbone.size + CORE_SIZE, sequence.length, features, counter);
    const sites = findAttSites(sequence, true).map(function (site) {
      return site.name;
    });
    const expected = reaction === 'BP' ? 'attL' : 'attB';
    if (sites.length !== 2 || !sites.every(function (name) {
      return name.indexOf(expected) === 0;
    })) {
      warnings.push('The new plasmid has ' + (sites.join(', ') || 'no att sites') + ' where two ' + expected + ' sites were expected.');
    }
    if (!new RegExp(CCDB_START + '|' + reverseComplement(CCDB_START)).test(replaced.text)) {
      warnings.push('The part of the recipient that is replaced does not hold ccdB, the usual negative selection: check that this is the right vector.');
    }
    if (lost > 0) {
      warnings.push(lost + ' annotated feature' + (lost === 1 ? '' : 's') + ' (att sites, or the part that was replaced) ' + (lost === 1 ? 'is' : 'are') + ' not in the new plasmid.');
    }
    if (cassette.size === 0) {
      warnings.push('There is nothing between the sites of the donor.');
    }
    // the other product: the backbone of a circular donor joined to the part that left the recipient (it holds ccdB, it is not selected)
    let byproduct = null;
    if (donor.circular) {
      const donorBackbone = arc(donor, d2.end, d1.start);
      byproduct = { sequence: donorBackbone.text + core1 + replaced.text + core2, sites: [] };
      byproduct.length = byproduct.sequence.length;
      byproduct.sites = findAttSites(byproduct.sequence, true).map(function (site) {
        return site.name;
      });
    }
    return {
      reaction: reaction,
      clone: { sequence: sequence, length: sequence.length, features: features, sites: sites },
      byproduct: byproduct,
      warnings: warnings,
      donor: { sites: donor.sites.map(function (site) {
        return site.name;
      }), flipped: donor.flipped, cassette: cassette.size },
      recipient: { sites: recipient.sites.map(function (site) {
        return site.name;
      }), flipped: recipient.flipped, replaced: replaced.size, hasCcdB: new RegExp(CCDB_START + '|' + reverseComplement(CCDB_START)).test(replaced.text) },
    };
  }

  /**
   * The primers that put attB sites round a piece of a sequence (from..to-1) for a BP reaction: 5' pad (GGGG), the attB site, optional extra bases
   * (to keep a reading frame, a tag or a Kozak sequence) and the bases that bind the piece (Tm about 60). The product is what the two primers
   * amplify, ready for designGateway as a donor.
   */
  function designAttBPrimers(options) {
    const sequence = clean(options.sequence);
    const tm = options.tm || fallbackTm;
    const from = options.from;
    const to = options.to;
    const upstream = options.upstream || 1;
    const downstream = options.downstream || 2;
    const pad = options.pad === undefined ? 'GGGG' : clean(options.pad);
    const piece = sequence.slice(from, to);
    if (piece.length < 30) {
      throw new Error('The piece needs at least 30 bases.');
    }
    if (!ATTB[upstream] || !ATTB[downstream] || upstream === downstream) {
      throw new Error('Choose two different attB sites.');
    }
    const extraForward = clean(options.extraForward || '');
    const extraReverse = clean(options.extraReverse || '');
    const bindForward = bindingRegion(piece, true, tm, options.targetTm || 60, 18, 35);
    const bindReverse = bindingRegion(piece, false, tm, options.targetTm || 60, 18, 35);
    const forward = pad + ATTB[upstream] + extraForward + bindForward;
    const reverse = pad + ATTB[downstream] + extraReverse + bindReverse;
    const warnings = [];
    [['forward', forward, bindForward], ['reverse', reverse, bindReverse]].forEach(function (item) {
      if (Math.abs(tm(item[2]) - (options.targetTm || 60)) > 5) {
        warnings.push('The binding part of the ' + item[0] + ' primer has a Tm of ' + Math.round(tm(item[2]) * 10) / 10 + ' °C.');
      }
    });
    if (forward.length > 70 || reverse.length > 70) {
      warnings.push('A primer of more than 70 bases is costly and may need PAGE purification.');
    }
    const product = forward + piece.slice(bindForward.length, piece.length - bindReverse.length) + reverseComplement(reverse);
    return {
      forward: { sequence: forward, binding: bindForward, tm: Math.round(tm(bindForward) * 10) / 10, length: forward.length },
      reverse: { sequence: reverse, binding: bindReverse, tm: Math.round(tm(bindReverse) * 10) / 10, length: reverse.length },
      product: product,
      warnings: warnings,
    };
  }

  function enzymesByName(list) {
    const map = {};
    list.forEach(function (enzyme) {
      map[enzyme.name.toLowerCase()] = enzyme;
    });
    return map;
  }

  const api = { METHODS: METHODS, designHomology: designHomology, designHomologyMulti: designHomologyMulti, homologyPrimerFeatures: homologyPrimerFeatures, attbPrimerFeatures: attbPrimerFeatures, extractPiece: extractPiece, digestFragments: digestFragments, placeFromDigest: placeFromDigest, combinePieces: combinePieces, designRestriction: designRestriction, designGoldenGate: designGoldenGate, designRestrictionMulti: designRestrictionMulti, designGateway: designGateway, designAttBPrimers: designAttBPrimers, findAttSites: findAttSites, findCuts: findCuts, digest: digest, findEnzyme: findEnzyme, clean: clean, reverseComplement: reverseComplement };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CloningEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
