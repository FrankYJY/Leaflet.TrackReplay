<!-- canonical: HUMAN-USAGE.zh.md；mirror: 本文件；consistency check: node _docs_check.mjs -->

# Leaflet.TrackReplay — Getting started

This guide answers four questions: **how to get it running**, **where the data comes from**, **how to configure the common parts**, and **how to fix what goes wrong**.
The full option/method reference and internals live in the [README](../README.md); for how the pieces fit together, see the [architecture diagrams](architecture.html).

## 1. What it is

Leaflet.TrackReplay is a Leaflet plugin that puts **timestamped GeoJSON tracks** on a map and replays them against one shared timeline. Several tracks play together, are split into per-object layers, and can be toggled per element type; datasets can be added or removed at any time without losing the playback time or the UI state.

The plugin is not a standalone app; it is a **session** attached to an `L.Map` you create. Your page is the **host**: it owns the map, the basemap, the data and the options, while the plugin turns that data into replayable layers and controls. The example in section 2 is the smallest possible host page.

Good for: GPS track replay, vehicle/personnel movement review, points and events layered on top of time-annotated data.

## 2. Five-minute start

The block below is a **minimal host page**: create the map → add a basemap → pass data → hand it to the plugin. Save it as `index.html` and open it (internet access is needed for Leaflet and the plugin):

<!-- BEGIN HELLO-WORLD -->
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>TrackReplay minimal</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="https://unpkg.com/leaflet-trackreplay@0.1.0/dist/leaflet-trackreplay.css">
  <style>html, body, #map { height: 100%; margin: 0; }</style>
</head>
<body>
  <div id="map"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet-trackreplay@0.1.0/dist/leaflet-trackreplay.iife.js"></script>
  <script>
    var map = L.map('map').setView([39.91, 116.41], 14);   // [lat, lng]
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    var data = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[116.40, 39.90], [116.41, 39.91], [116.42, 39.92]]  // [lng, lat]
        },
        properties: {
          layerPath: ['demo', 'track1'],
          isTimestampedgeojson: true,
          times: [1700000000000, 1700000060000, 1700000120000],  // ms, ascending
          drawMovingIndicator: true
        }
      }]
    };

    var replay = L.trackReplay(map, data, { speed: 60 });  // 60× = 1 s per minute
    replay.play();
  </script>
</body>
</html>
```
<!-- END HELLO-WORLD -->

### npm and bundlers

```bash
npm install leaflet leaflet-trackreplay
```

Every build expects a **global `L`** at execution time (the plugin never imports Leaflet for you). In a bundler, make `L` global before the plugin module executes:

```js
import L from 'leaflet';
window.L = L;
await import('leaflet-trackreplay');   // needs top-level await; otherwise use a dynamic-import callback
```

With plain `<script>` tags there is no such problem: Leaflet first, plugin second, in that order.

### Four causes of a blank map

1. The map container has no explicit height (`#map { height: 100% }` and `html, body` need heights too).
2. The plugin CSS is not loaded (controls are misplaced or invisible).
3. The data failed validation (check the console for a `times.length` error).
4. The plugin never frames the map — call `setView` or `fitBounds` yourself.

## 3. Where the data comes from

### Path 1: the data source panel (no code)

Pass `showDataSource: true` and a panel appears in the top-left corner:

- **Drag & drop** a `.geojson` / `.json` / `.gpx` file onto the map;
- **File picker**, **paste** text, or enter a **URL** (CORS or same-origin required);
- Built-in **sample** buttons (`dataSourceSamples`).

Each import is one **dataset** and can be removed on its own. Clicking a dataset row previews its raw data (bounded, with an explicit truncation notice); the complete dataset can be downloaded. Failed imports and GPX segments without timestamps are reported in one line at the bottom of the panel.

### Path 2: generate with Python

The repo ships [`examples/convert.py`](../examples/convert.py) (standard library only):

```python
import sys
sys.path.insert(0, "examples")
from convert import track, event, background_nodes, area, write_geojson

fc = {
    "type": "FeatureCollection",
    "features": [
        track([(1700000000, 116.40, 39.90), (1700000060, 116.41, 39.91)], ["demo", "t1"]),
        event([116.41, 39.91], ["demo", "t1"], popup="arrived"),
        background_nodes([[116.40, 39.90], [116.42, 39.92]], ["ctx", "samples"],
                         popups=["sample 1", "sample 2"]),
        area([[116.39, 39.89], [116.43, 39.89], [116.43, 39.93]], ["ctx", "area"]),
    ],
}
write_geojson(fc, "demo.geojson")
```

Time values may be `datetime`, seconds or milliseconds; `convert.py` normalises everything to milliseconds. Omit `speeds` and the plugin computes them.

### Path 3: write GeoJSON yourself

