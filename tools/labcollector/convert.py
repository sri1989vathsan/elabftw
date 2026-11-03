#!/usr/bin/env python3
"""
Turns the pages saved from LabCollector (a listing exported as an .htm file with a folder of pictures) into the import ZIPs of the Database:
one ZIP per module with entries.csv and the files of the entries. The columns of LabCollector are mapped to the fields of the module; what
can be read from a name, a clone or a link is filled in, and each filled value is noted in a review file so it can be checked.

Usage: python3 -I convert.py <folder of the saved page> <module: antibodies|plasmids|cells|primers|probes|reagents|consumables|samples|other> <output folder> [--cache <folder>] [--as <module of the Database>]
The pages are data, not code: they are only read.
"""
import csv
import glob
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- reading the saved page -------------------------------------------------------------------------------------------------------------


def read_page(folder):
    page = glob.glob(os.path.join(folder, '*.htm'))[0]
    soup = BeautifulSoup(open(page, encoding='utf-8', errors='replace').read(), 'lxml')
    main = soup.find_all('table')[0]
    head = next(tr for tr in main.find_all('tr') if tr.find_parent('table') is main and tr.find('th', recursive=False))
    headers = [th.get_text(' ', strip=True) for th in head.find_all('th', recursive=False)]
    records = []
    for tr in main.find_all('tr'):
        if tr.find_parent('table') is not main or tr is head:
            continue
        cells = tr.find_all('td', recursive=False)
        if len(cells) < 5:
            continue
        record = {}
        for name, cell in zip(headers, cells):
            record[name] = {
                'text': cell.get_text('\n', strip=True),
                'links': [a.get('href') for a in cell.find_all('a') if a.get('href')],
                'imgs': [i.get('src') for i in cell.find_all('img') if i.get('src')],
                'tables': [[[c.get_text(' ', strip=True) for c in row.find_all(['th', 'td'])] for row in t.find_all('tr')] for t in cell.find_all('table')],
            }
        records.append(record)
    return records


def text(record, name):
    return record.get(name, {}).get('text', '').strip()


# ---- who owns it ------------------------------------------------------------------------------------------------------------------------


def owner_of(record):
    raw = text(record, 'Owner').replace('\n', ' ')
    mail = re.search(r'Email:\s*([^\s|]+@[^\s|]+)', raw)
    name = re.split(r'\s*->|\s{2,}', raw)[0].strip()
    # "Jay Chiang (Yung-Cheng Jay Chiang) yung-cheng.chiang@bsse.ethz.ch": the address can follow the name
    loose = re.search(r'([\w.+-]+@[\w.-]+\.\w+)', raw)
    email = mail.group(1) if mail else (loose.group(1) if loose else '')
    return name, email.strip().rstrip(',;')


# ---- the common extras: what must not be lost --------------------------------------------------------------------------------------------


def storage_text(record):
    parts = []
    for column in ('Storage', 'Secondary Storage'):
        value = text(record, column).replace('\n', ' ')
        if value:
            parts.append(re.sub(r'\s*\|\s*Type: \w+', '', re.sub(r'\s+', ' ', value)))
    extras = []
    if text(record, 'Number Of Vials') not in ('', '0'):
        extras.append('vials: ' + text(record, 'Number Of Vials'))
    if text(record, 'Total Volume'):
        extras.append('volume: ' + text(record, 'Total Volume'))
    if text(record, 'Storage Comments'):
        extras.append('comment: ' + text(record, 'Storage Comments').replace('\n', ' '))
    return ' || '.join(parts + ([' ; '.join(extras)] if extras else []))


def common(record, row, notes):
    name, email = owner_of(record)
    row['Owner'] = name
    row['Owner e-mail'] = email
    row['LabCollector ID'] = text(record, 'ID')
    row['LabCollector owner'] = (name + (' <' + email + '>' if email else '')).strip()
    row['LabCollector created'] = text(record, 'Creation Date')[:10]
    if text(record, 'Last Update'):
        row['LabCollector updated'] = text(record, 'Last Update')[:10]
    if text(record, 'Record Status') not in ('', 'Active'):
        row['LabCollector status'] = text(record, 'Record Status')
    stored = storage_text(record)
    if stored:
        row['Storage (LabCollector)'] = stored


# ---- antibodies ------------------------------------------------------------------------------------------------------------------------

SUPPLIERS = {
    'biolegend.com': 'BioLegend', 'thermofisher.com': 'Thermo Fisher Scientific', 'abcam.com': 'Abcam', 'cellsignal.com': 'Cell Signaling Technology',
    'bdbiosciences.com': 'BD Biosciences', 'licor.com': 'LI-COR', 'lunaphore.com': 'Lunaphore', 'rndsystems.com': 'R&D Systems',
    'scbt.com': 'Santa Cruz Biotechnology', 'ptglab.com': 'Proteintech', 'proteintech.com': 'Proteintech', 'bio-techne.com': 'Bio-Techne',
    'sigmaaldrich.com': 'Sigma-Aldrich', 'jacksonimmuno.com': 'Jackson ImmunoResearch', 'novusbio.com': 'Novus Biologicals',
    'miltenyibiotec.com': 'Miltenyi Biotec', 'bio-rad.com': 'Bio-Rad', 'invitrogen.com': 'Thermo Fisher Scientific', 'biorbyt.com': 'Biorbyt',
    'lsbio.com': 'LSBio', 'genetex.com': 'GeneTex', 'merckmillipore.com': 'Merck Millipore', 'emdmillipore.com': 'Merck Millipore',
    'stemcell.com': 'STEMCELL Technologies', 'tonbobio.com': 'Tonbo Biosciences', 'rockland-inc.com': 'Rockland', 'dianova.com': 'Dianova',
}
HOSTS = {'mouse': 'Mouse', 'rabbit': 'Rabbit', 'goat': 'Goat', 'rat': 'Rat', 'donkey': 'Donkey', 'human': 'Other', 'guinea pig': 'Other', 'sheep': 'Other',
         'chicken': 'Other', 'hamster': 'Other', 'camelid': 'Other'}
