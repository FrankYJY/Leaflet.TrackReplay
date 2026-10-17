# Leaflet.TrackReplay integration spec (v0.1.0)

> **For the model**: this is the complete public contract of Leaflet.TrackReplay. It is enough to produce runnable data and integration code — no codebase access is needed. Everything is self-contained: identifiers, defaults, array-length rules and failure behavior are all here.

## 1. Your job and the rules

You are helping the user work with **Leaflet.TrackReplay**, a Leaflet plugin that replays timestamped GeoJSON tracks against a shared timeline.

The user's requirement follows this document (possibly after a `--- USER REQUIREMENT ---` line, possibly immediately). Decide the task type first (section 9), then answer.

Rules, in priority order:

1. **Closed world**: use only the identifiers listed here — options, methods, events, property names. Anything not in this document does not exist; if you need it, say what is missing and ask the user. **Do not invent** (unknown options are silently ignored, so the mistake never surfaces as an error).
2. Generated code must be complete and runnable: no `...`, no references to files or variables that do not exist.
3. Data coordinates are always `[lng, lat]`; `map.setView` / `L.marker` take `[lat, lng]`. The order is reversed between the two, and getting it wrong often fails silently — the dots just land in the ocean.
4. Before answering, run the checklist in section 10 and report the results and your assumptions at the end.
5. If the requirement needs something this document does not cover (undocumented customization, another library), say "not covered by this spec" — do not guess.

## 2. Minimal contract (independently copyable)

<!-- BEGIN MINIMAL CONTRACT -->

**Dependencies and load order**

1. Leaflet 1.7+ must load first; the plugin attaches to the global `L` (every build expects a global `L` at execution time — even the ESM build does not import Leaflet for you).
2. The plugin CSS must be loaded; the map container needs an explicit height (otherwise the map is a blank strip).
3. Bundlers: make `L` global before the plugin module executes, e.g.
   `import L from 'leaflet'; window.L = L; await import('leaflet-trackreplay');`.
4. What you produce is a **host page**: it creates the map, the basemap and the container height. The plugin ships **no basemap** and never calls `fitBounds`.

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

**10 invariants**

1. One timestamped track = one `LineString` Feature; timestamped features with any other geometry are **silently dropped**.
2. `coordinates` is `[[lng, lat], ...]` with at least 2 points.
3. `properties.isTimestampedgeojson` must be boolean `true` (spelled with a lowercase `edgeojson`).
4. `properties.times` is a numeric array whose length equals the number of coordinates, **strictly ascending**, in milliseconds (see the unit rule in section 4).
5. `properties.layerPath` must be an array of strings, e.g. `["group", "object"]`; a string crashes the parser.
6. `speeds` / `styles` / `popups` have length = points − 1; `pointPopups` has length = points. **Omit any array you do not have — never pass `[]`.**
7. When `speeds` is omitted the plugin computes them from Haversine distance ÷ time delta (km/h).
8. Features without timestamps are plain GeoJSON: events, static areas, background nodes. They do not participate in the playback timeline.
9. The plugin provides no basemap and does not frame the map; container height and the plugin CSS are the host's job.
10. The timeline spans the earliest `times[0]` to the latest `times[last]` across all tracks; adding or removing datasets rebuilds the layers while preserving the current time, speed, visibility and other UI state.

<!-- END MINIMAL CONTRACT -->

## 3. Entry points and session semantics

### 3.1 Constructor: three shapes

```js
L.trackReplay(map, featureCollection, options);  // one dataset
L.trackReplay(map, [fc1, fc2], options);         // two datasets
L.trackReplay(map, null, options);               // empty session, addDataset later
```

**Trap**: a top-level array means "list of datasets", not "list of features". `L.trackReplay(map, [f1, f2])` creates two datasets, one per feature. To put two features in one dataset, use a `FeatureCollection` or wrap again: `L.trackReplay(map, [[f1, f2]])`.

### 3.2 Adding and removing at runtime

