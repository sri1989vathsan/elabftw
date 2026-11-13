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

  // the sequence and the features of a GenBank file: {sequence, features: [{key, location, qualifiers}]}
  function parse(genbank) {
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
    return { sequence: sequence.toUpperCase(), features: features };
  }

  // [{name, start, end, forward, bases}], positions are 1-based with the end included; features with a split location are left out
  function read(genbank) {
    const parsed = parse(genbank);
    const sequence = parsed.sequence;
    const primers = [];
    for (const feature of parsed.features) {
      // primer_bind is the standard key; ApE and SnapGene write the key primer
      if (feature.key.toLowerCase() !== 'primer_bind' && feature.key.toLowerCase() !== 'primer') {
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
      // a note "sequence: acgt..." is the oligo as it was ordered (with a tail that does not bind, when there is one): it is the primer
      const written = /sequence:\s*([A-Za-z ]+)/i.exec(String(feature.qualifiers.note || ''));
      if (written && clean(written[1]).length >= MIN_LENGTH) {
        bases = clean(written[1]);
      }
      primers.push({ name: nameOf(feature.qualifiers), start: from, end: to, forward: forward, bases: bases });
    }
    return primers;
  }

  // names that are not a name of a plasmid: the file name is used instead
  const GENERIC_NAMES = /^(untitled|unnamed|exported|sequence|new[ _-]?dna|dna|unknown|name)\b/i;
  // the antibiotic of the resistance genes, by the names the features carry (a short name has to be the whole name)
  const RESISTANCE = [
    ['Ampicillin', /^(amp|ampr|ampicillin|bla|blatem|ampicillin resistance|beta-lactamase)$|\bampicillin\b|\bbeta-lactamase\b/i],
    ['Kanamycin', /^(kan|kanr|kanamycin|nptii|nptiii|neor|aph\(3'\)-ia?|kanamycin resistance)$|\bkanamycin\b/i],
    ['Chloramphenicol', /^(cm|cmr|camr|cat|chloramphenicol|chloramphenicol resistance|chloramphenicol acetyltransferase)$|\bchloramphenicol\b/i],
    ['Spectinomycin', /^(spec|specr|aada|spectinomycin|spectinomycin resistance)$|\bspectinomycin\b/i],
  ];

  // what a GenBank file says about the plasmid: {name, length, topology, definition, resistance, resistanceFrom}; empty strings when not there
  function summary(genbank) {
    const text = String(genbank || '');
    const out = { name: '', length: 0, topology: '', definition: '', resistance: '', resistanceFrom: '' };
    const locus = /^LOCUS[ \t]+(\S+)([^\r\n]*)/m.exec(text);
    if (locus) {
      out.name = GENERIC_NAMES.test(locus[1]) ? '' : locus[1];
      const size = /(\d+)\s*bp/i.exec(locus[2]);
      out.length = size ? Number(size[1]) : 0;
      out.topology = /\bcircular\b/i.test(locus[2]) ? 'circular' : /\blinear\b/i.test(locus[2]) ? 'linear' : '';
    }
    const definition = /^DEFINITION[ \t]+([^\r\n]*(?:\r?\n {2,}[^\r\n]*)*)/m.exec(text);
    out.definition = definition ? definition[1].replace(/\s+/g, ' ').replace(/\.$/, '').trim() : '';
    // the antibiotic: only when the genes show exactly one
    const found = new Map();
    parse(text).features.forEach(function (feature) {
      const key = feature.key.toLowerCase();
      if (key === 'primer_bind' || key === 'primer' || key === 'source') {
        return;
      }
      ['label', 'gene', 'product', 'standard_name'].forEach(function (qualifier) {
        const value = String(feature.qualifiers[qualifier] || '').replace(/^[\s"]+|[\s"]+$/g, '');
        RESISTANCE.forEach(function (entry) {
          if (value !== '' && entry[1].test(value) && !found.has(entry[0])) {
            found.set(entry[0], value);
          }
        });
      });
    });
    if (found.size === 1) {
      out.resistance = Array.from(found.keys())[0];
      out.resistanceFrom = Array.from(found.values())[0];
    }
    return out;
  }

  window.GenbankPrimers = { read: read, summary: summary, clean: clean, reverseComplement: reverseComplement, key: key, minLength: MIN_LENGTH };
})();
