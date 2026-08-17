import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 8080);
const ACCESS_CODE = String(process.env.PORTAL_ACCESS_CODE ?? '').trim();
const DEMO = String(process.env.PYRAT_DEMO_MODE ?? 'true').toLowerCase() === 'true';
const BASE_URL = String(process.env.PYRAT_BASE_URL ?? '').replace(/\/$/, '');
const AUTH_MODE = String(process.env.PYRAT_AUTH_MODE ?? 'basic');
const USERNAME = String(process.env.PYRAT_USERNAME ?? '');
const SECRET = String(process.env.PYRAT_SECRET ?? '');
const ANIMALS_PATH = String(process.env.PYRAT_ANIMALS_PATH ?? '');
const SCORES_PATH = String(process.env.PYRAT_SCORES_PATH ?? '');
const SCORES_READ_PATH = String(process.env.PYRAT_SCORES_READ_PATH ?? '');
const SCORE_WRITE_ENABLED = String(process.env.PYRAT_SCORE_WRITE_ENABLED ?? 'false').toLowerCase() === 'true';
const DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url));

if (!ACCESS_CODE) {
  console.error('PORTAL_ACCESS_CODE must be set. Refusing to start an unauthenticated monitoring portal.');
  process.exit(1);
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

function authorized(req) {
  const supplied = String(req.headers['x-portal-code'] ?? '');
  const expectedBuffer = Buffer.from(ACCESS_CODE);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function authHeaders() {
  const headers = {Accept: 'application/json'};
  if (AUTH_MODE === 'basic') {
    if (!USERNAME || !SECRET) throw new Error('PyRAT service-account username/password are not configured.');
    headers.Authorization = `Basic ${Buffer.from(`${USERNAME}:${SECRET}`).toString('base64')}`;
  } else if (AUTH_MODE === 'bearer') {
    if (!SECRET) throw new Error('PyRAT bearer/API token is not configured.');
    headers.Authorization = `Bearer ${SECRET}`;
  } else if (AUTH_MODE !== 'none') {
    throw new Error(`Unsupported PYRAT_AUTH_MODE: ${AUTH_MODE}`);
  }
  return headers;
}

function endpoint(pathname) {
  if (!BASE_URL) throw new Error('PYRAT_BASE_URL is not configured.');
  if (!pathname) throw new Error('Required PyRAT endpoint path is not configured.');
  const base = new URL(`${BASE_URL}/`);
  const target = /^https?:\/\//.test(pathname)
    ? new URL(pathname)
    : new URL(pathname.replace(/^\//, ''), base);
  if (target.origin !== base.origin) throw new Error('PyRAT endpoint must use the configured base URL origin.');
  return target.toString();
}

async function pyratJson(method, pathname, {query = {}, body} = {}) {
  const url = new URL(endpoint(pathname));
  for (const [key, value] of Object.entries(query)) {
    if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers = authHeaders();
  const options = {method, headers};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  options.redirect = 'error';
  options.signal = AbortSignal.timeout(15_000);
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`PyRAT returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 5_000_000) throw new Error('PyRAT response is too large. Configure a narrower endpoint.');
  const text = await response.text();
  if (text.length > 5_000_000) throw new Error('PyRAT response is too large. Configure a narrower endpoint.');
  return text ? JSON.parse(text) : {};
}

function rows(payload, likelyKeys) {
  if (Array.isArray(payload)) return payload;
  for (const key of likelyKeys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    for (const nested of likelyKeys) {
      if (Array.isArray(payload?.[key]?.[nested])) return payload[key][nested];
    }
  }
  return payload && typeof payload === 'object' ? [payload] : [];
}

function first(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value === null || value === undefined) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
    if (typeof value === 'object') {
      for (const nested of ['id', 'name', 'label', 'title', 'identifier']) {
        if (value[nested] !== undefined) return String(value[nested]);
      }
    }
  }
  return '';
}

function normalizeAnimal(row) {
  const id = first(row, ['id', 'animal_id', 'animalId', 'animalID', 'uuid', 'identifier']);
  const label = first(row, ['animal_id', 'animalId', 'animalID', 'name', 'identifier', 'earmark', 'id']);
  return {
    id: id || label,
    animal_id: label || id,
    cage: first(row, ['cage', 'cage_id', 'cageId', 'cageID', 'cage_name', 'cageName']),
    sex: first(row, ['sex', 'gender']),
    strain: first(row, ['strain', 'line', 'mouse_line', 'mouseLine']),
    genotype: first(row, ['genotype', 'genotyping', 'genotype_result']),
    status: first(row, ['status', 'state', 'animal_status']),
    project: first(row, ['project', 'experiment', 'authorization', 'licence', 'license']),
  };
}

const demoAnimals = [
  {id: '1001234', animal_id: 'M1234', cage: 'C12', sex: 'Male', strain: 'C57BL/6J', genotype: 'WT', status: 'Active', project: 'DSS-2026'},
  {id: '1001235', animal_id: 'M1235', cage: 'C12', sex: 'Female', strain: 'C57BL/6J', genotype: 'WT', status: 'Active', project: 'DSS-2026'},
  {id: '1001236', animal_id: 'M1236', cage: 'C13', sex: 'Male', strain: 'C57BL/6J', genotype: 'KO', status: 'Active', project: 'DSS-2026'},
  {id: '1001240', animal_id: 'M1240', cage: 'C14', sex: 'Male', strain: 'Villin-Cre', genotype: 'Het', status: 'Active', project: 'DSS-2026'},
];

async function getAnimals(query) {
  if (DEMO) {
    const q = String(query.q ?? '').toLowerCase();
    const cage = String(query.cage ?? '').toLowerCase();
    const experiment = String(query.experiment ?? '').toLowerCase();
    return demoAnimals.filter(animal => {
      const haystack = Object.values(animal).join(' ').toLowerCase();
      return (!q || haystack.includes(q))
        && (!cage || animal.cage.toLowerCase() === cage)
        && (!experiment || animal.project.toLowerCase() === experiment);
    });
  }
  const payload = await pyratJson('GET', ANIMALS_PATH, {query});
  const experiment = String(query.experiment ?? '').toLowerCase();
  return rows(payload, ['animals', 'results', 'data', 'items'])
    .map(normalizeAnimal)
    .filter(animal => !experiment || animal.project.toLowerCase() === experiment)
    .slice(0, 250);
}

async function recordScore(score) {
  if (DEMO) {
    await mkdir(DATA_DIR, {recursive: true});
    const record = {...score, recorded_at: new Date().toISOString(), demo: true};
    await appendFile(path.join(DATA_DIR, 'submissions.ndjson'), `${JSON.stringify(record)}\n`, {encoding: 'utf8'});
    return {accepted: true, demo: true, external_id: `DEMO-${Date.now()}`};
  }
  if (!SCORE_WRITE_ENABLED) throw new Error('Live PyRAT score writes are disabled. Validate the institutional endpoint/payload before setting PYRAT_SCORE_WRITE_ENABLED=true.');
  if (!SCORES_PATH) throw new Error('PYRAT_SCORES_PATH is not configured; score submission is disabled.');
  return pyratJson('POST', SCORES_PATH, {body: score});
}

async function getScores(query) {
  if (DEMO) {
    let raw = '';
    try {
      raw = await readFile(path.join(DATA_DIR, 'submissions.ndjson'), {encoding: 'utf8'});
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    if (raw.length > 10_000_000) throw new Error('The demo score history is too large to display. Archive older records first.');
    const animalId = String(query.animal_id ?? '').toLowerCase();
    const cage = String(query.cage ?? '').toLowerCase();
    return raw.split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(score => {
        const identifiers = [score.animal_id, score.animal_label].map(value => String(value ?? '').toLowerCase());
        return (!animalId || identifiers.includes(animalId))
          && (!cage || String(score.cage ?? '').toLowerCase() === cage);
      })
      .sort((left, right) => String(right.recorded_at ?? right.date ?? '').localeCompare(String(left.recorded_at ?? left.date ?? '')))
      .slice(0, 250);
  }
  if (!SCORES_READ_PATH) throw new Error('PYRAT_SCORES_READ_PATH is not configured; score history is unavailable.');
  const payload = await pyratJson('GET', SCORES_READ_PATH, {query});
  return rows(payload, ['scores', 'records', 'results', 'data', 'items']).slice(0, 250);
}

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request body too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PyRAT Scoresheet</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#20242a;background:#f5f7fa}*{box-sizing:border-box}body{margin:0}.top{background:#fff;border-bottom:1px solid #dfe3e8;padding:14px 20px;display:flex;align-items:center;gap:12px}.top h1{font-size:18px;margin:0}.dot{width:9px;height:9px;border-radius:99px;background:#25a45b;display:inline-block}.wrap{max-width:920px;margin:24px auto;padding:0 16px}.card{background:#fff;border:1px solid #dfe3e8;border-radius:12px;padding:18px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.03)}.row,.field-grid,.decision-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1;min-width:160px}.field-wide{grid-column:1/-1}input,select,textarea,button{font:inherit}input,select,textarea{width:100%;padding:10px 11px;border:1px solid #c8ced6;border-radius:8px;background:#fff;color:#20242a}button{border:0;border-radius:8px;padding:10px 14px;background:#276ef1;color:#fff;font-weight:600;cursor:pointer}.secondary{background:#eef2f7;color:#263445}.button-row{display:flex;gap:8px;flex-wrap:wrap}.animal{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #edf0f3}.animal:first-child{border-top:0}.animal .meta{flex:1}.animal strong{display:block}.muted{color:#697482;font-size:13px}.hidden{display:none}#history:not(.hidden){position:relative;left:50%;transform:translateX(-50%);width:min(1600px,calc(100vw - 32px))}.score label{display:block;font-weight:600;margin:11px 0 6px}.score h3{font-size:16px;margin:22px 0 8px}.decision{border:1px solid #dfe3e8;border-radius:9px;padding:10px 12px;margin:0}.decision legend{font-weight:600;padding:0 4px}.decision label{display:inline-flex;align-items:center;margin:2px 18px 2px 0;font-weight:400;gap:5px}.decision input{width:auto}.history-group{background:#fff;border:1px solid #dfe3e8;border-radius:12px;padding:16px;margin-bottom:16px}.history-group h3{margin:0 0 10px;font-size:17px}.history-common{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:8px;margin-bottom:14px}.history-common-item{background:#f4f7f2;border-radius:8px;padding:8px 10px}.history-common-item strong{display:block;color:#697482;font-size:11px;text-transform:uppercase;letter-spacing:.03em}.history-table-wrap{overflow:auto;max-height:65vh;border:1px solid #dfe3e8;border-radius:10px;background:#fff}.history-table{border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:100%;font-size:13px}.history-table th,.history-table td{border-right:1px solid #e4e8ed;border-bottom:1px solid #e4e8ed;padding:9px 10px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.history-table th{position:sticky;top:0;z-index:2;background:#eaf0e7;color:#263445;font-weight:700;white-space:nowrap;overflow:visible;user-select:none}.column-resizer{position:absolute;top:0;right:-4px;width:9px;height:100%;cursor:col-resize;touch-action:none;z-index:3}.column-resizer::after{content:"";position:absolute;right:4px;top:20%;height:60%;border-right:2px solid #9aa8b4}.column-resizer:hover::after,.column-resizer.dragging::after{border-color:#276ef1}.history-table tbody tr:nth-child(even) td{background:#f7f9fb}.history-table tbody tr:hover td{background:#eef6ff}.history-empty{padding:18px;background:#fff;border:1px solid #dfe3e8;border-radius:10px}.notice{padding:10px 12px;border-radius:8px;background:#eef6ff;color:#174b84;margin-bottom:12px}.error{background:#fff0f0;color:#8c2020}.ok{background:#edf9f1;color:#176536}@media(max-width:760px){.wrap{margin-top:14px}.animal{align-items:flex-start;flex-wrap:wrap}.field-grid,.decision-grid{grid-template-columns:1fr}.field-wide{grid-column:auto}.history-common{grid-template-columns:repeat(2,minmax(120px,1fr))}.history-table-wrap{max-height:70vh}}
</style></head><body>
<div class="top"><span class="dot"></span><h1>PyRAT Scoresheet</h1><span id="mode" class="muted"></span></div>
<main class="wrap">
<section id="unlock" class="card"><h2>Scoresheet access</h2><p class="muted">This scoresheet is separate from eLabFTW. Enter the facility access code; it is kept only in this browser tab.</p><div class="row"><input id="code" type="password" autocomplete="off" placeholder="Access code"><button id="unlockBtn">Continue</button></div><div id="unlockMsg"></div></section>
<section id="browser" class="hidden"><div class="card"><div class="row"><input id="search" placeholder="Search animal, cage, strain, genotype or project"><input id="cage" placeholder="Cage (optional)"><select id="experimentFilter" aria-label="Filter mice by experiment"><option value="">All experiments</option></select><button id="searchBtn">Search PyRAT</button><button id="allHistoryBtn" class="secondary">Previous entries</button></div></div><div id="list" class="card"></div></section>
<section id="history" class="hidden"><div class="card"><div class="button-row"><button id="historyBack" class="secondary">← Animals</button><button id="historyNew">Add new entry</button></div><h2 id="historyTitle">Previous entries</h2><p id="historyMeta" class="muted"></p></div><div id="historyList"></div></section>
<section id="score" class="card score hidden"><div class="button-row"><button id="back" class="secondary">← Animals</button><button id="animalHistoryBtn" class="secondary">Previous entries</button></div><h2 id="animalTitle"></h2><div id="animalMeta" class="muted"></div><div class="notice">Use the experiment and welfare fields approved for your animal licence and facility SOP.</div><h3>Common experiment details</h3><p class="muted">These values are reused for other mice in the same experiment.</p><div class="field-grid"><div><label for="experiment">Experiment</label><input id="experiment"></div><div><label for="permitNumber">Permit number</label><input id="permitNumber"></div><div><label for="experimenter">Experimenter</label><input id="experimenter" autocomplete="name"></div><div><label for="contactEmail">Contact details (email)</label><input id="contactEmail" type="email" autocomplete="email"></div></div><h3>Specific record details</h3><div class="field-grid"><div><label for="scoreDate">Date</label><input id="scoreDate" type="date" required></div><div><label for="observer">Observer</label><input id="observer" autocomplete="name" required></div><div class="field-wide"><label for="procedure">Procedure</label><textarea id="procedure" rows="2"></textarea></div><div><label for="weight">Weight (g)</label><input id="weight" type="number" step="0.1" min="0"></div></div><h3>Medication</h3><div class="field-grid"><div><label for="carprofen">Carprofen (s.c.)</label><input id="carprofen" value="No" placeholder="Dose / time / No"></div><div><label for="lidocaineBupivacaine">Lidocaine/bupivacaine (s.c.)</label><input id="lidocaineBupivacaine" value="No" placeholder="Dose / time / No"></div><div><label for="buprenorphine">Buprenorphine (s.c.)</label><input id="buprenorphine" value="No" placeholder="Dose / time / No"></div></div><h3>Welfare observations</h3><div class="decision-grid"><fieldset class="decision"><legend>Pain</legend><label><input type="radio" name="pain" value="yes"> Yes</label><label><input type="radio" name="pain" value="no" checked> No</label></fieldset><fieldset class="decision"><legend>Infection</legend><label><input type="radio" name="infection" value="yes"> Yes</label><label><input type="radio" name="infection" value="no" checked> No</label></fieldset><fieldset class="decision"><legend>Increased monitoring</legend><label><input type="radio" name="increasedMonitoring" value="yes"> Yes</label><label><input type="radio" name="increasedMonitoring" value="no" checked> No</label></fieldset><fieldset class="decision"><legend>Termination criteria</legend><label><input type="radio" name="terminationCriteria" value="yes"> Yes</label><label><input type="radio" name="terminationCriteria" value="no" checked> No</label></fieldset><fieldset class="decision"><legend>Euthanasia</legend><label><input type="radio" name="euthanasia" value="yes"> Yes</label><label><input type="radio" name="euthanasia" value="no" checked> No</label></fieldset></div><div class="field-grid"><div><label for="totalScore">Total score</label><input id="totalScore" type="number" step="1" min="0"></div><div class="field-wide"><label for="comments">Comments</label><textarea id="comments" rows="3"></textarea></div></div><button id="save">Save & next</button><div id="saveMsg"></div></section>
</main>
<script>
const initialParams=new URLSearchParams(location.search);
const initialType=initialParams.get('entity_type')||initialParams.get('type')||'';
const initialId=initialParams.get('entity_id')||initialParams.get('id')||'';
const initialView=initialParams.get('view')||'';
let current=null; let historyAnimal=null; let returnToHistory=false; let initialSelectionPending=Boolean(initialId); const stableByExperiment=new Map(); const knownExperiments=new Set(); const access=()=>sessionStorage.getItem('pyratScoresheetCode')||'';
function msg(el,text,kind=''){el.textContent=text;el.className=text?'notice '+kind:''}
async function api(url,opts={}){const headers=new Headers(opts.headers||{});headers.set('X-Portal-Code',access());if(opts.body)headers.set('Content-Type','application/json');const r=await fetch(url,{...opts,headers,cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j}
function localDate(){const now=new Date();return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function value(id){return document.getElementById(id).value.trim()}
function yes(name){return document.querySelector('input[name="'+name+'"]:checked')?.value==='yes'}
function resetDecision(name){const no=document.querySelector('input[name="'+name+'"][value="no"]');if(no)no.checked=true}
function stableDetails(record={}){return {experiment:String(record.experiment??''),permit_number:String(record.permit_number??''),experimenter:String(record.experimenter??''),contact_email:String(record.contact_email??'')}}
function stableKey(experiment){return String(experiment??'').trim().toLowerCase()}
function cacheStableDetails(record){const details=stableDetails(record);if(details.experiment)stableByExperiment.set(stableKey(details.experiment),details);return details}
function applyStableDetails(details,{replaceProject=''}={}){if(!details)return;const experiment=document.getElementById('experiment');if(!experiment.value||experiment.value===replaceProject)experiment.value=details.experiment||replaceProject;const fields=[['permitNumber',details.permit_number],['experimenter',details.experimenter],['contactEmail',details.contact_email]];fields.forEach(([id,entry])=>{const input=document.getElementById(id);if(!input.value&&entry)input.value=entry})}
async function restoreStableDetails(animal){try{const animalId=encodeURIComponent(animal.id||animal.animal_id);let j=await api('/api/scores?animal_id='+animalId);let previous=j.data.find(record=>record.experiment||record.permit_number||record.experimenter||record.contact_email);if(!previous&&animal.project){j=await api('/api/scores');previous=j.data.find(record=>stableKey(record.experiment)===stableKey(animal.project))}if(current!==animal||!previous)return;applyStableDetails(cacheStableDetails(previous),{replaceProject:animal.project||''})}catch(e){console.warn('Could not restore experiment details.',e)}}
function updateExperimentFilter(animals){const select=document.getElementById('experimentFilter');const selected=select.value;animals.forEach(animal=>{if(animal.project)knownExperiments.add(animal.project)});select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='All experiments';select.append(all);Array.from(knownExperiments).sort((left,right)=>left.localeCompare(right)).forEach(experiment=>{const option=document.createElement('option');option.value=experiment;option.textContent=experiment;select.append(option)});select.value=selected}
async function load(){const list=document.getElementById('list');list.textContent='Loading…';try{const q=encodeURIComponent(document.getElementById('search').value);const cage=encodeURIComponent(document.getElementById('cage').value);const experiment=encodeURIComponent(document.getElementById('experimentFilter').value);const j=await api('/api/animals?q='+q+'&cage='+cage+'&experiment='+experiment);updateExperimentFilter(j.data);list.innerHTML='';if(!j.data.length){list.textContent='No animals found.';return}j.data.forEach(a=>{const r=document.createElement('div');r.className='animal';const info=document.createElement('div');info.className='meta';const s=document.createElement('strong');s.textContent=a.animal_id||a.id;const m=document.createElement('div');m.className='muted';m.textContent=[a.cage,a.strain,a.genotype,a.sex,a.status,a.project].filter(Boolean).join(' · ');info.append(s,m);const actions=document.createElement('div');actions.className='button-row';const record=document.createElement('button');record.textContent='Record';record.onclick=()=>openScore(a);const history=document.createElement('button');history.className='secondary';history.textContent='Previous entries';history.onclick=()=>loadHistory(a);actions.append(record,history);r.append(info,actions);list.append(r)});if(initialSelectionPending&&initialType==='animal'){const exact=j.data.find(a=>String(a.id)===initialId||String(a.animal_id)===initialId);initialSelectionPending=false;if(exact){if(initialView==='history')await loadHistory(exact);else openScore(exact)}}}catch(e){list.textContent=e.message}}
function openScore(a,{backToHistory=false}={}){returnToHistory=backToHistory;if(current){cacheStableDetails({experiment:value('experiment'),permit_number:value('permitNumber'),experimenter:value('experimenter'),contact_email:value('contactEmail')})}current=a;document.getElementById('history').classList.add('hidden');document.getElementById('browser').classList.add('hidden');document.getElementById('score').classList.remove('hidden');document.getElementById('animalTitle').textContent=a.animal_id||a.id;document.getElementById('animalMeta').textContent=[a.cage,a.strain,a.genotype,a.sex,a.project].filter(Boolean).join(' · ');['experiment','permitNumber','experimenter','contactEmail'].forEach(id=>document.getElementById(id).value='');document.getElementById('experiment').value=a.project||'';applyStableDetails(stableByExperiment.get(stableKey(a.project)),{replaceProject:a.project||''});document.getElementById('scoreDate').value=localDate();['observer','procedure','weight','totalScore','comments'].forEach(id=>document.getElementById(id).value='');['carprofen','lidocaineBupivacaine','buprenorphine'].forEach(id=>document.getElementById(id).value='No');['pain','infection','increasedMonitoring','terminationCriteria','euthanasia'].forEach(resetDecision);msg(document.getElementById('saveMsg'),'');restoreStableDetails(a)}
function historyValue(entry){if(typeof entry==='boolean')return entry?'Yes':'No';if(entry===null||entry===undefined||entry==='')return '—';return String(entry)}
function historyColumns(){return [['Date',record=>record.date??record.recorded_at,110],['Animal',record=>record.animal_label??record.animal_id,100],['Cage',record=>record.cage,85],['Observer',record=>record.observer,130],['Procedure',record=>record.procedure,220],['Weight (g)',record=>record.weight_g,90],['Carprofen (s.c.)',record=>record.carprofen_sc,140],['Lidocaine/bupivacaine (s.c.)',record=>record.lidocaine_bupivacaine_sc,190],['Buprenorphine (s.c.)',record=>record.buprenorphine_sc,160],['Pain',record=>record.pain,80],['Infection',record=>record.infection,85],['Increased monitoring',record=>record.increased_monitoring,135],['Termination criteria',record=>record.termination_criteria,130],['Euthanasia',record=>record.euthanasia,95],['Total score',record=>record.total_score??record.total,90],['Comments',record=>record.comments,240],['Submitted',record=>record.recorded_at,170]]}
function updateTableWidth(table,cols){table.style.width=cols.reduce((sum,col)=>sum+Number.parseFloat(col.style.width||'0'),0)+'px'}
function addColumnResizer(th,col,table,cols,defaultWidth){const handle=document.createElement('span');handle.className='column-resizer';handle.title='Drag to resize; double-click to reset';handle.onpointerdown=event=>{event.preventDefault();const startX=event.clientX;const startWidth=Number.parseFloat(col.style.width);handle.classList.add('dragging');handle.setPointerCapture(event.pointerId);handle.onpointermove=move=>{col.style.width=Math.max(65,startWidth+move.clientX-startX)+'px';updateTableWidth(table,cols)};handle.onpointerup=up=>{handle.classList.remove('dragging');handle.releasePointerCapture(up.pointerId);handle.onpointermove=null;handle.onpointerup=null}};handle.ondblclick=()=>{col.style.width=defaultWidth+'px';updateTableWidth(table,cols)};th.append(handle)}
function renderHistoryTable(records){const wrap=document.createElement('div');wrap.className='history-table-wrap';const table=document.createElement('table');table.className='history-table';const columns=historyColumns();const colgroup=document.createElement('colgroup');const cols=columns.map(([, ,width])=>{const col=document.createElement('col');col.style.width=width+'px';colgroup.append(col);return col});const head=document.createElement('thead');const headRow=document.createElement('tr');columns.forEach(([label,,width],index)=>{const th=document.createElement('th');th.scope='col';th.textContent=label;addColumnResizer(th,cols[index],table,cols,width);headRow.append(th)});head.append(headRow);const body=document.createElement('tbody');records.forEach(record=>{const row=document.createElement('tr');columns.forEach(([,read])=>{const cell=document.createElement('td');cell.textContent=historyValue(read(record));row.append(cell)});body.append(row)});table.append(colgroup,head,body);updateTableWidth(table,cols);wrap.append(table);return wrap}
function commonItem(label,entry){const item=document.createElement('div');item.className='history-common-item';const heading=document.createElement('strong');heading.textContent=label;const value=document.createElement('span');value.textContent=historyValue(entry);item.append(heading,value);return item}
function renderHistoryGroups(records){const groups=new Map();records.forEach(record=>{const key=stableKey(record.experiment)||'__unspecified__';if(!groups.has(key))groups.set(key,{details:stableDetails(record),records:[]});groups.get(key).records.push(record)});const fragment=document.createDocumentFragment();groups.forEach(group=>{const section=document.createElement('section');section.className='history-group';const title=document.createElement('h3');title.textContent=group.details.experiment||'Unspecified experiment';const common=document.createElement('div');common.className='history-common';common.append(commonItem('Permit number',group.details.permit_number),commonItem('Experimenter',group.details.experimenter),commonItem('Contact email',group.details.contact_email),commonItem('Entries',group.records.length));section.append(title,common,renderHistoryTable(group.records));fragment.append(section)});return fragment}
async function loadHistory(animal=null){historyAnimal=animal;returnToHistory=false;document.getElementById('browser').classList.add('hidden');document.getElementById('score').classList.add('hidden');document.getElementById('history').classList.remove('hidden');const list=document.getElementById('historyList');const label=animal?(animal.animal_id||animal.id):'';document.getElementById('historyNew').textContent=label?'Add new entry · '+label:'Add new entry';document.getElementById('historyTitle').textContent=label?'Previous entries · '+label:'Previous entries';const context=label?[animal.cage,animal.strain,animal.genotype].filter(Boolean).join(' · '):'Latest 250 entries grouped by experiment';document.getElementById('historyMeta').textContent=context+' · Drag a column divider to resize it; double-click the divider to reset.';list.textContent='Loading…';try{const animalId=animal?encodeURIComponent(animal.id||animal.animal_id):'';const cage=animal?'':encodeURIComponent(document.getElementById('cage').value);const j=await api('/api/scores?animal_id='+animalId+'&cage='+cage);list.innerHTML='';if(!j.data.length){const empty=document.createElement('div');empty.className='history-empty';empty.textContent='No previous entries found.';list.append(empty);return}list.append(renderHistoryGroups(j.data))}catch(e){list.textContent=e.message}}
if(initialType==='cage')document.getElementById('cage').value=initialId;else if(initialType==='animal')document.getElementById('search').value=initialId;
document.getElementById('unlockBtn').onclick=async()=>{sessionStorage.setItem('pyratScoresheetCode',document.getElementById('code').value);try{const j=await api('/api/status');document.getElementById('mode').textContent=j.data.demo?'Demo mode':'PyRAT';document.getElementById('unlock').classList.add('hidden');document.getElementById('browser').classList.remove('hidden');await load();if(initialView==='history'&&initialType!=='animal'){initialSelectionPending=false;await loadHistory()}}catch(e){sessionStorage.removeItem('pyratScoresheetCode');msg(document.getElementById('unlockMsg'),e.message,'error')}};
document.getElementById('searchBtn').onclick=load;document.getElementById('experimentFilter').onchange=load;document.getElementById('allHistoryBtn').onclick=()=>loadHistory();document.getElementById('animalHistoryBtn').onclick=()=>{if(current)loadHistory(current)};document.getElementById('historyNew').onclick=()=>{if(historyAnimal){openScore(historyAnimal,{backToHistory:true});return}document.getElementById('history').classList.add('hidden');document.getElementById('browser').classList.remove('hidden');document.getElementById('search').focus()};document.getElementById('historyBack').onclick=()=>{historyAnimal=null;document.getElementById('history').classList.add('hidden');document.getElementById('browser').classList.remove('hidden')};document.getElementById('back').onclick=async()=>{if(returnToHistory&&current){await loadHistory(current);return}document.getElementById('score').classList.add('hidden');document.getElementById('browser').classList.remove('hidden')};
document.getElementById('save').onclick=async()=>{if(!current)return;const observer=value('observer');const date=value('scoreDate');const email=document.getElementById('contactEmail');if(!observer){msg(document.getElementById('saveMsg'),'Observer is required.','error');return}if(!date){msg(document.getElementById('saveMsg'),'Date is required.','error');return}if(value('contactEmail')&&!email.checkValidity()){msg(document.getElementById('saveMsg'),'Enter a valid contact email address.','error');return}const payload={animal_id:current.id||current.animal_id,animal_label:current.animal_id||current.id,cage:current.cage,experiment:value('experiment'),permit_number:value('permitNumber'),experimenter:value('experimenter'),contact_email:value('contactEmail'),date,observer,procedure:value('procedure'),weight_g:value('weight')||null,carprofen_sc:value('carprofen'),lidocaine_bupivacaine_sc:value('lidocaineBupivacaine'),buprenorphine_sc:value('buprenorphine'),pain:yes('pain'),infection:yes('infection'),increased_monitoring:yes('increasedMonitoring'),termination_criteria:yes('terminationCriteria'),euthanasia:yes('euthanasia'),total_score:value('totalScore')||null,comments:value('comments')};try{const j=await api('/api/score',{method:'POST',body:JSON.stringify(payload)});cacheStableDetails(payload);msg(document.getElementById('saveMsg'),j.data.demo?'Saved to demo audit file.':'Submitted to PyRAT.','ok');setTimeout(async()=>{if(returnToHistory){await loadHistory(current);return}document.getElementById('score').classList.add('hidden');document.getElementById('browser').classList.remove('hidden');await load()},500)}catch(e){msg(document.getElementById('saveMsg'),e.message,'error')}};
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      res.end(html);
      return;
    }
    if (url.pathname === '/healthz' && req.method === 'GET') {
      json(res, 200, {status: 'ok'});
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      json(res, 404, {error: 'Not found'});
      return;
    }
    if (!authorized(req)) {
      json(res, 401, {error: 'Invalid monitoring access code.'});
      return;
    }
    if (url.pathname === '/api/status' && req.method === 'GET') {
      json(res, 200, {data: {demo: DEMO, connected: DEMO || Boolean(BASE_URL && ANIMALS_PATH), can_view_scores: DEMO || Boolean(SCORES_READ_PATH)}});
      return;
    }
    if (url.pathname === '/api/animals' && req.method === 'GET') {
      const data = await getAnimals({
        q: url.searchParams.get('q') ?? '',
        cage: url.searchParams.get('cage') ?? '',
        experiment: url.searchParams.get('experiment') ?? '',
      });
      json(res, 200, {data});
      return;
    }
    if (url.pathname === '/api/scores' && req.method === 'GET') {
      const data = await getScores({
        animal_id: url.searchParams.get('animal_id') ?? '',
        cage: url.searchParams.get('cage') ?? '',
      });
      json(res, 200, {data});
      return;
    }
    if (url.pathname === '/api/score' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body?.animal_id || !body?.observer) {
        json(res, 422, {error: 'animal_id and observer are required.'});
        return;
      }
      const data = await recordScore(body);
      json(res, 200, {data});
      return;
    }
    json(res, 405, {error: 'Method not allowed'});
  } catch (error) {
    console.error(error);
    json(res, 500, {error: error instanceof Error ? error.message : 'Monitoring portal error'});
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PyRAT scoresheet listening on :${PORT} (${DEMO ? 'demo' : 'live'} mode)`);
});
