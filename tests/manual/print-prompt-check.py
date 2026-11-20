"""wide-tables prompt: the question asked before Print / PDF when an entry has a table wider than the page.

  python3 tests/manual/print-prompt-check.py [base-url] [screenshot-dir]    (Chrome over DevTools, `pip install websocket-client`)

Checks, on a scratch entry with a 14-column sheet and one with a 4-column sheet (both deleted afterwards):
  - Print in the Contents panel asks: title "Wide tables", "This entry has 1 table wider than the page", three radios, Fit preselected
  - Cancel prints nothing; OK prints once and sets the mode of that print only
  - Remember my choice: the next Print does not ask and the remembered mode is used; "Change wide table setting" brings the question back
  - the PDF button of the panel asks too and opens the PDF with sheets=<choice>
  - the 4-column entry: no question, Print runs at once
  - the API default (no sheets=) is fit: no landscape page; sheets=landscape has one
Writes prompt.png (the question) into the screenshot directory when one is given.
"""
import base64, json, os, re, subprocess, sys, tempfile, time, urllib.parse, urllib.request
import websocket

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'print-columns-check.py')).read().split('results = []')[0]
shots = sys.argv[2] if len(sys.argv) > 2 else None
exec(src)                      # login, api(), scratch entry `exp` with a 14-column sheet below filler text
wide_exp = exp
exec(src.replace('COLS = 14', 'COLS = 4'))   # a second entry with a 4-column sheet
narrow_exp = exp

results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('ok   ' if ok else 'FAIL ') + name + ('' if ok else ' -- ' + detail))

