<!-- canonical: GUIDE.zh.md；mirror: 本文件；consistency check: node _docs_check.mjs -->

# Python host guide

This guide shows how to use a Python service as the **host**: it serves the map page, the plugin assets and the data API, while Leaflet.TrackReplay does the replaying in the page. The reference implementation is this repository's demo (`examples/server.py` + `examples/templates/demo.html.jinja2`); this document reduces it to a minimal, copyable version.

## 1. What a Python host is

The plugin is not a standalone app: it attaches to an `L.Map` you create. **Host / plugin responsibilities**:

| Responsibility | Host (your Python service + page) | Plugin (Leaflet.TrackReplay) |
|---|---|---|
| Map and container | Create `L.Map`, give the container a height | Never creates the map |
| Basemap | Provide tile layers / `baseLayers` | Provides no basemap |
| Data | Produce GeoJSON from a DB / file / API | Parse, validate, split, replay on the timeline |
| Options | Decide `speed`, time zone, language, … | Consume the options |
| Page UI | Settings panels, auth, business buttons | Playback bar, timeline, layer tree, batch, search, data source panel |
| Holidays | Fetch and inject `calendar` | Read-only table, never fetched |
| Framing | `setView` / `fitBounds` | Never frames the map |

Two common shapes for a Python host:

| Shape | How the data reaches the page | Good for |
|---|---|---|
| **A. Server-rendered** | Jinja2 injects the GeoJSON into the HTML | Fixed datasets, first paint |
| **B. Data API** | The page `fetch('/api/...')` then `replay.addDataset(fc)` | Dynamic data, large data, on demand |
| **C. Hybrid** | Embed on first paint, then fetch increments | The usual production shape |

The two can be combined: embedding keeps the first paint fast, and later refreshes use the API.

## 2. A minimal runnable host

### 2.1 Layout

```text
my-host/
├── app.py                 # FastAPI service
├── templates/
│   └── index.html         # page (Leaflet + plugin)
├── dist/                  # plugin build output
│   ├── leaflet-trackreplay.umd.js
│   └── leaflet-trackreplay.css
└── vendor/                # Leaflet (+ optional plugins)
    ├── leaflet.js
    ├── leaflet.css
    └── images/            # Leaflet's icon assets
```

### 2.2 `app.py`

<!-- BEGIN PYAPP -->
```python
# A minimal Python host for Leaflet.TrackReplay.
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

ROOT = Path(__file__).resolve().parent
app = FastAPI()

# The plugin build and the vendored Leaflet live next to this file.
app.mount("/dist", StaticFiles(directory=ROOT / "dist"), name="dist")
app.mount("/vendor", StaticFiles(directory=ROOT / "vendor"), name="vendor")
templates = Jinja2Templates(directory=str(ROOT / "templates"))


def make_data():
    """Replace this with your real data source (DB, CSV, upstream API)."""
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [116.400, 39.900],
                    [116.410, 39.910],
                    [116.420, 39.920],
                ],
            },
            "properties": {
                "layerPath": ["demo", "track1"],
                "isTimestampedgeojson": True,
                "times": [1700000000000, 1700000060000, 1700000120000],
                "drawMovingIndicator": True,
            },
        }],
    }


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"data": make_data()},
    )


@app.get("/api/tracks")
async def api_tracks():
    # Same-origin data for runtime loading (pattern B).
    return JSONResponse(make_data())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
```
<!-- END PYAPP -->

### 2.3 `templates/index.html`

<!-- BEGIN PYTEMPLATE -->
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Python host</title>
  <link rel="stylesheet" href="/vendor/leaflet.css">
  <link rel="stylesheet" href="/dist/leaflet-trackreplay.css">
  <style>html, body, #map { height: 100%; margin: 0; }</style>
</head>
<body>
  <div id="map"></div>

  <script src="/vendor/leaflet.js"></script>
  <script src="/dist/leaflet-trackreplay.umd.js"></script>
  <script>
    var map = L.map('map').setView([39.91, 116.41], 14);   // [lat, lng]
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Jinja2's tojson escapes <, > and & — safe inside a <script> block.
    var replay = L.trackReplay(map, {{ data | tojson }}, { speed: 60 });
    replay.play();

    // Pattern B: load more data from the same origin at runtime.
    // fetch('/api/tracks')
    //   .then(function (r) { return r.json(); })
    //   .then(function (fc) { replay.addDataset(fc, { name: 'api' }); });
  </script>
