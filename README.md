# Leaflet.TrackReplay

时间轴对齐的批量数据回放系统 — A Leaflet plugin for time-aligned batch GPS track replay.

[![npm version](https://img.shields.io/npm/v/leaflet-trackreplay.svg)](https://www.npmjs.com/package/leaflet-trackreplay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

- 🎬 **Video-player-like playback** — play/pause, stop, speed control, progress slider
- 🗺️ **Multi-layer tracks** — organize tracks in a hierarchical layer tree
  (Leaflet.Control.Layers.Tree when present, flat `L.control.layers` fallback otherwise)
- 🎨 **Speed-based coloring** — 3 modes: fixed (Turbo ramp over a configurable range),
  adaptive (P5–P95), custom (branca-style)
- 📍 **Point clustering** — marker cluster for dense track points, every data point kept (via Leaflet.markercluster)
- 🌌 **Background nodes** — many standalone location points unrelated to any
  time sequence (`element: "background_nodes"`), drawn as clickable dots
  *beneath* the tracks — scatter by default, clustering opt-in — with per-node
  popups and batch controls
- 🗂️ **Dataset sessions** — add / remove / clear GeoJSON datasets at runtime,
  merged by `layerPath`; playback time, visibility, batch labels and modes all
  survive every data change
- 📥 **Data source panel** — manage the session's datasets (list with per-item
  remove, clear-all) and import new ones: GeoJSON / GPX via file pick, drag &
  drop onto the map, paste, URL or samples; GPX without timestamps degrades to
  static lines, called out in a per-import report
- 🏃 **Moving indicators** — animated markers with bearing-based rotation
- 🛤️ **Dynamic route coloring** — traveled (red) / untraveled (blue) edge rendering
- 👁️ **View following** — auto-pan to follow moving objects (latest/random/named/off)
- ⏱️ **Editable timeline** — double-click to type a timestamp and jump
- 🔌 **Decoupled architecture** — use the core engine + individual layers independently
- 💬 **Popups** — per-segment popups on track segments and points, plus static-feature popups
- 🏷️ **Batch label display** — open any object's or element type's popups in bulk (they *are* the
  real popups, not look-alikes)
- 🧭 **Basemap-aware datums** — WGS-84 ⇄ GCJ-02 (火星) conversion, so 高德/AMap tiles line up
  with GPS tracks; basemaps can be handed to the layer tree as a radio group
- 📡 **Event system** — `start`, `pause`, `stop`, `finished`, `tick`, `timechange`, `speedchange`

## Installation

### npm

```bash
npm install leaflet-trackreplay
```

### CDN

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet-trackreplay/dist/leaflet-trackreplay.css" />
<script src="https://unpkg.com/leaflet-trackreplay/dist/leaflet-trackreplay.iife.js"></script>
```

### Requirements

- Leaflet `^1.7.0`
- Leaflet.markercluster `^1.5.0` (optional — for point clustering)
- Leaflet.Control.Layers.Tree `^1.2.0` (optional — collapsible hierarchical layer control;
  without it the layer control falls back to a flat `L.control.layers` with breadcrumb labels)

## Quick Start

```javascript
// 1. Create a map
var map = L.map('map').setView([39.91, 116.41], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// 2. Prepare your data as a GeoJSON FeatureCollection
var data = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[116.40, 39.90], [116.41, 39.91], [116.42, 39.92]],
      },
      properties: {
        layerPath: ['group1', 'track1'],
        isTimestampedgeojson: true,
        times: [1700000000000, 1700000005000, 1700000010000],
        drawMovingIndicator: true,
      },
    },
  ],
};

// 3. Initialize TrackReplay
var replay = L.trackReplay(map, data, {
  colorMode: 'fixed',
  speed: 1,
  loop: false,
});

