#!/usr/bin/env python3
"""
Downloads the sequence of each plasmid that has a Benchling share link: the address of the link with .gb added gives the GenBank record, with no
login. One request a second, a file for each plasmid in the cache folder (named after the Benchling link), so a second run fetches only what is missing.

Usage: python3 -I fetch_sequences.py <plasmids import zip made by convert.py> <cache folder>
"""
import csv, hashlib, io, os, re, sys, time, zipfile
import requests

HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}
source, cache = sys.argv[1], sys.argv[2]
os.makedirs(cache, exist_ok=True)
rows = list(csv.DictReader(io.StringIO(zipfile.ZipFile(source).read('entries.csv').decode('utf-8-sig'))))
def name_of(row):
    # a file for each Benchling link, so a new export reuses what was fetched
    link = re.sub(r'/(edit|view)?/?$', '', row['Benchling entry'].strip())
    return hashlib.sha1(link.encode()).hexdigest()[:16]


todo = [r for r in rows if r.get('Benchling entry', '').startswith('https://benchling.com/s/') and not os.path.exists(os.path.join(cache, name_of(r) + '.gb')) and not os.path.exists(os.path.join(cache, name_of(r) + '.missing'))]
print(len(rows), 'plasmids,', len(todo), 'to fetch', flush=True)
done = failed = 0
for index, row in enumerate(todo, start=1):
    link = re.sub(r'/(edit|view)?/?$', '', row['Benchling entry'].strip())
    target = os.path.join(cache, name_of(row) + '.gb')
    try:
        response = requests.get(link.split('?')[0].rstrip('/') + '.gb', headers=HEADERS, timeout=40)
        if response.status_code == 200 and response.text.lstrip().startswith('LOCUS'):
            open(target, 'w', encoding='utf-8').write(response.text)
            done += 1
        elif response.status_code in (404, 403, 410) or response.status_code == 200:
            open(os.path.join(cache, name_of(row) + '.missing'), 'w').write(str(response.status_code))
            failed += 1
        else:
            failed += 1
    except Exception as error:
        failed += 1
        print('error', row['Key'], type(error).__name__, flush=True)
    if index % 25 == 0 or index == len(todo):
        print(index, 'of', len(todo), '| saved', done, '| failed', failed, flush=True)
    time.sleep(1.0)
print('done:', done, 'sequences saved,', failed, 'not available', flush=True)
