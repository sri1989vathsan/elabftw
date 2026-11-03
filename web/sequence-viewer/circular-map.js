/**
 * A circular map of the sequence of the editor, drawn here instead of the one of the editor (the choice "Classic" of the map
 * style gives that one back): a ring with arrows for the features, labels in two columns on lines, the enzymes of the filter as
 * ticks, the primers as a thin track, the selection, and details of what the pointer is on in the centre.
 *
 * It follows the editor: the sequence, the features, the selection, the filter of the enzymes and the primers drawn by the
 * primers tool. A click on a feature selects it, a drag on the ring selects a range, a right click offers "Set origin here".
 * Needs the sequence utilities (vendor/sequence-utils.umd.js) for the cut sites. Exposed as window.OwnMap.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const TAU = Math.PI * 2;
  // the most names of enzymes written on the map (the others are ticks with a tooltip)
  const MAX_SITE_LABELS = 12;

  function svgElement(tag, attributes, text) {
    const node = document.createElementNS(NS, tag);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, String(attributes[key]));
    });
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  // a name that was read as Latin-1 instead of UTF-8 ("Î±" for "α") is put right
  function repairText(text) {
    if (!/[ÂÃÎÏ][\u0080-\u00bf]/.test(text)) {
      return text;
    }
    try {
      return decodeURIComponent(escape(text));
    } catch (error) {
      return text;
    }
  }

  const listOf = function (value) {
    return Array.isArray(value) ? value : Object.values(value || {});
  };

  // ---- the cut sites of the enzymes the editor shows, worked out like the filter of the editor does it
  let cutCache = { key: '', sites: [] };

  function enzymePool() {
    const utils = window.sequenceUtils;
    const library = window.EnzymeLibrary ? window.EnzymeLibrary.enzymes : {};
    const all = Object.assign({}, library, utils.defaultEnzymesByName);
    return all;
  }

  function cutSites(data, filter) {
    const utils = window.sequenceUtils;
    if (!utils || typeof utils.getCutsitesFromSequence !== 'function') {
      return [];
    }
    const entries = (filter && filter.filteredRestrictionEnzymes) || [];
    if (entries.length === 0) {
      return [];
    }
    const sequence = String(data.sequence || '').toLowerCase();
    const key = sequence.length + ':' + sequence.slice(0, 40) + sequence.slice(-40) + ':' + !!data.circular + ':' + JSON.stringify(entries) + ':' + !!filter.isEnzymeFilterAnd;
    if (cutCache.key === key) {
      return cutCache.sites;
    }
    const groups = window.getExistingEnzymeGroups ? window.getExistingEnzymeGroups() : {};
    const pool = enzymePool();
    // the enzymes named by the groups of the filter limit the search; without a group all of them are searched
    const named = new Set();
    let limited = false;
    entries.forEach(function (entry) {
      const value = String(entry.value || '');
      if (value.indexOf('__userCreatedGroup') === 0) {
        limited = true;
        (groups[value.replace('__userCreatedGroup', '')] || []).forEach(function (name) {
          named.add(String(name).toLowerCase());
        });
      } else if (!entry.cutsThisManyTimes && value !== 'type2s') {
        limited = true;
        named.add(value.toLowerCase());
      }
    });
    const enzymes = limited ? Array.from(named).map(function (name) {
      return pool[name];
    }).filter(Boolean) : Object.values(pool);
    const found = utils.getCutsitesFromSequence(sequence, !!data.circular, enzymes);
    const byName = {};
    Object.keys(found).forEach(function (name) {
      byName[name.toLowerCase()] = found[name];
    });
    // each entry of the filter gives a set of enzymes; the sets are joined (or) or crossed (and)
    const sets = entries.map(function (entry) {
      const value = String(entry.value || '');
      const result = new Set();
      if (entry.cutsThisManyTimes > 0) {
        Object.keys(byName).forEach(function (name) {
          if (byName[name].length === entry.cutsThisManyTimes) {
            result.add(name);
          }
        });
      } else if (value === 'type2s') {
        Object.keys(byName).forEach(function (name) {
          if (byName[name][0] && byName[name][0].restrictionEnzyme && byName[name][0].restrictionEnzyme.isType2S) {
            result.add(name);
          }
        });
      } else if (value.indexOf('__userCreatedGroup') === 0) {
        (groups[value.replace('__userCreatedGroup', '')] || []).forEach(function (name) {
          if (byName[String(name).toLowerCase()]) {
            result.add(String(name).toLowerCase());
          }
        });
      } else if (byName[value.toLowerCase()]) {
        result.add(value.toLowerCase());
      }
      return result;
    });
    let shown = new Set();
    sets.forEach(function (set) {
      set.forEach(function (name) {
        shown.add(name);
      });
    });
    if (filter.isEnzymeFilterAnd) {
      const crossed = Array.from(shown).filter(function (name) {
        return sets.every(function (set) {
          return set.has(name);
        });
      });
      if (crossed.length > 0) {
        shown = new Set(crossed);
      }
    }
    const sites = [];
    shown.forEach(function (name) {
      byName[name].forEach(function (site) {
        sites.push({ name: byName[name][0].name || name, position: site.topSnipPosition, count: byName[name].length });
      });
    });
    cutCache = { key: key, sites: sites };
    return sites;
  }

  // ---- the map
  function setup(editor) {
    // puts the cursor on a base and shows that place in the sequence view, where it is cut or chosen on a map
    const goTo = function (position, scrollOnly) {
      if (!scrollOnly) {
        editor.updateEditor({ selectionLayer: { start: -1, end: -1 }, caretPosition: position });
      }
      const rows = document.querySelector('.veRowView');
      const length = String(editor.getState().sequenceData.sequence || '').length;
      if (rows && length > 0 && rows.scrollHeight > rows.clientHeight) {
        rows.scrollTop = Math.max(0, (position / length) * rows.scrollHeight - rows.clientHeight / 2);
      }
    };
    let host = null;
    let wrap = null;
    let svg = null;
    let signature = '';
    let hover = null;
    let drag = null;
    let pan = null;
    let menu = null;
    let layout = null;
    // the map can be made bigger: the drawing is made for a larger area and the panel scrolls
    let zoom = 1;
    try {
      zoom = Math.min(4, Math.max(0.6, Number(window.localStorage.getItem('sequence-editor-map-zoom')) || 1));
    } catch (error) {
      zoom = 1;
    }
    const setZoom = function (value) {
      zoom = Math.min(4, Math.max(0.6, Math.round(value * 100) / 100));
      try {
        window.localStorage.setItem('sequence-editor-map-zoom', String(zoom));
      } catch (error) {
        // not remembered
      }
      signature = '';
      if (zoomLabel) {
        zoomLabel.textContent = Math.round(zoom * 100) + '%';
      }
    };
    let zoomLabel = null;
    // what is shown on the maps (view-toggles.js): the features, the primers, the cut sites and the translations
    const shown = function (key) {
      return !window.ViewToggles || window.ViewToggles.get('map', key);
    };

    const dataNow = function () {
      return editor.getState().sequenceData;
    };

    const styleOn = function () {
      return document.body.dataset.mapStyle !== 'classic';
    };

    function featureItems(data) {
      const state = editor.getState();
      const visibility = state.annotationVisibility || {};
      const hiddenTypes = visibility.featureTypesToHide || {};
      if (visibility.features === false || !shown('features')) {
        return [];
      }
      return listOf(data.features).filter(function (feature) {
        return String(feature.type || '').toLowerCase() !== 'source' && !hiddenTypes[feature.type];
      }).map(function (feature) {
        return { kind: 'feature', name: feature.name || feature.type || 'feature', start: feature.start, end: feature.end, strand: feature.strand === -1 ? -1 : (feature.strand === 1 ? 1 : 0), color: feature.color || '#7a8699', type: feature.type || 'feature' };
      });
    }

    function primerItems(data) {
      if (!shown('primers')) {
        return [];
      }
      const state = editor.getState();
      const drawn = Object.assign({}, state.temporaryAnnotations && state.temporaryAnnotations.primers);
      listOf(data.primers).forEach(function (primer) {
        drawn['file-' + primer.id] = primer;
      });
      return Object.keys(drawn).map(function (key) {
        const primer = drawn[key];
        const candidate = /candidate/.test(String(primer.name));
        return { kind: 'primer', name: String(primer.name || 'primer').replace(' (candidate)', ''), start: primer.start, end: primer.end, strand: primer.forward === false || primer.strand === -1 ? -1 : 1, color: candidate ? '#e8890c' : (primer.color || '#f0a202'), candidate: candidate, type: candidate ? 'candidate primer' : 'primer' };
      });
    }

    // the open reading frames of the editor's settings (minimum size, other start codons), worked out again only when these change
    let orfCache = { key: '', orfs: [] };
    function orfItems(data) {
      const state = editor.getState();
      const sequence = String(data.sequence || '');
      const key = [sequence.length, sequence.slice(0, 40), sequence.slice(-40), !!data.circular, state.minimumOrfSize, state.useAdditionalOrfStartCodons].join('|');
      if (orfCache.key !== key) {
        let found = [];
        try {
          found = window.sequenceUtils.findOrfsInPlasmid(sequence, !!data.circular, state.minimumOrfSize || 300, !!state.useAdditionalOrfStartCodons, false) || [];
        } catch (error) {
          found = [];
        }
        orfCache = { key: key, orfs: found.map(function (orf) {
          return { start: orf.start, end: orf.end, forward: orf.forward !== false, starts: orf.internalStartCodonIndices || [] };
        }) };
      }
      return orfCache.orfs;
    }

    // the translations: those of the editor and the genes (CDS features), with the amino acid of each codon
    const CODE = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
    const BASE_COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G' };
    const aminoAcid = function (codon) {
      const index = codon.split('').map(function (b) {
        return 'TCAG'.indexOf(b);
      });
      return index.indexOf(-1) !== -1 ? 'X' : CODE[16 * index[0] + 4 * index[1] + index[2]];
    };

    function translationItems(data) {
      const sequence = String(data.sequence || '').toUpperCase();
      const length = sequence.length;
      const found = [];
      const seen = new Set();
      const add = function (name, start, end, forward, color) {
        const key = start + ':' + end + ':' + forward;
        if (seen.has(key) || !(start >= 0 && end >= 0 && start < length && end < length)) {
          return;
        }
        seen.add(key);
        const span = (end >= start ? end - start : end + length - start) + 1;
        if (span < 6) {
          return;
        }
        const codons = [];
        for (let k = 0; k + 3 <= span; k += 3) {
          // a gene on the reverse strand is read from its end
          const first = forward ? (start + k) % length : ((end - k - 2) % length + length) % length;
          let triplet = '';
          for (let i = 0; i < 3; i++) {
            triplet += sequence[(first + i) % length];
          }
          if (!forward) {
            triplet = triplet.split('').reverse().map(function (b) {
              return BASE_COMPLEMENT[b] || 'N';
            }).join('');
          }
          codons.push({ start: first, aa: aminoAcid(triplet) });
        }
        found.push({ name: name, start: start, end: end, forward: forward, codons: codons, color: color });
      };
      listOf(data.translations).forEach(function (t) {
        add(t.name || 'translation', t.start, t.end, t.forward !== false && t.strand !== -1, t.color);
      });
      listOf(data.features).forEach(function (f) {
        if (String(f.type || '').toUpperCase() === 'CDS') {
          add(f.name || 'CDS', f.start, f.end, f.strand !== -1, f.color);
        }
      });
      return found;
    }

    const angleOf = function (position, length) {
      return (position / length) * TAU - Math.PI / 2;
    };

    // an arc as an arrow: a1 < a2 in radians, strand 1 points to a2, -1 to a1
    function arrowPath(cx, cy, r1, r2, a1, a2, strand, head) {
      const point = function (r, a) {
        return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
      };
      if (a2 - a1 < 0.012) {
        const middle = (a1 + a2) / 2;
        a1 = middle - 0.006;
        a2 = middle + 0.006;
      }
      const headSize = strand === 0 ? 0 : Math.min(head, (a2 - a1) * 0.7);
      let start = a1;
      let end = a2;
      if (strand === 1) {
        end = a2 - headSize;
      }
      if (strand === -1) {
        start = a1 + headSize;
      }
      const large = (end - start) > Math.PI ? 1 : 0;
      const mid = (r1 + r2) / 2;
      let d = 'M' + point(r2, start) + 'A' + r2 + ',' + r2 + ' 0 ' + large + ' 1 ' + point(r2, end);
      if (strand === 1) {
        d += 'L' + point(mid, a2);
      }
      d += 'L' + point(r1, end) + 'A' + r1 + ',' + r1 + ' 0 ' + large + ' 0 ' + point(r1, start);
      if (strand === -1) {
        d += 'L' + point(mid, a1);
      }
      return d + 'Z';
    }

    function arcOf(item, length) {
      const a1 = angleOf(item.start, length);
      let a2 = angleOf(item.end + 1, length);
      if (item.end < item.start) {
        a2 += TAU;
      }
      return [a1, a2];
    }

    const positionAt = function (event) {
      const box = svg.getBoundingClientRect();
      const x = event.clientX - box.left - layout.cx;
      const y = event.clientY - box.top - layout.cy;
      const turn = (Math.atan2(y, x) + Math.PI / 2 + TAU * 2) % TAU;
      return { position: Math.min(layout.length - 1, Math.floor((turn / TAU) * layout.length)), radius: Math.sqrt(x * x + y * y) };
    };

    const select = function (start, end) {
      editor.updateEditor({ selectionLayer: { start: start, end: end }, caretPosition: -1 });
    };

    function closeMenu() {
      if (menu) {
        menu.remove();
        menu = null;
      }
    }

    function openMenu(event, position, target) {
      closeMenu();
      const data = dataNow();
      menu = document.createElement('div');
      menu.className = 'own-map-menu';
      const items = [];
      if (target) {
        items.push(['Select ' + target.name, function () {
          select(target.start, target.end);
        }]);
        if (data.circular && !editor.getState().readOnly && window.OriginTab && target.start > 0) {
          items.push(['Set origin at the start of ' + target.name, function () {
            window.OriginTab.rotateAt(target.start + 1);
          }]);
        }
      }
      if (data.circular && !editor.getState().readOnly && window.OriginTab && position > 0) {
        items.push(['Set origin here (base ' + (position + 1) + ' becomes 1)', function () {
          window.OriginTab.rotateAt(position + 1);
        }]);
      }
      items.push(['Select the whole sequence', function () {
        select(0, data.sequence.length - 1);
      }]);
      items.push(['Clear the selection', function () {
        editor.updateEditor({ selectionLayer: { start: -1, end: -1 }, caretPosition: -1 });
      }]);
      items.forEach(function (item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item[0];
        button.addEventListener('click', function () {
          closeMenu();
          item[1]();
        });
        menu.append(button);
      });
      const box = wrap.getBoundingClientRect();
      menu.style.left = Math.min(event.clientX - box.left, box.width - 220) + 'px';
      menu.style.top = (event.clientY - box.top) + 'px';
      wrap.append(menu);
    }

    // a colour mixed with white or black: labels in the colour of their feature, readable on the page
    function mix(hex, other, amount) {
      const value = /^#([0-9a-f]{6})$/i.test(hex) ? hex.slice(1) : '7a8699';
      const channel = function (start) {
        const from = parseInt(value.slice(start, start + 2), 16);
        const to = other === 'white' ? 255 : 0;
        return Math.round(from + (to - from) * amount).toString(16).padStart(2, '0');
      };
      return '#' + channel(0) + channel(2) + channel(4);
    }

    // the labels of one side, in rows at about the height of their arcs: each row keeps its space, and the rows follow the
    // curve of the ring so the names stay close to it
    function placeRows(items, top, bottom, rowHeight, budget) {
      const sorted = items.slice().sort(function (a, b) {
        return a.wanted - b.wanted;
      });
      let fit = sorted.slice();
      // zoomed out the names are few: only the biggest features and the enzymes that matter, the others come back as the map is zoomed in
      while ((fit.length * rowHeight > bottom - top || fit.length > budget) && fit.length > 0) {
        // too many for the height: the least important go (the enzymes first, then the small features)
        let weakest = 0;
        fit.forEach(function (item, index) {
          if (item.rank > fit[weakest].rank || (item.rank === fit[weakest].rank && item.size < fit[weakest].size)) {
            weakest = index;
          }
        });
        fit[weakest].dropped = true;
        fit.splice(weakest, 1);
      }
      fit.forEach(function (item, index) {
        item.y = Math.max(item.wanted, index === 0 ? top : fit[index - 1].y + rowHeight);
      });
      for (let index = fit.length - 1; index >= 0; index--) {
        const limit = index === fit.length - 1 ? bottom : fit[index + 1].y - rowHeight;
        fit[index].y = Math.min(fit[index].y, limit);
      }
      return fit;
    }

    // the features in lanes: those that overlap are on different rings, so each of them can be seen
    function laneOf(features, length) {
      const ends = [];
      const overlaps = function (a, b) {
        return [-length, 0, length].some(function (shift) {
          return a.s < b.e + shift && b.s + shift < a.e;
        });
      };
      features.slice().sort(function (a, b) {
        return a.start - b.start;
      }).forEach(function (feature) {
        const span = { s: feature.start, e: feature.end >= feature.start ? feature.end + 1 : feature.end + 1 + length };
        let lane = ends.findIndex(function (taken) {
          return !taken.some(function (other) {
            return overlaps(span, other);
          });
        });
        if (lane === -1) {
          lane = ends.length;
          ends.push([]);
        }
        ends[lane].push(span);
        feature.lane = lane;
      });
      return ends.length;
    }

    function draw() {
      if (!host || !host.isConnected) {
        return;
      }
      closeMenu();
      const data = dataNow();
      const length = String(data.sequence || '').length;
      const width = Math.round(host.clientWidth * zoom);
      const height = Math.round(host.clientHeight * zoom);
      if (length === 0 || width < 120 || height < 120) {
        return;
      }
      const dark = document.body.dataset.mapStyle === 'dark';
      const filter = editor.getState().restrictionEnzymes;
      const features = featureItems(data);
      const primers = primerItems(data);
      let sites = [];
      if (shown('sites')) {
        try {
          sites = cutSites(data, filter);
        } catch (error) {
          sites = [];
        }
      }
      const laneCount = Math.max(1, laneOf(features, length));
      const THICK = 20;
      const LANE = 25;
      const hasPrimers = primers.length > 0;
      // the ring is as big as the panel allows, with room for the names beside it
      const longest = features.concat(primers).map(function (item) {
        return String(item.name).length;
      }).reduce(function (most, size) {
        return Math.max(most, size);
      }, 6);
      const room = Math.max(70, Math.min(104, Math.min(14, longest) * 6.9 + 22));
      const cx = width / 2;
      const cy = height / 2;
      // the names at the sides can be shortened and the ones at the top and the bottom have the corners: the ring takes more of
      // the panel than the longest name would leave it
      const sideRoom = Math.min(room, 88);
      const radius = Math.max(60, Math.min(height / 2 - 40, width / 2 - sideRoom - 8 - (hasPrimers ? 12 : 0)));
      const ringOut = radius + THICK / 2;
      const primerIn = ringOut + 4;
      const primerOut = primerIn + 6;
      const edge = hasPrimers ? primerOut : ringOut;
      const innerEdge = radius - THICK / 2 - LANE * (laneCount - 1);
      layout = { cx: cx, cy: cy, radius: radius, length: length };

      svg = svgElement('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, class: 'own-map-svg', role: 'img', 'aria-label': 'Circular map of ' + (data.name || 'the sequence') });
      const at = function (r, a) {
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      };

      // the backbone and the scale
      svg.append(svgElement('circle', { cx: cx, cy: cy, r: radius, class: 'own-map-backbone', fill: 'none', 'stroke-width': 2 }));
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
      // fewer numbers on a small map, so they do not touch each other or the title
      const crowded = Math.min(host.clientWidth, host.clientHeight) * zoom < 520;
      const step = steps.find(function (candidate) {
        return length / candidate <= (crowded ? 6 : 12);
      }) || 50000;
      for (let position = step; position < length; position += step) {
        const a = angleOf(position, length);
        const tick1 = at(innerEdge - 3, a);
        const tick2 = at(innerEdge - 8, a);
        svg.append(svgElement('line', { x1: tick1[0], y1: tick1[1], x2: tick2[0], y2: tick2[1], class: 'own-map-tick' }));
        // on a small ring the numbers would lie over the title: only the ticks are drawn
        if (innerEdge >= 150) {
          const label = at(innerEdge - 19, a);
          svg.append(svgElement('text', { x: label[0], y: label[1], 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'own-map-scale' }, String(position)));
        }
      }
      const origin = at(innerEdge - 8, angleOf(0, length));
      const originEnd = at(ringOut + 4, angleOf(0, length));
      svg.append(svgElement('line', { x1: origin[0], y1: origin[1], x2: originEnd[0], y2: originEnd[1], class: 'own-map-origin' }));

      // the selection behind the arrows
      const selection = editor.getState().selectionLayer || { start: -1, end: -1 };
      if (selection.start >= 0 && selection.end >= 0) {
        const range = arcOf({ start: selection.start, end: selection.end }, length);
        svg.append(svgElement('path', { d: arrowPath(cx, cy, innerEdge - 5, edge + 5, range[0], range[1], 0, 0), class: 'own-map-selection' }));
      }
      const caret = editor.getState().caretPosition;
      if (typeof caret === 'number' && caret >= 0) {
        const a = angleOf(caret, length);
        const c1 = at(innerEdge - 8, a);
        const c2 = at(edge + 10, a);
        svg.append(svgElement('line', { x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], class: 'own-map-caret' }));
      }

      const labels = [];
      const detail = function (item) {
        return { title: item.name, line: (item.start + 1) + '..' + (item.end + 1) + ' · ' + ((item.end >= item.start ? item.end - item.start : item.end + length - item.start) + 1) + ' bp' + (item.strand === 0 ? '' : (item.strand === 1 ? ' · forward' : ' · reverse')) };
      };
      // the arc, the tick and the label of an item are lit together when the pointer is on one of them
      const parts = {};
      const light = function (key, on) {
        (parts[key] || []).forEach(function (node) {
          node.classList.toggle('hot', on);
        });
        svg.classList.toggle('has-hot', on);
      };
      const join = function (key, node) {
        (parts[key] = parts[key] || []).push(node);
      };
      let counter = 0;
      let menuTarget = null;
      const draw1 = function (item, rIn, rOut, head, rank) {
        const key = 'item' + (counter++);
        const range = arcOf(item, length);
        const path = svgElement('path', { d: arrowPath(cx, cy, rIn, rOut, range[0], range[1], item.strand, head / ((rIn + rOut) / 2)), fill: item.color, class: 'own-map-feature' + (item.candidate ? ' candidate' : '') });
        path.append(svgElement('title', {}, item.name + ' (' + item.type + ') ' + detail(item).line));
        join(key, path);
        path.addEventListener('mouseenter', function () {
          hover = detail(item);
          showCenter();
          light(key, true);
        });
        path.addEventListener('mouseleave', function () {
          hover = null;
          showCenter();
          light(key, false);
        });
        path.addEventListener('contextmenu', function () {
          menuTarget = item;
        });
        path.addEventListener('mousedown', function (event) {
          event.stopPropagation();
        });
        path.addEventListener('click', function (event) {
          event.stopPropagation();
          select(item.start, item.end);
        });
        svg.append(path);
        const middle = (range[0] + range[1]) / 2;
        labels.push({ key: key, text: item.name, color: item.color, middle: middle, rank: rank, size: range[1] - range[0], kind: item.kind, rEdge: rank === 1 ? ringOut : edge, onEnter: function () {
          hover = detail(item);
          showCenter();
        } });
      };
      features.sort(function (a, b) {
        return (b.end - b.start) - (a.end - a.start);
      }).forEach(function (item) {
        const centre = radius - LANE * (item.lane || 0);
        draw1(item, centre - THICK / 2, centre + THICK / 2, 13, 1);
      });
      primers.forEach(function (item) {
        draw1(item, primerIn, primerOut, 7, 2);
      });

      // the translations: a ring inside the scale, a segment for each amino acid (its letter when there is room for it)
      if (shown('translations')) {
        const ringMid = innerEdge - 36;
        if (ringMid > 34) {
          translationItems(data).forEach(function (item) {
            const first = angleOf(item.start, length);
            const codonArc = (TAU * 3 / length) * ringMid;
            const group = svgElement('g', { class: 'own-map-translation' });
            const title = item.name + ' (translation) ' + (item.start + 1) + '..' + (item.end + 1) + ' · ' + item.codons.length + ' amino acids' + (item.forward ? '' : ' · reverse');
            if (codonArc < 2.5) {
              // too small for the codons: one band with an arrow, the amino acids are there when the map is made bigger
              const range = arcOf(item, length);
              const band = svgElement('path', { d: arrowPath(cx, cy, ringMid - 6, ringMid + 6, range[0], range[1], item.forward ? 1 : -1, 10 / ringMid), fill: dark ? '#46618a' : '#c7d9f1', stroke: dark ? '#7f9cc8' : '#8aa6d3', 'stroke-width': 0.8 });
              band.append(svgElement('title', {}, title));
              group.append(band);
            } else {
              item.codons.forEach(function (codon, index) {
                const a1 = angleOf(codon.start, length);
                const a2 = a1 + (TAU * 3) / length;
                const stop = codon.aa === '*';
                const fill = stop ? '#e0806a' : (index % 2 === 0 ? (dark ? '#3d5578' : '#dbe7f7') : (dark ? '#46618a' : '#c7d9f1'));
                const segment = svgElement('path', { d: arrowPath(cx, cy, ringMid - 6, ringMid + 6, a1, a2, 0, 0), fill: fill });
                segment.append(svgElement('title', {}, codon.aa + ' ' + (index + 1) + ' · ' + item.name));
                group.append(segment);
                if (codonArc >= 9) {
                  const p = at(ringMid, (a1 + a2) / 2);
                  group.append(svgElement('text', { x: p[0], y: p[1], 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'own-map-aa' }, stop ? '*' : codon.aa));
                }
              });
              // the start of the gene is marked: the arrow of the reading direction at its end
              const range = arcOf(item, length);
              group.append(svgElement('path', { d: arrowPath(cx, cy, ringMid + 7, ringMid + 9, range[0], range[1], 0, 0), fill: item.forward ? '#6a8fd0' : '#d08f6a' }));
            }
            group.addEventListener('mousedown', function (event) {
              event.stopPropagation();
            });
            group.addEventListener('click', function (event) {
              event.stopPropagation();
              select(item.start, item.end);
            });
            svg.append(group);
          });
        }
      }

      // the open reading frames: thin lines inside the translations, in lanes where they overlap, a small tick at each of the other
      // start codons and an arrowhead where the reading ends
      if (shown('orfs')) {
        const orfs = orfItems(data).map(function (orf) {
          return Object.assign({}, orf);
        });
        const lanes = Math.min(8, laneOf(orfs, length));
        const base = innerEdge - 36 - (shown('translations') ? 16 : 0);
        orfs.forEach(function (orf) {
          const r = base - (orf.lane || 0) * 5;
          if (r < 30 || (orf.lane || 0) >= lanes) {
            return;
          }
          const range = arcOf(orf, length);
          const large = (range[1] - range[0]) > Math.PI ? 1 : 0;
          const from = at(r, range[0]);
          const to = at(r, range[1]);
          const group = svgElement('g', { class: 'own-map-orf' });
          const line = svgElement('path', { d: 'M' + from[0].toFixed(1) + ',' + from[1].toFixed(1) + 'A' + r + ',' + r + ' 0 ' + large + ' 1 ' + to[0].toFixed(1) + ',' + to[1].toFixed(1), class: 'own-map-orf-line' });
          line.append(svgElement('title', {}, 'ORF ' + (orf.start + 1) + '..' + (orf.end + 1) + ' · ' + Math.round(((orf.end >= orf.start ? orf.end - orf.start : orf.end + length - orf.start) + 1) / 3) + ' codons' + (orf.forward ? '' : ' · reverse')));
          group.append(line);
          group.append(svgElement('path', { d: line.getAttribute('d'), fill: 'none', stroke: 'transparent', 'stroke-width': 6 }));
          orf.starts.forEach(function (position) {
            const a = angleOf(position + 1.5, length);
            const t1 = at(r - 3, a);
            const t2 = at(r + 3, a);
            group.append(svgElement('line', { x1: t1[0], y1: t1[1], x2: t2[0], y2: t2[1], class: 'own-map-orf-tick' }));
          });
          const end = orf.forward ? range[1] : range[0];
          const back = end + (orf.forward ? -1 : 1) * Math.min(0.04, (range[1] - range[0]) / 2);
          const tip = at(r, end);
          const upper = at(r + 3.5, back);
          const lower = at(r - 3.5, back);
          group.append(svgElement('path', { d: 'M' + tip[0].toFixed(1) + ',' + tip[1].toFixed(1) + 'L' + upper[0].toFixed(1) + ',' + upper[1].toFixed(1) + 'M' + tip[0].toFixed(1) + ',' + tip[1].toFixed(1) + 'L' + lower[0].toFixed(1) + ',' + lower[1].toFixed(1), class: 'own-map-orf-line' }));
          group.addEventListener('mousedown', function (event) {
            event.stopPropagation();
          });
          group.addEventListener('click', function (event) {
            event.stopPropagation();
            select(orf.start, orf.end);
          });
          svg.append(group);
        });
      }

      // the cut sites: a short tick each; a name for a few of them, the others are in the tooltip (the sites that are close
      // share one name)
      const ordered = sites.slice().sort(function (a, b) {
        return a.position - b.position;
      });
      const clusters = [];
      ordered.forEach(function (site) {
        const last = clusters[clusters.length - 1];
        if (last && (site.position - last.end) / length * TAU < 0.05) {
          last.sites.push(site);
          last.end = site.position;
        } else {
          clusters.push({ start: site.position, end: site.position, sites: [site] });
        }
      });
      const named = new Set(clusters.slice().sort(function (a, b) {
        return b.sites.length - a.sites.length;
      }).slice(0, MAX_SITE_LABELS));
      clusters.forEach(function (cluster) {
        const cutKey = 'cut' + (counter++);
        cluster.sites.forEach(function (site) {
          const a = angleOf(site.position, length);
          const p1 = at(edge + 1, a);
          const p2 = at(edge + 6, a);
          const tick = svgElement('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], class: 'own-map-cut' });
          tick.append(svgElement('title', {}, site.name + ' cuts at ' + site.position + (site.count > 1 ? ' (' + site.count + ' sites)' : ' (single cutter)')));
          join(cutKey, tick);
          // a click on a cut site puts the cursor there (the mouse down must not start a selection)
          tick.addEventListener('mousedown', function (event) {
            event.stopPropagation();
          });
          tick.addEventListener('click', function () {
            goTo(site.position);
          });
          svg.append(tick);
        });
        if (!named.has(cluster)) {
          return;
        }
        const first = cluster.sites[0];
        const middle = angleOf((cluster.start + cluster.end) / 2, length);
        const names = cluster.sites.map(function (site) {
          return site.name;
        });
        labels.push({ key: cutKey, text: first.name + (names.length > 1 ? ' +' + (names.length - 1) : ''), color: null, middle: middle, rank: 3, size: 0, kind: 'cut ' + (first.count === 1 ? 'single' : 'multi'), rEdge: edge + 6, onClick: function () {
          goTo(first.position);
        }, onEnter: function () {
          hover = { title: names.join(', '), line: 'cut at ' + cluster.sites.map(function (site) {
            return site.position;
          }).join(', ') };
          showCenter();
        } });
      });

      // the names beside the ring: each row at the height of its arc, the rows following the curve of the ring
      const labelRadius = edge + 20;
      const sides = { left: [], right: [] };
      labels.forEach(function (label) {
        label.side = Math.cos(label.middle) >= 0 ? 'right' : 'left';
        label.wanted = cy + labelRadius * Math.sin(label.middle);
        label.anchor = at(label.rEdge + 2, label.middle);
        sides[label.side].push(label);
      });
      let hidden = 0;
      // a name that is repeated (four "linker") is written once, on the biggest of them, until the map is zoomed in
      if (zoom < 1.6) {
        const biggest = {};
        labels.forEach(function (label) {
          const name = label.kind + '|' + label.text;
          if (!biggest[name] || label.size > biggest[name].size) {
            biggest[name] = label;
          }
        });
        ['left', 'right'].forEach(function (side) {
          sides[side] = sides[side].filter(function (label) {
            return biggest[label.kind + '|' + label.text] === label;
          });
        });
      }
      // how many names a side can carry: few when the map is small, more as it is zoomed in
      const budget = Math.max(3, Math.round(4 + 8 * zoom * zoom));
      ['left', 'right'].forEach(function (side) {
        const placed = placeRows(sides[side], 14, height - 14, 15, budget);
        hidden += sides[side].length - placed.length;
        placed.forEach(function (label) {
          const dy = Math.min(Math.abs(label.y - cy), labelRadius - 1);
          const reach = Math.max(Math.sqrt(labelRadius * labelRadius - dy * dy), labelRadius * 0.3);
          const x = cx + (side === 'right' ? reach : -reach);
          const textX = x + (side === 'right' ? 5 : -5);
          const feature = label.kind === 'feature' || label.kind === 'primer';
          svg.append(svgElement('polyline', { points: label.anchor.map(function (n) {
            return n.toFixed(1);
          }).join(',') + ' ' + (x + (side === 'right' ? -1 : 1)).toFixed(1) + ',' + label.y.toFixed(1), class: 'own-map-leader', fill: 'none' }));
          // a long name is cut to the room beside the ring; the whole name is in the tooltip
          const space = side === 'right' ? width - textX - 4 : textX - 4;
          const perChar = feature ? 6.7 : 5.8;
          const fits = Math.max(4, Math.floor(space / perChar));
          const shown = label.text.length > fits ? label.text.slice(0, fits - 1) + '…' : label.text;
          const attributes = { x: textX, y: label.y, 'text-anchor': side === 'right' ? 'start' : 'end', 'dominant-baseline': 'central', class: 'own-map-label ' + label.kind };
          if (feature && label.color) {
            attributes.fill = dark ? mix(label.color, 'white', 0.35) : mix(label.color, 'black', 0.3);
          }
          const text = svgElement('text', attributes, shown);
          text.append(svgElement('title', {}, label.text));
          join(label.key, text);
          if (label.onClick) {
            text.addEventListener('mousedown', function (event) {
              event.stopPropagation();
            });
            text.addEventListener('click', label.onClick);
            text.style.cursor = 'pointer';
          }
          text.addEventListener('mouseenter', function () {
            label.onEnter();
            light(label.key, true);
          });
          text.addEventListener('mouseleave', function () {
            hover = null;
            showCenter();
            light(label.key, false);
          });
          svg.append(text);
        });
      });
      if (hidden > 0) {
        svg.append(svgElement('text', { x: width - 8, y: height - 8, 'text-anchor': 'end', class: 'own-map-more' }, hidden + ' labels hidden: point at the map to read them'));
      }

      svg.append(svgElement('g', { class: 'own-map-center' }));
      const scrollLeft = host.scrollLeft;
      const scrollTop = host.scrollTop;
      host.textContent = '';
      host.append(svg);
      host.scrollLeft = scrollLeft;
      host.scrollTop = scrollTop;
      if (wrap) {
        wrap.classList.toggle('dark-map', dark);
      }
      layout.inner = innerEdge;
      showCenter();

      svg.addEventListener('mousedown', function (event) {
        if (event.button !== 0) {
          return;
        }
        const where = positionAt(event);
        if (event.altKey || where.radius < innerEdge - 30 || where.radius > edge + 26) {
          // outside the ring (or with Alt held): a drag moves the map when it is bigger than the panel
          if (host.scrollWidth > host.clientWidth || host.scrollHeight > host.clientHeight) {
            pan = { x: event.clientX, y: event.clientY, left: host.scrollLeft, top: host.scrollTop };
            host.classList.add('panning');
            event.preventDefault();
          }
          return;
        }
        drag = { from: where.position, moved: false };
        event.preventDefault();
      });
      svg.addEventListener('mousemove', function (event) {
        if (pan) {
          host.scrollLeft = pan.left - (event.clientX - pan.x);
          host.scrollTop = pan.top - (event.clientY - pan.y);
          return;
        }
        if (!drag) {
          return;
        }
        const to = positionAt(event).position;
        if (to !== drag.from) {
          drag.moved = true;
          const forward = (to - drag.from + length) % length;
          // the shorter way round
          if (forward <= length / 2) {
            select(drag.from, to);
          } else {
            select(to, drag.from);
          }
        }
      });
      const finish = function () {
        pan = null;
        host.classList.remove('panning');
        if (drag && !drag.moved) {
          editor.updateEditor({ selectionLayer: { start: -1, end: -1 }, caretPosition: drag.from });
        }
        drag = null;
      };
      svg.addEventListener('mouseup', finish);
      svg.addEventListener('mouseleave', finish);
      svg.addEventListener('dblclick', function (event) {
        const where = positionAt(event);
        if (where.radius > edge + 26 || where.radius < innerEdge - 30) {
          setZoom(1);
          host.scrollLeft = 0;
          host.scrollTop = 0;
        }
      });
      svg.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        const target = menuTarget;
        menuTarget = null;
        openMenu(event, positionAt(event).position, target);
      });
    }

    // the centre: the name and the size, or what the pointer is on
    function showCenter() {
      if (!svg) {
        return;
      }
      const group = svg.querySelector('.own-map-center');
      if (!group) {
        return;
      }
      group.textContent = '';
      svg.classList.toggle('own-map-detail', !!hover);
      const data = dataNow();
      const title = hover ? hover.title : (data.name || 'Sequence');
      const line = hover ? hover.line : String(data.sequence || '').length.toLocaleString('en') + ' bp' + (data.circular ? '' : ' (linear)');
      // the text has to fit inside the ring, clear of the numbers of the scale: the title takes up to two lines, smaller when it is long
      const room = Math.max(50, ((layout.inner || layout.radius * 0.8) - 28) * 2 * 0.86);
      let size = 15;
      const charsFor = function (px) {
        return Math.max(6, Math.floor(room / (px * 0.56)));
      };
      const wrapped = [];
      let rest = repairText(title);
      while (size >= 11 && Math.ceil(rest.length / charsFor(size)) > 2) {
        size -= 1;
      }
      for (let n = 0; n < 2 && rest.length > 0; n++) {
        const max = charsFor(size);
        if (rest.length <= max) {
          wrapped.push(rest);
          rest = '';
          break;
        }
        // a line breaks after a space or a dash when it can
        const cut = Math.max(rest.lastIndexOf(' ', max), rest.lastIndexOf('-', max - 1) + 1, rest.lastIndexOf('_', max - 1) + 1);
        const at = cut > max * 0.5 ? cut : max;
        wrapped.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest.length > 0) {
        wrapped[wrapped.length - 1] = wrapped[wrapped.length - 1].slice(0, Math.max(1, wrapped[wrapped.length - 1].length - 1)) + '…';
      }
      const lineHeight = size + 2;
      const top = layout.cy - (wrapped.length * lineHeight) / 2 - 4;
      wrapped.forEach(function (text, index) {
        group.append(svgElement('text', { x: layout.cx, y: top + (index + 0.8) * lineHeight, 'text-anchor': 'middle', style: 'font-size:' + size + 'px', class: 'own-map-title' }, text));
      });
      const subMax = Math.max(10, charsFor(11));
      group.append(svgElement('text', { x: layout.cx, y: top + wrapped.length * lineHeight + 14, 'text-anchor': 'middle', class: 'own-map-sub' }, line.length > subMax ? line.slice(0, subMax - 1) + '…' : line));
    }

    function stateSignature() {
      const state = editor.getState();
      const data = state.sequenceData;
      const sequence = String(data.sequence || '');
      const features = listOf(data.features).map(function (feature) {
        return feature.start + ':' + feature.end + ':' + feature.name + ':' + feature.strand + ':' + feature.color;
      }).join(',');
      const primers = Object.keys((state.temporaryAnnotations && state.temporaryAnnotations.primers) || {}).join(',') + listOf(data.primers).length;
      const selection = state.selectionLayer || {};
      return [sequence.length, sequence.slice(0, 30), features, primers, selection.start, selection.end, state.caretPosition, JSON.stringify(state.restrictionEnzymes), JSON.stringify(state.annotationVisibility && state.annotationVisibility.featureTypesToHide), !!data.circular, host ? host.clientWidth + 'x' + host.clientHeight : '', document.body.dataset.mapStyle, zoom, shown('features'), shown('primers'), shown('sites'), shown('translations'), shown('orfs'), JSON.stringify(data.translations || null)].join('|');
    }

    // the map as an SVG file: the styles the map has now are written into the file, so it looks the same elsewhere
    function exportSvg() {
      if (!svg) {
        return;
      }
      const copy = svg.cloneNode(true);
      const live = svg.querySelectorAll('*');
      const cloned = copy.querySelectorAll('*');
      const properties = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin', 'font-family', 'font-size', 'font-weight', 'opacity', 'fill-opacity'];
      live.forEach(function (node, index) {
        const computed = window.getComputedStyle(node);
        cloned[index].setAttribute('style', properties.map(function (property) {
          return property + ':' + computed.getPropertyValue(property);
        }).join(';'));
      });
      const background = document.createElementNS(NS, 'rect');
      background.setAttribute('width', svg.getAttribute('width'));
      background.setAttribute('height', svg.getAttribute('height'));
      background.setAttribute('fill', document.body.dataset.mapStyle === 'dark' ? '#0f172a' : '#ffffff');
      copy.insertBefore(background, copy.firstChild);
      copy.setAttribute('xmlns', NS);
      const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = String(dataNow().name || 'plasmid').replace(/[^\w.-]+/g, '_') + '-map.svg';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(link.href);
      }, 2000);
    }

    // the container of the circular map of the editor is taken over: its own drawing is hidden, ours is put in its place
    function attach() {
      const container = document.querySelector('.veCircularView');
      if (!container) {
        if (wrap) {
          wrap = null;
          host = null;
          svg = null;
        }
        return;
      }
      if (wrap && wrap.parentNode === container) {
        return;
      }
      wrap = document.createElement('div');
      wrap.className = 'own-map';
      host = document.createElement('div');
      host.className = 'own-map-host';
      wrap.append(host);
      const controls = document.createElement('div');
      controls.className = 'own-map-zoom';
      controls.title = 'Scroll the wheel on the map to zoom';
      const button = function (text, label, handler) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = label;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', handler);
        return b;
      };
      zoomLabel = document.createElement('span');
      zoomLabel.textContent = Math.round(zoom * 100) + '%';
      controls.append(zoomLabel, window.ViewToggles ? window.ViewToggles.bar('map') : document.createElement('span'), button('Fit', 'Fit the map to the panel', function () {
        setZoom(1);
      }), button('SVG', 'Save the map as an SVG image', exportSvg));
      wrap.append(controls);
      // the wheel zooms the map (a trackpad pinch too), around the pointer; the map is moved by dragging it
      host.addEventListener('wheel', function (event) {
        event.preventDefault();
        const box = host.getBoundingClientRect();
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;
        const before = zoom;
        setZoom(zoom * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0018)));
        if (zoom === before) {
          return;
        }
        const ratio = zoom / before;
        const left = host.scrollLeft;
        const top = host.scrollTop;
        draw();
        host.scrollLeft = (left + px) * ratio - px;
        host.scrollTop = (top + py) * ratio - py;
      }, { passive: false });
      container.append(wrap);
      container.classList.add('has-own-map');
      signature = '';
    }

    window.setInterval(function () {
      attach();
      if (!host) {
        return;
      }
      wrap.hidden = !styleOn();
      if (!styleOn()) {
        return;
      }
      const now = stateSignature();
      if (now !== signature && !drag) {
        signature = now;
        draw();
      }
    }, 250);
    // the labels of the cut sites on the linear map move the cursor to the cut already: the sequence view follows it
    document.addEventListener('click', function (event) {
      const label = event.target.closest && event.target.closest('.veCutsiteLabel');
      if (label && !label.closest('.veRowView')) {
        window.setTimeout(function () {
          const caret = editor.getState().caretPosition;
          if (caret >= 0) {
            goTo(caret, true);
          }
        }, 80);
      }
    }, true);
    document.addEventListener('mousedown', function (event) {
      if (menu && !menu.contains(event.target)) {
        closeMenu();
      }
    }, true);
    window.addEventListener('resize', function () {
      signature = '';
    });
  }

  window.OwnMap = { setup: setup };
})();
