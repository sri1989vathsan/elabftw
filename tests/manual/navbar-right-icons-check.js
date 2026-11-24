/**
 * The icons at the right end of the top bar line up (_header.scss "#navbar-secondary-nav"). Logged in, on any page, at any window width and either
 * interface size (Alice is comfortable, Zz Tester compact; run once narrow, once wide):
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/navbar-right-icons-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await navbarRightIconsCheck();      // {pass, results, boxes}
 * Items: create (+), notification bell, What's new gift, guide "i", help "?", user initials. Checks: every box is the same size and square; the
 * centres share one y (within 1 px), on the middle of the icon row and on the centre line of the nav links (EXPERIMENTS...); the gaps between the boxes are equal (within 1 px); every glyph is
 * centred in its box (within 1 px) and the glyphs have one size; the bell's box does not change with the unread count (0, 1, 12); the boxes stay
 * inside the window. Only classes and the count attribute of the bell are touched, and restored. Nothing is sent anywhere.
 */
window.navbarRightIconsCheck = async function navbarRightIconsCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const ids = ['createNewDropdown', 'navbarNotifDropdown', 'navWhatsNewButton', 'navGuideLink', 'navbarDropdownHelp', 'navbarDropdown'];
  const items = ids.map(id => document.getElementById(id)).filter(Boolean);
  check('the five items (and create) are in the bar', items.length >= 5 && ['navbarNotifDropdown', 'navWhatsNewButton', 'navGuideLink', 'navbarDropdownHelp', 'navbarDropdown'].every(id => document.getElementById(id)), items.map(e => e.id).join());
  const box = e => { const b = e.getBoundingClientRect(); return { id: e.id, l: b.left, r: b.right, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
  const boxes = items.map(box);
  const spread = vals => Math.max(...vals) - Math.min(...vals);
  const r1 = n => Math.round(n * 10) / 10;
  check('every box is the same size', spread(boxes.map(b => b.w)) <= 1 && spread(boxes.map(b => b.h)) <= 1, JSON.stringify(boxes.map(b => [b.id, r1(b.w), r1(b.h)])));
  check('every box is square', boxes.every(b => Math.abs(b.w - b.h) <= 1), JSON.stringify(boxes.map(b => [b.id, r1(b.w), r1(b.h)])));
  check('the centres share one y (within 1 px)', spread(boxes.map(b => b.cy)) <= 1, JSON.stringify(boxes.map(b => [b.id, r1(b.cy)])));
  const gaps = boxes.slice(1).map((b, i) => b.l - boxes[i].r);
  check('the gaps between the boxes are equal (within 1 px)', spread(gaps) <= 1, JSON.stringify(gaps.map(r1)));
  check('the boxes do not overlap', gaps.every(g => g >= 0), JSON.stringify(gaps.map(r1)));
  check('the boxes are inside the window', !document.documentElement.clientWidth || boxes.every(b => b.l >= 0 && b.r <= document.documentElement.clientWidth + 0.5), JSON.stringify(boxes.map(b => [b.id, r1(b.l), r1(b.r)])));
  const glyphs = items.map(e => { const g = e.querySelector('i, .initials'); return g ? { ...box(g), id: e.id } : null; }).filter(Boolean);
  check('every glyph is centred in its box (within 1 px)', glyphs.every(g => { const b = boxes.find(x => x.id === g.id); return Math.abs(g.cx - b.cx) <= 1 && Math.abs(g.cy - b.cy) <= 1; }), JSON.stringify(glyphs.map(g => { const b = boxes.find(x => x.id === g.id); return [g.id, r1(g.cx - b.cx), r1(g.cy - b.cy)]; })));
  // the thin plus is drawn smaller on purpose (it fills its whole em box), the initials are text
  const icons = glyphs.filter(g => !['navbarDropdown', 'createNewDropdown'].includes(g.id));
  check('the icon glyphs have one size (within 1 px)', spread(icons.map(g => g.w)) <= 1 && spread(icons.map(g => g.h)) <= 1, JSON.stringify(icons.map(g => [g.id, r1(g.w), r1(g.h)])));
  const navText = document.querySelector('#navbar-primary-nav .nav-link');
  if (navText) { const nb = box(navText); check('the row is on the same centre line as the nav links (within 1 px)', Math.abs(boxes[0].cy - nb.cy) <= 1, `${r1(boxes[0].cy)} vs ${r1(nb.cy)}`); }
  const row = document.getElementById('navbar-secondary-nav');
  if (row) { const rb = row.getBoundingClientRect(); check('they sit on the middle of the icon row', Math.abs(boxes[0].cy - (rb.top + rb.height / 2)) <= 1, `${r1(boxes[0].cy)} vs ${r1(rb.top + rb.height / 2)}`); }

  // the unread count must not change the bell's box
  const bell = document.getElementById('navbarNotifDropdown');
  if (bell) {
    const was = { cls: bell.classList.contains('notif-active'), count: bell.dataset.count };
    const seen = [];
    for (const [active, count] of [[false, '0'], [true, '1'], [true, '12']]) {
      bell.classList.toggle('notif-active', active); bell.dataset.count = count;
      const b = box(bell); seen.push([r1(b.l), r1(b.cy), r1(b.w), r1(b.h)]);
    }
    bell.classList.toggle('notif-active', was.cls);
    if (was.count === undefined) delete bell.dataset.count; else bell.dataset.count = was.count;
    check("the unread count does not change the bell's box", seen.every(s => s.join() === seen[0].join()), JSON.stringify(seen));
    const after = items.map(box);
    check('and the other boxes stay where they were', after.every((b, i) => Math.abs(b.l - boxes[i].l) < 0.5), 'moved');
  }
  const failed = results.filter(r => !r.ok);
  return { pass: failed.length === 0, width: innerWidth, failed, results, boxes: boxes.map(b => ({ id: b.id, cx: r1(b.cx), cy: r1(b.cy), w: r1(b.w), h: r1(b.h) })) };
};
