// Ad-hoc check for the focus-scoped keyboard model:
//   - playback bar focused: Space / ←→ / 0-9 / r work; outline shown
//   - map focused: ONLY Space (play/pause); digits/arrows keep map behavior
//   - search control focused: ←→↑↓ cycle hits; input focused: typing wins
//     (digits into text, arrows move caret, speed untouched)
//   - data source textarea / time editor input: typing never hits playback
//   - Loop checkbox focused: Space toggles the checkbox, not playback
//   - mapFocusSpace:false: map keyboard untouched
// Usage: node _keys_check.mjs   (demo server must be on :8000)
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

const OUT = path.join(os.tmpdir(), 'tr-shots-keys');
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
      m.text().indexOf('ERR_CONNECTION') < 0 && m.text().indexOf('Failed to load resource') < 0) {
    errs.push('[' + phase + '] [console] ' + m.text().slice(0, 200));
  }
});

await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction("window.replay && typeof replay.getState === 'function'", null, { timeout: 120000 });
await page.waitForTimeout(3500);

const snap = () => page.evaluate(() => ({
  state: replay.getState(),
  speed: replay.getSpeed(),
  time: replay.getCurrentTime(),
  loop: replay.getLoop(),
  center: map.getCenter().lat.toFixed(5) + ',' + map.getCenter().lng.toFixed(5),
  active: (document.activeElement && (document.activeElement.className || document.activeElement.tagName)) || '',
}));

const out = {};
const bar = '.leaflet-trackreplay-controlbar';

// ---- 1. playback bar focused ----
phase = 'bar';
await page.locator(bar).click({ position: { x: 5, y: 5 } });
out.barFocused = await page.evaluate((sel) => ({
  isActive: document.activeElement === document.querySelector(sel),
  outline: getComputedStyle(document.querySelector(sel)).outlineStyle,
}), bar);

await page.evaluate(() => replay.seekByProgress(0.5));
await page.keyboard.press('Space');
await page.waitForTimeout(600);
out.spacePlay = (await snap()).state;
await page.keyboard.press('Space');
await page.waitForTimeout(400);
out.spacePause = (await snap()).state;

await page.keyboard.press('4'); // 4th ladder entry = 2×
await page.waitForTimeout(200);
out.digit4 = await page.evaluate(() => ({
  speed: replay.getSpeed(),
  select: document.querySelector('.tr-speed-select').value,
  inputUntouched: document.querySelector('.lms-input') ? document.querySelector('.lms-input').value : '(none)',
}));
await page.keyboard.press('0');
out.digit0 = (await snap()).speed;

const beforeSeek = (await snap()).time;
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);
out.arrowSeek = { delta: (await snap()).time - beforeSeek };

await page.keyboard.press('r');
await page.waitForTimeout(300);
out.stopKey = await page.evaluate(() => ({
  state: replay.getState(),
  atStart: replay.getCurrentTime() === replay.parsed.timeMin,
}));

// ---- 2. map focused: ONLY Space ----
phase = 'map';
await page.mouse.click(1050, 700); // click free map area -> focuses the map container
out.mapFocused = await page.evaluate(() =>
  document.activeElement === map.getContainer());
const beforeMap = await snap();
await page.keyboard.press('4');
out.mapDigitIgnored = (await snap()).speed === beforeMap.speed;
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(300);
const afterMap = await snap();
out.mapArrowPans = {
  centerChanged: afterMap.center !== beforeMap.center,
  timeUnchanged: afterMap.time === beforeMap.time,
};
await page.keyboard.press('Space');
await page.waitForTimeout(600);
out.mapSpacePlays = (await snap()).state;
await page.keyboard.press('Space');
await page.waitForTimeout(300);

// ---- 3. search control focused: arrows cycle hits ----
phase = 'search focus';
await page.locator('.leaflet-multisearch .lms-toggle').click();
await page.locator('.leaflet-multisearch .lms-input').fill('基站');
await page.waitForTimeout(300);
out.searchTyped = await page.evaluate(() =>
  document.querySelector('.leaflet-multisearch .lms-count').textContent);
// focus the container itself (click a non-focusable child -> nearest
// focusable ancestor is the container; the header button would fold it)
await page.locator('.leaflet-multisearch .lms-count').click();
out.searchContainerFocused = await page.evaluate(() =>
  document.activeElement === document.querySelector('.leaflet-multisearch'));
