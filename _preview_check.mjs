// Dataset preview check: row click → modal, summary, both truncation caps,
// copy, download (success + abort under a tiny budget), close paths, map
// inertness, dataset-removed-while-open, and the import size guard.
// Usage: node _preview_check.mjs   (demo server must be running on :8000;
//        run `npm run build` first — the page loads /dist)
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

const OUT = path.join(os.tmpdir(), 'tr-shots-preview');
fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'tr-pw-profile'), {
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8000' });
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
const bodyText = () => page.evaluate(() => {
  const el = document.querySelector('.tr-ds-preview-body');
  return el ? el.textContent : null;
});
const overlayOpen = () => page.evaluate(() => !!document.querySelector('.tr-ds-preview-overlay'));

// ---- 1. Click the first dataset row → preview opens ----
out.open = await page.evaluate(() => {
  const panel = document.querySelector('.leaflet-trackreplay-datasource');
  if (!panel.classList.contains('tr-ds-expanded')) { panel.querySelector('.tr-ds-title').click(); }
  const rows = panel.querySelectorAll('.tr-ds-dataset-row');
  rows[0].click();
  const overlay = document.querySelector('.tr-ds-preview-overlay');
  if (!overlay) { return { opened: false }; }
  const body = overlay.querySelector('.tr-ds-preview-body').textContent;
  return {
    opened: true,
    clickableRows: panel.querySelectorAll('.tr-ds-dataset-row.tr-ds-row-clickable').length,
    totalRows: rows.length,
    title: overlay.querySelector('.tr-ds-preview-title').textContent,
    summary: overlay.querySelector('.tr-ds-preview-summary').textContent,
    textLen: body.length,
    underBudget: body.length <= 20000,
    startsWithCollection: body.indexOf('"type": "FeatureCollection"') >= 0,
    truncationLine: (body.match(/\/\/ .*/) || [null])[0],
    focused: document.activeElement === overlay,
  };
});

await page.screenshot({ path: path.join(OUT, '1-preview-open.png') });

// ---- 2. Copy = exactly what is shown ----
await page.click('.tr-ds-preview-copy');
await page.waitForTimeout(300);
out.copy = await page.evaluate(() => {
  const shown = document.querySelector('.tr-ds-preview-body').textContent;
  const status = document.querySelector('.tr-ds-preview-status').textContent;
  return navigator.clipboard.readText().then((clip) => ({
    // Windows normalizes line endings to CRLF in the clipboard.
    equal: clip.replace(/\r\n/g, '\n') === shown,
    clipLen: clip.length,
    shownLen: shown.length,
    status,
  }));
});

// ---- 3. Download the complete dataset ----
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('.tr-ds-preview-download'),
]);
const file = await download.path();
const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
out.download = {
  name: download.suggestedFilename(),
  type: parsed.type,
  features: parsed.features.length,
  datasetFeatures: await page.evaluate(() => replay.listDatasets()[0].featureCount),
};

// ---- 4. Map behind is inert (wheel over the backdrop must not zoom) ----
// (A plain click on the backdrop closes the modal by design, so inertness is
// probed with the wheel and with the center staying put.)
const zoomBefore = await page.evaluate(() => map.getZoom());
const centerBefore = await page.evaluate(() => { const c = map.getCenter(); return [c.lat, c.lng]; });
await page.mouse.move(60, 450);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(300);
out.mapInert = {
  zoomBefore,
  zoomAfter: await page.evaluate(() => map.getZoom()),
  stillOpen: await overlayOpen(),
  centerMoved: await page.evaluate((before) => {
    const c = map.getCenter();
    return Math.abs(c.lat - before[0]) > 1e-9 || Math.abs(c.lng - before[1]) > 1e-9;
  }, centerBefore),
};

// ---- 5. Close paths: Esc, backdrop, ✕ ----
await page.keyboard.press('Escape');
out.escClosed = !(await overlayOpen());

await page.evaluate(() => {
  document.querySelector('.leaflet-trackreplay-datasource .tr-ds-dataset-row').click();
});
await page.mouse.click(60, 450); // the backdrop
out.backdropClosed = !(await overlayOpen());

await page.evaluate(() => {
  document.querySelector('.leaflet-trackreplay-datasource .tr-ds-dataset-row').click();
});
await page.click('.tr-ds-preview-close');
out.closeButtonClosed = !(await overlayOpen());

