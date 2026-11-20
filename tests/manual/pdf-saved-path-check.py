"""pdf-saved-path: an entry saved through the API (the purifier drops <colgroup>) exported with sheets=landscape|fit|split.
A 14-column sheet: landscape -> one landscape page (and the other pages portrait), fit -> only portrait pages, split -> more pages, every column letter A-N in the text;
a 4-column sheet -> portrait only in every mode.

  python3 tests/manual/pdf-saved-path-check.py [base-url]     (macOS: PDF text through tests/manual/pdf-text.swift; creates and deletes a scratch experiment)
"""
import os, re, subprocess, sys, tempfile, urllib.request
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'print-columns-check.py')).read().split('results = []')[0]
exec(src)  # login, api(), a scratch experiment `exp` with a 14-column sheet below filler text
tool = os.path.join(tempfile.gettempdir(), 'pdf-text')
subprocess.run(['swiftc', os.path.join(here, 'pdf-text.swift'), '-o', tool], check=True)
ok = True
def check(name, good, detail=''):
    global ok
    ok = ok and good
    print(('ok   ' if good else 'FAIL ') + name + ('' if good else ' -- ' + detail))
try:
    for mode in ('default', 'landscape', 'fit', 'split'):
        data = opener.open(urllib.request.Request(f'{BASE}/api/v2/experiments/{exp}?format=pdf' + ('' if mode == 'default' else f'&sheets={mode}'), headers={'X-CSRF-Token': token})).read()
        path = os.path.join(tempfile.gettempdir(), f'saved-{mode}.pdf'); open(path, 'wb').write(data)
        text = subprocess.run([tool, path], capture_output=True, text=True).stdout
        sizes = re.findall(r'=== page \d+ (\d+)x(\d+)', text)
        land = [s for s in sizes if int(s[0]) > int(s[1])]
        flat = text.replace('\n', '')
        check(f'{mode}: every column letter A-N is in the PDF text', all(f'r1-{l}-pGEX' in flat for l in letters), 'a column is missing')
        if mode == 'default': check('no sheets= (the default): portrait pages only, like fit - landscape is never the default', not land, str(sizes))
        if mode == 'landscape': check('landscape: exactly one landscape page, the rest portrait', len(land) == 1 and len(sizes) > 1, str(sizes))
        if mode == 'fit': check('fit: portrait pages only', not land, str(sizes))
        if mode == 'split': check('split: portrait only, the sheet in blocks (columns A-.. note)', not land and 'columns A-' in flat, str(sizes))
finally:
    api('DELETE', f'experiments/{exp}')
print('ALL PASSED' if ok else 'FAILED')
sys.exit(0 if ok else 1)
