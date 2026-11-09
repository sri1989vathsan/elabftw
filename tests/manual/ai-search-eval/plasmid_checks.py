import sys, re, json, os, collections
sys.path.insert(0, '/private/tmp/claude-503/-Users-asrivath-Documents-Codex-2026-07-27-i-wa-work/74754926-5e05-4c08-add9-b2c43d87428d/scratchpad/train')
from feat_lib import *
# plasmids: id, title, fields
P = {}
for l in open(G + 'plasmids.tsv', errors='replace'):
    i, t, m = l.rstrip('\n').split('\t')
    try: f = json.loads(m).get('extra_fields', {})
    except Exception: f = {}
    P[int(i)] = {'title': t, 'f': {k: str(v.get('value', '')).strip() for k, v in f.items()}}
# sequence files per plasmid: labels, length (LOCUS line)
S = collections.defaultdict(list)
for l in open(G + 'map.tsv'):
    iid, name, long = l.rstrip('\n').split('\t'); iid = int(iid)
    if iid in P and re.search(r'\.(gb|gbk|ape)$', name, re.I) and os.path.exists(G + 'uploads/' + long):
        t = open(G + 'uploads/' + long, errors='replace').read()
        m = re.search(r'^LOCUS\s+\S+\s+(\d+)\s*bp', t, re.M)
        S[iid].append({'name': name, 'len': int(m.group(1)) if m else None, 'labels': parse_gb(t), 'seq': ''.join(re.findall(r'[acgtn]+', t.split('ORIGIN')[-1], re.I)).upper() if 'ORIGIN' in t else ''})
print('plasmids', len(P), 'with sequence file', len(S))

# ---- #13: the name says one thing, the sequence another
NAMEPARTS = [('GFP', r'gfp'), ('mCherry', r'mcherry'), ('mScarlet', r'mscarlet'), ('BFP', r'bfp'), ('Cas9', r'(?<![a-z])cas9'), ('Cre', r'(?<![a-z])cre(?![a-z])'),
             ('Puro', r'puro'), ('Hygro', r'hygro'), ('Blasticidin', r'blast'), ('Luciferase', r'(?<![a-z])luc(?![a-z])'), ('Tet-on/TRE', r'tre3g|tet3g|(?<![a-z])tre(?![a-z])'), ('FLAG', r'flag'), ('V5', r'(?<![a-z])v5(?![a-z])')]
FEATRE = {'GFP': r'gfp', 'mCherry': r'mcherry', 'mScarlet': r'mscarlet', 'BFP': r'bfp', 'Cas9': r'(?<![a-z])(sp|sa)?cas9|dcas9', 'Cre': r'(?<![a-z])(i|n)?cre(?![a-z])', 'Puro': r'puro|(?<![a-z])pac(?![a-z])',
          'Hygro': r'hyg', 'Blasticidin': r'blast|(?<![a-z])bsd', 'Luciferase': r'(?<![a-z])[fnrg]?luc', 'Tet-on/TRE': r'tre|tet3g|rtta|tet-?on', 'FLAG': r'flag', 'V5': r'(?<![a-z0-9])v5(?![a-z0-9])'}
r13 = []
for i, s in S.items():
    labels = ' | '.join(x for f in s for x in f['labels'])
    title = P[i]['title']
    miss = [n for n, r in NAMEPARTS if re.search(r, title, re.I) and not re.search(FEATRE[n], labels, re.I)]
    if miss: r13.append((i, title, miss))
print('\n#13 name names a part the sequence file does not annotate:', len(r13), 'of', len(S))
for i, t, m in r13[:25]: print('  #%d %-48s no %s' % (i, t[:48], ', '.join(m)))
# ---- #16: same name prefix, different length
groups = collections.defaultdict(list)
def prefix(t):
    m = re.match(r"^\W*([A-Za-z]+[- ]?[A-Za-z0-9]*)", t); return (m.group(1) if m else t[:6]).lower()
