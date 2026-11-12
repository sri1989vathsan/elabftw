/**
 * The primers section of an entry of the database.
 * - On a plasmid: the primers attached to it with the place where each binds on its sequence, a search to attach one, the
 *   primers of the database that bind the sequence, and a way to send primers to an order.
 * - On a primer: the plasmids it is attached to (and a search to attach it to any plasmid), and its orders.
 * Needs primer-tools.js.
 */
(function () {
  'use strict';
  const holder = document.getElementById('primersDiv');
  const root = document.getElementById('primersRoot');
  const tools = window.PrimerTools;
  if (!holder || !root || !tools) {
    return;
  }
  const entryId = Number(holder.dataset.entry);
  const mode = holder.dataset.mode;
  const files = JSON.parse(holder.dataset.files || '[]');

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

  const viewUrl = function (id) {
    return 'registry.php?mode=view&id=' + id;
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error('The sequence reader could not be loaded.'));
      };
      document.head.append(script);
    });
  }

  // the sequence of the plasmid: its first GenBank or FASTA file
  async function plasmidSequence() {
    const file = files.find(function (f) {
      return /(?<!\.read)\.(gb|gbk|gbff|genbank|fasta|fa|fna)$/i.test(f.real_name);
    });
    if (!file) {
      return null;
    }
    await loadScript('sequence-viewer/vendor/bio-parsers.umd.js');
    const params = new URLSearchParams({ f: file.long_name, name: file.real_name, storage: String(file.storage) });
    const response = await fetch('app/download.php?' + params.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      return null;
    }
    const results = await window.bioParsers.anyToJson(await response.text(), { fileName: file.real_name });
    const parsed = Array.isArray(results) ? results[0] : results;
    if (!parsed || !parsed.success) {
      return null;
    }
    return { sequence: parsed.parsedSequence.sequence, circular: !!parsed.parsedSequence.circular, file: file };
  }

  function siteText(site) {
    const where = (site.start + 1) + '..' + site.end + (site.forward ? ' (+)' : ' (−)');
    return where + (site.mismatches === 0 ? ', exact' : ', ' + site.mismatches + ' mismatch' + (site.mismatches > 1 ? 'es' : ''));
  }

  // a search of the entries of the database: onPick gets the entry
  function search(placeholder, fetchEntries, onPick) {
    const wrap = element('span', 'lineage-add');
    const input = element('input');
    input.type = 'search';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', placeholder);
    const results = element('div', 'lineage-results');
    results.hidden = true;
    let timer = 0;
    input.addEventListener('input', function () {
      window.clearTimeout(timer);
      const term = input.value.trim();
      if (term === '') {
        results.hidden = true;
        return;
      }
      timer = window.setTimeout(async function () {
        const entries = await fetchEntries(term);
        results.textContent = '';
        entries.forEach(function (entry) {
          const button = element('button', '', '#' + entry.id + ' ' + entry.title + (entry.category ? ' (' + entry.category + ')' : ''));
          button.type = 'button';
          button.addEventListener('click', function () {
            results.hidden = true;
            input.value = '';
            onPick(entry);
          });
          results.append(button);
        });
        if (entries.length === 0) {
          results.append(element('div', 'p-2 text-muted', 'Nothing found.'));
        }
        results.hidden = false;
      }, 200);
    });
    document.addEventListener('click', function (event) {
      if (!wrap.contains(event.target)) {
        results.hidden = true;
      }
    });
    wrap.append(input, results);
    return wrap;
  }

  const message = element('p', 'lineage-message');
  const fail = function (error) {
    message.textContent = error.message || String(error);
    message.className = 'lineage-message error';
  };

  async function renderPlasmid() {
    const [state, sequenceInfo, primers] = await Promise.all([tools.attached(entryId), plasmidSequence().catch(function () {
      return null;
    }), tools.allPrimers()]);
    root.textContent = '';
    const attachedIds = new Set(state.primers.map(function (p) {
      return p.id;
    }));

    const table = element('table', 'table table-sm primers-table');
    const head = element('tr');
    ['Name', 'Sequence 5\'-3\'', 'Tm', 'Binds on this plasmid', ''].forEach(function (label) {
      head.append(element('th', '', label));
    });
    const thead = element('thead');
    thead.append(head);
    const body = element('tbody');
    state.primers.forEach(function (primer) {
      const tr = element('tr');
      const name = element('td');
      const link = element('a', '', primer.title);
      link.href = viewUrl(primer.id);
      name.append(link);
      const sequence = tools.clean(primer.sequence);
      const where = element('td');
      if (!sequenceInfo) {
        where.textContent = 'Attach a sequence to see it';
        where.className = 'text-muted';
      } else if (sequence.length < tools.minLength) {
        where.textContent = 'No sequence on the primer';
        where.className = 'text-muted';
      } else {
        const sites = tools.findSites(sequenceInfo.sequence, sequence, sequenceInfo.circular);
        if (sites.length === 0) {
          where.textContent = 'No binding site found';
          where.className = 'primers-warning';
        } else {
          where.textContent = sites.map(siteText).join('; ');
        }
      }
      const seqCell = element('td', 'primers-sequence', sequence);
      const tm = tools.tm(sequence);
      const actions = element('td', 'text-nowrap');
      const order = element('button', 'btn btn-ghost btn-sm', 'Order');
      order.type = 'button';
      order.title = 'Send this primer to an order';
      order.addEventListener('click', function () {
        tools.sendToOrder([primer.id], renderPlasmid);
      });
      actions.append(order);
      if (!holder.dataset.readonly) {
        const remove = element('button', 'btn btn-danger-ghost btn-sm', '×');
        remove.type = 'button';
        remove.title = 'Detach this primer';
        remove.addEventListener('click', async function () {
          try {
            await tools.detach(entryId, primer.id);
            await renderPlasmid();
          } catch (error) {
            fail(error);
          }
        });
        actions.append(remove);
      }
      tr.append(name, seqCell, element('td', '', tm === null ? '' : tm + '°C'), where, actions);
      body.append(tr);
    });
    if (state.primers.length === 0) {
      const tr = element('tr');
      const cell = element('td', 'text-muted', 'No primer or probe is attached to this plasmid yet.');
      cell.colSpan = 5;
      tr.append(cell);
      body.append(tr);
    }
    table.append(thead, body);
    root.append(table);

    const controls = element('div', 'primers-controls');
    controls.append(search('Attach a primer or probe...', async function (term) {
      const lower = term.toLowerCase();
      return primers.filter(function (p) {
        return !attachedIds.has(p.id) && (p.title.toLowerCase().indexOf(lower) !== -1 || p.sequence.toLowerCase().indexOf(lower) !== -1);
      }).slice(0, 12);
    }, async function (entry) {
      try {
        await tools.attach(entryId, entry.id);
        await renderPlasmid();
      } catch (error) {
        fail(error);
      }
    }));
    if (state.primers.length > 1) {
      const all = element('button', 'btn btn-secondary btn-sm ml-2', 'Send all to an order');
      all.type = 'button';
      all.addEventListener('click', function () {
        tools.sendToOrder(state.primers.map(function (p) {
          return p.id;
        }), renderPlasmid);
      });
      controls.append(all);
    }
    if (sequenceInfo) {
      const find = element('button', 'btn btn-secondary btn-sm ml-2', 'Find the primers and probes of the database that bind');
      find.type = 'button';
      find.addEventListener('click', function () {
        const found = primers.filter(function (p) {
          return !attachedIds.has(p.id);
        }).map(function (p) {
          return { primer: p, sites: tools.findSites(sequenceInfo.sequence, p.sequence, sequenceInfo.circular) };
        }).filter(function (match) {
          return match.sites.length > 0;
        });
        suggestions.textContent = '';
        if (found.length === 0) {
          suggestions.append(element('p', 'text-muted mb-1', 'No other primer or probe of the database binds this sequence.'));
          return;
        }
        suggestions.append(element('h4', '', 'Primers and probes of the database that bind this sequence'));
        const chosen = new Set(found.map(function (match) {
          return match.primer.id;
        }));
        const bar = element('div', 'primers-suggestion');
        const attachChosen = element('button', 'btn btn-primary btn-sm', '');
        attachChosen.type = 'button';
        const refreshBar = function () {
          attachChosen.textContent = 'Attach the ' + chosen.size + ' selected';
          attachChosen.disabled = chosen.size === 0;
        };
        const everything = element('input');
        everything.type = 'checkbox';
        everything.checked = true;
        everything.setAttribute('aria-label', 'Select all');
        const boxes = [];
        everything.addEventListener('change', function () {
          boxes.forEach(function (box) {
            box.checked = everything.checked;
            box.dispatchEvent(new Event('change'));
          });
        });
        attachChosen.addEventListener('click', async function () {
          attachChosen.disabled = true;
          try {
            for (const id of Array.from(chosen)) {
              await tools.attach(entryId, id);
            }
            await renderPlasmid();
          } catch (error) {
            fail(error);
            await renderPlasmid();
          }
        });
        bar.append(everything, element('span', 'ml-2 mr-2', 'Select all'), attachChosen);
        suggestions.append(bar);
        found.forEach(function (match) {
          const line = element('label', 'primers-suggestion d-block');
          const box = element('input');
          box.type = 'checkbox';
          box.checked = true;
          box.addEventListener('change', function () {
            if (box.checked) {
              chosen.add(match.primer.id);
            } else {
              chosen.delete(match.primer.id);
            }
            everything.checked = chosen.size === found.length;
            refreshBar();
          });
          boxes.push(box);
          const link = element('a', '', match.primer.title);
          link.href = viewUrl(match.primer.id);
          line.append(box, document.createTextNode(' '), link, element('span', 'text-muted', ' ' + match.sites.map(siteText).join('; ')));
          suggestions.append(line);
        });
        refreshBar();
      });
      controls.append(find);
    }
    const suggestions = element('div', 'primers-suggestions');
    root.append(controls, suggestions, message);
  }

  async function renderPrimer() {
    const state = await tools.attached(entryId);
    root.textContent = '';
    const columns = element('div', 'lineage-columns');

    const plasmids = element('div', 'lineage-column');
    plasmids.append(element('h4', '', 'Attached to these plasmids'));
    state.plasmids.forEach(function (plasmid) {
      const chip = element('span', 'lineage-chip');
      const dot = element('span', 'lineage-dot');
      dot.style.backgroundColor = plasmid.color ? '#' + plasmid.color : '#bdbdbd';
      const link = element('a', '', plasmid.title);
      link.href = viewUrl(plasmid.id);
      chip.append(dot, link);
      const remove = element('button', '', '×');
      remove.type = 'button';
      remove.title = 'Detach from this plasmid';
      remove.addEventListener('click', async function () {
        try {
          await tools.detach(plasmid.id, entryId);
          await renderPrimer();
        } catch (error) {
          fail(error);
        }
      });
      chip.append(remove);
      plasmids.append(chip);
    });
    if (state.plasmids.length === 0) {
      plasmids.append(element('p', 'text-muted mb-1', 'Not attached to a plasmid yet.'));
    }
    plasmids.append(search('Attach to a plasmid...', async function (term) {
      const response = await fetch('api/v2/inventory?limit=12&q=' + encodeURIComponent(term), { credentials: 'same-origin' });
      const entries = response.ok ? await response.json() : [];
      return entries.filter(function (entry) {
        return entry.id !== entryId && /^plasmids?$/i.test(entry.category_title || '');
      }).map(function (entry) {
        return { id: entry.id, title: entry.title, category: entry.category_title };
      });
    }, async function (entry) {
      try {
        await tools.attach(entry.id, entryId);
        await renderPrimer();
      } catch (error) {
        fail(error);
      }
    }));

    const orders = element('div', 'lineage-column');
    orders.append(element('h4', '', 'Orders'));
    state.orders.forEach(function (order) {
      const chip = element('span', 'lineage-chip');
      const link = element('a', '', order.title);
      link.href = 'orders.php';
      chip.append(link, element('small', 'text-muted', order.status));
      orders.append(chip);
    });
    if (state.orders.length === 0) {
      orders.append(element('p', 'text-muted mb-1', 'Not in an order.'));
    }
    const send = element('button', 'btn btn-secondary btn-sm', 'Send to an order');
    send.type = 'button';
    send.addEventListener('click', function () {
      tools.sendToOrder([entryId], renderPrimer);
    });
    orders.append(send);

    columns.append(plasmids, orders);
    root.append(columns, message);
  }

  const run = mode === 'primer' ? renderPrimer : renderPlasmid;
  run().catch(function (error) {
    root.textContent = error.message || String(error);
  });
})();
