// Ad-hoc check for the dataset session (phase 1):
//   - three startup shapes: single FC / FC[] / empty + addDataset
//   - addDataset: merges by layerPath, extends the time range, emits the event
//   - removeDataset: removes exactly that dataset's parts, restores the range
//   - clearDatasets: empties the session (no build), stays usable
//   - state survives every rebuild: time, run state, speed, loop, per-element
//     visibility, checked label cells, cluster mode, follow mode
//   - the event bus is stable across rebuilds (playback + dataset events)
// Usage: node _datasets_check.mjs   (demo server must be on :8000)
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

const OUT = path.join(os.tmpdir(), 'tr-shots-ds');
fs.mkdirSync(OUT, { recursive: true });

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
      m.text().indexOf('ERR_CONNECTION') < 0) {
    errs.push('[' + phase + '] [console] ' + m.text().slice(0, 200));
  }
});

await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(
  "window.replay && typeof replay.getState === 'function' && Object.keys(replay.allLayers).length > 0",
  null, { timeout: 120000 }
);
await page.waitForTimeout(3500);

// helpers in page context: synthetic datasets + event capture
await page.evaluate(() => {
  window.__dsEvents = [];
  ['datasetadd', 'datasetremove', 'datasetsclear'].forEach((evt) => {
    replay.on(evt, (d) => window.__dsEvents.push({ evt: evt, data: d }));
  });
  window.__ticks = 0;
  replay.on('tick', () => { window.__ticks++; });

  window.__mkSeq = function (layerPath, t0, n, tag) {
    var coords = [], times = [], popups = [];
    for (var i = 0; i < n; i++) {
      coords.push([116.40 + i * 0.001, 39.90 + i * 0.001]);
      times.push(t0 + i * 30000);
      popups.push(tag + ' point ' + i);
    }
    return { type: 'FeatureCollection', features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        layerPath: layerPath, isTimestampedgeojson: true, times: times,
        pointPopups: popups, drawMovingIndicator: true,
      },
    }] };
  };
  window.__mkBg = function (layerPath, n, tag) {
    var coords = [], popups = [];
    for (var i = 0; i < n; i++) {
      coords.push([116.395 + i * 0.0005, 39.895 + i * 0.0005]);
      popups.push(tag + ' #' + i);
    }
    return { type: 'FeatureCollection', features: [{
      type: 'Feature',
      geometry: { type: 'MultiPoint', coordinates: coords },
      properties: { layerPath: layerPath, element: 'background_nodes', popups: popups },
    }] };
  };
});

const out = {};
phase = 'A: simple entry + preserved add';

// ---- A1. simple entry shape ----
out.initial = await page.evaluate(() => ({
  datasetCount: replay.listDatasets().length,
  names: replay.listDatasets().map((d) => d.name),
  hasApi: ['addDataset', 'removeDataset', 'clearDatasets', 'listDatasets', 'getDataset']
    .every((m) => typeof replay[m] === 'function'),
  hasContainerExport: !!(L.TrackReplay.Core.DatasetContainer && L.TrackReplay.Core.DatasetContainer.createDatasetContainer),
  controlBar: !!document.querySelector('.leaflet-trackreplay-controlbar'),
}));

// ---- A2. set up a distinctive state, then add a dataset ----
out.before = await page.evaluate(() => {
  var mid = replay.parsed.timeMin + (replay.parsed.timeMax - replay.parsed.timeMin) * 0.4;
  replay.seek(mid);
  replay.setSpeed(4);
  replay.setLoop(true);
  // hide the 'events' element type for every object
  var row = replay.elementToggles._rows.find(function (r) { return r.key === 'events'; });
  replay.elementToggles._setAll(row, false);
  // check the 基站 batch-label cell
  var rowIdx = replay.infoLabels._rows.findIndex(function (r) { return r.label.indexOf('基站') >= 0; });
  var colIdx = replay.infoLabels._columns.findIndex(function (c) { return c.key === 'background_nodes'; });
  var tr = document.querySelectorAll('.leaflet-trackreplay-infolabels .tr-il-row')[rowIdx];
  tr.querySelectorAll('td.tr-il-cell')[colIdx].querySelector('input').click();
  // follow the latest indicator
  replay.viewFollow.setMode('latest');
  // switch background nodes to clustered
  var cs = document.querySelector('.leaflet-trackreplay-clusterscatter');
  cs.querySelectorAll('input[type=radio]').forEach(function (r) {
    if (r.value === 'cluster') { r.click(); }
  });
  return {
    time: replay.getCurrentTime(),
    endTime: replay.timeEngine._endTime,
    state: replay.getState(),
  };
});
await page.waitForTimeout(800);

