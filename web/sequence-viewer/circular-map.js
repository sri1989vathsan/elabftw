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
  const ROW = 14.5;

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
    let host = null;
    let wrap = null;
    let svg = null;
    let signature = '';
    let hover = null;
    let drag = null;
    let menu = null;
    let layout = null;
    // the map can be made bigger: the drawing is made for a larger area and the panel scrolls
    let zoom = 1;
    try {
      zoom = Math.min(2.5, Math.max(0.8, Number(window.localStorage.getItem('sequence-editor-map-zoom')) || 1));
    } catch (error) {
      zoom = 1;
    }
    const setZoom = function (value) {
      zoom = Math.min(2.5, Math.max(0.8, Math.round(value * 100) / 100));
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
      if (visibility.features === false) {
        return [];
      }
      return listOf(data.features).filter(function (feature) {
        return String(feature.type || '').toLowerCase() !== 'source' && !hiddenTypes[feature.type];
      }).map(function (feature) {
        return { kind: 'feature', name: feature.name || feature.type || 'feature', start: feature.start, end: feature.end, strand: feature.strand === -1 ? -1 : (feature.strand === 1 ? 1 : 0), color: feature.color || '#7a8699', type: feature.type || 'feature' };
      });
    }

    function primerItems(data) {
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

    function openMenu(event, position) {
      closeMenu();
      const data = dataNow();
      menu = document.createElement('div');
      menu.className = 'own-map-menu';
      const items = [];
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

    // label rows for one side: each as near to the height of its arc as possible, with a row of space between them
    function placeColumn(items, top, bottom) {
      const sorted = items.slice().sort(function (a, b) {
        return a.wanted - b.wanted;
      });
      let fit = sorted.slice();
      while (fit.length * ROW > bottom - top && fit.length > 0) {
        // too many for the height: the least important go
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
        item.y = Math.max(item.wanted, index === 0 ? top : fit[index - 1].y + ROW);
      });
      for (let index = fit.length - 1; index >= 0; index--) {
        const limit = index === fit.length - 1 ? bottom : fit[index + 1].y - ROW;
        fit[index].y = Math.min(fit[index].y, limit);
      }
      return fit;
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
      const filter = editor.getState().restrictionEnzymes;
      const features = featureItems(data);
      const primers = primerItems(data);
      let sites = [];
      try {
        sites = cutSites(data, filter);
      } catch (error) {
        sites = [];
      }
      const labelWidth = width < 460 ? 86 : 120;
      const cx = width / 2;
      const cy = height / 2;
      const hasPrimers = primers.length > 0;
      const radius = Math.max(56, Math.min(height / 2 - 30, width / 2 - labelWidth - 34 - (hasPrimers ? 10 : 0)));
      const ringIn = radius - 8;
      const ringOut = radius + 8;
      const primerIn = ringOut + 4;
      const primerOut = primerIn + 6;
      const outer = hasPrimers ? primerOut : ringOut;
      layout = { cx: cx, cy: cy, radius: radius, length: length };

      svg = svgElement('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, class: 'own-map-svg', role: 'img', 'aria-label': 'Circular map of ' + (data.name || 'the sequence') });
      const at = function (r, a) {
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      };

      // the backbone and the scale
      svg.append(svgElement('circle', { cx: cx, cy: cy, r: radius, class: 'own-map-backbone', fill: 'none', 'stroke-width': 16 }));
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
      const step = steps.find(function (candidate) {
        return length / candidate <= 10;
      }) || 50000;
      for (let position = step; position < length; position += step) {
        const a = angleOf(position, length);
        const tick1 = at(ringIn - 2, a);
        const tick2 = at(ringIn - 6, a);
        svg.append(svgElement('line', { x1: tick1[0], y1: tick1[1], x2: tick2[0], y2: tick2[1], class: 'own-map-tick' }));
        const label = at(ringIn - 16, a);
        svg.append(svgElement('text', { x: label[0], y: label[1], 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'own-map-scale' }, String(position)));
      }
      const origin = at(ringIn - 6, angleOf(0, length));
      const originEnd = at(ringOut + 3, angleOf(0, length));
      svg.append(svgElement('line', { x1: origin[0], y1: origin[1], x2: originEnd[0], y2: originEnd[1], class: 'own-map-origin' }));

      // the selection behind the arrows
      const selection = editor.getState().selectionLayer || { start: -1, end: -1 };
      if (selection.start >= 0 && selection.end >= 0) {
        const range = arcOf({ start: selection.start, end: selection.end }, length);
        svg.append(svgElement('path', { d: arrowPath(cx, cy, ringIn - 4, ringOut + 4, range[0], range[1], 0, 0), class: 'own-map-selection' }));
      }
      const caret = editor.getState().caretPosition;
      if (typeof caret === 'number' && caret >= 0) {
        const a = angleOf(caret, length);
        const c1 = at(ringIn - 6, a);
        const c2 = at(ringOut + 8, a);
        svg.append(svgElement('line', { x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], class: 'own-map-caret' }));
      }

      const labels = [];
      const detail = function (item) {
        return { title: item.name, line: (item.start + 1) + '..' + (item.end + 1) + ' · ' + ((item.end >= item.start ? item.end - item.start : item.end + length - item.start) + 1) + ' bp' + (item.strand === 0 ? '' : (item.strand === 1 ? ' · forward' : ' · reverse')) };
      };
      const draw1 = function (item, rIn, rOut, head, rank) {
        const range = arcOf(item, length);
        const path = svgElement('path', { d: arrowPath(cx, cy, rIn, rOut, range[0], range[1], item.strand, head / radius), fill: item.color, class: 'own-map-feature' + (item.candidate ? ' candidate' : '') });
        path.append(svgElement('title', {}, item.name + ' (' + item.type + ') ' + detail(item).line));
        path.addEventListener('mouseenter', function () {
          hover = detail(item);
          showCenter();
        });
        path.addEventListener('mouseleave', function () {
          hover = null;
          showCenter();
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
        labels.push({ text: item.name, color: item.color, middle: middle, rOut: rOut, rank: rank, size: range[1] - range[0], kind: item.kind, onEnter: function () {
          hover = detail(item);
          showCenter();
        } });
      };
      features.sort(function (a, b) {
        return (b.end - b.start) - (a.end - a.start);
      }).forEach(function (item) {
        draw1(item, ringIn, ringOut, 10, 1);
      });
      primers.forEach(function (item) {
        draw1(item, primerIn, primerOut, 6, 2);
      });

      // the cut sites: a tick each, one label for sites that are close
      const ordered = sites.slice().sort(function (a, b) {
        return a.position - b.position;
      });
      const clusters = [];
      ordered.forEach(function (site) {
        const last = clusters[clusters.length - 1];
        if (last && (site.position - last.end) / length * TAU < 0.04 + 0.0001) {
          last.sites.push(site);
          last.end = site.position;
        } else {
          clusters.push({ start: site.position, end: site.position, sites: [site] });
        }
      });
      clusters.forEach(function (cluster) {
        cluster.sites.forEach(function (site) {
          const a = angleOf(site.position, length);
          const p1 = at(outer + 1, a);
          const p2 = at(outer + 6, a);
          const tick = svgElement('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], class: 'own-map-cut' });
          tick.append(svgElement('title', {}, site.name + ' cuts at ' + site.position + (site.count > 1 ? ' (' + site.count + ' sites)' : ' (single cutter)')));
          svg.append(tick);
        });
        const first = cluster.sites[0];
        const middle = angleOf((cluster.start + cluster.end) / 2, length);
        const names = cluster.sites.map(function (site) {
          return site.name;
        });
        labels.push({ text: first.name + (names.length > 1 ? ' +' + (names.length - 1) : ''), color: null, middle: middle, rOut: outer + 6, rank: 3, size: 0, kind: 'cut ' + (first.count === 1 ? 'single' : 'multi'), onEnter: function () {
          hover = { title: names.join(', '), line: 'cut at ' + cluster.sites.map(function (site) {
            return site.position;
          }).join(', ') };
          showCenter();
        } });
      });

      // the labels in a column on each side, joined to their arcs by a line
      const sides = { left: [], right: [] };
      labels.forEach(function (label) {
        const sin = Math.sin(label.middle);
        const cos = Math.cos(label.middle);
        label.side = cos >= 0 ? 'right' : 'left';
        label.wanted = cy + (outer + 14) * sin;
        label.anchor = at(label.rOut + 1, label.middle);
        label.elbow = at(label.rOut + 12, label.middle);
        sides[label.side].push(label);
      });
      const columnX = { left: cx - (outer + 34), right: cx + (outer + 34) };
      let hidden = 0;
      ['left', 'right'].forEach(function (side) {
        const placed = placeColumn(sides[side], 12, height - 12);
        hidden += sides[side].length - placed.length;
        placed.forEach(function (label) {
          const x = columnX[side];
          svg.append(svgElement('polyline', { points: label.anchor.join(',') + ' ' + label.elbow.join(',') + ' ' + x + ',' + label.y, class: 'own-map-leader', fill: 'none' }));
          // a long name is cut to the room of the column; the whole name is in the tooltip
          const room = Math.max(6, Math.floor((labelWidth - 10) / 7.4));
          const shown = label.text.length > room ? label.text.slice(0, room - 1) + '\u2026' : label.text;
          const text = svgElement('text', { x: x + (side === 'right' ? 4 : -4), y: label.y, 'text-anchor': side === 'right' ? 'start' : 'end', 'dominant-baseline': 'central', class: 'own-map-label ' + label.kind }, shown);
          text.append(svgElement('title', {}, label.text));
          if (label.color) {
            svg.append(svgElement('circle', { cx: x + (side === 'right' ? -1 : 1), cy: label.y, r: 2.5, fill: label.color, class: 'own-map-dot' }));
          }
          text.addEventListener('mouseenter', label.onEnter);
          text.addEventListener('mouseleave', function () {
            hover = null;
            showCenter();
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
        wrap.classList.toggle('dark-map', document.body.dataset.mapStyle === 'dark');
      }
      showCenter();

      svg.addEventListener('mousedown', function (event) {
        if (event.button !== 0) {
          return;
        }
        const where = positionAt(event);
        if (where.radius < ringIn - 30 || where.radius > outer + 24) {
          return;
        }
        drag = { from: where.position, moved: false };
        event.preventDefault();
      });
      svg.addEventListener('mousemove', function (event) {
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
        if (drag && !drag.moved) {
          editor.updateEditor({ selectionLayer: { start: -1, end: -1 }, caretPosition: drag.from });
        }
        drag = null;
      };
      svg.addEventListener('mouseup', finish);
      svg.addEventListener('mouseleave', finish);
      svg.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        openMenu(event, positionAt(event).position);
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
      const data = dataNow();
      const title = hover ? hover.title : (data.name || 'Sequence');
      const line = hover ? hover.line : String(data.sequence || '').length.toLocaleString('en') + ' bp' + (data.circular ? '' : ' (linear)');
      const words = title.length > 22 ? [title.slice(0, 21) + '…'] : [title];
      group.append(svgElement('text', { x: layout.cx, y: layout.cy - 6, 'text-anchor': 'middle', class: 'own-map-title' }, words[0]));
      group.append(svgElement('text', { x: layout.cx, y: layout.cy + 12, 'text-anchor': 'middle', class: 'own-map-sub' }, line.length > 34 ? line.slice(0, 33) + '…' : line));
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
      return [sequence.length, sequence.slice(0, 30), features, primers, selection.start, selection.end, state.caretPosition, JSON.stringify(state.restrictionEnzymes), JSON.stringify(state.annotationVisibility && state.annotationVisibility.featureTypesToHide), !!data.circular, host ? host.clientWidth + 'x' + host.clientHeight : '', document.body.dataset.mapStyle, zoom].join('|');
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
      controls.append(button('\u2212', 'Zoom out', function () {
        setZoom(zoom - 0.15);
      }), zoomLabel, button('+', 'Zoom in', function () {
        setZoom(zoom + 0.15);
      }), button('Fit', 'Fit the map to the panel', function () {
        setZoom(1);
      }));
      wrap.append(controls);
      // Ctrl (or Cmd) and the wheel zoom too
      host.addEventListener('wheel', function (event) {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          setZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
        }
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