SPECIES = r'(mouse|rabbit|goat|rat|donkey|human|guinea pig|sheep|chicken|hamster|rhesus|bovine|pig|dog|cat|horse|armenian hamster|syrian hamster)'
DYES = [
    (r'Alexa\s*Fluor\s*(?:®\s*)?(\d{3})', lambda m: 'Alexa Fluor ' + m.group(1)), (r'\biFluor\s*(\d{3})', lambda m: 'iFluor ' + m.group(1)),
    (r'Brilliant Violet\s*™?\s*(\d{3})', lambda m: 'Brilliant Violet ' + m.group(1)), (r'\bBV\s*(\d{3})\b', lambda m: 'Brilliant Violet ' + m.group(1)),
    (r'PE/Cyanine\s*(\d)', lambda m: 'PE/Cyanine' + m.group(1)), (r'PE[- ]?Cy\s*(\d)', lambda m: 'PE/Cyanine' + m.group(1)),
    (r'APC/Cyanine\s*(\d)', lambda m: 'APC/Cyanine' + m.group(1)), (r'APC[- ]?Cy\s*(\d)', lambda m: 'APC/Cyanine' + m.group(1)),
    (r'PerCP[/-]?Cy\s*5\.5', lambda m: 'PerCP/Cyanine5.5'), (r'\bPerCP\b', lambda m: 'PerCP'), (r'\bPE[- ]?Dazzle\s*594|PE-C594', lambda m: 'PE/Dazzle 594'),
    (r'\bFITC\b', lambda m: 'FITC'), (r'\bAPC\b', lambda m: 'APC'), (r'\bPE\b', lambda m: 'PE'), (r'Pacific Blue', lambda m: 'Pacific Blue'),
    (r'Pacific Orange', lambda m: 'Pacific Orange'), (r'\bCy\s*([357])\b', lambda m: 'Cy' + m.group(1)), (r'\bHRP\b|horseradish', lambda m: 'HRP'),
    (r'\bbiotin(?:ylated)?\b', lambda m: 'Biotin'), (r'\bPacBlue\b', lambda m: 'Pacific Blue'), (r'IRDye\s*®?\s*(\d{3}\w*)', lambda m: 'IRDye ' + m.group(1)),
    (r'\bTexas Red\b', lambda m: 'Texas Red'), (r'\bDyLight\s*(\d{3})', lambda m: 'DyLight ' + m.group(1)), (r'\bAF\s*(\d{3})\b', lambda m: 'Alexa Fluor ' + m.group(1)),
]
STRIP = [r'\bpurified\b', r'\bantibody\b', r'\bantibodies\b', r'\bmonoclonal\b', r'\bpolyclonal\b', r'\brecombinant\b', r'\bcross[- ]adsorbed\b',
         r'\bhighly\b', r'\bsecondary\b', r'\bprimary\b', r'\bmab\b', r'\bpab\b', r'\bab\b', r'\bconjugate[d]?\b', r',\s*mAb', r'\(H\+L\)', r'#\s*\d+',
         r'\bTotalSeq-\w+\b', r'\bMonoRab\b']


def domain_of(url):
    match = re.match(r'https?://(?:www\.)?([^/]+)', url or '')
    return match.group(1).lower() if match else ''


def supplier_of(url):
    domain = domain_of(url)
    for key, value in SUPPLIERS.items():
        if domain.endswith(key):
            return value
    return ''


def catalog_from(url, name, code):
    if code:
        return code, 'code of the record'
    hit = re.search(r'#\s*(\d{3,6})\b', name)
    if hit and 'cellsignal' in (url or ''):
        return hit.group(1), 'number in the name'
    hit = re.search(r'\b(ab\d{4,7})\b', (url or '') + ' ' + name, re.I)
    if hit:
        return hit.group(1), 'link / name'
    hit = re.search(r'\b(sc-\d{3,6})\b', (url or '') + ' ' + name, re.I)
    if hit:
        return hit.group(1), 'link / name'
    if 'thermofisher.com' in (url or ''):
        tail = url.rstrip('/').split('/')[-1]
        if re.match(r'^[A-Za-z0-9][A-Za-z0-9\-_.]{3,}$', tail) and re.search(r'\d', tail) and not tail.lower().startswith(('antibody', 'product')):
            return tail, 'link'
    if 'cellsignal.com' in (url or ''):
        tail = url.rstrip('/').split('/')[-1]
        if re.match(r'^\d{3,6}$', tail):
            return tail, 'link'
    return '', ''