for i, s in S.items():
    if s[0]['len']: groups[prefix(P[i]['title'])].append((i, s[0]['len']))
print('\n#16 same prefix, lengths differ a lot (prefix: min..max bp, entries):')
rows = []
for k, v in groups.items():
    if len(v) >= 3:
        ls = [x[1] for x in v]; rows.append((max(ls) - min(ls), k, min(ls), max(ls), len(v)))
for d, k, a, b, n in sorted(rows, reverse=True)[:10]: print('  %-14s %5d..%6d bp  (%d entries)' % (k, a, b, n))
# stricter: identical titles with different lengths
byt = collections.defaultdict(list)
for i, s in S.items():
    if s[0]['len']: byt[re.sub(r'\W+', '', P[i]['title'].lower())].append((i, s[0]['len']))
dup = {t: v for t, v in byt.items() if len(v) > 1}
bad = {t: v for t, v in dup.items() if len({x[1] for x in v}) > 1}
print('\n#16 entries with the same title: %d titles; different length: %d' % (len(dup), len(bad)))
for t, v in list(bad.items())[:12]: print('  ', P[v[0][0]]['title'][:40].ljust(40), [(i, l) for i, l in v])

# ---- #13 follow-up: is the part really absent (not just unannotated)? core sequences of the common parts, both strands
def rc(s): return s.translate(str.maketrans('ACGT', 'TGCA'))[::-1]
CORE = {'Puro': 'GACCGAGTACAAGCCCACGGTG', 'Hygro': 'AAAAAGCCTGAACTCACCGCGAC', 'GFP': 'GGTGAGCAAGGGCGAGGAGCTG', 'BFP': 'GTGTCTAAGGGCGAAGAGCTG', 'V5': 'GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG', 'FLAG': 'GACTACAAGGACGACGATGACAAG'}
print('\n#13 follow-up, flagged entries: is the core sequence of the part there anyway?')
real = 0
for i, t, miss in r13:
    seq = S[i][0]['seq']; out = []
    for m in miss:
        if m in CORE:
            found = CORE[m] in seq or rc(CORE[m]) in seq
            out.append('%s:%s' % (m, 'in sequence (just unannotated)' if found else 'NOT FOUND'))
            real += (not found)
        else: out.append(m + ':not checked')
    print('  #%d %-40s %s' % (i, t[:40], '; '.join(out)))
print('not found at all:', real)

# ---- #16 (mix-ups): different names, identical sequence
byseq = collections.defaultdict(list)
for i, s in S.items():
    if len(s[0]['seq']) > 500: byseq[hash(s[0]['seq'])].append(i)
same = [v for v in byseq.values() if len(v) > 1]
diffname = [v for v in same if len({re.sub(r'\W+', '', P[i]['title'].lower()) for i in v}) > 1]
print('\n#16 identical sequence under different names: %d groups' % len(diffname))
for v in diffname[:12]: print('  ', [(i, P[i]['title'][:26]) for i in v[:4]])
# same name, different sequence (more than 2 % length difference) via first 12 chars of name? skip

# ---- #4: origin and bacterial resistance
def ori(labels):
    L = ' | '.join(labels).lower(); out = set()
    if re.search(r'p15a', L): out.add('p15A')
    if re.search(r'psc101', L): out.add('pSC101')
    if re.search(r'r6k', L): out.add('R6K')
    if re.search(r'pmb1|cole1|puc ori|puc origin|pbr322|(^|\| )ori( |\||$)|(^|\| )ori ', L): out.add('pMB1/ColE1 (pUC, pBR322)')
    return out or {'not annotated'}
def bres(labels, fld):
    # the Resistance field of the entry when it is filled (bacterial selection), else the feature names
    L = fld.lower() if fld.strip() else ' | '.join(labels).lower(); out = set()
    for n, r in (('Amp', r'amp|(?<![a-z])bla(?![a-z])|carbenicillin'), ('Kan', r'kan|(?<![a-z])neo'), ('Cm', r'chlor|(?<![a-z])cmr?(?![a-z])|camr|(?<![a-z])cat(?![a-z])'), ('Spec', r'spec|aada'), ('Strep', r'strep'), ('Zeo', r'zeo'), ('Gent', r'gent')):
        if re.search(r, L): out.add(n)
    return out or {'none found'}
