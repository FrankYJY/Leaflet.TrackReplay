// Ad-hoc check for the data source panel (import + dataset management):
//   - datasets list: rows (name + count), title count, live refresh from
//     programmatic addDataset() calls, per-row remove, two-click clear
//   - import channels: paste GeoJSON / paste GPX (timed + no-time degrade),
//     file picker, drag & drop, URL, samples
//   - the panel survives rebuilds, expanded state kept
// Usage: node _data_source_check.mjs   (demo server must be on :8000)
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

const OUT = path.join(os.tmpdir(), 'tr-shots-ds2');
const TMP = path.join(os.tmpdir(), 'tr-import-files');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const PANEL = '.leaflet-trackreplay-datasource';
const now = Date.now();

// ---- test payloads ----
const jsonFc = JSON.stringify({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[116.40, 39.90], [116.41, 39.905], [116.42, 39.91]] },
    properties: { isTimestampedgeojson: true, times: [now, now + 20000, now + 40000] },
  }],
});

function gpxTrack(t0, withTime) {
  let pts = '';
  for (let i = 0; i < 5; i++) {
    pts += '<trkpt lat="' + (39.90 + i * 0.002) + '" lon="' + (116.40 + i * 0.002) + '">' +
      (withTime ? '<time>' + new Date(t0 + i * 30000).toISOString() + '</time>' : '') +
      '</trkpt>';
  }
  return '<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>' + pts + '</trkseg></trk></gpx>';
}
const gpxTimed = gpxTrack(now + 60000, true);
const gpxNoTime = gpxTrack(now, false);

fs.writeFileSync(path.join(TMP, 'walk.gpx'), gpxTimed);
const urlJson = 'data:application/json,' + encodeURIComponent(jsonFc);

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'tr-pw-profile'), {
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});
const page = ctx.pages()[0] || await ctx.newPage();
const errs = [];
let phase = 'load';
page.on('pageerror', (e) => errs.push('[' + phase + '] PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
page.on('console', (m) => {
  if (m.type() === 'error' && m.text().indexOf('ERR_TIMED_OUT') < 0 &&
      m.text().indexOf('ERR_CONNECTION') < 0 && m.text().indexOf('Failed to load resource') < 0) {
    errs.push('[' + phase + '] [console] ' + m.text().slice(0, 200));
  }
});

await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction("window.replay && typeof replay.getState === 'function'", null, { timeout: 120000 });
await page.waitForTimeout(3500);

const out = {};
const listState = () => page.evaluate((sel) => ({
  title: document.querySelector(sel + ' .tr-ds-title').textContent,
  rows: [...document.querySelectorAll(sel + ' .tr-ds-dataset-row')].map((r) => ({
    name: r.querySelector('.tr-ds-dataset-name').textContent,
    meta: r.querySelector('.tr-ds-dataset-meta').textContent,
  })),
  empty: !!document.querySelector(sel + ' .tr-ds-empty'),
  report: document.querySelector(sel + ' .tr-ds-report').innerText,
}), PANEL);

// ---- A. structure + initial list (collapsed by default, 1 dataset) ----
phase = 'A structure';
out.structure = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return {
    present: !!el,
    expanded: el ? el.querySelector('.tr-ds-body').style.display !== 'none' : false,
    hasDatasetsSection: !!el.querySelector('.tr-ds-datasets'),
    hasImportSection: !!el.querySelector('.tr-ds-import'),
    hasClearBtn: !!el.querySelector('.tr-ds-clear'),
    samples: [...el.querySelectorAll('.tr-ds-sample')].map((b) => b.textContent),
  };
}, PANEL);
await page.locator(PANEL + ' .tr-ds-title').click(); // collapsed by default — open it
await page.waitForTimeout(200);
out.initialList = await listState();

// ---- B. import channels ----
phase = 'B paste json';
await page.locator(PANEL + ' .tr-ds-paste').fill(jsonFc);
await page.locator(PANEL + ' .tr-ds-row').nth(1).locator('.tr-ds-btn').click();
await page.waitForTimeout(800);
out.afterPasteJson = await listState();
out.pasteJsonObject = await page.evaluate(() => !!replay.allLayers['imported/贴入数据']);

phase = 'B paste no-time gpx';
await page.locator(PANEL + ' .tr-ds-paste').fill(gpxNoTime);
await page.locator(PANEL + ' .tr-ds-row').nth(1).locator('.tr-ds-btn').click();
await page.waitForTimeout(800);
out.noTimeGpx = await page.evaluate(() => {
  const o = replay.allLayers['imported/贴入数据'];
  return {
    staticElement: o ? o.elements.some((e) => e.key === 'static') : false,
    datasets: replay.listDatasets().length,
  };
});
out.noTimeReportShown = (await listState()).report.indexOf('静态线') >= 0;

