/**
 * "Saved" toasts always go away (saved-toast-ghost): a toast stuck half-faded ("ghost") appeared at the top right because the
 * .overlay-success CSS rule (animation + background) had been deleted as "unused" -- the class is added dynamically, so nothing
 * removed the toast. On any page run
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/saved-toast-ghost-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await savedToastGhostCheck();      // {pass, issues, ...}
 *
 * It checks the success toast has an animation and a real background, fires several toasts in quick succession (one batch
 * while the tab visibility is faked as hidden), samples opacity while they fade, and after 6 seconds asserts none is left in the DOM.
 * Needs a way to make a toast: it uses the page's own "Saved" notification via a fake .overlay element when the Notification class
 * is not reachable, so the CSS part is always tested; the removal part needs window.__notify (set below by a click on a Save button
 * is not required: a toast is built exactly like Notifications.class.ts does).
 */
window.savedToastGhostCheck = async function savedToastGhostCheck() {
  const issues = [];
  const container = document.getElementById('overlay-container') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'overlay-container' });
  const make = () => {
    const o = document.createElement('div');
    o.classList.add('overlay', 'overlay-success');
    o.addEventListener('animationend', () => o.remove());
    o.innerHTML = '<p role="status">Saved</p>';
    container.appendChild(o);
    return o;
  };
  const first = make();
  const cs = getComputedStyle(first);
  if (cs.animationName === 'none') issues.push('success toast has no animation');
  if (cs.backgroundColor === 'rgba(0, 0, 0, 0)') issues.push('success toast has no background (see-through)');
  const ph = () => document.querySelectorAll('#overlay-container .overlay-success').length;
  for (let i = 0; i < 4; i++) { make(); await new Promise(r => setTimeout(r, 150)); }
  // hidden-tab batch
  const vis = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  for (let i = 0; i < 3; i++) make();
  await new Promise(r => setTimeout(r, 500));
  delete document.visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
  const peak = ph();
  const ghosts = new Set();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    document.querySelectorAll('#overlay-container .overlay-success').forEach(el => {
      const op = parseFloat(getComputedStyle(el).opacity);
      if (i > 20 && op > 0 && op < 1) ghosts.add(op);
    });
  }
  const left = ph();
  if (left !== 0) issues.push(left + ' success toast(s) still in the DOM after 6 s');
  if (ghosts.size) issues.push('toasts still partly visible after 4 s: opacity ' + [...ghosts].join(','));
  return { pass: issues.length === 0, issues, peak, left };
};
