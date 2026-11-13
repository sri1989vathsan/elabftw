/**
 * Gibson / In-Fusion / NEBuilder HiFi part of the Tools panel (tools-tab.js): the sequence in the editor is the vector, opened at the
 * selection (which is replaced) or at the cursor (nothing is removed); the insert is a sequence of the Database or pasted bases. The tool
 * designs the two primers with the overlap tails (cloning-engine.js), shows the plasmid that comes out and can save it as an entry made
 * from the vector and the insert. Needs cloning-engine.js, tools-pcr.js (the save form) and primer-tools.js.
 */
(function () {
  'use strict';
  if (!window.ToolsTab || !window.PrimerTools || !window.CloningEngine || !window.CloningInsert || !window.ToolsPcr) {
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

  function build(editor, context) {
    const box = element('div', 'tools-block');
    box.append(element('p', 'tool-muted', 'Puts an insert into this plasmid by overlaps (Gibson, In-Fusion, NEBuilder HiFi). Select the bases of the vector that are replaced, or click where the insert goes. The vector is opened there (cut it with enzymes or amplify it by PCR), and each primer of the insert gets a tail equal to the vector next to the place.'));

    const method = element('select', 'tools-select');
    Object.keys(engine.METHODS).forEach(function (key) {
      method.append(Object.assign(element('option', '', engine.METHODS[key].label + ', overlap ' + engine.METHODS[key].overlap + ' bases'), { value: key }));
    });
    method.value = 'infusion';

    const picker = window.CloningInsert.create();
    let insertEntry = null;

    const result = element('div');
    const go = element('button', 'tool-btn tool-btn-primary', 'Design the primers');
    go.type = 'button';
    go.addEventListener('click', function () {
      result.textContent = '';
      const fail = function (text) {
        result.append(element('p', 'tool-message error', text));
      };
      const state = editor.getState();
      const vectorData = state.sequenceData;
      const selection = state.selectionLayer || {};
      const hasSelection = selection.start >= 0 && selection.end >= 0;
      if (!hasSelection && !(state.caretPosition >= 0)) {
        fail('Select the bases that are replaced, or click where the insert goes.');
        return;
      }
      const chosenInsert = picker.get();
      if (!chosenInsert) {
        fail('Choose the insert: search the Database or type its bases.');
        return;
      }
      const insertData = chosenInsert.data;
      insertEntry = chosenInsert.entry;
      const from = hasSelection ? selection.start : state.caretPosition;
      const to = hasSelection ? selection.end + 1 : state.caretPosition;
      let design;
      try {
        design = engine.designHomology({
          vector: vectorData.sequence,
          circular: !!vectorData.circular,
          from: from,
          to: to,
          insert: insertData.sequence,
          overlap: engine.METHODS[method.value].overlap,
          tm: tools.tm,
        });
      } catch (error) {
        fail(error.message || String(error));
        return;
      }
      const label = engine.METHODS[method.value].label;
      const insertName = (insertEntry && insertEntry.title) || 'insert';
      result.append(element('p', 'tool-muted', label + ': the plasmid is ' + design.productLength + ' bp (the vector has ' + vectorData.sequence.length + ' bp, the insert ' + insertData.sequence.length + ').'));
      const primerIds = [];
      [['forward', 'F'], ['reverse', 'R']].forEach(function (pair) {
        const primer = design[pair[0]];
        const card = element('div', 'tool-card');
        card.append(element('strong', '', insertName + ' ' + label + ' ' + pair[1] + ' (' + primer.length + ' b)'));
        const bases = element('div', 'tools-out');
        const tail = element('span', '', primer.tail);
        tail.style.color = 'var(--text-accent, #1a5fb4)';
        tail.title = 'tail: the vector';
        bases.append(tail, document.createTextNode(primer.binding));
        card.append(bases, element('div', 'tool-muted', 'tail ' + primer.tail.length + ' b (blue), binds the insert ' + primer.binding.length + ' b, Tm of the binding part ' + primer.tm + ' °C'));
        const actions = element('div', 'tool-actions');
        const copy = element('button', 'tool-btn', 'Copy');
        copy.type = 'button';
        copy.addEventListener('click', function () {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(primer.sequence).then(function () {
              copy.textContent = 'Copied';
            });
          }
        });
        actions.append(copy);
        card.append(actions);
        result.append(card);
      });
      result.append(element('div', 'tool-muted', 'Overlap of the vector ends: ' + design.overlapTm + ' °C on the left, ' + design.overlapTmRight + ' °C on the right.'));
      design.warnings.forEach(function (text) {
        result.append(element('p', 'tool-message error', text));
      });
      const actions = element('div', 'tool-actions');
      const addPrimers = element('button', 'tool-btn', 'Add the primers to the Database');
      addPrimers.type = 'button';
      addPrimers.addEventListener('click', async function () {
        addPrimers.disabled = true;
        addPrimers.textContent = 'Adding...';
        try {
          const target = insertEntry ? insertEntry.title : 'insert';
          const forwardId = await tools.createPrimer(insertName + ' ' + label + ' F', design.forward.sequence, true, target);
          const reverseId = await tools.createPrimer(insertName + ' ' + label + ' R', design.reverse.sequence, false, target);
          primerIds.push({ id: forwardId }, { id: reverseId });
          addPrimers.textContent = 'Primers added';
        } catch (error) {
          addPrimers.textContent = error.message || String(error);
          addPrimers.disabled = false;
        }
      });
      const save = element('button', 'tool-btn', 'Save the plasmid as a new entry');
      save.type = 'button';
      save.addEventListener('click', function () {
        save.disabled = true;
        const utils = window.sequenceUtils;
        const product = utils.insertSequenceDataAtPositionOrRange(insertData, vectorData, hasSelection ? { start: selection.start, end: selection.end } : state.caretPosition);
        const parents = [context.entryId, insertEntry && insertEntry.id].filter(function (id, index, list) {
          return id && list.indexOf(id) === index;
        });
        window.ToolsPcr.saveEntryForm(result, {
          name: String(context.name || 'plasmid').replace(/\.[^.]+$/, '') + ' + ' + insertName + ' (' + label + ')',
          genbank: function (fileName) {
            return window.bioParsers.jsonToGenbank(Object.assign({}, product, { name: fileName, circular: true }));
          },
          parents: parents,
          parentLabel: 'Made from the vector' + (insertEntry ? ' and the insert' : ''),
          primers: primerIds,
          primersLabel: 'Attach the two primers (add them to the Database first)',
          saveLabel: 'Save the plasmid',
        });
      });
      actions.append(addPrimers, save);
      result.append(actions);
    });

    box.append(method, picker.node, go, result);
    return box;
  }

  window.ToolsTab.add({ id: 'gibson', title: 'Gibson / In-Fusion cloning', build: build });
})();
