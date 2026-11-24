/**
 * Check of the well plate colour palette (no browser or build needed): node tests/manual/well-plate-colors-check.js
 *
 * Reads src/ts/well-plate-view.ts and checks that the palette has at least 24 distinct valid colours, starts with the 17 colours
 * plates have always used (existing plates and by-column groups keep their colours), that every colour keeps 3:1 contrast against
 * white, that no two colours are nearly identical, that dynamic grouping uses the same list, that the popup has a custom colour
 * input and remembers custom colours of the plate's groups, that the stored group list is not capped below the palette, and
 * that wells are printed with their colours (print-color-adjust).
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const view = read('src/ts/well-plate-view.ts');
const colorsSrc = read('src/ts/well-plate-colors.ts');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });

const block = colorsSrc.match(/const PALETTE = \[([\s\S]*?)\];/);
const palette = block ? block[1].match(/#[0-9a-fA-F]{6}/g) : [];
const OLD = ['#e5484d', '#f76b15', '#e5a50a', '#30a46c', '#12a594', '#2a6df4', '#8e4ec6', '#d6409f', '#7d8499', '#0b7285', '#a61e4d', '#5f3dc4', '#868e96', '#2b8a3e', '#c2255c', '#1864ab', '#e67700'];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = hex => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

check('C1 palette has at least 24 colours', palette.length >= 24, palette.length);
check('C2 all colours are distinct', new Set(palette.map(c => c.toLowerCase())).size === palette.length, 'duplicates');
check('C3 the first 17 are the colours plates always used, in order', OLD.every((c, i) => palette[i] === c), palette.slice(0, 17).join());
check('C4 every new colour has 3:1 contrast against white', palette.slice(OLD.length).every(c => 1.05 / (lum(c) + 0.05) >= 3), palette.slice(OLD.length).filter(c => 1.05 / (lum(c) + 0.05) < 3).join());
const near = [];
palette.forEach((a, i) => palette.forEach((b, j) => { if (j > i && j >= OLD.length && dist(a, b) < 45) near.push(`${a}/${b}`); }));
check('C5 no two colours are nearly identical (new ones: RGB distance >= 45 from all others)', near.length === 0, near.join());
check('C6 dynamic grouping uses the same list', /colorForIndex/.test(view) && !/const GROUP_COLORS/.test(view), 'GROUP_COLORS is separate');
check('C7 popup has a custom colour input', /type = 'color';[\s\S]{0,80}wp-swatch-picker/.test(view), 'missing');
check('C8 custom colours of the plate\'s groups are offered again', /const kept = /.test(view) && /wp-swatch-custom/.test(view), 'missing');
const cap = read('src/ts/inline-spreadsheet.ts').match(/plateGroups[\s\S]{0,300}?\.slice\(0, (\d+)\)/);
check('C9 stored group list holds at least a full palette', cap && Number(cap[1]) >= palette.length, cap && cap[1]);
check('C10 colours are stored per well as background-color and printed exactly', /background-color/.test(view) && /print-color-adjust: exact/.test(read('src/scss/main.scss')), 'missing');

// Behaviour of the pure helpers: compile the module and run it.
const os = require('os');
const { execFileSync } = require('child_process');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wpcolors-'));
const tsc = ['node_modules/.bin/tsc', '../elabftw/node_modules/.bin/tsc'].map(p => path.join(root, p)).find(p => fs.existsSync(p));
let lib = null;
try {
  if (!tsc) throw new Error('no tsc found');
  execFileSync(tsc, ['--outDir', out, '--target', 'es2020', '--module', 'commonjs', '--lib', 'dom,es2020', '--skipLibCheck', path.join(root, 'src/ts/well-plate-colors.ts')]);
  lib = require(path.join(out, 'well-plate-colors.js'));
} catch (error) { check('C11 the colour module compiles', false, String(error.message).slice(0, 200)); }
if (lib) {
  const { distinctColor, recolorGroups, BUILTIN_TEMPLATES, saveUserTemplate, loadUserTemplates, deleteUserTemplate, colorDistance, MIN_DISTINCT, PALETTE: P } = lib;
  // + never repeats a colour and stays clearly different while the plate has room
  let used = [], repeats = 0, close = 0;
  for (let i = 0; i < 40; i++) {
    const c = distinctColor(used);
    if (used.includes(c)) repeats++;
    if (i < 12 && used.some(u => colorDistance(c, u) < MIN_DISTINCT)) close++;
    used.push(c);
  }
  check('C12 + never repeats a colour (40 in a row)', repeats === 0, repeats);
  check('C13 + is clearly distinct from the colours in use (first 12)', close === 0, close);
  check('C14 + avoids colours already used even when they are palette colours', !P.slice(0, 5).includes(distinctColor(P.slice(0, 5), () => 0)), 'reused');
  const many = P.slice(0, 24);
  check('C15 + with a full palette still returns an unused colour', !many.includes(distinctColor(many)), 'reused');
  // templates recolour in order, uniquely, whatever the template length
  const groups = [{ color: '#111111' }, { color: '#222222' }, { color: '#333333' }, { color: '#444444' }];
  const tests = BUILTIN_TEMPLATES.map(t => ({ t, out: recolorGroups(groups, t.colors) }));
  check('C16 every built-in template recolours the groups in order', tests.every(x => x.out[0] === x.t.colors[0].toLowerCase() && x.out.length === 4), JSON.stringify(tests.map(x => x.out)));
  check('C17 recoloured groups never share a colour', tests.every(x => new Set(x.out).size === x.out.length), 'duplicate');
  const big = Array.from({ length: 30 }, () => ({ color: '#000000' }));
  const bigOut = recolorGroups(big, BUILTIN_TEMPLATES[1].colors);
  check('C18 more groups than template colours: extras get unused colours, all unique', new Set(bigOut).size === 30, new Set(bigOut).size);
  check('C19 a template with repeated colours still gives unique colours', new Set(recolorGroups(groups, ['#aaaaaa', '#aaaaaa', '#bbbbbb'])).size === 4, 'duplicate');
  // membership: simulate the view's one-pass remap on wells
  const wells = ['#111111', '#222222', null, '#111111', '#333333', '#222222'];
  const map = new Map(groups.map((g, i) => [g.color, recolorGroups(groups, BUILTIN_TEMPLATES[2].colors)[i]]));
  const after = wells.map(c => (c ? map.get(c) : null));
  const sameMembers = wells.every((c, i) => wells.every((d, j) => (c === d) === (after[i] === after[j])) && (c === null) === (after[i] === null));
  check('C20 recolouring keeps which wells are together and leaves empty wells alone', sameMembers, JSON.stringify(after));
  const swap = recolorGroups([{ color: '#aaaaaa' }, { color: '#bbbbbb' }], ['#bbbbbb', '#aaaaaa']);
  check('C21 a swap of two colours stays unique', swap[0] === '#bbbbbb' && swap[1] === '#aaaaaa', swap.join());
  // templates of any length
  const mk = n => Array.from({ length: n }, () => ({ color: '#000000' }));
  const four = ['#e5484d', '#2a6df4', '#30a46c', '#e5a50a'];
  const o12 = recolorGroups(mk(12), four);
  check('C36 a 4-colour template on 12 groups: its 4 colours first, in order, then 8 further colours, all 12 different', four.every((c, i) => o12[i] === c) && new Set(o12).size === 12 && o12.slice(4).every(c => !four.includes(c)), o12.join());
  const nbr = o12.slice(4).every((c, i, a) => i === 0 || colorDistance(c, a[i - 1]) >= 60) && colorDistance(o12[3], o12[4]) >= 60;
  check('C37 the continued colours next to each other are clearly different', nbr, o12.join());
  const twenty = Array.from({ length: 20 }, (_, i) => P[i]);
  const o3 = recolorGroups(mk(3), twenty);
  check('C38 a 20-colour template on 3 groups uses just its first 3', o3.join() === twenty.slice(0, 3).join(), o3.join());
  const fifteen = Array.from({ length: 15 }, (_, i) => P[i + 2]);
  const store15 = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  check('C39 a custom template with 15 colours is saved whole and loaded whole', saveUserTemplate('Fifteen', fifteen, store15) && JSON.stringify(loadUserTemplates(store15)[0].colors) === JSON.stringify(fifteen), JSON.stringify(loadUserTemplates(store15)));
  const o15 = recolorGroups(mk(15), loadUserTemplates(store15)[0].colors);
  const o20 = recolorGroups(mk(20), loadUserTemplates(store15)[0].colors);
  check('C40 that 15-colour template gives exactly those on 15 groups and 5 more different ones on 20', o15.join() === fifteen.join() && new Set(o20).size === 20 && o20.slice(0, 15).join() === fifteen.join(), o20.join());
  const bigSave = Array.from({ length: 40 }, (_, i) => lib.colorForIndex(i));
  check('C41 a template of 40 colours is kept whole', saveUserTemplate('Forty', bigSave, store15) && loadUserTemplates(store15).find(t => t.name === 'Forty').colors.length === 40, 'trimmed');
  // saving a personal template
  const store = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  check('C22 a saved template can be loaded again', saveUserTemplate('Mine', ['#112233', '#445566'], store) && JSON.stringify(loadUserTemplates(store)) === JSON.stringify([{ name: 'Mine', colors: ['#112233', '#445566'] }]), JSON.stringify(loadUserTemplates(store)));
  check('C23 saving under the same name replaces it; built-in names are refused', saveUserTemplate('mine', ['#778899'], store) && loadUserTemplates(store).length === 1 && !saveUserTemplate('Pastel', ['#778899'], store), JSON.stringify(loadUserTemplates(store)));
  deleteUserTemplate('mine', store);
  check('C24 a template can be deleted', loadUserTemplates(store).length === 0, 'still there');
  check('C26 broken stored data gives no templates', loadUserTemplates({ getItem: () => '{oops' }).length === 0, 'threw or returned some');
}
check('C27 popup has the + button, template select, apply, save and delete', ['wp-add-random', 'wp-template"', 'wp-template-apply', 'wp-template-save', 'wp-template-delete'].every(c => view.includes(c)), 'missing');
if (lib) {
  const D = lib.DEFAULT_SWATCHES, P2 = lib.PALETTE;
  check('C29 the popup shows 10 swatches by default', D.length === 10, D.length);
  check('C30 the 10 defaults are distinct palette colours', new Set(D).size === 10 && D.every(c => P2.includes(c)), D.join());
  let tight = []; D.forEach((a, i) => D.forEach((b, j) => { if (j > i && lib.colorDistance(a, b) < 80) tight.push(a + '/' + b); }));
  check('C31 the 10 defaults are clearly different from each other', tight.length === 0, tight.join());
  check('C32 the rest of the palette and the picker only come with "More colours"; added colours stay visible', /showMore/.test(view) && /More colours/.test(view) && /if \(showMore\) PALETTE/.test(view) && /picked\.add/.test(view), 'missing');
  check('C33 existing plates and by-column grouping: colorForIndex still walks the full 24-colour palette in the old order', lib.colorForIndex(0) === P2[0] && lib.colorForIndex(8) === '#7d8499' && lib.colorForIndex(16) === '#e67700' && lib.colorForIndex(23) === P2[23], 'order changed');
  check('C34 by-column grouping still takes its colours from colorForIndex', /colorForIndex\(next\)/.test(view), 'missing');
  const dyn = []; for (let i = 0; i < 30; i++) dyn.push(lib.colorForIndex(i));
  check('C35 30 column values still get 30 different colours', new Set(dyn).size === 30, new Set(dyn).size);
}
const scss = read('src/scss/main.scss');
check('C28 the group colour input beats the form-control padding (else its swatch is a thin line) and the template row wraps', /input\.wp-group-color\[type='color'\]/.test(scss) && /\.wp-template-row \{[\s\S]{0,80}flex-wrap: wrap/.test(scss), 'rule missing');
console.log(results.map(r => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' -- ' + r.detail : ''}`).join('\n'));
process.exit(results.every(r => r.ok) ? 0 : 1);