// 4. Start playback
replay.play();
```

## API

### `L.trackReplay(map, featureCollection, options)`

Creates a new TrackReplay instance and adds all layers/controls to the map.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `colorMode` | `'fixed' \| 'adaptive' \| 'custom'` | `'fixed'` | Speed-to-color mapping mode |
| `colorConfig` | `ColorBarConfig` | — | Custom colorbar config (required for `'custom'` mode) |
| `colorRange` | `number[]` | `[0, 200]` | `[min, max]` km/h the ramp spans in `'fixed'` mode |
| `speed` | `number` | `1` | Initial playback speed multiplier |
| `speedOptions` | `number[]` | `[0.25, 0.5, 1, 2, 4, 8, 60, 600, 3600]` | Speed ladder shown in the selector |
| `speedLabel` | `(speed) => string` | — | Custom label formatter for the ladder |
| `loop` | `boolean` | `false` | Auto-restart when finished |
| `tickLen` | `number` | `250` | Tick interval in ms |
| `minTickMs` | `number` | `16` | Tick interval floor — keeps high speeds from flooding the tick loop |
| `showControls` | `boolean` | `true` | Show playback controls (play/pause, stop, speed, loop) |
| `showTimeline` | `boolean` | `true` | Show timeline slider — when both are enabled they render together in a **single box** |
| `controlBarPosition` | `string` | `'bottomleft'` | Corner of the combined playback + timeline box |
| `showLegend` | `boolean` | `true` | Show speed color legend |
| `showViewFollow` | `boolean` | `true` | Show view follow control |
| `bearingTransform` | `(bearing: number) => number \| null` | pass-through | Transform bearing before rotation. Rotation is on by default; pass `null` to disable (slightly faster) |
| `rotationOffset` | `number` | `0` | Degrees added to the bearing (e.g. `90` if the icon points right) |
| `movingIcon` | `L.Icon \| L.DivIcon` | — | Custom icon for moving indicators |
| `traveledStyle` | `object` | `{color:'#e74c3c',weight:4}` | Style for traveled route edge |
| `untraveledStyle` | `object` | `{color:'#3498db',weight:4}` | Style for untraveled route edge |
| `elementLabels` | `object` | English defaults | Labels for the per-element layers: `{track, points, static, events, background_nodes, traveled, untraveled, indicator}` |
| `backgroundNodesOptions` | `object` | — | Options for the `background_nodes` element: `{ style, cluster (default false — scatter), clusterOptions }` |
| `showClusterScatterControl` | `boolean` | `true` | Show the cluster / scatter settings panel (only when the data has background nodes) |
| `clusterScatterPosition` | `string` | `'topright'` | Corner of that panel |
| `clusterScatterTitle` | `string` | `'Cluster / Scatter'` | Title of that panel |
| `clusterScatterLabels` | `object` | `{cluster:'Cluster', scatter:'Scatter'}` | Option labels inside the background-nodes section |
| `showDataSource` | `boolean` | `false` | Show the data source panel (dataset list + import channels) |
| `dataSourcePosition` | `string` | `'topleft'` | Corner of that panel |
| `dataSourceTitle` | `string` | `'Data source'` | Title of that panel (shows the dataset count) |
| `dataSourceExpanded` | `boolean` | `false` | Start with the panel open |
| `dataSourceLabels` | `object` | English defaults | Panel UI strings (`pick/add/load/pastePlaceholder/urlPlaceholder/samplesLabel/dropHint/pastedName/datasetsLabel/importLabel/removeLabel/clearLabel/clearConfirmLabel/emptyLabel`) |
| `dataSourceMessages` | `object` | English defaults | Text builders `{added, degraded, empty, error, rowMeta}` |
| `dataSourceSamples` | `Object[]` | — | `[{label, data}]` sample datasets shown as buttons |
| `showElementToggles` | `boolean` | `true` | Show the batch control (one tri-state checkbox per element type, across all objects) |
| `elementTogglesPosition` | `string` | `'topright'` | Corner for the batch control |
| `elementTogglesTitle` | `string` | `'Batch'` | Title of the batch control |
| `showInfoLabels` | `boolean` | `true` | Batch label display control — batch-opens the objects' existing popups (see below) |
| `infoLabelsPosition` | `string` | `'topright'` | Corner of the label control |
| `infoLabelsTitle` | `string` | `'Labels'` | Title of the label control |
| `dataDatum` | `'wgs84' \| 'gcj02'` | `'wgs84'` | Datum of the **input** coordinates (see Basemaps & GCJ-02) |
| `mapDatum` | `'wgs84' \| 'gcj02'` | `'wgs84'` | Datum of the **active basemap** — `'gcj02'` for 高德/AMap tiles |
| `baseLayers` | `{label, layer}[]` | — | Basemaps shown as the layer tree's radio group (host owns the layers) |
| `baseLayersLabel` | `string` | `'Basemap'` | Label of that radio group |

#### Per-element layers

Every object (`layerPath`) is split into individual toggleable layers — its track lines, track
points, traveled/untraveled route and moving indicator each appear as their own entry in the layer
tree, so they can be shown or hidden independently:

```
visitor
├── Bee
│   ├── 轨迹 (Track)         — speed-coloured track lines
│   ├── 节点 (Points)        — clustered track points
│   ├── 已行进 (Traveled)    — traveled route edge
│   ├── 未行进 (Untraveled)  — remaining route edge
│   └── 箭头 (Indicator)     — moving indicator
└── Mark
    └── …
