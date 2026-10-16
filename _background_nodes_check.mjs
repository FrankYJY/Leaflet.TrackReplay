// Ad-hoc check for the background_nodes element:
//   - MultiPoint + Point forms both materialize as nodes
//   - scatter is the DEFAULT; dots share the tracks' renderer (hit-testing)
//     and are clickable
//   - the cluster/scatter control switches modes in place (refs + state kept)
//   - cluster bubble click zooms in (after switching to 聚合)
//   - batch toggle row works across objects
//   - batch-label column exists; opening a cell opens the on-map popups
// Usage: node _background_nodes_check.mjs   (demo server must be on :8000)
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

const OUT = path.join(os.tmpdir(), 'tr-shots-bg');
fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'tr-pw-profile'), {
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});
const page = ctx.pages()[0] || await ctx.newPage();
const errs = [];
let phase = 'load';
page.on('pageerror', (e) => errs.push('[' + phase + '] PAGEERROR: ' + e.message + '\n' + (e.stack || '(no stack)')));
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
await page.waitForTimeout(4000);

const out = {};

// ---- 1. elements per object: counts, clustering, on-map state ----
out.entries = await page.evaluate(() => {
  return Object.keys(replay.allLayers)
    .filter((k) => k.indexOf('background') >= 0)
    .map((k) => {
      const el = replay.allLayers[k].elements.find((e) => e.key === 'background_nodes');
      if (!el) { return { obj: k, missing: true }; }
      return {
        obj: k,
        label: el.label,
        nodes: el.layer._backgroundNodeCount,
        clustered: typeof el.layer.refreshClusters === 'function',
        onMap: map.hasLayer(el.layer),
      };
    });
});

// ---- 2. dots share the tracks' renderer (hit-testing prerequisite) ----
out.renderer = await page.evaluate(() => {
  const bgEl = replay.allLayers['background/兴趣点'].elements.find((e) => e.key === 'background_nodes');
  let dot = null;
  bgEl.layer.eachLayer((l) => { if (!dot && l._map) { dot = l; } });
  let track = null;
  replay.allLayers['visitor/Bee'].elements.forEach((e) => {
    if (e.key === 'track') {
      e.layer.eachLayer((l) => { if (!track && l._map && l.getLatLngs) { track = l; } });
    }
  });
  return {
    dotOnMap: !!dot,
    trackFound: !!track,
    sameRenderer: !!(dot && track && dot._renderer === track._renderer),
  };
});

// ---- 3. click a real node dot -> its own popup must open ----
const candidates = await page.evaluate(() => {
  const bgEl = replay.allLayers['background/兴趣点'].elements.find((e) => e.key === 'background_nodes');
  const list = [];
  bgEl.layer.eachLayer((l) => {
    if (l._map && l.getPopup() && list.length < 10) {
      const p = map.latLngToContainerPoint(l.getLatLng());
      list.push({ x: Math.round(p.x), y: Math.round(p.y), content: String(l.getPopup().getContent()) });
    }
  });
  return list;
});
out.dotClick = null;
for (const c of candidates) {
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(400);
  const txt = await page.evaluate(() => {
    const el = document.querySelector('.leaflet-popup-content');
    return el ? el.innerText.replace(/\n/g, ' | ') : null;
  });
  if (txt && txt.indexOf('兴趣点') >= 0) {
    out.dotClick = { at: [c.x, c.y], opened: txt.slice(0, 40), matched: true };
    break;
  }
  await page.evaluate(() => { map.closePopup(); });
}
if (!out.dotClick) { out.dotClick = { candidates: candidates.length, matched: false }; }

