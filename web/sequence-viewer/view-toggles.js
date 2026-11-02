/**
 * What is shown on the maps, set apart for the two places: the maps on the left (circular and linear) and the sequence map on
 * the right. Each has its own buttons for the features, the primers, the cut sites and the translations, remembered in the
 * browser. The hiding is done by styles on the page (viewer.css, classes on the body), so the editor keeps everything drawn
 * and the sequence map can show what the maps do not. The circular map reads the settings of the maps through
 * window.ViewToggles.get('map', key). Exposed as window.ViewToggles.
 */
(function () {
  'use strict';
  const KEYS = [
    ['features', 'Features', 'Show or hide the features'],
    ['primers', 'Primers', 'Show or hide the primers'],
    ['sites', 'Sites', 'Show or hide the cut sites of the enzymes'],
    ['translations', 'Aa', 'Show or hide the translations (the amino acids of the genes)'],
    ['orfs', 'ORFs', 'Show or hide the open reading frames'],
  ];
  const STORE = 'sequence-editor-view-toggles';
  let state = { map: {}, seq: {} };
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORE) || '{}');
    state = { map: saved.map || {}, seq: saved.seq || {} };
  } catch (error) {
    state = { map: {}, seq: {} };
  }
  // the open reading frames start hidden: there are many of them
  const OFF_AT_FIRST = { orfs: true };
  const get = function (group, key) {
    return state[group][key] === undefined ? !OFF_AT_FIRST[key] : state[group][key];
  };

  // the editor draws the open reading frames when either place asks for them; the other place hides them with a style
  function syncEditor() {
    const editor = window.sequenceEditor;
    if (!editor) {
      return false;
    }
    const wanted = get('map', 'orfs') || get('seq', 'orfs');
    const now = editor.getState().annotationVisibility || {};
    if (!!now.orfs !== wanted) {
      editor.updateEditor({ annotationVisibility: { orfs: wanted } });
    }
    return true;
  }

  function apply() {
    ['map', 'seq'].forEach(function (group) {
      KEYS.forEach(function (key) {
        document.body.classList.toggle('hide-' + group + '-' + key[0], !get(group, key[0]));
      });
    });
    document.querySelectorAll('.view-toggles button').forEach(function (b) {
      b.classList.toggle('off', !get(b.dataset.group, b.dataset.key));
    });
  }

  function set(group, key, value) {
    state[group][key] = value;
    try {
      window.localStorage.setItem(STORE, JSON.stringify(state));
    } catch (error) {
      // not remembered
    }
    apply();
    syncEditor();
    window.dispatchEvent(new CustomEvent('view-toggles', { detail: { group: group, key: key } }));
  }

  // one button of a group
  function button(group, key) {
    const info = KEYS.find(function (k) {
      return k[0] === key;
    });
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = info[1];
    b.title = info[2];
    b.dataset.group = group;
    b.dataset.key = key;
    b.setAttribute('aria-label', info[2]);
    b.classList.toggle('off', !get(group, key));
    b.addEventListener('click', function (event) {
      event.stopPropagation();
      set(group, key, !get(group, key));
    });
    return b;
  }

  // the buttons of a group in a bar
  function bar(group, className) {
    const box = document.createElement('div');
    box.className = 'view-toggles ' + (className || '');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', group === 'map' ? 'Shown on the circular and linear map' : 'Shown on the sequence map');
    KEYS.forEach(function (key) {
      box.append(button(group, key[0]));
    });
    return box;
  }

  // the bars of the linear map and of the sequence map are put in their places when these are drawn
  function mount() {
    const linear = document.querySelector('.veLinearView');
    if (linear && !linear.querySelector(':scope > .view-toggles')) {
      linear.append(bar('map', 'view-toggles-linear'));
    }
    const rows = document.querySelector('.veRowView');
    if (rows && rows.parentNode && !rows.parentNode.querySelector(':scope > .view-toggles')) {
      rows.parentNode.append(bar('seq', 'view-toggles-seq'));
    }
  }

  apply();
  // the editor is made after this script: its open reading frames are set once it is there
  const waitForEditor = window.setInterval(function () {
    if (syncEditor()) {
      window.clearInterval(waitForEditor);
    }
  }, 300);
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  mount();

  window.ViewToggles = { get: get, set: set, button: button, bar: bar };
})();
