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

  function enzymesByName(list) {
    const map = {};
    list.forEach(function (enzyme) {
      map[enzyme.name.toLowerCase()] = enzyme;
    });
    return map;
  }

  const api = { METHODS: METHODS, designHomology: designHomology, designRestriction: designRestriction, findCuts: findCuts, digest: digest, findEnzyme: findEnzyme, clean: clean, reverseComplement: reverseComplement };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CloningEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