// ---- 6. A single feature bigger than the whole budget: position slicing ----
await page.evaluate(() => {
  const coordinates = [];
  const times = [];
  for (var i = 0; i < 5000; i++) {
    coordinates.push([116.40 + i * 0.0001, 39.90 + i * 0.0001]);
    times.push(1783014000000 + i * 30000);
  }
  window.bigId = replay.addDataset({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coordinates },
      properties: { layerPath: ['test', 'big'], isTimestampedgeojson: true, times: times },
    }],
  }, { name: 'big-track' });
});
await page.waitForTimeout(200);
out.positionSlice = await page.evaluate(() => {
  const panel = document.querySelector('.leaflet-trackreplay-datasource');
  const rows = [...panel.querySelectorAll('.tr-ds-dataset-row')];
  const row = rows.find((r) => r.querySelector('.tr-ds-dataset-name').textContent === 'big-track');
  row.click();
  const body = document.querySelector('.tr-ds-preview-body').textContent;
  return {
    textLen: body.length,
    underBudget: body.length <= 20000,
    hasFeatures: body.indexOf('"coordinates"') >= 0,
    sliceLine: (body.match(/\/\/ .*/) || [null])[0],
    summary: document.querySelector('.tr-ds-preview-summary').textContent,
    stillResponsive: true,
  };
});

// ---- 7. Dataset removed while its preview is open ----
await page.evaluate(() => { replay.removeDataset(window.bigId); });
await page.waitForTimeout(200);
out.removedWhileOpen = { overlayClosed: !(await overlayOpen()) };

// ---- 8. Second session with tiny budgets: export abort + import guard ----
await page.evaluate(() => {
  window.replay2 = L.trackReplay(map, null, {
    showControls: false, showTimeline: false, showLegend: false,
    showViewFollow: false, showElementToggles: false, showInfoLabels: false,
    showClusterScatterControl: false, showSearch: false,
    showDataSource: true, dataSourceTitle: 'DS2', dataSourceExpanded: true,
    dataSourcePreview: { downloadMaxChars: 100 },
    dataSourceImportMaxChars: 1000,
  });
  replay2.addDataset({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [116.40, 39.90] }, properties: { layerPath: ['x'], popup: 'p1' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [116.41, 39.91] }, properties: { layerPath: ['x'], popup: 'p2' } },
    ],
  }, { name: 'small' });
});

await page.evaluate(() => {
  const panel = document.querySelectorAll('.leaflet-trackreplay-datasource')[1];
  if (!panel.classList.contains('tr-ds-expanded')) { panel.querySelector('.tr-ds-title').click(); }
  panel.querySelector('.tr-ds-dataset-row').click();
});
const downloadAttempt = page.waitForEvent('download', { timeout: 2500 }).then((d) => d, () => null);
await page.click('.tr-ds-preview-overlay .tr-ds-preview-download');
await page.waitForTimeout(400);
out.downloadAborted = {
  gotDownload: !!(await downloadAttempt),
  status: await page.evaluate(() => document.querySelector('.tr-ds-preview-status').textContent),
  reportWarn: await page.evaluate(() => {
    const lines = document.querySelectorAll('.leaflet-trackreplay-datasource')[1].querySelectorAll('.tr-ds-line.tr-ds-warn');
    return lines.length ? lines[lines.length - 1].textContent : null;
  }),
};
await page.click('.tr-ds-preview-close');

await page.evaluate(() => {
  const panel = document.querySelectorAll('.leaflet-trackreplay-datasource')[1];
  const ta = panel.querySelector('.tr-ds-paste');
  ta.value = 'x'.repeat(1100);
  ta.parentNode.querySelector('button').click();
});
await page.waitForTimeout(200);
out.importGuard = await page.evaluate(() => {
  const lines = document.querySelectorAll('.leaflet-trackreplay-datasource')[1].querySelectorAll('.tr-ds-line');
  const last = lines.length ? lines[lines.length - 1] : null;
  return {
    klass: last ? last.className : null,
    text: last ? last.textContent : null,
    datasets: replay2.listDatasets().length,
  };
});
await page.screenshot({ path: path.join(OUT, '2-second-session.png') });

