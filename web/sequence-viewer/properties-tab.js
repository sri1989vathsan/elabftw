/**
 * The properties tool of the sidebar: the name of the entry and of the sequence, its description and its form (circular or linear),
 * which can be changed unless the entry is locked or read only; and the downloads: the sequence as a GenBank or FASTA file, and the
 * alignments kept with the entry (Clustal files and the summary of the reads). Exposed as window.PropertiesTab.
 */
(function () {
  'use strict';

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

  const saveFile = function (name, text) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 1000);
  };

  function setup(editor, context) {
    if (!window.ToolSidebar || (!context.entryId && !context.scratch)) {
      return;
    }
    const csrf = document.body.dataset.csrf || '';
    let panel = null;

    const safeName = function (text) {
      return String(text || 'sequence').replace(/[^A-Za-z0-9_.+() -]+/g, '_').slice(0, 60) || 'sequence';
    };
    const cleanData = function () {
      const data = editor.getState().sequenceData;
      return window.ViewerClean ? window.ViewerClean(data) : JSON.parse(JSON.stringify(data));
    };

    async function alignments() {
      try {
        const response = await fetch('../api/v2/inventory/' + context.entryId + '/uploads', { credentials: 'same-origin' });
        if (!response.ok) {
          return [];
        }
        const newest = new Map();
        (await response.json()).forEach(function (upload) {
          if (/\.(aln|clustal|clw)$/i.test(upload.real_name) || upload.real_name === 'alignments.json') {
            const earlier = newest.get(upload.real_name);
            if (!earlier || Number(upload.id) > Number(earlier.id)) {
              newest.set(upload.real_name, upload);
            }
          }
        });
        return Array.from(newest.values());
      } catch (error) {
        return [];
      }
    }

    function field(label, input) {
      const row = element('label', 'props-field');
      row.append(element('span', 'props-label', label), input);
      return row;
    }

    function render() {
      if (!panel || window.ToolSidebar.active() !== 'properties') {
        return;
      }
      panel.textContent = '';
      const data = editor.getState().sequenceData;
      const editable = context.canWrite || !!context.scratch;
      const message = element('p', 'tool-message', '');
      if (!editable) {
        panel.append(element('p', 'tool-muted', context.locked() ? 'This entry is locked: unlock it to change its properties. The downloads work.' : 'You cannot edit this entry. The downloads work.'));
      }

      // the name of the entry in the Database, saved with its own button
      const title = element('input', 'tool-input props-input');
      title.type = 'text';
      title.value = (document.getElementById('entry-title') || {}).textContent || context.title || '';
      title.disabled = !editable;
      const rename = element('button', 'tool-btn', context.scratch ? 'Rename the tab' : 'Rename the entry');
      rename.type = 'button';
      rename.disabled = !editable;
      rename.addEventListener('click', async function () {
        const value = title.value.trim();
        if (value === '') {
          message.textContent = 'The name cannot be empty.';
          return;
        }
        rename.disabled = true;
        if (context.scratch) {
          // a sequence that is not in the Database: only the name of the tab changes
          const shown = document.getElementById('entry-title');
          if (shown) {
            shown.textContent = value;
          }
          message.textContent = 'The tab is called ' + value + '.';
          rename.disabled = false;
          return;
        }
        try {
          const response = await fetch('../api/v2/inventory/' + context.entryId, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            body: JSON.stringify({ title: value }),
          });
          if (!response.ok) {
            throw new Error('The entry could not be renamed (' + response.status + ').');
          }
          const shown = document.getElementById('entry-title');
          if (shown) {
            shown.textContent = value;
          }
          message.textContent = 'The entry is called ' + value + '.';
        } catch (error) {
          message.textContent = error.message || String(error);
        }
        rename.disabled = !editable;
      });

      // what the file itself holds: changes go to the editor and are saved like any other edit
      const name = element('input', 'tool-input props-input');
      name.type = 'text';
      name.value = data.name || '';
      name.disabled = !editable;
      const description = element('textarea', 'tool-input props-input props-text');
      description.rows = 3;
      description.value = data.description || '';
      description.disabled = !editable;
      const apply = function (change, text) {
        editor.updateEditor({ sequenceData: Object.assign({}, editor.getState().sequenceData, change) });
        message.textContent = text;
      };
      name.addEventListener('change', function () {
        apply({ name: name.value.trim().replace(/\s+/g, '_') }, 'The sequence is called ' + (name.value.trim() || '(no name)') + '. It is saved in a moment.');
      });
      description.addEventListener('change', function () {
        apply({ description: description.value }, 'The description is changed. It is saved in a moment.');
      });

      const form = element('select', 'tool-input props-input');
      [['circular', 'Circular'], ['linear', 'Linear']].forEach(function (item) {
        form.append(Object.assign(element('option', '', item[1]), { value: item[0] }));
      });
      form.value = data.circular ? 'circular' : 'linear';
      form.disabled = !editable;
      form.addEventListener('change', function () {
        apply({ circular: form.value === 'circular' }, 'The sequence is ' + form.value + '. It is saved in a moment.');
      });

      panel.append(
        field(context.scratch ? 'Name of the tab' : 'Entry name', title),
        element('div', 'tool-actions').appendChild(rename).parentNode,
        field('Sequence name', name),
        field('Description', description),
        field('Form', form),
        element('p', 'tool-muted', data.sequence.length + ' bp'),
        message
      );

      // downloads
      panel.append(element('strong', 'props-heading', 'Download the sequence'));
      const files = element('div', 'tool-actions');
      const customId = document.body.dataset.customId || '';
      const base = (customId ? customId + '_' : '') + safeName(data.name || context.fileName().replace(/\.[^.]+$/, ''));
      const genbank = element('button', 'tool-btn tool-btn-primary', 'GenBank (.gb)');
      genbank.type = 'button';
      genbank.addEventListener('click', function () {
        const copy = cleanData();
        saveFile(base + '.gb', window.bioParsers.jsonToGenbank(copy));
      });
      const fasta = element('button', 'tool-btn', 'FASTA (.fa)');
      fasta.type = 'button';
      fasta.addEventListener('click', function () {
        saveFile(base + '.fa', window.bioParsers.jsonToFasta(cleanData()));
      });
      files.append(genbank, fasta);
      panel.append(files);

      if (context.scratch) {
        // not in the Database: it can be saved as an entry in one of your folders
        panel.append(element('strong', 'props-heading', 'Save it in the Database'));
        const holder = element('div');
        panel.append(holder);
        if (window.ToolsPcr && window.ToolsPcr.saveEntryForm) {
          window.ToolsPcr.saveEntryForm(holder, {
            plasmid: !!editor.getState().sequenceData.circular,
            name: (document.getElementById('entry-title') || {}).textContent || base,
            genbank: function (fileName) {
              return window.bioParsers.jsonToGenbank(Object.assign(cleanData(), { name: fileName }));
            },
            parents: context.parent ? [context.parent] : [],
            parentLabel: 'Made from the plasmid it came from',
            primers: [],
            primersLabel: 'Attach primers',
            saveLabel: 'Save as an entry',
          });
        }
        return;
      }
      panel.append(element('strong', 'props-heading', 'Alignments of this entry'));
      const list = element('div', 'tool-results');
      list.append(element('p', 'tool-muted', 'Looking for alignments...'));
      panel.append(list);
      alignments().then(function (found) {
        list.textContent = '';
        if (found.length === 0) {
          list.append(element('p', 'tool-muted', 'None kept with this entry yet: align reads in the Align tool and save the alignment.'));
          return;
        }
        found.forEach(function (upload) {
          const link = element('a', 'tool-btn', upload.real_name);
          link.href = '../app/download.php?' + new URLSearchParams({ f: upload.long_name, name: upload.real_name, storage: String(upload.storage) }).toString();
          link.download = upload.real_name;
          list.append(link);
        });
      });
    }

    window.ToolSidebar.register({ id: 'properties', icon: 'info', label: 'Properties and downloads', show: function (host) {
      panel = host;
      render();
    } });
  }

  window.PropertiesTab = { setup: setup };
})();