port = 9381
chrome = subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', f'--remote-debugging-port={port}', '--ignore-certificate-errors', '--window-size=1400,900', '--user-data-dir=' + tempfile.mkdtemp(prefix='ppc_'), '--no-first-run', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    pages = []
    for _ in range(40):
        try:
            pages = [t for t in json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json')) if t['type'] == 'page' and not t['url'].startswith('chrome-extension')]
            if pages: break
        except Exception: time.sleep(1)
    ws = websocket.create_connection(pages[0]['webSocketDebuggerUrl'], timeout=90, suppress_origin=True)
    n = [0]
    def call(method, params=None):
        n[0] += 1; ws.send(json.dumps({'id': n[0], 'method': method, 'params': params or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n[0]: return r
    def ev(expr): return call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True}).get('result', {}).get('result', {}).get('value')
    def wait(expr, seconds=15):
        for _ in range(seconds * 4):
            if ev(expr): return True
            time.sleep(0.25)
        return False
    call('Page.enable'); call('Network.enable'); call('Emulation.setFocusEmulationEnabled', {'enabled': True}); call('Page.bringToFront')
    host = urllib.parse.urlparse(BASE).hostname
    for c in jar: call('Network.setCookie', {'name': c.name, 'value': c.value, 'domain': host, 'path': '/'})
    call('Emulation.setDeviceMetricsOverride', {'width': 1400, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})

    def open_entry(entry, clear=False):
        call('Page.navigate', {'url': f'{BASE}/experiments.php?mode=view&id={entry}'})
        time.sleep(3)
        wait("(document.getElementById('body_view')||{innerText:''}).innerText.length > 100 && !!document.getElementById('tocPrintAll')", 30)
        # the Contents panel is set up when it is opened (the buttons are wired then)
        ev("(() => { const p = document.getElementById('tocPanel'); if (p && p.hidden) document.getElementById('tocPanelOpener').click(); })()")
        time.sleep(2)
        if clear: ev("localStorage.removeItem('elabftw-sheets-mode'); localStorage.removeItem('elabftw-sheets-mode-remembered'); 1")
        # window.print is replaced: nothing goes to a printer; window.open is recorded for the PDF button
        ev("window.requestAnimationFrame = cb => window.setTimeout(cb, 16); window.__prints = 0; window.__opened = []; window.print = () => { window.__prints++; const copy = document.querySelector('#tocPrintSelectionDocument .print-sheet-copy'); window.__printMode = !copy ? 'none' : document.querySelector('#tocPrintSelectionDocument .print-split-sheet') ? 'split' : copy.classList.contains('print-wide-sheet') ? 'landscape' : 'fit'; }; window.open = u => { window.__opened.push(String(u)); return null; }; 1")
    modal_shown = "(()=>{const m=document.getElementById('sheetsModeModal'); return !!m && m.classList.contains('show') && getComputedStyle(m).display !== 'none'})()"
    def shown():
        ok = wait(modal_shown, 8); time.sleep(0.8); return ok   # a click during the fade-in is ignored by Bootstrap (a user cannot click that fast)
    modal_gone = "!document.getElementById('sheetsModeModal')"
    click_print = "document.getElementById('tocPrintAll').click(); 1"

    # --- the wide entry
    open_entry(wide_exp, clear=True)
    ev(click_print)
    check('Print in the Contents panel asks about the wide table', wait(modal_shown, 8), 'no #sheetsModeModal')
    info = ev("({title: document.getElementById('sheetsModeTitle').textContent.trim(), text: document.getElementById('sheetsModeText').textContent.trim(), radios: [...document.querySelectorAll('input[name=sheetsModeChoice]')].map(r => r.value + (r.checked ? '*' : '')), labels: [...document.querySelectorAll('#sheetsModeModal .custom-control-label')].map(l => l.textContent.trim()), prints: window.__prints})")
    check('the question is titled "Wide tables" and counts the tables', info and info['title'] == 'Wide tables' and 'This entry has 1 table wider than the page. How should they be printed?' in info['text'], str(info))
    check('three options in the order fit, landscape, split; Fit to page width is preselected', info and info['radios'] == ['fit*', 'landscape', 'split'] and info['labels'][:3] == ['Fit to page width (smaller text)', 'Landscape page for wide tables', 'Actual size, split across pages (first column repeated)'], str(info))
    check('nothing is printed while the question is open', info and info['prints'] == 0, str(info))
    if shots:
        os.makedirs(shots, exist_ok=True)
        time.sleep(0.6)
        open(os.path.join(shots, 'prompt.png'), 'wb').write(base64.b64decode(call('Page.captureScreenshot', {'format': 'png'})['result']['data']))
    ev("document.getElementById('sheetsModeCancel').click(); 1")
    wait(modal_gone, 8)
    time.sleep(1)
    check('Cancel prints nothing and leaves no mode behind', ev("window.__prints === 0 && !document.body.dataset.sheetsMode"), 'printed or mode left')
    ev(click_print); shown()
    ev("document.getElementById('sheetsModeChoice-landscape').click(); document.getElementById('sheetsModeRemember').click(); document.getElementById('sheetsModeOk').click(); 1")
    wait(modal_gone, 15); wait('window.__prints === 1', 20)
    check('OK prints once, and the printed copy has the chosen mode (landscape page for the wide table)', ev("window.__prints === 1 && window.__printMode === 'landscape'"), str(ev('[window.__prints, window.__printMode]')))
    time.sleep(0.5)
    check('after the print the mode of that print is gone (Ctrl+P then uses the remembered mode)', ev("!document.body.dataset.sheetsMode"), 'dataset left')
    check('Remember my choice is stored', ev("localStorage.getItem('elabftw-sheets-mode') === 'landscape' && localStorage.getItem('elabftw-sheets-mode-remembered') === '1'"), 'not stored')
    ev(click_print); wait('window.__prints === 2', 20)
    check('with a remembered choice the next Print does not ask and uses it', ev(f"({modal_gone}) && window.__prints === 2 && window.__printMode === 'landscape'"), str(ev('[window.__prints, window.__printMode]')))
    ev("document.querySelector('[data-action=\"sheets-mode-change\"]').click(); 1")
    check('Change wide table setting brings the question back (Save)', shown() and ev("document.getElementById('sheetsModeOk').textContent.trim() === 'Save' && document.getElementById('sheetsModeChoice-landscape').checked && document.getElementById('sheetsModeRemember').checked"), 'no question or wrong state')
    ev("document.getElementById('sheetsModeRemember').click(); document.getElementById('sheetsModeChoice-fit').click(); document.getElementById('sheetsModeOk').click(); 1")
    wait(modal_gone, 8)
    ev(click_print)
    check('after un-remembering, Print asks again with Fit preselected', shown() and ev("document.getElementById('sheetsModeChoice-fit').checked"), 'no question')
    ev("document.getElementById('sheetsModeCancel').click(); 1"); wait(modal_gone, 8)
    # the PDF button of the panel
    ev("document.getElementById('tocPdfAll').click(); 1")
    check('the PDF button asks too', shown(), 'no question')
    ev("document.getElementById('sheetsModeChoice-split').click(); document.getElementById('sheetsModeOk').click(); 1")
    wait(modal_gone, 15); wait('window.__opened.length === 1', 20)
    check('the PDF opens with sheets=split', ev("window.__opened.length === 1 && /format=pdf/.test(window.__opened[0]) && /sheets=split/.test(window.__opened[0])"), str(ev('window.__opened')))

    # --- the narrow entry: nothing asked
    open_entry(narrow_exp, clear=True)
    ev(click_print); time.sleep(1.5)
    check('an entry without a wide table: no question, Print runs at once', ev(f"({modal_gone}) && window.__prints === 1"), str(ev('window.__prints')))
    ev("document.getElementById('tocPdfAll').click(); 1"); time.sleep(1.5)
    check('an entry without a wide table: the PDF opens at once, with the default fit', ev(f"({modal_gone}) && window.__opened.length === 1 && /sheets=fit/.test(window.__opened[0])"), str(ev('window.__opened')))
finally:
    chrome.terminate()

# --- the API default
tool = os.path.join(tempfile.gettempdir(), 'pdf-text')
subprocess.run(['swiftc', os.path.join(HERE, 'pdf-text.swift'), '-o', tool], check=True)
def sizes(query):
    data = opener.open(urllib.request.Request(f'{BASE}/api/v2/experiments/{wide_exp}?format=pdf{query}', headers={'X-CSRF-Token': token})).read()
    path = os.path.join(tempfile.gettempdir(), 'prompt-check.pdf'); open(path, 'wb').write(data)
    return re.findall(r'=== page \d+ (\d+)x(\d+)', subprocess.run([tool, path], capture_output=True, text=True).stdout)
default, fit, land = sizes(''), sizes('&sheets=fit'), sizes('&sheets=landscape')
check('API default (no sheets=) is fit: portrait pages only, the same pages as sheets=fit', not [s for s in default if int(s[0]) > int(s[1])] and default == fit, f'{default} vs {fit}')
check('sheets=landscape still gives a landscape page', len([s for s in land if int(s[0]) > int(s[1])]) == 1, str(land))
for entry in (wide_exp, narrow_exp):
    api('DELETE', f'experiments/{entry}')
print('ALL PASSED' if all(results) else 'FAILED')
sys.exit(0 if all(results) else 1)
