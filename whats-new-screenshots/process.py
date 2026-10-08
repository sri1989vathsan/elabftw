#!/usr/bin/env python3
"""Turn screenshots dropped in inbox/ into What's new pictures.

For every inbox/<entry-id>.(png|jpg|jpeg|webp) this
  1. blanks out the "mask" boxes from regions.json (names, private text),
  2. crops to "crop" if given,
  3. scales the width down to at most 1600 px (never up),
  4. writes web/assets/images/whats-new/<entry-id>.jpg,
  5. sets that entry's image and outlined "highlight" in src/whats-new.json.

regions.json maps an entry id to (all boxes are x, y, w, h as fractions 0..1 of
the ORIGINAL screenshot, so they do not depend on its pixel size):
  {"crop": [x, y, w, h], "mask": [[x, y, w, h], ...],
   "highlight": [x, y, w, h], "label": "Short text", "alt": "Description"}
highlight is relative to the ORIGINAL image too; it is converted to the cropped one.

Run from the repository root:  python3 whats-new-screenshots/process.py [entry-id ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
INBOX = ROOT / 'inbox'
OUT = REPO / 'web' / 'assets' / 'images' / 'whats-new'
ENTRIES = REPO / 'src' / 'whats-new.json'
MAX_WIDTH = 1600


def find_source(entry_id: str) -> Path | None:
    for ext in ('png', 'jpg', 'jpeg', 'webp'):
        path = INBOX / f'{entry_id}.{ext}'
        if path.exists():
            return path
    return None


def box(frac, size):
    x, y, w, h = frac
    return (round(x * size[0]), round(y * size[1]), round((x + w) * size[0]), round((y + h) * size[1]))


def process(entry: dict, region: dict, source: Path) -> None:
    image = Image.open(source).convert('RGB')
    original = image.size
    draw = ImageDraw.Draw(image)
    for mask in region.get('mask', []):
        left, top, right, bottom = box(mask, original)
        # Fill with the colour just left of the box, so it blends in.
        fill = image.getpixel((max(0, left - 2), min(original[1] - 1, (top + bottom) // 2)))
        draw.rectangle((left, top, right, bottom), fill=fill)
    crop = region.get('crop')
    crop_box = box(crop, original) if crop else (0, 0, *original)
    image = image.crop(crop_box)
    if image.width > MAX_WIDTH:
        image = image.resize((MAX_WIDTH, round(image.height * MAX_WIDTH / image.width)), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    image.save(OUT / f"{entry['id']}.jpg", quality=90, optimize=True)

    entry['image'] = f"{entry['id']}.jpg"
    if 'alt' in region:
        entry['imageAlt'] = region['alt']
    highlight = region.get('highlight')
    if highlight:
        cx, cy, cw, ch = crop_box[0], crop_box[1], crop_box[2] - crop_box[0], crop_box[3] - crop_box[1]
        hx, hy, hw, hh = highlight
        entry['highlight'] = {
            'x': round((hx * original[0] - cx) / cw * 100, 1),
            'y': round((hy * original[1] - cy) / ch * 100, 1),
            'w': round(hw * original[0] / cw * 100, 1),
            'h': round(hh * original[1] / ch * 100, 1),
            'label': region.get('label', ''),
        }
    else:
        entry.pop('highlight', None)


def main() -> int:
    regions = json.loads((ROOT / 'regions.json').read_text()) if (ROOT / 'regions.json').exists() else {}
    entries = json.loads(ENTRIES.read_text())
    wanted = set(sys.argv[1:])
    done = []
    for entry in entries:
        if wanted and entry['id'] not in wanted:
            continue
        source = find_source(entry['id'])
        if source is None:
            continue
        process(entry, regions.get(entry['id'], {}), source)
        done.append(entry['id'])
    ENTRIES.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + '\n')
    print('processed:', ', '.join(done) if done else '(nothing in inbox/)')
    missing = [e['id'] for e in entries if not find_source(e['id'])]
    print('no screenshot yet for:', ', '.join(missing) if missing else '(none)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
