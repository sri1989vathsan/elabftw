const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/ts/custom-editor/SpreadsheetUndo.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { captureSpreadsheetPositions: capture, restoreSpreadsheetPositions: restore } = context.exports;

// Minimal element tree: these tests exercise ordering/identity, not layout.
class Element {
  constructor(kind, label, ...children) {
    this.kind = kind;
    this.label = label;
    this.children = [];
    this.parentElement = null;
    children.forEach(child => this.insertBefore(child, null));
  }
  get outerHTML() { return `<${this.kind}>${this.label}${this.children.map(c => c.outerHTML).join('')}</${this.kind}>`; }
  matches(selector) {
    return (this.kind === 'table' && selector.includes('table.elabftw-spreadsheet'))
      || (this.kind === 'spacer' && selector.includes('[data-elabftw-spreadsheet-spacer]'));
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  insertBefore(child, reference) {
    child.remove();
    const index = reference === null ? this.children.length : this.children.indexOf(reference);
    assert.ok(index >= 0);
    this.children.splice(index, 0, child);
    child.parentElement = this;
  }
}
const p = label => new Element('p', label);
const table = label => new Element('table', label);

test('repeated undo/redo retains each live table once, in order, with the same identity', () => {
  const a = table('A'), b = table('B');
  let body = new Element('body', '', p('before'), a, b, p('after'));
  for (let i = 0; i < 100; i++) {
    const positions = capture(body);
    // Old snapshots may contain no tables, pre-UID clones or stale tables.
    const replacement = i % 2
      ? new Element('body', '', p('before'), table('old A'), table('deleted table'), p('after'))
      : new Element('body', '', p('before'), p('after'));
    restore(replacement, positions);
    assert.deepEqual(replacement.children, [replacement.children[0], a, b, replacement.children[3]]);
    assert.deepEqual(replacement.querySelectorAll('table.elabftw-spreadsheet'), [a, b]);
    body = replacement;
  }
});

test('changed and duplicate prose anchors use a deterministic position, not append', () => {
  const a = table('A');
  const positions = capture(new Element('body', '', p('same'), a, p('same'), p('end')));
  const body = new Element('body', '', p('same'), p('same'), p('end changed'));
  restore(body, positions);
  assert.equal(body.children[1], a);
});

test('undoing all prose leaves only the live tables and never resurrects a deleted one', () => {
  const a = table('A'), b = table('B');
  const positions = capture(new Element('body', '', p('before'), a, p('middle'), b, p('after')));
  const body = new Element('body', '', table('deleted'));
  restore(body, positions);
  assert.deepEqual(body.children, [a, b]);
});

test('nested table stays in its containing block', () => {
  const a = table('A');
  const positions = capture(new Element('body', '', new Element('section', '', p('before'), a, p('after'))));
  const section = new Element('section', '', p('before'), p('after'));
  const body = new Element('body', '', section);
  restore(body, positions);
  assert.equal(a.parentElement, section);
  assert.equal(section.children[1], a);
});
