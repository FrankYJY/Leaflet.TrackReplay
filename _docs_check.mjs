// _docs_check.mjs — keep the user docs true to the source.
//
// Maintenance protocol:
//   1. Edit the canonical file (docs/*.zh.md — Chinese).
//   2. Run `node _docs_check.mjs`. It checks the mirrors, the code blocks,
//      the option/method/event inventories, the Python recipes, the version
//      pins and the self-containedness of the LLM prompt packs.
//   3. Update docs/*.en.md until the check is green, then commit both.
//
// Usage:
//   node _docs_check.mjs           # fast, offline, no browser
//   node _docs_check.mjs --smoke   # also run the Hello World example locally
//
// Requires a built dist/ for --smoke (`npm run build`). The smoke test uses
// the vendored Leaflet in examples/vendor and never touches the network.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes('--smoke');

const FILES = {
  packZh: 'docs/LLM-PROMPT.zh.md',
  packEn: 'docs/LLM-PROMPT.en.md',
  usageZh: 'docs/HUMAN-USAGE.zh.md',
  usageEn: 'docs/HUMAN-USAGE.en.md',
  pythonZh: 'docs/python-host/GUIDE.zh.md',
  pythonEn: 'docs/python-host/GUIDE.en.md',
  readme: 'README.md',
  readmeZh: 'docs/README.zh-CN.md',
  source: 'src/TrackReplay.js',
  pkg: 'package.json',
};

const checks = [];
function check(id, ok, detail) {
  checks.push({ id, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); }

// ---- helpers -------------------------------------------------------------

function between(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) { return null; }
  const b = text.indexOf(end, a + start.length);
  if (b < 0) { return null; }
  return text.slice(a + start.length, b);
}

function extractBlock(text, name) {
  const start = '<!-- BEGIN ' + name + ' -->';
  const end = '<!-- END ' + name + ' -->';
  const body = between(text, start, end);
  if (body === null) { return null; }
  // Normalise line endings, trailing whitespace and the blank lines that
  // separate the fence from the markers.
  const lines = body.split('\n').map(function (l) { return l.replace(/\s+$/, ''); });
  while (lines.length && lines[0] === '') { lines.shift(); }
  while (lines.length && lines[lines.length - 1] === '') { lines.pop(); }
  return lines.join('\n');
}