```js
var id = replay.addDataset(featureCollectionOrFeatureOrArray, { name: 'x' }); // → numeric id
replay.addDataset([f1, f2]);        // ONE dataset containing two features
replay.removeDataset(id);           // removes exactly that dataset's contribution
replay.clearDatasets();             // remove all data; the session stays alive
replay.listDatasets();              // [{ id, name, featureCount }]
replay.getDataset(id);              // { id, name, featureCollection } | null
replay.destroy();                   // remove all layers, controls and listeners
```

- One `addDataset` = one dataset = the atomic unit of removal.
- Features with an identical `layerPath` across datasets are **merged into one object**; removing one dataset keeps the remaining parts.
- New data outside the current time range expands the timeline automatically.
- After `clearDatasets()` the session is still usable; `destroy()` tears everything down for good.

### 3.3 `layerPath` defaults differ by entry point

| Entry point | Missing `layerPath` |
|---|---|
| `L.trackReplay` / `addDataset` (programmatic) | the parser falls back to `['default']` |
| Data source panel import (paste / file / URL / drop) | filled as `['imported', file name or 'Pasted data']` |

### 3.4 Empty session

`L.trackReplay(map, null)` builds no playback controls at all (no playback bar, timeline, legend or layer tree), though session-level controls (data source panel, search) still appear when enabled. The first `addDataset` builds everything.

Empty-session return values: `getCurrentTime()` → `null`, `getState()` → `'stopped'`, `getProgress()` → `0`, `getSpeed()` → `1`, `getLegend()` → `[]`; `play()` / `pause()` and friends are no-ops.

### 3.5 GPX (browser only)

```js
var r = L.TrackReplay.Utils.GPX.parseGPX(gpxText, { layerPath: ['gpx', 'ride'] });
replay.addDataset(r.featureCollection);
// r.report = { segments, timedSegments, staticSegments, points, waypoints }
```

GPX segments without `<time>` degrade to static lines (they cannot participate in playback); `report.staticSegments` tells you how many degraded.

## 4. Timestamped track format

### 4.1 A complete dataset