def convert_antibody(record, row, notes):
    # the trademark signs of the pages come out as strange characters: they are not part of the name
    name = re.sub(r'[\u2122\u00ae\u0099\u0092]', '', text(record, 'Name'))
    name = re.sub(r'\s{2,}', ' ', name).strip()
    url = text(record, 'Manufacturer website')
    if not url.startswith('http'):
        url = next((link for link in record['Description']['links'] if link.startswith('http')), '')
        if not url:
            url = next((link for link in record['Manufacturer website']['links'] if link.startswith('http')), '')
        # a link written as plain text in the description
        if not url:
            found = re.search(r'https?://[^\s<>"]+', text(record, 'Description') + ' ' + text(record, 'Specificity') + ' ' + text(record, 'Storage Comments'))
            if found:
                url = found.group(0).rstrip('.,;)')
                notes.append('Link found in the description')
    row['Title'] = name
    if url:
        row['Link'] = url
    supplier = supplier_of(url)
    if supplier:
        row['Supplier'] = supplier
        notes.append('Supplier from the link')
    catalog, source = catalog_from(url, name, text(record, 'Optional Unique Code'))
    if catalog:
        row['Catalog number'] = catalog
        notes.append('Catalog number from ' + source)
    if text(record, 'Lot#'):
        row['Lot number'] = text(record, 'Lot#')
    lowered = name.lower()

    # reactivity: the column, else the species an "anti-<species>" name recognises
    reactivity = ', '.join(p.strip() for p in re.split(r'[,;]', text(record, 'Reactivity Species')) if p.strip())
    anti = re.search(r'\banti[- ]*' + SPECIES + r'\b', name, re.I)
    if not reactivity and anti:
        reactivity = anti.group(1).capitalize()
        notes.append('Reactivity from the name')
    if reactivity:
        row['Reactivity species'] = reactivity

    # host: the column, else the species that comes before "anti" ("Goat anti-Mouse"), or "Mouse Anti-E-Cadherin", or a name that starts with it
    host = text(record, 'From Host').strip().lower()
    if not host:
        lead = re.search(SPECIES + r'[ -]+anti\b', name, re.I) or re.match(r'\s*' + SPECIES + r'[- ]', name, re.I)
        if lead:
            host = lead.group(1).lower()
            notes.append('Host from the name')
    if host:
        row['Host species'] = HOSTS.get(host, 'Other')

    # primary or secondary
    secondary = 'secondary' in lowered or bool(re.search(SPECIES + r'[ -]+anti[- ]*' + SPECIES + r'\s+(IgG|IgM|IgA|IgE)', name, re.I)) or 'streptavidin' in lowered
    row['Antibody type'] = 'Secondary' if secondary else 'Primary'

    # monoclonal or polyclonal
    kind = text(record, 'Type')
    clonality = 'Monoclonal' if kind.startswith('Monoclonal') else ('Polyclonal' if kind == 'Polyclonal' else '')
    if not clonality:
        if re.search(r'monoclonal|\bmab\b|recombinant rabbit', lowered):
            clonality = 'Monoclonal'
        elif re.search(r'polyclonal|\bpab\b', lowered):
            clonality = 'Polyclonal'
        if clonality:
            notes.append('Clonality from the name')
    if clonality:
        row['Clonality'] = clonality
    if text(record, 'Isotype'):
        row['Isotype'] = text(record, 'Isotype')

    # the dye (a TotalSeq antibody carries a DNA barcode)
    dye = text(record, 'Marker')
    barcode = re.search(r'TotalSeq-?\s*([A-Z]?\d{3,4})', name)
    if barcode and not dye:
        dye = 'TotalSeq-' + barcode.group(1)
        notes.append('Conjugate from the name')
    if not dye:
        for pattern, build in DYES:
            hit = re.search(pattern, name, re.I)
            if hit:
                dye = build(hit)
                notes.append('Conjugate from the name')
                break
    if dye:
        row['Conjugate'] = dye
    row['Conjugated'] = 'Yes' if dye else 'No'

    # the clone: a word "clone", a table of the page of the maker, or a code in brackets in the name
    clone = ''
    hit = re.search(r'clone[\s:#-]*([A-Za-z0-9][A-Za-z0-9\-./]{1,14})', name, re.I) or re.search(r'clone[-_]([A-Za-z0-9\-]{2,14})', url or '', re.I)
    if hit:
        clone = hit.group(1)
        notes.append('Clone from the name or link')
    if not clone:
        for table in record['Description']['tables']:
            for line in table:
                if line and re.match(r'^clone$', line[0], re.I) and len(line) > 1:
                    clone = line[1]
                    notes.append('Clone from the table of the description')
        for table in record['Description']['tables']:
            if table and table[0] and 'Clone' in table[0]:
                position = table[0].index('Clone')
                if len(table) > 1 and len(table[1]) > position:
                    clone = table[1][position]
                    notes.append('Clone from the table of the description')
    if not clone:
        hit = re.search(r'\(([A-Za-z]{0,3}\d[A-Za-z0-9\-./]{1,10}|[A-Za-z]{1,3}-\d{1,3})\)', name)
        candidate = hit.group(1) if hit else ''
        # a catalog code (ab12345, sc-1234, a number) or a known tag is not a clone
        if candidate and candidate.upper() not in ('H+L',) and not re.match(r'^(ab\d{3,7}|sc-?\d{3,6}|\d{3,7}|[A-Z]{1,2}\d{4,7}|igg\w*|p\d+)$', candidate, re.I):
            clone = candidate
            notes.append('Clone guessed from the brackets in the name: check it')
    if clone:
        row['Clone'] = clone

    # the target: the column, else what is left of the name
    target = text(record, 'Specificity')
    if not target or len(target) > 50 or re.search(r'reacts with|verified|detects', target, re.I):
        stripped = name
        stripped = re.sub(r'\([^)]*\)|\[[^\]]*\]', ' ', stripped)
        for pattern, build in DYES:
            stripped = re.sub(pattern, ' ', stripped, flags=re.I)
        for pattern in STRIP:
            stripped = re.sub(pattern, ' ', stripped, flags=re.I)
        stripped = re.sub(r'\b' + SPECIES + r'\b[ -]*(?=anti)', ' ', stripped, flags=re.I)
        stripped = re.sub(r'\banti[- ]*(?:' + SPECIES[1:-1] + r')?[ -]*', ' ', stripped, flags=re.I) if not secondary else stripped
        if secondary:
            hit = re.search(r'anti[- ]*([A-Za-z ]+?\s*Ig[GMAE])', name, re.I)
            stripped = hit.group(1) if hit else stripped
        stripped = re.sub(r'[,;:]+', ' ', stripped)
        stripped = re.sub(r'\s+', ' ', stripped).strip(' -/')
        target = stripped[:60]
        if target:
            notes.append('Target from the name')
    if target:
        row['Target'] = target
    if text(record, 'Applications'):
        row['Applications'] = ', '.join(p.strip() for p in re.split(r'[,;]', text(record, 'Applications')) if p.strip())
    if text(record, 'Concentration'):
        row['Concentration'] = text(record, 'Concentration')
    description = re.sub(r'\s+', ' ', ' '.join(text(record, 'Description').split('\n')))
    description = re.sub(r'https?://\S+', '', description).strip()
    if description:
        row['Description (LabCollector)'] = description[:1000]
    if text(record, 'Purity'):
        row['Purity'] = text(record, 'Purity')
    if not url:
        notes.append('NEEDS LOOKUP: no link')
    if 'Clone' not in row and clonality == 'Monoclonal':
        notes.append('NEEDS LOOKUP: clone')


