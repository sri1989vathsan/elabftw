/**
 * This file is part of the eLabFTW fork's customizations.
 *
 * Colours for well plate groups: the palette, the built-in and personal colour templates, and the helpers that pick
 * a new colour clearly different from the ones a plate already uses or recolour the groups from a template.
 * Pure functions, so tests/manual/well-plate-colors-check.js can run them without a browser.
 */

// 24 swatches. The first 17 are the colours plates have always used (so existing plates and by-column groups look the same);
// the rest add Okabe-Ito style hues for colour-blind readers. The new ones keep 3:1 contrast against white.
export const PALETTE = [
  '#e5484d', '#f76b15', '#e5a50a', '#30a46c', '#12a594', '#2a6df4', '#8e4ec6', '#d6409f', '#7d8499',
  '#0b7285', '#a61e4d', '#5f3dc4', '#868e96', '#2b8a3e', '#c2255c', '#1864ab', '#e67700',
  '#cc79a7', '#8c564b', '#8a8d00', '#3d3d3d', '#4a90a4', '#b35900', '#7a5195', '#5c7cfa',
];

// The ten swatches the popup shows first: clearly different hues (and a grey), the rest of PALETTE is one click away.
export const DEFAULT_SWATCHES = ['#e5484d', '#f76b15', '#e5a50a', '#30a46c', '#0b7285', '#2a6df4', '#8e4ec6', '#d6409f', '#8c564b', '#7d8499'];

export interface ColorTemplate {
  name: string;
  colors: string[];
  builtin?: boolean;
}

export const BUILTIN_TEMPLATES: ColorTemplate[] = [
  { name: 'Default', colors: PALETTE, builtin: true },
  { name: 'Colour-blind safe', colors: ['#0072b2', '#e69f00', '#009e73', '#d55e00', '#56b4e9', '#cc79a7', '#f0e442', '#000000'], builtin: true },
  { name: 'Pastel', colors: ['#ffb3ba', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff', '#d7baff', '#ffc9ec', '#c9f0e8', '#e0d5c1', '#d0d6e0'], builtin: true },
  { name: 'Vivid', colors: ['#ff0000', '#ff8000', '#ffd400', '#00c800', '#00c8c8', '#0050ff', '#8000ff', '#ff00aa', '#7a4a00', '#000000'], builtin: true },
  { name: 'Grayscale (print-friendly)', colors: ['#000000', '#d9d9d9', '#595959', '#bfbfbf', '#262626', '#a6a6a6', '#7f7f7f', '#f0f0f0'], builtin: true },
];

export const HEX = /^#[0-9a-f]{6}$/;

/** Colour number n of the endless sequence: the palette first, then generated hues. */
export function colorForIndex(index: number): string {
  if (index < PALETTE.length) return PALETTE[index];
  const hue = (index * 47) % 360;
  const channel = (n: number): string => {
    const k = (n + hue / 30) % 12;
    const value = 0.5 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/** Perceptual-ish distance (weighted RGB, "redmean"); 0 for the same colour, ~765 for black against white. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

export const MIN_DISTINCT = 110;

/**
 * A colour for a new group: never one already used, and clearly different from all of them when the plate still has
 * room for that. Chosen at random from the candidates that are clear enough; otherwise the one farthest from the rest.
 */
export function distinctColor(used: string[], random: () => number = Math.random): string {
  const taken = used.map(color => color.toLowerCase()).filter(color => HEX.test(color));
  const candidates: string[] = [];
  for (let i = 0; i < PALETTE.length + 120; i++) candidates.push(colorForIndex(i));
  const scored = [...new Set(candidates)]
    .filter(color => !taken.includes(color))
    .map(color => ({ color, gap: taken.length === 0 ? Infinity : Math.min(...taken.map(other => colorDistance(color, other))) }));
  const clear = scored.filter(entry => entry.gap >= MIN_DISTINCT);
  if (clear.length > 0) return clear[Math.min(clear.length - 1, Math.floor(random() * clear.length))].color;
  return scored.sort((a, b) => b.gap - a.gap)[0].color;
}

/**
 * New colours for groups, in order, from a template: group i gets the template's colour i. When the template has fewer
 * colours than there are groups, or repeats one, the rest take generated colours that are not in use, so two groups
 * never end up with the same colour (a group is its colour, so that would merge them).
 */
export function recolorGroups(groups: Array<{ color: string }>, template: string[]): string[] {
  const result: string[] = [];
  let next = 0;
  groups.forEach((_, i) => {
    const wanted = (template[i] ?? '').toLowerCase();
    if (HEX.test(wanted) && !result.includes(wanted)) {
      result.push(wanted);
      return;
    }
    let candidate = colorForIndex(next++);
    while (result.includes(candidate) || template.includes(candidate)) candidate = colorForIndex(next++);
    result.push(candidate);
  });
  return result;
}

const STORAGE_KEY = 'elabftw-plate-colour-templates';

/** The person's own templates, kept in this browser under their login's origin (no server-side preference place exists for this). */
export function loadUserTemplates(storage?: Pick<Storage, 'getItem'>): ColorTemplate[] {
  try {
    const parsed = JSON.parse((storage ?? localStorage).getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(entry => entry && typeof entry.name === 'string' && Array.isArray(entry.colors))
      .map(entry => ({ name: entry.name.slice(0, 40), colors: entry.colors.filter((c: unknown) => typeof c === 'string' && HEX.test(c)).slice(0, 60) }))
      .filter(entry => entry.name !== '' && entry.colors.length > 0);
  } catch (error) {
    return [];
  }
}

export function saveUserTemplate(name: string, colors: string[], storage?: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  const clean = name.trim().slice(0, 40);
  const valid = colors.map(color => color.toLowerCase()).filter(color => HEX.test(color));
  if (clean === '' || valid.length === 0 || BUILTIN_TEMPLATES.some(template => template.name.toLowerCase() === clean.toLowerCase())) return false;
  try {
    const others = loadUserTemplates(storage).filter(template => template.name.toLowerCase() !== clean.toLowerCase());
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify([...others, { name: clean, colors: valid }]));
    return true;
  } catch (error) {
    return false;
  }
}

export function deleteUserTemplate(name: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(loadUserTemplates(storage).filter(template => template.name !== name)));
  } catch (error) {
    // storage unavailable: nothing to delete
  }
}
