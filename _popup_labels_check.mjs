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
page.on('console', (m) => { if (m.type() === 'error' && m.text().indexOf('ERR_CONNECTION') < 0) errs.push('[console] ' + m.text().slice(0, 160)); });
await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction("typeof replay !== 'undefined'", null, { timeout: 120000 });
await page.waitForTimeout(3000);

const out = {};
const popups = () => page.evaluate(() => ({
  open: document.querySelectorAll('.leaflet-popup').length,
  sample: (() => { const el = document.querySelector('.leaflet-popup-content'); return el ? el.innerText.replace(/\n/g, ' | ').slice(0, 60) : null; })(),
  center: [map.getCenter().lat.toFixed(5), map.getCenter().lng.toFixed(5)],
}));
const clickCell = (rowMatch, colKey) => page.evaluate(([rowMatch, colKey]) => {
  const ctl = replay.infoLabels;
  const rowIdx = ctl._rows.findIndex((r) => r.label.indexOf(rowMatch) >= 0);
  const tr = [...document.querySelectorAll('.leaflet-trackreplay-infolabels .tr-il-row')][rowIdx];
  const colIdx = ctl._columns.findIndex((c) => c.key === colKey);
  tr.querySelectorAll('td.tr-il-cell input')[colIdx].click();
}, [rowMatch, colKey]);

await page.locator('.leaflet-trackreplay-infolabels .tr-il-title').click();
await page.waitForTimeout(200);

// 1) Bee events -> 1 popup opens, map must NOT pan
out.beforeClick = await popups();
await clickCell('Bee', 'events');
await page.waitForTimeout(600);
out.afterEventCell = await popups();
out.autoFlags = await page.evaluate(() => {
  const t = replay.infoLabels._rows[0].cells.events.targets[0];
  return { autoClose: t.popup.options.autoClose, autoPan: t.popup.options.autoPan, isOpen: t.layer.isPopupOpen() };
});

// 2) Bee track -> many popups at once
await clickCell('Bee', 'track');
await page.waitForTimeout(900);
out.afterTrackCell = await popups();
out.title = await page.evaluate(() => replay.infoLabels._titleEl.textContent);

// 3) clicking a segment manually while labels are on: both stay open
out.clickAdds = await (async () => {
  const p = await page.evaluate(() => {
    const coords = trackData.features.find((f) => f.properties.layerPath.join('/') === 'visitor/Mark').geometry.coordinates;
    const mid = [(coords[80][0] + coords[81][0]) / 2, (coords[80][1] + coords[81][1]) / 2];
    map.setView([mid[1], mid[0]], 18, { animate: false });
    const q = map.latLngToContainerPoint([mid[1], mid[0]]);
    return { x: q.x, y: q.y };
  });
  await page.waitForTimeout(800);
  const before = (await popups()).open;
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(500);
  const after = (await popups()).open;
  return { before, after };
})();

// 4) element hidden -> its popups close; shown -> reopen
out.followVisibility = await page.evaluate(async () => {
  const evLayer = replay.allLayers['visitor/Mark'].elements.find((e) => e.key === 'events').layer;
  // turn Mark's events cell on first
  const ctl = replay.infoLabels;
  const rowIdx = ctl._rows.findIndex((r) => r.label.indexOf('Mark') >= 0);
  const tr = [...document.querySelectorAll('.leaflet-trackreplay-infolabels .tr-il-row')][rowIdx];
  const colIdx = ctl._columns.findIndex((c) => c.key === 'events');
  tr.querySelectorAll('td.tr-il-cell input')[colIdx].click();
  await new Promise((r) => setTimeout(r, 400));
  const on = document.querySelectorAll('.leaflet-popup').length;
  map.removeLayer(evLayer);
  await new Promise((r) => setTimeout(r, 400));
  const hidden = document.querySelectorAll('.leaflet-popup').length;
  map.addLayer(evLayer);
  await new Promise((r) => setTimeout(r, 500));
  const restored = document.querySelectorAll('.leaflet-popup').length;
  return { on, hidden, restored };
});

// 5) switching off closes everything and restores the flags
await page.evaluate(() => {
  const ctl = replay.infoLabels;
  const trs = [...document.querySelectorAll('.leaflet-trackreplay-infolabels .tr-il-row')];
  ctl._rows.forEach((row, i) => {
    const head = trs[i].querySelector('td.tr-il-rowhead');
    let cb = trs[i].querySelector('td.tr-il-rowhead input');
    if (cb.indeterminate) { head.click(); }
    cb = trs[i].querySelector('td.tr-il-rowhead input');
    if (cb.checked) { head.click(); }
  });
});
await page.waitForTimeout(700);
out.afterAllOff = await popups();
out.flagsRestored = await page.evaluate(() => {
  const t = replay.infoLabels._rows[0].cells.events.targets[0];
  return { autoClose: t.popup.options.autoClose, autoPan: t.popup.options.autoPan, isOpen: t.layer.isPopupOpen() };
});

// screenshot: turn a couple of cells on for a readable view
await page.evaluate(async () => {
  const ctl = replay.infoLabels;
  const trs = [...document.querySelectorAll('.leaflet-trackreplay-infolabels .tr-il-row')];
  const pick = (rowIdx, colKey) => {
    const colIdx = ctl._columns.findIndex((c) => c.key === colKey);
    trs[rowIdx].querySelectorAll('td.tr-il-cell input')[colIdx].click();
  };
  replay.pause();
  pick(0, 'events'); pick(1, 'events'); pick(1, 'track');
  map.setView([39.9226, 116.4402], 17, { animate: false });
});
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(os.tmpdir(), 'tr-popup-labels.png') });

console.log(JSON.stringify(out, null, 1));
console.log('errors: ' + (errs.join(' | ') || 'none'));
await ctx.close();