# ---- plasmids --------------------------------------------------------------------------------------------------------------------------


def convert_plasmid(record, row, notes, files):
    row['Title'] = text(record, 'Name')
    benchling = text(record, 'Benchling entry') or next((l for l in record['Benchling entry']['links'] if 'benchling' in l), '')
    if benchling:
        row['Benchling entry'] = benchling
    refs = text(record, 'References & Comments')
    features = text(record, 'Features')
    blob = refs + '\n' + features
    addgene = re.search(r'addgene\.org/(\d+)', blob + ' ' + ' '.join(record['References & Comments']['links']), re.I) or re.search(r'addgene\s*#?\s*(\d{3,7})', blob, re.I)
    if addgene:
        row['Link'] = 'https://www.addgene.org/' + addgene.group(1) + '/'
        notes.append('Link from the Addgene number')
    elif record['References & Comments']['links']:
        row['Link'] = record['References & Comments']['links'][0]
    resistance = re.search(r'Bacterial Resistance\(s\):\s*([^\n]+)', blob)
    if resistance:
        value = resistance.group(1).lower()
        for key, option in (('ampicillin', 'Ampicillin'), ('kanamycin', 'Kanamycin'), ('chloramphenicol', 'Chloramphenicol'), ('spectinomycin', 'Spectinomycin')):
            if key in value:
                row['Resistance'] = option
                notes.append('Resistance from the comments')
                break
        else:
            row['Resistance'] = 'Other'
    for column, label in (('Alternate Reference', 'Alternate reference'), ('Optional Unique Code', 'Optional code (LabCollector)'), ('Associated Strain', 'Associated strain')):
        if text(record, column):
            row[label] = text(record, column)
    comment = re.sub(r'\s+', ' ', (refs + ' ' + features).replace('\n', ' ')).strip()
    if comment:
        row['Comments (LabCollector)'] = comment[:1500]
    # the sequence, when the page has it (a GenBank record in the sequence column)
    genbank = text(record, "Sequence (5')")
    if genbank.startswith('LOCUS'):
        files.append((re.sub(r'[^A-Za-z0-9_.-]+', '_', row['Title']) + '.gb', genbank.encode('utf-8')))
        notes.append('Sequence file made from the sequence of the page')
    elif not benchling:
        notes.append('NEEDS LOOKUP: no sequence and no Benchling link')


# ---- strains and cells -----------------------------------------------------------------------------------------------------------------


def convert_cell(record, row, notes, files):
    name = text(record, 'Name')
    row['Title'] = name
    organism = text(record, 'Organism')
    if organism:
        row['Species / organism'] = organism
    lowered = (name + ' ' + text(record, 'Comments')).lower()
    if re.search(r'e\.\s*coli|bacteri|strain', organism.lower() + ' ' + lowered) and 'e. coli' in organism.lower():
        row['Kind'] = 'Bacterial strain'
        notes.append('Kind from the organism')
    elif 'yeast' in lowered or 'saccharomyces' in organism.lower():
        row['Kind'] = 'Yeast strain'
    elif 'organoid' in lowered or 'primary' in lowered:
        row['Kind'] = 'Primary cells' if 'primary' in lowered and 'organoid' not in lowered else 'Other'
        notes.append('Kind from the name')
    elif organism:
        row['Kind'] = 'Cell line'
        notes.append('Kind guessed: cell line')
    comments = text(record, 'Comments')
    genotype = next((l for l in comments.split('\n') if re.search(r'flox|\+/[-+]|-/-|Cre|CreER|KO|knock|Ki\b|transgen', l)), '')
    if genotype and len(genotype) < 160:
        row['Genotype / tissue'] = genotype
        notes.append('Genotype from the comments')
    source = text(record, 'Optional Reference')
    hit = re.search(r'(obtained from|from|gift of|received from)\s+([^.\n]{3,60})', comments, re.I)
    if source:
        row['Source'] = source
    elif hit:
        row['Source'] = hit.group(0)[:100]
        notes.append('Source from the comments')
    if text(record, 'Freezing date'):
        row['Freezing date'] = text(record, 'Freezing date')
    if text(record, 'Optional Unique Code'):
        row['Optional code (LabCollector)'] = text(record, 'Optional Unique Code')
    if comments:
        row['Notes (LabCollector)'] = re.sub(r'[ \t]+', ' ', comments)[:2000]


# ---- any other module: columns are matched to the fields of the module of the Database by name --------------------------------------------------

