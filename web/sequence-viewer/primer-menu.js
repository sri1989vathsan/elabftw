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
    menu.append(item('Edit primer', function () {
      window.OligoEditor.open(id);
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

  // ---- the menu of the editor on a primer of the file (right click): when the primer is in the Database too, "Edit oligo" is added to it, the
  // panel that changes the primer of the Database (name, bases, place, overhang). A primer that is only in the file keeps the dialog of the
  // editor. The primer is found in the Database by its bases (either strand), then by its name.
  let lastFilePrimer = null;
  document.addEventListener('contextmenu', function (event) {
    const holder = event.target.closest && event.target.closest('svg.veRowViewAnnotationPosition');
    const g = event.target.closest && (event.target.closest('g.veRowViewPrimer') || (holder && holder.querySelector(':scope > g.veRowViewPrimer')));
    lastFilePrimer = g && g.dataset.id && !/^dbprimer-/.test(g.dataset.id) ? g.dataset.id : null;
  }, true);

  async function databasePrimerFor(id) {
    const tools = window.PrimerTools;
    const editor = window.sequenceEditor;
    if (!tools || !editor) {
      return null;
    }
    const data = editor.getState().sequenceData;
    const primers = data.primers || {};
    const primer = primers[id] || Object.keys(primers).map(function (key) {
      return primers[key];
    }).find(function (candidate) {
      return candidate.id === id;
    });
    if (!primer) {
      return null;
    }
    let bases = tools.clean(data.sequence).slice(primer.start, primer.end + 1);
    if (primer.strand === -1 || primer.forward === false) {
      bases = tools.reverseComplement(bases);
    }
    const reverse = tools.reverseComplement(bases);
    const list = await tools.allPrimers();
    return list.find(function (entry) {
      return entry.sequence === bases || entry.sequence === reverse;
    }) || list.find(function (entry) {
      return String(entry.title).toLowerCase() === String(primer.name || '').toLowerCase();
    }) || null;
  }

  new MutationObserver(function (changes) {
    if (!lastFilePrimer) {
      return;
    }
    changes.forEach(function (change) {
      change.addedNodes.forEach(function (node) {
        if (!(node instanceof Element)) {
          return;
        }
        const list = node.matches('.bp3-menu') ? node : node.querySelector('.bp3-menu');
        if (!list || list.dataset.oligoAdded || !/Primer/.test(list.textContent)) {
          return;
        }
        list.dataset.oligoAdded = '1';
        const id = lastFilePrimer;
        databasePrimerFor(id).then(function (found) {
          if (!found || !document.body.contains(list)) {
            return;
          }
          const li = document.createElement('li');
          const link = document.createElement('a');
          link.className = 'bp3-menu-item bp3-popover-dismiss';
          link.tabIndex = 0;
          const label = document.createElement('div');
          label.className = 'bp3-fill bp3-text-overflow-ellipsis';
          // one entry for the primer, as in the menu of a primer drawn from the Database: the dialog of the editor (it changes the annotation of the
          // file only) is not offered next to it, the panel shows the place and changes the primer of the Database
          label.textContent = 'Edit primer';
          label.title = found.title + ' in the Database';
          Array.from(list.querySelectorAll('li')).forEach(function (row) {
            if (/^(Edit Primer|View Primer Details)$/.test(row.textContent.trim())) {
              row.style.display = 'none';
            }
          });
          link.append(label);
          // the menu of the editor closes when the mouse goes down on it (before a click comes): the panel opens on the mouse down, or on Enter
          let done = false;
          const open = function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (done) {
              return;
            }
            done = true;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const popover = list.closest('.bp3-portal') || list.closest('.bp3-popover');
            if (popover) {
              popover.style.display = 'none';
            }
            window.OligoEditor.open(found.id);
          };
          link.addEventListener('mousedown', open);
          link.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
              open(event);
            }
          });
          li.append(link);
          list.prepend(li);
          // the text starts where the text of the other items starts (they have a column for an icon, this one has none)
          const others = Array.from(list.querySelectorAll('a.bp3-menu-item')).filter(function (node) {
            return node !== link && node.offsetParent !== null && node.querySelector('div');
          });
          if (others.length > 0) {
            const ref = others[0];
            const refLabel = ref.querySelector('div');
            const shift = (refLabel.getBoundingClientRect().left - ref.getBoundingClientRect().left) - (label.getBoundingClientRect().left - link.getBoundingClientRect().left);
            if (shift > 0) {
              label.style.paddingLeft = shift + 'px';
            }
          }
        }).catch(function () {
          // the menu stays as the editor made it
        });
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