out.afterAdd = await page.evaluate(() => {
  var t0 = replay.parsed.timeMax + 60000; // just after the existing range
  window.__addedId = replay.addDataset(window.__mkSeq(['test', 'seq1'], t0, 5, 'seq'), { name: '追加序列' });
  return {
    id: window.__addedId,
    datasetCount: replay.listDatasets().length,
    names: replay.listDatasets().map(function (d) { return d.name; }),
    newObjectPresent: !!replay.allLayers['test/seq1'],
    toggleRows: replay.elementToggles._rows.map(function (r) { return r.key; }),
    endTime: replay.timeEngine._endTime,
    time: replay.getCurrentTime(),
    state: replay.getState(),
    speed: replay.getSpeed(),
    loop: replay.getLoop(),
    eventsHidden: replay.allLayers['visitor/Bee'].elements
      .filter(function (e) { return e.key === 'events'; })
      .every(function (e) { return !replay.map.hasLayer(e.layer); }),
    labelCellChecked: replay.infoLabels.getCheckedCells()
      .some(function (c) { return c.rowKey === 'background/基站' && c.elementKey === 'background_nodes'; }),
    followMode: replay.viewFollow.getMode().mode,
    clusterRadio: (function () {
      var cs = document.querySelector('.leaflet-trackreplay-clusterscatter');
      var r = [].slice.call(cs.querySelectorAll('input[type=radio]')).filter(function (x) { return x.checked; })[0];
      return r ? r.value : null;
    })(),
    bgIsClusterGroup: typeof replay.allLayers['background/基站'].elements
      .find(function (e) { return e.key === 'background_nodes'; }).layer.refreshClusters === 'function',
    event: window.__dsEvents.filter(function (e) { return e.evt === 'datasetadd'; }).pop(),
  };
});
await page.waitForTimeout(900);
out.afterAdd.openPopups = await page.locator('.leaflet-popup').count();
await page.screenshot({ path: path.join(OUT, '1-added.png') });

// playing state + stable bus: play, ticks must keep flowing after the rebuild
out.ticksAfterRebuild = await page.evaluate(async () => {
  var before = window.__ticks;
  replay.play();
  await new Promise(function (r) { setTimeout(r, 800); });
  replay.pause();
  return { state: replay.getState(), ticksBefore: before, ticksAfter: window.__ticks, advanced: window.__ticks > before };
});

// ---- A3. remove the added dataset: exactly its parts disappear ----
phase = 'A: remove';
out.afterRemove = await page.evaluate(() => {
  var ok = replay.removeDataset(window.__addedId);
  return {
    ok: ok,
    datasetCount: replay.listDatasets().length,
    newObjectGone: !replay.allLayers['test/seq1'],
    endTime: replay.timeEngine._endTime,
    time: replay.getCurrentTime(),
    speed: replay.getSpeed(),
    eventsHidden: replay.allLayers['visitor/Bee'].elements
      .filter(function (e) { return e.key === 'events'; })
      .every(function (e) { return !replay.map.hasLayer(e.layer); }),
    labelCellChecked: replay.infoLabels.getCheckedCells()
      .some(function (c) { return c.rowKey === 'background/基站'; }),
    event: window.__dsEvents.filter(function (e) { return e.evt === 'datasetremove'; }).pop(),
  };
});
out.afterRemove.removeUnknown = await page.evaluate(() => replay.removeDataset(99999));

// ---- B. clear -> empty -> usable again ----
phase = 'B: clear + reuse';
out.afterClear = await page.evaluate(() => {
  var n = replay.clearDatasets();
  return {
    removed: n,
    datasetCount: replay.listDatasets().length,
    allLayersEmpty: Object.keys(replay.allLayers).length === 0,
    state: replay.getState(),
    time: replay.getCurrentTime(),
    controlBarGone: !document.querySelector('.leaflet-trackreplay-controlbar'),
    event: window.__dsEvents.filter(function (e) { return e.evt === 'datasetsclear'; }).pop(),
  };
});
out.clearWhenEmpty = await page.evaluate(() => replay.clearDatasets());

out.reuseAfterClear = await page.evaluate(() => {
  replay.addDataset(window.__mkBg(['test', 'bg1'], 12, 'bg'), { name: '背景点' });
  return {
    datasetCount: replay.listDatasets().length,
    allLayers: Object.keys(replay.allLayers),
    controlBarBack: !!document.querySelector('.leaflet-trackreplay-controlbar'),
    time: replay.getCurrentTime(),
  };
});

// ---- C. the other two startup shapes ----
phase = 'C: startup shapes';
out.emptyStart = await page.evaluate(() => {
  replay.destroy();
  replay = L.trackReplay(map, null, { showViewFollow: false });
  var empty = {
    datasetCount: replay.listDatasets().length,
    state: replay.getState(),
    time: replay.getCurrentTime(),
    noBuild: Object.keys(replay.allLayers).length === 0,
  };
  var t0 = Date.now();
  replay.addDataset(window.__mkSeq(['test', 'seq2'], t0, 4, 'e'), { name: '空会话追加' });
  empty.afterAdd = {
    datasetCount: replay.listDatasets().length,
    objectPresent: !!replay.allLayers['test/seq2'],
    controlBar: !!document.querySelector('.leaflet-trackreplay-controlbar'),
  };
  return empty;
});

out.arrayStart = await page.evaluate(() => {
  replay.destroy();
  var t0 = Date.now();
  replay = L.trackReplay(map, [
    window.__mkSeq(['multi', 'a'], t0, 4, 'a'),
    window.__mkBg(['multi', 'b'], 8, 'b'),
  ], { showViewFollow: false });
  return {
    datasetCount: replay.listDatasets().length,
    names: replay.listDatasets().map(function (d) { return d.name; }),
    objects: Object.keys(replay.allLayers),
    getDataset: (function () {
      var d = replay.getDataset(replay.listDatasets()[0].id);
      return d ? { id: d.id, name: d.name, features: d.featureCollection.features.length } : null;
    })(),
  };
});
await page.screenshot({ path: path.join(OUT, '2-multi-start.png') });

console.log(JSON.stringify({ out, errs, shots: OUT }, null, 1));
await ctx.close();
