/**
 * The dashboard of the Database: totals, the entries by module, and what needs attention. Talks to registry-dashboard.php?data=1.
 */
(function () {
  'use strict';
  const root = document.getElementById('registryDashboard');
  if (!root) {
    return;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  const element = function (tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  };
  const number = function (n) {
    return Number(n).toLocaleString('en-US');
  };
  let openRisk = null;
  let timer = 0;

  function donut(modules) {
    const total = modules.reduce(function (sum, m) {
      return sum + m.count;
    }, 0);
    const size = 220;
    const radius = 95;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Entries by module');
    if (total === 0) {
      const ring = document.createElementNS(SVGNS, 'circle');
      ring.setAttribute('cx', size / 2);
      ring.setAttribute('cy', size / 2);
      ring.setAttribute('r', radius - 18);
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#ccc');
      ring.setAttribute('stroke-width', '36');
      svg.append(ring);
      return svg;
    }
    const middle = document.createElementNS(SVGNS, 'text');
    middle.setAttribute('x', size / 2);
    middle.setAttribute('y', size / 2 - 2);
    middle.setAttribute('text-anchor', 'middle');
    middle.setAttribute('class', 'rd-donut-total');
    middle.textContent = number(total);
    const middleLabel = document.createElementNS(SVGNS, 'text');
    middleLabel.setAttribute('x', size / 2);
    middleLabel.setAttribute('y', size / 2 + 20);
    middleLabel.setAttribute('text-anchor', 'middle');
    middleLabel.setAttribute('class', 'rd-donut-label');
    middleLabel.textContent = 'entries';
    let angle = -Math.PI / 2;
    modules.filter(function (m) {
      return m.count > 0;
    }).forEach(function (m) {
      const sweep = (m.count / total) * Math.PI * 2;
      const point = function (a, r) {
        return [size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r];
      };
      const inner = radius - 36;
      const a0 = point(angle, radius);
      const a1 = point(angle + sweep - 0.0001, radius);
      const b0 = point(angle + sweep - 0.0001, inner);
      const b1 = point(angle, inner);
      const large = sweep > Math.PI ? 1 : 0;
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', 'M' + a0.join(',') + ' A' + radius + ',' + radius + ' 0 ' + large + ' 1 ' + a1.join(',') + ' L' + b0.join(',') + ' A' + inner + ',' + inner + ' 0 ' + large + ' 0 ' + b1.join(',') + ' Z');
      path.setAttribute('fill', '#' + (m.color || 'bdbdbd'));
      const tip = document.createElementNS(SVGNS, 'title');
      tip.textContent = m.title + ': ' + m.count;
      path.append(tip);
      svg.append(path);
      angle += sweep;
    });
    svg.append(middle, middleLabel);
    return svg;
  }

  function draw(data) {
    root.textContent = '';
    // the head
    const head = element('div', 'rd-head');
    const titles = element('div');
    titles.append(element('h1', '', 'Dashboard'), element('div', 'rd-sub', 'What is in the Database and what to check'));
    const tools = element('div', 'rd-tools');
    const autoLabel = element('label', 'mb-0');
    const auto = element('input');
    auto.type = 'checkbox';
    auto.checked = window.localStorage.getItem('registryDashboardAuto') !== '0';
    autoLabel.append(auto, document.createTextNode(' Refresh every minute'));
    const stamp = element('span', 'rd-sub', 'Updated ' + data.updated);
    const refresh = element('button', 'btn btn-secondary btn-sm', 'Refresh now');
    refresh.type = 'button';
    refresh.addEventListener('click', load);
    auto.addEventListener('change', function () {
      try {
        window.localStorage.setItem('registryDashboardAuto', auto.checked ? '1' : '0');
      } catch (error) {
        // not remembered
      }
      schedule(auto.checked);
    });
    tools.append(autoLabel, stamp, refresh);
    head.append(titles, tools);
    root.append(head);
    schedule(auto.checked);

    // the overview
    const overview = element('section', 'rd-panel');
    overview.append(element('h2', '', 'Overview'));
    const kpis = element('div', 'rd-kpis');
    [['main', data.total, 'Entries in the lab Database'], ['', data.modules, 'Modules'], ['', data.recent, 'Added this week'], ['', data.active, 'People active this month']].forEach(function (k) {
      const box = element('div', 'rd-kpi ' + k[0]);
      box.append(element('div', 'n', number(k[1])), element('div', 'l', k[2]));
      kpis.append(box);
    });
    overview.append(kpis);
    const split = element('div', 'rd-split');
    const chart = element('div', 'rd-donut');
    chart.append(donut(data.byModule));
    const legend = element('div', 'rd-legend');
    data.byModule.forEach(function (m) {
      const row = element('div');
      const dot = element('span', 'rd-dot');
      dot.style.backgroundColor = '#' + (m.color || 'bdbdbd');
      const share = data.total > 0 ? Math.round(m.count / data.byModule.reduce(function (sum, x) {
        return sum + x.count;
      }, 0) * 100) : 0;
      row.append(dot, element('span', '', m.title), element('span', 'rd-share', share + '%'));
      legend.append(row);
    });
    const list = element('div', 'rd-list');
    data.byModule.slice().sort(function (a, b) {
      return b.count - a.count;
    }).forEach(function (m) {
      const link = element('a');
      link.href = 'registry.php?category=' + m.id;
      link.append(element('span', '', m.title), element('span', 'c', number(m.count)));
      list.append(link);
    });
    split.append(chart, legend, list);
    overview.append(split);
    root.append(overview);

    // what needs attention
    const risks = element('section', 'rd-panel');
    risks.append(element('h2', '', 'Worth a look'));
    const grid = element('div', 'rd-risks');
    const detail = element('div', 'rd-detail');
    detail.hidden = true;
    const showDetail = function (risk) {
      detail.textContent = '';
      detail.append(element('strong', '', risk.label + ' (' + risk.count + ')'));
      if (risk.items.length === 0) {
        detail.append(element('p', 'text-muted mb-0', 'Nothing here.'));
      }
      risk.items.forEach(function (item) {
        const row = element('div', 'row-item');
        const link = element('a', '', item.title || 'Untitled');
        link.href = item.storage ? 'registry.php?storage_unit=' + item.id : 'registry.php?mode=view&id=' + item.id;
        row.append(element('span', 'mod', item.module || ''), link, element('span', 'det', item.detail || ''));
        detail.append(row);
      });
      if (risk.count > risk.items.length) {
        detail.append(element('p', 'text-muted small mb-0 mt-1', 'and ' + (risk.count - risk.items.length) + ' more'));
      }
    };
    data.risks.forEach(function (risk) {
      const tile = element('button', 'rd-risk' + (risk.count === 0 ? ' zero' : (risk.key === 'expired' ? ' bad' : ' warn')) + (openRisk === risk.key ? ' open' : ''));
      tile.type = 'button';
      const text = element('div');
      text.append(element('div', 'l', risk.label));
      tile.append(element('div', 'n', number(risk.count)), text);
      tile.addEventListener('click', function () {
        openRisk = openRisk === risk.key ? null : risk.key;
        grid.querySelectorAll('.rd-risk').forEach(function (t) {
          t.classList.remove('open');
        });
        if (openRisk) {
          tile.classList.add('open');
          showDetail(risk);
        }
        detail.hidden = !openRisk;
      });
      grid.append(tile);
      if (openRisk === risk.key) {
        showDetail(risk);
        detail.hidden = false;
      }
    });
    risks.append(grid, detail);
    root.append(risks);
  }

  function schedule(on) {
    window.clearTimeout(timer);
    if (on) {
      timer = window.setTimeout(load, 60000);
    }
  }

  async function load() {
    try {
      const response = await fetch('registry-dashboard.php?data=1', { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'The dashboard could not be loaded.');
      }
      draw(data);
    } catch (error) {
      root.textContent = error.message;
    }
  }
  load();
})();