```

Every branch has a select-all checkbox. Hidden elements are skipped by the time engine (no
per-frame work for invisible layers, as long as both route lines are hidden); a layer toggled back
on is refreshed immediately.

Programmatic access: `replay.allLayers['visitor/Bee'].elements` is
`[{ key, label, layer }, …]` — use it to toggle elements yourself with
`map.addLayer(el.layer)` / `map.removeLayer(el.layer)`.

#### Batch control

A separate control (`showElementToggles`, default on) gives one **tri-state checkbox per element
type** — 轨迹 / 节点 / 已行进 / 未行进 / 箭头 — that switches that type on or off **for every object
at once**, independent of the layer tree's per-object checkboxes:

```
批量
☑ 轨迹    2/2      ← every object's track lines
☐ 节点    0/2
▣ 已行进  1/2      ← partial: some objects' traveled route shown
…
```

- The checkbox shows a dash when only some objects have that element type enabled, and the
  `on/total` counter makes the state explicit.
- Batch switching also affects objects whose `layerVisibility` was `false` at init.
- Every change goes through `map.addLayer` / `map.removeLayer`, so the layer tree checkboxes (and
  their select-all parents) stay in sync automatically — in both directions.

#### Instance Methods

| Method | Description |
|--------|-------------|
| `play()` | Start/resume playback |
| `pause()` | Pause playback |
| `stop()` | Stop and reset to start |
| `seek(timeMs)` | Jump to a specific timestamp |
| `seekByProgress(progress)` | Jump to a progress fraction (0–1) |
| `setSpeed(speed)` | Set playback speed multiplier |
| `getSpeed()` | Get playback speed multiplier |
| `setLoop(loop)` | Enable/disable auto-restart |
| `getLoop()` | Get loop mode |
| `getCurrentTime()` | Get current time (ms) |
| `getProgress()` | Get progress (0–1) |
| `getState()` | Get state: `'playing'` / `'paused'` / `'stopped'` |
| `addDataset(fc, opts?)` | Add a dataset at runtime (merged by `layerPath`); returns its id |
| `removeDataset(id)` | Remove exactly that dataset's parts |
| `clearDatasets()` | Remove all datasets (the session stays alive) |
| `listDatasets()` | Metadata of the current datasets |
| `getDataset(id)` | One dataset's raw FeatureCollection |
| `on(event, fn)` | Register event listener |
| `off(event, fn)` | Remove event listener |
| `destroy()` | Remove all layers, controls, and listeners |

#### Events

| Event | Data | Description |
|-------|------|-------------|
| `start` | `{ time }` | Playback started |
| `pause` | `{ time }` | Playback paused |
| `stop` | `{ time }` | Playback stopped (reset) |
| `finished` | `{ time }` | Reached end of timeline |
| `tick` | `{ time, progress }` | Each time frame |
| `timechange` | `{ time, progress }` | Time changed (seek/stop) |
| `speedchange` | `{ speed }` | Speed multiplier changed |
| `datasetadd` | `{ id, name, featureCount, total }` | A dataset was added |
| `datasetremove` | `{ id, name, featureCount, total }` | A dataset was removed |
| `datasetsclear` | `{ removed }` | All datasets were removed |

### Datasets (runtime data management)

`L.trackReplay` is a **session** over a set of datasets. Three startup shapes,
all returning the same object:

```javascript
L.trackReplay(map, featureCollection, options);   // one fixed dataset (as before)
L.trackReplay(map, [fc1, fc2], options);          // several datasets at once
L.trackReplay(map, null, options);                // empty; add data later
```

Each `addDataset()` call is one dataset — the atomic unit of removal:

```javascript
var id = replay.addDataset(fc, { name: '10月14日轨迹' });
replay.removeDataset(id);   // removes exactly this dataset's parts
replay.clearDatasets();     // remove all data (session stays alive, reusable)
replay.listDatasets();      // [{ id, name, featureCount }, …]
replay.getDataset(id);      // { id, name, featureCollection }
```

- **Merge by `layerPath`** — datasets sharing a `layerPath` merge into one
  object (e.g. appending more segments to an existing track). Removal happens
  at the *source*: the container drops the dataset and the replay is rebuilt
  from what remains — objects that spanned several datasets survive with the
  remaining parts; objects owned by the removed dataset disappear with it
  (their tree entries, batch-toggle rows and label columns go too).
- **State survives every rebuild** — playback time & run state, speed, loop,
  per-element visibility, checked batch-label cells, cluster/scatter mode and
  follow mode are captured and re-applied; `on()`/`off()` listeners keep
  working (one stable event bus carries playback *and* dataset events).
- **Input contract**: every dataset must be **WGS-84 (地球坐标系)**. There is
  no per-dataset datum setting — convert GCJ-02 sources before adding them.
- **Empty session**: with no data there is no build to show (`getState()` is
  `'stopped'`, `getCurrentTime()` is `null`); the first `addDataset()` builds
  everything, and `clearDatasets()` returns to that empty, reusable state.
  `destroy()` remains the full teardown.

#### Data source panel (`showDataSource`, default off)

One session-scoped panel (survives every rebuild, expanded state included)
with three parts:

1. **Datasets** — the current datasets, one row each (name + feature count)
   with its own remove button, plus a two-click **clear-all** (the first click
   arms the button, the second confirms). The list refreshes from the
   session's dataset events, so programmatic `addDataset()` /
   `removeDataset()` calls update it too. The title shows the count.
2. **Import** — five channels:

| Channel | Notes |
|---------|-------|
| Drag & drop onto the map | the whole map is the drop target, with a highlight overlay |
| File picker | `.json` / `.geojson` / `.gpx` |
| Paste | GeoJSON or GPX text |
| URL | fetched with `fetch`; the server must allow CORS (or be same-origin) |
| Samples | `dataSourceSamples: [{ label, data }]` — one-click example datasets |

3. **Report** — one line per import attempt (added / degraded / empty /
   error); the texts come from `dataSourceMessages`, so they can be localized.

- GeoJSON may be a `FeatureCollection`, a single `Feature`, or an array of
  either. Features **without** a `layerPath` get `['imported', <name>]` so
  every import lands in its own tree branch.
- **GPX** is converted by `L.TrackReplay.Utils.GPX.parseGPX`: segments whose
  points all carry `<time>` become replayable TimestampEdgeoJSON (moving
  indicator on by default); segments without time are imported as **static
  lines** and flagged in the report — they cannot participate in playback.
  Each `<trkseg>` becomes its own feature (gaps are never bridged), and
  `<wpt>` waypoints become static points with name/desc popups.

### TimestampEdgeoJSON Format

Extends standard GeoJSON features with additional properties:

```typescript
{
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[lng, lat], ...] },
  properties: {
    layerPath: string[],            // required: hierarchical layer path
    isTimestampedgeojson: true,     // required: marks as timestamped data
    times: number[],                // required: Unix timestamps (ms or s)
    speeds?: number[],              // optional: km/h, length = coords.length - 1
    styles?: object[],              // optional: per-segment style overrides
    popups?: string[],              // optional: per-segment popup content
    pointPopups?: string[],         // optional: per-point popup content (length = coordinates.length)
    drawMovingIndicator?: boolean,  // optional: enable moving marker
    layerVisibility?: boolean,      // optional: default visibility (default true)
    style?: object,                 // optional: base style for entire track
    color?: string,                 // optional: single color for the whole track
  }
}
```

### Playback speed

The selector offers a ladder of speeds. Below 60× entries read as plain multipliers (`0.25×` …
`8×`); at 60× and above they switch to **time compression**, which is the natural notation for
tracks spanning hours or days:

| value | label |
|-------|-------|
| `60` | `1s = 1min` |
| `600` | `1s = 10min` |
| `3600` | `1s = 1h` |

```javascript
L.trackReplay(map, data, {
  // custom ladder — entries ≥ 60× are auto-labelled as time compression
  speedOptions: [1, 10, 60, 600, 3600],
  // …or take full control of the labels
  speedLabel: function (speed) { return speed + 'x'; },
});
```

Time still advances by *real elapsed × speed* at any rate, so the `minTickMs` floor (default 16 ms)
only controls how often the display refreshes — never the playback rate itself.

### Event markers

Non-timestamped features tagged with `properties.element` are grouped into their own element layer
under the object — a separate tree entry and batch-toggle row, independent of the point cluster.
The typical use is an event layer:

```json
{ "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [116.44, 39.92] },
  "properties": {
    "layerPath": ["visitor", "Mark"],
    "element": "events",
    "popup": "<b>掉头事件</b><br>22:41:00",
    "style": { "color": "#e74c3c", "weight": 2, "radius": 14 }
  } }
