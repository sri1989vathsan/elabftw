/**
 * The right-click menu of a primer on the sequence map: for a primer of the database that is attached to the plasmid it offers
 * to look at its properties and change its name or sequence (its entry opens), to select where it binds and to detach it.
 * Needs primers-panel.js. The menu of the editor is not used for these primers: they are not part of the file.
 */
(function () {
  'use strict';
  let menu = null;

  function close() {
    if (menu) {
      menu.remove();
      menu = null;
    }
  }

  function item(label, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'primer-menu-item';
    b.textContent = label;
    b.addEventListener('click', function () {
      close();
      action();
    });
    return b;
  }

  document.addEventListener('contextmenu', function (event) {
    // the letters of an oligo are drawn beside its box, in the same svg
    const holder = event.target.closest && event.target.closest('svg.veRowViewAnnotationPosition');
    const g = event.target.closest && (event.target.closest('g.veRowViewPrimer') || (holder && holder.querySelector(':scope > g.veRowViewPrimer')));
    const match = g && /^dbprimer-(\d+)-/.exec(g.dataset.id || '');
    if (!match || !window.PrimerPanel || !window.PrimerPanel.detachPrimer) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    close();
    const id = Number(match[1]);
    const editor = window.sequenceEditor;
    const state = editor.getState();
    const drawn = (state.temporaryAnnotations && state.temporaryAnnotations.primers || {})[g.dataset.id];
    menu = document.createElement('div');
    menu.className = 'primer-menu';
    menu.setAttribute('role', 'menu');
    const title = document.createElement('div');
    title.className = 'primer-menu-title';
    title.textContent = drawn ? drawn.name : 'Primer';
    menu.append(title);
    if (drawn) {
      menu.append(item('Select where it binds', function () {
        editor.updateEditor({ selectionLayer: { start: drawn.start, end: drawn.end } });
      }));
    }
    menu.append(item('Edit primer (properties, name, sequence)', function () {
      window.open('../registry.php?mode=edit&id=' + id, '_blank', 'noopener');
    }));
    menu.append(item('Detach from this plasmid', function () {
      window.PrimerPanel.detachPrimer(id).catch(function (error) {
        window.alert(error.message || String(error));
      });
    }));
    document.body.append(menu);
    menu.style.left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8) + 'px';
  }, true);

  document.addEventListener('click', close);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      close();
    }
  });
  window.addEventListener('blur', close);
})();
