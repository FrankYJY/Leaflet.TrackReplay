// Ad-hoc smoke run: launch the demo, drive playback, screenshot each stage.
// Usage: node _smoke_run.mjs   (demo server must be running on :8000)
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

const OUT = path.join(os.tmpdir(), 'tr-shots');
fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'tr-pw-profile'), {
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});
const page = ctx.pages()[0] || await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') { errs.push('[console] ' + m.text().slice(0, 200)); }
});

await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(
  "window.replay && typeof replay.getState === 'function' && Object.keys(replay.allLayers).length > 0",
  null, { timeout: 120000 }
);
await page.waitForTimeout(4000); // tiles + markers settle

const out = {};

// ---- 1. Initial state ----
out.initial = await page.evaluate(() => ({
  state: replay.getState(),
  progress: +replay.getProgress().toFixed(4),
  objects: Object.keys(replay.allLayers),
  indicators: replay.movingIndicators.length,
  hasTimelineSlider: !!document.querySelector('.tr-slider'),
  hasLegend: !!document.querySelector('.leaflet-trackreplay-legend'),
}));
await page.screenshot({ path: path.join(OUT, '1-initial.png') });

// ---- 2. Play for ~3s ----
await page.locator('.tr-btn-play').click();
await page.waitForTimeout(3000);
out.playing = await page.evaluate(() => ({
  state: replay.getState(),
  progress: +replay.getProgress().toFixed(4),
  timeLabel: (document.querySelector('.tr-time-label') || {}).textContent,
  indicatorOnMap: replay.movingIndicators.map((i) => map.hasLayer(i.marker)),
}));
await page.screenshot({ path: path.join(OUT, '2-playing.png') });

// ---- 3. Let it advance further: traveled/untraveled route should split ----
await page.waitForTimeout(6000);
out.later = await page.evaluate(() => ({
  progress: +replay.getProgress().toFixed(4),
  traveledPts: replay.dynamicRoutes[0].traveled.getLayers()[0].getLatLngs().length,
  untraveledPts: replay.dynamicRoutes[0].untraveled.getLayers()[0].getLatLngs().length,
}));
await page.screenshot({ path: path.join(OUT, '3-route.png') });

// ---- 4. Pause, then seek to 80% ----
await page.locator('.tr-btn-play').click();
await page.waitForTimeout(300);
out.paused = await page.evaluate(() => ({ state: replay.getState() }));

await page.evaluate(() => replay.seekByProgress(0.8));
await page.waitForTimeout(1000);
out.seeked = await page.evaluate(() => ({
  progress: +replay.getProgress().toFixed(4),
  state: replay.getState(),
}));
await page.screenshot({ path: path.join(OUT, '4-seeked.png') });

console.log(JSON.stringify({ out, errs, shots: OUT }, null, 1));
await ctx.close();
