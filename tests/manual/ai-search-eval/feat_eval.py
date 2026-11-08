import sys; sys.path.insert(0, '.')
src = open('real.py').read().split("def run(vq, q):")[0]
exec(src)
from feat_lib import *
L = load_entry_labels()
labs = ['|'.join(L.get(i, [])) for i in ids]
FEAT_SEQ = [canon(labs[p], 'label') if labs[p] else set() for p in range(len(ids))]
FEAT = [FEAT_SEQ[p] if labs[p] else canon(content[p], 'text') for p in range(len(ids))]
MODQ = {'Plasmids': r'plasmid|vector|construct|backbone', 'Antibodies': r'antibod|\bab\b', 'Cells & strains': r'cell line|cells|organoid|strain'}
def intent(q):
    for m, r in MODQ.items():
        if re.search(r, q.lower()): return {m}
    return set()
embs = {}
def E(q):
    if q not in embs: embs[q] = emb(q)
    return embs[q]
def kw(q, wt, wx, stem):
    ws = []
    for w in re.split(r'[^a-z0-9]+', q.lower()):
        if len(w) >= 3 and w not in STOP: ws.append(w[:stem] if (stem and len(w) >= 7) else w)
    ws = list(dict.fromkeys(ws))
    if not ws: return np.zeros(len(ids))
    wts = [3.0 if re.search(r'\d', w) else 1.0 for w in ws]; tot = sum(wts)
    bt = np.zeros(len(ids)); bx = np.zeros(len(ids))
    for w, k in zip(ws, wts):
        bt += k * np.array([w in t for t in low_title]); bx += k * np.array([w in c for c in content])
    return wt * bt / tot + wx * bx / tot
def rank(q, wt, wx, stem, use_feat, must=None, n=5):
    S = X @ E(q) + kw(q, wt, wx, stem)
    req = canon(q, 'query') if use_feat else set()
    if must: S = S + np.array([0 if must <= FEAT[p] else -9 for p in range(len(ids))])
    mi = intent(q) if use_feat else set()
    if mi and len(mi) == 1:
        mm = np.array([1 if module[p] in mi else 0 for p in range(len(ids))])
    else: mm = np.zeros(len(ids), dtype=int)
    if req:
        cov = np.array([len(req & FEAT[p]) for p in range(len(ids))])
        order = np.lexsort((-S, -cov, -mm))
    elif mi: order = np.lexsort((-S, -mm))
    else: order = np.argsort(-S)
    return order[:n], req
CFG = {'A now (.15/.05, stem5)': (.15, .05, 5, False), 'B retuned (.05/.10, no stem)': (.05, .10, 0, False),
       'C B + feature coverage': (.05, .10, 0, True), 'D now + feature coverage': (.15, .05, 5, True)}
if __name__ == '__main__':
    for name, (wt, wx, st, uf) in CFG.items():
        ok = 0; anyc = 0
        for q, rule in tests:
            top, _ = rank(q, wt, wx, st, uf); s = sum(1 for p in top if rule(p)); ok += s; anyc += s > 0
        print('%-32s precision@5 %.1f%%  any-right %d/30' % (name, 100 * ok / 150, anyc))
    print()
    Q = 'I want to clone a plasmid that contains GFP and puromycin and hygromycin, suggest starting plasmids'
    need = {'GFP', 'Puromycin resistance', 'Hygromycin resistance'}
    for name, (wt, wx, st, uf) in CFG.items():
        top, req = rank(Q, wt, wx, st, uf, n=10)
        print(name, '| sequence has of the 3 (top 10):', [len(need & FEAT_SEQ[p]) for p in top])
    top, req = rank(Q, .05, .10, 0, True, n=10)
    for p in top: print('  ', title[p][:50], sorted(need & FEAT_SEQ[p]))