```

Point features render as **rings**: an unfilled `L.circleMarker` whose radius is in **pixels**
(screen-fixed, like folium's `CircleMarker`). The default style is
`{radius: 10, color: '#e74c3c', weight: 2, fill: false}`; `properties.style` overrides it
(`fill: true` for a filled dot, `radius` for size). Clicking a ring opens its `popup`.

- Label from `elementLabels.events` (default `Events`).
- Event layers are drawn **above** the tracks (annotations stay clickable), while the generic
  `static` element (zones, areas) stays below them.
- Geographic rings (radius in meters) or ring *bands* (polygon with an inner ring, folium's donut
  technique) already work through the plain GeoJSON path — a `Polygon` with two coordinate rings
  renders as a donut today.

### Background nodes (`background_nodes`)

Many standalone location points that are **not tied to any time sequence** — sample
points, POIs, coverage readings — used as context *behind* the tracks. They stay
plain GeoJSON; the reserved element name `background_nodes` decides how they render:

```json
// Form ① — one compact feature carrying all points (use for tens of thousands)
{ "type": "Feature",
  "geometry": { "type": "MultiPoint",
                "coordinates": [[116.40, 39.90], [116.41, 39.91], ...] },
  "properties": {
    "layerPath": ["background", "samples"],
    "element": "background_nodes",
    "popups": ["node 1", "node 2", ...],     // optional, length = coordinates
    "styles": [{...}, ...],                  // optional per-point style
    "style": { "fillColor": "#666" }         // optional base style
  } }