<!-- BEGIN JSON-EXAMPLE -->
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [[116.400, 39.900], [116.410, 39.910], [116.420, 39.920]]
      },
      "properties": {
        "layerPath": ["demo", "track1"],
        "isTimestampedgeojson": true,
        "times": [1700000000000, 1700000060000, 1700000120000],
        "speeds": [12.5, 13.8],
        "popups": ["segment 1", "segment 2"],
        "pointPopups": ["node 1", "node 2", "node 3"],
        "style": { "color": "#3388ff", "weight": 4 },
        "drawMovingIndicator": true
      }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [116.410, 39.910] },
      "properties": {
        "layerPath": ["demo", "track1"],
        "element": "events",
        "popup": "<b>arrived</b>",
        "style": { "color": "#e74c3c", "radius": 12 }
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "MultiPoint",
        "coordinates": [[116.405, 39.905], [116.415, 39.915]]
      },
      "properties": {
        "layerPath": ["context", "samples"],
        "element": "background_nodes",
        "popups": ["sample 1", "sample 2"],
        "style": { "fillColor": "#6b7785" }
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[116.395, 39.895], [116.425, 39.895], [116.425, 39.925], [116.395, 39.925], [116.395, 39.895]]]
      },
      "properties": {
        "layerPath": ["context", "area"],
        "popup": "study area",
        "style": { "color": "#ff7800", "fillOpacity": 0.1 }
      }
    }
  ]
}
```
<!-- END JSON-EXAMPLE -->

The example contains one timestamped track, one event point, one background-node group and one static polygon — all in a single `FeatureCollection`.

### 4.2 Timestamped track fields

| Property | Required | Type | Length | Notes |
|---|---|---|---|---|
| `layerPath` | yes | `string[]` | — | Hierarchical path; the same path means the same object |
| `isTimestampedgeojson` | yes | `boolean` | — | Must be `true` |
| `times` | yes | `number[]` | number of points | Timestamps; unit rule in 4.3 |
| `speeds` | no | `number[]` | points − 1 | km/h; computed when omitted |
| `styles` | no | `object[]` | points − 1 | Per-segment Leaflet path style, merged over the base style |
| `popups` | no | `string[]` | points − 1 | Per-segment popup (HTML) |
| `pointPopups` | no | `string[]` | number of points | Per-point popup (HTML) |
| `style` | no | `object` | — | Base style for the whole track |
| `color` | no | `string` | — | Shorthand for `style.color` (**timestamped tracks only**) |
| `drawMovingIndicator` | no | `boolean` | — | Show the moving indicator (off by default) |
| `layerVisibility` | no | `boolean` | — | Initial visibility; only strict `false` hides |

### 4.3 Time unit and ordering

- The unit is decided from **`times[0]` alone**: `> 1e12` means milliseconds, otherwise seconds (the whole array is multiplied by 1000). Mixed units are not detected.
- Millisecond values before 2001-09-09 are ≤ 1e12 and are read as seconds — send seconds for such data.
- Timestamps **must be strictly ascending** (not validated). The plugin uses `times[0]` and `times[last]` as the timeline bounds; unsorted data finishes playback immediately or reports nonsense progress.
- Duplicate timestamps do not error, but the segment speed becomes 0.

### 4.4 Style and popup precedence

- Base style = `properties.style` (preferred) or `properties.color` (a `{ color }` shorthand); neither means no base style.
- Per-segment style = base style overridden by `styles[i]`. A `styles[i]` with only `weight` still takes its colour from the speed ramp.
- No `styles` and a base style → the track is not split; it uses the base style.
- No base style and no `styles` → every segment is coloured by speed.
- Any `popups` → the track is split per segment even when it has a base style (popups must bind per segment).
- Careful: `style: {}` (an empty object) is truthy and **disables** speed colouring.

### 4.5 Validation and failure behavior

| Situation | Actual behavior |
|---|---|
| `times.length !== coordinates.length` | `console.error`, **the feature is skipped** (it does not fall back to a static feature) |
| Fewer than 2 points | silently skipped |
| Timestamped geometry is not `LineString` | silently skipped |
| `times` not ascending | not validated; the timeline takes first/last, so playback may finish immediately |
| `pointPopups.length` is not the point count | `console.error`, the whole array becomes null; the track still renders, and point popups fall back to the containing segment's `popups[i]` |
| `speeds` / `styles` / `popups` have the wrong length | not validated; missing entries mean no speed colour or no popup, extra entries are ignored |
| Passing `[]` | an empty array is truthy: `speeds: []` suppresses computation, `styles: []` forces splitting, `pointPopups: []` errors. **Omit instead** |
| `layerPath` is a string | crashes during parsing (calls `.join` on it); it must be an array |
| `background_nodes` `popups[]` / `styles[]` length mismatch | the whole array is ignored (`console.error`), defaults are used |
| `background_nodes` is not Point / MultiPoint | `console.warn`, the feature is skipped |

## 5. Static features, events and background nodes

### 5.1 Plain static features

Any feature without `isTimestampedgeojson` is plain GeoJSON: any geometry type works (Point / MultiPoint / LineString / Polygon / MultiPolygon / GeometryCollection).

| Property | Notes |
|---|---|
| `layerPath` | Same rule as tracks; the same path belongs to the same object |
| `popup` | Popup content (HTML string), opened on click |
| `style` | Leaflet path / circleMarker style |
| `layerVisibility` | Initial visibility (only strict `false` hides) |

- **Static features do not read `properties.color`** — put the colour in `properties.style.color`.
- Point / MultiPoint render as unfilled rings by default: `{ radius: 10, color: '#e74c3c', weight: 2, fill: false }`; `style` overrides it (`fill: true` for a solid dot).

### 5.2 `element`: which bucket a feature lands in

| `element` | Destination |
|---|---|
| absent or `"static"` | the generic static bucket, drawn **beneath** the tracks |
| `"events"` | that object's events element layer, drawn **above** the tracks |
| `"background_nodes"` | reserved; routed to the background-node layer (5.3) |
| any other string | a custom element layer for that object, above the tracks, labelled `elementLabels[name]` or the name itself |

- `element` only applies to **non-timestamped** features; timestamped tracks always go to the track/points layers.
- `elementLabels` covers only the 8 fixed keys (`track`, `points`, `static`, `events`, `background_nodes`, `traveled`, `untraveled`, `indicator`); custom bucket names cannot be renamed through it.

### 5.3 Background nodes (`element: "background_nodes"`)

Two forms, mixable:

```json
{ "type": "Feature",
  "geometry": { "type": "MultiPoint", "coordinates": [[116.40, 39.90], [116.41, 39.91]] },
  "properties": {
    "layerPath": ["background", "samples"],
    "element": "background_nodes",
    "popups": ["sample 1", "sample 2"],
    "styles": [{ "radius": 6 }, { "radius": 3 }],
    "style": { "fillColor": "#6b7785" }
  } }