phase = 'section 4';
// ---- 4. cluster bubble click -> markercluster zooms in ----
// (scatter is the default now — switch to 聚合 through the control first)
await page.evaluate(() => {
  const el = document.querySelector('.leaflet-trackreplay-clusterscatter');
  [...el.querySelectorAll('input[type=radio]')].find((r) => r.value === 'cluster').click();
});
await page.waitForTimeout(1500);
const bubble = await page.evaluate(() => {
  const bgEl = replay.allLayers['background/兴趣点'].elements.find((e) => e.key === 'background_nodes');
  const mgg = bgEl.layer;
  let parent = null;
  mgg.eachLayer((l) => {
    if (parent) { return; }
    const p = mgg.getVisibleParent(l);
    if (p && p._childCount !== undefined && p._icon) { parent = p; }
  });
  if (!parent) { return null; }
  const r = parent._icon.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
out.clusterClick = null;
if (bubble) {
  const before = await page.evaluate(() => map.getZoom());
  await page.mouse.click(bubble.x, bubble.y);
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => map.getZoom());
  out.clusterClick = { before, after, zoomedIn: after > before };
}
// back to the scatter default for the remaining checks
await page.evaluate(() => {
  const el = document.querySelector('.leaflet-trackreplay-clusterscatter');
  [...el.querySelectorAll('input[type=radio]')].find((r) => r.value === 'scatter').click();
});
await page.waitForTimeout(1200);

// reset the view for the remaining checks
await page.evaluate(() => {
  map.closePopup();
  map.setView([39.91, 116.41], 14);
});
await page.waitForTimeout(1200);

// ---- 5. batch toggle: one row flips every background layer ----
out.toggle = await page.evaluate(() => {
  const row = replay.elementToggles._rows.find((r) => r.key === 'background_nodes');
  if (!row) { return null; }
  replay.elementToggles._setAll(row, false);
  const off = row.layers.every((l) => !map.hasLayer(l));
  replay.elementToggles._setAll(row, true);
  const on = row.layers.every((l) => map.hasLayer(l));
  return { label: row.label, layers: row.layers.length, off, on };
});

await page.screenshot({ path: path.join(OUT, '1-overview.png') });

phase = 'section 6';
// ---- 6. batch labels column + cell open/close ----
await page.locator('.leaflet-trackreplay-infolabels .tr-il-title').click();
await page.waitForTimeout(200);
out.columns = await page.evaluate(() => replay.infoLabels._columns.map((c) => c.key));

const cellInfo = await page.evaluate(() => {
  const rows = replay.infoLabels._rows;
  const rowIdx = rows.findIndex((r) => r.label.indexOf('兴趣点') >= 0);
  if (rowIdx < 0) { return { error: 'row not found' }; }
  const cell = rows[rowIdx].cells.background_nodes;
  if (!cell) { return { error: 'cell not found' }; }
  return {
    rowIdx,
    colIdx: replay.infoLabels._columns.findIndex((c) => c.key === 'background_nodes'),
    targets: cell.targets.length,
    onMapTargets: cell.targets.filter((t) => !!t.layer._map).length,
  };
});
out.cellInfo = cellInfo;

const clickCell = (rowIdx, colIdx) => page.evaluate(([r, c]) => {
  const tr = [...document.querySelectorAll('.leaflet-trackreplay-infolabels .tr-il-row')][r];
  tr.querySelectorAll('td.tr-il-cell')[c].querySelector('input').click();
}, [rowIdx, colIdx]);

await clickCell(cellInfo.rowIdx, cellInfo.colIdx);
await page.waitForTimeout(1000);
out.afterOpen = await page.evaluate(() => ({
  activeLabels: replay.infoLabels._activeLabels,
  title: document.querySelector('.leaflet-trackreplay-infolabels .tr-il-title').textContent,
}));
out.openPopupsAtZ14 = await page.locator('.leaflet-popup').count();

// Zoom in: clustered nodes de-cluster and their labels must follow.
await page.evaluate(() => { map.setView([39.90, 116.40], 16); });
await page.waitForTimeout(2000);
out.afterZoom = await page.evaluate(() => {
  const rows = replay.infoLabels._rows;
  const rowIdx = rows.findIndex((r) => r.label.indexOf('兴趣点') >= 0);
  const cell = rows[rowIdx].cells.background_nodes;
  return {
    openPopups: document.querySelectorAll('.leaflet-popup').length,
    onMapTargets: cell.targets.filter((t) => !!t.layer._map).length,
  };
});
await page.screenshot({ path: path.join(OUT, '2-labels.png') });

await clickCell(cellInfo.rowIdx, cellInfo.colIdx); // close again
await page.waitForTimeout(600);
out.afterClose = await page.evaluate(() => ({
  activeLabels: replay.infoLabels._activeLabels,
  openPopups: document.querySelectorAll('.leaflet-popup').length,
}));

phase = 'section 7';
// ---- 7. zoom into blob 1 (km offset -0.9/-1.1 from center): dots + mixes ----
await page.evaluate(() => { map.setView([39.8919, 116.3871], 16); });
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(OUT, '3-zoomed.png') });

