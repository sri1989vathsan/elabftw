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
  let onlyMine = false;
  try {
    onlyMine = window.localStorage.getItem('registryDashboardMine') === '1';
  } catch (error) {
    onlyMine = false;
  }
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
    // what is the user's: the lists and the counts of the checks can be limited to the entries of the user
    const scope = element('div', 'btn-group btn-group-sm');
    [['All entries', false], ['Only mine', true]].forEach(function (item) {
      const button = element('button', 'btn btn-outline-secondary' + (onlyMine === item[1] ? ' active' : ''), item[0]);
      button.type = 'button';
      button.addEventListener('click', function () {
        onlyMine = item[1];
        try {
          window.localStorage.setItem('registryDashboardMine', onlyMine ? '1' : '0');
        } catch (error) {
          // not remembered
        }
        draw(data);
      });
      scope.append(button);
    });
    tools.append(scope, autoLabel, stamp, refresh);
    head.append(titles, tools);
    root.append(head);
    schedule(auto.checked);

    // the overview
    const overview = element('section', 'rd-panel');
    overview.append(element('h2', '', 'Overview'));
    const kpis = element('div', 'rd-kpis');
    [['main', data.total, 'Entries in the lab Database'], ['', data.mineTotal, 'Of them yours'], ['', data.modules, 'Modules'], ['', data.recent, 'Added this week'], ['', data.active, 'People active this month']].forEach(function (k) {
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
      row.title = m.title + ': ' + m.count + ' in all, ' + m.mine + ' yours';
      legend.append(row);
    });
    const list = element('div', 'rd-list');
    data.byModule.slice().sort(function (a, b) {
      return b.count - a.count;
    }).forEach(function (m) {
      const link = element('a');
      link.href = 'registry.php?category=' + m.id;
      link.append(element('span', '', m.title), element('span', 'c', number(onlyMine ? m.mine : m.count) + (onlyMine ? '' : (m.mine ? '  (' + number(m.mine) + ' yours)' : ''))));
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
      const shown = shownCount(risk);
      detail.append(element('strong', '', risk.label + ' (' + shown + (risk.mine !== null && !onlyMine ? ', ' + risk.mine + ' yours' : '') + ')'));
      const items = onlyMine && risk.mine !== null ? risk.items.filter(function (item) {
        return item.mine;
      }) : risk.items;
      if (items.length === 0) {
        detail.append(element('p', 'text-muted mb-0', 'Nothing here.'));
      }
      items.forEach(function (item) {
        const row = element('div', 'row-item');
        const link = element('a', '', item.title || 'Untitled');
        link.href = item.storage ? 'registry.php?storage_unit=' + item.id : 'registry.php?mode=view&id=' + item.id;
        // whose it is: the entries of the user are marked
        const who = element('span', 'rd-who' + (item.mine ? ' mine' : ''), item.storage ? '' : (item.mine ? 'yours' : (item.owner || '')));
        row.append(element('span', 'mod', item.module || ''), link, who, element('span', 'det', item.detail || ''));
        detail.append(row);
      });
      if (shown > items.length) {
        detail.append(element('p', 'text-muted small mb-0 mt-1', 'and ' + (shown - items.length) + ' more'));
      }
    };
    // the count of a check: all of them, or the ones that are the user's
    const shownCount = function (risk) {
      return onlyMine && risk.mine !== null ? risk.mine : risk.count;
    };
    data.risks.forEach(function (risk) {
      const count = shownCount(risk);
      const tile = element('button', 'rd-risk' + (count === 0 ? ' zero' : (risk.key === 'expired' ? ' bad' : ' warn')) + (openRisk === risk.key ? ' open' : ''));
      tile.type = 'button';
      const text = element('div');
      text.append(element('div', 'l', risk.label));
      // next to the count: how many of them are the user's
      if (!onlyMine && risk.mine !== null && risk.count > 0) {
        text.append(element('div', 'rd-mine', risk.mine + ' yours' + (risk.mine === 0 ? ', the rest are others\'' : '')));
      }
      tile.append(element('div', 'n', number(count)), text);
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

  // a tab in the background does not ask the server every minute (the checks read the whole Database); it catches up once when it is shown again
  let waiting = false;
  let wantsAuto = false;

  function tick() {
    if (document.hidden) {
      waiting = true;
      return;
    }
    load();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && waiting && wantsAuto) {
      waiting = false;
      load();
    }
  });

  function schedule(on) {
    window.clearTimeout(timer);
    wantsAuto = on;
    waiting = false;
    if (on) {
      timer = window.setTimeout(tick, 60000);
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
