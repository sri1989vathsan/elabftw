/**
 * Placeholder contrast (WCAG AA 4.5:1) of every visible input and textarea of the current page. Load in the console, open the dialog or
 * popover to check, and call `placeholderContrastCheck()`: it returns { total, bad: [{id, placeholder, ratio}] } (bad = under 4.5:1).
 * Needs a browser that exposes getComputedStyle(el, '::placeholder') (Firefox and Chromium do).
 */
window.placeholderContrastCheck = function placeholderContrastCheck() {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/); if (!m) return null; let v; if (m[1]) { v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; } v = m[2].split(/[ /]+/).filter(Boolean).map(Number); return { r: v[0] * 255, g: v[1] * 255, b: v[2] * 255, a: v.length > 3 ? v[3] : 1 }; };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const backgroundOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p.a > 0) { stack.push(p); if (p.a >= 1) break; } } let acc = { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc); return acc; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const results = [];
  document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
    const box = el.getBoundingClientRect();
    if (box.width < 5 || box.height < 5 || getComputedStyle(el).visibility === 'hidden') return;
    const ph = getComputedStyle(el, '::placeholder');
    const fg = parse(ph.color);
    if (!fg) return;
    const opacity = parseFloat(ph.opacity);
    fg.a *= Number.isNaN(opacity) ? 1 : opacity;
    const bg = backgroundOf(el);
    results.push({ id: (el.id || el.name || el.placeholder).slice(0, 30), placeholder: el.placeholder.slice(0, 24), ratio: Math.round(ratio(over(fg, bg), bg) * 100) / 100 });
  });
  return { total: results.length, bad: results.filter(r => r.ratio < 4.5) };
};