// Form ② — one Point feature per location (may be mixed with form ①)
{ "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [116.40, 39.90] },
  "properties": {
    "layerPath": ["background", "stations"],
    "element": "background_nodes",
    "popup": "station 1"
  } }
```

- **Rendering**: small filled dots (`{radius: 4, fillColor: '#6b7785'}`) by default;
  `properties.style` (and per-point `styles[i]`) override them.
- **Clickable, like track points**: the dots render through the same vector
  renderer as the tracks, so Leaflet's normal hit-testing applies — clicking a
  node opens its popup, exactly as clicking a track point does. (A dedicated
  low pane would paint beneath the tracks but never receive clicks, because
  the tracks' canvas covers it.)
- **Z-order**: each dot is sent to the back of the shared renderer whenever it
  is (re)added, so dots draw **beneath the tracks**; their cluster bubbles sit
  in the marker pane — the same layer track-point clusters use, so clicking a
  bubble zooms in as usual.
- **Scatter by default**: every node is drawn as its own dot. Clustering is
  opt-in — `backgroundNodesOptions: { cluster: true }` groups dense clouds with
  Leaflet.markercluster (with spiderfy, like track points), the right choice
  for tens of thousands of nodes.
- **Runtime switch**: the *Cluster / Scatter* settings panel (below) carries a
  background-nodes section with a **Cluster / Scatter** choice. Switching
  rebuilds the element in place — layer-tree, batch-toggle and batch-label
  references are re-pointed, map visibility is preserved, and checked label
  cells re-open their popups on the new layer.
- **Batch control & labels**: same as every element — one tree entry per object,
  one batch-control row for the element type across all objects, and one
  batch-label column (present whenever the nodes carry popups).

```javascript
L.trackReplay(map, data, {
  // defaults shown; all optional
  backgroundNodesOptions: {
    style: { radius: 4, fillColor: '#6b7785' },
    cluster: false, // scatter (default) — true groups dense clouds
  },
});
```

Note: `background_nodes` is a **reserved element name** — a bucket with this name
always renders through this layer (Point/MultiPoint geometries; other geometry
types are skipped with a console warning) and cannot be used as a plain static
bucket.

### Batch label display

A collapsed-by-default control (`showInfoLabels`) for **batch-displaying labels** — useful when
watching one or a few objects closely and you want their nodes/events/segments readable without
clicking each one:

```
批量标签 (122)          ← click the title to expand; (n) = labels currently displayed
            轨迹  节点  事件  静态