# what a column of LabCollector may be called, for a field of the Database (both sides are written without capitals and punctuation)
SYNONYMS = {
    'manufacturer': 'supplier', 'vendor': 'supplier', 'company': 'supplier', 'supplier': 'supplier', 'source': 'supplier',
    'catalog': 'catalog number', 'catalogue': 'catalog number', 'cat': 'catalog number', 'catno': 'catalog number', 'reference': 'catalog number',
    'catalognumber': 'catalog number', 'lot': 'lot number', 'lotno': 'lot number', 'lotnumber': 'lot number',
    'expiration': 'expiry date', 'expirationdate': 'expiry date', 'expiry': 'expiry date', 'expirydate': 'expiry date', 'expdate': 'expiry date',
    'cas': 'cas number', 'casnumber': 'cas number', 'hazard': 'hazards', 'hazards': 'hazards', 'safety': 'hazards',
    'direction': 'orientation', 'strand': 'orientation', 'orientation': 'orientation', 'gene': 'target gene', 'targetgene': 'target gene',
    'seq': 'sequence', 'sequence': 'sequence', 'sequence5': 'sequence', 'oligosequence': 'sequence', 'tm': 'tm', 'meltingtemperature': 'tm',
    'conc': 'concentration', 'concentration': 'concentration', 'buffer': 'buffer', 'project': 'project', 'dye': 'label', 'label': 'label', 'fluorophore': 'label',
    'type': 'type', 'category': 'type', 'sampletype': 'sample type', 'organism': 'source organism', 'species': 'source organism',
}
# the columns that are the same in every LabCollector module: they are kept by the common part, not as fields
COMMON_COLUMNS = {'barcode', 'id', 'owner', 'creationdate', 'lastupdate', 'recordstatus', 'storage', 'secondarystorage', 'storagecomments', 'numberofvials',
                  'numberofstraws', 'totalvolume', 'thawcounts', 'projectcode', 'label', 'mapimage'}


def squash(text):
    return re.sub(r'[^a-z0-9]+', '', (text or '').lower())


def default_modules():
    path = os.path.join(HERE, '..', '..', 'web', 'default-modules.json')
    try:
        return {m['title']: list(m['fields']['extra_fields'].keys()) for m in json.load(open(path, encoding='utf-8'))['modules']}
    except (OSError, ValueError, KeyError):
        return {}


def best_field(header, fields):
    """The field of the module that this column is: the same name, a name that starts the same, or what it is called in LabCollector."""
    key = squash(header)
    wanted = squash(SYNONYMS.get(key, key))
    squashed = {f: squash(f) for f in fields}
    for field, flat in squashed.items():
        if flat == wanted or flat == key:
            return field
    for field, flat in squashed.items():
        if wanted and (flat.startswith(wanted) or (len(wanted) > 3 and wanted in flat)):
            return field
    return ''


def convert_generic(record, row, notes, fields, title_column):
    row['Title'] = text(record, title_column)
    used = set()
    for header, cell in record.items():
        flat = squash(header)
        if header == title_column or flat in COMMON_COLUMNS - {'label', 'projectcode'}:
            continue
        value = cell['text'].replace('\n', ' ').strip()
        link = next((l for l in cell['links'] if l.startswith('http')), '')
        if not value and not link:
            continue
        if flat in ('website', 'url', 'link', 'manufacturerwebsite', 'webpage'):
            if 'Link' in fields or True:
                row['Link'] = link or value
                continue
        field = best_field(header, fields)
        if field and field not in used:
            row[field] = value
            used.add(field)
            notes.append(header + ' -> ' + field)
        else:
            row[header + ' (LabCollector)'] = value


MODULE_OF_TABLE = (
    ('antibod', 'antibodies', 'Antibodies'), ('plasmid', 'plasmids', 'Plasmids'), ('strain', 'cells', 'Cells & strains'), ('cell', 'cells', 'Cells & strains'),
    ('oligo', 'primers', 'Primers'), ('primer', 'primers', 'Primers'), ('rnascope', 'probes', 'Probes'), ('probe', 'probes', 'Probes'),
    ('reagent', 'reagents', 'Reagents'), ('consumable', 'consumables', 'Consumables'), ('suppl', 'reagents', 'Reagents'), ('sample', 'samples', 'Samples'),
)


def module_from_header(page_text):
    """The page says which table it lists: (table: strains). Returns the kind of conversion and the module of the Database it goes to."""
    hit = re.search(r'\(table:\s*([^)]+)\)', page_text)
    name = (hit.group(1) if hit else page_text[:400]).lower()
    for needle, kind, title in MODULE_OF_TABLE:
        if needle in name:
            return kind, title
    return 'generic', ''


# ---- the files of the pictures of a row --------------------------------------------------------------------------------------------------


def pictures(record, folder, files):
    root = glob.glob(os.path.join(folder, '*_files'))
    for column in record.values():
        for source in column['imgs']:
            base = os.path.basename(source.split('?')[0])
            if not base or source.startswith('http'):
                continue
            for directory in root:
                path = os.path.join(directory, base)
                if os.path.isfile(path):
                    files.append((base, open(path, 'rb').read()))
                    break


# ---- what was found elsewhere (pages of the makers, web searches, sequences): only fills what is empty -------------------------------------------


def load_json(path):
    try:
        return json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        return None


