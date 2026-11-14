/**
 * Gateway parts of the Tools panel: the recombination (BP: attB with attP gives an entry clone; LR: attL with attR gives an expression
 * clone) of a donor that carries the gene and a recipient vector, both open plasmids (or a file, an example, typed bases), and the attB
 * primers that put the two attB sites round a gene for a BP reaction. Results are offered as new tabs that know their parents.
 * Needs cloning-engine.js, cloning-source.js and cloning-output.js.
 */
(function () {
  'use strict';
  if (!window.ToolsTab || !window.PrimerTools || !window.CloningEngine || !window.CloningSource || !window.CloningOutput) {
    return;
  }
  const engine = window.CloningEngine;
  const source = window.CloningSource;
  const tools = window.PrimerTools;

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

  function recombination() {
    const box = element('div', 'tools-block');
        box.append(element('p', 'tool-muted', 'BP: attB with attP gives an entry clone. LR: attL with attR gives an expression clone. Open the donor in the editor and click This plasmid (or select the gene and click Selection), then the same for the recipient vector.'));
    const donor = source.create({ label: 'Donor (carries the gene)' });
    const recipient = source.create({ label: 'Recipient vector', ring: true });
    const result = element('div');
    const go = element('button', 'tool-btn tool-btn-primary', 'Recombine');
    go.type = 'button';
    go.addEventListener('click', function () {
      result.textContent = '';
      const fail = function (text) {
        result.append(element('p', 'tool-message error', text));
      };
      let d;
      let r;
      try {
        d = donor.get();
        r = recipient.get();
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      let design;
      try {
        design = engine.designGateway({
          donor: { sequence: d.data.sequence, features: d.data.features, circular: !!d.data.circular },
          recipient: { sequence: r.data.sequence, features: r.data.features, circular: !!r.data.circular },
        });
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      const kind = design.reaction === 'BP' ? 'BP reaction: entry clone' : 'LR reaction: expression clone';
      const card = element('div', 'tool-card');
      card.append(element('strong', '', kind + ', ' + design.clone.length + ' bp'));
      card.append(element('div', 'tool-muted', 'Sites in the donor: ' + design.donor.sites.join(', ') + '. Sites in the recipient: ' + design.recipient.sites.join(', ') + '. The new plasmid has ' + design.clone.sites.join(' and ') + '. ' + design.donor.cassette + ' bp from the donor replace ' + design.recipient.replaced + ' bp of the recipient' + (design.recipient.hasCcdB ? ' (it held ccdB).' : '.')));
      const parents = [d, r].map(function (item) {
        return { id: item.id, name: item.name };
      });
      const name = d.name + ' in ' + r.name + ' (' + design.reaction + ')';
      const toGenbank = function (sequence, features) {
        return function (fileName) {
          return window.bioParsers.jsonToGenbank({ name: fileName, circular: true, sequence: sequence, features: features, primers: {}, parts: {}, translations: {} });
        };
      };
        window.CloningOutput.offer(card, { title: design.reaction === 'BP' ? 'Final plasmid (entry clone)' : 'Final plasmid (expression clone)', info: window.CloningOutput.info(design.clone.sequence, design.clone.features), name: name, genbank: toGenbank(design.clone.sequence, design.clone.features), parents: parents });
      result.append(card);
      if (design.byproduct) {
        const other = element('div', 'tool-card');
        other.append(element('strong', '', 'By-product, ' + design.byproduct.length + ' bp'), element('div', 'tool-muted', 'It has ' + design.byproduct.sites.join(' and ') + ' and holds the part that left the recipient (ccdB kills the cells that take it up).'));
          window.CloningOutput.offer(other, { title: 'By-product', info: window.CloningOutput.info(design.byproduct.sequence, {}), name: name + ' by-product', genbank: toGenbank(design.byproduct.sequence, {}), parents: parents });
        result.append(other);
      }
      design.warnings.forEach(function (text) {
        result.append(element('p', 'tool-message error', text));
      });
    });
    box.append(donor.node, recipient.node, go, result);
    return box;
  }

  function attbPrimers() {
    const box = element('div', 'tools-block');
        box.append(element('p', 'tool-muted', 'Primers that put attB sites round a gene for a BP reaction. Select the gene in its plasmid and click Selection (or This plasmid for all of it).'));
    const gene = source.create({ label: 'Gene' });
    const sites = element('div');
    const up = element('select', 'tools-select');
    const down = element('select', 'tools-select');
    [up, down].forEach(function (select, index) {
      for (let n = 1; n <= 6; n++) {
        select.append(Object.assign(element('option', '', (index === 0 ? '5′ site: attB' : '3′ site: attB') + n), { value: String(n) }));
      }
    });
    up.value = '1';
    down.value = '2';
    const pad = element('input');
    pad.type = 'text';
    pad.value = 'GGGG';
    pad.title = 'Bases 5′ of the attB site';
    const extraForward = element('input');
    extraForward.type = 'text';
    extraForward.placeholder = 'Extra bases after the 5′ attB site (optional)';
    const extraReverse = element('input');
    extraReverse.type = 'text';
    extraReverse.placeholder = 'Extra bases after the 3′ attB site (optional)';
    sites.append(up, down, element('div', 'tool-muted', '5′ pad'), pad, extraForward, extraReverse);
    const result = element('div');
    const go = element('button', 'tool-btn tool-btn-primary', 'Design the primers');
    go.type = 'button';
    go.addEventListener('click', function () {
      result.textContent = '';
      const fail = function (text) {
        result.append(element('p', 'tool-message error', text));
      };
      let g;
      let design;
      try {
        g = gene.get();
        design = engine.designAttBPrimers({
          sequence: g.data.sequence,
          from: 0,
          to: g.data.sequence.length,
          upstream: Number(up.value),
          downstream: Number(down.value),
          pad: pad.value,
          extraForward: extraForward.value,
          extraReverse: extraReverse.value,
          tm: tools.tm,
        });
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      const csv = [['name', 'sequence', 'length', 'binding Tm']];
      [['forward', 'F'], ['reverse', 'R']].forEach(function (pair) {
        const primer = design[pair[0]];
        const title = g.name + ' attB' + (pair[0] === 'forward' ? up.value : down.value) + ' ' + pair[1];
        csv.push([title, primer.sequence, primer.length, primer.tm]);
        const card = element('div', 'tool-card');
        card.append(element('strong', '', title + ' (' + primer.length + ' b)'), element('div', 'tools-out', primer.sequence), element('div', 'tool-muted', 'binds the gene over ' + primer.binding.length + ' b, Tm of the binding part ' + primer.tm + ' °C'));
        result.append(card);
      });
      result.append(element('p', 'tool-muted', 'The PCR product is ' + design.product.length + ' bp, ready as a donor for a BP reaction.'));
      design.warnings.forEach(function (text) {
        result.append(element('p', 'tool-message error', text));
      });
      const actions = element('div', 'tool-actions');
      const download = element('button', 'tool-btn', 'Download the primers (CSV)');
      download.type = 'button';
      download.addEventListener('click', function () {
        window.CloningOutput.download('attB-primers.csv', csv.map(function (row) {
          return row.join(',');
        }).join('\n') + '\n');
      });
      actions.append(download);
      result.append(actions);
      // the PCR product, with the two primers drawn on it, made from the plasmid the gene comes from
      const features = engine.attbPrimerFeatures(design, [g.name + ' attB' + up.value + ' F', g.name + ' attB' + down.value + ' R']);
      // the features of the plasmid the gene comes from, moved to where the gene is in the product (after the pad, the attB site and the extra bases)
      const shift = design.forward.length - design.forward.binding.length;
      Object.keys(g.data.features || {}).forEach(function (key, index) {
        const feature = g.data.features[key];
        if (feature && feature.start <= feature.end) {
          features['source' + index] = Object.assign({}, feature, { id: 'source' + index, start: feature.start + shift, end: feature.end + shift });
        }
      });
      window.CloningOutput.offer(result, {
        title: 'PCR product',
        primers: csv.slice(1).map(function (row) {
          return { name: row[0], sequence: row[1] };
        }),
        info: window.CloningOutput.info(design.product, features),
        name: g.name + ' attB PCR product',
        genbank: function (fileName) {
          return window.bioParsers.jsonToGenbank({ name: fileName, circular: false, sequence: design.product, features: features, primers: {}, parts: {}, translations: {} });
        },
        parents: [{ id: g.id, name: g.name }],
      });
    });
    box.append(gene.node, sites, go, result);
    return box;
  }

  window.ToolsTab.add({ id: 'gateway', title: 'Gateway recombination (BP / LR)', build: recombination });
  window.ToolsTab.add({ id: 'gateway-primers', title: 'Gateway attB primers', build: attbPrimers });
})();
