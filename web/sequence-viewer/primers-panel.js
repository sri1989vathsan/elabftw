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
    // the designer used: Primer3 on the server when it is there
    let designEngine = 'primer3';
    let primer3Available = null;

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

    // "site" is where the primer binds; its tail (the bases that hang over) and the bases of the primer are drawn by oligo-style.js
    const annotation = function (id, name, start, end, forward, length, site, bases) {
      const drawn = { id: id, name: name, type: 'primer', start: start % length, end: end % length, forward: forward, strand: forward ? 1 : -1 };
      if (site && site.tail) {
        // the whole oligo is laid on the plasmid, its overhang on the places next to the binding site (before it for a forward
        // oligo, after it for a reverse one); oligo-style.js boxes the places that match and writes the overhang as plain letters
        drawn.tail = site.tail;
        drawn.oligo = String(bases || '').toUpperCase();
        drawn.boundStart = drawn.start;
        drawn.boundEnd = drawn.end;
        if (forward) {
          drawn.start = (drawn.start - site.tail + length) % length;
        } else {
          drawn.end = (drawn.end + site.tail) % length;
        }
      }
      return drawn;
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
          previewDrawn[id] = Object.assign(annotation(id, primer.title + ' (candidate)', site.start, site.end - 1, site.forward, now.sequence.length, site, primer.sequence), { color: '#e8890c' });
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
          attachedDrawn[id] = annotation(id, primer.title, site.start, site.end - 1, site.forward, now.sequence.length, site, primer.sequence);
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

    // the rows that are opened, kept while the panel is drawn again
    const openRows = new Set();

    // a primer as a row of one line (name and where it binds); a click opens the sequence, the Tm and the buttons
    function compactRow(primer, sites, buttons, key) {
      const row = element('div', 'primers-compact');
      const bases = primer.sequence;
      const top = element('div', 'primers-compact-top');
      const toggle = element('button', 'primers-compact-toggle');
      toggle.type = 'button';
      const name = element('strong', 'primers-compact-name', primer.title);
      name.title = primer.title;
      toggle.append(element('span', 'primers-compact-chevron', '\u25b8'), name);
      top.append(toggle);
      const first = sites[0];
      if (first) {
        top.append(element('span', 'primers-compact-meta', (first.start + 1) + '..' + first.end + (first.forward ? ' \u2192' : ' \u2190') + (sites.length > 1 ? ' +' + (sites.length - 1) : '')));
      } else {
        top.append(element('span', 'primers-compact-meta primers-compact-bad', 'no binding site'));
      }
      top.append(element('span', 'primers-compact-meta', bases.length + ' b'));
      const category = primer.category && !/^primers?$/i.test(primer.category) ? primer.category.replace(/s$/i, '') : '';
      if (category) {
        top.append(element('span', 'primers-compact-badge', category));
      }

      const detail = element('div', 'primers-compact-detail');
      detail.append(element('div', 'primers-compact-meta', 'Tm ' + tools.tm(bases) + '\u00b0C \u00b7 GC ' + tools.gc(bases) + '%'), element('code', 'primers-compact-seq', bases));
      const places = element('div', 'primers-compact-places');
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
      const actions = element('div', 'primers-compact-actions');
      buttons.forEach(function (b) {
        actions.append(b);
      });
      detail.append(places, actions);

      const apply = function () {
        const open = openRows.has(key);
        detail.hidden = !open;
        row.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.firstChild.textContent = open ? '\u25be' : '\u25b8';
      };
      toggle.addEventListener('click', function () {
        if (openRows.has(key)) {
          openRows.delete(key);
        } else {
          openRows.add(key);
        }
        apply();
      });
      apply();
      row.append(top, detail);
      return row;
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

      // the primers annotated in the file: the primers of the editor and the features of the type primer_bind (a GenBank file has
      // its primers as these). Those that are not in the database yet are listed with the attached ones.
      const featureList = Array.isArray(now.data.features) ? now.data.features : Object.values(now.data.features || {});
      const own = Object.values(now.data.primers || {}).concat(featureList.filter(function (feature) {
        return String(feature.type || '').toLowerCase() === 'primer_bind' && feature.start <= feature.end;
      }).map(function (feature) {
        return { name: feature.name, start: feature.start, end: feature.end, forward: feature.strand !== -1, strand: feature.strand };
      }));
      const fileOnly = own.map(function (primer) {
        const forward = primer.forward !== false && primer.strand !== -1;
        const bases = basesOf(now.sequence, primer.start, primer.end, forward);
        return { name: primer.name || 'primer', forward: forward, bases: bases, inDatabase: known(bases) };
      }).filter(function (item) {
        return !item.inDatabase && tools.clean(item.bases).length >= tools.minLength;
      });

      sectionAttached.append(element('h4', '', 'On this sequence'));
      if (attachedPrimers.length === 0 && fileOnly.length === 0) {
        sectionAttached.append(element('p', 'primers-muted', entryId ? 'No primer is attached yet. Use the Find and add tab.' : 'Open a plasmid of the database to attach primers to it.'));
      }
      // what is ticked, to be sent to an order, added to the database or detached together
      const tickedDb = new Set();
      const tickedFile = new Set();
      const allBoxes = [];
      if (attachedPrimers.length + fileOnly.length > 0) {
        const bar = element('div', 'primers-pickbar');
        const everything = element('input');
        everything.type = 'checkbox';
        everything.setAttribute('aria-label', 'Select all the primers of the sequence');
        everything.addEventListener('change', function () {
          allBoxes.forEach(function (box) {
            box.checked = everything.checked;
            box.dispatchEvent(new Event('change'));
          });
        });
        // a primer that is only in the file is added to the database first: an order is made of entries of the database
        const orderTicked = action('', async function () {
          orderTicked.disabled = true;
          try {
            const created = await addMany(Array.from(tickedFile), [], true);
            tools.sendToOrder(Array.from(tickedDb).concat(created), function () {
              render();
            });
          } catch (error) {
            say(error.message || String(error), true);
          }
        }, 'primary');
        const addTicked = action('', function () {
          addMany(Array.from(tickedFile), [addTicked, orderTicked]);
        });
        const detachTicked = action('', async function () {
          detachTicked.disabled = true;
          orderTicked.disabled = true;
          try {
            for (const id of Array.from(tickedDb)) {
              await tools.detach(entryId, id);
            }
          } catch (error) {
            say(error.message || String(error), true);
          }
          await loadAttached();
          await render();
        }, 'quiet');
        const refreshTicked = function () {
          const total = tickedDb.size + tickedFile.size;
          orderTicked.textContent = 'Order ' + total;
          addTicked.textContent = 'Add ' + tickedFile.size + ' to database';
          detachTicked.textContent = 'Detach ' + tickedDb.size;
          orderTicked.disabled = total === 0;
          addTicked.disabled = tickedFile.size === 0;
          addTicked.hidden = fileOnly.length === 0;
          detachTicked.disabled = tickedDb.size === 0 || !entryId;
          detachTicked.hidden = attachedPrimers.length === 0;
          everything.checked = total === attachedPrimers.length + fileOnly.length && total > 0;
        };
        // open or close all the rows
        const rowKeys = attachedPrimers.map(function (primer) {
          return 'db' + primer.id;
        }).concat(fileOnly.map(function (item) {
          return 'file' + item.name + item.bases;
        }));
        const fold = action(rowKeys.some(function (key) {
          return openRows.has(key);
        }) ? 'Collapse' : 'Expand', function () {
          const anyOpen = rowKeys.some(function (key) {
            return openRows.has(key);
          });
          rowKeys.forEach(function (key) {
            if (anyOpen) {
              openRows.delete(key);
            } else {
              openRows.add(key);
            }
          });
          render();
        }, 'quiet');
        fold.title = 'Show or hide the sequence and the details of every primer';
        bar.append(everything, element('span', 'primers-muted', 'All'), orderTicked, addTicked, detachTicked, fold);
        bar.classList.add('primers-pickbar-compact');
        sectionAttached.append(bar);
        const pick = function (box, set, value) {
          box.addEventListener('change', function () {
            if (box.checked) {
              set.add(value);
            } else {
              set.delete(value);
            }
            refreshTicked();
          });
          allBoxes.push(box);
        };
        attachedPrimers.forEach(function (primer) {
          const sites = findSitesCached(now.sequence, primer.sequence, now.circular);
          const holder = element('div', 'primers-pick');
          const box = element('input');
          box.type = 'checkbox';
          box.setAttribute('aria-label', 'Select ' + primer.title);
          pick(box, tickedDb, primer.id);
          holder.append(box, compactRow(primer, sites, [
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
          ], 'db' + primer.id));
          sectionAttached.append(holder);
        });
        // the primers that are only in the file: they have a button to be added to the database
        fileOnly.forEach(function (item) {
          const holder = element('div', 'primers-pick');
          const box = element('input');
          box.type = 'checkbox';
          box.setAttribute('aria-label', 'Select ' + item.name);
          pick(box, tickedFile, item);
          const add = action('Add to database', function () {
            addToDatabase(add, item.name, item.bases, item.forward);
          }, 'primary');
          holder.append(box, compactRow({ title: item.name, category: 'Not in the database', sequence: item.bases }, findSitesCached(now.sequence, item.bases, now.circular), [add], 'file' + item.name + item.bases));
          sectionAttached.append(holder);
        });
        refreshTicked();
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
      // the selection is read when it is needed: the panel stays open while the user selects on the sequence
      const selectionNow = function () {
        const chosen = editor.getState().selectionLayer || { start: -1, end: -1 };
        const has = chosen.start >= 0 && chosen.end >= 0;
        // a selection over the origin of a circular sequence runs from a high position to a low one
        return { start: chosen.start, end: chosen.end, has: has, wraps: has && chosen.start > chosen.end };
      };
      const inSelection = function (position, chosen) {
        return chosen.wraps ? (position >= chosen.start || position <= chosen.end) : (position >= chosen.start && position <= chosen.end);
      };
      // the whole binding site is in the selection
      const insideSelection = function (site) {
        const chosen = selectionNow();
        const length = now.sequence.length;
        if (!chosen.has || (site.end > length && !chosen.wraps)) {
          return false;
        }
        return inSelection(site.start, chosen) && inSelection((site.end - 1) % length, chosen);
      };
      // a part of the binding site is in the selection
      const touchesSelection = function (site) {
        const chosen = selectionNow();
        if (!chosen.has) {
          return false;
        }
        for (let position = site.start; position < site.end; position++) {
          if (inSelection(position % now.sequence.length, chosen)) {
            return true;
          }
        }
        return false;
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
        if (entryId && list.some(function (primer) {
          return !attachedIds.has(primer.id);
        })) {
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
          const isAttached = attachedIds.has(primer.id);
          if (entryId && isAttached) {
            holder.append(element('span', 'primers-pick-space'));
          }
          if (entryId && !isAttached) {
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
          const attachButton = isAttached ? action('Attached', function () {}, 'quiet') : action('Attach', function () {
            attach(primer);
          }, 'primary');
          attachButton.disabled = isAttached;
          holder.append(card(primer, sites, entryId ? [attachButton] : []));
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
        if ((whereFilter === 'inside' || whereFilter === 'outside') && !selectionNow().has) {
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
      [['selection', 'inside the selection'], ['overlap', 'overlapping the selection'], ['entire', 'anywhere on the entire sequence']].forEach(function (choice) {
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
        if (scope.value !== 'entire' && !selectionNow().has) {
          results.append(element('p', 'primers-muted', 'Select a region of the sequence first, or search the entire sequence.'));
          return;
        }
        const limit = Number(tolerance.value);
        const found = [];
        // the primers already attached are listed too (without a tick): they are on the sequence, so they match
        (databasePrimers || []).forEach(function (primer) {
          const sites = findSitesCached(now.sequence, primer.sequence, now.circular).filter(function (site) {
            return site.mismatches <= limit && (scope.value === 'entire' || (scope.value === 'overlap' ? touchesSelection(site) : insideSelection(site)));
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
        const attachedCount = found.filter(function (item) {
          return attachedIds.has(item.primer.id);
        }).length;
        const chosenNow = selectionNow();
        const count = element('p', 'primers-muted', found.length + ' matching primer' + (found.length === 1 ? '' : 's') + (scope.value !== 'entire' ? ' ' + (scope.value === 'overlap' ? 'overlapping' : 'in') + ' the selection (' + (chosenNow.start + 1) + '..' + (chosenNow.end + 1) + ')' : ' on the sequence') + (attachedCount > 0 ? ', ' + attachedCount + ' already attached' : '') + '.');
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

      // a primer from the bases selected on the sequence: the form follows the selection while the panel is open
      sectionSearch.append(element('h4', '', 'New primer from the selection'));
      const reverse = element('input');
      reverse.type = 'checkbox';
      const reverseLabel = element('label', 'primers-muted');
      reverseLabel.append(reverse, document.createTextNode(' reverse primer'));
      const name = element('input', 'primers-name');
      name.type = 'text';
      name.placeholder = 'Name of the primer';
      const info = element('span', 'primers-muted');
      const addNew = element('button', 'cutter-button', 'Add to the database');
      addNew.type = 'button';
      const formRow = element('div', 'primers-row');
      formRow.append(name, info, reverseLabel, addNew);
      const basesNow = function () {
        const chosen = selectionNow();
        return chosen.has ? basesOf(current().sequence, chosen.start, chosen.end, !reverse.checked) : '';
      };
      const refreshNew = function () {
        const chosen = selectionNow();
        formRow.hidden = !chosen.has;
        hint.hidden = chosen.has;
        if (chosen.has) {
          const bases = basesOf(current().sequence, chosen.start, chosen.end, !reverse.checked);
          info.textContent = bases.length + ' bases, Tm ' + tools.tm(bases) + '\u00b0C, GC ' + tools.gc(bases) + '%' + (bases.length < tools.minLength ? ' (too short)' : '');
        }
      };
      const hint = element('p', 'primers-muted', 'Select the bases of the primer on the sequence first.');
      reverse.addEventListener('change', refreshNew);
      addNew.addEventListener('click', function () {
        const chosen = selectionNow();
        const bases = basesNow();
        if (!chosen.has || bases.length < tools.minLength) {
          say('A primer has at least ' + tools.minLength + ' bases.', true);
          return;
        }
        const title = name.value.trim() || (current().name + (reverse.checked ? '-R-' : '-F-') + (chosen.start + 1));
        addToDatabase(addNew, title, bases, !reverse.checked);
      });
      sectionSearch.append(hint, formRow);
      refreshNew();
      // while this panel is on the page, the form follows the selection (the timer stops when the panel is drawn again)
      const follow = window.setInterval(function () {
        if (!formRow.isConnected) {
          window.clearInterval(follow);
          return;
        }
        refreshNew();
      }, 400);

      // two tabs, so the panel stays short: what is on the sequence, and what can be searched and added
      if (subTab === null) {
        subTab = attachedPrimers.length > 0 ? 'attached' : 'search';
      }
      const subTabs = element('div', 'primers-subtabs');
      [['attached', 'Attached', attachedPrimers.length + fileOnly.length, sectionAttached], ['search', 'Find and add', null, sectionSearch]].forEach(function (tabDef) {
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
      panel.append(subTabs, sectionAttached, sectionSearch);
      // the preview of the search belongs to the search tab
      if (subTab !== 'search' && Object.keys(previewDrawn).length > 0) {
        previewDrawn = {};
        redraw();
      }
    }

    // several primers of the file in the database, each attached to this sequence; one that is already there is left out.
    // With "quiet" nothing is shown and the ids of the entries are given back (to order them).
    async function addMany(list, buttons, quiet) {
      buttons.forEach(function (b) {
        if (b) {
          b.disabled = true;
        }
      });
      let added = 0;
      let skipped = 0;
      const ids = [];
      const seen = new Map();
      try {
        for (const item of list) {
          const key = tools.clean(item.bases);
          if (seen.has(key)) {
            ids.push(seen.get(key));
            skipped++;
            continue;
          }
          const existing = known(item.bases);
          if (existing) {
            ids.push(existing.id);
            skipped++;
            continue;
          }
          const id = await tools.createPrimer(item.name, item.bases, item.forward, current().name);
          if (entryId) {
            await tools.attach(entryId, id);
          }
          seen.set(key, id);
          ids.push(id);
          added++;
        }
        if (!quiet) {
          say(added + ' primer' + (added === 1 ? '' : 's') + ' added to the database' + (skipped > 0 ? ' (' + skipped + ' already there)' : '') + '.');
        }
      } catch (error) {
        say((added > 0 ? added + ' added, then: ' : '') + (error.message || String(error)), true);
        if (quiet) {
          throw error;
        }
      }
      databasePrimers = null;
      await loadAttached();
      if (!quiet) {
        await render();
      }
      return ids;
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
      // the region is read when it is needed: the panel stays open while the user selects on the sequence
      const regionNow = function () {
        const chosen = editor.getState().selectionLayer || { start: -1, end: -1 };
        const has = chosen.start >= 0 && chosen.end >= 0 && chosen.end >= chosen.start;
        return { has: has, start: has ? chosen.start : 0, end: has ? chosen.end : current().sequence.length - 1 };
      };
      panel.append(element('h4', '', 'Region to amplify'));
      const regionText = element('p', 'primers-muted');
      const showRegion = function () {
        const region = regionNow();
        regionText.textContent = region.has
          ? 'The selection: ' + (region.start + 1) + '..' + (region.end + 1) + ' (' + (region.end - region.start + 1) + ' bases).'
          : 'No selection: the whole sequence (' + now.sequence.length + ' bases). Select a region to design primers for it.';
      };
      showRegion();
      panel.append(regionText);
      const followRegion = window.setInterval(function () {
        if (!regionText.isConnected) {
          window.clearInterval(followRegion);
          return;
        }
        showRegion();
      }, 400);

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
      // Primer3, run on the server, when it is installed there; otherwise (or by choice) the built-in designer of the browser
      const engine = element('select', 'primers-name');
      [['primer3', 'Primer3 (on the server)'], ['builtin', 'Built-in designer (in the browser)']].forEach(function (choice) {
        const option = element('option', '', choice[1]);
        option.value = choice[0];
        engine.append(option);
      });
      engine.value = designEngine;
      engine.addEventListener('change', function () {
        designEngine = engine.value;
      });
      const engineField = element('label', 'primers-field');
      engineField.append(element('span', '', 'Designer'), engine);
      form.prepend(engineField);
      panel.append(form);
      if (primer3Available === null) {
        fetch('primer3.php', { credentials: 'same-origin' }).then(function (response) {
          return response.ok ? response.json() : { available: false };
        }).catch(function () {
          return { available: false };
        }).then(function (answer) {
          primer3Available = !!answer.available;
          if (!primer3Available) {
            designEngine = 'builtin';
            engine.value = 'builtin';
            engine.querySelector('option[value="primer3"]').disabled = true;
            engine.querySelector('option[value="primer3"]').textContent = 'Primer3 (not installed on this server)';
          }
        });
      } else if (!primer3Available) {
        engine.value = 'builtin';
        engine.querySelector('option[value="primer3"]').disabled = true;
      }

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
        window.setTimeout(async function () {
          const region = regionNow();
          if (designEngine === 'primer3' && primer3Available !== false) {
            try {
              const response = await fetch('primer3.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': document.body.dataset.csrf },
                body: JSON.stringify({ sequence: now.sequence, start: region.start, end: region.end, options: Object.assign({ pairs: 5 }, designOptions) }),
              });
              const answer = await response.json();
              designResult = response.ok ? answer : { pairs: [], error: answer.error || 'Primer3 failed (' + response.status + ').' };
              designResult.engine = 'Primer3';
            } catch (error) {
              designResult = { pairs: [], error: 'Primer3 could not be reached: ' + (error.message || error) };
            }
          } else {
            designResult = designer.design(now.sequence, region.start, region.end, now.circular, designOptions);
            designResult.engine = 'Built-in designer';
          }
          designResult.region = { start: region.start, end: region.end };
          designDrawn = {};
          render();
        }, 30);
      });
      panel.append(run);

      if (designResult) {
        panel.append(element('h4', '', 'Primer pairs' + (designResult.engine ? ' (' + designResult.engine + ')' : '')));
        if (designResult.error) {
          panel.append(element('p', 'primers-warning', designResult.error));
        } else if (designResult.pairs.length === 0) {
          panel.append(element('p', 'primers-muted', 'No pair found' + (designResult.explain ? ' (Primer3: ' + designResult.explain + ')' : '') + ': widen the range of lengths or of Tm, or let the primers start around the region.'));
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
    // the right-click menu of the map (primer-menu.js) detaches a primer through this
    window.PrimerPanel.detachPrimer = async function (id) {
      await tools.detach(entryId, id);
      await loadAttached();
      if (panel && window.ToolSidebar.active() === 'primers') {
        await render();
      }
    };
    // the primers of the plasmid are drawn from the start
    loadAttached().catch(function () {
      // the map just has no database primers
    });
  }

  window.PrimerPanel = { setup: setup };
})();
