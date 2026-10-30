/**
 * The primers panel of the sequence editor, like the oligos of a sequence in Benchling:
 * - Primers: search the database and attach a primer to the sequence, see where each binds, find the primers that bind,
 *   detach, order, add the primers designed in the file to the database, make a primer from the selection;
 * - Design: primer pairs for the selected region, ranked, to add to the database.
 * The primers attached to the entry are drawn on the map (temporary annotations, not saved in the file).
 * Needs primer-tools.js and primer-design.js. Exposed as window.PrimerPanel.
 */
(function () {
  'use strict';
  const tools = window.PrimerTools;
  const designer = window.PrimerDesign;

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

  function setup(editor, context) {
    const menu = document.getElementById('primers-menu');
    if (!tools || !menu) {
      return;
    }
    const entryId = context.entryId || 0;
    const button = element('button', 'cutter-button primers-button', 'Primers');
    button.type = 'button';
    const panel = element('div');
    panel.id = 'primers-panel';
    panel.hidden = true;
    menu.append(button);
    document.body.append(panel);

    let databasePrimers = null;
    let attachedPrimers = [];
    let tab = 'primers';
    // where the primers searched bind, relative to the selection
    let whereFilter = 'anywhere';
    // what is drawn on the map: the attached primers and the pair being looked at, none of it is saved in the file
    let attachedDrawn = {};
    let designDrawn = {};
    let designResult = null;
    let designOptions = Object.assign({}, designer ? designer.defaults : {});

    const current = function () {
      const data = editor.getState().sequenceData;
      return { sequence: String(data.sequence || ''), circular: !!data.circular, data: data, name: data.name || context.fileName || 'sequence' };
    };

    const annotation = function (id, name, start, end, forward, length) {
      return { id: id, name: name, type: 'primer', start: start % length, end: end % length, forward: forward, strand: forward ? 1 : -1 };
    };

    const redraw = function () {
      editor.updateEditor({ temporaryAnnotations: { primers: Object.assign({}, attachedDrawn, designDrawn) }, annotationVisibility: { primers: true } });
    };

    async function loadAttached() {
      if (!entryId) {
        attachedPrimers = [];
        attachedDrawn = {};
        redraw();
        return;
      }
      const state = await tools.attached(entryId);
      attachedPrimers = state.primers;
      const now = current();
      attachedDrawn = {};
      attachedPrimers.forEach(function (primer) {
        tools.findSites(now.sequence, primer.sequence, now.circular).forEach(function (site, index) {
          const id = 'dbprimer-' + primer.id + '-' + index;
          attachedDrawn[id] = annotation(id, primer.title, site.start, site.end - 1, site.forward, now.sequence.length);
        });
      });
      redraw();
    }

    const siteText = function (site) {
      return (site.start + 1) + '..' + site.end + (site.forward ? ' (+)' : ' (−)') + (site.mismatches > 0 ? ' ' + site.mismatches + ' mism.' : '');
    };

    const select = function (site) {
      editor.updateEditor({ selectionLayer: { start: site.start, end: site.end - 1 } });
    };

    // the bases of a primer annotated in the file or selected: the reverse strand gives the reverse complement
    const basesOf = function (sequence, start, end, forward) {
      const span = start <= end ? sequence.slice(start, end + 1) : sequence.slice(start) + sequence.slice(0, end + 1);
      return forward ? span : tools.reverseComplement(span);
    };

    const known = function (bases) {
      const clean = tools.clean(bases);
      const reverse = tools.reverseComplement(clean);
      return (databasePrimers || []).find(function (p) {
        return p.sequence === clean || p.sequence === reverse;
      });
    };

    const message = element('p', 'primers-message');
    const say = function (text, error) {
      message.textContent = text;
      message.className = 'primers-message' + (error ? ' error' : '');
    };

    // a primer as a card: name, sequence, size, Tm and GC, the places where it binds as tags, and the buttons
    function card(primer, sites, buttons) {
      const box = element('div', 'primers-card');
      const top = element('div', 'primers-card-top');
      top.append(element('strong', 'primers-card-name', primer.title));
      const chips = element('span', 'primers-chips');
      [primer.category && !/^primers?$/i.test(primer.category) ? primer.category.replace(/s$/i, '') : '', primer.sequence.length + ' bases', 'Tm ' + tools.tm(primer.sequence) + '\u00b0C', 'GC ' + tools.gc(primer.sequence) + '%'].forEach(function (text) {
        chips.append(element('span', 'primers-chip', text));
      });
      top.append(chips);
      box.append(top, element('code', 'primers-card-seq', primer.sequence));
      const foot = element('div', 'primers-card-foot');
      const places = element('span', 'primers-places');
      if (sites.length === 0) {
        places.append(element('span', 'primers-tag primers-tag-bad', 'does not bind this sequence'));
      }
      sites.forEach(function (site) {
        const tag = element('button', 'primers-tag primers-tag-site', (site.start + 1) + '..' + site.end + (site.forward ? ' \u2192' : ' \u2190') + (site.mismatches > 0 ? ' \u00b7 ' + site.mismatches + ' mismatch' + (site.mismatches > 1 ? 'es' : '') : ''));
        tag.type = 'button';
        tag.title = 'Select this binding site';
        tag.addEventListener('click', function () {
          select(site);
        });
        places.append(tag);
      });
      foot.append(places);
      const actions = element('span', 'primers-actions');
      buttons.forEach(function (b) {
        actions.append(b);
      });
      foot.append(actions);
      box.append(foot);
      return box;
    }

    const action = function (label, handler, kind) {
      const b = element('button', 'primers-btn' + (kind ? ' primers-btn-' + kind : ''), label);
      b.type = 'button';
      b.addEventListener('click', handler);
      return b;
    };

    async function attach(primer) {
      try {
        await tools.attach(entryId, primer.id);
        await loadAttached();
        await render();
      } catch (error) {
        say(error.message || String(error), true);
      }
    }

    // ---- the Primers tab
    async function renderPrimersTab() {
      const now = current();
      const attachedIds = new Set(attachedPrimers.map(function (p) {
        return p.id;
      }));

      panel.append(element('h4', '', 'On this sequence'));
      if (attachedPrimers.length === 0) {
        panel.append(element('p', 'primers-muted', entryId ? 'No primer is attached yet. Search the database below.' : 'Open a plasmid of the database to attach primers to it.'));
      }
      attachedPrimers.forEach(function (primer) {
        const sites = tools.findSites(now.sequence, primer.sequence, now.circular);
        panel.append(card(primer, sites, [
          action('Order', function () {
            tools.sendToOrder([primer.id]);
          }),
          action('Detach', async function () {
            try {
              await tools.detach(entryId, primer.id);
              await loadAttached();
              await render();
            } catch (error) {
              say(error.message || String(error), true);
            }
          }, 'quiet'),
        ]));
      });

      // search the database: by name or sequence, and by where the primers bind relative to the selection
      panel.append(element('h4', '', 'Add a primer of the database'));
      const search = element('input', 'primers-name');
      search.type = 'search';
      search.placeholder = 'Name or sequence...';
      const where = element('select', 'primers-name primers-where');
      [['anywhere', 'Binding anywhere'], ['inside', 'Binding inside the selection'], ['outside', 'Binding, but not inside the selection'], ['nowhere', 'Not binding this sequence']].forEach(function (choice) {
        const option = element('option', '', choice[1]);
        option.value = choice[0];
        where.append(option);
      });
      where.value = whereFilter;
      const selection = editor.getState().selectionLayer || { start: -1, end: -1 };
      const hasSelection = selection.start >= 0 && selection.end >= selection.start;
      const insideSelection = function (site) {
        return hasSelection && site.start >= selection.start && site.end - 1 <= selection.end;
      };
      const results = element('div', 'primers-results');
      const showResults = function () {
        const term = search.value.trim().toLowerCase();
        results.textContent = '';
        if (term === '' && whereFilter === 'anywhere') {
          return;
        }
        if ((whereFilter === 'inside' || whereFilter === 'outside') && !hasSelection) {
          results.append(element('p', 'primers-muted', 'Select a region of the sequence first.'));
          return;
        }
        const list = (databasePrimers || []).filter(function (primer) {
          if (attachedIds.has(primer.id)) {
            return false;
          }
          if (term !== '' && primer.title.toLowerCase().indexOf(term) === -1 && primer.sequence.toLowerCase().indexOf(term) === -1) {
            return false;
          }
          const sites = tools.findSites(now.sequence, primer.sequence, now.circular);
          switch (whereFilter) {
          case 'inside': return sites.some(insideSelection);
          case 'outside': return sites.length > 0 && !sites.some(insideSelection);
          case 'nowhere': return sites.length === 0;
          default: return true;
          }
        }).slice(0, 25);
        list.forEach(function (primer) {
          const sites = tools.findSites(now.sequence, primer.sequence, now.circular);
          results.append(card(primer, sites, entryId ? [action('Attach', function () {
            attach(primer);
          }, 'primary')] : []));
        });
        if (list.length === 0) {
          results.append(element('p', 'primers-muted', 'Nothing found.'));
        }
      };
      search.addEventListener('input', showResults);
      where.addEventListener('change', function () {
        whereFilter = where.value;
        showResults();
      });
      const searchRow = element('div', 'primers-row');
      searchRow.append(search, where);
      panel.append(searchRow, results);
      showResults();

      // the primers annotated in the file, not in the database yet
      const own = Object.values(now.data.primers || {});
      if (own.length > 0) {
        panel.append(element('h4', '', 'Primers designed in this file'));
      }
      own.forEach(function (primer) {
        const forward = primer.forward !== false && primer.strand !== -1;
        const bases = basesOf(now.sequence, primer.start, primer.end, forward);
        const inDatabase = known(bases);
        const row = element('div', 'primers-row');
        row.append(element('strong', '', primer.name || 'primer'), element('span', 'primers-muted', bases.length + ' bases'));
        if (inDatabase) {
          const link = element('a', 'primers-muted', 'in the database: ' + inDatabase.title);
          link.href = '../registry.php?mode=view&id=' + inDatabase.id;
          link.target = '_blank';
          row.append(link);
        } else {
          const add = element('button', 'cutter-button', 'Add to the database');
          add.type = 'button';
          add.addEventListener('click', function () {
            addToDatabase(add, primer.name || 'primer', bases, forward);
          });
          row.append(add);
        }
        panel.append(row);
      });

      // a primer from the bases selected on the sequence
      panel.append(element('h4', '', 'New primer from the selection'));
      if (!hasSelection) {
        panel.append(element('p', 'primers-muted', 'Select the bases of the primer on the sequence first.'));
      } else {
        const reverse = element('input');
        reverse.type = 'checkbox';
        const reverseLabel = element('label', 'primers-muted');
        reverseLabel.append(reverse, document.createTextNode(' reverse primer'));
        const name = element('input', 'primers-name');
        name.type = 'text';
        name.placeholder = 'Name of the primer';
        const info = element('span', 'primers-muted');
        const refresh = function () {
          const bases = basesOf(now.sequence, selection.start, selection.end, !reverse.checked);
          info.textContent = bases.length + ' bases, Tm ' + tools.tm(bases) + '°C, GC ' + tools.gc(bases) + '%' + (bases.length < tools.minLength ? ' (too short)' : '');
        };
        reverse.addEventListener('change', refresh);
        refresh();
        const add = element('button', 'cutter-button', 'Add to the database');
        add.type = 'button';
        add.addEventListener('click', function () {
          const bases = basesOf(now.sequence, selection.start, selection.end, !reverse.checked);
          if (bases.length < tools.minLength) {
            say('A primer has at least ' + tools.minLength + ' bases.', true);
            return;
          }
          const title = name.value.trim() || (now.name + (reverse.checked ? '-R-' : '-F-') + (selection.start + 1));
          addToDatabase(add, title, bases, !reverse.checked);
        });
        const row = element('div', 'primers-row');
        row.append(name, info, reverseLabel, add);
        panel.append(row);
      }
    }

    // a new primer in the database, attached to this sequence
    async function addToDatabase(addButton, title, bases, forward) {
      const existing = known(bases);
      if (existing) {
        say('This primer is already in the database: ' + existing.title + '.', true);
        return null;
      }
      addButton.disabled = true;
      try {
        const id = await tools.createPrimer(title, bases, forward, current().name);
        if (entryId) {
          await tools.attach(entryId, id);
        }
        databasePrimers = null;
        await loadAttached();
        await render();
        return id;
      } catch (error) {
        say(error.message || String(error), true);
        addButton.disabled = false;
        return null;
      }
    }

    // ---- the Design tab
    function renderDesignTab() {
      const now = current();
      const selection = editor.getState().selectionLayer || { start: -1, end: -1 };
      const hasSelection = selection.start >= 0 && selection.end >= 0 && selection.end >= selection.start;
      const start = hasSelection ? selection.start : 0;
      const end = hasSelection ? selection.end : now.sequence.length - 1;
      panel.append(element('h4', '', 'Region to amplify'));
      panel.append(element('p', 'primers-muted', hasSelection
        ? 'The selection: ' + (start + 1) + '..' + (end + 1) + ' (' + (end - start + 1) + ' bases).'
        : 'No selection: the whole sequence (' + now.sequence.length + ' bases). Select a region to design primers for it.'));

      const form = element('div', 'primers-form');
      const field = function (label, input) {
        const wrap = element('label', 'primers-field');
        wrap.append(element('span', '', label), input);
        form.append(wrap);
        return input;
      };
      const number = function (value, min, max) {
        const input = element('input', 'primers-name');
        input.type = 'number';
        input.value = String(value);
        input.min = String(min);
        input.max = String(max);
        return input;
      };
      const mode = element('select', 'primers-name');
      [['exact', 'The primers start at the ends of the region'], ['flank', 'The primers can start around the region']].forEach(function (choice) {
        const option = element('option', '', choice[1]);
        option.value = choice[0];
        mode.append(option);
      });
      mode.value = designOptions.mode;
      field('Where', mode);
      const flank = field('Room around the region (bases)', number(designOptions.flank, 0, 500));
      const tm = field('Wanted Tm (°C)', number(designOptions.optimalTm, 40, 80));
      const minLength = field('Shortest primer', number(designOptions.minLength, 12, 40));
      const maxLength = field('Longest primer', number(designOptions.maxLength, 14, 60));
      const tailF = field("5' tail of the forward primer", element('input', 'primers-name'));
      tailF.value = designOptions.tailForward || '';
      tailF.placeholder = 'a restriction site, an overlap...';
      const tailR = field("5' tail of the reverse primer", element('input', 'primers-name'));
      tailR.value = designOptions.tailReverse || '';
      tailR.placeholder = 'a restriction site, an overlap...';
      panel.append(form);

      const run = element('button', 'cutter-button primers-primary', 'Design primers');
      run.type = 'button';
      run.addEventListener('click', function () {
        designOptions = Object.assign({}, designOptions, {
          mode: mode.value,
          flank: Number(flank.value) || 0,
          optimalTm: Number(tm.value) || 60,
          minLength: Number(minLength.value) || 18,
          maxLength: Number(maxLength.value) || 30,
          tailForward: tools.clean(tailF.value),
          tailReverse: tools.clean(tailR.value),
        });
        designOptions.minTm = designOptions.optimalTm - 5;
        designOptions.maxTm = designOptions.optimalTm + 5;
        run.disabled = true;
        run.textContent = 'Designing...';
        // the work is a moment of calculation: let the button change first
        window.setTimeout(function () {
          designResult = designer.design(now.sequence, start, end, now.circular, designOptions);
          designResult.region = { start: start, end: end };
          designDrawn = {};
          render();
        }, 30);
      });
      panel.append(run);

      if (designResult) {
        panel.append(element('h4', '', 'Primer pairs'));
        if (designResult.error) {
          panel.append(element('p', 'primers-warning', designResult.error));
        } else if (designResult.pairs.length === 0) {
          panel.append(element('p', 'primers-muted', 'No pair found: widen the range of lengths or of Tm.'));
        }
        designResult.pairs.forEach(function (pair, index) {
          const card = element('div', 'primers-pair');
          const head = element('div', 'primers-row');
          head.append(element('strong', '', 'Pair ' + (index + 1)), element('span', 'primers-muted', 'product ' + pair.product + ' bp'));
          const show = element('button', 'cutter-button', 'Show on the map');
          show.type = 'button';
          show.addEventListener('click', function () {
            const length = now.sequence.length;
            designDrawn = {
              'design-f': annotation('design-f', 'F ' + (pair.forward.start + 1), pair.forward.start, pair.forward.end, true, length),
              'design-r': annotation('design-r', 'R ' + (pair.reverse.end + 1), pair.reverse.start, pair.reverse.end, false, length),
            };
            redraw();
          });
          head.append(show);
          card.append(head);
          [['F', pair.forward], ['R', pair.reverse]].forEach(function (item) {
            const line = element('div', 'primers-line');
            line.append(element('span', 'primers-dir', item[0]));
            const tail = item[0] === 'F' ? designOptions.tailForward : designOptions.tailReverse;
            const sequence = element('code', 'primers-sequence');
            sequence.textContent = tail ? tail + ' ' + item[1].core : item[1].core;
            line.append(sequence, element('span', 'primers-muted', item[1].core.length + ' bases, Tm ' + item[1].tm + '°C, GC ' + item[1].gc + '%'));
            card.append(line);
            if (item[1].notes.length > 0) {
              card.append(element('div', 'primers-warning', item[1].notes.join('; ')));
            }
          });
          if (pair.notes.length > 0) {
            card.append(element('div', 'primers-warning', pair.notes.join('; ')));
          }
          const add = element('button', 'cutter-button primers-primary', 'Add both to the database');
          add.type = 'button';
          add.addEventListener('click', async function () {
            add.disabled = true;
            const base = now.name + '-' + (pair.forward.start + 1) + '-' + (pair.reverse.end + 1);
            const first = await addToDatabase(add, base + '-F', pair.forward.sequence, true);
            if (first !== null) {
              await addToDatabase(add, base + '-R', pair.reverse.sequence, false);
            }
          });
          card.append(add);
          panel.append(card);
        });
      }
    }

    async function render() {
      panel.textContent = '';
      if (databasePrimers === null) {
        databasePrimers = await tools.allPrimers().catch(function () {
          return [];
        });
      }
      const header = element('div', 'primers-header');
      header.append(element('strong', 'primers-title', 'Primers'));
      const close = element('button', 'primers-close', '\u00d7');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', function () {
        panel.hidden = true;
      });
      header.append(close);
      panel.append(header);
      const tabs = element('div', 'primers-tabs');
      [['primers', 'Primers'], ['design', 'Design']].forEach(function (item) {
        const tabButton = element('button', 'primers-tab', item[1]);
        tabButton.type = 'button';
        tabButton.setAttribute('aria-pressed', tab === item[0] ? 'true' : 'false');
        tabButton.addEventListener('click', function () {
          tab = item[0];
          render();
        });
        tabs.append(tabButton);
      });
      panel.append(tabs);
      if (tab === 'design' && designer) {
        renderDesignTab();
      } else {
        await renderPrimersTab();
      }
      panel.append(message);
    }

    button.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        say('');
        render();
      }
    });
    // the primers of the plasmid are drawn from the start
    loadAttached().catch(function () {
      // the map just has no database primers
    });
  }

  window.PrimerPanel = { setup: setup };
})();