def from_page_title(url, page, row, notes):
    """The title of a product page of the maker carries the clone, the host and the catalog number."""
    title = (page or {}).get('title', '')
    if not title:
        return
    filled = []
    domain = domain_of(url)
    clone = host = catalog = ''
    if 'thermofisher.com' in domain:
        hit = re.search(r'Antibody[^()|]*\(([^()]{2,24})\)\s*\|', title)
        clone = hit.group(1) if hit else ''
        tail = re.search(r'\(([A-Za-z0-9][A-Za-z0-9\-_.]{2,20})\)\s*$', title)
        catalog = tail.group(1) if tail else ''
    elif 'cellsignal.com' in domain:
        hit = re.search(r'\(([A-Za-z0-9\-]{2,14})\)\s*(?:\|.*)?$', title)
        clone = hit.group(1) if hit else ''
        who = re.search(r'\b(Rabbit|Mouse|Rat|Goat|Donkey)\b[^()]*(?:mAb|Antibody|antibody)', title)
        host = who.group(1) if who else ''
        tail = url.rstrip('/').split('/')[-1]
        catalog = tail if re.match(r'^\d{3,6}$', tail) else ''
    elif 'abcam.com' in domain:
        hit = re.search(r'\[([^\]]{2,24})\]', title)
        clone = hit.group(1) if hit else ''
        cat = re.search(r'\b(ab\d{4,7})\b', title + ' ' + url)
        catalog = cat.group(1) if cat else ''
    if clone and not row.get('Clone'):
        row['Clone'] = clone
        filled.append('Clone')
    if host and not row.get('Host species'):
        row['Host species'] = HOSTS.get(host.lower(), 'Other')
        filled.append('Host species')
    if catalog and not row.get('Catalog number'):
        row['Catalog number'] = catalog
        filled.append('Catalog number')
    if filled:
        notes.append(', '.join(filled) + ' from the product page')


def from_web(found, row, notes):
    """A result of a web search: fills the empty fields and says so; a choice between clones is marked."""
    filled = []
    for key, field in (('supplier', 'Supplier'), ('link', 'Link'), ('catalog', 'Catalog number'), ('clone', 'Clone'), ('isotype', 'Isotype'), ('target', 'Target')):
        value = (found.get(key) or '').strip()
        if value and not row.get(field):
            row[field] = value
            filled.append(field)
    host = (found.get('host') or '').strip()
    if host and not row.get('Host species'):
        row['Host species'] = HOSTS.get(host.lower(), 'Other')
        filled.append('Host species')
    if filled:
        text = ', '.join(filled) + ' from a web search (' + (found.get('confidence') or '?') + ')'
        if found.get('alternatives'):
            text += '; other clones: ' + ', '.join(found['alternatives'][:3])
        if found.get('source'):
            text += '; ' + found['source']
        notes.append(text)


def norm(text):
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()


def build_stable_cache(cache):
    """The results of the web searches are written for the groups of one export (by position); here they are filed by what they are about
    (the target and the species, or the name of the antibody), so a later export can use them."""
    path = os.path.join(cache, 'websearch-cache.json')
    stable = load_json(path) or {}
    for name, bucket in (('websearch-biolegend.json', 'biolegend'), ('websearch-nolink.json', 'nolink')):
        groups = load_json(os.path.join(cache, name)) or []
        by_key = {str(g.get('key')): g for g in groups}
        for result_file in sorted(glob.glob(os.path.join(cache, 'websearch-result-' + bucket + '-*.json'))):
            for found in load_json(result_file) or []:
                group = by_key.get(str(found.get('key')))
                if not group:
                    continue
                label = ('bio|' + norm(group.get('target')) + '|' + norm(group.get('species'))) if bucket == 'biolegend' else ('nolink|' + norm(group.get('title')))
                stable[label] = found
    # the species the antibody was tested in: filed by the link, or by the name and catalog number
    groups = {str(g.get('key')): g for g in (load_json(os.path.join(cache, 'websearch-reactivity.json')) or [])}
    for result_file in sorted(glob.glob(os.path.join(cache, 'websearch-result-reactivity-*.json'))):
        for found in load_json(result_file) or []:
            group = groups.get(str(found.get('key')))
            if group and (found.get('reactivity') or found.get('applications')):
                stable[react_label(group.get('link'), group.get('title'), group.get('catalog'))] = found
    json.dump(stable, open(path, 'w'), ensure_ascii=False, indent=1)
    return stable


def react_label(link, title, catalog):
    return 'react|' + ((link or '').strip() or (norm(title) + '|' + norm(catalog)))


def from_web_species(found, row, notes):
    """The species and applications the maker lists for the antibody (a web search): fills what is empty and says so."""
    filled = []
    for key, field in (('reactivity', 'Reactivity species'), ('applications', 'Applications')):
        value = (found.get(key) or '').strip()
        if value and not row.get(field):
            row[field] = value
            filled.append(field)
    if filled:
        notes.append(', '.join(filled) + ' from a web search (' + (found.get('confidence') or '?') + ', tested species as listed by the maker); ' + (found.get('source') or ''))


# products that are a dye or a labelled probe, not an antibody: the dye is said in the name ("MemBrite Fix 488/515", "AZDye 680", "DAPI")
DYES_BY_NAME = (
    (r'membrite fix cell surface staining (\d{3}/\d{3})', lambda m: 'MemBrite Fix ' + m.group(1), False),
    (r'azdye\s*(\d{3})', lambda m: 'AZDye ' + m.group(1), False),
    (r'atto\s*(\d{3}\w*)', lambda m: 'ATTO ' + m.group(1).upper(), True),
    (r'\bCF(\d{3}\w?)\b', lambda m: 'CF' + m.group(1), True),
    (r'propidium iodide', lambda m: 'Propidium iodide', False),
    (r'\bDAPI\b', lambda m: 'DAPI', False),
)