☑ visitor › Bee   ☐   ☑    ☑
☑ visitor › Mark  ☑   ☐    ☑
☐ zones › study_area             ☐
```

- **Rows = objects, columns = element types** that carry label content (the columns come from the
  data; visual-only elements such as the traveled route or the indicator have none).
- A label **is the real popup**: checking a cell calls `openPopup()` on every layer of that group,
  so what appears is the same popup a manual click would show — same content, same styling — and
  unchecking closes them. Nothing is copied or abbreviated.
- Clicking a **row header** switches the whole row (tri-state: all / partial / none); the title
  shows how many labels are currently displayed.
- While displayed, those popups are put in a "many at once" mode (`autoClose: false`,
  `autoPan: false`, `closeOnClick: false`): they don't close each other, opening dozens never moves
  the map, and clicking the map doesn't sweep them away. Switching a cell off restores the normal
  popup behaviour, so hand-clicked popups still work as usual.
- Labels **ride along with their layers**: hiding an element (layer tree or batch control) hides its
  labels too, and they return with the layer. This also covers points that cluster in and out while
  zooming.
- Rendering cost scales with the number of *checked cells*, not with the number of objects in the
  data — safe for hundreds of tracks as long as few rows are switched on. At low zoom, expect
  overlap — that's inherent to showing many popups at once; zoom in or enable fewer rows.

### Speed → colour mapping

`colorMode` decides how a segment's speed becomes a colour. `fixed` and `adaptive` share the same
continuous **Turbo-style ramp** — the magnitude convention (like Traccar/Garmin): slow = dark
blue → cyan → green → yellow → orange → red = fast. They differ only in the range it spans:

| mode | range |
|------|-------|
| `fixed` | `colorRange`, default **0–200 km/h** (externally configurable) |
| `adaptive` | P5–P95 of all speeds in the data (automatic) |
| `custom` | `colorConfig.vmin` … `vmax`, with your own colour stops |

```javascript
L.trackReplay(map, data, { colorMode: 'fixed', colorRange: [0, 120] });
```

The legend always reports the active range, so its labels follow `colorRange` automatically.

### Popups

- **Track segments** — provide `popups: string[]` (length = `coordinates.length - 1`, per segment).
  Clicking a track segment opens the corresponding popup. Tracks with a feature-level
  `style`/`color` are still split per segment when `popups` is present (the base style is kept on
  every segment).
- **Track points (nodes)** — provide `pointPopups: string[]` (length = `coordinates.length`, per
  point). Clicking a point opens its own popup instead of the segment's. Without `pointPopups`,
  points fall back to the popup of the segment that arrives at them.
- **Static features** — set `popup: string` in `properties`.
- The traveled/untraveled route overlays are non-interactive and never swallow clicks, and static
  layers are drawn below the tracks, so segment popups work even where a zone polygon covers them.

### Point Clustering

Every data point of a timestamped track gets its own marker. Points that share the exact same
coordinates (e.g. a track that visits the same place twice, like an out-and-back) are kept as
separate markers: they stay clustered even at max zoom, and clicking such a cluster spiderfies it
so each visit can be inspected individually — same behaviour as folium's `MarkerCluster`.
The spider legs render with an SVG renderer and are non-interactive, so they keep working on
`preferCanvas` maps without swallowing clicks aimed at the markers.

### Basemaps & the GCJ-02 (火星) datum

Leaflet always works in Web Mercator over WGS-84 — but whether the *content* of a tile is
WGS-84 or GCJ-02 (the obfuscated datum used by 高德/AMap, Tencent, Google China) is the
provider's choice. Plotting WGS-84 tracks on GCJ-02 tiles (or vice versa) misplaces them by
roughly 300–600 m, so TrackReplay models this as two independent axes:

| option | meaning | default |
|--------|---------|---------|
| `dataDatum` | datum of the **input** coordinates | `'wgs84'` |
| `mapDatum` | datum of the **active basemap** (`'gcj02'` for 高德 tiles) | `'wgs84'` |

When they differ, the data is converted **once, at parse time** (`DataParser`), so every
downstream layer — track, points, events, traveled/untraveled edges, indicator — works in the
map's own frame and all internal math (speed, bearing, interpolation) stays consistent.
Both directions are supported; outside China the conversion is a no-op.

```javascript
L.trackReplay(map, data, {
  dataDatum: 'wgs84',    // our GPS data
  mapDatum: 'gcj02',     // 高德 (GCJ-02) basemap
  baseLayers: [          // host creates/holds the tile layers …
    { label: '标准', layer: amapVector },
    { label: '卫星', layer: amapSatellite },
  ],
  baseLayersLabel: '底图', // … and the plugin renders them as the tree's radio group
});
```

Consequences worth knowing:

- `dataDatum` is collection-wide, not per feature — mixed-datum inputs need separate instances.
- Coordinates the map *reports* — `map.getCenter()`, click `latlng`s, measure-tool readouts —
  are always in the **map frame** (GCJ-02 while a GCJ-02 basemap is active). Convert back with
  `L.TrackReplay.Utils.GCJ02.gcj02ToWgs84(lng, lat)` when feeding your own logic.
- Popups pass through untouched; if a popup prints coordinates, decide explicitly which datum
  to print.
- Distances/areas are unaffected (the GCJ-02 offset field varies very slowly over space).
- Changing the datum of the map frame means the data must be re-projected: re-create the
  instance (`destroy()` and init again with the new `mapDatum`, keeping the playback time if
  you want — that is exactly what the demo's settings panel does when you switch sources).

### ColorBar Config (Custom Mode)

```javascript
var colorbarConfig = {
  colors: ['#0000FF', '#00FF00', '#FFFF00', '#FF0000', '#800080'],
  index: [-10, 0, 75.0, 150, 500],
  vmin: -10,
  vmax: 500,
};
```

### Advanced: Using Core Modules Independently

```javascript
// Parse data without rendering
var parsed = L.TrackReplay.Core.DataParser.parseFeatureCollection(data, colorMapper);