function fenceContent(block, lang) {
  const m = block && block.match(new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```'));
  return m ? m[1] : null;
}

function tableNames(block) {
  // First backticked token of each table row: `name` or `name(args)`.
  const re = /^\|\s*`([A-Za-z][A-Za-z0-9_]*)(?:\([^`]*\))?`/gm;
  const out = [];
  let m;
  while ((m = re.exec(block))) { out.push(m[1]); }
  return out;
}

function sortedUnique(arr) { return Array.from(new Set(arr)).sort(); }

function diffSets(actual, expected) {
  const a = new Set(actual);
  const e = new Set(expected);
  const missing = expected.filter(function (x) { return !a.has(x); });
  const extra = actual.filter(function (x) { return !e.has(x); });
  return { missing, extra };
}

function coverage(actual, expected) {
  const a = new Set(actual);
  return expected.filter(function (x) { return a.has(x); });
}

// ---- 1. option inventory -------------------------------------------------

const source = read(FILES.source);
const pkg = JSON.parse(read(FILES.pkg));
const packZh = read(FILES.packZh);
const packEn = read(FILES.packEn);
const usageZh = read(FILES.usageZh);
const usageEn = read(FILES.usageEn);
const pythonZh = read(FILES.pythonZh);
const pythonEn = read(FILES.pythonEn);
const readme = read(FILES.readme);
const readmeZh = fs.existsSync(path.join(ROOT, FILES.readmeZh)) ? read(FILES.readmeZh) : '';

const jsdocOptions = [];
{
  const block = between(source, '* @param {Object} [options]', '* @returns {Object} internal handle');
  const re = /@param\s+\{[^}]*\}\s+\[options\.([A-Za-z0-9_]+)/g;
  let m;
  while (block && (m = re.exec(block))) { jsdocOptions.push(m[1]); }
}

const packOptionsBlock = between(packZh, '<!-- BEGIN OPTIONS -->', '<!-- END OPTIONS -->') ||
  between(packEn, '<!-- BEGIN OPTIONS -->', '<!-- END OPTIONS -->');
const packOptions = packOptionsBlock ? tableNames(packOptionsBlock) : [];

const readmeOptionsBlock = between(readme, '#### Options', '#### Per-element layers');
const readmeOptions = readmeOptionsBlock ? tableNames(readmeOptionsBlock) : [];

{
  const d = diffSets(packOptions, jsdocOptions);
  check('options-inventory',
    jsdocOptions.length === 68 && d.missing.length === 0 && d.extra.length === 0,
    'jsdoc=' + jsdocOptions.length + ' pack=' + packOptions.length +
    (d.missing.length ? ' missing=' + d.missing.join(',') : '') +
    (d.extra.length ? ' extra=' + d.extra.join(',') : ''));
}
{
  const d = diffSets(readmeOptions, jsdocOptions);
  check('readme-options-inventory',
    readmeOptions.length === jsdocOptions.length && d.missing.length === 0 && d.extra.length === 0,
    'readme=' + readmeOptions.length + ' jsdoc=' + jsdocOptions.length +
    (d.missing.length ? ' missing=' + d.missing.join(',') : '') +
    (d.extra.length ? ' extra=' + d.extra.join(',') : ''));
}

// ---- 2. method inventory -------------------------------------------------

let facadeMethods = [];
{
  const block = between(source, 'var instance = {', '// ---- Initial datasets');
  const re = /^\s{4}([A-Za-z][A-Za-z0-9_]*): function/gm;
  let m;
  while (block && (m = re.exec(block))) { facadeMethods.push(m[1]); }
}

const packMethodsBlock = between(packZh, '<!-- BEGIN METHODS -->', '<!-- END METHODS -->') ||
  between(packEn, '<!-- BEGIN METHODS -->', '<!-- END METHODS -->');
const packMethods = packMethodsBlock ? tableNames(packMethodsBlock) : [];

const readmeMethodsBlock = between(readme, '#### Instance Methods', '#### Events');
const readmeMethods = readmeMethodsBlock ? tableNames(readmeMethodsBlock) : [];

{
  const d = diffSets(packMethods, facadeMethods);
  check('methods-inventory',
    facadeMethods.length === 25 && d.missing.length === 0 && d.extra.length === 0,
    'facade=' + facadeMethods.length + ' pack=' + packMethods.length +
    (d.missing.length ? ' missing=' + d.missing.join(',') : '') +
    (d.extra.length ? ' extra=' + d.extra.join(',') : ''));
}
{
  const d = diffSets(readmeMethods, facadeMethods);
  check('readme-methods-inventory',
    d.missing.length === 0 && d.extra.length === 0,
    'readme=' + readmeMethods.length + ' facade=' + facadeMethods.length +
    (d.missing.length ? ' missing=' + d.missing.join(',') : '') +
    (d.extra.length ? ' extra=' + d.extra.join(',') : ''));
}

// ---- 3. events -----------------------------------------------------------

const sourceEvents = [];
{
  const m = source.match(/var PLAYBACK_EVENTS = \[([^\]]+)\]/);
  if (m) {
    const re = /'([A-Za-z]+)'/g;
    let e;
    while ((e = re.exec(m[1]))) { sourceEvents.push(e[1]); }
  }
  const re = /bus\.emit\('([A-Za-z]+)'/g;
  let e;
  while ((e = re.exec(source))) { sourceEvents.push(e[1]); }
}
// The pack's event table follows the "### 6.4" heading, before section 7.
const packEventsBlock = between(packZh, '### 6.4', '## 7.') ||
  between(packEn, '### 6.4', '## 7.');
const packEvents = packEventsBlock ? tableNames(packEventsBlock) : [];
{
  const d = diffSets(packEvents, sourceEvents);
  check('events-inventory',
    sourceEvents.length === 10 && d.missing.length === 0 && d.extra.length === 0,
    'source=' + sourceEvents.length + ' pack=' + packEvents.length +
    (d.missing.length ? ' missing=' + d.missing.join(',') : '') +
    (d.extra.length ? ' extra=' + d.extra.join(',') : ''));
}

// ---- 4. bilingual structure & code blocks --------------------------------

function h2Numbers(text) {
  const re = /^## (\d+)\./gm;
  const out = [];
  let m;
  while ((m = re.exec(text))) { out.push(Number(m[1])); }
  return out;
}

for (const pair of [['pack', packZh, packEn], ['usage', usageZh, usageEn], ['python-host', pythonZh, pythonEn]]) {
  const a = h2Numbers(pair[1]);
  const b = h2Numbers(pair[2]);
  check('bilingual-sections-' + pair[0],
    a.length > 0 && a.join(',') === b.join(','),
    'zh=[' + a.join(',') + '] en=[' + b.join(',') + ']');
}

const hello = {
  packZh: extractBlock(packZh, 'HELLO-WORLD'),
  packEn: extractBlock(packEn, 'HELLO-WORLD'),
  usageZh: extractBlock(usageZh, 'HELLO-WORLD'),
  usageEn: extractBlock(usageEn, 'HELLO-WORLD'),
};
{
  const values = Object.keys(hello).map(function (k) { return hello[k]; });
  const ok = values.every(function (v) { return v !== null; }) &&
    values.every(function (v) { return v === values[0]; });
  check('hello-world-identical', ok,
    Object.keys(hello).map(function (k) { return k + '=' + (hello[k] === null ? 'missing' : hello[k].length); }).join(' '));
}

const jsonExample = {
  packZh: extractBlock(packZh, 'JSON-EXAMPLE'),
  packEn: extractBlock(packEn, 'JSON-EXAMPLE'),
};
{
  const ok = jsonExample.packZh !== null && jsonExample.packZh === jsonExample.packEn;
  let parsed = null;
  try { parsed = JSON.parse(jsonExample.packZh.replace(/^```json\n|\n```$/g, '')); } catch (e) { /* reported below */ }
  check('json-example-identical', ok, 'zh=' + (jsonExample.packZh || '').length + ' en=' + (jsonExample.packEn || '').length);
  check('json-example-valid', !!parsed && parsed.type === 'FeatureCollection', parsed ? 'features=' + parsed.features.length : 'parse failed');
}

const pythonBlock = {
  packZh: extractBlock(packZh, 'PYTHON'),
  packEn: extractBlock(packEn, 'PYTHON'),
};
{
  const ok = pythonBlock.packZh !== null && pythonBlock.packZh === pythonBlock.packEn;
  check('python-block-identical', ok, 'zh=' + (pythonBlock.packZh || '').length + ' en=' + (pythonBlock.packEn || '').length);
}

// The Python host guide's runnable blocks must match across languages.
for (const name of ['PYAPP', 'PYTEMPLATE']) {
  const zh = extractBlock(pythonZh, name);
  const en = extractBlock(pythonEn, name);
  check('python-host-block-' + name.toLowerCase(),
    zh !== null && zh === en,
    'zh=' + (zh || '').length + ' en=' + (en || '').length);
}

// Every Python fence in the Python host guide must at least compile.
{
  const re = /```python\n([\s\S]*?)\n```/g;
  const blocks = [];
  let m;
  while ((m = re.exec(pythonZh))) { blocks.push(m[1]); }
  let ok = blocks.length > 0;
  const detail = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-pyhost-'));
  try {
    for (let i = 0; i < blocks.length; i++) {
      const file = path.join(dir, 'block' + i + '.py');
      try {
        fs.writeFileSync(file, blocks[i] + '\n');
        execFileSync('python', ['-I', '-m', 'py_compile', file], { encoding: 'utf8', timeout: 30000 });
      } catch (e) {
        ok = false;
        detail.push('block' + i + ': ' + String(e.stderr || e.message).slice(0, 160));
      }
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  check('python-host-blocks-compile', ok, ok ? 'blocks=' + blocks.length : detail.join('; '));
}

// ---- 5. version pins -----------------------------------------------------

{
  const re = /leaflet-trackreplay@(\d+\.\d+\.\d+)/g;
  const found = [];
  for (const text of [packZh, packEn, usageZh, usageEn]) {
    let m;
    while ((m = re.exec(text))) { found.push(m[1]); }
  }
  const wrong = found.filter(function (v) { return v !== pkg.version; });
  check('version-pins', found.length > 0 && wrong.length === 0,
    'package=' + pkg.version + ' doc pins=' + sortedUnique(found).join(',') + ' wrong=' + wrong.length);
}
{
  const heads = [packZh, packEn].map(function (t) { return t.split('\n').slice(0, 6).join('\n'); });
  const ok = heads.every(function (h) { return h.indexOf('v' + pkg.version) >= 0; });
  check('pack-version-heading', ok, 'expected v' + pkg.version);
}

// ---- 6. the pack is self-contained --------------------------------------

{
  const forbidden = ['README', '../', 'examples/', 'localhost'];
  const hits = [];
  for (const text of [packZh, packEn]) {
    for (const token of forbidden) {
      if (text.indexOf(token) >= 0) { hits.push(token); }
    }
  }
  check('pack-self-contained', hits.length === 0, hits.length ? 'found: ' + sortedUnique(hits).join(',') : 'ok');
}

// ---- 7. the Python recipe actually runs ---------------------------------

let pythonOut = null;
{
  let ok = false;
  let detail = '';
  const block = pythonBlock.packZh;
  const m = block && block.match(/```python\n([\s\S]*?)\n```/);
  if (!m) {
    detail = 'no python fence found';
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-docs-'));
    const file = path.join(dir, 'recipe.py');
    try {
      fs.writeFileSync(file, m[1] + '\n');
      const stdout = execFileSync('python', ['-I', file], { encoding: 'utf8', timeout: 30000 });
      pythonOut = JSON.parse(stdout);
      const problems = [];
      if (pythonOut.type !== 'FeatureCollection') { problems.push('not a FeatureCollection'); }
      const feats = pythonOut.features || [];
      if (!feats.length) { problems.push('no features'); }
      for (const f of feats) {
        if (!f.properties || !f.properties.isTimestampedgeojson) { continue; }
        const coords = (f.geometry && f.geometry.coordinates) || [];
        const props = f.properties;
        if (!f.geometry || f.geometry.type !== 'LineString') { problems.push('not a LineString'); }
        if (!Array.isArray(props.layerPath)) { problems.push('layerPath not an array'); }
        if (coords.length < 2) { problems.push('fewer than 2 points'); }
        if (!Array.isArray(props.times) || props.times.length !== coords.length) { problems.push('times length mismatch'); }
        if (props.times && props.times.some(function (t) { return t <= 1e12; })) { problems.push('times not in ms'); }
        if (props.times && props.times.some(function (t, i, a) { return i > 0 && t <= a[i - 1]; })) { problems.push('times not ascending'); }
        for (const c of coords) {
          if (!Array.isArray(c) || c.length !== 2) { problems.push('bad coordinate'); break; }
          if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) { problems.push('coordinate out of range'); break; }
        }
        for (const key of ['speeds', 'styles', 'popups']) {
          if (Array.isArray(props[key]) && props[key].length !== coords.length - 1) { problems.push(key + ' length != n-1'); }
        }
        if (Array.isArray(props.pointPopups) && props.pointPopups.length !== coords.length) { problems.push('pointPopups length != n'); }
      }
      ok = problems.length === 0;
      detail = problems.length ? problems.join('; ') : 'ok, features=' + feats.length;
    } catch (e) {
      detail = String(e && e.message ? e.message : e).slice(0, 300);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  }
  check('python-recipe-runs', ok, detail);
}

// ---- 8. Chinese README stays a faithful mirror --------------------------

function allFences(text) {
  const re = /^```([A-Za-z0-9_-]*)\n([\s\S]*?)\n```$/gm;
  const out = [];
  let m;
  while ((m = re.exec(text))) { out.push({ lang: m[1], body: m[2] }); }
  return out;
}

function countHeadings(text, level) {
  const re = new RegExp('^' + '#'.repeat(level) + ' ', 'gm');
  return (text.match(re) || []).length;
}

function backtickedRowCount(text) {
  const re = /^\|\s*`[A-Za-z]/gm;
  return (text.match(re) || []).length;
}

{
  const en = allFences(readme);
  const zh = allFences(readmeZh);
  const same = zh.length > 0 && zh.length === en.length &&
    zh.every(function (b, i) { return b.lang === en[i].lang && b.body === en[i].body; });
  check('readme-zh-code-blocks', same, 'en=' + en.length + ' zh=' + zh.length);
}
{
  const en2 = countHeadings(readme, 2);
  const zh2 = countHeadings(readmeZh, 2);
  const en3 = countHeadings(readme, 3);
  const zh3 = countHeadings(readmeZh, 3);
  check('readme-zh-structure', en2 === zh2 && en3 === zh3,
    'H2 en/zh=' + en2 + '/' + zh2 + ' H3 en/zh=' + en3 + '/' + zh3);
}
{
  const enRows = backtickedRowCount(readme);
  const zhRows = backtickedRowCount(readmeZh);
  check('readme-zh-table-rows', enRows === zhRows && enRows > 0,
    'en=' + enRows + ' zh=' + zhRows);
}
{
  const ok = readme.indexOf('[简体中文](docs/README.zh-CN.md)') >= 0 &&
    readmeZh.indexOf('[English](../README.md)') >= 0;
  check('readme-language-switch', ok, ok ? 'ok' : 'switch line missing');
}

// ---- 9. every relative link in the docs resolves ------------------------

{
  const files = [FILES.readme, FILES.readmeZh, FILES.usageZh, FILES.usageEn,
    FILES.pythonZh, FILES.pythonEn, FILES.packZh, FILES.packEn];
  const missing = [];
  let total = 0;
  for (const rel of files) {
    if (!fs.existsSync(path.join(ROOT, rel))) { continue; }
    const text = read(rel);
    const re = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(text))) {
      let link = m[1].trim().replace(/^<|>$/g, '');
      if (/^https?:|^mailto:|^#/.test(link)) { continue; }
      let file = link.split('#')[0];
      try { file = decodeURIComponent(file); } catch (e) { /* keep as-is */ }
      if (!file) { continue; }
      total++;
      if (!fs.existsSync(path.resolve(ROOT, path.dirname(rel), file))) {
        missing.push(rel + ' -> ' + link);
      }
    }
  }
  check('relative-links-resolve', missing.length === 0,
    'checked=' + total + (missing.length ? ' missing=' + missing.join('; ') : ''));
}

// ---- 10. optional: Hello World smoke test -------------------------------

if (SMOKE) {
  let ok = false;
  let detail = '';
  const distJs = path.join(ROOT, 'dist', 'leaflet-trackreplay.iife.js');
  const distCss = path.join(ROOT, 'dist', 'leaflet-trackreplay.css');
  const leafletJs = path.join(ROOT, 'examples', 'vendor', 'leaflet.js');
  const leafletCss = path.join(ROOT, 'examples', 'vendor', 'leaflet.css');

  if (!fs.existsSync(distJs) || !fs.existsSync(distCss)) {
    detail = 'dist not built — run `npm run build` first';
  } else if (!fs.existsSync(leafletJs)) {
    detail = 'examples/vendor/leaflet.js not found';
  } else {
    let html = fenceContent(hello.packZh, 'html');
    if (!html) { throw new Error('HELLO-WORLD has no ```html fence'); }
    html = html.replace(/https:\/\/unpkg\.com\/leaflet@[^"]+\/leaflet\.css/g, 'examples/vendor/leaflet.css');
    html = html.replace(/https:\/\/unpkg\.com\/leaflet-trackreplay@[^"]+\/leaflet-trackreplay\.css/g, 'dist/leaflet-trackreplay.css');
    html = html.replace(/https:\/\/unpkg\.com\/leaflet@[^"]+\/leaflet\.js/g, 'examples/vendor/leaflet.js');
    html = html.replace(/https:\/\/unpkg\.com\/leaflet-trackreplay@[^"]+\/leaflet-trackreplay\.iife\.js/g, 'dist/leaflet-trackreplay.iife.js');
    // No network in the check: drop the OSM tile layer.
    html = html.split('\n').filter(function (l) { return l.indexOf('tileLayer(') < 0; }).join('\n');

    const tmp = path.join(ROOT, '.tr-docs-smoke.html');
    try {
      fs.writeFileSync(tmp, html);
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errs = [];
      page.on('pageerror', function (e) { errs.push(String(e)); });
      page.on('console', function (m) { if (m.type() === 'error') { errs.push(m.text()); } });
      await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
      const state = await page.evaluate(function () {
        replay.stop();
        replay.play();
        return {
          playing: replay.getState(),
          datasets: replay.listDatasets().length,
          layers: Object.keys(replay.allLayers),
          time: replay.getCurrentTime(),
        };
      });
      ok = errs.length === 0 && state.playing === 'playing' &&
        state.datasets === 1 && state.layers.indexOf('demo/track1') >= 0 &&
        typeof state.time === 'number';
      detail = 'errs=' + JSON.stringify(errs) + ' state=' + JSON.stringify(state);
      await browser.close();
    } catch (e) {
      detail = String(e && e.message ? e.message : e).slice(0, 400);
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    }
  }
  check('hello-world-smoke', ok, detail);
}

// ---- report --------------------------------------------------------------

const failed = checks.filter(function (c) { return !c.ok; });
const report = {
  ok: failed.length === 0,
  summary: { passed: checks.length - failed.length, failed: failed.length },
  checks: checks,
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = failed.length === 0 ? 0 : 1;