def dye_from_name(row, notes):
    if row.get('Conjugate'):
        return
    for pattern, make, joined in DYES_BY_NAME:
        found = re.search(pattern, row.get('Title', ''), re.I)
        if found:
            row['Conjugate'] = make(found)
            if joined and row.get('Conjugated') in ('', 'No', None):
                row['Conjugated'] = 'Yes'
            notes.append('Dye from the name')
            return


def enrich_antibody(row, key, notes, cache, stable, had_link):
    pages = load_json(os.path.join(cache, 'antibody-pages.json')) or {}
    if row.get('Link') and row['Link'] in pages:
        from_page_title(row['Link'], pages[row['Link']], row, notes)
    if 'biolegend.com' in row.get('Link', ''):
        found = stable.get('bio|' + norm(row.get('Target')) + '|' + norm(row.get('Reactivity species')))
    elif not had_link:
        found = stable.get('nolink|' + norm(row.get('Title')))
    else:
        found = None
    if found:
        from_web(found, row, notes)
    species = stable.get(react_label(row.get('Link'), row.get('Title'), row.get('Catalog number')))
    if species:
        from_web_species(species, row, notes)


def enrich_plasmid(row, key, files, notes, cache):
    link = re.sub(r'/(edit|view)?/?$', '', (row.get('Benchling entry') or '').strip())
    path = os.path.join(cache, 'sequences', hashlib.sha1(link.encode()).hexdigest()[:16] + '.gb') if link else ''
    if path and os.path.isfile(path) and not any(name.endswith('.gb') for name, _ in files):
        files.append((re.sub(r'[^A-Za-z0-9_.-]+', '_', row.get('Title', 'plasmid')) + '.gb', open(path, 'rb').read()))
        notes.append('Sequence file from the Benchling link')


# ---- backbone and selection of a plasmid -----------------------------------------------------------------------------------------------


MARKERS = (
    ('Ampicillin', r'\bamp\s*[-(]?\s*r\b|\bampr\b|\bbla\b|ampicillin|carbenicillin|amp resist'),
    ('Kanamycin', r'\bkan\s*[-(]?\s*r\b|\bkanr\b|kanamycin|neor/kanr|\baph\(3'),
    ('Chloramphenicol', r'\bcm\s*[-(]?\s*r\b|\bcmr\b|\bcamr\b|chloramphenicol|\bcat\b'),
    ('Spectinomycin', r'\bspec\s*[-(]?\s*r\b|\bspecr\b|spectinomycin|\baada\b'),
)


def vector_families(records):
    """The first part of the names that many plasmids share (pLVX, pT4, pTL ...) is the vector family they were made from."""
    found = {}
    for title in records:
        match = re.match(r'^[pP][A-Za-z]*\d*[A-Za-z]*(?=[-_ ]|$)', title.strip())
        if match:
            token = match.group(0)
            found[token[0].lower() + token[1:]] = found.get(token[0].lower() + token[1:], 0) + 1
    return {name for name, count in found.items() if count >= 3}


def backbone_of(title, comment, families):
    """The backbone: said in the comments ("Backbone: X"), or "in <vector>" in the name, or the family the name starts with."""
    said = re.search(r'backbone\s*[:=]\s*([A-Za-z0-9][\w.+-]*)', comment, re.I)
    if said:
        return said.group(1).rstrip('.,;'), 'the comments'
    inside = re.search(r'\b(?:in|into)\s+(p[A-Za-z][\w.+-]*)\s*$', title.strip(), re.I)
    if inside:
        return inside.group(1), 'the name'
    match = re.match(r'^[pP][A-Za-z]*\d*[A-Za-z]*(?=[-_ ]|$)', title.strip())
    if match:
        token = match.group(0)
        token = token[0].lower() + token[1:]
        trimmed = re.sub(r'\d+$', '', token)
        for candidate in (token, trimmed):
            if candidate in families:
                return candidate, 'the name'
    return '', ''


def selection_of(comment, genbank):
    """The antibiotic of the bacteria: from the comments, else from the resistance genes of the sequence."""
    for source, text_ in (('the comments', comment), ('the sequence features', genbank)):
        found = [name for name, pattern in MARKERS if re.search(pattern, text_, re.I)]
        if found:
            return found[0], source, found
    return '', '', []


# ---- alignments (Clustal files exported from Benchling) ---------------------------------------------------------------------------------


def read_clustal(path):
    """The names and the rows of a Clustal file, block after block."""
    rows, order = {}, []
    for number, line in enumerate(open(path, encoding='utf-8', errors='replace')):
        if number == 0 and re.match(r'(CLUSTAL|MUSCLE|MAFFT)', line, re.I):
            continue
        if not line.strip() or line[0].isspace():
            continue
        parts = line.split()
        if len(parts) >= 2 and re.fullmatch(r'[A-Za-z*.\-]+', parts[1]):
            if parts[0] not in rows:
                rows[parts[0]] = ''
                order.append(parts[0])
            rows[parts[0]] += parts[1]
    return {name: rows[name].replace('-', '').upper() for name in order}


def load_alignments(folder):
    """The Clustal files of a folder, found again by the sequences in them: sequence -> the files that have it."""
    index = {}
    for path in sorted(glob.glob(os.path.join(folder, '*.clustal')) + glob.glob(os.path.join(folder, '*.aln')) + glob.glob(os.path.join(folder, '*.clw'))):
        for sequence in set(read_clustal(path).values()):
            if len(sequence) > 200:
                index.setdefault(hashlib.sha1(sequence.encode()).hexdigest(), set()).add(path)
    return index


def genbank_sequence(content):
    match = re.search(r'ORIGIN(.*?)//', content.decode('utf-8', 'replace'), re.S)
    return re.sub(r'[^A-Za-z]', '', match.group(1)).upper() if match else ''


