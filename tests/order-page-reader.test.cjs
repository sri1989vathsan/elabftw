'use strict';
// Behaviour of the reader of vendor pages (web/order-to-database.js): the text of a product page, as it is copied or read from a screenshot,
// is turned into the columns of an entry. The file is loaded with a few stubs (it is a script of the browser).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'web', 'order-to-database.js'), 'utf8');
const win = { location: { pathname: '/x', href: 'http://x/x' }, addEventListener() {}, localStorage: { getItem() { return null; }, setItem() {} } };
class FakeParser {
  parseFromString(html) {
    return { body: { textContent: String(html).replace(/<[^>]+>/g, '') }, querySelectorAll() { return []; } };
  }
}
new Function('window', 'document', 'DOMParser', 'navigator', code)(win, { getElementById() { return null; }, querySelector() { return null; } }, FakeParser, {});
const O = win.OrderToDatabase;

const read = (text, link, name) => {
  const row = { name: name || '', vendor: '', link, catalog: '', clone: '', host: '', fields: null };
  O.applyPage(row, O.readPageText(text, link));
  return row;
};
const has = (row, expected) => {
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(row[key], value, key + ': ' + JSON.stringify(row[key]));
  }
};

test('BioLegend: reactivity, clone and conjugate from sentences, the catalog number of the RRID line', () => {
  const row = read(`Product Details
Verified Reactivity Mouse
Antibody Type Monoclonal
Host Species Rat
Preparation The antibody was purified by affinity chromatography and conjugated with Spark Blue™ 574 under optimal conditions.
Concentration 0.5 mg/mL
Application FC - Quality tested
Application Notes Clone 30-F11 reacts with all isoforms and both CD45.1 and CD45.2 alloantigens of CD45.
The Ultra-LEAF™ purified antibody is recommended for functional assays (Cat. No. 103163 and 103164).
RRID
AB_2904274 (BioLegend Cat. No. 103183)
AB_2904274 (BioLegend Cat. No. 103184)`, 'https://www.biolegend.com/en-us/products/x-21160', 'anti-mouse CD45');
  has(row, { catalog: '103183', clone: '30-F11', host: 'Rat', target: 'CD45', reactivity: 'Mouse', applications: 'FC', conjugate: 'Spark Blue 574', concentration: '0.5 mg/mL' });
});

test('Abcam: label alone on its line, the value on the next; "See reactivity data" is taken off', () => {
  const row = read(`Key facts
Host species
Rabbit
Clone number
SP124
Isotype
IgG
Reacts with
Mouse, Rat, Human
Applications
IHC-P, Flow Cyt (Intra), WB, ICC/IF See reactivity data`, 'https://www.abcam.com/en-us/products/primary-antibodies/x-ab115777', 'Anti-Actin antibody');
  has(row, { host: 'Rabbit', clone: 'SP124', isotype: 'IgG', reactivity: 'Mouse, Rat, Human', applications: 'IHC-P, Flow Cyt (Intra), WB, ICC/IF', target: 'Actin', vendor: 'Abcam' });
});

test('Thermo (the number in the title is not a clone), Santa Cruz (clone in brackets, facts in a sentence), R&D (one field for source and clone)', () => {
  has(read(`Invitrogen GFP Polyclonal Antibody (A-11122)
Catalog # A-11122
Host/Isotype
Rabbit / IgG
Conjugate
Unconjugated
Concentration
2 mg/mL`, 'https://www.thermofisher.com/antibody/product/A-11122', 'GFP antibody'), { catalog: 'A-11122', clone: '', host: 'Rabbit', isotype: 'IgG', conjugate: 'Unconjugated', concentration: '2 mg/mL' });
  has(read(`GFP Antibody (B-2): sc-9996
GFP Antibody (B-2) is a mouse monoclonal IgG2a kappa provided at 200 µg/ml for WB, IP, IF, FCM and ELISA`, 'https://www.scbt.com/p/x', 'GFP antibody'), { catalog: 'sc-9996', clone: 'B-2', host: 'Mouse', isotype: 'IgG2a', concentration: '200 µg/ml', applications: 'WB, IP, IF, FCM, ELISA' });
  has(read(`Human Nestin Antibody (196908) MAB1259
Antibody Source:
Monoclonal Mouse IgG1 Clone # 196908
Label
Unconjugated`, 'https://www.rndsystems.com/products/x', 'Nestin antibody'), { catalog: 'MAB1259', clone: '196908', host: 'Mouse', isotype: 'IgG1', conjugate: 'Unconjugated' });
});

test('Proteintech and BD: combined fields, "Clone HI30 (RUO)", labels with a colon', () => {
  has(read(`Beta Actin antibody (66009-1-Ig)
Cat No.
66009-1-Ig
Clone No.
2D4H5
Host / Isotype
Mouse / IgG1
Size/Concentration: 150 μL, 1000 ug/ml`, 'https://www.ptglab.com/x', 'Actin antibody'), { catalog: '66009-1-Ig', clone: '2D4H5', host: 'Mouse', isotype: 'IgG1', pack: '150 μL', concentration: '1000 ug/ml' });
  has(read(`Clone HI30 (RUO)
Catalog No:
555480
Isotype: Mouse IgG1, κ
Application:
Flow cytometry`, 'https://www.bdbiosciences.com/x/555480', 'anti CD45'), { catalog: '555480', clone: 'HI30', isotype: 'IgG1', applications: 'Flow cytometry' });
});

test('reagents and plasmids: article and CAS numbers, pack size, supplier, vector backbone and resistance', () => {
  has(read(`TRIS, 1 kg
Art. No. 4855.2
CAS number
77-86-1
Pack size 1 kg`, 'https://www.carlroth.com/ch/en/x/p/4855.2', 'Tris'), { catalog: '4855.2', cas: '77-86-1', pack: '1 kg', vendor: 'Roth' });
  has(read(`Addgene: pUC19 (Plasmid #50005)
Vector backbone
pUC6, Addgene plasmid #49793
Bacterial Resistance(s)
Ampicillin, 100 μg/mL`, 'https://www.addgene.org/50005/', 'pUC19'), { catalog: '50005', backbone: 'pUC6, Addgene plasmid #49793', resistance: 'Ampicillin, 100 μg/mL' });
});

test('vendors of the lab: a slip in the name is put right, also without a link; consumable vendors', () => {
  const vendorOf = (title) => O.parse({ title, notes: '' })[0];
  assert.strictEqual(vendorOf('Ampicillin 100 mg/ml; Simga').vendor, 'Sigma-Aldrich');
  assert.strictEqual(vendorOf('Agarose; Carl Roth').vendor, 'Roth');
  assert.strictEqual(vendorOf('Gel loading dye; Promeg').vendor, 'Promega');
  assert.strictEqual(vendorOf('Pipette tips 200 ul; Starlab').moduleTitle, 'Consumables');
  assert.strictEqual(vendorOf('Something; Unknown Vendor GmbH').vendor, 'Unknown Vendor GmbH');
});
