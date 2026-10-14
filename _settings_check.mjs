import { chromium } from 'playwright';
import os from 'os'; import path from 'path';

const PROXY = process.env.http_proxy || 'http://127.0.0.1:10808';
const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'tr-pw-profile'), {
  proxy: { server: PROXY, bypass: 'localhost,127.0.0.1' },
  viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2,
});
const page = ctx.pages()[0] || await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && m.text().indexOf('ERR_CONNECTION') < 0) errs.push('[console] ' + m.text().slice(0, 200));
});

const out = {};

await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction("typeof replay !== 'undefined' && replay", null, { timeout: 120000 });
// clean baseline (the persistent profile keeps localStorage between runs)
await page.evaluate(() => localStorage.removeItem('tr-demo-settings'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction("typeof replay !== 'undefined' && replay", null, { timeout: 120000 });
await page.waitForTimeout(3000);

const state = () => page.evaluate(() => ({
  mapDatum: replay.mapDatum,
  dataDatum: replay.dataDatum,
  center: [+map.getCenter().lat.toFixed(5), +map.getCenter().lng.toFixed(5)],
  zoom: map.getZoom(),
  popups: document.querySelectorAll('.leaflet-popup').length,
  tiles: [...document.querySelectorAll('img.leaflet-tile')].slice(0, 2)
    .map((t) => t.src.replace(/^https?:\/\//, '').split('/')[0]),
  baseRadios: document.querySelectorAll('.leaflet-control-layers input[name^="leaflet-base-layers"]').length,
}));

// coordinate of Bee's first point as currently rendered vs. the source data
const coordDelta = () => page.evaluate(() => {
  const src = trackData.features.find((f) => f.properties.layerPath.join('/') === 'visitor/Bee').geometry.coordinates[0];
  const lf = replay.parsed.layerFeatures.find((l) => l.layerPath.join('/') === 'visitor/Bee');
  const feat = lf.features.find((f) => f._trackMeta && f._trackMeta._isSource);
  const c = feat._trackMeta.coords[0];
  return { dLng: +(c[0] - src[0]).toFixed(7), dLat: +(c[1] - src[1]).toFixed(7) };
});

out.initial = await state();
out.initialDelta = await coordDelta();   // expect 0 / 0 (wgs84 → wgs84)

// --- control order: gear above zoom, both before fullscreen/measure ---
out.controlOrder = await page.evaluate(() => {
  const top = document.querySelector('.leaflet-top.leaflet-left');
  const kids = [...top.children];
  return {
    order: kids.map((k) => k.className.split(' ').filter((c) => c.indexOf('leaflet-control') === 0).pop()),
    gearIdx: kids.findIndex((k) => k.querySelector('.demo-settings-gear')),
    zoomIdx: kids.findIndex((k) => k.querySelector('.leaflet-control-zoom')),
  };
});

// --- open the panel; check contents ---
await page.click('.demo-settings-gear');
await page.waitForTimeout(300);
const panelInfo = () => page.evaluate(() => {
  const p = document.querySelector('.demo-settings-panel');
  if (!p) { return null; }
  return {
    sourceRadios: [...p.querySelectorAll('input[name=demo-source]')].map((i) => i.value + (i.checked ? '*' : '')),
    datumRadios: [...p.querySelectorAll('input[name=demo-datum]')].map((i) => i.value + (i.checked ? '*': '')),
    keyPlaceholder: p.querySelector('.demo-settings-input').placeholder,
    status: p.querySelector('.demo-settings-status').innerText.replace(/\n/g, ' | '),
  };
});
out.panelOsm = await panelInfo();

// --- modal blocking: wheel + drag over the panel, drag on the backdrop ---
out.blocking = await (async () => {
  const before = await state();
  const panelBox = await page.locator('.demo-settings-panel').boundingBox();
  const cx = panelBox.x + panelBox.width / 2, cy = panelBox.y + panelBox.height / 2;

  // wheel over the panel must not zoom the map
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(400);
  const afterWheel = await state();

  // drag inside the panel must not pan the map, and must not close the panel
  await page.mouse.move(cx, panelBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(cx + 150, panelBox.y + 90, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterPanelDrag = await state();
  const stillOpen = await page.evaluate(() => !!document.querySelector('.demo-settings-panel'));

  // drag on the backdrop must not pan the map (it closes the panel by design)
  const mb = await page.evaluate(() => { const r = map.getContainer().getBoundingClientRect(); return { x: r.left + 90, y: r.top + r.height - 200 }; });
  await page.mouse.move(mb.x, mb.y);
  await page.mouse.down();
  await page.mouse.move(mb.x + 140, mb.y - 120, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterBackdropDrag = await state();
  const closedByBackdrop = await page.evaluate(() => !document.querySelector('.demo-settings-panel'));

  return {
    centerBefore: before.center, zoomBefore: before.zoom,
    zoomAfterWheel: afterWheel.zoom,
    centerAfterPanelDrag: afterPanelDrag.center, stillOpen,
    centerAfterBackdropDrag: afterBackdropDrag.center, closedByBackdrop,
  };
})();

// --- style switch within the OSM source (layer tree radio) ---
out.styleSwitch = await page.evaluate(async () => {
  const labels = [...document.querySelectorAll('.leaflet-control-layers label')];
  const target = labels.find((l) => l.textContent.indexOf('深色 (Carto)') >= 0);
  if (!target) { return { found: false, sample: labels.map((l) => l.textContent.trim()).slice(0, 24) }; }
  target.querySelector('input').click();
  await new Promise((r) => setTimeout(r, 2500));
  return {
    found: true,
    mapDatum: replay.mapDatum,
    tiles: [...document.querySelectorAll('img.leaflet-tile')].slice(0, 2)
      .map((t) => t.src.replace(/^https?:\/\//, '').split('/')[0]),
    persistedStyle: JSON.parse(localStorage.getItem('tr-demo-settings') || '{}').styles,
    delta: (() => {
      const src = trackData.features.find((f) => f.properties.layerPath.join('/') === 'visitor/Bee').geometry.coordinates[0];
      const lf = replay.parsed.layerFeatures.find((l) => l.layerPath.join('/') === 'visitor/Bee');
      const c = lf.features.find((f) => f._trackMeta && f._trackMeta._isSource)._trackMeta.coords[0];
      return { dLng: +(c[0] - src[0]).toFixed(7), dLat: +(c[1] - src[1]).toFixed(7) };
    })(),
  };
});

// --- switch to 高德 in the settings panel ---
await page.click('.demo-settings-gear');
await page.waitForTimeout(300);
await page.evaluate(() => {
  [...document.querySelectorAll('.demo-settings-panel input[name=demo-source]')]
    .find((i) => i.value === 'amap').click();
});
await page.waitForTimeout(4500);
out.afterAmap = await state();
out.amapDelta = await coordDelta();          // expect ~ +0.005..0.008 lng, +0.001..0.004 lat
out.panelAmap = await panelInfo();
out.amapTileLoaded = await page.evaluate(() =>
  [...document.querySelectorAll('img.leaflet-tile-loaded')].some((t) => t.src.indexOf('autonavi') >= 0));

await page.screenshot({ path: path.join(os.tmpdir(), 'tr-settings-panel.png') });

// --- close, then screenshot the 高德 map at the track area ---
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
out.closedByEsc = await page.evaluate(() => !document.querySelector('.demo-settings-panel'));
await page.evaluate(() => { replay.pause(); map.setView([39.9226, 116.4402], 16, { animate: false }); });
await page.waitForTimeout(4500);
await page.screenshot({ path: path.join(os.tmpdir(), 'tr-settings-amap.png') });

// --- data datum = GCJ-02 → conversion off (data matches the GCJ basemap) ---
await page.click('.demo-settings-gear');
await page.waitForTimeout(250);
await page.evaluate(() => {
  document.querySelector('.demo-settings-panel input[name=demo-datum][value=gcj02]').click();
});
await page.waitForTimeout(1500);
out.gcjDataDelta = await coordDelta();       // expect 0 / 0 again
out.panelGcjData = await panelInfo();

// --- persistence: reload while on 高德/GCJ data, then reset to defaults ---
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction("typeof replay !== 'undefined' && replay", null, { timeout: 120000 });
await page.waitForTimeout(2500);
out.afterReload = await state();
out.afterReloadDelta = await coordDelta();

// reset back to OSM + WGS-84 and verify the persisted state flips back
await page.click('.demo-settings-gear');
await page.waitForTimeout(250);
await page.evaluate(() => {
  document.querySelector('.demo-settings-panel input[name=demo-datum][value=wgs84]').click();
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  [...document.querySelectorAll('.demo-settings-panel input[name=demo-source]')]
    .find((i) => i.value === 'osm').click();
});
await page.waitForTimeout(3000);
out.finalReset = await state();
out.finalDelta = await coordDelta();
out.finalPanel = await panelInfo();
await page.screenshot({ path: path.join(os.tmpdir(), 'tr-settings-osm.png') });

// --- 天地图 (key-required source) ---
await page.evaluate(() => {
  [...document.querySelectorAll('.demo-settings-panel input[name=demo-source]')]
    .find((i) => i.value === 'tianditu').click();
});
await page.waitForTimeout(2500);
out.tdtNoKey = await page.evaluate(() => ({
  mapDatum: replay.mapDatum,
  status: document.querySelector('.demo-settings-status').innerText.replace(/\n/g, ' | '),
  keyLabel: document.querySelector('.demo-settings-key + * , .demo-settings-row').textContent.slice(0, 40),
  tileSrc: (document.querySelector('img.leaflet-tile') || {}).src || null,
  baseRadios: document.querySelectorAll('.leaflet-control-layers input[name^="leaflet-base-layers"]').length,
  sourceLabels: [...document.querySelectorAll('.demo-settings-panel input[name=demo-source]')]
    .map((i) => i.parentNode.textContent.trim() + (i.checked ? '*' : '')),
}));
await page.screenshot({ path: path.join(os.tmpdir(), 'tr-settings-tdt.png') });

// type a fake tk → the rebuilt tile URLs must carry it, and the warning must go
await page.evaluate(() => {
  const inp = document.querySelector('.demo-settings-input');
  inp.value = 'FAKE_TK_TEST';
  inp.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(3000);
out.tdtWithKey = await page.evaluate(() => ({
  tileSrcsHaveTk: [...document.querySelectorAll('img.leaflet-tile')].slice(0, 3)
    .map((t) => t.src.indexOf('tk=FAKE_TK_TEST') >= 0),
  sampleSrc: ((document.querySelector('img.leaflet-tile') || {}).src || '').slice(0, 120),
  storedKeys: JSON.parse(localStorage.getItem('tr-demo-settings') || '{}').keys,
  warnGone: document.querySelector('.demo-settings-status').innerText.indexOf('必须填写') < 0,
}));

// clean up: wipe the fake key, back to a pristine default state
await page.evaluate(() => localStorage.removeItem('tr-demo-settings'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction("typeof replay !== 'undefined' && replay", null, { timeout: 120000 });
await page.waitForTimeout(2000);
out.cleanFinal = await state();

console.log(JSON.stringify(out, null, 1));
console.log('errors: ' + (errs.join(' | ') || 'none'));
await ctx.close();