phase = 'section 8';
// ---- 8. cluster/scatter control: mode switch rebuilds in place ----
out.control = await page.evaluate(() => {
  const c = replay.clusterScatterControl;
  const el = document.querySelector('.leaflet-trackreplay-clusterscatter');
  if (!c || !el) { return { present: false }; }
  const checked = [...el.querySelectorAll('input[type=radio]')].find((r) => r.checked);
  return {
    present: true,
    text: el.innerText.replace(/\n+/g, ' | '),
    value: checked ? checked.value : null,
  };
});

// open the 兴趣点 labels cell first, so the switch's label-restore path is tested
const cellPos = await page.evaluate(() => ({
  rowIdx: replay.infoLabels._rows.findIndex((r) => r.label.indexOf('兴趣点') >= 0),
  colIdx: replay.infoLabels._columns.findIndex((c) => c.key === 'background_nodes'),
}));
await clickCell(cellPos.rowIdx, cellPos.colIdx);
await page.waitForTimeout(900);
out.labelsBeforeSwitch = await page.locator('.leaflet-popup').count(); // scatter: all 50

out.modeSwitch = await page.evaluate(() => {
  const get = (k) => replay.allLayers[k].elements.find((e) => e.key === 'background_nodes').layer;
  const oldSamples = get('background/采样点');
  const oldPois = get('background/兴趣点');
  map.removeLayer(oldSamples); // hide one object only — must survive the switch

  const el = document.querySelector('.leaflet-trackreplay-clusterscatter');
  [...el.querySelectorAll('input[type=radio]')].find((r) => r.value === 'cluster').click();

  const newSamples = get('background/采样点');
  const newPois = get('background/兴趣点');
  let treeHits = 0;
  const walk = (list) => list.forEach((nd) => {
    if (nd.layer === newSamples || nd.layer === newPois) { treeHits++; }
    if (nd.children) { walk(nd.children); }
  });
  if (replay.layerControl._trackReplayTree) { walk(replay.layerControl._trackReplayTree); }
  const row = replay.elementToggles._rows.find((r) => r.key === 'background_nodes');

  return {
    swapped: newSamples !== oldSamples && newPois !== oldPois,
    clusterMode: {
      samplesIsMCG: typeof newSamples.refreshClusters === 'function',
      poisIsMCG: typeof newPois.refreshClusters === 'function',
      counts: [newSamples._backgroundNodeCount, newPois._backgroundNodeCount],
    },
    visibilityPreserved: {
      hiddenStaysHidden: !map.hasLayer(newSamples),
      visibleStaysVisible: map.hasLayer(newPois),
    },
    treeRefsUpdated: treeHits,
    toggleRowRefsUpdated: row.layers.filter((l) => l === newSamples || l === newPois).length,
  };
});
await page.waitForTimeout(1500);
out.modeSwitchPopups = await page.evaluate(() => {
  const cell = replay.infoLabels._rows
    .find((r) => r.label.indexOf('兴趣点') >= 0).cells.background_nodes;
  return {
    openPopups: document.querySelectorAll('.leaflet-popup').length,
    onMapTargets: cell.targets.filter((t) => !!t.layer._map).length,
  };
});
await page.screenshot({ path: path.join(OUT, '5-cluster-mode.png') });

