/**
 * Finds the common features of a sequence (resistance genes, origins, promoters, tags, reporters ...) by comparing it with a
 * library of known feature sequences (features-library.json). A feature counts when its whole length matches on one of the two
 * strands with at least the wanted identity (no gaps). Works on circular sequences, and runs in the browser or in node.
 * Exposed as window.Annotator.
 */
(function (root) {
  'use strict';
  const COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G' };

  function reverseComplement(sequence) {
    let out = '';
    for (let i = sequence.length - 1; i >= 0; i--) {
      out += COMPLEMENT[sequence[i]] || 'N';
    }
    return out;
  }

  function clean(sequence) {
    return String(sequence || '').toUpperCase().replace(/[^ACGT]/g, 'N');
  }

  const SEED = 11;

  /**
   * @param {string} rawSequence
   * @param {boolean} circular
   * @param {Array<{n:string,t:string,d:string,s:string}>} library
   * @param {{identity?: number, minLength?: number}} options
   * @returns {Array<{name,type,description,start,end,strand,identity,length}>} start 0-based, end exclusive (can pass the origin)
   */
  function annotate(rawSequence, circular, library, options) {
    const identityMin = (options && options.identity) || 0.95;
    const minLength = (options && options.minLength) || 12;
    const sequence = clean(rawSequence);
    const length = sequence.length;
    const longest = library.reduce(function (m, f) {
      return Math.max(m, f.s.length);
    }, 0);
    // a circular sequence is read twice so that features across the origin are found
    const text = circular ? sequence + sequence.slice(0, Math.min(length, longest - 1)) : sequence;
    const index = new Map();
    for (let i = 0; i + SEED <= text.length; i++) {
      const key = text.substr(i, SEED);
      const list = index.get(key);
      if (list) {
        list.push(i);
      } else {
        index.set(key, [i]);
      }
    }
    const hits = [];
    const seen = new Set();
    library.forEach(function (feature, id) {
      const query = clean(feature.s);
      if (query.length < minLength || query.length > length) {
        return;
      }
      [1, -1].forEach(function (strand) {
        const probe = strand === 1 ? query : reverseComplement(query);
        const seed = Math.min(SEED, probe.length);
        // seeds along the feature: a feature with few differences has a clean stretch of the seed size somewhere
        const step = Math.max(1, Math.floor(seed / 2));
        for (let offset = 0; offset + seed <= probe.length; offset += step) {
          const places = seed === SEED ? index.get(probe.substr(offset, SEED)) : null;
          const candidates = places || (seed < SEED ? scan(text, probe.substr(offset, seed)) : []);
          for (let c = 0; c < candidates.length; c++) {
            const start = candidates[c] - offset;
            if (start < 0 || start + probe.length > text.length || (circular && start >= length)) {
              continue;
            }
            const key = id + ':' + strand + ':' + start;
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);
            let same = 0;
            for (let k = 0; k < probe.length; k++) {
              if (probe[k] === text[start + k]) {
                same++;
              }
            }
            const identity = same / probe.length;
            if (identity >= (probe.length < 30 ? 1 : identityMin)) {
              hits.push({
                name: feature.n, type: feature.t, description: feature.d, start: start, end: start + probe.length,
                strand: strand, identity: identity, length: probe.length,
              });
            }
          }
        }
      });
    });
    return resolve(hits, length, circular);
  }

  function scan(text, probe) {
    const found = [];
    let at = text.indexOf(probe);
    while (at !== -1) {
      found.push(at);
      at = text.indexOf(probe, at + 1);
    }
    return found;
  }

  // many library entries describe the same thing (AmpR exists in several versions): keep the best of those that overlap
  function resolve(hits, length, circular) {
    hits.sort(function (a, b) {
      return (b.length * b.identity) - (a.length * a.identity);
    });
    const kept = [];
    hits.forEach(function (hit) {
      const clash = kept.some(function (other) {
        const overlap = Math.min(hit.end, other.end) - Math.max(hit.start, other.start);
        const shorter = Math.min(hit.length, other.length);
        const sameName = other.name.toLowerCase() === hit.name.toLowerCase();
        // the same name on the same place, or the same kind of feature mostly inside a bigger one
        return overlap > 0 && ((sameName && overlap > shorter * 0.5) || (other.type === hit.type && overlap > shorter * 0.8));
      });
      if (!clash) {
        kept.push(hit);
      }
    });
    // features found in the repeated part are the same as those in the first copy: fold them back
    const out = [];
    const keys = new Set();
    kept.forEach(function (hit) {
      const start = hit.start % length;
      const key = hit.name + ':' + start + ':' + hit.strand;
      if (!keys.has(key)) {
        keys.add(key);
        out.push(Object.assign({}, hit, { start: start, end: start + hit.length }));
      }
    });
    out.sort(function (a, b) {
      return a.start - b.start;
    });
    return out;
  }

  const api = { annotate: annotate, reverseComplement: reverseComplement };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Annotator = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
