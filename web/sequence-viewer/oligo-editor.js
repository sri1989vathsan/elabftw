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

  async function render() {
    if (!host || !target) {
      return;
    }
    const tools = window.PrimerTools;
    const editor = window.sequenceEditor;
    host.textContent = '';
    host.append(element('p', 'tool-muted', 'Loading the primer...'));
    let entry;
    try {
      entry = await tools.getPrimer(target.id);
    } catch (error) {
      host.textContent = '';
      host.append(element('p', 'tool-message error', error.message || String(error)));
      return;
    }
    host.textContent = '';
    const name = element('input', 'oligo-input');
    name.type = 'text';
    name.value = entry.title;
    const bases = element('textarea', 'oligo-input oligo-bases-input');
    bases.rows = 4;
    bases.spellcheck = false;
    bases.value = entry.sequence;
    const facts = element('table', 'tools-table');
    const where = element('div', 'tool-tags');
    const message = element('p', 'tool-message');
    let forward = null;

    const update = function () {
      const sequence = tools.clean(bases.value);
      facts.textContent = '';
      const add = function (label, value) {
        const tr = element('tr');
        tr.append(element('th', '', label), element('td', '', value));
        facts.append(tr);
      };
      add('Length', sequence.length + ' bases');
      add('GC content', sequence.length ? tools.gc(sequence).toFixed(1) + ' %' : '-');
      const melting = tools.tm(sequence);
      add('Tm', melting === null ? '-' : melting + ' °C');
      // where it binds on this sequence
      where.textContent = '';
      forward = null;
      const data = editor.getState().sequenceData;
      const sites = sequence.length >= 10 ? tools.findSites(String(data.sequence || ''), sequence, !!data.circular) : [];
      sites.slice(0, 6).forEach(function (site, index) {
        const b = element('button', 'tool-tag tool-tag-site', (site.start + 1) + '..' + site.end + (site.forward ? ' (+)' : ' (−)') + (site.tail ? ' overhang ' + site.tail : '') + (site.mismatches ? ' ' + site.mismatches + ' mism.' : ''));
        b.type = 'button';
        b.title = 'Select it on the sequence';
        b.addEventListener('click', function () {
          editor.updateEditor({ selectionLayer: { start: site.start, end: site.end - 1 } });
        });
        where.append(b);
        if (index === 0) {
          forward = site.forward;
        }
      });
      if (sites.length === 0) {
        where.append(element('span', 'tool-tag tool-tag-bad', sequence.length < 10 ? 'too short to bind' : 'does not bind this sequence'));
      }
    };
    bases.addEventListener('input', update);
    update();

    const save = element('button', 'tool-btn tool-btn-primary', 'Save to the database');
    save.type = 'button';
    const open = element('a', 'tool-btn', 'Open the entry');
    open.href = '../registry.php?mode=view&id=' + target.id;
    open.target = '_blank';
    open.rel = 'noopener';
    save.addEventListener('click', async function () {
      const sequence = tools.clean(bases.value);
      if (!name.value.trim() || sequence.length === 0) {
        message.textContent = 'A name and some bases are needed.';
        message.className = 'tool-message error';
        return;
      }
      save.disabled = true;
      message.textContent = 'Saving...';
      message.className = 'tool-message';
      try {
        await tools.updatePrimer(target.id, { title: name.value.trim(), sequence: sequence, forward: forward });
        if (window.PrimerPanel && window.PrimerPanel.reload) {
          await window.PrimerPanel.reload();
        }
        message.textContent = 'Saved: the primer in the database is the same as here. Every sequence that uses it shows the new one.';
      } catch (error) {
        message.textContent = error.message || String(error);
        message.className = 'tool-message error';
      }
      save.disabled = false;
    });

    host.append(
      element('p', 'tool-muted', 'Change the name or the bases of the primer. Saving changes the primer in the Database, so it is the same everywhere it is used.'),
      row('Name', name),
      row('Bases (5′ to 3′)', bases),
      element('div', 'oligo-field-label', 'Binds this sequence at'),
      where,
      facts,
      element('div', 'tool-actions'),
      message
    );
    host.querySelector('.tool-actions').append(save, open);
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
