/**
 * The deadline reminder as a small chip in the top right corner (reminder-chip-no-overlap). Logged in, on any page; two steps because the
 * reminder is read when the page loads:
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/reminder-chip-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await reminderChipCheck();      // 1st call: makes a task that is due soon and says to reload
 *   (reload the page, load the script again)
 *   await reminderChipCheck();      // 2nd call: {pass, results}; removes the task again
 *
 * Checks: the chip is a pill of at least 1.5rem with the clock and the count; it sits in the top right corner, under the navbar; its box does not touch any
 * other fixed or sticky box on the page (back-to-top button, side panel buttons, notices, toolbars, the tab bar of the admin page); a click opens
 * the full reminder (title, the tasks as a list, Collapse), whose box does not touch them either; Collapse or a click on the title closes it again;
 * it goes back to the chip by itself: on a click outside, Esc, a scroll of the page and after 8 seconds without the pointer inside (paused while the pointer is inside); the next page starts as the chip. The boxes are compared with the navbar, the tab bar of the admin page, the edit toolbar, the notices ("Saved") and the scroll buttons. Nothing is sent anywhere.
 */
window.reminderChipCheck = async function reminderChipCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hdr = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const api = async (method, path, body) => {
    const r = await fetch('/api/v2/' + path, { method, credentials: 'same-origin', headers: hdr, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, loc: r.headers.get('Location') };
  };
  const mark = 'reminderChipTask';
  const made = sessionStorage.getItem(mark);
  if (!made) {
    const deadline = new Date(Date.now() + 10 * 60000).toISOString();
    const res = await api('POST', 'todolist', { content: 'Chip check task', deadline, reminder_minutes: 60 });
    const id = (res.loc || '').split('/').pop();
    check('a task that is due soon was made', res.status === 201 && id, 'status ' + res.status);
    if (id) sessionStorage.setItem(mark, id);
    sessionStorage.removeItem('todo-reminder-banner-open');
    return { pass: results.every(r => r.ok), results, next: 'reload the page and run reminderChipCheck() again' };
  }
  const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const touches = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  const others = (self) => [...document.querySelectorAll('body *')].filter(el => {
    if (el === self || self.contains(el) || el.contains(self)) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky' && !el.matches('.nav-tabs, [role="tablist"]')) return false;
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return false;
    // a full-page wrapper (a backdrop, the container of the fixed buttons) is not a thing to avoid
    if (b.width > innerWidth * 0.9 && b.height > innerHeight * 0.5) return false;
    return true;
  });
  // a fixed wrapper that draws nothing itself (the column of scroll buttons) stands for the visible things inside it
  const drawn = el => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor.match(/[\d.]+/g) || [];
    return (bg.length === 3 || parseFloat(bg[3]) > 0) || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none' || [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  };
  const visibleParts = el => drawn(el) || !el.children.length ? [el] : [...el.querySelectorAll('*')].filter(c => {
    const b = c.getBoundingClientRect();
    return b.width > 2 && b.height > 2 && getComputedStyle(c).visibility !== 'hidden' && getComputedStyle(c).display !== 'none' && drawn(c);
  });
  const clash = (self) => {
    const mine = box(self);
    return others(self).flatMap(visibleParts).filter(el => touches(mine, box(el))).map(el => (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ').slice(0, 2).join('.'));
  };
  try {
    await sleep(1500);
    const chip = document.querySelector('.reminder-chip');
    check('the reminder shows as a chip', !!chip, 'no .reminder-chip (is the task due within its reminder window?)');
    if (chip) {
      const b = box(chip);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      check('the chip is a rounded pill of about 1.5rem', b.h >= rem * 1.45 && b.h <= rem * 2.1 && parseFloat(getComputedStyle(chip).borderRadius) >= b.h / 2 - 1, `${b.w} x ${b.h}`);
      check('the chip has the clock and the count', !!chip.querySelector('.fa-clock') && /^\d+$/.test((chip.querySelector('.reminder-chip-count')?.textContent || '').trim()), chip.textContent);
      check('the chip is in the top right corner', b.r > innerWidth * 0.7 && b.t < innerHeight * 0.3 && b.r <= innerWidth && b.t >= 0, JSON.stringify(b));
      const nav = document.getElementById('main-navbar');
      if (nav) check('the chip is below the navbar', b.t >= box(nav).b - 1, `chip top ${b.t}, navbar bottom ${box(nav).b}`);
      const bg = getComputedStyle(chip).backgroundColor.match(/\d+/g).map(Number);
      check('the chip is warm (amber) tinted', bg[0] > bg[2] + 20, getComputedStyle(chip).backgroundColor);
      check('the chip touches nothing else on the page', clash(chip).length === 0, clash(chip).join(' | '));
      const tabs = document.querySelector('.nav-tabs, [role="tablist"]');
      if (tabs) check('the chip is off the tab bar', !touches(b, box(tabs)), 'over the tab bar');
      chip.click();
      await sleep(500);
      const panel = document.querySelector('.reminder-banner');
      check('a click opens the full reminder', !!panel && !document.querySelector('.reminder-chip'), 'no panel');
      if (panel) {
        check('it shows the title and the task as a list item', /due soon/i.test(panel.textContent) && panel.querySelectorAll('.reminder-banner-item').length >= 1 && /Chip check task/.test(panel.textContent), panel.textContent.slice(0, 80));
        check('the opened reminder touches nothing else', clash(panel).length === 0, clash(panel).join(' | '));
        check('the opened reminder stays inside the window', box(panel).t >= 0 && box(panel).r <= innerWidth && box(panel).b <= innerHeight, JSON.stringify(box(panel)));
        check('the choice is kept for the session', sessionStorage.getItem('todo-reminder-banner-open') === '1', sessionStorage.getItem('todo-reminder-banner-open'));
        panel.querySelector('.reminder-banner-dismiss').click();
        await sleep(400);
        check('Collapse brings the chip back', !!document.querySelector('.reminder-chip') && !document.querySelector('.reminder-banner'), 'still open');
        check('the collapsed state is kept for the session', sessionStorage.getItem('todo-reminder-banner-open') === '0', sessionStorage.getItem('todo-reminder-banner-open'));
        const open = async () => { document.querySelector('.reminder-chip')?.click(); await sleep(350); return !!document.querySelector('.reminder-banner'); };
        const closed = () => !!document.querySelector('.reminder-chip') && !document.querySelector('.reminder-banner');
        check('the chip opens it again', await open(), 'did not open');
        document.querySelector('.reminder-banner-toggle').click(); await sleep(300);
        check('a click on the title collapses it too', closed(), 'still open');
        await open();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
        check('Esc collapses it', closed(), 'still open');
        await open();
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(300);
        check('a click outside collapses it', closed(), 'still open');
        await open();
        panel.isConnected && document.querySelector('.reminder-banner')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(300);
        check('a click inside does not collapse it', !closed(), 'collapsed');
        const spacer = document.createElement('div'); spacer.style.height = '3000px'; spacer.id = 'chipCheckSpacer'; document.body.appendChild(spacer);
        window.scrollBy(0, 200); await sleep(500);
        check('a scroll of the page collapses it', closed(), 'still open');
        window.scrollTo(0, 0); spacer.remove();
        // 8 seconds with the pointer away
        await open();
        await sleep(8600);
        check('it collapses by itself after about 8 seconds', closed(), 'still open after 8.6 s');
        // the pointer inside holds it open
        await open();
        const held = document.querySelector('.reminder-banner');
        held.dispatchEvent(new MouseEvent('mouseenter'));
        await sleep(8600);
        check('with the pointer inside it stays open', !closed(), 'collapsed while the pointer was inside');
        held.dispatchEvent(new MouseEvent('mouseleave'));
        await sleep(8600);
        check('after the pointer leaves it collapses again', closed(), 'still open');
        window.dispatchEvent(new Event('pagehide'));
      }
    }
  } finally {
    const id = sessionStorage.getItem(mark);
    if (id) { await api('DELETE', 'todolist/' + id); sessionStorage.removeItem(mark); }
    sessionStorage.removeItem('todo-reminder-banner-open');
  }
  return { pass: results.every(r => r.ok), results };
};
