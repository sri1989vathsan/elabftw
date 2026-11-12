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

  // the algorithm of the alignment, chosen in the bar and shared with the Align tab of the sequence editor
  function algorithmChoice() {
    try {
      const saved = window.localStorage.getItem('elabftw-aligner');
      return saved === 'mafft' || saved === 'clustalo' ? saved : 'builtin';
    } catch (e) {
      return 'builtin';
    }
  }
  const algorithmMenu = document.getElementById('algorithm');
  if (algorithmMenu) {
    algorithmMenu.value = algorithmChoice();
    algorithmMenu.addEventListener('change', function () {
      try {
        window.localStorage.setItem('elabftw-aligner', algorithmMenu.value);
      } catch (e) {
        // only kept until the page is closed
      }
      if (savedReads) {
        // a saved alignment is made again, with the reads it has, by the algorithm that was chosen
        realign = true;
        start();
        return;
      }
      window.location.reload();
    });
  }

  async function align(referenceSequence, reads, circular) {
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
        algorithm: algorithmChoice(),
        circular: circular === true,
      }),
    });
    if (!response.ok) {
      // the answer says why, for example that a program is missing on the server
      const failure = await response.json().catch(function () {
        return {};
      });
      throw new Error(failure.error || 'The alignment failed (' + response.status + ').');
    }
    return (await response.json()).results;
  }

  // a file dropped by mistake is taken out again with this button
  function removeButton(line, name, onRemove) {
    if (!onRemove) {
      return;
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '\u00d7';
    remove.setAttribute('aria-label', 'Remove ' + name);
    remove.title = 'Remove ' + name + ' from the alignment';
    remove.style.cssText = 'margin-left:8px;border:0;background:none;cursor:pointer;font:inherit;font-size:16px;line-height:1;padding:0 4px;color:#888';
    remove.addEventListener('click', onRemove);
    line.append(remove);
  }

  function describe(name, alignment, referenceLength, onRemove) {
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
      removeButton(line, name, onRemove);
      return line;
    }
    const parts = [
      (alignment.strand === '-' ? 'reverse strand, ' : '') + 'reference ' + (alignment.refStart + 1) + '..' + (alignment.wraps ? referenceLength + ' + 1..' + (alignment.refEnd - referenceLength) + ' (over the origin)' : alignment.refEnd),
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
    removeButton(line, name, onRemove);
    return line;
  }

  const dropped = [];
  let lastAligned = null;
  // a saved alignment that is open: its text (shown as it is, kept or renamed from there) and its reads (aligned again with another
  // algorithm); realign is set when the algorithm was changed
  let clustalText = null;
  let savedReads = null;
  let realign = false;
  const exportButton = document.getElementById('export-clustal');
  const saveButton = document.getElementById('save-alignment');
  const nameInput = document.getElementById('alignment-name');
  const savedMenu = document.getElementById('saved-alignments');
  const savedLabel = document.getElementById('saved-label');
  // the other pages of the entry keep the sequence this page is about
  function refParam() {
    return files.reference ? '&ref=' + files.reference.id : '';
  }
  const readMenu = document.getElementById('read-view');
  const readLabel = document.getElementById('read-label');
  // the title of the entry, as the start of the name of an alignment
  function baseName() {
    return document.getElementById('entry-title').textContent.trim().replace(/[^A-Za-z0-9_.()#+ -]+/g, '_').slice(0, 40);
  }

  // a fasta read is kept in the entry as name.read.fasta: the entry lists it as a sequencing read and not as the sequence of the plasmid
  function readName(name) {
    return /\.(fasta|fa)$/i.test(name) && !/\.read\.(fasta|fa)$/i.test(name) ? name.replace(/\.(fasta|fa)$/i, '.read.$1') : name;
  }

  // ---- the alignments kept in the entry: each opens on its own (alignment.php?clustal=<id>), the reads of the entry are aligned afresh from the first choice
  function fillSaved(list) {
    savedMenu.textContent = '';
    const head = document.createElement('option');
    head.value = '';
    head.textContent = list.length === 0 ? 'none yet' : 'Open one (' + list.length + ')';
    savedMenu.append(head);
    list.forEach(function (item) {
      const option = document.createElement('option');
      option.value = String(item.id);
      option.textContent = item.name.replace(/\.(aln|clustal|clw)$/i, '');
      option.selected = files.clustal && files.clustal.id === item.id;
      savedMenu.append(option);
    });
    if (files.clustal) {
      const reads = document.createElement('option');
      reads.value = 'reads';
      reads.textContent = 'The reads of the entry';
      savedMenu.append(reads);
    }
    savedLabel.hidden = list.length === 0 && !files.clustal;
    fillTogether(list);
  }
  // several saved alignments in one view: their reads are put together and aligned to the reference
  const together = document.getElementById('together');
  const togetherButton = document.getElementById('together-button');
  const togetherPanel = document.getElementById('together-panel');
  function fillTogether(list) {
    togetherPanel.textContent = '';
    together.hidden = list.length < 2;
    const open = new Set((files.clustals || []).map(function (file) {
      return file.id;
    }));
    const boxes = list.map(function (item) {
      const label = document.createElement('label');
      label.style.cssText = 'display:block;margin:2px 0;cursor:pointer';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = String(item.id);
      box.checked = open.has(item.id) && open.size > 1;
      label.append(box, ' ' + item.name.replace(/\.(aln|clustal|clw)$/i, ''));
      togetherPanel.append(label);
      return box;
    });
    const go = document.createElement('button');
    go.type = 'button';
    go.style.marginTop = '6px';
    go.textContent = 'View the checked ones together';
    const refresh = function () {
      go.disabled = boxes.filter(function (box) {
        return box.checked;
      }).length < 2;
    };
    boxes.forEach(function (box) {
      box.addEventListener('change', refresh);
    });
    refresh();
    go.addEventListener('click', function () {
      const ids = boxes.filter(function (box) {
        return box.checked;
      }).map(function (box) {
        return box.value;
      });
      window.location.href = 'alignment.php?entry=' + entryId + refParam() + '&clustal=' + ids.join(',');
    });
    togetherPanel.append(go);
  }
  togetherButton.addEventListener('click', function () {
    togetherPanel.hidden = !togetherPanel.hidden;
    togetherButton.setAttribute('aria-expanded', String(!togetherPanel.hidden));
  });
  fillSaved(files.saved || []);
  savedMenu.addEventListener('change', function () {
    if (savedMenu.value === '') {
      return;
    }
    window.location.href = 'alignment.php?entry=' + entryId + refParam() + (savedMenu.value === 'reads' ? '' : '&clustal=' + savedMenu.value);
  });
  async function refreshSaved() {
    try {
      const response = await fetch('../api/v2/inventory/' + entryId + '/uploads', { credentials: 'same-origin' });
      if (response.ok) {
        const list = (await response.json()).filter(function (upload) {
          return /\.(aln|clustal|clw)$/i.test(upload.real_name);
        }).map(function (upload) {
          return { id: Number(upload.id), name: upload.real_name };
        });
        fillSaved(list);
      }
    } catch (error) {
      // the menu stays as it was
    }
  }
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

  /**
   * The reference and the reads in common columns: for each of them a row of letters, gaps where it has none. The bases a read has more
   * than the reference make columns of their own (gaps in the others). A circular reference is read over its origin, so the row of
   * the reference goes on past its end by what a read over the origin needs, with the start of the plasmid again.
   */
  function layout(aligned) {
    const reference = aligned.referenceSequence;
    const length = reference.length;
    // for each read: the base opposite each base of the reference, and what it has more before a base
    const reads = aligned.found.map(function (item) {
      const a = item.alignment;
      const cells = {};
      const extra = {};
      // the columns are over the whole reference, and past its end for a read over the origin
      let position = 0;
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
    let total = length;
    reads.forEach(function (read) {
      total = Math.max(total, read.end);
      Object.keys(read.extra).forEach(function (key) {
        slots[key] = Math.max(slots[key] || 0, read.extra[key].length);
      });
    });
    const rows = [[], ...reads.map(function () {
      return [];
    })];
    for (let position = 0; position <= total; position++) {
      const width = slots[position] || 0;
      if (width > 0) {
        rows[0].push('-'.repeat(width));
        reads.forEach(function (read, index) {
          const inside = position > read.start && position < read.end;
          rows[index + 1].push(inside ? (read.extra[position] || '').padEnd(width, '-') : '-'.repeat(width));
        });
      }
      if (position < total) {
        rows[0].push(reference[position % length]);
        reads.forEach(function (read, index) {
          rows[index + 1].push(position >= read.start && position < read.end ? (read.cells[position] || '-') : '-');
        });
      }
    }
    return rows.map(function (parts) {
      return parts.join('');
    });
  }

  function buildClustal(aligned) {
    const sequences = layout(aligned);
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
    readLabel.hidden = true;
    lastAligned = null;
    clustalText = null;
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

  // the alignment as a picture or a PDF, drawn from its letters (the reference first), what is shown now
  const imageButtons = [document.getElementById('export-png'), document.getElementById('export-pdf')];
  function sheet() {
    if (lastAligned) {
      return { names: [lastAligned.referenceName].concat(lastAligned.names), rows: layout(lastAligned), referenceLength: lastAligned.referenceSequence.length };
    }
    if (clustalText) {
      const items = parseClustal(clustalText);
      return { names: items.map(function (item) {
        return item.name;
      }), rows: items.map(function (item) {
        return item.aligned;
      }), referenceLength: items[0].aligned.replace(/-/g, '').length };
    }
    return null;
  }
  imageButtons.forEach(function (button) {
    button.addEventListener('click', async function () {
      const data = sheet();
      if (!data || !window.ExportImage) {
        return;
      }
      const format = button.id === 'export-pdf' ? 'pdf' : 'png';
      const label = button.textContent;
      button.disabled = true;
      button.textContent = '...';
      try {
        const title = document.getElementById('entry-title').textContent.trim() + ' - alignment of ' + (data.names.length - 1) + (data.names.length === 2 ? ' read' : ' reads') + ' - ' + new Date().toISOString().slice(0, 10);
        const blob = await window.ExportImage.alignment(format, { title: title, names: data.names, rows: data.rows, referenceLength: data.referenceLength });
        window.ExportImage.download(blob, (document.getElementById('entry-title').textContent.trim().replace(/[^A-Za-z0-9_.-]+/g, '_') || 'alignment') + '-alignment.' + format);
      } catch (error) {
        fail(error.message || String(error));
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    });
  });
  exportButton.addEventListener('click', function () {
    if (!lastAligned && !clustalText) {
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([lastAligned ? buildClustal(lastAligned) : clustalText], { type: 'text/plain' }));
    link.download = (document.getElementById('entry-title').textContent.trim().replace(/[^A-Za-z0-9_.-]+/g, '_') || 'alignment') + '.aln';
    link.click();
  });
  // the alignment goes into the files of the entry as a Clustal file (it is opened from there as it is), and the reads that were dropped
  // on the page go with it, so that the alignment can be made again
  // the reads of the entry and the dropped ones that are in its files already: saving again under another name does not add them twice
  const keptReads = new Set((files.reads || []).map(function (read) {
    return read.real_name;
  }));
  // another name (or more reads) can be saved again
  nameInput.addEventListener('input', function () {
    nameInput.dataset.auto = '0';
    saveButton.disabled = false;
    saveButton.textContent = 'Save in the entry';
  });
  saveButton.addEventListener('click', async function () {
    if ((!lastAligned && !clustalText) || !entryId || !window.AlignmentStore) {
      return;
    }
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    // a new name keeps the alignment next to the others of the entry, the name of a saved one replaces it
    const name = (nameInput.value.trim().replace(/\.(aln|clustal|clw)$/i, '').replace(/[^A-Za-z0-9_.()#+ -]+/g, '_').slice(0, 60) || 'alignment') + '.aln';
    let saved = await window.AlignmentStore.saveText(entryId, body.csrf, name, lastAligned ? buildClustal(lastAligned) : clustalText);
    for (const file of dropped) {
      // sequencing files are kept as reads, a fasta read as name.read.fasta (a plain fasta file in the entry would be taken for the sequence
      // of the plasmid); a GenBank file is not kept (the alignment itself is in the Clustal file)
      const kept = readName(file.name);
      if (!saved || keptReads.has(kept) || !/\.(ab1|abi|scf|fasta|fa)$/i.test(file.name)) {
        continue;
      }
      const form = new FormData();
      form.append('file', new File([file], kept, { type: file.type }));
      try {
        const response = await fetch('../api/v2/inventory/' + entryId + '/uploads', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': body.csrf }, body: form });
        saved = response.ok;
        if (saved) {
          keptReads.add(kept);
        }
      } catch (error) {
        saved = false;
      }
    }
    saveButton.textContent = saved ? 'Saved in the entry' : 'Could not save (no right to edit the entry?)';
    saveButton.disabled = saved;
    if (saved) {
      await refreshSaved();
    }
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
    const total = savedReads ? savedReads.length : (files.reads || []).length + dropped.length;
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
    for (const file of savedReads ? [] : files.reads || []) {
      const parsed = await readFile(file);
      reads.push({ name: file.real_name, sequence: String(parsed.sequence).toUpperCase(), parsed: parsed });
    }
    // the reads of a saved alignment (bases only: the file keeps no traces)
    (savedReads || []).forEach(function (read) {
      reads.push({ name: read.name, sequence: read.sequence, parsed: { sequence: read.sequence } });
    });
    const unreadable = [];
    for (const file of savedReads ? [] : Array.from(dropped)) {
      try {
        const parsed = await readLocal(file);
        reads.push({ name: file.name + ' (dropped)', sequence: String(parsed.sequence).toUpperCase(), parsed: parsed });
      } catch (error) {
        // a file that is not a sequence is left out (and forgotten), the others are aligned
        dropped.splice(dropped.indexOf(file), 1);
        unreadable.push(file.name);
      }
    }
    if (reads.length === 0) {
      throw new Error(unreadable.length > 0 ? unreadable.join(', ') + ' could not be read as a sequence.' : 'Drop the sequencing reads (ab1 files) on this page to align them to the sequence.');
    }
    status.textContent = 'Aligning...';
    const results = await align(referenceSequence, reads, reference.circular === true);
    // the result stays with the entry; the Align tool of the editor shows it
    if (window.AlignmentStore && entryId && !savedReads) {
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
      const droppedIndex = savedReads ? -1 : index - (files.reads || []).length;
      summary.append(describe(reads[index].name, result.alignment, referenceSequence.length, droppedIndex < 0 ? null : function () {
        dropped.splice(droppedIndex, 1);
        if ((files.reads || []).length + dropped.length === 0) {
          window.location.reload();
          return;
        }
        start();
      }));
      if (!result.alignment) {
        return;
      }
      const alignment = result.alignment;
      const traces = reads[index].parsed.chromatogramData;
      const chromatogram = traces && alignment.strand === '-' ? reverseTraces(traces) : traces;
      found.push({
        alignment: alignment,
        track: {
          sequenceData: { name: reads[index].name, sequence: alignment.read, chromatogramData: chromatogram },
          alignmentData: { sequence: alignment.alignedRead },
          chromatogramData: chromatogram,
        },
      });
    });
    unreadable.forEach(function (name) {
      const note = document.createElement('p');
      note.className = 'bad';
      note.textContent = name + ' could not be read as a sequence and was left out.';
      summary.append(note);
    });
    summary.hidden = false;
    document.body.classList.add('has-summary');
    document.documentElement.style.setProperty('--summary-height', summary.offsetHeight + 'px');
    if (found.length === 0) {
      throw new Error('None of the reads could be placed on the reference.');
    }

    // a read over the origin of a circular plasmid has the start of the plasmid again after its end: that track shows the reference
    // a little longer than it is, with the features of that start repeated
    const referenceTrack = function (alignedReference) {
      const sequence = alignedReference.replace(/-/g, '');
      let features = reference.features;
      if (sequence.length > referenceSequence.length) {
        const beyond = sequence.length - referenceSequence.length;
        const list = Array.isArray(features) ? features : Object.values(features || {});
        features = list.concat(list.filter(function (feature) {
          return feature.start < beyond;
        }).map(function (feature) {
          return Object.assign({}, feature, { id: String(feature.id || feature.name) + '-again', start: feature.start + referenceSequence.length, end: Math.min(sequence.length - 1, feature.end + referenceSequence.length) });
        }));
      }
      return {
        sequenceData: { name: files.reference.real_name, sequence: sequence, features: features, circular: false },
        alignmentData: { sequence: alignedReference },
      };
    };
    // the whole alignment (every read placed) or one read on its own, chosen in the Show menu; Export and Save take what is shown
    const showReads = function (chosen) {
      const shown = chosen === null ? found : [found[chosen]];
      // the traces of the reads are shown under their bases from the start
      viewCount++;
      const options = { id: 'sequencing-alignment-' + viewCount, alignmentAnnotationVisibility: { chromatogram: true } };
      // lastAligned is what the export to Clustal writes: the reference and the reads that are shown. The view shows the same columns:
      // one alignment of everything (it opens on the reads, the base letters show when zoomed in)
      lastAligned = { referenceName: files.reference.real_name, referenceSequence: referenceSequence, found: shown, names: shown.map(function (item) {
        return item.track.sequenceData.name;
      }) };
      const rows = layout(lastAligned);
      options.alignmentTracks = [referenceTrack(rows[0])].concat(shown.map(function (item, index) {
        return Object.assign({}, item.track, { alignmentData: { sequence: rows[index + 1] } });
      }));
      // the view opens where the reads are, not at the start of the reference
      const firstStart = Math.min.apply(null, shown.map(function (item) {
        return item.alignment.refStart;
      }));
      options.scrollPercentageToJumpTo = Math.max(0, (firstStart - 20) / referenceSequence.length);
      saveButton.disabled = false;
      saveButton.textContent = 'Save in the entry';
      if (chosen !== null && nameInput.dataset.auto === '1') {
        nameInput.value = baseName() + ' ' + found[chosen].track.sequenceData.name.replace(/\.[^.]+$/, '').replace(/ \(dropped\)$/, '');
      } else if (chosen === null && nameInput.dataset.auto === '1') {
        nameInput.value = baseName() + ' alignment';
      }
      window.alignmentView = window.createAlignmentView(document.getElementById('root'), options);
    };
    imageButtons.forEach(function (button) {
      button.hidden = false;
    });
    exportButton.hidden = false;
    saveButton.hidden = false;
    nameInput.hidden = false;
    if (nameInput.value === '') {
      nameInput.value = baseName() + ' alignment';
      nameInput.dataset.auto = '1';
    }
    // each read can be looked at on its own
    readMenu.textContent = '';
    readMenu.append(new Option('All ' + found.length + ' reads together', ''));
    found.forEach(function (item, index) {
      readMenu.append(new Option(item.track.sequenceData.name, String(index)));
    });
    readLabel.hidden = found.length < 2;
    readMenu.onchange = function () {
      showReads(readMenu.value === '' ? null : Number(readMenu.value));
    };
    status.className = 'hidden';
    // ?read=<name>: the alignment view opens on that read alone (chosen in the Align tab of the editor)
    const wanted = new URLSearchParams(window.location.search).get('read');
    const wantedIndex = wanted === null ? -1 : found.findIndex(function (item) {
      return item.track.sequenceData.name === wanted;
    });
    if (wantedIndex >= 0 && found.length > 1) {
      readMenu.value = String(wantedIndex);
      showReads(wantedIndex);
    } else {
      showReads(null);
    }
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
  async function downloadText(file) {
    const params = new URLSearchParams({ f: file.long_name, name: file.real_name, storage: String(file.storage) });
    const response = await fetch('../app/download.php?' + params.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(file.real_name + ' could not be downloaded (' + response.status + ').');
    }
    return response.text();
  }

  // several saved alignments in one view: the reads of all of them are aligned to the reference together (by the algorithm of the bar)
  async function openTogether() {
    const reads = [];
    const seen = new Set();
    const names = new Set();
    for (const file of files.clustals) {
      status.textContent = 'Reading ' + file.real_name + '...';
      const label = file.real_name.replace(/\.(aln|clustal|clw)$/i, '');
      parseClustal(await downloadText(file)).slice(1).forEach(function (item) {
        const sequence = item.aligned.replace(/-/g, '').toUpperCase();
        if (seen.has(item.name + '|' + sequence)) {
          return;
        }
        seen.add(item.name + '|' + sequence);
        // two reads of the same name from different alignments are told apart by the alignment
        const name = names.has(item.name) ? item.name + ' (' + label + ')' : item.name;
        names.add(item.name);
        reads.push({ name: name, sequence: sequence });
      });
    }
    if (reads.length === 0) {
      throw new Error('The saved alignments have no reads.');
    }
    savedReads = reads;
    document.getElementById('title').textContent = files.clustals.length + ' saved alignments together';
    nameInput.value = files.clustals.map(function (file) {
      return file.real_name.replace(/\.(aln|clustal|clw)$/i, '');
    }).join(' + ').slice(0, 60);
    nameInput.dataset.auto = '0';
    await run();
  }

  async function openAttachedClustal() {
    const file = files.clustal;
    status.textContent = 'Reading ' + file.real_name + '...';
    const text = await downloadText(file);
    const items = parseClustal(text);
    showClustal(items);
    document.getElementById('title').textContent = file.real_name;
    // the saved alignment can be renamed (saved under another name), exported, and made again by another algorithm
    clustalText = text;
    imageButtons.forEach(function (button) {
      button.hidden = false;
    });
    exportButton.hidden = false;
    saveButton.hidden = false;
    saveButton.disabled = false;
    saveButton.textContent = 'Save in the entry';
    nameInput.hidden = false;
    nameInput.value = file.real_name.replace(/\.(aln|clustal|clw)$/i, '');
    nameInput.dataset.auto = '0';
    if (files.reference) {
      savedReads = items.slice(1).map(function (item) {
        return { name: item.name, sequence: item.aligned.replace(/-/g, '').toUpperCase() };
      });
    }
  }

  // the files dropped on the Align tool of the editor come along (they were only in that page), once and only when just handed over
  try {
    const raw = window.localStorage.getItem('elabftw-aligner-handoff');
    if (raw) {
      window.localStorage.removeItem('elabftw-aligner-handoff');
      const handoff = JSON.parse(raw);
      if (handoff && handoff.entry === entryId && Date.now() - handoff.at < 300000) {
        handoff.files.forEach(function (item) {
          const bytes = Uint8Array.from(atob(item.data), function (c) {
            return c.charCodeAt(0);
          });
          dropped.push(new File([bytes], item.name, { type: item.type || '' }));
        });
      }
    }
  } catch (error) {
    // nothing came along
  }

  const start = function () {
    if (files.clustal && dropped.length === 0 && !realign) {
      (files.clustals.length > 1 ? openTogether() : openAttachedClustal()).catch(function (error) {
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
  }, true);
  document.addEventListener('drop', function (event) {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    // the viewer under the page must not take the file for a sequence of its own
    event.stopPropagation();
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
  }, true);
})();