// switch back to scatter (the default); restore the manually hidden object
out.modeSwitchBack = await page.evaluate(() => {
  const el = document.querySelector('.leaflet-trackreplay-clusterscatter');
  [...el.querySelectorAll('input[type=radio]')].find((r) => r.value === 'scatter').click();
  const get = (k) => replay.allLayers[k].elements.find((e) => e.key === 'background_nodes').layer;
  const pois = get('background/兴趣点');
  map.addLayer(get('background/采样点')); // restore for tidiness
  return { poisIsMCG: typeof pois.refreshClusters === 'function', poisOnMap: map.hasLayer(pois) };
});
await page.waitForTimeout(1500);
out.labelsAfterSwitchBack = await page.locator('.leaflet-popup').count(); // scatter again: all 50
await clickCell(cellPos.rowIdx, cellPos.colIdx); // close the cell again
await page.waitForTimeout(600);

// ---- 9. explicit cluster: true variant — starts clustered, control shows 聚合 ----
out.clusteredVariant = await page.evaluate(() => {
  replay.destroy();
  replay = L.trackReplay(map, trackData, {
    showControls: false, showTimeline: false, showLegend: false,
    showViewFollow: false, showElementToggles: false, showInfoLabels: false,
    backgroundNodesOptions: { cluster: true },
  });
  const el = replay.allLayers['background/兴趣点'].elements.find((e) => e.key === 'background_nodes');
  const g = el.layer;
  return {
    isMCG: typeof g.refreshClusters === 'function',
    nodes: g._backgroundNodeCount,
    onMap: map.hasLayer(g),
    controlValue: (() => {
      const c = document.querySelector('.leaflet-trackreplay-clusterscatter');
      if (!c) { return null; }
      const r = [...c.querySelectorAll('input[type=radio]')].find((x) => x.checked);
      return r ? r.value : null;
    })(),
  };
});

// make sure the poi area is in view, then click one of the shown nodes
phase = 'section 9';
await page.evaluate(() => { map.setView([39.90, 116.40], 16); });
await page.waitForTimeout(1500);
const shownDots = await page.evaluate(() => {
  const el = replay.allLayers['background/兴趣点'].elements.find((e) => e.key === 'background_nodes');
  const size = map.getSize();
  const list = [];
  el.layer.eachLayer((l) => {
    if (list.length < 8 && l._map) {
      const p = map.latLngToContainerPoint(l.getLatLng());
      if (p.x > 10 && p.y > 10 && p.x < size.x - 10 && p.y < size.y - 10) {
        list.push({ x: Math.round(p.x), y: Math.round(p.y) });
      }
    }
  });
  return list;
});
out.clusteredClick = null;
for (const d of shownDots) {
  await page.mouse.click(d.x, d.y);
  await page.waitForTimeout(400);
  const txt = await page.evaluate(() => {
    const el = document.querySelector('.leaflet-popup-content');
    return el ? el.innerText.replace(/\n/g, ' | ') : null;
  });
  if (txt && txt.indexOf('兴趣点') >= 0) {
    out.clusteredClick = { at: [d.x, d.y], opened: txt.slice(0, 40), matched: true };
    break;
  }
  await page.evaluate(() => { map.closePopup(); });
}
if (!out.clusteredClick) { out.clusteredClick = { candidates: shownDots.length, matched: false }; }
await page.screenshot({ path: path.join(OUT, '6-clustered.png') });

console.log(JSON.stringify({ out, errs, shots: OUT }, null, 1));
await ctx.close();