Follow the rules in section 4. Start from a minimal track and add events, background nodes and static areas as needed.

### Path 4: GPX

Importing through the panel is easiest. In code:

```js
var r = L.TrackReplay.Utils.GPX.parseGPX(gpxText, { layerPath: ['imported', 'ride'] });
replay.addDataset(r.featureCollection);
```

Segments without `<time>` become static lines (they cannot participate in playback); `r.report.staticSegments` tells you how many.

### Path 5: let an AI write it

Paste the whole of [`docs/LLM-PROMPT.en.md`](LLM-PROMPT.en.md) followed by your requirement — see section 9.

## 4. Data format cheat sheet

A minimal timestamped track:

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [[116.40, 39.90], [116.41, 39.91]]
  },
  "properties": {
    "layerPath": ["demo", "track1"],
    "isTimestampedgeojson": true,
    "times": [1700000000000, 1700000060000]
  }
}
```

**Six rules**:

1. A timestamped track must be a `LineString` with at least 2 points; any other geometry is silently dropped.
2. Coordinates are `[lng, lat]` — the reverse of `setView`'s `[lat, lng]`.
3. `times` has the same length as the coordinates, strictly ascending, in milliseconds (the unit is read from the first value only).
4. `speeds` / `styles` / `popups` have length = points − 1; `pointPopups` = points. **Omit arrays you do not have — never pass `[]`.**
5. `layerPath` must be an array of strings.
6. Features without `times` are plain GeoJSON: events, static areas and background nodes go this way and do not participate in playback.

Minimal shapes and field tables for events, background nodes and static areas are in the [README data-format section](../README.md#timestampedgeojson-format) and in [`docs/LLM-PROMPT.en.md`](LLM-PROMPT.en.md), sections 4–5.

## 5. What is on the screen

| Control | Default | Notes |
|---|---|---|
| Playback bar | on | Play/pause, stop, speed ladder, loop; merged with the timeline into one box |
| Timeline | on | Drag to seek; double-click to type a time; the **date line** below shows weekday, day N/M, holidays/workdays and the zone |
| Layer tree | on | Every object split into elements (track / points / traveled / untraveled / indicator / events / static / background_nodes), toggled individually |
| Batch toggles | on | One tri-state checkbox per element type across all objects, with an `on/total` count |
| Batch labels | on | Batch-opens the objects' real popups (not look-alike labels) |
| View follow | on | Follow latest / random / a named object, or off |
| Cluster / scatter | when background nodes exist | Switch background nodes between clustered and scatter |
| Colour legend | on | The current speed ramp |
| Data source panel | off | Path 1 above |
| Multi-hit search | off | Search label text; every occurrence is a hit; Enter / ◀ / ▶ cycles |
| Keyboard | — | No global shortcuts: focus a control first (playback bar: Space / ← → / 0-9 / R) |

## 6. Common configuration

### Speed

The default is `speed: 60` — **1 second = 1 minute**. The ladder runs from `0.25×` to `3600×` (1 second = 1 hour); override it with `speedOptions`.

### Colour

```js
L.trackReplay(map, data, {
  colorMode: 'fixed',      // 'fixed' | 'adaptive' | 'custom'
  colorRange: [0, 120],    // km/h range for fixed mode
});
```

`adaptive` uses the data's P5–P95 range; `custom` needs a `colorConfig` (branca-style ramp).

### Time zone and holidays

```js
var replay = L.trackReplay(map, data, {
  displayTimeZone: 'local',   // or 8, or 'Asia/Shanghai'
  showDateInfo: true,
});
```

The holiday table is fetched by the host and injected (the plugin ships none — the dates change every year). The yearly JSON from [chinese-days](https://github.com/vsme/chinese-days) matches our shape exactly:

```js
fetch('https://cdn.jsdelivr.net/npm/chinese-days/dist/years/2025.json')
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (table) {
    if (table) { replay.setCalendar(table); }   // no rebuild; the date line updates at once
  });
```

- Keys are dates **in the display zone**; when a date is both a holiday and a workday, the workday wins.
- Cache per year (e.g. `localStorage`); do not bundle the yearly JSON into the page.
- `setTimeZone()` / `setCalendar()` are session methods; neither rebuilds the layers.

### Basemaps and GCJ-02

AMap/Tencent basemaps use GCJ-02 (the "Mars" datum). If your data is WGS-84:

```js
L.trackReplay(map, data, { dataDatum: 'wgs84', mapDatum: 'gcj02' });
```

The conversion happens once during parsing; every layer then works in the basemap's own frame. Hand your basemaps to the plugin as `baseLayers: [{ label, layer }]` and they appear as a radio group in the layer tree.

### Localised UI

Every string can be replaced: `playbackLabels`, `elementLabels`, `dataSourceLabels` / `dataSourceMessages`, `searchLabels` / `searchMessages`, `dateInfoLabels` / `dateInfoMessages`, `clusterScatterLabels`. Key names are in the [README option table](../README.md#options).

## 7. Adding and removing data at runtime

```js
var replay = L.trackReplay(map, null, { showDataSource: true }); // empty session

