/**
 * No "Saved" toast appears by itself when a page is opened (first-load-toast): load any page of the app (the dashboard, the admin Team tab, a view page)
 * and, as soon as it has loaded, run
 *
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/first-load-toast-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await firstLoadToastCheck();      // {pass, toasts}
 *
 * It watches the toast container for 5 seconds and fails when any toast appears: nobody has done anything yet, so nothing was saved. (A page-load
 * request that reads data with PATCH, such as the folder-view lookup, must send notifOnSaved: 0, or every page showed "Saved" on its own.)
 * Run it on a page you have just opened, before clicking anything.
 */
window.firstLoadToastCheck = async function firstLoadToastCheck() {
  const toasts = new Set();
  const read = () => document.querySelectorAll('#overlay-container .overlay').forEach(el => toasts.add(el.textContent.trim()));
  const observer = new MutationObserver(read);
  observer.observe(document.body, { childList: true, subtree: true });
  read();
  for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 200)); read(); }
  observer.disconnect();
  return { pass: toasts.size === 0, toasts: [...toasts] };
};