```

```json
{ "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [116.40, 39.90] },
  "properties": {
    "layerPath": ["background", "samples"],
    "element": "background_nodes",
    "popup": "sample 1",
    "style": { "fillColor": "#e67e22", "radius": 5 }
  } }
```

- Only **Point / MultiPoint** are accepted; other geometry is skipped with a `console.warn`.
- `popups[]` and `styles[]` must match the coordinate count exactly, otherwise **the whole array is ignored**.
- Rendered as small clickable dots beneath the tracks; scatter by default, clustering requires `L.markerClusterGroup` at runtime (`backgroundNodesOptions.cluster: true`).
- Style precedence: defaults < `properties.style` < `properties.styles[i]`.

## 6. Runtime API

### 6.1 The options you will use most

| Option | Default | Notes |
|---|---|---|
| `speed` | `60` | Initial multiplier; 60× means "1 second = 1 minute" |
| `speedOptions` | `[0.25, 0.5, 1, 2, 4, 8, 60, 600, 3600]` | Speed ladder |
| `loop` | `false` | Restart when finished |
| `colorMode` | `'fixed'` | `'fixed'` / `'adaptive'` / `'custom'` |
| `colorRange` | `[0, 200]` | km/h range for the `'fixed'` ramp |
| `showControls` | `true` | Playback bar |
| `showTimeline` | `true` | Timeline (merged with the playback bar into one box) |
| `controlBarPosition` | `'bottomleft'` | Playback bar corner |
| `showLegend` | `true` | Speed colour legend |
| `showDataSource` | `false` | Data source panel (session-level, survives rebuilds) |
| `showSearch` | `false` | Multi-hit search (session-level) |
| `displayTimeZone` | `'local'` | Timeline zone; `'local'` / hour offset / IANA name |
| `calendar` | — | Holiday table (section 7) |
| `dataDatum` / `mapDatum` | `'wgs84'` | Input and basemap datums; use `'gcj02'` for AMap tiles |
| `baseLayers` | — | `[{ label, layer }]` basemap radio group |

### 6.2 Complete option inventory (68)

**This list is the closed-world boundary: an option name not listed here does not exist.**

<!-- BEGIN OPTIONS -->

**Playback and colour**

| Option | Default | Notes |
|---|---|---|
| `colorMode` | `'fixed'` | `'fixed'` / `'adaptive'` / `'custom'` |
| `colorConfig` | — | branca-style ramp config for `'custom'` |
| `colorRange` | `[0, 200]` | km/h range for `'fixed'` |
| `speed` | `60` | Initial multiplier |
| `speedOptions` | `[0.25, 0.5, 1, 2, 4, 8, 60, 600, 3600]` | Speed ladder |
| `speedLabel` | — | `fn(speed) => string` custom ladder labels |
| `playbackLabels` | English | Playback tooltips `{ stop, play, pause, speed, loop, hint }` |
| `minTickMs` | `16` | Tick floor, keeps high speeds from flooding the loop |
| `loop` | `false` | Restart when finished |
| `tickLen` | `250` | Tick interval (ms) |

**Playback bar, legend and follow**

| Option | Default | Notes |
|---|---|---|
| `showControls` | `true` | Playback bar |
| `showLoop` | `true` | Show the loop toggle |
| `showTimeline` | `true` | Timeline |
| `controlBarPosition` | `'bottomleft'` | Playback bar corner |
| `showLegend` | `true` | Colour legend |
| `legendTitle` | `'Speed (km/h)'` | Legend title |
| `legendSteps` | `10` | Legend steps (`getLegend` returns `steps + 1` entries) |
| `showViewFollow` | `true` | View-follow control |
| `viewFollowTitle` | `'Follow:'` | Follow control title |
| `viewFollowExpanded` | `false` | Start the follow panel unfolded |

**Layers and styling**

| Option | Default | Notes |
|---|---|---|
| `bearingTransform` | — | `fn(bearing) => number \| null`, transform before rotation |
| `rotationOffset` | `0` | Degrees added to the bearing (use `90` for a right-pointing icon) |
| `trackLayerOptions` | — | `{ defaultStyle }` fallback style for segments |
| `pointClusterOptions` | — | `{ pointStyle, clusterStyle }` point and cluster styles |
| `staticLayerOptions` | — | Options passed to `L.geoJSON` for static buckets `{ style, pointToLayer, onEachFeature, … }` |
| `traveledStyle` | `{color:'#e74c3c',weight:4}` | Traveled route style |
| `untraveledStyle` | `{color:'#3498db',weight:4}` | Untraveled route style |
| `movingIcon` | — | Moving-indicator icon |
| `elementLabels` | English | The 8 fixed element labels |
| `backgroundNodesOptions` | — | `{ style, cluster=false, clusterOptions }` |

**Batch toggles, labels and the cluster panel**

| Option | Default | Notes |
|---|---|---|
| `showClusterScatterControl` | `true` | Cluster/scatter panel (when background nodes exist) |
| `clusterScatterPosition` | `'topright'` | Panel corner |
| `clusterScatterTitle` | `'Cluster / Scatter'` | Panel title |
| `clusterScatterExpanded` | `false` | Start the panel unfolded |
| `clusterScatterLabels` | `{cluster:'Cluster',scatter:'Scatter'}` | Panel labels |
| `showElementToggles` | `true` | Batch visibility control |
| `elementTogglesPosition` | `'topright'` | Control corner |
| `elementTogglesTitle` | `'Batch'` | Control title |
| `elementTogglesExpanded` | `false` | Start the panel unfolded |
| `showInfoLabels` | `true` | Batch label control |
| `infoLabelsPosition` | `'topright'` | Control corner |
| `infoLabelsTitle` | `'Labels'` | Control title |

**Datum and basemaps**

| Option | Default | Notes |
|---|---|---|
| `dataDatum` | `'wgs84'` | Input datum (`'wgs84'` / `'gcj02'`) |
| `mapDatum` | `'wgs84'` | Basemap datum (use `'gcj02'` for AMap) |
| `baseLayers` | — | `[{ label, layer }]` basemap radio group |
| `baseLayersLabel` | `'Basemap'` | Label of that group |
| `layerControlCollapsed` | `true` | Start the layer tree collapsed; pass `false` to expand |

**Data source panel**

| Option | Default | Notes |
|---|---|---|
| `showDataSource` | `false` | Show the data source panel |
| `dataSourcePosition` | `'topleft'` | Panel corner |
| `dataSourceTitle` | `'Data source'` | Panel title |
| `dataSourceExpanded` | `false` | Start with the panel open |
| `dataSourceLabels` | English | Panel UI strings |
| `dataSourceMessages` | English | Text builders (including `formatHelp` / `formatShapes`) |
| `dataSourceSamples` | — | `[{ label, data }]` sample buttons |
| `dataSourcePreview` | `{maxFeatures:50,maxChars:20000,summaryScan:5000,downloadMaxChars:2e7,downloadMaxMs:3000}` | Preview and export limits |
| `dataSourceImportMaxChars` | `5e7` | Imported text above this many characters is refused |

**Search**

| Option | Default | Notes |
|---|---|---|
| `showSearch` | `false` | Multi-hit search control |
| `searchPosition` | `'topleft'` | Control corner |
| `searchElements` | `['background_nodes']` | Element types in the index |
| `searchZoom` | — | `setView` zoom for each jump |
| `searchLabels` | English | Control strings |
| `searchMessages` | English | Count strings |

**Time and dates**

| Option | Default | Notes |
|---|---|---|
| `displayTimeZone` | `'local'` | Display zone: `'local'` / hour offset / IANA name |
| `showDateInfo` | `true` | Date line under the timeline |
| `dateInfoLabels` | English | `{ weekdays, holidaysField, workdaysField }` |
| `dateInfoMessages` | English | `{ dayOf(n, total) }` |
| `calendar` | — | `{ holidays, workdays }` holiday table |

**Misc**

| Option | Default | Notes |
|---|---|---|
| `mapFocusSpace` | `true` | Space toggles play/pause while the map has focus |

<!-- END OPTIONS -->

### 6.3 Session methods (25)

<!-- BEGIN METHODS -->

| Method | Notes |
|---|---|
| `play()` | Start/resume playback |
| `pause()` | Pause |
| `stop()` | Stop and reset to the start |
| `seek(timeMs)` | Jump to a timestamp |
| `seekByProgress(p)` | Jump to progress `p` (0–1) |
| `setSpeed(n)` | Set the multiplier |
| `getSpeed()` | Current multiplier |
| `setLoop(b)` | Set loop mode |
| `getLoop()` | Current loop mode |
| `getCurrentTime()` | Current time (ms) |
| `getProgress()` | Current progress (0–1) |
| `getState()` | `'playing'` / `'paused'` / `'stopped'` |
| `getLegend(steps?)` | `[{ speed, color, label }]`, `steps + 1` entries |
| `addDataset(data, opts?)` | Add one dataset; returns its numeric id |
| `removeDataset(id)` | Remove one dataset |
| `clearDatasets()` | Remove all datasets |
| `listDatasets()` | `[{ id, name, featureCount }]` |
| `getDataset(id)` | One dataset's raw data |
| `setTimeZone(tz)` | Switch the display zone (no rebuild) |
| `getTimeZone()` | The current zone spec |
| `setCalendar(table)` | Replace the holiday table (no rebuild) |
| `getCalendar()` | The current holiday table |
| `on(event, fn)` | Register a listener |
| `off(event, fn)` | Remove a listener |
| `destroy()` | Remove all layers, controls and listeners |

<!-- END METHODS -->

### 6.4 Events (10)

| Event | Payload |
|---|---|
| `start` | `{ time }` |
| `pause` | `{ time }` |
| `stop` | `{ time }` |
| `finished` | `{ time }` |
| `tick` | `{ time, progress }` |
| `timechange` | `{ time, progress }` |
| `speedchange` | `{ speed }` |
| `datasetadd` | `{ id, name, featureCount, total }` |
| `datasetremove` | `{ id, name, featureCount, total }` |
| `datasetsclear` | `{ removed }` |

`time` is a millisecond timestamp. `tick` fires every frame; `timechange` fires on seek / stop.

## 7. Time zone and holidays (only when the task involves dates, time zones or holidays)

`displayTimeZone` affects four things, always together: the time label, the double-click editor, the day-boundary ticks and the holiday-lookup keys. Values:

- `'local'` (default): the browser zone.
- A number: a fixed UTC offset in hours, e.g. `8`.
- A string: an IANA name, e.g. `'Asia/Shanghai'`.

The holiday table is fetched by the host and injected; the plugin ships none (the dates change every year). Its shape is exactly the `chinese-days` yearly JSON:

```js
// https://cdn.jsdelivr.net/npm/chinese-days/dist/years/<year>.json
// → { "holidays": { "2025-10-01": "National Day,国庆节,3" }, "workdays": { ... } }
fetch('https://cdn.jsdelivr.net/npm/chinese-days/dist/years/2025.json')
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (table) {
    if (table) { replay.setCalendar(table); }   // no rebuild; the date line updates at once
  });
