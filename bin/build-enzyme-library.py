#!/usr/bin/env python3
"""Builds web/sequence-viewer/enzymes-library.js (the data part) from the EMBOSS files of REBASE:
curl -o rebase/link_emboss_e.txt http://rebase.neb.com/rebase/link_emboss_e   (patterns and cuts)
curl -o rebase/link_emboss_r.txt http://rebase.neb.com/rebase/link_emboss_r   (suppliers of each enzyme)
curl -o rebase/link_emboss_s.txt http://rebase.neb.com/rebase/link_emboss_s   (names of the suppliers)
python3 -I bin/build-enzyme-library.py rebase out.js
The group code at the end of enzymes-library.js is kept by hand: paste it after the generated line.
Enzymes without a vendor, with an unknown cut, with more than one cut or cutting outside of the site are left out."""
import json, re, sys
d = sys.argv[1]
sup = {}
for line in open(d + '/link_emboss_s.txt'):
    if line.startswith('#') or not line.strip():
        continue
    code, name = line.rstrip('\n').split(None, 1)
    sup[code] = name
short = {'B': 'Thermo Fisher', 'E': 'Agilent', 'I': 'SibEnzyme', 'J': 'Nippon Gene', 'K': 'Takara', 'M': 'Roche', 'N': 'NEB', 'O': 'Toyobo', 'Q': 'CHIMERx', 'R': 'Promega', 'S': 'Sigma', 'V': 'Vivantis', 'X': 'EURx', 'Z': 'Enzynomics'}
# suppliers per enzyme: the entries of emboss_r (name, organism, isoschizomers, methylation, source, suppliers, n refs, refs.., //)
suppliers = {}
lines = [l.rstrip('\n') for l in open(d + '/link_emboss_r.txt') if not l.startswith('#')]
i = 0
while i < len(lines):
    if not lines[i].strip():
        i += 1
        continue
    name = lines[i]
    codes = lines[i + 5].strip() if i + 5 < len(lines) else ''
    suppliers[name] = codes
    j = i
    while j < len(lines) and lines[j] != '//':
        j += 1
    i = j + 1
IUPAC = {'a': 'a', 'c': 'c', 'g': 'g', 't': 't', 'r': '[ag]', 'y': '[ct]', 'w': '[at]', 's': '[cg]', 'k': '[gt]', 'm': '[ac]', 'b': '[cgt]', 'd': '[agt]', 'h': '[act]', 'v': '[acg]', 'n': '[acgt]'}
COMP = {'a': 't', 't': 'a', 'c': 'g', 'g': 'c', 'r': 'y', 'y': 'r', 'w': 'w', 's': 's', 'k': 'm', 'm': 'k', 'b': 'v', 'v': 'b', 'd': 'h', 'h': 'd', 'n': 'n'}
def regex(site):
    return ''.join(IUPAC[c] for c in site)
def revcomp(site):
    return ''.join(COMP[c] for c in reversed(site))
enzymes, groups, skipped = {}, {}, {'no vendor': 0, 'unknown cut': 0, 'two cuts': 0, 'cut outside': 0, 'bad site': 0}
for line in open(d + '/link_emboss_e.txt'):
    if line.startswith('#') or not line.strip():
        continue
    name, pattern, length, ncuts, blunt, c1, c2, c3, c4 = line.split()
    codes = [c for c in suppliers.get(name, '') if c in short]
    if not codes:
        skipped['no vendor'] += 1
        continue
    ncuts, c1, c2 = int(ncuts), int(c1), int(c2)
    if ncuts == 0 or (c1 == 0 and c2 == 0 and blunt != '1') :
        skipped['unknown cut'] += 1
        continue
    if ncuts != 2:
        skipped['two cuts'] += 1
        continue
    site = pattern.lower()
    if not re.fullmatch('[acgtrywskmbdhvn]+', site):
        skipped['bad site'] += 1
        continue
    # the cut positions are counted from the start of the site; a cut before the site (negative) is not drawn by the editor
    if c1 < 0 or c2 < 0:
        skipped['cut outside'] += 1
        continue
    enzymes[name.lower()] = {'name': name, 'site': site, 'forwardRegex': regex(site), 'reverseRegex': regex(revcomp(site)), 'topSnipOffset': c1, 'bottomSnipOffset': c2, 'usForward': 0, 'usReverse': 0, 'vendors': ''.join(codes)}
    for c in codes:
        groups.setdefault(short[c], []).append(name)
for g in groups:
    groups[g].sort(key=str.lower)
out = {'enzymes': enzymes, 'groups': dict(sorted(groups.items())), 'vendorNames': {short[c]: sup[c] for c in short}}
print(len(enzymes), skipped, {g: len(v) for g, v in out['groups'].items()})
open(sys.argv[2], 'w').write("/* Commercial restriction enzymes: site, cut positions and vendors (REBASE, Roberts RJ et al.; http://rebase.neb.com, version 611) */\nwindow.EnzymeLibrary = " + json.dumps(out, separators=(',', ':')) + ";\n")
