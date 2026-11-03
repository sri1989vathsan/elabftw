/**
 * Aligns the sequencing reads (ab1) of an entry of the database to its reference sequence and shows the alignment in the
 * Open Vector Editor. The files are read here, the alignment is done on the server (align.php).
 * Opened with ?entry=<entry id>[&ref=<upload id of the reference>]
 */
(function () {
  'use strict';
  const body = document.body.dataset;
  const status = document.getElementById('status');
  const summary = document.getElementById('summary');
  const entryId = Number(body.entry) || 0;
  const files = JSON.parse(body.files || '{}');

  function fail(message) {
    status.textContent = message;
    status.className = 'error';
  }

  async function readFile(file) {
    const params = new URLSearchParams({ f: file.long_name, name: file.real_name, storage: String(file.storage) });
    const response = await fetch('../app/download.php?' + params.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(file.real_name + ' could not be downloaded (' + response.status + ').');
    }
    const binary = /\.(dna|ab1)$/i.test(file.real_name);
    const input = binary ? new File([await response.blob()], file.real_name) : await response.text();
    const results = await window.bioParsers.anyToJson(input, { fileName: file.real_name });
    const result = Array.isArray(results) ? results[0] : results;
    if (!result || !result.success || !result.parsedSequence) {
      throw new Error(file.real_name + ' could not be read as a sequence.');
    }
    return result.parsedSequence;
  }

  // a file dropped on the page: read from the computer, not from the entry
  async function readLocal(file) {
    const results = await window.bioParsers.anyToJson(file, { fileName: file.name });
    const result = Array.isArray(results) ? results[0] : results;
    if (!result || !result.success || !result.parsedSequence) {
      throw new Error(file.name + ' could not be read as a sequence.');
    }
    return result.parsedSequence;
  }

  // a read found on the other strand: its traces are turned around too, so they stay under their bases
  const COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
  function reverseTraces(chromatogram) {
    if (!chromatogram) {
      return chromatogram;
    }
    const flip = function (trace) {
      return trace ? trace.slice().reverse() : trace;
    };
    const swap = function (trace) {
      return trace ? { aTrace: flip(trace.tTrace), tTrace: flip(trace.aTrace), gTrace: flip(trace.cTrace), cTrace: flip(trace.gTrace) } : trace;
    };
    const length = (chromatogram.aTrace || []).length;
    const turned = Object.assign({}, chromatogram, swap(chromatogram));
    if (chromatogram.basePos) {
      turned.basePos = chromatogram.basePos.map(function (position) {
        return length - 1 - position;
      }).reverse();
    }
    if (chromatogram.baseCalls) {
      turned.baseCalls = chromatogram.baseCalls.map(function (base) {
        return COMPLEMENT[String(base).toUpperCase()] || 'N';
      }).reverse();
    }
    if (chromatogram.qualNums) {
      turned.qualNums = chromatogram.qualNums.slice().reverse();
    }
    if (chromatogram.baseTraces) {
      turned.baseTraces = chromatogram.baseTraces.map(swap).reverse();
    }
    return turned;
  }

  async function align(referenceSequence, reads) {
    const response = await fetch('align.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': body.csrf },
      body: JSON.stringify({
        entry: entryId,
        reference: referenceSequence,
        reads: reads.map(function (read) {
          return { name: read.name, sequence: read.sequence };
        }),
      }),
    });
    if (!response.ok) {
      throw new Error('The alignment failed (' + response.status + ').');
    }
    return (await response.json()).results;
  }

  function describe(name, alignment) {
    const line = document.createElement('p');
    const label = document.createElement('span');
    label.className = 'read-name';
    label.textContent = name + ': ';
    line.append(label);
    if (!alignment) {
      const none = document.createElement('span');
      none.className = 'bad';
      none.textContent = 'not found on the reference';
      line.append(none);
      return line;
    }
    const parts = [
      (alignment.strand === '-' ? 'reverse strand, ' : '') + 'reference ' + (alignment.refStart + 1) + '..' + alignment.refEnd,
      'identity ' + (alignment.identity * 100).toFixed(1) + '%',
    ];
    const differences = alignment.mismatches.map(function (m) {
      return m.position + ' ' + m.reference + '>' + m.read;
    });
    if (alignment.deletions.length > 0) {
      differences.push('missing at ' + alignment.deletions.join(', '));
    }
    if (alignment.insertions.length > 0) {
      differences.push('extra after ' + alignment.insertions.join(', '));
    }
    parts.push(differences.length > 0 ? 'differences: ' + differences.join('; ') : 'no difference');
    if (alignment.unknown.length > 0) {
      parts.push('unreadable bases at ' + alignment.unknown.join(', '));
    }
    const text = document.createElement('span');
    text.className = differences.length > 0 ? 'bad' : 'good';
    text.textContent = parts.join(' | ');
    line.append(text);
    return line;
  }

  const dropped = [];
  let lastAligned = null;
  const exportButton = document.getElementById('export-clustal');
  const importInput = document.getElementById('import-clustal');

  // ---- Clustal: the reference and the reads in the columns of the reference (the bases a read has more than the reference make columns of their own)
  function clustalNames(names) {
    const used = {};
    return names.map(function (name) {
      let clean = String(name).replace(/\.(ab1|gb|gbk|fasta|fa|dna)\b/i, '').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.()#+-]/g, '').slice(0, 30) || 'sequence';
      used[clean] = (used[clean] || 0) + 1;
      return used[clean] > 1 ? clean.slice(0, 26) + '_' + used[clean] : clean;
    });
  }

  function buildClustal(aligned) {
    const reference = aligned.referenceSequence;
    const length = reference.length;
    // for each read: the base opposite each base of the reference, and what it has more before a base
    const reads = aligned.found.map(function (item) {
      const a = item.alignment;
      const cells = {};
      const extra = {};
      let position = a.refStart;
      for (let c = 0; c < a.alignedReference.length; c++) {
        if (a.alignedReference[c] === '-') {
          extra[position] = (extra[position] || '') + a.alignedRead[c];
        } else {
          cells[position] = a.alignedRead[c];
          position++;
        }
      }
      return { start: a.refStart, end: position, cells: cells, extra: extra };
    });
    const slots = {};
    reads.forEach(function (read) {
      Object.keys(read.extra).forEach(function (key) {
        slots[key] = Math.max(slots[key] || 0, read.extra[key].length);
      });
    });
    const rows = [[], ...reads.map(function () {
      return [];
    })];
    for (let position = 0; position <= length; position++) {
      const width = slots[position] || 0;
      if (width > 0) {
        rows[0].push('-'.repeat(width));
        reads.forEach(function (read, index) {
          const inside = position > read.start && position < read.end;
          rows[index + 1].push(inside ? (read.extra[position] || '').padEnd(width, '-') : '-'.repeat(width));
        });
      }
      if (position < length) {
        rows[0].push(reference[position]);
        reads.forEach(function (read, index) {
          rows[index + 1].push(position >= read.start && position < read.end ? (read.cells[position] || '-') : '-');
        });
      }
    }
    const sequences = rows.map(function (parts) {
      return parts.join('');
    });
    // only the columns where a read is
    let first = Infinity;
    let last = -1;
    for (let column = 0; column < sequences[0].length; column++) {
      for (let r = 1; r < sequences.length; r++) {
        if (sequences[r][column] !== '-') {
          first = Math.min(first, column);
          last = Math.max(last, column);
          break;
        }
      }
    }
    return writeClustal(clustalNames([aligned.referenceName].concat(aligned.names)), sequences.map(function (sequence) {
      return sequence.slice(first, last + 1);
    }));
  }

  function writeClustal(names, sequences) {
    const width = Math.max.apply(null, names.map(function (name) {
      return name.length;
    })) + 2;
    const total = sequences[0].length;
    const counts = sequences.map(function () {
      return 0;
    });
    let text = 'CLUSTAL W (1.83) multiple sequence alignment\n\n\n';
    for (let start = 0; start < total; start += 60) {
      const end = Math.min(total, start + 60);
      sequences.forEach(function (sequence, index) {
        const chunk = sequence.slice(start, end);
        counts[index] += chunk.replace(/-/g, '').length;
        text += names[index].padEnd(width) + chunk + '\n';
      });
      let conserved = '';
      for (let column = start; column < end; column++) {
        const letters = sequences.map(function (sequence) {
          return sequence[column];
        });
        conserved += letters[0] !== '-' && letters.every(function (letter) {
          return letter === letters[0];
        }) ? '*' : ' ';
      }
      text += ' '.repeat(width) + conserved + '\n\n';
    }
    return text;
  }

  // a Clustal file: the names and the rows of letters, block after block
  function parseClustal(text) {
    const order = [];
    const rows = {};
    text.split(/\r?\n/).forEach(function (line, index) {
      if (index === 0 && /^(CLUSTAL|MUSCLE|MAFFT)/i.test(line)) {
        return;
      }
      if (line.trim() === '' || /^\s/.test(line)) {
        return;
      }
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2 || !/^[A-Za-z*.\-]+$/.test(parts[1])) {
        return;
      }
      if (!(parts[0] in rows)) {
        rows[parts[0]] = '';
        order.push(parts[0]);
      }
      rows[parts[0]] += parts[1].toUpperCase();
    });
    return order.map(function (name) {
      return { name: name, aligned: rows[name] };
    });
  }

  function showClustal(items) {
    if (items.length < 2) {
      throw new Error('The file needs at least two aligned sequences.');
    }
    const length = items[0].aligned.length;
    if (items.some(function (item) {
      return item.aligned.length !== length;
    })) {
      throw new Error('The sequences of the file are not all the same length.');
    }
    viewCount++;
    window.alignmentView = window.createAlignmentView(document.getElementById('root'), {
      id: 'clustal-alignment-' + viewCount,
      alignmentTracks: items.map(function (item) {
        return { sequenceData: { name: item.name, sequence: item.aligned.replace(/-/g, ''), circular: false }, alignmentData: { sequence: item.aligned } };
      }),
    });
    summary.hidden = true;
    document.body.classList.remove('has-summary');
    status.className = 'hidden';
  }

  exportButton.addEventListener('click', function () {
    if (!lastAligned) {
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([buildClustal(lastAligned)], { type: 'text/plain' }));
    link.download = (document.getElementById('entry-title').textContent.trim().replace(/[^A-Za-z0-9_.-]+/g, '_') || 'alignment') + '.aln';
    link.click();
  });
  importInput.addEventListener('change', async function () {
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) {
      return;
    }
    try {
      showClustal(parseClustal(await file.text()));
    } catch (error) {
      fail(error.message || String(error));
    }
  });

  // each alignment is shown in the same node with a view of its own
  let viewCount = 0;

  async function run() {
    if (!files.reference) {
      throw new Error('This entry has no reference sequence: attach a GenBank or FASTA file.');
    }
    const total = (files.reads || []).length + dropped.length;
    if (total === 0) {
      throw new Error('Drop the sequencing reads (ab1 files) on this page to align them to the sequence.');
    }
    summary.textContent = '';
    summary.hidden = true;
    status.className = '';
    const reference = await readFile(files.reference);
    const referenceSequence = String(reference.sequence).toUpperCase();
    status.textContent = 'Reading ' + total + ' read(s)...';
    const reads = [];
    for (const file of files.reads || []) {
      const parsed = await readFile(file);
      reads.push({ name: file.real_name, sequence: String(parsed.sequence).toUpperCase(), parsed: parsed });
    }
    for (const file of dropped) {
      const parsed = await readLocal(file);
      reads.push({ name: file.name + ' (dropped)', sequence: String(parsed.sequence).toUpperCase(), parsed: parsed });
    }
    status.textContent = 'Aligning...';
    const results = await align(referenceSequence, reads);
    // the result stays with the entry; the Align tool of the editor shows it
    if (window.AlignmentStore && entryId) {
      window.AlignmentStore.save(entryId, body.csrf, {
        referenceLength: referenceSequence.length,
        results: results.map(function (result, index) {
          return { name: reads[index].name, source: /\(dropped\)$/.test(reads[index].name) ? 'dropped' : 'entry', alignment: result.alignment };
        }),
      });
    }

    const tracks = [];
    const found = [];
    results.forEach(function (result, index) {
      summary.append(describe(reads[index].name, result.alignment));
      if (!result.alignment) {
        return;
      }
      const alignment = result.alignment;
      const chromatogram = alignment.strand === '-' ? reverseTraces(reads[index].parsed.chromatogramData) : reads[index].parsed.chromatogramData;
      found.push({
        alignment: alignment,
        track: {
          sequenceData: { name: reads[index].name, sequence: alignment.read, chromatogramData: chromatogram },
          alignmentData: { sequence: alignment.alignedRead },
          chromatogramData: chromatogram,
        },
      });
    });
    summary.hidden = false;
    document.body.classList.add('has-summary');
    document.documentElement.style.setProperty('--summary-height', summary.offsetHeight + 'px');
    if (found.length === 0) {
      throw new Error('None of the reads could be placed on the reference.');
    }

    const referenceTrack = function (alignedReference) {
      return {
        sequenceData: { name: files.reference.real_name, sequence: referenceSequence, features: reference.features, circular: false },
        alignmentData: { sequence: alignedReference },
      };
    };
    // the traces of the reads are shown under their bases from the start
    viewCount++;
    const options = { id: 'sequencing-alignment-' + viewCount, alignmentAnnotationVisibility: { chromatogram: true } };
    // without insertions in any read the reference is the same for all of them: one alignment of everything
    const plain = found.every(function (item) {
      return item.alignment.alignedReference === referenceSequence;
    });
    if (plain) {
      options.alignmentTracks = [referenceTrack(referenceSequence)].concat(found.map(function (item) {
        return item.track;
      }));
    } else {
      options.pairwiseAlignments = found.map(function (item) {
        return [referenceTrack(item.alignment.alignedReference), item.track];
      });
    }
    // what the export to Clustal writes: the reference and the reads that were placed
    lastAligned = { referenceName: files.reference.real_name, referenceSequence: referenceSequence, found: found, names: found.map(function (item) {
      return item.track.sequenceData.name;
    }) };
    exportButton.hidden = false;
    // the view opens where the reads are, not at the start of the reference
    const firstStart = Math.min.apply(null, found.map(function (item) {
      return item.alignment.refStart;
    }));
    options.scrollPercentageToJumpTo = Math.max(0, (firstStart - 20) / referenceSequence.length);
    status.className = 'hidden';
    window.alignmentView = window.createAlignmentView(document.getElementById('root'), options);
  }

  if (typeof window.createAlignmentView !== 'function' || !window.bioParsers) {
    fail('The sequence editor is not installed. Run bin/fetch-ove.sh once.');
    return;
  }
  // Esc leaves the alignment for the plasmid
  document.addEventListener('keydown', function (event) {
    const close = document.getElementById('close-alignment');
    if (event.key === 'Escape' && close && !event.defaultPrevented) {
      window.location.href = close.href;
    }
  });

  // an alignment attached to the entry as a Clustal file is shown as it is
  async function openAttachedClustal() {
    const file = files.clustal;
    const params = new URLSearchParams({ f: file.long_name, name: file.real_name, storage: String(file.storage) });
    const response = await fetch('../app/download.php?' + params.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(file.real_name + ' could not be downloaded (' + response.status + ').');
    }
    status.textContent = 'Reading ' + file.real_name + '...';
    showClustal(parseClustal(await response.text()));
    document.getElementById('title').textContent = file.real_name;
  }

  const start = function () {
    if (files.clustal && dropped.length === 0) {
      openAttachedClustal().catch(function (error) {
        fail(error.message || String(error));
      });
      return;
    }
    run().catch(function (error) {
      fail(error.message || String(error));
    });
  };
  start();

  // the reads are dropped on the page: they are added to those of the entry and everything is aligned again
  const hint = document.createElement('div');
  hint.id = 'drop-hint';
  hint.textContent = 'Drop the ab1 files to align them';
  hint.hidden = true;
  document.body.append(hint);
  let depth = 0;
  const hasFiles = function (event) {
    return Array.from((event.dataTransfer && event.dataTransfer.types) || []).indexOf('Files') !== -1;
  };
  document.addEventListener('dragenter', function (event) {
    if (hasFiles(event)) {
      depth++;
      hint.hidden = false;
    }
  });
  document.addEventListener('dragleave', function (event) {
    if (hasFiles(event) && --depth <= 0) {
      depth = 0;
      hint.hidden = true;
    }
  });
  document.addEventListener('dragover', function (event) {
    if (hasFiles(event)) {
      event.preventDefault();
    }
  });
  document.addEventListener('drop', function (event) {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    depth = 0;
    hint.hidden = true;
    const accepted = Array.from(event.dataTransfer.files).filter(function (file) {
      return /\.(ab1|abi|scf|fasta|fa|gb|gbk)$/i.test(file.name);
    });
    if (accepted.length === 0) {
      fail('Only sequencing files (ab1) can be dropped.');
      return;
    }
    accepted.forEach(function (file) {
      dropped.push(file);
    });
    start();
  });
})();
