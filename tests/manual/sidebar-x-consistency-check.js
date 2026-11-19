/**
 * The x position of the same things in every side panel (sidebar-x-consistency). On a view or edit page, logged in:
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/sidebar-x-consistency-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await sidebarXConsistencyCheck();      // {pass, results, table}
 *
 * Opens each panel that exists on the page (Folders, Search, To-do, Calendar, Contents, HTML tools) and compares, with a tolerance of 1 px:
 * the panel's left edge and width, its scroll bar room, the left edge of its header, the right edge, the width, the height and the top of the Close
 * button and of the Refresh button, the Refresh icon and tooltip, and that Refresh sits left of Close in the same row. Every panel but HTML tools
 * must have a Refresh. `table` lists the numbers per panel. Nothing is changed.
 */
window.sidebarXConsistencyCheck = async function sidebarXConsistencyCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const r1 = n => Math.round(n * 10) / 10;
  const panels = [['Folders', 'foldersPanel'], ['Search', 'favoritesPanel'], ['To-do', 'todolistPanel'], ['Calendar', 'calendarActivityPanel'], ['Contents', 'tocPanel'], ['HTML tools', 'htmlToolsPanel']];
  const table = {};
  for (const [name, id] of panels) {
    const opener = document.getElementById(id + 'Opener');
    if (!opener) continue;
    document.querySelectorAll('.side-panel:not([hidden])').forEach(p => document.getElementById(p.id + 'Opener')?.click());
    await sleep(300);
    opener.click(); await sleep(1400);
    const panel = document.getElementById(id);
    if (!panel || panel.hidden) { check(`${name}: the panel opens`, false, 'did not open'); continue; }
    const pb = panel.getBoundingClientRect();
    const close = panel.querySelector(':scope > .panel-close');
    const refresh = panel.querySelector(':scope > .panel-refresh');
    const head = panel.querySelector('h3, .folder-explorer-bar, .toc-heading');
    const cb = close && close.getBoundingClientRect();
    const rb = refresh && refresh.getBoundingClientRect();
    table[name] = {
      panelL: r1(pb.left), panelW: r1(pb.width), gutter: panel.offsetWidth - panel.clientWidth,
      headL: head ? r1(head.getBoundingClientRect().left) : null,
      closeR: cb && r1(cb.right), closeW: cb && r1(cb.width), closeH: cb && r1(cb.height), closeTop: cb && r1(cb.top - pb.top),
      refreshR: rb && r1(rb.right), refreshW: rb && r1(rb.width), refreshH: rb && r1(rb.height), refreshTop: rb && r1(rb.top - pb.top),
      refreshIcon: refresh && (refresh.querySelector('i')?.className || '').replace(/\bfa-spin\b/, '').trim(), refreshTitle: refresh && refresh.title,
    };
    check(`${name}: has a Close button in the corner row`, !!close, 'no .panel-close');
    if (name !== 'HTML tools') check(`${name}: has a Refresh button`, !!refresh, 'no .panel-refresh');
    if (close && refresh) check(`${name}: Refresh is left of Close in the same row`, rb.right < cb.left + 0.5 && Math.abs(rb.top - cb.top) <= 1, JSON.stringify({ r: rb.right, cl: cb.left, rt: rb.top, ct: cb.top }));
  }
  const names = Object.keys(table);
  const same = (key, tol = 1) => {
    const values = names.map(n => table[n][key]).filter(v => v !== null && v !== undefined);
    if (values.length < 2) return true;
    return typeof values[0] === 'string' ? values.every(v => v === values[0]) : Math.max(...values) - Math.min(...values) <= tol;
  };
  const detail = key => names.map(n => `${n}: ${table[n][key]}`).join(', ');
  [['panelL', 'the panel starts at the same x'], ['panelW', 'the panel has the same width'], ['gutter', 'the scroll bar room is the same'], ['headL', 'the header starts at the same x'],
    ['closeR', 'the right edge of Close is the same'], ['closeW', 'Close has the same width'], ['closeH', 'Close has the same height'], ['closeTop', 'Close is at the same height'],
    ['refreshR', 'the right edge of Refresh is the same'], ['refreshW', 'Refresh has the same width'], ['refreshH', 'Refresh has the same height'], ['refreshTop', 'Refresh is at the same height'],
    ['refreshIcon', 'Refresh has the same icon'], ['refreshTitle', 'Refresh has the same tooltip']].forEach(([key, label]) => check(`all panels: ${label}`, same(key), detail(key)));
  return { pass: results.every(r => r.ok), results, table };
};
