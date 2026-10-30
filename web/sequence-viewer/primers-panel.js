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
    if (!tools || !window.ToolSidebar) {
      return;
    }
    const entryId = context.entryId || 0;
    // the area of the sidebar that is shown: the primers and the design are two of its tabs
    let panel = element('div');

    let databasePrimers = null;
    // the choices of the search for candidates
    let candidatePrefs = { scope: 'selection', mismatches: '1' };
    let attachedPrimers = [];
    let tab = 'primers';
    // where the primers searched bind, relative to the selection
    let whereFilter = 'anywhere';
    // the part of the Primers tab that is open: attached, search or file
    let subTab = null;
    // what is drawn on the map: the attached primers and the pair being looked at, none of it is saved in the file
    let attachedDrawn = {};
    let designDrawn = {};
    // the primers of the search results, drawn where they bind so they can be looked at before they are attached
    let previewDrawn = {};
    let designResult = null;
    let designOptions = Object.assign({}, designer ? designer.defaults : {});

    // where a primer binds is worked out once for a sequence: the search, the preview and the candidates ask for it again and
    // again while the user types, with thousands of primers and a long sequence
    let sitesFor = { sequence: null, circular: null, byPrimer: new Map() };
    const findSitesCached = function (sequence, primerSequence, circular) {
      if (sitesFor.sequence !== sequence || sitesFor.circular !== circular) {
        sitesFor = { sequence: sequence, circular: circular, byPrimer: new Map() };
      }
      let sites = sitesFor.byPrimer.get(primerSequence);
      if (sites === undefined) {
        sites = tools.findSites(sequence, primerSequence, circular);
        sitesFor.byPrimer.set(primerSequence, sites);
      }
      return sites;
    };

    const current = function () {
      const data = editor.getState().sequenceData;
      return { sequence: String(data.sequence || ''), circular: !!data.circular, data: data, name: data.name || context.fileName || 'sequence' };
    };

    const annotation = function (id, name, start, end, forward, length) {
      return { id: id, name: name, type: 'primer', start: start % length, end: end % length, forward: forward, strand: forward ? 1 : -1 };
    };

    const redraw = function () {
      editor.updateEditor({ temporaryAnnotations: { primers: Object.assign({}, previewDrawn, attachedDrawn, designDrawn) }, annotationVisibility: { primers: true } });
    };

    // draws the binding sites of some primers of the database as a preview (not saved, not attached)
    const preview = function (primers) {
      const now = current();
      previewDrawn = {};
      primers.slice(0, 40).forEach(function (primer) {
        findSitesCached(now.sequence, primer.sequence, now.circular).forEach(function (site, index) {
          const id = 'preview-' + primer.id + '-' + index;
          previewDrawn[id] = Object.assign(annotation(id, primer.title + ' (candidate)', site.start, site.end - 1, site.forward, now.sequence.length), { color: '#e8890c' });
        });
      });
      redraw();
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
        findSitesCached(now.sequence, primer.sequence, now.circular).forEach(function (site, index) {
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
      // the preview belongs to the results of the last search: a new view starts without it
      if (Object.keys(previewDrawn).length > 0) {
        previewDrawn = {};
        redraw();
      }
      const attachedIds = new Set(attachedPrimers.map(function (p) {
        return p.id;
      }));
      const sectionAttached = element('div', 'primers-section');
      const sectionSearch = element('div', 'primers-section');
      const sectionFile = element('div', 'primers-section');

      sectionAttached.append(element('h4', '', 'On this sequence'));
      if (attachedPrimers.length === 0) {
        sectionAttached.append(element('p', 'primers-muted', entryId ? 'No primer is attached yet. Use the Find and add tab.' : 'Open a plasmid of the database to attach primers to it.'));
      }
      // the attached primers can be ticked, to send them to an order or to detach them together
      const ticked = new Set();
      const attachedBoxes = [];
      if (attachedPrimers.length > 1 || (attachedPrimers.length === 1 && entryId)) {
        const bar = element('div', 'primers-pickbar');
        const everything = element('input');
        everything.type = 'checkbox';
        everything.setAttribute('aria-label', 'Select all the attached primers');
        everything.addEventListener('change', function () {
          attachedBoxes.forEach(function (box) {
            box.checked = everything.checked;
            box.dispatchEvent(new Event('change'));
          });
        });
        const orderTicked = action('', function () {
          tools.sendToOrder(Array.from(ticked), function () {
            render();
          });
        }, 'primary');
        const detachTicked = action('', async function () {
          orderTicked.disabled = true;
          detachTicked.disabled = true;
          try {
            for (const id of Array.from(ticked)) {
              await tools.detach(entryId, id);
            }
          } catch (error) {
            say(error.message || String(error), true);
          }
          await loadAttached();
          await render();
        }, 'quiet');
        const refreshTicked = function () {
          orderTicked.textContent = 'Order the ' + ticked.size + ' selected';
          detachTicked.textContent = 'Detach the ' + ticked.size + ' selected';
          orderTicked.disabled = ticked.size === 0;
          detachTicked.disabled = ticked.size === 0 || !entryId;
          everything.checked = ticked.size === attachedPrimers.length && ticked.size > 0;
        };
        bar.append(everything, element('span', 'primers-muted', 'Select all'), orderTicked, detachTicked);
        sectionAttached.append(bar);
        refreshTicked();
        attachedPrimers.forEach(function (primer) {
          const sites = findSitesCached(now.sequence, primer.sequence, now.circular);
          const holder = element('div', 'primers-pick');
          const box = element('input');
          box.type = 'checkbox';
          box.setAttribute('aria-label', 'Select ' + primer.title);
          box.addEventListener('change', function () {
            if (box.checked) {
              ticked.add(primer.id);
            } else {
              ticked.delete(primer.id);
            }
            refreshTicked();
          });
          attachedBoxes.push(box);
          holder.append(box, card(primer, sites, [
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
          sectionAttached.append(holder);
        });
      }

      // search the database: by name or sequence, and by where the primers bind relative to the selection
      sectionSearch.append(element('h4', '', 'Add a primer of the database'));
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
      // a list of primers as cards the user can tick, to attach several together
      const renderList = function (list) {
        preview(list);
        // the ones that are ticked can be attached together
        const picked = new Set();
        const attachPicked = action('', async function () {
          attachPicked.disabled = true;
          try {
            for (const id of Array.from(picked)) {
              await tools.attach(entryId, id);
            }
          } catch (error) {
            say(error.message || String(error), true);
          }
          await loadAttached();
          await render();
        }, 'primary');
        const refreshPicked = function () {
          // what is ticked is drawn on the map; without a tick, all the results are
          preview(picked.size > 0 ? list.filter(function (p) {
            return picked.has(p.id);
          }) : list);
          attachPicked.textContent = 'Attach the ' + picked.size + ' selected';
          attachPicked.disabled = picked.size === 0;
        };
        const boxes = [];
        if (entryId && list.length > 0) {
          const all = element('input');
          all.type = 'checkbox';
          all.setAttribute('aria-label', 'Select all of the results');
          all.addEventListener('change', function () {
            boxes.forEach(function (b) {
              b.checked = all.checked;
              b.dispatchEvent(new Event('change'));
            });
          });
          const bar = element('div', 'primers-pickbar');
          bar.append(all, element('span', 'primers-muted', 'Select all'), attachPicked);
          results.append(bar);
          refreshPicked();
        }
        list.forEach(function (primer) {
          const sites = findSitesCached(now.sequence, primer.sequence, now.circular);
          const holder = element('div', 'primers-pick');
          if (entryId) {
            const box = element('input');
            box.type = 'checkbox';
            box.setAttribute('aria-label', 'Select ' + primer.title);
            box.addEventListener('change', function () {
              if (box.checked) {
                picked.add(primer.id);
              } else {
                picked.delete(primer.id);
              }
              refreshPicked();
            });
            boxes.push(box);
            holder.append(box);
          }
          holder.append(card(primer, sites, entryId ? [action('Attach', function () {
            attach(primer);
          }, 'primary')] : []));
          results.append(holder);
        });
        if (list.length === 0) {
          results.append(element('p', 'primers-muted', 'Nothing found.'));
        }
      };
      const showResults = function () {
        const term = search.value.trim().toLowerCase();
        results.textContent = '';
        if (term === '' && whereFilter === 'anywhere') {
          preview([]);
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
          const sites = findSitesCached(now.sequence, primer.sequence, now.circular);
          switch (whereFilter) {
          case 'inside': return sites.some(insideSelection);
          case 'outside': return sites.length > 0 && !sites.some(insideSelection);
          case 'nowhere': return sites.length === 0;
          default: return true;
          }
        }).slice(0, 25);
        renderList(list);
      };
      let typing = 0;
      search.addEventListener('input', function () {
        window.clearTimeout(typing);
        typing = window.setTimeout(showResults, 150);
      });
      where.addEventListener('change', function () {
        whereFilter = where.value;
        showResults();
      });
      // candidates: the primers of the database that match the selected region, or the entire sequence
      const finder = element('div', 'primers-finder');
      const scope = element('select', 'primers-name');
      [['selection', 'inside the selection'], ['entire', 'anywhere on the entire sequence']].forEach(function (choice) {
        const option = element('option', '', 'Bind ' + choice[1]);
        option.value = choice[0];
        scope.append(option);
      });
      scope.value = candidatePrefs.scope;
      const tolerance = element('select', 'primers-name');
      [['0', 'exact match'], ['1', 'up to 1 mismatch'], ['3', 'up to 3 mismatches']].forEach(function (choice) {
        const option = element('option', '', choice[1]);
        option.value = choice[0];
        tolerance.append(option);
      });
      tolerance.value = candidatePrefs.mismatches;
      const candidates = action('Find matching primers', function () {
        candidatePrefs = { scope: scope.value, mismatches: tolerance.value };
        search.value = '';
        results.textContent = '';
        if (scope.value === 'selection' && !hasSelection) {
          results.append(element('p', 'primers-muted', 'Select a region of the sequence first, or search the entire sequence.'));
          return;
        }
        const limit = Number(tolerance.value);
        const found = [];
        (databasePrimers || []).forEach(function (primer) {
          if (attachedIds.has(primer.id)) {
            return;
          }
          const sites = findSitesCached(now.sequence, primer.sequence, now.circular).filter(function (site) {
            return site.mismatches <= limit && (scope.value === 'entire' || insideSelection(site));
          });
          if (sites.length > 0) {
            found.push({ primer: primer, best: Math.min.apply(null, sites.map(function (site) {
              return site.mismatches;
            })), first: sites[0].start });
          }
        });
        // the closest matches first, then along the sequence
        found.sort(function (x, y) {
          return x.best - y.best || x.first - y.first;
        });
        const count = element('p', 'primers-muted', found.length + ' candidate' + (found.length === 1 ? '' : 's') + (hasSelection && scope.value === 'selection' ? ' in the selection (' + (selection.start + 1) + '..' + (selection.end + 1) + ')' : ' on the sequence') + '.');
        if (found.length > 0) {
          renderList(found.slice(0, 200).map(function (item) {
            return item.primer;
          }));
        } else {
          preview([]);
        }
        results.prepend(count);
      }, 'primary');
      finder.append(scope, tolerance, candidates);
      sectionSearch.append(finder);

      const searchRow = element('div', 'primers-row');
      searchRow.append(search, where);
      sectionSearch.append(searchRow, results);
      showResults();

      // the primers annotated in the file, not in the database yet
      const own = Object.values(now.data.primers || {});
      if (own.length > 0) {
        sectionFile.append(element('h4', '', 'Primers designed in this file'));
      }
      // the ones that are not in the database yet can be ticked and added together, or all at once
      const items = own.map(function (primer) {
        const forward = primer.forward !== false && primer.strand !== -1;
        const bases = basesOf(now.sequence, primer.start, primer.end, forward);
        return { name: primer.name || 'primer', forward: forward, bases: bases, inDatabase: known(bases) };
      });
      const missing = items.filter(function (item) {
        return !item.inDatabase && tools.clean(item.bases).length >= tools.minLength;
      });
      const chosen = new Set(missing);
      let addChosen = null;
      let addAll = null;
      const refreshBar = function () {
        if (addChosen) {
          addChosen.textContent = 'Add the ' + chosen.size + ' selected to the database';
          addChosen.disabled = chosen.size === 0;
        }
      };
      if (missing.length > 0) {
        const bar = element('div', 'primers-pickbar');
        const everything = element('input');
        everything.type = 'checkbox';
        everything.checked = true;
        everything.setAttribute('aria-label', 'Select all the primers of the file');
        const boxes = [];
        everything.addEventListener('change', function () {
          boxes.forEach(function (box) {
            box.checked = everything.checked;
            box.dispatchEvent(new Event('change'));
          });
        });
        addChosen = action('', function () {
          addMany(Array.from(chosen), [addChosen, addAll]);
        }, 'primary');
        addAll = action('Add all (' + missing.length + ')', function () {
          addMany(missing, [addChosen, addAll]);
        });
        bar.append(everything, element('span', 'primers-muted', 'Select all'), addChosen, addAll);
        sectionFile.append(bar);
        refreshBar();
        items.boxes = boxes;
      }
      items.forEach(function (item) {
        const row = element('div', 'primers-row');
        if (missing.indexOf(item) !== -1) {
          const box = element('input');
          box.type = 'checkbox';
          box.checked = true;
          box.setAttribute('aria-label', 'Select ' + item.name);
          box.addEventListener('change', function () {
            if (box.checked) {
              chosen.add(item);
            } else {
              chosen.delete(item);
            }
            refreshBar();
          });
          items.boxes.push(box);
          row.append(box);
        }
        row.append(element('strong', '', item.name), element('span', 'primers-muted', item.bases.length + ' bases'));
        if (item.inDatabase) {
          const link = element('a', 'primers-muted', 'in the database: ' + item.inDatabase.title);
          link.href = '../registry.php?mode=view&id=' + item.inDatabase.id;
          link.target = '_blank';
          row.append(link);
        } else if (missing.indexOf(item) === -1) {
          row.append(element('span', 'primers-muted', 'too short for the database'));
        } else {
          const add = element('button', 'cutter-button', 'Add to the database');
          add.type = 'button';
          add.addEventListener('click', function () {
            addToDatabase(add, item.name, item.bases, item.forward);
          });
          row.append(add);
        }
        sectionFile.append(row);
      });

      // a primer from the bases selected on the sequence
      sectionFile.append(element('h4', '', 'New primer from the selection'));
      if (!hasSelection) {
        sectionFile.append(element('p', 'primers-muted', 'Select the bases of the primer on the sequence first.'));
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
        sectionFile.append(row);
      }

      // the three parts are tabs, so the panel stays short: what is attached, what can be searched, what the file holds
      const fileCount = missing.length;
      if (subTab === null) {
        subTab = attachedPrimers.length > 0 ? 'attached' : 'search';
      }
      const subTabs = element('div', 'primers-subtabs');
      [['attached', 'Attached', attachedPrimers.length, sectionAttached], ['search', 'Find and add', null, sectionSearch], ['file', 'In this file', fileCount, sectionFile]].forEach(function (tabDef) {
        const button = element('button', 'primers-subtab' + (subTab === tabDef[0] ? ' active' : ''), tabDef[1] + (tabDef[2] === null ? '' : ' (' + tabDef[2] + ')'));
        button.type = 'button';
        button.setAttribute('aria-pressed', subTab === tabDef[0] ? 'true' : 'false');
        button.addEventListener('click', function () {
          subTab = tabDef[0];
          render();
        });
        subTabs.append(button);
        tabDef[3].hidden = subTab !== tabDef[0];
      });
      panel.append(subTabs, sectionAttached, sectionSearch, sectionFile);
      // the preview of the search belongs to the search tab
      if (subTab !== 'search' && Object.keys(previewDrawn).length > 0) {
        previewDrawn = {};
        redraw();
      }
    }

    // several primers of the file in the database, each attached to this sequence; one that is already there is left out
    async function addMany(list, buttons) {
      buttons.forEach(function (b) {
        if (b) {
          b.disabled = true;
        }
      });
      let added = 0;
      let skipped = 0;
      const seen = new Set();
      try {
        for (const item of list) {
          const key = tools.clean(item.bases);
          if (seen.has(key) || known(item.bases)) {
            skipped++;
            continue;
          }
          seen.add(key);
          const id = await tools.createPrimer(item.name, item.bases, item.forward, current().name);
          if (entryId) {
            await tools.attach(entryId, id);
          }
          added++;
        }
        say(added + ' primer' + (added === 1 ? '' : 's') + ' added to the database' + (skipped > 0 ? ' (' + skipped + ' already there)' : '') + '.');
      } catch (error) {
        say((added > 0 ? added + ' added, then: ' : '') + (error.message || String(error)), true);
      }
      databasePrimers = null;
      await loadAttached();
      await render();
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
      const shown = window.ToolSidebar.active();
      if (shown !== 'primers' && shown !== 'design') {
        return;
      }
      tab = shown;
      panel.textContent = '';
      if (databasePrimers === null) {
        databasePrimers = await tools.allPrimers().catch(function () {
          return [];
        });
      }
      if (tab === 'design' && designer) {
        renderDesignTab();
      } else {
        await renderPrimersTab();
      }
      panel.append(message);
    }

    window.ToolSidebar.register({ id: 'primers', icon: 'primers', label: 'Primers and probes', show: function (host) {
      panel = host;
      say('');
      render();
    } });
    window.ToolSidebar.register({ id: 'design', icon: 'design', label: 'Design primers', show: function (host) {
      panel = host;
      say('');
      render();
    } });
    // the primers of the plasmid are drawn from the start
    loadAttached().catch(function () {
      // the map just has no database primers
    });
  }

  window.PrimerPanel = { setup: setup };
})();
