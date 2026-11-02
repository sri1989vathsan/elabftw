/**
 * The BLAST part of the "Tools" panel: sends the selection (or the whole sequence) to NCBI BLAST in a new tab, to look for
 * similar sequences. This is the only tool that sends the sequence to another server, so the button says so.
 * Exposed as window.BlastTool.
 */
(function () {
  'use strict';

  const MAX_BASES = 100000;
  const PROGRAMS = [
    ['blastn', 'Nucleotide (blastn): similar DNA'],
    ['blastx', 'Translated (blastx): similar proteins'],
    ['tblastx', 'Translated both (tblastx)'],
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  // the bases the tool works on: the selection, or the whole sequence when nothing is selected
  function region(editor) {
    const state = editor.getState();
    const sequence = String(state.sequenceData.sequence || '').toUpperCase();
    const selection = state.selectionLayer || {};
    if (selection.start >= 0 && selection.end >= 0) {
      const part = selection.end >= selection.start ? sequence.slice(selection.start, selection.end + 1) : sequence.slice(selection.start) + sequence.slice(0, selection.end + 1);
      return { bases: part, label: 'the selection (' + part.length + ' bases)' };
    }
    return { bases: sequence, label: 'the whole sequence (' + sequence.length + ' bases)' };
  }

  // a form posted to NCBI in a new tab; CMD=Put makes NCBI run the search at once, as its own page does
  function send(program, bases, name) {
    const query = '>' + (name || 'query') + '\n' + bases;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';
    form.target = '_blank';
    form.rel = 'noopener';
    const fields = { PAGE_TYPE: 'BlastSearch', PROGRAM: program, QUERY: query, DATABASE: program === 'blastx' ? 'nr' : 'nt', CMD: 'Put' };
    Object.keys(fields).forEach(function (key) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = fields[key];
      form.append(input);
    });
    document.body.append(form);
    form.submit();
    form.remove();
  }

  function section(editor, entryName) {
    const box = element('div', 'tools-block');
    box.append(element('p', 'tool-muted', 'Looks for sequences like this one in the public databases of NCBI. Select a part of the sequence to search for only that part.'));
    const program = element('select', 'tools-select');
    PROGRAMS.forEach(function (item) {
      const option = element('option', '', item[1]);
      option.value = item[0];
      program.append(option);
    });
    const info = element('p', 'tool-muted');
    const go = element('button', 'tool-btn tool-btn-primary', 'Send to NCBI BLAST');
    go.type = 'button';
    const refresh = function () {
      info.textContent = 'It sends ' + region(editor).label + ' to blast.ncbi.nlm.nih.gov, which opens in a new tab.';
    };
    refresh();
    // the selection changes while the panel is open
    const timer = window.setInterval(function () {
      if (!document.body.contains(info)) {
        window.clearInterval(timer);
        return;
      }
      refresh();
    }, 800);
    go.addEventListener('click', function () {
      const part = region(editor);
      if (part.bases.length < 20) {
        info.textContent = 'The sequence is too short to look for (at least 20 bases).';
        return;
      }
      if (part.bases.length > MAX_BASES) {
        info.textContent = 'The sequence is too long for BLAST on the web (' + MAX_BASES + ' bases at most): select a part of it.';
        return;
      }
      send(program.value, part.bases, entryName);
    });
    box.append(program, go, info);
    return box;
  }

  window.BlastTool = { section: section };
})();

window.ToolsTab && window.ToolsTab.add({ id: 'blast', title: 'BLAST: look for similar sequences', build: function (editor, context) {
  return window.BlastTool.section(editor, context.name || 'sequence');
} });
