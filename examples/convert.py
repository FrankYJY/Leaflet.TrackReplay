#!/usr/bin/env python3
"""
convert.py — turn your own data into the GeoJSON this plugin eats.

Standard library only. The format itself is documented in the plugin's README
("TimestampEdgeoJSON Format"); this module is the shortest path from "a
sequence of (time, coordinate) samples" to a playable track — speeds and
popups are computed for you.

    from convert import track, event, background_nodes, area, write_geojson

    fc = {
        "type": "FeatureCollection",
        "features": [
            track(
                [(t, lng, lat), ...],       # (time, lng, lat) — GeoJSON order!
                layer_path=["visitor", "Bee"],
                name="Bee",
            ),
            event([116.410, 39.905], layer_path=["visitor", "Bee"], popup="掉头"),
            background_nodes([(116.40, 39.90), (116.41, 39.91)],
                             layer_path=["background", "pois"]),
            area([(116.39, 39.89), (116.42, 39.89), (116.42, 39.92)],
                 layer_path=["zones", "study"], popup="研究区"),
        ],
    }
    write_geojson(fc, "demo.geojson")

Then drop that file onto the demo map (or paste it) — it plays.

What track() does for you:
  * times: datetime objects, seconds or milliseconds → milliseconds (detected)
  * speeds: km/h per segment, from haversine distance / time difference
  * popups: one per segment ("time → time / speed / distance"), optional per
    point popups with cumulative distance
  * drawMovingIndicator, so the moving arrow shows up

Two things to keep in mind (both are format rules, not this script's):
  * coordinates are [lng, lat] — longitude FIRST, like all GeoJSON
  * arrays that run parallel to the points must match their lengths:
    times / pointPopups = number of points, speeds / styles / popups = points - 1

Getting your rows in: whatever your source is, map it to tuples once —
    points = [(row["time"], row["lng"], row["lat"]) for row in rows]
    # or, pandas: list(df[["time", "lng", "lat"]].itertuples(index=False, name=None))
"""

import json
import math
import sys
from datetime import datetime

EARTH_R_KM = 6371.0  # the same constant the plugin's JS side uses


# ---------------------------------------------------------------- basics ----

def _to_ms(t):
    """datetime | seconds | milliseconds -> milliseconds (Unix epoch)."""
    if isinstance(t, datetime):
        return int(t.timestamp() * 1000)
    v = float(t)
    # Same heuristic the plugin uses: anything past ~2001-09-09 in seconds is
    # already milliseconds.
    return int(v * 1000) if abs(v) < 1e12 else int(v)


def _haversine_km(lng1, lat1, lng2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(math.sqrt(a))


def _speed_kmh(dist_km, dt_ms):
    if dt_ms <= 0:
        return 0.0
    return dist_km / (dt_ms / 3600000.0)


def _fmt_time(ms, fmt="%H:%M:%S"):
    return datetime.fromtimestamp(ms / 1000.0).strftime(fmt)


def _default_segment_popup(label, i, total, t0, t1, speed, dist_m):
    return (
        "<b>%s</b> · 第 %d/%d 段<br>%s → %s<br>速度 %.1f km/h · 距离 %.0f m"
        % (label, i + 1, total, _fmt_time(t0), _fmt_time(t1), speed, dist_m)
    )


def _default_point_popup(label, i, total, t, cum_km):
    return "<b>%s</b> · 节点 %d/%d<br>时间 %s<br>累计 %.2f km" % (
        label, i + 1, total, _fmt_time(t, "%Y-%m-%d %H:%M:%S"), cum_km)


# ---------------------------------------------------------------- shapes ----

def track(points, layer_path, name=None, popups=True, point_popups=False,
          moving_indicator=True, speeds=None, styles=None, style=None,
          visibility=None):
    """A playable track from a sequence of samples.

    points : iterable of (time, lng, lat) — time may be a datetime, seconds or
             milliseconds. At least two points are required.
    layer_path : ["group", "object"] — decides the layer tree / object it
             belongs to. Features sharing a layer path merge into one object.
    name : label used in the generated popups (defaults to the last path part)
    popups / point_popups : auto-fill per-segment / per-point popups (pass
             False and fill props["popups"] / ["pointPopups"] yourself for
             custom text)
    speeds : pass your own km/h list (length = points - 1) to override
    styles : per-segment styles (length = points - 1); omit "color" in them to
             keep the plugin's speed-coloured lines
    style : base style for the whole line; color = one single colour
    """
    pts = [(_to_ms(t), float(lng), float(lat)) for (t, lng, lat) in points]
    if len(pts) < 2:
        raise ValueError("a track needs at least 2 points (got %d)" % len(pts))

    coords = [[lng, lat] for (_, lng, lat) in pts]
    times = [t for (t, _, _) in pts]

    dists_km = [
        _haversine_km(pts[i][1], pts[i][2], pts[i + 1][1], pts[i + 1][2])
        for i in range(len(pts) - 1)
    ]
    seg_speeds = speeds if speeds is not None else [
        _speed_kmh(dists_km[i], times[i + 1] - times[i])
        for i in range(len(pts) - 1)
    ]
    n_seg = len(pts) - 1
    label = name or (layer_path[-1] if layer_path else "track")

    props = {
        "layerPath": list(layer_path),
        "isTimestampedgeojson": True,       # marks it as a replayable track
        "times": times,
        "speeds": [round(s, 2) for s in seg_speeds],
    }
    if moving_indicator:
        props["drawMovingIndicator"] = True
    if popups:
        props["popups"] = [
            _default_segment_popup(label, i, n_seg, times[i], times[i + 1],
                                   seg_speeds[i], dists_km[i] * 1000)
            for i in range(n_seg)
        ]
    if point_popups:
        cum = 0.0
        out = []
        for i in range(len(pts)):
            if i > 0:
                cum += dists_km[i - 1]
            out.append(_default_point_popup(label, i, len(pts), times[i], cum))
        props["pointPopups"] = out
    if styles is not None:
        props["styles"] = list(styles)   # length must be points - 1
    if style is not None:
        props["style"] = dict(style)
    if visibility is not None:
        props["layerVisibility"] = bool(visibility)

    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": props,
    }


