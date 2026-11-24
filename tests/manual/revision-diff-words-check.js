#!/usr/bin/env node
/**
 * The revision comparison (revisions.php, Compare revisions) marks changed WORDS, not letters or whole lines. Headless Chrome:
 *
 *   node tests/manual/revision-diff-words-check.js http://localhost:8973 EMAIL PASSWORD [screenshot.png]
 *
 * Makes a throw-away experiment, writes two revision rows straight into the database through docker compose (run from the
 * checkout of the stack under test; for the inventory stack set CHECK_COMPOSE="docker compose -p elabftw-inventory -f docker-compose.yml -f docker-compose.inventory.yml"),
 * opens the history page, ticks both, presses Compare and checks:
 *   - "cat" -> "car" inside a sentence: <del>cat</del><ins>car</ins> (whole words, not <del>t</del><ins>r</ins>)
 *   - an added and a removed word are marked; the unchanged words are not
 *   - table cells, list items and headings keep their own lines in the output
 *   - markup in the body (<img onerror>, <script>) is shown as nothing/plain text, never run (window.__xss stays unset)
 *   - a body of 40000 words still compares in under 5 seconds (falls back to lines)
 * Deletes the experiment at the end (revision rows go with it).
 */
const { execSync } = require('child_process');
const { startChrome, sleep } = require('./cdp-lib');
const [base0, email, password, shot] = process.argv.slice(2);
if (!base0 || !email || !password) { console.error('usage: revision-diff-words-check.js BASEURL EMAIL PASSWORD [screenshot.png]'); process.exit(2); }
const base = base0.replace(/\/$/, '');
const compose = process.env.CHECK_COMPOSE || 'docker compose';
const root = require('path').resolve(__dirname, '..', '..');
const sql = q => execSync(`${compose} exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" elabftw -N -e "${q.replace(/"/g, '\\"')}"'`, { cwd: root }).toString().trim();
const esc = s => s.replace(/'/g, "''").replace(/\\/g, '\\\\');

const OLD = '<h2>Method heading</h2><p>The black cat sat on the old mat and slept.</p><ul><li>first item</li><li>second item</li></ul><table><tbody><tr><td>alpha</td><td>beta</td></tr></tbody></table><p><img src="x" onerror="window.__xss=1"> end</p>';
const NEW = '<h2>Method heading</h2><p>The black car sat on the mat and slept soundly.</p><ul><li>first item</li><li>second items</li></ul><table><tbody><tr><td>alpha</td><td>gamma</td></tr></tbody></table><p><img src="x" onerror="window.__xss=1"> end <script>window.__xss=2</script></p>';

(async () => {
  const c = await startChrome();
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`); };
  const hdr = "{ 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }";
  let expId = 0;
  try {
    await c.login(base, email, password);
    expId = await c.js(`const r = await fetch('/api/v2/experiments', { method: 'POST', credentials: 'same-origin', headers: ${hdr}, body: JSON.stringify({ title: 'revision diff words' }) }); return Number(r.headers.get('Location').split('/').pop())`);
    const userid = sql(`SELECT userid FROM experiments WHERE id = ${expId}`);
    const ins = body => sql(`INSERT INTO experiments_revisions (item_id, body, userid) VALUES (${expId}, '${esc(body)}', ${userid}); SELECT LAST_INSERT_ID()`);
    ins(OLD); ins(NEW);
    await c.nav(`${base}/revisions.php?type=experiments&item_id=${expId}`);
    const compare = async () => {
      await c.js(`window.__xss = undefined; document.querySelectorAll('input[data-action="checkbox-revision"]').forEach(b => b.click()); await new Promise(r => setTimeout(r, 300)); document.getElementById('compareRevisionsButton').click(); return 1`);
      for (let i = 0; i < 60; i++) { await sleep(250); if (await c.js(`return !!document.querySelector('#compareRevisionsDiffDiv .revision-diff')`)) break; }
    };
    await compare();
    const out = await c.js(`const d = document.querySelector('#compareRevisionsDiffDiv'); return { dels: [...d.querySelectorAll('del')].map(e => e.textContent), inss: [...d.querySelectorAll('ins')].map(e => e.textContent), text: d.querySelector('.revision-diff').textContent, summary: d.querySelector('.revision-diff-summary').textContent, xss: window.__xss ?? null, scripts: d.querySelectorAll('script, img').length }`);
    const j = a => a.map(s => s.trim()).join('|');
    check('cat -> car is one whole-word change', out.dels.map(s => s.trim()).includes('cat') && out.inss.map(s => s.trim()).includes('car'), out);
    check('no single-letter fragments marked', ![...out.dels, ...out.inss].some(s => /^[a-z]$/i.test(s.trim())), out);
    check('removed word "old" marked', out.dels.some(s => s.trim() === 'old'), out.dels);
    check('added word "soundly" marked', out.inss.some(s => s.trim() === 'soundly'), out.inss);
    check('table cell beta -> gamma marked whole', out.dels.some(s => s.trim() === 'beta') && out.inss.some(s => s.trim() === 'gamma'), out);
    check('list item and heading keep their own lines', /Method heading\nThe black/.test(out.text) && /first item\n/.test(out.text) && /alpha\s*\n?\s*(beta|gamma)/.test(out.text), out.text);
    check('unchanged words are not marked', !out.dels.concat(out.inss).some(s => /Method|heading|black|slept/.test(s)), out);
    check('summary counts words', /\d+ words? added, \d+ removed/.test(out.summary), out.summary);
    check('markup from the body is never run or inserted', out.xss === null && out.scripts === 0, out);
    if (shot) { await c.js(`document.getElementById('compareRevisionsDiffDiv').scrollIntoView(); return 1`); await sleep(300); await c.shot(shot); }

    // long body: must stay fast
    const big = n => '<p>' + Array.from({ length: n }, (_, i) => 'word' + (i % 500)).join(' ') + '</p>';
    sql(`DELETE FROM experiments_revisions WHERE item_id = ${expId}`);
    ins(big(40000)); ins(big(40000).replace('word10 ', 'changed '));
    await c.nav(`${base}/revisions.php?type=experiments&item_id=${expId}`);
    const t0 = Date.now();
    await compare();
    const ms = Date.now() - t0;
    const n = await c.js(`return document.querySelectorAll('#compareRevisionsDiffDiv ins, #compareRevisionsDiffDiv del').length`);
    check(`40000-word body compares in ${ms} ms (< 5000) and still marks a change`, ms < 5000 && n > 0, { ms, n });
  } finally {
    if (expId) await c.js(`await fetch('/api/v2/experiments/${expId}', { method: 'DELETE', credentials: 'same-origin', headers: ${hdr} }); return 1`).catch(() => {});
    await c.close();
  }
  process.exit(results.every(Boolean) ? 0 : 1);
})();