def attach_alignments(row, files, index, notes):
    """The Clustal files whose template is the sequence of the plasmid are attached to it."""
    found = set()
    for name, content in files:
        if name.endswith('.gb'):
            sequence = genbank_sequence(content)
            found |= index.get(hashlib.sha1(sequence.encode()).hexdigest(), set()) if sequence else set()
    for path in sorted(found):
        base = re.sub(r'\s*\(.*?\)\s*', '', os.path.splitext(os.path.basename(path))[0]).strip() or 'alignment'
        files.append(('alignment-' + re.sub(r'[^A-Za-z0-9_.-]+', '_', base) + '.clustal', open(path, 'rb').read()))
        notes.append('Alignment ' + os.path.basename(path) + ' attached (same sequence)')


def plasmid_details(row, files, families, notes):
    comment = row.get('Comments (LabCollector)', '')
    if not row.get('Backbone'):
        backbone, source = backbone_of(row.get('Title', ''), comment, families)
        if backbone:
            row['Backbone'] = backbone
            notes.append('Backbone from ' + source + ' (check it)')
    if not row.get('Resistance'):
        genbank = ''
        for name, content in files:
            if name.endswith('.gb'):
                # only the labels of the features: the long sequence and the references are left out
                genbank = ' '.join(re.findall(r'/(?:label|gene|note|product)="([^"]+)"', content.decode('utf-8', 'replace')))
        value, source, found = selection_of(comment, genbank)
        if value:
            row['Resistance'] = value
            notes.append('Selection (' + value + ') from ' + source + (' (also ' + ', '.join(f for f in found[1:]) + ')' if len(found) > 1 else ''))


# ---- the zip ---------------------------------------------------------------------------------------------------------------------------


def main():
    folder, module, out = sys.argv[1], sys.argv[2], sys.argv[3]
    cache = sys.argv[sys.argv.index('--cache') + 1] if '--cache' in sys.argv else ''
    os.makedirs(out, exist_ok=True)
    stable = build_stable_cache(cache) if cache else {}
    # a module that is not one of the three: its columns are matched to the fields of the module of the Database it goes to
    target_fields, title_column = [], 'Name'
    if module not in ('antibodies', 'plasmids', 'cells'):
        page = glob.glob(os.path.join(folder, '*.htm'))[0]
        records_peek = read_page(folder)
        title_column = 'Name' if records_peek and 'Name' in records_peek[0] else next(iter(records_peek[0]), 'Name')
        wanted = sys.argv[sys.argv.index('--as') + 1] if '--as' in sys.argv else {'primers': 'Primers', 'probes': 'Probes', 'reagents': 'Reagents', 'consumables': 'Consumables', 'samples': 'Samples'}.get(module, '')
        target_fields = default_modules().get(wanted, [])
    rows, reviews, all_files = [], [], []
    alignments = sys.argv[sys.argv.index('--alignments') + 1] if '--alignments' in sys.argv else ''
    alignment_index = load_alignments(alignments) if alignments and module == 'plasmids' else {}
    families = vector_families([text(r, 'Name') for r in read_page(folder)]) if module == 'plasmids' else set()
    for index, record in enumerate(read_page(folder), start=1):
        row, notes, files = {}, [], []
        if module == 'antibodies':
            convert_antibody(record, row, notes)
        elif module == 'plasmids':
            convert_plasmid(record, row, notes, files)
        elif module == 'cells':
            convert_cell(record, row, notes, files)
        else:
            convert_generic(record, row, notes, target_fields, title_column)
        common(record, row, notes)
        pictures(record, folder, files)
        had_link = bool(row.get('Link'))
        if cache:
            if module == 'antibodies':
                enrich_antibody(row, str(index), notes, cache, stable, had_link)
                dye_from_name(row, notes)
            elif module == 'plasmids':
                enrich_plasmid(row, str(index), files, notes, cache)
        if module == 'plasmids':
            plasmid_details(row, files, families, notes)
            if alignment_index:
                attach_alignments(row, files, alignment_index, notes)
        row['ID'] = row.get('LabCollector ID', '')
        row['Key'] = str(index)
        seen = {}
        names = []
        for filename, content in files:
            seen[filename] = seen.get(filename, 0) + 1
            if seen[filename] > 1:
                filename = str(seen[filename]) + '-' + filename
            names.append(filename)
            all_files.append(('files/' + str(index) + '/' + filename, content))
        row['Files'] = '|'.join(names)
        rows.append(row)
        reviews.append((index, row.get('Title', ''), '; '.join(notes)))
    # ID is the number of LabCollector: with the option to keep the numbers it becomes the lab number
    columns = ['ID', 'Title', 'Owner', 'Owner e-mail']
    for row in rows:
        for key in row:
            if key not in columns and key not in ('Key', 'Files', 'ID'):
                columns.append(key)
    columns += ['Key', 'Files']
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(columns)
    for row in rows:
        writer.writerow([row.get(c, '') for c in columns])
    with zipfile.ZipFile(os.path.join(out, module + '-import.zip'), 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('entries.csv', '﻿' + buffer.getvalue())
        for path, content in all_files:
            archive.writestr(path, content)
    with open(os.path.join(out, module + '-review.csv'), 'w', newline='', encoding='utf-8-sig') as handle:
        review = csv.writer(handle)
        review.writerow(['Row', 'Title', 'What was filled in, and what still needs a look'])
        review.writerows(reviews)
    filled = {c: sum(1 for r in rows if r.get(c)) for c in columns}
    print(module, len(rows), 'entries,', len(all_files), 'files')
    for c in columns:
        print('  %-30s %5d' % (c, filled[c]))


if __name__ == '__main__':
    main()
