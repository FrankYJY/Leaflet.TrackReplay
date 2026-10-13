"""
Leaflet.TrackReplay — Python Development Server

A lightweight FastAPI + Jinja2 server for local debugging.
Generates sample TimestampEdgeoJSON data and injects it into
a Jinja2 template that loads the Leaflet.TrackReplay plugin.

Usage:
    cd examples
    pip install fastapi uvicorn jinja2
    python server.py

Then open http://localhost:8000 in your browser.
"""

import json
import math
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

app = FastAPI(title="Leaflet.TrackReplay Demo")

# ---- Static files (serve dist/ and examples/) ----
BASE_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = BASE_DIR / "dist"

# Mount dist for plugin JS/CSS
if DIST_DIR.exists():
    app.mount("/dist", StaticFiles(directory=str(DIST_DIR)), name="dist")

# ---- Templates ----
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.middleware("http")
async def no_cache_built_assets(request: Request, call_next):
    """Dev server: never let the browser cache the built plugin assets or the
    rendered page, so a rebuild / template change is picked up on a normal
    reload (avoids new JS + stale CSS, or a stale HTML page)."""
    response = await call_next(request)
    if request.url.path.startswith("/dist") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-store"
    return response


def generate_sample_data() -> dict:
    """
    Generate sample TimestampEdgeoJSON data for demo.
    Creates a spiral track with realistic timestamps and speeds.
    """
    now_ms = int(time.time() * 1000)

    # --- Track 1: Visitor Bee — expanding spiral with constant arc step ---
    # The step length is constant (dθ = ds / r), so the implied speed stays in a
    # sane range; a naive polar spiral would blow up at large radii (~2000 km/h).
    lat0, lng0 = 39.90, 116.40  # Beijing area
    km_per_deg_lat = 111.0
    km_per_deg_lng = 111.0 * math.cos(math.radians(lat0))
    step_km = 0.09        # ~90 m per point → ~80-160 km/h at 2-4 s per point
    r_km = 0.35
    angle = 0.0
    t = now_ms

    bee_coords = []
    bee_times = []
    for i in range(120):
        bee_coords.append([
            lng0 + (r_km * math.cos(angle)) / km_per_deg_lng,
            lat0 + (r_km * math.sin(angle)) / km_per_deg_lat,
        ])
        bee_times.append(t)
        t += int(3000 + 1000 * math.sin(i * 0.2))  # 2-4 seconds per step
        angle += step_km / r_km                    # constant arc length per step
        r_km += 0.0057                             # expand outward slowly

    # Compute speeds (km/h) for the actual geometry
    bee_speeds = []
    for i in range(len(bee_coords) - 1):
        c1 = bee_coords[i]
        c2 = bee_coords[i + 1]
        dist_km = haversine(c1[1], c1[0], c2[1], c2[0])
        dt_h = (bee_times[i + 1] - bee_times[i]) / 3_600_000
        bee_speeds.append(round(dist_km / max(dt_h, 0.0001), 2))

    # Per-segment styles: only weight/opacity are overridden here — the colour
    # is left to the plugin's speed→colour mapper, so the track always matches
    # the legend (in fixed / adaptive / custom mode alike)
    bee_styles = []
    for s in bee_speeds:
        bee_styles.append({
            "weight": max(2, min(6, int(s / 30))),
            "opacity": 0.85,
        })

    # --- Track 2: Visitor Mark — smooth out-and-back (retraces the same path) ---
    # No `color`/`styles` on purpose: this track leaves coloring to the plugin's
    # speed→color mapper so `colorMode` / the legend have a visible effect.
    mark_coords = []
    mark_times = []
    mark_speeds = []
    t = now_ms
    N = 80
    for i in range(N + 1):
        lat = 39.92 + 0.004 * math.sin(i * 0.06)
        lng = 116.42 + i * 0.0005
        mark_coords.append([lng, lat])
        mark_times.append(t)
        t += 3000
    for i in range(1, N + 1):
        lat = 39.92 + 0.004 * math.sin((N - i) * 0.06)
        lng = 116.42 + (N - i) * 0.0005
        mark_coords.append([lng, lat])
        mark_times.append(t)
        t += 3000

    for i in range(len(mark_coords) - 1):
        c1 = mark_coords[i]
        c2 = mark_coords[i + 1]
        dist_km = haversine(c1[1], c1[0], c2[1], c2[0])
        dt_h = (mark_times[i + 1] - mark_times[i]) / 3_600_000
        speed = dist_km / max(dt_h, 0.0001)
        mark_speeds.append(round(speed, 2))

    # --- Track 3: Simple static GeoJSON polygon (no timestamp) ---
    static_polygon = {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [116.38, 39.88],
                [116.44, 39.88],
                [116.44, 39.94],
                [116.38, 39.94],
                [116.38, 39.88],
            ]],
        },
        "properties": {
            "layerPath": ["zones", "study_area"],
            "layerVisibility": True,
            "popup": "<b>研究区域</b><br>zones / study_area",
            "style": {
                "color": "#ff7800",
                "weight": 2,
                "fillColor": "#ff7800",
                "fillOpacity": 0.15,
            },
        },
    }

    # --- Assemble FeatureCollection ---
    feature_collection = {
        "type": "FeatureCollection",
        "features": [
            # Track 1: Bee (with moving indicator)
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": bee_coords,
                },
                "properties": {
                    "layerPath": ["visitor", "Bee"],
                    "layerVisibility": True,
                    "isTimestampedgeojson": True,
                    "times": bee_times,
                    "speeds": bee_speeds,
                    "styles": bee_styles,
                    "popups": build_popups("Bee", bee_coords, bee_times, bee_speeds),
                    "pointPopups": build_point_popups("Bee", bee_coords, bee_times),
                    "drawMovingIndicator": True,
                },
            },
            # Track 2: Mark (with moving indicator)
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": mark_coords,
                },
                "properties": {
                    "layerPath": ["visitor", "Mark"],
                    "layerVisibility": True,
                    "isTimestampedgeojson": True,
                    "times": mark_times,
                    "speeds": mark_speeds,
                    "popups": build_popups("Mark", mark_coords, mark_times, mark_speeds),
                    "pointPopups": build_point_popups("Mark", mark_coords, mark_times),
                    "drawMovingIndicator": True,
                },
            },
            # Track 3: Static polygon
            static_polygon,
            # Event markers — their own "events" element per object, drawn as
            # clickable rings and toggled independently from the points
            event_feature(
                ["visitor", "Mark"], mark_coords[80],
                f"<b>Mark · 掉头事件</b><br>{fmt_time(mark_times[80])}<br>轨迹折返点"),
            event_feature(
                ["visitor", "Mark"], mark_coords[120],
                f"<b>Mark · 重复到访</b><br>{fmt_time(mark_times[120])}<br>与去程节点 41 同一位置"),
            event_feature(
                ["visitor", "Bee"], bee_coords[60],
                f"<b>Bee · 事件</b><br>{fmt_time(bee_times[60])}<br>节点 61",
                style={"radius": 14}),
        ],
    }

    return feature_collection


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlng / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def fmt_time(ms: int) -> str:
    """Unix ms → local HH:MM:SS."""
    return time.strftime("%H:%M:%S", time.localtime(ms / 1000))


