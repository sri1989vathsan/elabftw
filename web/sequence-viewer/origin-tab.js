/**
 * The origin tool of the sidebar: makes another position of a circular sequence the first base (position 1). The features,
 * parts and primers move with the bases; the sequence of the entry is saved with the change like any other edit.
 * Needs the sequence utilities of the editor (vendor/sequence-utils.umd.js). Exposed as window.OriginTab.
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

  function setup(editor) {
    const utils = window.sequenceUtils;
    if (!window.ToolSidebar || !utils || typeof utils.rotateSequenceDataToPosition !== 'function') {
      return;
    }
    let message = '';
    // the last change, to be able to go back: the position that was the first base
    let last = null;

    // the position of the caret or of the start of the selection (1-based), 0 when there is none
    const picked = function () {
      const state = editor.getState();
      const selection = state.selectionLayer || { start: -1 };
      if (selection.start >= 0) {
        return selection.start + 1;
      }
      return typeof state.caretPosition === 'number' && state.caretPosition >= 0 ? state.caretPosition + 1 : 0;
    };

    function rotate(position) {
      const data = editor.getState().sequenceData;
      const length = String(data.sequence || '').length;
      if (!data.circular) {
        message = 'Only a circular sequence has an origin.';
        return false;
      }
      if (!Number.isInteger(position) || position < 1 || position > length) {
        message = 'The position has to be between 1 and ' + length + '.';
        return false;
      }
      if (position === 1) {
        message = 'This position is already the first base.';
        return false;
      }
      // the base at "position" becomes the base 1
      editor.updateEditor({ sequenceData: utils.rotateSequenceDataToPosition(data, position - 1), selectionLayer: { start: -1, end: -1 } });
      last = { length: length, position: position };
      message = 'Position ' + position + ' is now position 1.';
      return true;
    }

    function show(host) {
      const data = editor.getState().sequenceData;
      const length = String(data.sequence || '').length;
      host.append(element('p', 'tool-muted', length + ' bases, ' + (data.circular ? 'circular' : 'linear') + '. Select a base on the sequence or the map (a click or a selection), then make it the first base.'));
      if (!data.circular) {
        host.append(element('p', 'tool-message', 'Only a circular sequence has an origin.'));
        return;
      }
      const row = element('div', 'tool-actions');
      const input = element('input', 'tool-input');
      input.type = 'number';
      input.min = '1';
      input.max = String(length);
      input.placeholder = 'Position';
      input.value = picked() > 0 ? String(picked()) : '';
      input.setAttribute('aria-label', 'Position to make the first base');
      const use = element('button', 'tool-btn', 'Use the selection');
      use.type = 'button';
      use.addEventListener('click', function () {
        input.value = picked() > 0 ? String(picked()) : '';
      });
      row.append(input, use);
      const go = element('button', 'tool-btn tool-btn-primary', 'Make it position 1');
      go.type = 'button';
      go.addEventListener('click', function () {
        if (rotate(Number(input.value))) {
          host.textContent = '';
          show(host);
        } else {
          note.textContent = message;
          note.className = 'tool-message error';
        }
      });
      const note = element('p', 'tool-message', message);
      host.append(row, go);
      if (last) {
        const undo = element('button', 'tool-btn', 'Undo: back to the earlier first base');
        undo.type = 'button';
        undo.addEventListener('click', function () {
          // going back is a turn by the rest of the length
          const back = last.length - last.position + 2;
          last = null;
          rotate(back);
          host.textContent = '';
          show(host);
        });
        host.append(undo);
      }
      host.append(note, element('p', 'tool-muted', 'The sequence of the entry is saved with the change. Primers keep their place on the bases; the numbers of the features change.'));
    }
    window.ToolSidebar.register({ id: 'origin', icon: 'origin', label: 'Set the origin (position 1)', show: show });
  }

  window.OriginTab = { setup: setup };
})();
