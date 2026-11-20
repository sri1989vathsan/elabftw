#!/usr/bin/env python3
"""Compares two folders of screenshots made by css-shots.js, file by file, pixel by pixel.
   python3 tests/manual/css-pixel-diff.py FOLDER_A FOLDER_B [DIFF_OUT_FOLDER]
Prints one line per picture (SAME, or the number of differing pixels, the share of the picture and the bounding box of the difference) and
exits 1 when any picture differs or is missing. With a third folder it also writes a red-marked difference picture for each difference."""
import os, sys
from PIL import Image, ImageChops

a, b = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else None
names = sorted(set(os.listdir(a)) | set(os.listdir(b)))
bad = 0
for n in names:
    if not n.endswith('.png'):
        continue
    pa, pb = os.path.join(a, n), os.path.join(b, n)
    if not (os.path.exists(pa) and os.path.exists(pb)):
        print('MISSING', n); bad += 1; continue
    ia, ib = Image.open(pa).convert('RGB'), Image.open(pb).convert('RGB')
    if ia.size != ib.size:
        print('SIZE   ', n, ia.size, ib.size); bad += 1; continue
    diff = ImageChops.difference(ia, ib)
    box = diff.getbbox()
    if box is None:
        print('SAME   ', n); continue
    count = sum(1 for px in diff.convert('L').getdata() if px > 0)
    print('DIFF   ', n, count, 'px', '%.3f%%' % (100 * count / (ia.size[0] * ia.size[1])), 'box', box); bad += 1
    if out:
        os.makedirs(out, exist_ok=True)
        marked = ib.copy(); mask = diff.convert('L').point(lambda v: 255 if v else 0)
        marked.paste((255, 0, 0), mask=mask); marked.save(os.path.join(out, n))
sys.exit(1 if bad else 0)