// WGS-84 ⇄ GCJ-02 (火星坐标系) conversion, for coordinates the map reports back
var gcj = L.TrackReplay.Utils.GCJ02.wgs84ToGcj02(116.40, 39.90);
var wgs = L.TrackReplay.Utils.GCJ02.gcj02ToWgs84(gcj[0], gcj[1]);

// GPX → GeoJSON: timed segments become replayable TimestampEdgeoJSON,
// time-less segments become static lines (see the report)
var gpx = L.TrackReplay.Utils.GPX.parseGPX(gpxText, { layerPath: ['gpx', 'watch'] });
// gpx.featureCollection — a GeoJSON FeatureCollection
// gpx.report — { segments, timedSegments, staticSegments, points, waypoints }

// Create individual layers manually
var trackLayer = L.TrackReplay.Layers.TrackLayer.createTrackLayer(parsed.layerFeatures[0].features);

// Custom time engine
var engine = L.TrackReplay.Core.TimeEngine.createTimeEngine({ speed: 2 });
engine.on('tick', function (d) {
  console.log('Time:', d.time, 'Progress:', d.progress);
});
```

## Development

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Watch mode
npm run dev

# Run Python demo server
cd examples
pip install fastapi uvicorn jinja2
python server.py
# Open http://localhost:8000
```