combo = collections.Counter(); members = collections.defaultdict(list)
for i, s in S.items():
    o = ori([x for f in s for x in f['labels']]); b = bres([x for f in s for x in f['labels']], P[i]['f'].get('Resistance', ''))
    key = ('/'.join(sorted(o)), '/'.join(sorted(b))); combo[key] += 1; members[key].append(i)
print('\n#4 origin x bacterial resistance (plasmids with a sequence file):')
for (o, b), n in combo.most_common(12): print('  %4d  %-28s %s' % (n, o, b))

# ---- #2: backbones that take an insert: unique cutters in the backbone, and enzymes that also cut inside the insert
ENZ = {'EcoRI': 'GAATTC', 'BamHI': 'GGATCC', 'HindIII': 'AAGCTT', 'XhoI': 'CTCGAG', 'NotI': 'GCGGCCGC', 'XbaI': 'TCTAGA', 'SpeI': 'ACTAGT', 'NheI': 'GCTAGC', 'KpnI': 'GGTACC',
       'SacI': 'GAGCTC', 'SalI': 'GTCGAC', 'PstI': 'CTGCAG', 'NcoI': 'CCATGG', 'NdeI': 'CATATG', 'AgeI': 'ACCGGT', 'MluI': 'ACGCGT', 'BsrGI': 'TGTACA', 'EcoRV': 'GATATC',
       'BglII': 'AGATCT', 'ClaI': 'ATCGAT', 'PacI': 'TTAATTAA', 'AscI': 'GGCGCGCC', 'BsaI': 'GGTCTC', 'BsmBI': 'CGTCTC', 'ApaI': 'GGGCCC', 'SmaI': 'CCCGGG'}
def cuts(seq, site, circular=True):
    s = seq + (seq[:len(site) - 1] if circular else ''); rcs = rc(site); n = 0
    for pat in {site, rcs}:
        n += len(re.findall('(?=%s)' % pat, s))
    return n
def backbone_options(insert, enzymes, candidates):
    """backbones that cut once with each enzyme of the list, and the enzymes of the list that also cut inside the insert"""
    inside = {e for e in enzymes if cuts(insert, ENZ[e], circular=False)}
    out = []
    for i in candidates:
        seq = S[i][0]['seq']
        if all(cuts(seq, ENZ[e]) == 1 for e in enzymes): out.append(i)
    return out, inside
# demo insert: the EGFP coding sequence of plasmid #4864 (feature 'EGFP' 1198..1914)
src = next(i for i in S if 'ATGGTGAGCAAGGGCGAGGAG' in S[i][0]['seq'])
demo = S[src][0]['seq'][S[src][0]['seq'].index('ATGGTGAGCAAGGGCGAGGAG'):][:720]
print('\n#2 demo: insert = EGFP CDS (%d bp) from #%d. Cutters in the insert:' % (len(demo), src), sorted(e for e in ENZ if cuts(demo, ENZ[e], False)))
pl = [i for i in S if S[i][0]['seq']]
for pair in (['BamHI', 'EcoRI'], ['XbaI', 'NotI'], ['AgeI', 'BsrGI'], ['NheI', 'XhoI'], ['KpnI', 'XhoI']):
    ok, inside = backbone_options(demo, pair, pl)
    bad = [e for e in pair if e in inside]
    print('  %-14s unique in %4d backbones;%s' % ('+'.join(pair), len(ok), ' CUTS INSIDE THE INSERT: ' + ', '.join(bad) if bad else ' insert is clean'),
          '| e.g.', ', '.join(P[i]['title'][:22] for i in ok[:3]))
