/**
 * The dashboard of the Database: totals, the entries by module, and what to check. Talks to registry-dashboard.php?data=1.
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

  function draw(data) {
    root.textContent = '';
    // the head
    const head = element('div', 'rd-head');
    head.append(element('h1', '', 'The Database at a glance'));
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
    head.append(tools);
    root.append(head);
    schedule(auto.checked);

    // the numbers, as facts in a line
    const facts = element('div', 'rd-facts');
    [[data.total, 'entries in the lab Database'], [data.modules, 'modules'], [data.recent, 'new this week'], [data.active, 'people active this month']].forEach(function (f) {
      const fact = element('div', 'rd-fact');
      fact.append(element('span', 'n', number(f[0])), element('span', 'l', f[1]));
      facts.append(fact);
    });
    root.append(facts);

    // the modules: one bar cut in parts, then a line with a small bar for each module
    const modulesSection = element('section', 'rd-section');
    modulesSection.append(element('h2', '', 'Entries by module'));
    const total = data.byModule.reduce(function (sum, m) {
      return sum + m.count;
    }, 0);
    const stack = element('div', 'rd-stack');
    data.byModule.filter(function (m) {
      return m.count > 0;
    }).forEach(function (m) {
      const part = element('span');
      part.style.width = (m.count / total * 100) + '%';
      part.style.backgroundColor = '#' + (m.color || 'bdbdbd');
      part.title = m.title + ': ' + m.count;
      stack.append(part);
    });
    modulesSection.append(stack);
    const highest = Math.max.apply(null, data.byModule.map(function (m) {
      return m.count;
    }).concat([1]));
    const grid = element('div', 'rd-modules');
    data.byModule.slice().sort(function (a, b) {
      return b.count - a.count;
    }).forEach(function (m) {
      const link = element('a', 'rd-module');
      link.href = 'registry.php?category=' + m.id;
      const name = element('span', 'name');
      const dot = element('span', 'rd-dot');
      dot.style.backgroundColor = '#' + (m.color || 'bdbdbd');
      name.append(dot, document.createTextNode(m.title));
      const bar = element('span', 'bar');
      const fill = element('i');
      fill.style.width = (m.count / highest * 100) + '%';
      fill.style.backgroundColor = '#' + (m.color || 'bdbdbd');
      bar.append(fill);
      link.append(name, element('span', 'count', number(m.count)), bar);
      grid.append(link);
    });
    modulesSection.append(grid);
    root.append(modulesSection);

    // the checks
    const checksSection = element('section', 'rd-section');
    checksSection.append(element('h2', '', 'Checks'));
    const list = element('div', 'rd-checks');
    data.risks.forEach(function (risk) {
      const level = risk.count === 0 ? '' : (risk.key === 'expired' ? ' bad' : ' warn');
      const check = element('div', 'rd-check' + level);
      const toggle = element('button');
      toggle.type = 'button';
      toggle.append(element('span', 'rd-status'), element('span', 'label', risk.label), element('span', 'count', number(risk.count)), element('span', 'more', risk.count > 0 ? (openRisk === risk.key ? 'hide' : 'show') : ''));
      const detail = element('div', 'rd-detail');
      detail.hidden = openRisk !== risk.key || risk.count === 0;
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
      toggle.addEventListener('click', function () {
        if (risk.count === 0) {
          return;
        }
        openRisk = openRisk === risk.key ? null : risk.key;
        detail.hidden = openRisk !== risk.key;
        toggle.lastChild.textContent = openRisk === risk.key ? 'hide' : 'show';
      });
      check.append(toggle, detail);
      list.append(check);
    });
    checksSection.append(list);
    root.append(checksSection);
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
