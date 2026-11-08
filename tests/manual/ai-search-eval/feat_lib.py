import json, re, os, collections
G = '/private/tmp/claude-503/-Users-asrivath-Documents-Codex-2026-07-27-i-wa-work/74754926-5e05-4c08-add9-b2c43d87428d/scratchpad/gb/'
VOCAB = json.load(open('/Users/asrivath/Documents/Codex/2026-07-27/i-wa/work/inventory/web/ai-features.json'))['features']
def rx(s): return re.compile(s, re.I)
for f in VOCAB:
    f['r_label'] = rx(f.get('label', f.get('re'))); f['r_query'] = rx(f.get('query', f.get('re'))); f['r_text'] = rx(f.get('re', f.get('query')))
SKIP = {'source', 'primer_bind', 'gap'}
def parse_gb(t):
    labels = []; key = None; q = None; cur = {}
    def flush():
        if key and key.lower() not in SKIP:
            v = cur.get('label') or cur.get('gene') or cur.get('product')
            if v: labels.append(v.strip().strip('"').replace('\\', ' ')[:60])
    inside = False
    for line in t.splitlines():
        if line.startswith('FEATURES'): inside = True; continue
        if line.startswith('ORIGIN') or line.startswith('CONTIG'): break
        if not inside: continue
        m = re.match(r'^ {5}(\S+)\s+\S', line)
        if m:
            flush(); key = m.group(1); cur = {}; q = None; continue
        if line.startswith(' ' * 21):
            s = line.strip()
            if s.startswith('/'):
                mm = re.match(r'/(\w+)=?(.*)$', s); q = mm.group(1); cur[q] = cur.get(q) or mm.group(2)
            elif q: cur[q] = cur.get(q, '') + ' ' + s
    flush()
    return labels
def load_entry_labels():
    out = collections.defaultdict(list)
    for l in open(G + 'map.tsv'):
        iid, name, long = l.rstrip('\n').split('\t')
        if not re.search(r'\.(gb|gbk|ape)$', name, re.I): continue
        p = G + 'uploads/' + long
        if os.path.exists(p):
            for x in parse_gb(open(p, errors='replace').read()):
                if x not in out[int(iid)]: out[int(iid)].append(x)
    return out
def canon(hay, kind):
    k = 'r_' + kind
    return {f['name'] for f in VOCAB if f[k].search(hay)}