</body>
</html>
```
<!-- END PYTEMPLATE -->

### 2.4 Dependencies and run

```bash
pip install fastapi uvicorn jinja2
python app.py            # http://127.0.0.1:8000
# or: uvicorn app:app --reload --port 8000
```

Make sure `dist/` and `vendor/` exist before starting — `StaticFiles` fails loudly when a directory is missing, which is deliberate: fail early instead of serving 404s.

## 3. Where the plugin and Leaflet assets come from

| Asset | Source |
|---|---|
| Plugin JS/CSS | Run `npm run build` in this repo and copy `dist/`; or `npm install leaflet-trackreplay` and take `node_modules/leaflet-trackreplay/dist/` |
| Leaflet | `npm install leaflet` and take `node_modules/leaflet/dist/`; or this repo's `examples/vendor/` |
| Optional plugins | `leaflet.markercluster` (clustering), `L.Control.Layers.Tree` (hierarchical layer tree); the plugin degrades automatically when they are absent |

Two rules:

1. **Fixed order**: Leaflet first, plugin second. The plugin needs a global `L` at execution time.
2. **Local beats CDN**: the demo serves Leaflet from `/vendor`, so the page depends on no external CDN — only basemap tiles need the network. A CDN works too, but pin the version.

In development add `Cache-Control: no-store` to `/dist`, `/vendor` and `/` (the demo middleware does exactly this), so a rebuild is picked up on reload. In production do the opposite: long cache with content hashes for static assets, short cache for HTML.

## 4. Producing data from Python

The full data contract is in [HUMAN-USAGE section 4](../HUMAN-USAGE.en.md#4-data-format-cheat-sheet). The three things a host gets wrong most often:

1. Coordinates are `[lng, lat]`; `setView` takes `[lat, lng]`.
2. `times` matches the coordinate count, **strictly ascending, in milliseconds** (the unit is read from the first value: `> 1e12` is ms).
3. `speeds` / `styles` / `popups` have length = points − 1; `pointPopups` = points; omit arrays you do not have — never pass `[]`.

A skeleton that turns database rows into a track:

```python
from datetime import datetime, timezone


def rows_to_track(rows, layer_path, name=None):
    """rows: iterable of (time, lng, lat); time may be datetime, s or ms."""
    rows = sorted(rows, key=lambda r: r[0])
    times, coords = [], []
    for t, lng, lat in rows:
        if isinstance(t, datetime):
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            ms = int(t.timestamp() * 1000)
        else:
            ms = int(t) if abs(t) > 1e12 else int(float(t) * 1000)
        times.append(ms)
        coords.append([float(lng), float(lat)])
    if len(coords) < 2:
        raise ValueError("a track needs at least 2 points")
    if any(times[i] >= times[i + 1] for i in range(len(times) - 1)):
        raise ValueError("timestamps must be strictly ascending")
    props = {
        "layerPath": layer_path,
        "isTimestampedgeojson": True,
        "times": times,
        "drawMovingIndicator": True,
    }
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": props,
    }
```

> [`examples/convert.py`](../../examples/convert.py) already packages this logic (`track` / `event` / `background_nodes` / `area` / `write_geojson`) and can be reused directly.

**Do not embed large data**: a JSON with hundreds of thousands of points makes the first paint slow. Use the API instead:

- `GET /api/tracks?bbox=...&since=...` returns one `FeatureCollection`;
- the page fetches it and calls `replay.addDataset(fc)`;
- the data source panel's URL channel needs same-origin or CORS — with a same-origin deployment just use a site-relative path.

## 5. Runtime loading and refresh

```js
// Full replacement: add the new dataset first, then drop the old one.
var liveId = null;
function refresh() {
  fetch('/api/tracks').then(function (r) { return r.json(); }).then(function (fc) {
    var id = replay.addDataset(fc, { name: 'live' });
    if (liveId !== null) { replay.removeDataset(liveId); }
    liveId = id;
  });
}
setInterval(refresh, 60000);
```

Key points:

- **Add before remove**: the other order briefly shrinks the timeline and can make the view flash.
- Every `addDataset` is a separate dataset; for incremental appends, clean up old ids periodically or memory grows.
- Adding/removing rebuilds the layers, but **the current time, speed, loop, per-element visibility, labels, follow mode and panel states are preserved**.
- New data outside the current range expands the timeline automatically.
- The same `layerPath` across datasets merges; to replace a whole dataset, `removeDataset(oldId)`.

## 6. Time zone and holidays

A Python host can **fetch once and share the table across all clients**. The standard library is enough:

```python
import json
import urllib.request
from functools import lru_cache


