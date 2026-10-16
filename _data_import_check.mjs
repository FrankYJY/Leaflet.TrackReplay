// Ad-hoc check for the data import panel (phase 2):
//   - paste GeoJSON (auto layerPath) / paste GPX (timed + no-time degrade)
//   - file picker (real .gpx file) / drag & drop (synthetic DragEvent)
//   - URL flow (data: URL success + bogus URL error report)
//   - sample buttons (输入案例)
//   - the panel survives rebuilds and stays expanded
// Usage: node _data_import_check.mjs   (demo server must be on :8000)
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

const OUT = path.join(os.tmpdir(), 'tr-shots-import');
const TMP = path.join(os.tmpdir(), 'tr-import-files');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const PANEL = '.leaflet-trackreplay-dataimport';
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
fs.writeFileSync(path.join(TMP, 'traj.geojson'), jsonFc);

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
const panelInfo = () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return {
    present: !!el,
    expanded: el ? el.querySelector('.tr-di-body').style.display !== 'none' : false,
    report: el ? el.querySelector('.tr-di-report').innerText : '',
  };
}, PANEL);

phase = 'structure';
out.structure = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) { return { present: false }; }
  return {
    present: true,
    hasFileInput: !!el.querySelector('input[type=file]'),
    hasTextarea: !!el.querySelector('.tr-di-paste'),
    hasUrl: !!el.querySelector('.tr-di-url'),
    samples: [...el.querySelectorAll('.tr-di-sample')].map((b) => b.textContent),
    collapsedByDefault: el.querySelector('.tr-di-body').style.display === 'none',
  };
}, PANEL);

await page.locator(PANEL + ' .tr-di-title').click(); // expand

// ---- 1. paste GeoJSON (no layerPath -> auto-assigned) ----
phase = 'paste json';
await page.locator(PANEL + ' .tr-di-paste').fill(jsonFc);
await page.locator(PANEL + ' .tr-di-row').nth(1).locator('.tr-di-btn').click();
await page.waitForTimeout(800);
out.pasteJson = await page.evaluate(() => ({
  datasets: replay.listDatasets().length,
  objectPresent: !!replay.allLayers['imported/贴入数据'],
  elementKeys: replay.allLayers['imported/贴入数据']
    ? replay.allLayers['imported/贴入数据'].elements.map((e) => e.key) : [],
}));
out.pasteJsonReport = (await panelInfo()).report;

// ---- 2. paste no-time GPX -> static line + degraded hint ----
phase = 'paste gpx no-time';
await page.locator(PANEL + ' .tr-di-paste').fill(gpxNoTime);
await page.locator(PANEL + ' .tr-di-row').nth(1).locator('.tr-di-btn').click();
await page.waitForTimeout(800);
out.pasteGpxNoTime = await page.evaluate(() => {
  const o = replay.allLayers['imported/贴入数据'];
  return {
    datasets: replay.listDatasets().length,
    elementKeys: o ? o.elements.map((e) => e.key) : [],
    // the static-line feature must NOT be a replayable track feature
    hasTimestampFeature: o ? o.timestampFeatures.length > 0 : null,
  };
});
out.pasteGpxNoTimeReport = (await panelInfo()).report.slice(-200);

// ---- 3. file picker with a real timed .gpx ----
phase = 'file picker gpx';
await page.locator(PANEL + ' input[type=file]').setInputFiles(path.join(TMP, 'walk.gpx'));
await page.waitForTimeout(900);
out.fileGpx = await page.evaluate(() => {
  const o = replay.allLayers['imported/walk'];
  return {
    datasets: replay.listDatasets().length,
    objectPresent: !!o,
    tracked: o ? o.timestampFeatures.length : 0,
    indicators: replay.movingIndicators.length,
  };
});

// ---- 4. drag & drop onto the map (synthetic DragEvent) ----
phase = 'drop';
out.dropOverlay = await page.evaluate((content) => {
  const container = map.getContainer();
  const dt = new DataTransfer();
  dt.items.add(new File([content], 'dropped.geojson', { type: 'application/json' }));
  container.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const shown = document.querySelector('.tr-di-dropoverlay').style.display !== 'none';
  container.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return { shownDuringDrag: shown };
}, jsonFc);
await page.waitForTimeout(900);
out.drop = await page.evaluate(() => ({
  datasets: replay.listDatasets().length,
  objectPresent: !!replay.allLayers['imported/dropped'],
  overlayHiddenAfterDrop: document.querySelector('.tr-di-dropoverlay').style.display === 'none',
}));

// ---- 5. URL flow: data: URL (success) + bogus URL (error report) ----
phase = 'url';
await page.locator(PANEL + ' .tr-di-url').fill(urlJson);
await page.locator(PANEL + ' .tr-di-row').nth(2).locator('.tr-di-btn').click();
await page.waitForTimeout(900);
out.urlData = await page.evaluate(() => ({ datasets: replay.listDatasets().length }));

await page.locator(PANEL + ' .tr-di-url').fill('http://127.0.0.1:9/nothing.geojson');
await page.locator(PANEL + ' .tr-di-row').nth(2).locator('.tr-di-btn').click();
await page.waitForTimeout(1200);
out.urlErrorReport = (await panelInfo()).report.slice(-160);

// ---- 6. samples (输入案例) ----
phase = 'samples';
await page.locator(PANEL + ' .tr-di-sample').first().click();
await page.waitForTimeout(800);
await page.locator(PANEL + ' .tr-di-sample').nth(1).click();
await page.waitForTimeout(800);
out.samples = await page.evaluate(() => ({
  track: !!replay.allLayers['导入/示例轨迹'],
  trackHasIndicator: replay.allLayers['导入/示例轨迹']
    ? replay.allLayers['导入/示例轨迹'].elements.some((e) => e.key === 'indicator') : false,
  bg: !!replay.allLayers['导入/示例采样点'],
  bgElement: replay.allLayers['导入/示例采样点']
    ? replay.allLayers['导入/示例采样点'].elements.some((e) => e.key === 'background_nodes') : false,
  datasets: replay.listDatasets().length,
}));

// ---- 7. panel survives rebuilds, still expanded ----
out.afterAll = await panelInfo();
await page.screenshot({ path: path.join(OUT, '1-import.png') });

// timeline extended by the imported timed data?
out.timeline = await page.evaluate(() => ({
  endTime: replay.timeEngine._endTime,
  nowish: Date.now(),
}));

console.log(JSON.stringify({ out, errs, shots: OUT }, null, 1));
await ctx.close();
