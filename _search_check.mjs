// Ad-hoc check for the multi-search control (leaflet-multisearch):
//   - duplicates are first-class hits: count badge, Enter/◀/▶ cycling with
//     wraparound, each hit's own location and popup
//   - cluster mode: a hit inside a bubble is revealed (zoomToShowLayer) then
//     its popup opens; switching modes invalidates+rebuilds the index
//   - dataset changes refresh the index (clear -> no match, re-add -> match)
//   - case-insensitive matching, Esc behavior, zero errors
// Usage: node _search_check.mjs   (demo server must be on :8000)
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

const OUT = path.join(os.tmpdir(), 'tr-shots-search');
fs.mkdirSync(OUT, { recursive: true });

const PANEL = '.leaflet-multisearch';

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
const state = () => page.evaluate((sel) => ({
  count: document.querySelector(sel + ' .lms-count').textContent,
  rows: [...document.querySelectorAll(sel + ' .lms-item')].map((r) => r.textContent),
  activeIdx: [...document.querySelectorAll(sel + ' .lms-item')].findIndex((r) => r.classList.contains('lms-active')),
  listVisible: document.querySelector(sel + ' .lms-list').style.display !== 'none',
  popup: (() => { const e = document.querySelector('.leaflet-popup-content'); return e ? e.innerText.replace(/\n/g, ' | ') : null; })(),
  center: [map.getCenter().lat.toFixed(5), map.getCenter().lng.toFixed(5)],
  zoom: map.getZoom(),
  flash: !!document.querySelector('.lms-flash'),
}), PANEL);

// ---- 0. control shape: collapsed by default, opens to an input ----
phase = 'shape';
out.shape = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return {
    present: !!el,
    collapsed: !el.classList.contains('lms-open'),
    hasToggle: !!el.querySelector('.lms-toggle'),
  };
}, PANEL);
await page.locator(PANEL + ' .lms-toggle').click();
out.opened = await page.evaluate((sel) => ({
  open: document.querySelector(sel).classList.contains('lms-open'),
  focused: document.activeElement === document.querySelector(sel + ' .lms-input'),
}), PANEL);

// ---- 1. add a dataset with DUPLICATE popup texts ----
phase = 'add duplicates';
await page.evaluate(() => {
  replay.addDataset({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [116.402, 39.902], [116.408, 39.906], [116.395, 39.898], [116.41, 39.91],
          [116.4050, 39.9035], [116.4055, 39.9038], [116.4052, 39.9040], // clustered trio
        ],
      },
      properties: {
        layerPath: ['searchtest', '重复测试'],
        element: 'background_nodes',
        popups: [
          '重复节点 GPS 标记', '重复节点 GPS 标记', '唯一节点 A', '唯一节点 B',
          '聚簇节点 CLUSTER', '聚簇节点 CLUSTER', '聚簇节点 CLUSTER',
        ],
      },
    }],
  }, { name: '重复文本测试' });
});
await page.waitForTimeout(700);

// ---- 2. duplicates: count, cycle, wrap ----
phase = 'duplicates';
const input = page.locator(PANEL + ' .lms-input');
await input.fill('重复节点');
await page.waitForTimeout(300);
out.afterType = await state();

await input.press('Enter');
await page.waitForTimeout(600);
out.hit1 = await state();

await input.press('Enter');
await page.waitForTimeout(900);
out.hit2 = await state();

await input.press('Enter'); // wraparound -> back to hit 1
await page.waitForTimeout(900);
out.hitWrap = await state();

await input.press('Shift+Enter'); // prev -> wraps to last
await page.waitForTimeout(900);
out.hitPrev = await state();

// ---- 3. click a row directly ----
phase = 'row click';
await page.locator(PANEL + ' .lms-item').first().click();
await page.waitForTimeout(700);
out.rowClick = await state();