const c0 = (await snap()).center;
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
const s1 = await page.evaluate(() => ({
  count: document.querySelector('.leaflet-multisearch .lms-count').textContent,
  center: map.getCenter().lat.toFixed(5) + ',' + map.getCenter().lng.toFixed(5),
}));
out.searchArrow = { count: s1.count, moved: s1.center !== c0 };
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
out.searchArrow2 = await page.evaluate(() =>
  document.querySelector('.leaflet-multisearch .lms-count').textContent);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(700);
out.searchArrowBack = await page.evaluate(() =>
  document.querySelector('.leaflet-multisearch .lms-count').textContent);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(700);
out.searchArrowDown = await page.evaluate(() =>
  document.querySelector('.leaflet-multisearch .lms-count').textContent);

// ---- 4. search input focused: typing wins ----
phase = 'search input';
await page.locator('.leaflet-multisearch .lms-input').click();
const beforeTyping = await snap();
out.inputFocused = await page.evaluate(() =>
  document.activeElement === document.querySelector('.leaflet-multisearch .lms-input'));
// arrows move the caret instead of jumping
await page.evaluate(() => {
  const i = document.querySelector('.leaflet-multisearch .lms-input');
  i.setSelectionRange(0, 0);
});
const countBefore = await page.evaluate(() =>
  document.querySelector('.leaflet-multisearch .lms-count').textContent);
await page.keyboard.press('ArrowRight');
out.caretMoved = await page.evaluate(() =>
  document.querySelector('.leaflet-multisearch .lms-input').selectionStart) === 1;
out.caretJumped = (await page.evaluate(() =>
  document.querySelector('.leaflet-multisearch .lms-count').textContent)) !== countBefore;
// digits type into the input, never change speed
await page.keyboard.type('4');
out.typedIntoInput = await page.evaluate((b) => ({
  value: document.querySelector('.leaflet-multisearch .lms-input').value,
  speed: replay.getSpeed(),
  speedUnchanged: replay.getSpeed() === b.speed,
}), beforeTyping);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
out.searchEscClosed = await page.evaluate(() =>
  !document.querySelector('.leaflet-multisearch').classList.contains('lms-open'));

// ---- 5. data source textarea: typing never touches playback ----
phase = 'textarea';
const beforeText = await snap();
await page.locator('.leaflet-trackreplay-datasource .tr-ds-title').click(); // panel is collapsed by default
await page.waitForTimeout(200);
await page.locator('.leaflet-trackreplay-datasource .tr-ds-paste').click();
await page.keyboard.type('4r8');
out.textareaTyping = await page.evaluate((b) => ({
  value: document.querySelector('.leaflet-trackreplay-datasource .tr-ds-paste').value,
  speedSame: replay.getSpeed() === b.speed,
  stateSame: replay.getState() === b.state,
}), beforeText);

// ---- 6. timeline time editor: typing digits never changes speed ----
phase = 'time editor';
await page.locator('.tr-time-label').dblclick();
await page.locator('.tr-time-input').click();
const beforeEdit = await snap();
await page.keyboard.type('42');
out.timeEditor = await page.evaluate((b) => ({
  value: document.querySelector('.tr-time-input').value,
  speedSame: replay.getSpeed() === b.speed,
}), beforeEdit);
await page.keyboard.press('Escape');

// ---- 7. loop checkbox focused: Space toggles the checkbox, not playback ----
phase = 'loop checkbox';
await page.locator('.tr-loop-check').click(); // focus + toggle on
const loopOn = (await snap()).loop;
const stateBeforeSpace = (await snap()).state;
await page.keyboard.press('Space');
await page.waitForTimeout(300);
out.loopSpace = {
  before: loopOn,
  after: (await snap()).loop,
  stateUnchanged: (await snap()).state === stateBeforeSpace,
};

// ---- 8. mapFocusSpace: false -> map keyboard untouched ----
phase = 'option off';
await page.evaluate(() => {
  replay.destroy();
  replay = L.trackReplay(map, trackData, { mapFocusSpace: false });
});
await page.waitForTimeout(1200);
await page.mouse.click(1050, 700);
const beforeNoOpt = (await snap()).state;
await page.keyboard.press('Space');
await page.waitForTimeout(500);
out.optionOff = await page.evaluate((s0) => ({
  stateBefore: s0,
  stateAfter: replay.getState(),
}), beforeNoOpt);

console.log(JSON.stringify({ out, errs, shots: OUT }, null, 1));
await ctx.close();
