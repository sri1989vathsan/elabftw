/**
 * Set the origin of a circular sequence: makes the base where the user right-clicked (or the start of a feature or of the
 * selection) the first base. Features, parts and primers move with the bases; the entry is saved with the change like any
 * other edit, and an Undo button stays on the page for a few seconds. The menu items are given to the editor as right-click
 * overrides (see viewer.js). Needs the sequence utilities of the editor. Exposed as window.OriginTab.
 */
(function () {
  'use strict';
  let editor = null;
  let toast = null;
  let toastTimer = 0;

  function say(text, undo) {
    if (toast) {
      toast.remove();
    }
    window.clearTimeout(toastTimer);
    toast = document.createElement('div');
    toast.className = 'origin-toast';
    toast.setAttribute('role', 'status');
    toast.append(document.createTextNode(text));
    if (undo) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Undo';
      button.addEventListener('click', function () {
        toast.remove();
        undo();
      });
      toast.append(button);
    }
    document.body.append(toast);
    toastTimer = window.setTimeout(function () {
      toast.remove();
    }, 9000);
  }

  // position: 1-based, the base that becomes the first one
  function rotateAt(position, restoring) {
    const utils = window.sequenceUtils;
    if (!editor || !utils || typeof utils.rotateSequenceDataToPosition !== 'function') {
      return;
    }
    const data = editor.getState().sequenceData;
    const length = String(data.sequence || '').length;
    if (!data.circular || position <= 1 || position > length) {
      return;
    }
    editor.updateEditor({ sequenceData: utils.rotateSequenceDataToPosition(data, position - 1), selectionLayer: { start: -1, end: -1 }, caretPosition: -1 });
    // going back is the turn by the rest of the length
    if (restoring) {
      say('Origin restored.');
      return;
    }
    say('Base ' + position + ' is now position 1.', function () {
      rotateAt(length - position + 2, true);
    });
  }

  /**
   * An item of the right-click menu: "Set origin here", for the 0-based position of the click. Nothing for a linear sequence
   * or a sequence that is read only.
   */
  function menuItem(zeroBased, label) {
    return {
      text: label || 'Set origin here (this base becomes position 1)',
      onClick: function () {
        rotateAt(zeroBased + 1);
      },
    };
  }

  function usable(props) {
    return !!props && !props.readOnly && !!props.sequenceData && !!props.sequenceData.circular;
  }

  // the right-click overrides for the editor: the origin in the menu of the sequence, of a feature and of a selection
  function overrides() {
    return {
      // the menu of the editor has "Rotate To Caret Position": this is the same thing, worded as what it does
      backgroundRightClicked: function (items, opts, props) {
        if (!usable(props) || typeof opts.nearestCaretPos !== 'number') {
          return items;
        }
        const out = items.map(function (item) {
          return item === 'rotateToCaretPosition' ? menuItem(opts.nearestCaretPos) : item;
        });
        out._event = items._event;
        return out;
      },
      featureRightClicked: function (items, opts, props) {
        return usable(props) && opts.annotation ? items.concat([menuItem(opts.annotation.start, 'Set origin at the start of this feature')]) : items;
      },
      selectionLayerRightClicked: function (items, opts, props) {
        return usable(props) && opts.annotation && opts.annotation.start >= 0 ? items.concat([menuItem(opts.annotation.start, 'Set origin at the start of the selection')]) : items;
      },
    };
  }

  function setup(editorInstance) {
    editor = editorInstance;
  }

  window.OriginTab = { setup: setup, rotateAt: rotateAt, overrides: overrides };
})();