// ---- 3b. close button collapses; reopening restores query + results ----
phase = 'close button';
await page.locator(PANEL + ' .lms-close').click();
await page.waitForTimeout(200);
out.afterCloseBtn = await page.evaluate((sel) => ({
  open: document.querySelector(sel).classList.contains('lms-open'),
}), PANEL);
await page.locator(PANEL + ' .lms-toggle').click();
await page.waitForTimeout(400);
out.afterReopen = await page.evaluate((sel) => ({
  open: document.querySelector(sel).classList.contains('lms-open'),
  inputValue: document.querySelector(sel + ' .lms-input').value,
  rows: document.querySelectorAll(sel + ' .lms-item').length,
  listVisible: document.querySelector(sel + ' .lms-list').style.display !== 'none',
}), PANEL);

// ---- 4. case-insensitive ----
phase = 'case';
await input.fill('gps');
await page.waitForTimeout(300);
out.lowercase = await state();

// ---- 5. big match set: 50 stations ----
phase = 'stations';
await input.fill('基站');
await page.waitForTimeout(400);
out.stations = await state();

// ---- 6. no match ----
phase = 'no match';
await input.fill('不存在的查询xyz');
await page.waitForTimeout(300);
out.noMatch = await state();

// ---- 7. cluster mode: hit inside a bubble is revealed, popup opens ----
phase = 'cluster mode';
// zoom out first so the test nodes sit inside cluster bubbles
await page.evaluate(() => { map.setView([39.904, 116.405], 14); });
await page.waitForTimeout(900);
await page.evaluate(() => {
  const el = document.querySelector('.leaflet-trackreplay-clusterscatter');
  [...el.querySelectorAll('input[type=radio]')].find((r) => r.value === 'cluster').click();
});
await page.waitForTimeout(1200);
const zoomBefore = (await state()).zoom;
await input.fill('聚簇节点');
await page.waitForTimeout(300);
await input.press('Enter');
await page.waitForTimeout(2600); // zoomToShowLayer + zoom animation
out.clusterGoto = await state();
out.clusterGoto.zoomBefore = zoomBefore;
out.clusterGoto.zoomedIn = out.clusterGoto.zoom > zoomBefore;
await page.screenshot({ path: path.join(OUT, '1-cluster-goto.png') });

// ---- 8. dataset clear refreshes the index ----
phase = 'refresh on clear';
await page.evaluate(() => {
  const el = document.querySelector('.leaflet-trackreplay-clusterscatter');
  [...el.querySelectorAll('input[type=radio]')].find((r) => r.value === 'scatter').click();
});
await page.waitForTimeout(1000);
await page.evaluate(() => replay.clearDatasets());
await page.waitForTimeout(600);
await input.fill('基站');
await page.waitForTimeout(300);
out.afterClear = await state();

// ---- 9. re-add via a sample button -> index finds it again ----
phase = 'refresh on add';
await page.locator('.leaflet-trackreplay-datasource .tr-ds-title').click(); // panel is collapsed by default
await page.waitForTimeout(200);
await page.locator('.leaflet-trackreplay-datasource .tr-ds-sample').nth(1).click(); // 示例采样点
await page.waitForTimeout(800);
await input.fill('示例采样点');
await page.waitForTimeout(300);
out.afterReadd = await state();

// ---- 10. Esc: clears, then collapses ----
phase = 'esc';
await input.press('Escape');
await page.waitForTimeout(200);
out.afterEsc1 = await page.evaluate((sel) => ({
  inputValue: document.querySelector(sel + ' .lms-input').value,
  count: document.querySelector(sel + ' .lms-count').textContent,
}), PANEL);
await input.press('Escape');
await page.waitForTimeout(200);
out.afterEsc2 = await page.evaluate((sel) =>
  document.querySelector(sel).classList.contains('lms-open'), PANEL);

console.log(JSON.stringify({ out, errs, shots: OUT }, null, 1));
await ctx.close();