def event(coord, layer_path, popup=None, style=None):
    """A point annotation (rendered as a clickable ring above the tracks)."""
    props = {"layerPath": list(layer_path), "element": "events"}
    if popup is not None:
        props["popup"] = popup
    props["style"] = dict(style) if style else {"color": "#e74c3c", "radius": 10}
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [float(coord[0]), float(coord[1])]},
        "properties": props,
    }


def background_nodes(coords, layer_path, popups=None, style=None):
    """Many time-independent points (pois, samples, …) as one MultiPoint."""
    props = {"layerPath": list(layer_path), "element": "background_nodes"}
    if popups is not None:
        props["popups"] = list(popups)          # length must equal the points
    if style is not None:
        props["style"] = dict(style)
    return {
        "type": "Feature",
        "geometry": {
            "type": "MultiPoint",
            "coordinates": [[float(x), float(y)] for (x, y) in coords],
        },
        "properties": props,
    }


def area(coords, layer_path, popup=None, style=None, holes=None):
    """A static polygon (context drawn beneath the tracks). `coords` is the
    outer ring; the ring is closed for you if it is not already."""
    ring = [[float(x), float(y)] for (x, y) in coords]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    rings = [ring]
    for hole in (holes or []):
        h = [[float(x), float(y)] for (x, y) in hole]
        if h[0] != h[-1]:
            h.append(h[0])
        rings.append(h)
    props = {"layerPath": list(layer_path)}
    if popup is not None:
        props["popup"] = popup
    if style is not None:
        props["style"] = dict(style)
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": rings},
        "properties": props,
    }


def dumps(fc):
    return json.dumps(fc, ensure_ascii=False, indent=2)


def write_geojson(fc, path):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(dumps(fc))
    return path


# ------------------------------------------------------------------ demo ----

def _sample_collection():
    """A tiny deterministic walk (plus the other shapes), so `python convert.py`
    produces something you can drop straight onto the demo map."""
    lat0, lng0 = 39.900, 116.400
    t0 = 1783014000000                      # fixed epoch ms: reproducible output
    r_deg = 0.004                           # ~440 m radius
    lng_stretch = 1.0 / math.cos(math.radians(lat0))  # keep the arc circular
    points = []
    for i in range(20):
        angle = (math.pi / 2) * i / 19
        points.append((
            t0 + i * 10_000,                # one sample every 10 s
            lng0 + r_deg * math.cos(angle) * lng_stretch,
            lat0 + r_deg * math.sin(angle),
        ))

    pois = [
        (lng0 + 0.003 * math.cos(a), lat0 + 0.003 * math.sin(a))
        for a in (0.6, 1.2, 1.8, 2.4)
    ]
    return {
        "type": "FeatureCollection",
        "features": [
            track(points, layer_path=["示例", "步行"], name="步行",
                  point_popups=True),
            event(points[len(points) // 2][1:], layer_path=["示例", "步行"],
                  popup="<b>中途事件</b><br>轨迹中点"),
            background_nodes(pois, layer_path=["背景", "兴趣点"],
                             popups=["兴趣点 %d" % (i + 1) for i in range(len(pois))]),
            area([(lng0 - 0.006, lat0 - 0.006), (lng0 + 0.008, lat0 - 0.006),
                  (lng0 + 0.008, lat0 + 0.008), (lng0 - 0.006, lat0 + 0.008)],
                 layer_path=["区域", "研究区"], popup="研究区域",
                 style={"color": "#888", "weight": 1, "fillOpacity": 0.05}),
        ],
    }


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "demo-track.geojson"
    write_geojson(_sample_collection(), out)
    # ASCII only: this line must survive a cp1252 console.
    print("wrote %s - drop it onto the demo map, or paste it into the "
          "data source panel" % out)
