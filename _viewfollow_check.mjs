// Regression check: two TrackReplay sessions on one page must not share a
// Follow radio group. Before the fix, `radio.name` was the fixed
// 'tr-viewfollow', so picking a mode in one panel silently unchecked the other
// panel's radio while that instance kept following (UI ≠ state).
// Usage: node _viewfollow_check.mjs   (demo server must be running on :8000)
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

const OUT = path.join(os.tmpdir(), 'tr-shots-vf');
fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'tr-pw-profile'), {
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
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
  null, { timeout: 120000 }
);

const out = {};

// ---- 1. A second session on the very same map ----
out.secondSession = await page.evaluate(() => {
  window.replay2 = L.trackReplay(map, trackData, { showDataSource: false, showSearch: false });
  return { objects: Object.keys(replay2.allLayers).length, hasFollow: !!replay2.viewFollow };
});

// ---- 2. Each panel's radios carry their own group name ----
out.groups = await page.evaluate(() => {
  const names = (r) => [...r.viewFollow.control.getContainer()
    .querySelectorAll('input[type=radio]')].map((i) => i.name);
  const a = names(replay);
  const b = names(replay2);
  return {
    first: [...new Set(a)],
    second: [...new Set(b)],
    distinct: new Set(a).size === 1 && new Set(b).size === 1 && a[0] !== b[0],
    reusedOldFixedName: a[0] === 'tr-viewfollow' || b[0] === 'tr-viewfollow',
  };
});

// ---- 3. Picking a mode in one panel leaves the other untouched ----
out.crossTalk = await page.evaluate(() => {
  const radios = (r) => [...r.viewFollow.control.getContainer().querySelectorAll('input[type=radio]')];
  const checked = (r) => radios(r).filter((i) => i.checked).map((i) => i.value);
  const pick = (r, v) => radios(r).find((i) => i.value === v).click();

  pick(replay, 'latest');
  const afterFirstPick = {
    firstChecked: checked(replay),
    firstMode: replay.viewFollow.getMode().mode,
    secondChecked: checked(replay2),
    secondMode: replay2.viewFollow.getMode().mode,
  };

  pick(replay2, 'random');
  const afterSecondPick = {
    firstChecked: checked(replay),
    firstMode: replay.viewFollow.getMode().mode,
    secondChecked: checked(replay2),
    secondMode: replay2.viewFollow.getMode().mode,
  };

  return {
    afterFirstPick,
    afterSecondPick,
    independent:
      afterFirstPick.firstChecked.join() === 'latest' &&
      afterFirstPick.secondChecked.join() === 'off' && afterFirstPick.secondMode === 'off' &&
      afterSecondPick.firstChecked.join() === 'latest' && afterSecondPick.firstMode === 'latest' &&
      afterSecondPick.secondChecked.join() === 'random' && afterSecondPick.secondMode === 'random',
  };
});

await page.screenshot({ path: path.join(OUT, '1-two-follow-panels.png') });

// ---- 4. Negative control: force the old fixed name and watch it clobber ----
// Simulates the pre-fix markup, so the check proves it can detect the bug
// rather than passing no matter what.
out.negativeControl = await page.evaluate(() => {
  const radios = (r) => [...r.viewFollow.control.getContainer().querySelectorAll('input[type=radio]')];
  radios(replay).forEach((i) => { i.name = 'tr-viewfollow'; });
  radios(replay2).forEach((i) => { i.name = 'tr-viewfollow'; });

  radios(replay).find((i) => i.value === 'off').click();
  radios(replay2).find((i) => i.value === 'named').click();
  const bBefore = radios(replay2).filter((i) => i.checked).map((i) => i.value);

  radios(replay).find((i) => i.value === 'latest').click(); // the old bug fires here
  return {
    secondCheckedBefore: bBefore,
    secondCheckedAfter: radios(replay2).filter((i) => i.checked).map((i) => i.value),
    secondModeAfter: replay2.viewFollow.getMode().mode,
    clobbered: radios(replay2).filter((i) => i.checked).length === 0 &&
      replay2.viewFollow.getMode().mode === 'named',
  };
});

// ---- 5. Tear the second session down; the first keeps its mode ----
out.teardown = await page.evaluate(() => {
  replay2.destroy();
  window.replay2 = null;
  return { firstMode: replay.viewFollow.getMode().mode };
});

console.log(JSON.stringify({ out, errs }, null, 1));
await ctx.close();
