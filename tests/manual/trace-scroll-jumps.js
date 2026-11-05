// Finds out what makes the page jump. Open the entry in edit mode, open the developer console (Firefox: Cmd+Option+K),
// paste this whole file, press Enter (if Firefox asks, type  allow pasting  first). Then do what makes the page jump
// (scroll up, click Undo / Open popup in the spreadsheet header) and run:   copy(window.__scrollTrace.report())
// and paste the result into a message. Nothing from the cells is recorded, only what scrolled, from where and why.
(() => {
  const ed = window.tinymce && window.tinymce.activeEditor;
  const wins = [window];
  if (ed && ed.getWin) wins.push(ed.getWin());
  const events = [];
  let seq = 0;
  const describe = el => el ? `${el.tagName ? el.tagName.toLowerCase() : String(el)}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().replace(/\s+/g, '.').slice(0, 60) : ''}` : null;
  const stack = () => (new Error().stack || '').split('\n').slice(2, 8).map(line => line.trim().replace(/\(.*\/(.*?)\)/, '($1)')).join(' < ');
  const note = (kind, detail) => events.push({ n: ++seq, t: Math.round(performance.now()), kind, ...detail, active: describe(document.activeElement) });
  for (const w of wins) {
    const name = w === window ? 'page' : 'editor-frame';
    for (const fn of ['scrollTo', 'scroll', 'scrollBy']) {
      const original = w[fn];
      w[fn] = function (...args) { note(`${name}.${fn}`, { args: JSON.stringify(args).slice(0, 80), stack: stack() }); return original.apply(this, args); };
    }
    const proto = w.Element.prototype;
    const scrollIntoView = proto.scrollIntoView;
    proto.scrollIntoView = function (...args) { note(`${name}.scrollIntoView`, { el: describe(this), args: JSON.stringify(args).slice(0, 80), stack: stack() }); return scrollIntoView.apply(this, args); };
    const focus = w.HTMLElement.prototype.focus;
    w.HTMLElement.prototype.focus = function (options) {
      if (!options || !options.preventScroll) note(`${name}.focus (scrolls)`, { el: describe(this), stack: stack() });
      return focus.apply(this, arguments);
    };
    let last = w.scrollY;
    w.addEventListener('scroll', () => {
      const delta = Math.round(w.scrollY - last);
      if (Math.abs(delta) > 120) note(`${name} scrolled`, { from: Math.round(last), to: Math.round(w.scrollY), delta });
      last = w.scrollY;
    }, { passive: true });
  }
  document.addEventListener('pointerdown', event => note('pointerdown', { target: describe(event.target) }), true);
  window.__scrollTrace = { events, report: () => JSON.stringify(events.slice(-60), null, 1) };
  console.log('Scroll trace is running. Reproduce the jump, then run: copy(window.__scrollTrace.report())');
})();