var id = replay.addDataset(fc, { name: 'first run' });  // one dataset
replay.addDataset([f1, f2]);                            // still ONE dataset with two features
replay.removeDataset(id);                               // remove only that dataset
replay.clearDatasets();                                 // clear all data; session stays alive
```

- **Merge rule**: features with the same `layerPath` in different datasets merge into one object; removing one dataset keeps the rest.
- **State preservation**: adding/removing data rebuilds the layers, but the current time, speed, loop, per-element visibility, label checkboxes, follow mode and panel states are restored.
- Top-level array trap: `L.trackReplay(map, [f1, f2])` creates **two datasets**; for one dataset use a `FeatureCollection` or `[[f1, f2]]`.

Events share one bus with playback:

```js
replay.on('datasetadd', function (e) { console.log(e.id, e.name, e.total); });
replay.on('tick', function (e) { /* e.time, e.progress */ });
```

## 8. Methods and events

Common methods:

| Method | Purpose |
|---|---|
| `play()` / `pause()` / `stop()` | Playback control |
| `seek(ms)` / `seekByProgress(p)` | Seek |
| `setSpeed(n)` / `getSpeed()` | Speed |
| `getCurrentTime()` / `getProgress()` / `getState()` | Read state |
| `addDataset()` / `removeDataset(id)` / `clearDatasets()` | Data management |
| `setTimeZone(tz)` / `setCalendar(table)` | Time zone and holidays (no rebuild) |
| `on(event, fn)` / `off(event, fn)` | Events |
| `destroy()` | Tear everything down |

The full method table (25) and event table (10) are in the [README](../README.md#instance-methods) and in [`LLM-PROMPT.en.md` section 6](LLM-PROMPT.en.md).

## 9. Let an AI write it (using the prompt pack)

`docs/LLM-PROMPT.en.md` (English) and `docs/LLM-PROMPT.zh.md` (Chinese) are **self-contained spec packs**: no repo access, no source reading.

**How to concatenate**:

```text
<the entire LLM-PROMPT.en.md content>

--- YOUR REQUIREMENT ---
<what you need + raw data samples (state the column order) + existing code / errors>
```

**Two prompt templates**:

```text
Following the spec above, turn these (time, lng, lat) rows into replayable GeoJSON.
Also give me a runnable Python script that prints that data.

2025-10-01 08:00:00, 116.40, 39.90
2025-10-01 08:01:00, 116.41, 39.91
```

```text
Following the spec above, write a complete host page (index.html): map + track replay + playback bar,
an OpenStreetMap basemap, and three event markers on the map.
```

**Notes**:

1. **Paste one language only** — never both packs.
2. The model should end with **self-check results**; if it doesn't, ask it to run section 10.
3. Keep versions aligned: the pack pins `leaflet-trackreplay@0.1.0`; if your project uses another version, change the URLs.
4. Do not also paste the README or repo paths — the pack is self-contained.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank map / a thin grey strip | No container height, CSS not loaded | Give the container an explicit height; load the plugin CSS |
| Track does not appear | Not a `LineString`, or `times` length mismatch | Check the console for a `times.length` error; match the lengths |
| Dots land in the ocean | Coordinates written as `[lat, lng]` | Change to `[lng, lat]` |
| Playback ends immediately | `times` not ascending, or seconds vs ms misread | Sort ascending; use one unit (ms) |
| No speed colours | `style: {}` or a `color` inside `styles` | Remove the empty `style`; leave colour to the ramp |
| Static feature has no colour | Used `properties.color` | Use `properties.style.color` |
| Background nodes have no popups | `popups[]` length does not match the points | Match the count or drop the array |
| Point popups are wrong | `pointPopups` length is not the point count | Set it to the point count |
| Panel import does nothing | Text exceeds `dataSourceImportMaxChars` (5e7 by default) | Reduce the data or raise the limit |
| Everything is offset on an AMap basemap | Datums not paired | `mapDatum: 'gcj02'` (and `dataDatum` if needed) |

## 11. More

- [README](../README.md) — the complete options, methods, events and implementation notes
- [Architecture](architecture.html) — layers, data journey, rebuild lifecycle
- [Python host guide](python-host/GUIDE.en.md) — serve the page, assets and data API from Python
- [`examples/convert.py`](../examples/convert.py) — the Python converter
- [`examples/`](../examples/) — local demo server (`python examples/server.py`)
- [`docs/LLM-PROMPT.en.md`](LLM-PROMPT.en.md) — the LLM spec pack
