#!/usr/bin/env python3
"""
Reads the product pages that the antibodies of LabCollector link to, and keeps the title and the description of each page (the clone, the
host and the catalog number are usually in the title). One request a second, each address once, a cache file so a second run only fetches
what is missing. Sites that answer with a bot check (BioLegend) are skipped: nothing is done to get around it.

Usage: python3 -I fetch_titles.py <entries.csv of the converter> <cache.json>
"""
import csv, io, json, os, re, sys, time, zipfile
import requests

HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en'}
SKIP = ('biolegend.com', 'lunaphore.com')

source, cache_path = sys.argv[1], sys.argv[2]
if source.endswith('.zip'):
    rows = list(csv.DictReader(io.StringIO(zipfile.ZipFile(source).read('entries.csv').decode('utf-8-sig'))))
else:
    rows = list(csv.DictReader(open(source, encoding='utf-8-sig')))
urls = []
for row in rows:
    url = row.get('Link', '')
    if url.startswith('http') and not url.lower().endswith('.pdf') and not any(s in url for s in SKIP) and url not in urls:
        urls.append(url)
cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
todo = [u for u in urls if u not in cache or cache[u].get('status') in (0, 429, 500, 502, 503)]
print(len(urls), 'addresses,', len(todo), 'to fetch', flush=True)
for index, url in enumerate(todo, start=1):
    entry = {'status': 0, 'title': '', 'description': ''}
    try:
        response = requests.get(url, headers=HEADERS, timeout=25)
        entry['status'] = response.status_code
        text = response.text
        if response.status_code == 200 and 'Just a moment' not in text[:3000]:
            title = re.search(r'<title[^>]*>(.*?)</title>', text, re.S | re.I)
            description = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', text, re.I) or re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']description', text, re.I)
            entry['title'] = re.sub(r'\s+', ' ', title.group(1)).strip() if title else ''
            entry['description'] = re.sub(r'\s+', ' ', description.group(1)).strip()[:400] if description else ''
            ld = re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.S)
            for block in ld[:6]:
                try:
                    data = json.loads(block)
                except ValueError:
                    continue
                for item in (data if isinstance(data, list) else [data]):
                    if isinstance(item, dict) and item.get('@type') in ('Product', 'IndividualProduct'):
                        entry['sku'] = str(item.get('sku') or item.get('mpn') or '')
                        entry['name'] = str(item.get('name') or '')
                        entry['brand'] = str((item.get('brand') or {}).get('name') if isinstance(item.get('brand'), dict) else item.get('brand') or '')
        else:
            entry['status'] = 403 if 'Just a moment' in text[:3000] else response.status_code
    except Exception as error:
        entry['error'] = type(error).__name__
    cache[url] = entry
    if index % 20 == 0 or index == len(todo):
        json.dump(cache, open(cache_path, 'w'), ensure_ascii=False)
        print(index, 'of', len(todo), flush=True)
    time.sleep(1.0)
json.dump(cache, open(cache_path, 'w'), ensure_ascii=False)
ok = sum(1 for v in cache.values() if v.get('title'))
print('done:', ok, 'pages with a title,', len(cache) - ok, 'without', flush=True)