phase = 'B file picker';
await page.locator(PANEL + ' .tr-ds-file').setInputFiles(path.join(TMP, 'walk.gpx'));
await page.waitForTimeout(900);
out.fileGpx = await page.evaluate(() => ({
  present: !!replay.allLayers['imported/walk'],
  indicators: replay.movingIndicators.length,
}));

phase = 'B drop';
out.dropOverlay = await page.evaluate((content) => {
  const container = map.getContainer();
  const dt = new DataTransfer();
  dt.items.add(new File([content], 'dropped.geojson', { type: 'application/json' }));
  container.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const shown = document.querySelector('.tr-ds-dropoverlay').style.display !== 'none';
  container.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return { shownDuringDrag: shown };
}, jsonFc);
await page.waitForTimeout(900);
out.drop = await page.evaluate(() => ({
  present: !!replay.allLayers['imported/dropped'],
  overlayHidden: document.querySelector('.tr-ds-dropoverlay').style.display === 'none',
}));

phase = 'B url + samples';
await page.locator(PANEL + ' .tr-ds-url').fill(urlJson);
await page.locator(PANEL + ' .tr-ds-row').nth(2).locator('.tr-ds-btn').click();
await page.waitForTimeout(900);
await page.locator(PANEL + ' .tr-ds-sample').first().click();
await page.waitForTimeout(700);
await page.locator(PANEL + ' .tr-ds-sample').nth(1).click();
await page.waitForTimeout(700);
out.samples = await page.evaluate(() => ({
  track: !!replay.allLayers['导入/示例轨迹'],
  bg: !!replay.allLayers['导入/示例采样点'],
  datasets: replay.listDatasets().length,
}));

// ---- C. management: live refresh, per-row remove, two-click clear ----
phase = 'C console add refreshes list';
out.consoleAddRefresh = await page.evaluate(() => {
  var before = document.querySelectorAll('.leaflet-trackreplay-datasource .tr-ds-dataset-row').length;
  replay.addDataset({ type: 'FeatureCollection', features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [116.40, 39.90] },
    properties: { layerPath: ['console', 'note'], popup: 'console 添加' },
  }] }, { name: '控制台添加' });
  var after = document.querySelectorAll('.leaflet-trackreplay-datasource .tr-ds-dataset-row').length;
  return { before: before, after: after };
});

phase = 'C remove one row';
out.removeRow = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.leaflet-trackreplay-datasource .tr-ds-dataset-row')];
  const target = rows.find((r) => r.querySelector('.tr-ds-dataset-name').textContent === '控制台添加');
  if (!target) { return { error: 'row not found' }; }
  target.querySelector('.tr-ds-remove').click();
  return {
    rowGone: ![...document.querySelectorAll('.leaflet-trackreplay-datasource .tr-ds-dataset-row')]
      .some((r) => r.querySelector('.tr-ds-dataset-name').textContent === '控制台添加'),
    objectGone: !replay.allLayers['console/note'],
    count: replay.listDatasets().length,
  };
});

phase = 'C clear (two clicks)';
out.clearTwoClick = await page.evaluate(() => {
  const btn = document.querySelector('.leaflet-trackreplay-datasource .tr-ds-clear');
  btn.click(); // arm
  const armedText = btn.textContent;
  btn.click(); // confirm
  return {
    armedText: armedText,
    datasets: replay.listDatasets().length,
    emptyLabelShown: !!document.querySelector('.leaflet-trackreplay-datasource .tr-ds-empty'),
    title: document.querySelector('.leaflet-trackreplay-datasource .tr-ds-title').textContent,
    layersGone: Object.keys(replay.allLayers).length === 0,
  };
});
await page.screenshot({ path: path.join(OUT, '1-cleared.png') });

phase = 'C re-import after clear';
await page.locator(PANEL + ' .tr-ds-sample').first().click();
await page.waitForTimeout(800);
out.reimport = await page.evaluate(() => ({
  datasets: replay.listDatasets().length,
  rowCount: document.querySelectorAll('.leaflet-trackreplay-datasource .tr-ds-dataset-row').length,
  objectBack: !!replay.allLayers['导入/示例轨迹'],
}));

// ---- D. panel survived all rebuilds ----
out.final = await listState();
out.finalExpanded = await page.evaluate((sel) =>
  document.querySelector(sel).querySelector('.tr-ds-body').style.display !== 'none', PANEL);
await page.screenshot({ path: path.join(OUT, '2-final.png') });

console.log(JSON.stringify({ out, errs, shots: OUT }, null, 1));
await ctx.close();