def build_popups(label: str, coords: list, times: list, speeds: list) -> list:
    """
    Per-segment popup content (length = number of segments = len(coords) - 1).
    Shown when clicking a track segment.
    """
    popups = []
    for i, speed in enumerate(speeds):
        dist_m = haversine(coords[i][1], coords[i][0],
                           coords[i + 1][1], coords[i + 1][0]) * 1000
        popups.append(
            f"<b>{label}</b> · 第 {i + 1}/{len(speeds)} 段<br>"
            f"{fmt_time(times[i])} → {fmt_time(times[i + 1])}<br>"
            f"速度 {speed:.1f} km/h · 距离 {dist_m:.0f} m"
        )
    return popups


def build_point_popups(label: str, coords: list, times: list) -> list:
    """
    Per-point popup content (length = len(coords)).
    Shown when clicking a track point (node).
    """
    popups = []
    cum_km = 0.0
    for i, c in enumerate(coords):
        if i > 0:
            cum_km += haversine(coords[i - 1][1], coords[i - 1][0], c[1], c[0])
        popups.append(
            f"<b>{label}</b> · 节点 {i + 1}/{len(coords)}<br>"
            f"时间 {fmt_time(times[i])}<br>"
            f"累计 {cum_km:.2f} km"
        )
    return popups


def event_feature(path: list, coord: list, popup: str, style: dict = None) -> dict:
    """
    An event marker: a plain Point feature that belongs to the object's own
    "events" element (not the point cluster), drawn as a clickable ring.
    """
    ring = {"color": "#e74c3c", "weight": 2, "fill": False}
    if style:
        ring.update(style)
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": coord},
        "properties": {
            "layerPath": path,
            "element": "events",
            "popup": popup,
            "style": ring,
        },
    }


@app.get("/", response_class=HTMLResponse)
async def demo_page(request: Request):
    """Render the demo page with sample data injected."""
    data = generate_sample_data()

    # Pass data as JSON embedded in the template
    data_json = json.dumps(data, ensure_ascii=False, indent=2)

    return templates.TemplateResponse(
        request=request,
        name="demo.html.jinja2",
        context={
            "data_json": data_json,
            "data": data,
            "time_min": min(
                f["properties"]["times"][0]
                for f in data["features"]
                if f["properties"].get("isTimestampedgeojson")
            ),
            "time_max": max(
                f["properties"]["times"][-1]
                for f in data["features"]
                if f["properties"].get("isTimestampedgeojson")
            ),
        },
    )


if __name__ == "__main__":
    import uvicorn
    print(f"Dist dir: {DIST_DIR} (exists: {DIST_DIR.exists()})")
    print(f"Templates dir: {TEMPLATES_DIR} (exists: {TEMPLATES_DIR.exists()})")
    print("Starting server at http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
