/**
 * The deadline reminder as a small chip in the bottom right corner (reminder-chip-no-overlap). Logged in, on any page; two steps because the
 * reminder is read when the page loads:
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/reminder-chip-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await reminderChipCheck();      // 1st call: makes a task that is due soon and says to reload
 *   (reload the page, load the script again)
 *   await reminderChipCheck();      // 2nd call: {pass, results}; removes the task again
 *
 * Checks: the chip is a pill of at least 1.5rem with the clock and the count; it sits in the bottom right corner; its box does not touch any
 * other fixed or sticky box on the page (back-to-top button, side panel buttons, notices, toolbars, the tab bar of the admin page); a click opens
 * the full reminder (title, the tasks as a list, Collapse), whose box does not touch them either; Collapse or a click on the title closes it again;
 * the choice is kept for the rest of the session (the next page does not open it by itself). Nothing is sent anywhere.
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
    const deadline = new Date(Date.now() + 10 * 60000).toISOString().slice(0, 19).replace('T', ' ');
    const res = await api('POST', 'todolist', { body: 'Chip check task', deadline, reminder_minutes: 60 });
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
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return false;
    // a full-page wrapper (a backdrop, the container of the fixed buttons) is not a thing to avoid
    if (b.width > innerWidth * 0.9 && b.height > innerHeight * 0.5) return false;
    return true;
  });
  const clash = (self) => {
    const mine = box(self);
    return others(self).filter(el => touches(mine, box(el))).map(el => (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ').slice(0, 2).join('.'));
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
      check('the chip is in the bottom right corner', b.r > innerWidth * 0.7 && b.b > innerHeight * 0.8 && b.r <= innerWidth && b.b <= innerHeight, JSON.stringify(b));
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
        document.querySelector('.reminder-chip').click();
        await sleep(300);
        document.querySelector('.reminder-banner-toggle').click();
        await sleep(300);
        check('a click on the title collapses it too', !!document.querySelector('.reminder-chip'), 'still open');
      }
    }
  } finally {
    const id = sessionStorage.getItem(mark);
    if (id) { await api('DELETE', 'todolist/' + id); sessionStorage.removeItem(mark); }
    sessionStorage.removeItem('todo-reminder-banner-open');
  }
  return { pass: results.every(r => r.ok), results };
};
