"""print-wide-sheet: a 14-column sheet BELOW the fold, printed with Chrome's print-to-PDF without scrolling, in each "Sheets in print and PDF"
mode. Every column header (A-N) and the last column's cells must be in the PDF text (no column cut off), landscape mode must use a landscape page,
fit mode only portrait pages, split mode must repeat the row numbers on every block page.

  python3 tests/manual/print-columns-check.py [base-url]        (default http://localhost:8973; needs `pip install websocket-client`,
                                                                  macOS for the text extraction: swiftc tests/manual/pdf-text.swift)
Login: Alice (TEST-ACCOUNTS.md). Creates one scratch experiment and deletes it. Self-signed https: Chrome runs with --ignore-certificate-errors.
"""
import base64, http.cookiejar, json, os, re, subprocess, sys, tempfile, time, urllib.parse, urllib.request
import websocket

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8973').rstrip('/')
HERE = os.path.dirname(os.path.abspath(__file__))
ctx = __import__('ssl')._create_unverified_context()
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ctx))
html = opener.open(BASE + '/login.php').read().decode()
csrf = re.search(r"name='csrf' value='([^']+)'", html).group(1)
opener.open(urllib.request.Request(BASE + '/app/controllers/LoginController.php', data=urllib.parse.urlencode({'csrf': csrf, 'email': 'alice.tester@example.test', 'password': 'Zz-Test-Pass-4821!', 'auth_type': 'local'}).encode()))
token = re.search(r"name='csrf-token' content='([^']+)'", opener.open(BASE + '/dashboard.php').read().decode()).group(1)

def api(method, path, body=None):
    request = urllib.request.Request(f'{BASE}/api/v2/{path}', method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', 'X-CSRF-Token': token})
    response = opener.open(request)
    return response.status, response.headers

COLS = 14
letters = [chr(65 + i) for i in range(COLS)]
rows = [[f'r{r}-{letters[c]}-pGEX-6P-1' for c in range(COLS)] for r in range(1, 6)]
meta = {'data': rows, 'displayData': rows, 'rows': len(rows), 'cols': COLS, 'kind': 'standard', 'caption': '', 'cellStyles': {}, 'colWidths': {str(i): 150 for i in range(COLS)},
        'tableStyle': f'min-width:25%;width:{42 + COLS * 150}px', 'appearance': {'borderWidth': 1, 'borderColor': '#ced4da', 'cellColor': '#ffffff', 'cellPadding': 8, 'alternateRows': True, 'alternateRowColor': '#f6f7f8', 'alternateColumns': False, 'alternateColumnColor': '#eef6f7', 'tableWidth': 0, 'tableAlignment': 'left', 'tableBorderWidth': 1, 'tableBorderStyle': 'solid', 'tableBorderColor': '#ced4da', 'tableBackgroundColor': '#ffffff', 'tableNoBackground': True, 'tableCellSpacing': 0, 'rowIndexWidth': 42, 'columnIndexHeight': 30}}
blob = base64.b64encode(json.dumps(meta).encode()).decode()
thead = '<tr><th class="spreadsheet-coordinate"></th>' + ''.join(f'<th class="spreadsheet-coordinate">{l}</th>' for l in letters) + '</tr>'
tbody = ''.join('<tr><th class="spreadsheet-coordinate">%d</th>%s</tr>' % (i + 1, ''.join(f'<td>{v}</td>' for v in row)) for i, row in enumerate(rows))
sheet = f'<table class="elabftw-spreadsheet" style="border-collapse:collapse;min-width:25%;width:{42 + COLS * 150}px;" data-spreadsheet="{blob}" data-spreadsheet-style="standard"><thead>{thead}</thead><tbody>{tbody}</tbody></table>'
body = '<h2>Intro</h2>' + ''.join('<p>filler paragraph %d. %s</p>' % (i, 'text ' * 60) for i in range(30)) + '<h2>Wide sheet</h2>' + sheet + '<p>after the sheet</p>'
status, headers = api('POST', 'experiments', {'title': 'print-columns-check scratch'})
exp = int(headers['Location'].rstrip('/').split('/')[-1])
api('PATCH', f'experiments/{exp}', {'body': body})

results = []
def check(name, ok, detail=''):
    results.append(ok); print(('ok   ' if ok else 'FAIL ') + name + ('' if ok else ' -- ' + detail))

port = 9371
chrome = subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', f'--remote-debugging-port={port}', '--ignore-certificate-errors', '--window-size=1400,900', '--user-data-dir=' + tempfile.mkdtemp(prefix='pcc_'), '--no-first-run', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    call('Page.enable'); call('Network.enable')
    host = urllib.parse.urlparse(BASE).hostname
    for c in jar: call('Network.setCookie', {'name': c.name, 'value': c.value, 'domain': host, 'path': '/'})
    call('Emulation.setDeviceMetricsOverride', {'width': 1400, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
    subprocess.run(['swiftc', os.path.join(HERE, 'pdf-text.swift'), '-o', os.path.join(tempfile.gettempdir(), 'pdf-text')], check=True)
    for mode in ('landscape', 'fit', 'split'):
        call('Page.navigate', {'url': f'{BASE}/experiments.php?mode=view&id={exp}'}); time.sleep(4)
        for _ in range(40):  # the text must be on the page before printing
            if ev("(document.getElementById('body_view')||{innerText:''}).innerText.length > 200"): break
            time.sleep(1)
        time.sleep(2)
        ev(f"localStorage.setItem('elabftw-sheets-mode','{mode}'); document.body.dataset.sheetsMode='{mode}'; window.scrollTo(0,0); 1")  # NOT scrolled to the sheet
        call('Emulation.setEmulatedMedia', {'media': 'print'}); time.sleep(1)
        pdf = os.path.join(tempfile.gettempdir(), f'print-columns-{mode}.pdf')
        open(pdf, 'wb').write(base64.b64decode(call('Page.printToPDF', {'printBackground': False, 'preferCSSPageSize': True})['result']['data']))
        call('Emulation.setEmulatedMedia', {'media': ''})
        text = subprocess.run([os.path.join(tempfile.gettempdir(), 'pdf-text'), pdf], capture_output=True, text=True).stdout
        sizes = re.findall(r'=== page \d+ (\d+)x(\d+)', text)
        missing = [l for l in letters if not re.search(rf'(?<![A-Za-z0-9]){l}(?![A-Za-z0-9])', text)]
        check(f'{mode}: all 14 column letters (A-N) are in the printed PDF', not missing, f'missing {missing}')
        check(f'{mode}: the last column\'s cells are printed (no column cut off)', 'r5-N-pGEX' in text.replace('\n', '') or 'r5-N-' in text, 'last column missing')
        landscape = [s for s in sizes if int(s[0]) > int(s[1])]
        if mode == 'landscape': check('landscape: the wide sheet is on a landscape page (Chromium)', len(landscape) >= 1, f'pages {sizes}')
        if mode == 'fit': check('fit: only portrait pages', not landscape, f'pages {sizes}')
        if mode == 'split': check('split: the row numbers repeat on every block (a block page for each column group)', text.count('=== page') >= 3, f'{len(sizes)} pages')
finally:
    chrome.terminate()
    api('DELETE', f'experiments/{exp}')
print('ALL PASSED' if all(results) else 'FAILED')
sys.exit(0 if all(results) else 1)
