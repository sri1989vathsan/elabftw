/**
 * The "Edit oligo" panel of the sidebar, opened from the right-click menu of a primer of the database on the map: its name, its
 * bases, the strand and place where it binds on this sequence (with the overhang), the length, GC content and melting
 * temperature, worked out again while the bases are changed. "Save to the database" changes the entry of the primer in the
 * Database to match (name, bases, orientation, melting temperature) and draws the map again.
 * Needs primer-tools.js and primers-panel.js. Exposed as window.OligoEditor.
 */
(function () {
  'use strict';
  let target = null;
  let host = null;

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

  const row = function (label, control) {
    const wrap = element('label', 'oligo-field');
    wrap.append(element('span', 'oligo-field-label', label), control);
    return wrap;
  };

  const COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G' };
  const reverseComplement = function (bases) {
    return bases.split('').reverse().map(function (b) {
      return COMPLEMENT[b] || 'N';
    }).join('');
  };

  async function render() {
    if (!host || !target) {
      return;
    }
    const tools = window.PrimerTools;
    const editor = window.sequenceEditor;
    host.textContent = '';
    host.append(element('p', 'tool-muted', 'Loading the primer...'));
    let entry;
    let me = null;
    try {
      entry = await tools.getPrimer(target.id);
      me = await tools.currentUserId();
    } catch (error) {
      host.textContent = '';
      host.append(element('p', 'tool-message error', error.message || String(error)));
      return;
    }
    host.textContent = '';
    const data = editor.getState().sequenceData;
    const plasmid = String(data.sequence || '').toUpperCase();
    const name = element('input', 'oligo-input');
    name.type = 'text';
    name.value = entry.title;
    const bases = element('textarea', 'oligo-input oligo-bases-input');
    bases.rows = 3;
    bases.spellcheck = false;
    bases.value = entry.sequence;
    const numberInput = function () {
      const input = element('input', 'oligo-input oligo-number');
      input.type = 'number';
      input.min = '1';
      input.max = String(plasmid.length);
      return input;
    };
    const startInput = numberInput();
    const endInput = numberInput();
    const strandForward = element('input');
    strandForward.type = 'radio';
    strandForward.name = 'oligo-strand';
    const strandReverse = element('input');
    strandReverse.type = 'radio';
    strandReverse.name = 'oligo-strand';
    const shown = element('div', 'oligo-shown');
    const facts = element('table', 'tools-table');
    const where = element('div', 'tool-tags');
    const message = element('p', 'tool-message');

    // where the bases bind best on this sequence: the start of the binding window, its end and the strand
    const place = function (site) {
      startInput.value = String(site.start + 1);
      endInput.value = String(site.end);
      strandForward.checked = site.forward;
      strandReverse.checked = !site.forward;
    };
    const sitesOf = function (sequence) {
      return sequence.length >= 10 ? tools.findSites(plasmid, sequence, !!data.circular) : [];
    };
    const best = function (sites) {
      return sites.slice().sort(function (a, b) {
        return a.mismatches - b.mismatches || b.length - a.length;
      })[0];
    };
    const first = best(sitesOf(tools.clean(entry.sequence)));
    if (first) {
      place(first);
    } else {
      startInput.value = '1';
      endInput.value = String(Math.min(plasmid.length, tools.clean(entry.sequence).length));
      strandForward.checked = true;
    }

    // the oligo is split by the window: the 3' end binds, what is before it (the 5' end) hangs over
    const state = function () {
      const sequence = tools.clean(bases.value);
      const start = Math.max(1, Math.min(plasmid.length, parseInt(startInput.value, 10) || 1));
      const end = Math.max(start, Math.min(plasmid.length, parseInt(endInput.value, 10) || start));
      const forward = strandForward.checked;
      const bound = Math.min(sequence.length, end - start + 1);
      const tail = sequence.length - bound;
      const top = plasmid.slice(start - 1, start - 1 + bound);
      const binding = sequence.slice(tail);
      const wanted = forward ? top : reverseComplement(top);
      let mismatches = Math.abs(binding.length - wanted.length);
      for (let i = 0; i < Math.min(binding.length, wanted.length); i++) {
        if (binding[i] !== wanted[i]) {
          mismatches++;
        }
      }
      return { sequence: sequence, start: start, end: start + bound - 1, forward: forward, bound: bound, tail: tail, mismatches: mismatches };
    };

    const update = function () {
      const now = state();
      // the oligo as it binds: the overhang in red, the binding part in a box
      shown.textContent = '';
      shown.append(element('span', 'oligo-shown-label', "5′"));
      if (now.tail > 0) {
        shown.append(element('span', 'oligo-overhang-text', now.sequence.slice(0, now.tail)));
      }
      shown.append(element('span', 'oligo-binding-text', now.sequence.slice(now.tail)));
      shown.append(element('span', 'oligo-shown-label', "3′"));
      facts.textContent = '';
      const add = function (label, value) {
        const tr = element('tr');
        tr.append(element('th', '', label), element('td', '', value));
        facts.append(tr);
      };
      add('Length', now.sequence.length + ' bases');
      add('Binding', now.bound + ' bases, ' + now.start + '..' + now.end + (now.forward ? ' (+)' : ' (−)'));
      add('Overhang', now.tail + ' bases');
      add('Mismatches', now.mismatches === 0 ? 'none' : String(now.mismatches));
      add('GC content', now.sequence.length ? tools.gc(now.sequence).toFixed(1) + ' %' : '-');
      const melting = tools.tm(now.sequence.slice(now.tail));
      add('Tm of the binding part', melting === null ? '-' : melting + ' °C');
      // other places where it binds
      where.textContent = '';
      sitesOf(now.sequence).slice(0, 6).forEach(function (site) {
        const b = element('button', 'tool-tag tool-tag-site', (site.start + 1) + '..' + site.end + (site.forward ? ' (+)' : ' (−)') + (site.tail ? ' overhang ' + site.tail : '') + (site.mismatches ? ' ' + site.mismatches + ' mism.' : ''));
        b.type = 'button';
        b.title = 'Move the oligo here';
        b.addEventListener('click', function () {
          place(site);
          update();
        });
        where.append(b);
      });
      // drawn on the map where it would bind
      if (window.PrimerPanel && window.PrimerPanel.setEdit) {
        window.PrimerPanel.setEdit(now.sequence.length >= 4 ? { name: name.value || 'oligo', start: now.start - 1, end: now.end - 1, forward: now.forward, tail: now.tail, bases: now.sequence } : null);
      }
    };
    [bases, startInput, endInput, strandForward, strandReverse, name].forEach(function (control) {
      control.addEventListener('input', update);
      control.addEventListener('change', update);
    });
    update();
    // the preview leaves the map when another panel opens or this one closes
    const watch = window.setInterval(function () {
      if (window.ToolSidebar.active() !== 'oligo' || !document.body.contains(bases)) {
        window.clearInterval(watch);
        if (window.PrimerPanel && window.PrimerPanel.setEdit) {
          window.PrimerPanel.setEdit(null);
        }
      }
    }, 500);

    const fit = element('button', 'tool-btn', 'Best fit');
    fit.type = 'button';
    fit.title = 'Put the binding window where the bases fit this sequence best';
    fit.addEventListener('click', function () {
      const site = best(sitesOf(tools.clean(bases.value)));
      if (site) {
        place(site);
        update();
      }
    });
    // only the owner of the primer can update it in the database (the server checks it too)
    const owner = Number(entry.userid) === Number(me);
    const save = element('button', 'tool-btn tool-btn-primary', 'Update primer');
    save.type = 'button';
    const open = element('a', 'tool-btn', 'Open the entry');
    open.href = '../registry.php?mode=view&id=' + target.id;
    open.target = '_blank';
    open.rel = 'noopener';
    if (!owner || entry.locked) {
      save.disabled = true;
      save.title = entry.locked ? 'The primer is locked' : 'Only the owner of the primer can update it';
      message.textContent = entry.locked ? 'This primer is locked in the Database, so it cannot be updated.' : 'This primer belongs to ' + (entry.owner || 'someone else') + ': only the owner can update it in the Database. You can still move the binding window here to look at it.';
      message.className = 'tool-message';
    }
    save.addEventListener('click', async function () {
      const now = state();
      if (!name.value.trim() || now.sequence.length === 0) {
        message.textContent = 'A name and some bases are needed.';
        message.className = 'tool-message error';
        return;
      }
      save.disabled = true;
      message.textContent = 'Saving...';
      message.className = 'tool-message';
      try {
        await tools.updatePrimer(target.id, { title: name.value.trim(), sequence: now.sequence, forward: now.forward });
        if (window.PrimerPanel && window.PrimerPanel.reload) {
          await window.PrimerPanel.reload();
        }
        message.textContent = 'Updated: the primer in the database is the same as here. Every sequence that uses it shows the new one.';
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'tool-message error';
      }
      save.disabled = !owner || entry.locked;
    });

    // a copy in the Database: a new primer with these bases, attached to this plasmid; the old one can leave the plasmid
    const copy = element('button', 'tool-btn', 'Save as new primer');
    copy.type = 'button';
    copy.title = 'Make a new primer in the Database with this name and these bases';
    const replace = element('input');
    replace.type = 'checkbox';
    replace.checked = !owner;
    const replaceLabel = element('label', 'oligo-replace', ' Take the old primer off this plasmid');
    replaceLabel.prepend(replace);
    copy.addEventListener('click', async function () {
      const now = state();
      const entryId = Number(document.body.dataset.entry);
      if (!name.value.trim() || now.sequence.length === 0) {
        message.textContent = 'A name and some bases are needed.';
        message.className = 'tool-message error';
        return;
      }
      if (name.value.trim() === entry.title) {
        message.textContent = 'Give the new primer a name of its own.';
        message.className = 'tool-message error';
        return;
      }
      copy.disabled = true;
      message.textContent = 'Saving...';
      message.className = 'tool-message';
      try {
        const id = await tools.createPrimer(name.value.trim(), now.sequence, now.forward, null, entryId);
        if (entryId) {
          await tools.attach(entryId, id);
          if (replace.checked) {
            await tools.detach(entryId, target.id);
          }
        }
        if (window.PrimerPanel && window.PrimerPanel.reload) {
          await window.PrimerPanel.reload();
        }
        target = { id: id };
        message.textContent = 'A new primer was made in the Database and attached to this plasmid' + (replace.checked ? ', the old one is off it.' : '.');
        await render();
        return;
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'tool-message error';
      }
      copy.disabled = false;
    });

    const strand = element('div', 'oligo-strand');
    const forwardLabel = element('label', '', ' Forward');
    forwardLabel.prepend(strandForward);
    const reverseLabel = element('label', '', ' Reverse');
    reverseLabel.prepend(strandReverse);
    strand.append(forwardLabel, reverseLabel);
    const window2 = element('div', 'oligo-window');
    window2.append(row('Binding start', startInput), row('Binding end', endInput));

    host.append(
      element('p', 'tool-muted', 'The bases bind with their 3′ end; what is before it hangs over. Move the binding window with its start and end, the overhang is what is left. It is drawn on the map in violet while you edit.'),
      row('Name', name),
      element('div', 'oligo-field-label', 'Oligo (overhang in red, binding part boxed)'),
      shown,
      row('Bases (5′ to 3′)', bases),
      element('div', 'oligo-field-label', 'Strand'),
      strand,
      window2,
      element('div', 'oligo-field-label', 'Binds this sequence at (click to move it there)'),
      where,
      facts,
      element('div', 'tool-actions'),
      message
    );
    host.querySelector('.tool-actions').append(save, copy, fit, open);
    host.append(replaceLabel);
  }

  function setup() {
    if (!window.ToolSidebar) {
      return;
    }
    window.ToolSidebar.register({ id: 'oligo', icon: 'primers', label: 'Edit oligo', hidden: true, show: function (node) {
      host = node;
      render();
    } });
  }

  window.OligoEditor = {
    setup: setup,
    open: function (id) {
      target = { id: id };
      window.ToolSidebar.open('oligo');
    },
  };
  setup();
})();
