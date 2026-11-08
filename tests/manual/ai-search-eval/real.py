# Real-life searches: 30 questions a scientist of the lab might type, each with a rule (a pattern on the entry's own text) that says whether a result is right.
# Compared: the search as it is now (meaning + keyword boost) against the same search with the trained correction on the question side.
import json, re, urllib.request
import numpy as np

D = '/private/tmp/claude-503/-Users-asrivath-Documents-Codex-2026-07-27-i-wa-work/74754926-5e05-4c08-add9-b2c43d87428d/scratchpad/train/'
ids, vecs = [], []
for line in open(D + 'vec.tsv', encoding='utf-8', errors='replace'):
    i, h = line.rstrip('\n').split('\t'); ids.append(int(i)); vecs.append(np.frombuffer(bytes.fromhex(h), dtype='<f4'))
X = np.stack(vecs).astype(np.float64); X /= np.linalg.norm(X, axis=1, keepdims=True)
pos = {i: n for n, i in enumerate(ids)}
title, content, module = [''] * len(ids), [''] * len(ids), [''] * len(ids)
for l in open(D + 'content.tsv', encoding='utf-8', errors='replace'):
    r = l.rstrip('\n').split('\t')
    if len(r) >= 3 and int(r[0]) in pos:
        p = pos[int(r[0])]; title[p] = r[1]; content[p] = r[2].lower(); module[p] = r[2].split(':')[0]
W = np.load(D + 'W_light2.npy').astype(np.float64)

def emb(q):
    r = urllib.request.Request('http://127.0.0.1:11434/api/embed', json.dumps({'model': 'nomic-embed-text', 'input': 'search_query: ' + q}).encode(), {'Content-Type': 'application/json'})
    v = np.array(json.load(urllib.request.urlopen(r, timeout=120))['embeddings'][0], dtype=np.float64); return v / np.linalg.norm(v)

STOP = set('the and for with what which have has does any our that this from can could need want use used would about there some into instead something anything show give find lab we do me is are in of to a an on or i'.split())
def words(q):
    out = []
    for w in re.split(r'[^a-z0-9]+', q.lower()):
        if len(w) >= 3 and w not in STOP:
            out.append(w[:5] if len(w) >= 7 else w)
    return list(dict.fromkeys(out))
low_title = [t.lower() for t in title]
def boost(q):
    ws = words(q)
    if not ws:
        return np.zeros(len(ids))
    tot = sum(3.0 if re.search(r'\d', w) else 1.0 for w in ws)
    bt = np.zeros(len(ids)); bx = np.zeros(len(ids))
    for w in ws:
        wt = 3.0 if re.search(r'\d', w) else 1.0
        bt += np.array([wt if w in t else 0.0 for t in low_title]); bx += np.array([wt if w in c else 0.0 for c, in zip(content)])
    return 0.15 * bt / tot + 0.05 * bx / tot

def has(*pats):
    return lambda p: all(re.search(x, content[p]) for x in pats)
def mod(m, *pats):
    return lambda p: module[p] == m and all(re.search(x, content[p]) for x in pats)

PL, AB, CE = 'Plasmids', 'Antibodies', 'Cells & strains'
tests = [
    ('plasmid with GFP and puromycin resistance for mammalian cells', mod(PL, r'gfp', r'puro')),
    ('lentiviral vector with a tet-inducible promoter', mod(PL, r'(tre3g|tet3g|teton|tet-on|tre-|ptre)', r'(lenti|plvx)')),
    ('AAV that expresses Cre', mod(PL, r'aav', r'cre')),
    ('mouse anti-CD8 antibody', mod(AB, r'cd8')),
    ('CD4 antibody for flow cytometry', mod(AB, r'cd4')),
    ('antibody against Plexin B2', mod(AB, r'plexin')),
    ('sgRNA plasmids targeting p53', mod(PL, r'sgrna', r'p53')),
    ('doxycycline inducible cell line', mod(CE, r'(dox|doxy)', r'induc')),
    ('cells that express dCas9', mod(CE, r'dcas9')),
    ('mCherry reporter plasmid', mod(PL, r'mcherry')),
    ('lentiCRISPR plasmid', mod(PL, r'lenticrispr|lenti crispr')),
    ('anti-GFP antibody', mod(AB, r'gfp')),
    ('CD45 antibody', mod(AB, r'cd45')),
    ('plasmid with Cas9', mod(PL, r'cas9')),
    ('Cre BFP AAV', mod(PL, r'aav', r'cre', r'bfp')),
    ('HEK293T cells', mod(CE, r'hek ?293')),
    ('anti-CD31 antibody', mod(AB, r'cd31')),
    ('rabbit polyclonal antibody', mod(AB, r'rabbit', r'polyclonal')),
    ('kanamycin resistant plasmid', mod(PL, r'resistance: kanamycin')),
    ('pLVX backbone plasmids', mod(PL, r'plvx')),
    ('constitutive GFP expression plasmid', lambda p: module[p] == PL and bool(re.search(r'gfp', content[p])) and bool(re.search(r'(cmv|cag|ef1|pgk|sv40)', content[p])) and not re.search(r'(lsl|stop|cre|3utr)', content[p])),
    ('mScarlet AAV', mod(PL, r'aav', r'mscarlet')),
    ('luciferase reporter', has(r'luc')),
    ('Alexa Fluor 647 antibody', mod(AB, r'(alexa fluor 647|alexa647|af647|alexa 647)')),
    ('lentiviral Cas9 plasmid with puromycin', mod(PL, r'(lenti|plvx)', r'cas9', r'puro')),
    ('mouse cell line with Cre', mod(CE, r'cre')),
    ('anti-mouse CD3 antibody', mod(AB, r'cd3')),
    ('TRE3G promoter plasmid', mod(PL, r'tre3g')),
    ('APEX2 proximity labeling plasmid', mod(PL, r'apex2')),
    ('hygromycin selection plasmid', mod(PL, r'hygro')),
]
def run(vq, q):
    S = X @ vq + boost(q)
    return np.argsort(-S)[:5]
tot = {'meaning only': [0, 0], 'now (meaning + keywords)': [0, 0], 'now + correction': [0, 0]}
rows = []
for q, rule in tests:
    n_ok = sum(1 for p in range(len(ids)) if rule(p))
    v = emb(q); va = v + v @ W; va /= np.linalg.norm(va)
    res = {}
    for name, order in (('meaning only', np.argsort(-(X @ v))[:5]), ('now (meaning + keywords)', run(v, q)), ('now + correction', run(va, q))):
        ok = sum(1 for p in order if rule(p)); res[name] = ok
        tot[name][0] += ok; tot[name][1] += 1 if ok else 0
    rows.append((q, n_ok, res))
    print('%-62s matching entries %4d | top5 right: %d / %d / %d' % (q[:62], n_ok, res['meaning only'], res['now (meaning + keywords)'], res['now + correction']))
print()
for name, (ok, any_) in tot.items():
    print('%-26s precision@5 %.1f%%   questions with at least one right in top 5: %d/30' % (name, 100.0 * ok / (5 * len(tests)), any_))