```

- Keys are dates **in the display zone** (`YYYY-MM-DD`). When a date appears in both tables, `workdays` wins.
- `setCalendar` and `setTimeZone` are session methods; neither triggers a rebuild.
- A 404 for a year means that year has not been published yet; treat it as no data.

## 8. Python recipe: raw rows to data

<!-- BEGIN PYTHON -->
```python
# Rows -> TimestampEdgeoJSON FeatureCollection. Standard library only.
# Each row is (time, lng, lat); time may be a datetime, seconds or ms.
# The output uses integer milliseconds and strictly ascending timestamps.
import json
import sys
from datetime import datetime, timezone


def to_ms(t):
    if isinstance(t, datetime):
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return int(t.timestamp() * 1000)
    t = float(t)
    # The library reads the first value: > 1e12 means ms, otherwise seconds.
    return int(t) if abs(t) > 1e12 else int(t * 1000)


def track(rows, layer_path):
    rows = sorted(rows, key=lambda r: to_ms(r[0]))
    times = [to_ms(r[0]) for r in rows]
    coords = [[float(r[1]), float(r[2])] for r in rows]  # [lng, lat]
    if len(coords) < 2:
        raise ValueError("a track needs at least 2 points")
    if any(times[i] >= times[i + 1] for i in range(len(times) - 1)):
        raise ValueError("timestamps must be strictly ascending")
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {
            "layerPath": layer_path,
            "isTimestampedgeojson": True,
            "times": times,
            "drawMovingIndicator": True,
        },
    }