// ---- 9. Format help: general rules + one column per input shape ----
out.formatHelp = await page.evaluate(() => {
  const panel = document.querySelectorAll('.leaflet-trackreplay-datasource')[0];
  if (!panel.classList.contains('tr-ds-expanded')) { panel.querySelector('.tr-ds-title').click(); }
  panel.querySelector('.tr-ds-format-link').click();
  const overlay = document.querySelector('.tr-ds-preview-overlay');
  if (!overlay) { return { opened: false }; }
  const columns = [...overlay.querySelectorAll('.tr-ds-format-shape')].map((c) => {
    const example = c.querySelector('.tr-ds-format-shape-example').textContent;
    let valid = false;
    try { JSON.parse(example); valid = true; } catch (e) { valid = false; }
    const py = c.querySelector('.tr-ds-format-shape-python');
    return {
      name: c.querySelector('.tr-ds-format-shape-name').textContent,
      rules: c.querySelectorAll('.tr-ds-format-shape-rules .tr-ds-format-line').length,
      captions: [...c.querySelectorAll('.tr-ds-format-shape-caption')].map((d) => d.textContent),
      exampleLen: example.length,
      exampleValid: valid,
      pythonLen: py ? py.textContent.length : 0,
      pythonHead: py ? py.textContent.slice(0, 18) : null,
      pythonNote: py && c.querySelector('.tr-ds-format-caption-note')
        ? c.querySelector('.tr-ds-format-caption-note').textContent
        : null,
      noteExplainsWhy: (() => {
        const n = c.querySelector('.tr-ds-format-caption-note');
        return !!n && /打印|print/i.test(n.textContent) && /GeoJSON/i.test(n.textContent);
      })(),
      buttons: [...c.querySelectorAll('.tr-ds-format-shape-foot button')].map((b) => b.textContent),
    };
  });
  // The last column is the mixed collection: it must parse as a
  // FeatureCollection carrying one feature of each shape.
  const mixedEl = overlay.querySelectorAll('.tr-ds-format-shape')[columns.length - 1];
  let mixed = null;
  try {
    const parsed = JSON.parse(mixedEl.querySelector('.tr-ds-format-shape-example').textContent);
    mixed = { type: parsed.type, features: parsed.features.length };
  } catch (e) { mixed = null; }

  return {
    opened: true,
    title: overlay.querySelector('.tr-ds-preview-title').textContent,
    generalRules: overlay.querySelectorAll('.tr-ds-format-lines .tr-ds-format-line').length,
    columns,
    mixed,
  };
});
await page.screenshot({ path: path.join(OUT, '3-format-help.png') });

// Per-column Copy (column 2 = the event marker) flashes its own button label.
await page.evaluate(() => {
  document.querySelectorAll('.tr-ds-format-shape')[1].querySelector('.tr-ds-format-copy').click();
});
await page.waitForTimeout(250);
out.formatCopyColumn = await page.evaluate(() => {
  const col = document.querySelectorAll('.tr-ds-format-shape')[1];
  return navigator.clipboard.readText().then((t) => ({
    equal: t.replace(/\r\n/g, '\n') === col.querySelector('.tr-ds-format-shape-example').textContent,
    buttonFlashed: col.querySelector('.tr-ds-format-copy').textContent,
  }));
});

// Per-column Copy Python copies that column's generator snippet instead.
await page.evaluate(() => {
  document.querySelectorAll('.tr-ds-format-shape')[0].querySelector('.tr-ds-format-copy-python').click();
});
await page.waitForTimeout(250);
out.formatCopyPython = await page.evaluate(() => {
  const col = document.querySelectorAll('.tr-ds-format-shape')[0];
  return navigator.clipboard.readText().then((t) => ({
    equal: t.replace(/\r\n/g, '\n') === col.querySelector('.tr-ds-format-shape-python').textContent,
    buttonFlashed: col.querySelector('.tr-ds-format-copy-python').textContent,
  }));
});

// The snippets must be self-contained — no importing this project's module.
out.formatPythonSelfContained = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('.tr-ds-format-shape-python')]
    .map((p) => p.textContent.slice(0, 120));
  return {
    importsNothing: heads.every((h) => h.indexOf('convert') < 0 && h.indexOf('import track') < 0),
    heads,
  };
});

