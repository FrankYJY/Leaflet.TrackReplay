// Date line check: weekday · day N/M · calendar entry (with the field it came
// from) · display zone, the midnight ticks on the slider, the zone switch, and
// the demo's holiday fetch/cache (chinese-days yearly JSON).
// Usage: node _dateline_check.mjs   (demo server on :8000; `npm run build` first)
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';

const OUT = path.join(os.tmpdir(), 'tr-shots-dateline');
import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'tr-pw-profile'), {
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
  // The holiday JSON lives on a CDN; this machine reaches it through the proxy.
  proxy: { server: 'http://127.0.0.1:10808', bypass: 'localhost,127.0.0.1' },
});
const page = ctx.pages()[0] || await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && m.text().indexOf('ERR_TIMED_OUT') < 0 &&
      m.text().indexOf('ERR_CONNECTION') < 0 && m.text().indexOf('Failed to load resource') < 0) {
    errs.push('[console] ' + m.text().slice(0, 200));
  }
});

await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(
  "window.replay && typeof replay.getState === 'function' && Object.keys(replay.allLayers).length > 0",
  null, { timeout: 120000 });

const out = {};

// ---- 1. The demo fetched and cached the current year's holiday table ----
await page.waitForFunction(
  "replay.getCalendar() && Object.keys(replay.getCalendar().holidays || {}).length > 0",
  null, { timeout: 30000 }).catch(() => {});
out.calendar = await page.evaluate(() => {
  const cal = replay.getCalendar();
  if (!cal) { return { loaded: false }; }
  const hk = Object.keys(cal.holidays);
  const wk = Object.keys(cal.workdays);
  return {
    loaded: true,
    holidays: hk.length,
    workdays: wk.length,
    sampleHoliday: hk[0],
    sampleWorkday: wk[0],
    valueRaw: cal.holidays[hk[0]],            // 原样显示：三段字符串不做转化
    cached: Object.keys(localStorage).filter((k) => k.indexOf('tr-holidays:') === 0),
  };
});

// ---- 2. A controlled dataset (so day N/M and the ticks are exact) ----
// 2026-10-01 08:00 → 2026-10-02 19:00 (+08): 2 calendar days, 1 midnight.
out.workdayKey = await page.evaluate(() => {
  const cal = replay.getCalendar() || { workdays: {} };
  return Object.keys(cal.workdays).sort()[0] || null;
});
await page.evaluate(() => {
  replay.setTimeZone(8);
  replay.clearDatasets();
  const coords = [], times = [];
  const t0 = Date.UTC(2026, 9, 1, 0, 0, 0);          // 08:00 +08
  for (let i = 0; i < 37; i++) {                      // 36 h of data, 1 h apart
    times.push(t0 + i * 3600000);
    coords.push([116.40 + i * 0.002, 39.90 + i * 0.001]);
  }
  window.rangeStart = times[0];
  replay.addDataset({ type: 'FeatureCollection', features: [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { layerPath: ['检查', '跨天'], isTimestampedgeojson: true, times,
      drawMovingIndicator: true },
  }] }, { name: 'dateline' });
});
await page.waitForTimeout(300);

const readLine = () => page.evaluate(() => {
  const el = document.querySelector('.tr-tl-dateinfo');
  return {
    dateInfo: el ? el.textContent : null,
    timeLabel: (document.querySelector('.tr-time-label') || {}).textContent,
    ticks: document.querySelectorAll('.tr-daytick').length,
  };
});

// ---- 3. On the holiday (2026-10-01, 国庆节) ----
await page.evaluate(() => replay.seek(window.rangeStart + 3600000)); // 09:00 +08, Oct 1
await page.waitForTimeout(200);
out.onHoliday = await readLine();

// ---- 4. A plain day: with a table that only covers Oct 1, Oct 2 has no entry ----
out.onPlainDay = await page.evaluate(() => {
  replay.setCalendar({ holidays: { '2026-10-01': "National Day,国庆节,3" } });
  const r = replay.timeEngine.getTimeRange();
  replay.seek(r.start + 30 * 3600000);                      // 2026-10-02 14:00 +08
  return { dateInfo: document.querySelector('.tr-tl-dateinfo').textContent };
});

// ---- 5. A make-up workday: same table, but Oct 2 is declared a workday ----
out.onWorkday = await page.evaluate(() => {
  replay.setCalendar({
    holidays: { '2026-10-01': "National Day,国庆节,3" },
    workdays: { '2026-10-02': "National Day,国庆节,3" },
  });
  return { dateInfo: document.querySelector('.tr-tl-dateinfo').textContent };
});

// ---- 6. Zone switch: same instant, another calendar day ----
out.zoneSwitch = await page.evaluate(() => {
  replay.setTimeZone('America/New_York');
  const r = replay.timeEngine.getTimeRange();
  replay.seek(r.start + 3600000);            // 2026-10-01 09:00 +08 = Sep 30 21:00 in NY
  const ny = document.querySelector('.tr-tl-dateinfo').textContent;
  const nyLabel = document.querySelector('.tr-time-label').textContent;
  replay.setTimeZone(8);
  const back = document.querySelector('.tr-tl-dateinfo').textContent;
  return { newYork: ny, nyLabel, backToUtc8: back };
});

// ---- 7. No calendar at all: the line still reads weekday · day N/M · zone ----
out.noCalendar = await page.evaluate(() => {
  replay.setCalendar(null);
  return { dateInfo: document.querySelector('.tr-tl-dateinfo').textContent };
});

// ---- 8. Ticks: one per midnight inside the range (36h span → 2 midnights) ----
out.ticks = await page.evaluate(() => {
  replay.setCalendar(replay.getCalendar());
  return {
    count: document.querySelectorAll('.tr-daytick').length,
    lefts: [...document.querySelectorAll('.tr-daytick')].map((t) => t.style.left),
  };
});

await page.screenshot({ path: path.join(OUT, '1-dateline.png') });

console.log(JSON.stringify({ out, errs }, null, 1));
await ctx.close();