The demo page loads Leaflet and its helper plugins from `examples/vendor/`
(committed with the repo) — **no external CDN is needed**; only basemap tiles
require network access.

## Project Structure

```
├── src/
│   ├── TrackReplay.js          # Session facade + internal buildReplay builder
│   ├── TrackReplay.css         # Styles
│   ├── core/
│   │   ├── DataParser.js       # GeoJSON parsing & processing
│   │   ├── DatasetContainer.js # Runtime datasets (add/remove/clear/merge)
│   │   ├── ColorMapper.js      # Speed-to-color mapping
│   │   ├── TimeEngine.js       # Shared time-axis engine
│   │   └── LayerTreeBuilder.js # Layer tree construction
│   ├── layers/
│   │   ├── TrackLayer.js       # Speed-colored track lines
│   │   ├── PointClusterLayer.js# Marker cluster for points
│   │   ├── MovingIndicator.js  # Animated moving marker
│   │   ├── DynamicRoute.js     # Traveled/untraveled route
│   │   ├── StaticLayer.js      # Regular GeoJSON layer
│   │   └── BackgroundNodesLayer.js # Clickable scatter/cluster dots (background nodes)
│   ├── controls/
│   │   ├── PlaybackControls.js # Play/pause/stop/speed UI
│   │   ├── TimelineControl.js  # Progress slider + time editor
│   │   ├── ControlBar.js       # Buttons + timeline in one box
│   │   ├── ViewFollowControl.js# Map view following
│   │   ├── ElementToggles.js   # Batch show/hide by element type
│   │   ├── InfoLabels.js       # Batch label display
│   │   ├── ClusterScatterControl.js # Cluster/scatter settings panel
│   │   ├── DataSourceControl.js# Datasets list + import panel (file/drop/paste/URL/samples)
│   │   └── ColorLegend.js      # Speed color legend
│   └── utils/
│       ├── GeoUtils.js          # Distance, bearing, interpolation
│       ├── GCJ02.js             # WGS-84 ⇄ GCJ-02 conversion
│       ├── GPX.js               # GPX → GeoJSON conversion
│       ├── EventBus.js          # Session event bus
│       └── TimeUtils.js         # Timestamp formatting/parsing
├── examples/
│   ├── server.py               # Python dev server
│   └── templates/
│       └── demo.html.jinja2    # Jinja2 template
├── dist/                       # Build output
├── IMPLEMENTATION.md           # Implementation guide
└── package.json
```

## License

MIT © Frank Yao
