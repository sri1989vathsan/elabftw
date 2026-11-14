/**
 * Gibson / In-Fusion / NEBuilder HiFi part of the Tools panel: a vector (an open plasmid), opened at its selection or cursor, and one or
 * several inserts in order, each an open plasmid (its selection if it has one, else the whole of it), a file or typed bases. The tool designs the primers with the overlap tails (cloning-engine.js), shows the plasmid that comes out and
 * offers it as a new tab; every plasmid it was made from is a parent. Needs cloning-engine.js, cloning-source.js, cloning-output.js and
 * seq-tools.js.
 */
(function () {
  'use strict';
  if (!window.ToolsTab || !window.PrimerTools || !window.CloningEngine || !window.CloningSource || !window.CloningOutput) {
    return;
  }
  const tools = window.PrimerTools;
  const engine = window.CloningEngine;

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

  function build() {
    const box = element('div', 'tools-block');
    box.append(element('p', 'tool-muted', 'Put inserts into a vector by overlaps. Open the plasmid in the editor, select the bases to replace (or click where the inserts go) and click This plasmid under Vector. Then, for each insert, open its plasmid, select what you want and click Add the selection (or Add this plasmid).'));

    const method = element('select', 'tools-select');
    Object.keys(engine.METHODS).forEach(function (key) {
      method.append(Object.assign(element('option', '', engine.METHODS[key].label + ', overlap ' + engine.METHODS[key].overlap + ' bases'), { value: key }));
    });
    method.value = 'infusion';

    const vector = window.CloningSource.create({ label: 'Vector', ring: true, place: true });
    const inserts = window.CloningSource.createList({ label: 'Inserts, in order', single: 'Insert' });
    const result = element('div');
    const go = element('button', 'tool-btn tool-btn-primary', 'Design the primers');
    go.type = 'button';
    go.addEventListener('click', function () {
      result.textContent = '';
      const fail = function (text) {
        result.append(element('p', 'tool-message error', text));
      };
      let v;
      let chosen;
      let from;
      let to;
      try {
        v = vector.get();
        chosen = inserts.get();
        if (!v.place) {
          throw new Error('The vector has to be a plasmid that is open: click This plasmid after choosing where the inserts go.');
        }
        from = v.place.from;
        to = v.place.to;
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      const key = method.value;
      let design;
      try {
        design = engine.designHomologyMulti({ vector: v.data.sequence, circular: !!v.data.circular, from: from, to: to, inserts: chosen.map(function (item) {
          return item.data.sequence;
        }), overlap: engine.METHODS[key].overlap, tm: tools.tm });
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      const label = engine.METHODS[key].label;
      const insertNames = chosen.map(function (item, index) {
        return item.name + (item.description && !/whole/.test(item.description) ? ' (selection)' : '');
      });
      result.append(element('p', 'tool-muted', label + ': the plasmid is ' + design.productLength + ' bp (the vector has ' + v.data.sequence.length + ' bp, ' + (chosen.length > 1 ? 'the ' + chosen.length + ' inserts have ' : 'the insert has ') + chosen.reduce(function (sum, item) {
        return sum + item.data.sequence.length;
      }, 0) + ' bp).'));
      const csv = [['name', 'sequence', 'length', 'tail', 'binding', 'binding Tm']];
      design.inserts.forEach(function (item, index) {
        [['forward', 'F'], ['reverse', 'R']].forEach(function (pair) {
          const primer = item[pair[0]];
          const title = insertNames[index] + ' ' + label + ' ' + pair[1];
          csv.push([title, primer.sequence, primer.length, primer.tail, primer.binding, primer.tm]);
          const card = element('div', 'tool-card');
          card.append(element('strong', '', title + ' (' + primer.length + ' b)'));
          const bases = element('div', 'tools-out');
          const tail = element('span', '', primer.tail);
          tail.style.color = 'var(--text-accent, #1a5fb4)';
          tail.title = 'tail: ' + (pair[0] === 'forward' && index > 0 ? 'the end of the previous insert' : 'the vector');
          bases.append(tail, document.createTextNode(primer.binding));
          card.append(bases, element('div', 'tool-muted', primer.tail.length ? 'tail ' + primer.tail.length + ' b (blue), binds the insert ' + primer.binding.length + ' b, Tm of the binding part ' + primer.tm + ' °C' : 'no tail, binds the insert ' + primer.binding.length + ' b, Tm ' + primer.tm + ' °C'));
          const copy = element('button', 'tool-btn', 'Copy');
          copy.type = 'button';
          copy.addEventListener('click', function () {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(primer.sequence).then(function () {
                copy.textContent = 'Copied';
              });
            }
          });
          card.append(copy);
          result.append(card);
        });
      });
      result.append(element('div', 'tool-muted', 'Overlaps: ' + design.overlaps.map(function (item) {
        return item.between + ' ' + item.tm + ' °C';
      }).join('; ') + '.'));
      design.warnings.forEach(function (text) {
        result.append(element('p', 'tool-message error', text));
      });
      const actions = element('div', 'tool-actions');
      const download = element('button', 'tool-btn', 'Download the primers (CSV)');
      download.type = 'button';
      download.addEventListener('click', function () {
        window.CloningOutput.download('gibson-primers.csv', csv.map(function (row) {
          return row.join(',');
        }).join('\n') + '\n');
      });
      actions.append(download);
      result.append(actions);

      // the final plasmid, with the primers drawn on it, made from the vector and the plasmids the inserts come from
      const combined = engine.combinePieces(chosen.map(function (item) {
        return item.data;
      }));
      const vectorData = v.data;
      const product = window.sequenceUtils.insertSequenceDataAtPositionOrRange(combined, { sequence: vectorData.sequence, features: vectorData.features, circular: true }, from === to ? from : { start: from, end: (to - 1 + vectorData.sequence.length) % vectorData.sequence.length });
      if (to >= from) {
        const primerFeatures = engine.homologyPrimerFeatures(design, insertNames, from, chosen.map(function (item) {
          return item.data.sequence.length;
        }), product.sequence.length);
        // the editor's insert gives its features as an array: the primers are added as items of it
        if (Array.isArray(product.features)) {
          Object.keys(primerFeatures).forEach(function (key) {
            product.features.push(primerFeatures[key]);
          });
        } else {
          Object.assign(product.features, primerFeatures);
        }
      } else {
        result.append(element('p', 'tool-message error', 'The primers are not drawn on the plasmid: the selection runs over the origin of the vector.'));
      }
      window.CloningOutput.offer(result, {
        info: window.CloningOutput.info(product.sequence, product.features),
        primers: csv.slice(1).map(function (row) {
          return { name: row[0], sequence: row[1] };
        }),
        name: v.name + ' + ' + insertNames.join(' + ') + ' (' + label + ')',
        genbank: function (fileName) {
          return window.bioParsers.jsonToGenbank(Object.assign({}, product, { name: fileName, circular: true, primers: {}, parts: {}, translations: {} }));
        },
        parents: [v].concat(chosen).map(function (item) {
          return { id: item.id, name: item.name };
        }),
      });
    });

    box.append(method, vector.node, inserts.node, go, result);
    return box;
  }

  window.ToolsTab.add({ id: 'gibson', title: 'Gibson / In-Fusion cloning', build: build });
})();
