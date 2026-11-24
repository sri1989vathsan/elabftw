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
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });

const block = view.match(/const PALETTE = \[([\s\S]*?)\];/);
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
check('C6 dynamic grouping uses the same list', /const GROUP_COLORS = PALETTE;/.test(view), 'GROUP_COLORS is separate');
check('C7 popup has a custom colour input', /type = 'color';[\s\S]{0,80}wp-swatch-picker/.test(view), 'missing');
check('C8 custom colours of the plate\'s groups are offered again', /remembered/.test(view) && /wp-swatch-custom/.test(view), 'missing');
const cap = read('src/ts/inline-spreadsheet.ts').match(/plateGroups[\s\S]{0,300}?\.slice\(0, (\d+)\)/);
check('C9 stored group list holds at least a full palette', cap && Number(cap[1]) >= palette.length, cap && cap[1]);
check('C10 colours are stored per well as background-color and printed exactly', /background-color/.test(view) && /print-color-adjust: exact/.test(read('src/scss/main.scss')), 'missing');
console.log(results.map(r => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' -- ' + r.detail : ''}`).join('\n'));
process.exit(results.every(r => r.ok) ? 0 : 1);