def main():
    rows = [
        # (time_ms,       lng,     lat)
        (1700000000000, 116.400, 39.900),
        (1700000060000, 116.410, 39.910),
        (1700000120000, 116.420, 39.920),
    ]
    fc = {
        "type": "FeatureCollection",
        "features": [track(rows, ["demo", "track1"])],
    }
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(fc, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
```
<!-- END PYTHON -->

Usage: replace `rows` with your raw data, run the script, and **the JSON it prints is the data to use** — save it as `.geojson`, paste it into the data source panel, or pass it as the `L.trackReplay` data argument.

Rules:

- Standard library only; print to stdout.
- Always emit integer milliseconds (the exception is data before 2001-09-09; see 4.3).
- For events / background nodes / static areas, append features using the shapes in section 4.1; events and background nodes need no `times`.

## 9. Output contract

Deliver according to the task type:

| Task type | Deliverable |
|---|---|
| Data only | A complete `FeatureCollection` (JSON code block), or a directly runnable Python script (one or both); add one line on how to use it |
| Page / integration only | **A single complete host page (HTML)** (`<!DOCTYPE html>` through `</html>`), openable by double-click; use the CDN URLs from section 2 |
| Modify existing code | A minimal diff plus where to insert it; do not reorder unrelated code |
| Explanation only | Explain; generate no code |

Every answer must end with:

1. **Assumptions**: choices you made for the user (time unit, data volume, basemap, …).
2. **Self-check results**: the checklist in section 10, item by item.

## 10. Self-check and common mistakes

### 10.1 Check before answering

- [ ] Every timestamped track is a `LineString` with at least 2 points.
- [ ] Every coordinate is `[lng, lat]` (not `[lat, lng]`); longitude within −180..180, latitude within −90..90.
- [ ] `times.length === coordinates.length`, strictly ascending, one unit throughout.
- [ ] `speeds` / `styles` / `popups` have length = points − 1; `pointPopups` = points; **arrays you do not have are omitted**.
- [ ] Every feature has `layerPath`, and it is an array of strings.
- [ ] `isTimestampedgeojson` is spelled correctly and is boolean `true`.
- [ ] Static-feature colours are in `style.color`, not `color`.
- [ ] Only the options, methods and events from section 6 are used; no identifier was invented.

### 10.2 Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Blank map / a thin strip | No container height / CSS not loaded | Give the container an explicit height; load the plugin CSS |
| Track does not appear | Geometry is not `LineString`, or `times` length mismatch | Split into `LineString` features; match the lengths |
| Dots land in the ocean | Coordinates written as `[lat, lng]` | Reverse to `[lng, lat]` |
| Playback ends immediately | `times` not ascending, or the unit was misread | Sort ascending; use one unit |
| Track is grey, no speed colours | `style: {}` or a `color` inside `styles` | Remove the empty `style`; leave colour to the speed ramp |
| Static feature has no colour | Used `properties.color` | Use `properties.style.color` |
| Background nodes have no popups | `popups[]` length does not match the point count | Match the count or drop the whole array |
| Console: `times.length (...) !== coordinates.length` | Length mismatch | One timestamp per point |
| Point popups are wrong | `pointPopups` length is not the point count | Set the length to the point count |
| Panel import does nothing | Text exceeds `dataSourceImportMaxChars` | Reduce the data or raise the limit |