@lru_cache(maxsize=8)
def holiday_table(year):
    """chinese-days yearly JSON, keyed by date in the display zone."""
    url = f"https://cdn.jsdelivr.net/npm/chinese-days/dist/years/{year}.json"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.load(r)
    except Exception:
        return None      # 404 = that year is not published yet
```

Two ways to inject it — pick one:

```python
# 1) Ship it with the page
context = {"data": data, "calendar": holiday_table(2025)}
```

```js
// 2) Inject at runtime (no rebuild)
fetch('/api/holidays?year=2025')
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (t) { if (t) replay.setCalendar(t); });
```

Notes:

- Keys are dates **in the display zone** (`YYYY-MM-DD`); when a date is both a holiday and a workday, `workdays` wins.
- `displayTimeZone` defaults to the browser zone; to standardise it, pass it in the options (`'Asia/Shanghai'` or `8`).
- `setCalendar()` / `setTimeZone()` are session methods and never rebuild.
- Do not bundle the yearly JSON into the front-end; cache per year.

## 7. Security and operations

| Topic | Practice |
|---|---|
| Popup content | `popup` / `popups` / `pointPopups` are bound as **HTML**. Escape untrusted text with `html.escape()` in Python; never interpolate it raw |
| JSON injection | Use Jinja2's `{{ data | tojson }}` (escapes `<`, `>`, `&`); do not use `{{ data_json | safe }}` for untrusted data |
| CORS | Not needed when page and API share an origin; for split deployments add `CORSMiddleware` and keep `allow_origins` narrow |
| MIME | When serving `.geojson` files directly, make sure the type is `application/geo+json` (or at least `application/json`); on some Windows setups `StaticFiles` reports `application/octet-stream` |
| Caching | Dev: `no-store`; production: long cache + content hash for static assets, short cache for HTML |
| Large responses | Paginate/increment the API; never return the whole database at once; gzip on the server |
| Data immutability | The plugin holds the FeatureCollection by reference; do not mutate the same object while it is in use |

## 8. Compared with this repository's demo

| Demo part | Location | Owner |
|---|---|---|
| Mounting `/dist` and `/vendor` | `examples/server.py` | host |
| Data injection `data_json` | `examples/templates/demo.html.jinja2` | host |
| Settings panel (basemap, time zone, holiday status) | demo template | host UI |
| Holiday fetching and caching | demo template (browser side) | host (this guide moves it to the server) |
| Data source panel (dataset list, import) | `showDataSource: true` | plugin |
| Multi-hit search | `showSearch: true` | plugin |
| Playback bar, timeline, layer tree, batch, labels | plugin's default controls | plugin |
| Dev no-cache middleware | `examples/server.py` | host (dev convenience) |
| Sample data generation | `examples/server.py` | host |

## 9. Checklist and troubleshooting

Check before going live:

- [ ] `/vendor/leaflet.js` loads **before** `/dist/leaflet-trackreplay.umd.js`.
- [ ] The plugin CSS is loaded and `#map` has an explicit height.
- [ ] `times` matches the coordinates, ascending, in ms; `layerPath` is an array.
- [ ] The first paint shows the basemap and the track, and the playback bar works.
- [ ] The API returns JSON and is reachable on the same origin; CORS only for split deployments.
- [ ] Untrusted text is escaped; `tojson`, not `safe`.
- [ ] Production cache headers are configured.

| Symptom | Cause | Fix |
|---|---|---|
| Startup fails on a missing directory | `dist/` or `vendor/` missing | Build/copy the assets, or mount them optionally |
| 404 on `/dist/...` | Wrong mount path or file name | Check `app.mount` and the HTML `src` |
| `L is not defined` | Leaflet missing or loaded after the plugin | Leaflet first, plugin second |
| Blank map / a grey strip | No container height, CSS not loaded | Add the height; load the plugin CSS |
| Track does not appear | Not a `LineString`, or `times` length mismatch | Check the console for the `times.length` error; match lengths |
| Dots land in the ocean | Coordinates written as `[lat, lng]` | Change to `[lng, lat]` |
| Playback ends immediately | `times` not ascending, or seconds vs ms misread | Sort ascending; use ms |
| Tracks double after a refresh | Only `addDataset`, old ones never removed | Keep the id; add before remove |
| Opening a `.geojson` downloads it | Wrong MIME type | Set `application/geo+json` |
| URL import in the panel fails | Cross-origin, no CORS | Deploy same-origin, or add CORS to the API |
