/**
 * The colour of the cap of a container: a few usual colours to pick, or any colour of the browser's colour picker
 */
export const CAP_COLOURS: { name: string; hex: string }[] = [
  { name: 'Red', hex: '#d93025' },
  { name: 'Orange', hex: '#f57c00' },
  { name: 'Yellow', hex: '#f9c80e' },
  { name: 'Green', hex: '#2e9d4f' },
  { name: 'Blue', hex: '#1677ff' },
  { name: 'Purple', hex: '#7b3fb2' },
  { name: 'Pink', hex: '#ec6fa6' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#222222' },
  { name: 'Clear', hex: '#cfd8dc' },
];

// the usual name of a colour, or the colour itself when it is a custom one
export function capColourName(hex: string | null | undefined): string {
  if (!hex) {
    return '';
  }
  return CAP_COLOURS.find(c => c.hex === hex.toLowerCase())?.name ?? hex;
}

// a small round cap, for a tube line or a card
export function capDot(hex: string | null | undefined): HTMLElement | null {
  if (!hex) {
    return null;
  }
  const dot = document.createElement('span');
  dot.className = 'cap-dot';
  dot.style.backgroundColor = hex;
  dot.title = `Cap: ${capColourName(hex)}`;
  return dot;
}

// the choice of the colour: swatches, a custom colour, and none; read the value with get()
export function capColourPicker(initial: string | null | undefined): { element: HTMLElement; get: () => string } {
  let value = (initial ?? '').toLowerCase();
  const box = document.createElement('div');
  box.className = 'cap-picker d-flex flex-wrap align-items-center mb-2';
  const swatches: HTMLButtonElement[] = [];
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'cap-custom';
  custom.setAttribute('aria-label', 'Another colour');
  custom.value = /^#[0-9a-f]{6}$/.test(value) ? value : '#1677ff';
  const label = document.createElement('span');
  label.className = 'small text-muted ml-2';
  const refresh = (): void => {
    swatches.forEach(s => s.classList.toggle('is-picked', s.dataset.hex === value));
    label.textContent = value === '' ? 'No cap colour' : capColourName(value);
  };
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'cap-swatch cap-none';
  none.title = 'No cap colour';
  none.dataset.hex = '';
  none.textContent = '×';
  swatches.push(none);
  CAP_COLOURS.forEach(c => {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'cap-swatch';
    s.title = c.name;
    s.dataset.hex = c.hex;
    s.style.backgroundColor = c.hex;
    swatches.push(s);
  });
  swatches.forEach(s => s.addEventListener('click', () => {
    value = s.dataset.hex ?? '';
    refresh();
  }));
  custom.addEventListener('input', () => {
    value = custom.value.toLowerCase();
    refresh();
  });
  box.append(...swatches, custom, label);
  refresh();
  return { element: box, get: () => value };
}
