/**
 * Fork-only. The primers written in a GenBank file (the features of the type primer_bind, as Benchling writes them), with their
 * letters as the primer is ordered (the reverse complement for a primer on the other strand). The same reading as
 * sequence-viewer/genbank-primers.inc.php (used by the import of a zip); used when a plasmid gets its sequence from a GenBank file,
 * to offer to attach the primers that are in the database and to add the ones that are missing. Exposed as window.GenbankPrimers.
 */
(function () {
  'use strict';
  const MIN_LENGTH = 12;
  const NAME_QUALIFIERS = ['label', 'standard_name', 'note', 'gene', 'name'];
  const PAIRS = { A: 'T', C: 'G', G: 'C', T: 'A', U: 'A', R: 'Y', Y: 'R', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D' };

  const clean = function (bases) {
    return String(bases || '').toUpperCase().replace(/[^A-Z]/g, '');
  };

  const reverseComplement = function (bases) {
    return clean(bases).split('').reverse().map(function (letter) {
      return PAIRS[letter] || letter;
    }).join('');
  };

  // the same key for a primer and for its reverse complement: two primers with this key are the same oligo
  const key = function (bases) {
    const forward = clean(bases);
    const reverse = reverseComplement(forward);
    return forward <= reverse ? forward : reverse;
  };

  const nameOf = function (qualifiers) {
    for (const name of NAME_QUALIFIERS) {
      const value = String(qualifiers[name] || '').replace(/^[\s"]+|[\s"]+$/g, '');
      if (value !== '') {
        return value;
      }
    }
    return 'primer';
  };

  // [{name, start, end, forward, bases}], positions are 1-based with the end included; features with a split location are left out
  function read(genbank) {
    let sequence = '';
    const features = [];
    let current = null;
    let inFeatures = false;
    let inOrigin = false;
    for (const line of String(genbank || '').split(/\r\n|\r|\n/)) {
      if (line.startsWith('//')) {
        break;
      }
      if (line.startsWith('FEATURES')) {
        inFeatures = true;
        inOrigin = false;
        continue;
      }
      if (line.startsWith('ORIGIN')) {
        if (current) {
          features.push(current);
          current = null;
        }
        inFeatures = false;
        inOrigin = true;
        continue;
      }
      if (inOrigin) {
        sequence += line.replace(/[^A-Za-z]/g, '');
        continue;
      }
      if (!inFeatures) {
        continue;
      }
      const start = /^ {1,8}(\S+)\s+(\S.*)$/.exec(line);
      if (start && !line.trim().startsWith('/')) {
        if (current) {
          features.push(current);
        }
        current = { key: start[1], location: start[2].trim(), qualifiers: {}, last: null, locationOpen: true };
        continue;
      }
      const more = /^ {10,}(\S.*)$/.exec(line);
      if (!current || !more) {
        continue;
      }
      const text = more[1].trim();
      if (text.startsWith('/')) {
        current.locationOpen = false;
        const qualifier = /^\/([A-Za-z_]+)(?:=(.*))?$/.exec(text);
        if (qualifier) {
          current.last = qualifier[1];
          // only the first value of a qualifier is kept
          if (!(qualifier[1] in current.qualifiers)) {
            current.qualifiers[qualifier[1]] = qualifier[2] || '';
          } else {
            current.last = null;
          }
        }
      } else if (current.locationOpen) {
        current.location += text;
      } else if (current.last !== null) {
        current.qualifiers[current.last] += ' ' + text;
      }
    }
    if (current) {
      features.push(current);
    }
    sequence = sequence.toUpperCase();
    const primers = [];
    for (const feature of features) {
      if (feature.key.toLowerCase() !== 'primer_bind') {
        continue;
      }
      let location = feature.location;
      let forward = true;
      const complement = /^complement\((.*)\)$/.exec(location);
      if (complement) {
        forward = false;
        location = complement[1];
      }
      const span = /^[<>]?(\d+)\.\.[<>]?(\d+)$/.exec(location);
      if (!span) {
        continue;
      }
      const from = Number(span[1]);
      const to = Number(span[2]);
      if (from < 1 || to < from || to > sequence.length) {
        continue;
      }
      let bases = sequence.slice(from - 1, to);
      if (!forward) {
        bases = reverseComplement(bases);
      }
      primers.push({ name: nameOf(feature.qualifiers), start: from, end: to, forward: forward, bases: bases });
    }
    return primers;
  }

  window.GenbankPrimers = { read: read, clean: clean, reverseComplement: reverseComplement, key: key, minLength: MIN_LENGTH };
})();