// And every column's snippet must really run: copy it out of the page, hand
// it to Python untouched, and inspect what its own print() produced — the
// "copy, edit, use" promise, checked per column (the last one is the full
// mixed script).
out.pythonSnippets = [];
for (let idx = 0; idx < 5; idx++) {
  const text = await page.evaluate((i) => document.querySelectorAll('.tr-ds-format-shape')[i]
    .querySelector('.tr-ds-format-shape-python').textContent, idx);
  const file = path.join(os.tmpdir(), 'tr-snippet-' + idx + '.py');
  fs.writeFileSync(file, text, 'utf8');
  const rec = {
    column: idx + 1,
    hasPrint: text.indexOf('print(') >= 0,
    importsProject: /(from|import)\s+convert/.test(text),
  };
  try {
    const parsed = JSON.parse(execFileSync('python', [file], { encoding: 'utf8' }));
    const feats = Array.isArray(parsed) ? parsed : parsed.features;
    rec.ok = true;
    rec.returned = Array.isArray(parsed) ? 'list' : parsed.type;
    rec.features = feats.length;
    rec.geoms = feats.map((f) => f.geometry.type);
    rec.elements = feats.map((f) => f.properties.element || 'static');
    const p = feats[0].properties;
    rec.lens = p.times
      ? [feats[0].geometry.coordinates.length, p.times.length,
        (p.speeds || []).length, (p.popups || []).length]
      : null;
  } catch (err) {
    rec.ok = false;
    rec.error = String(err.message).slice(0, 200);
  }
  out.pythonSnippets.push(rec);
}

// Per-column Fill puts THAT column's example into the paste box.
await page.evaluate(() => {
  document.querySelectorAll('.tr-ds-format-shape')[1].querySelector('.tr-ds-format-fill').click();
});
out.formatFillColumn = await page.evaluate(() => {
  const ta = document.querySelectorAll('.leaflet-trackreplay-datasource')[0].querySelector('.tr-ds-paste');
  let parsed = null;
  try { parsed = JSON.parse(ta.value); } catch (e) { parsed = null; }
  return {
    modalClosed: !document.querySelector('.tr-ds-preview-overlay'),
    validJson: !!parsed,
    focused: document.activeElement === ta,
    element: parsed && parsed.properties ? parsed.properties.element : null,
    layerPathKey: parsed && parsed.properties ? parsed.properties.layerPath.join('/') : null,
  };
});

// ...and the filled example actually imports.
await page.evaluate(() => {
  const panel = document.querySelectorAll('.leaflet-trackreplay-datasource')[0];
  panel.querySelector('.tr-ds-paste').parentNode.querySelector('button').click();
});
await page.waitForTimeout(300);
out.formatFillImport = await page.evaluate((key) => ({
  datasets: replay.listDatasets().length,
  objectAdded: Object.keys(replay.allLayers).indexOf(key) >= 0,
  boxCleared: document.querySelectorAll('.leaflet-trackreplay-datasource')[0]
    .querySelector('.tr-ds-paste').value === '',
}), out.formatFillColumn.layerPathKey);

// ---- 10. The Python converter's output imports and plays ----
// Prerequisite: `python examples/convert.py` (writes examples/demo-track.geojson)
const convertedUrl = new URL('examples/demo-track.geojson', import.meta.url);
if (!fs.existsSync(convertedUrl)) {
  out.converterImport = { skipped: 'missing examples/demo-track.geojson — run: python examples/convert.py' };
} else {
const convertedText = fs.readFileSync(convertedUrl, 'utf8');
const beforeConvert = await page.evaluate(() => ({
  datasets: replay.listDatasets().length,
  indicators: replay.movingIndicators.length,
}));
await page.evaluate((text) => {
  const panel = document.querySelectorAll('.leaflet-trackreplay-datasource')[0];
  const ta = panel.querySelector('.tr-ds-paste');
  ta.value = text;
  ta.parentNode.querySelector('button').click();
}, convertedText);
await page.waitForTimeout(400);
out.converterImport = await page.evaluate((prev) => {
  const owner = replay.allLayers['示例/步行'];
  const segLayer = owner && owner.trackLayer ? owner.trackLayer.getLayers()[0] : null;
  const popup = segLayer && segLayer.getPopup ? segLayer.getPopup() : null;
  return {
    datasets: replay.listDatasets().length,
    addedOne: replay.listDatasets().length === prev.datasets + 1,
    objectAdded: !!owner,
    segments: owner && owner.trackLayer ? owner.trackLayer.getLayers().length : null,
    points: owner && owner.pointLayer ? owner.pointLayer.getLayers().length : null,
    elements: owner ? owner.elements.map((e) => e.key) : null,
    indicatorAdded: replay.movingIndicators.length === prev.indicators + 1,
    popupHasSpeed: !!(popup && String(popup.getContent()).indexOf('速度') >= 0),
  };
}, beforeConvert);
}

console.log(JSON.stringify({ out, errs }, null, 1));
await ctx.close();
