/**
 * DynamicRoute — "traveled" and "untraveled" route overlays that follow the
 * moving object.
 *
 * Both are drawn as *hollow* bands (design doc: "中空的中间是透明的边缘绘制的
 * 线段"): two thin parallel lines offset to either side of the track, leaving
 * the middle transparent so the original track line stays visible. The offset
 * is in screen pixels and is recomputed on zoom, so the hollow gap stays the
 * same size at every zoom level.
 */

/**
 * Offset a [[lng, lat], …] polyline sideways by `offsetMeters`
 * (positive = left of the direction of travel). Works in a local metric frame
 * with miter joins (with a miter limit).
 */
function offsetPolyline(coords, offsetMeters) {
  var n = coords.length;
  if (n < 2) { return coords.slice(); }

  // local equirectangular frame (meters)
  var lat0 = 0;
  for (var i = 0; i < n; i++) { lat0 += coords[i][1]; }
  lat0 /= n;
  var mLat = 111320;
  var mLng = 111320 * Math.cos(lat0 * Math.PI / 180);

  var pts = [];
  for (var p = 0; p < n; p++) {
    pts.push([coords[p][0] * mLng, coords[p][1] * mLat]);
  }

  function segNormal(a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) { return null; } // zero-length segment: no direction
    return [-dy / len, dx / len]; // left normal
  }

  // Normals per segment, computed once. A stationary stretch (repeated
  // coordinates — the norm in GPS data) has no direction, and a point that
  // only borders such segments has no normal of its own; it borrows one from
  // further along the line instead of falling over.
  var segNormals = [];
  for (var s = 0; s < n - 1; s++) {
    segNormals.push(segNormal(pts[s], pts[s + 1]));
  }

  function borrowedNormal(k) {
    for (var d = 0; d < n; d++) {
      if (k - 1 - d >= 0 && segNormals[k - 1 - d]) { return segNormals[k - 1 - d]; }
      if (k + d <= n - 2 && segNormals[k + d]) { return segNormals[k + d]; }
    }
    return null; // every point identical — nothing to offset by
  }

  var out = [];
  for (var k = 0; k < n; k++) {
    var n1 = (k > 0) ? segNormals[k - 1] : null;
    var n2 = (k < n - 1) ? segNormals[k] : null;

    var nx, ny, scale = offsetMeters;

    if (n1 && n2) {
      // miter join: average the two normals, stretch by 1/cos(θ/2), limited
      nx = n1[0] + n2[0];
      ny = n1[1] + n2[1];
      var len = Math.sqrt(nx * nx + ny * ny);
      if (len < 1e-6) {
        // 180° reversal (e.g. an out-and-back apex) — degenerate, keep n1
        nx = n1[0];
        ny = n1[1];
      } else {
        nx /= len;
        ny /= len;
        scale = offsetMeters / Math.max(0.35, nx * n1[0] + ny * n1[1]);
      }
    } else {
      var nn = n1 || n2 || borrowedNormal(k);
      if (nn) {
        nx = nn[0];
        ny = nn[1];
      } else {
        nx = 0;
        ny = 0; // degenerate: keep the point on the centreline
      }
    }

    out.push([pts[k][0] + nx * scale, pts[k][1] + ny * scale]);
  }

  // back to lng/lat
  var res = [];
  for (var q = 0; q < out.length; q++) {
    res.push([out[q][0] / mLng, out[q][1] / mLat]);
  }
  return res;
}

/**
 * Create a dynamic route pair for a track.
 *
 * @param {Object} sourceFeature  - feature with _trackMeta (original TimestampEdgeoJSON)
 * @param {Object} [options]
 * @param {Object} [options.traveledStyle]   - style for traveled edges
 * @param {Object} [options.untraveledStyle] - style for untraveled edges
 * @param {number} [options.edgeOffset=4]    - hollow gap, offset per side in px
 * @returns {Object} { traveled, untraveled, update(timeMs), reset(), remove() }
 *          `traveled` / `untraveled` are LayerGroups holding the two edge lines
 */
export function createDynamicRoute(sourceFeature, options) {
  options = options || {};

  var meta = sourceFeature._trackMeta;
  if (!meta || !meta.times || !meta.coords) {
    throw new Error('DynamicRoute: sourceFeature must have _trackMeta');
  }

  var coords = meta.coords;
  var times = meta.times;

  var offsetPx = (options.edgeOffset !== undefined && options.edgeOffset !== null)
    ? options.edgeOffset
    : 4;

  // Overlays must never swallow clicks aimed at the track segments below
  var traveledStyle = L.extend({}, options.traveledStyle || {
    color: '#e74c3c',
    weight: 2,
    opacity: 0.9,
  }, { interactive: false });

  var untraveledStyle = L.extend({}, options.untraveledStyle || {
    color: '#3498db',
    weight: 2,
    opacity: 0.6,
    dashArray: '5, 10',
  }, { interactive: false });

  var traveledLeft = L.polyline([], traveledStyle);
  var traveledRight = L.polyline([], traveledStyle);
  var untraveledLeft = L.polyline([], untraveledStyle);
  var untraveledRight = L.polyline([], untraveledStyle);

  var traveled = L.featureGroup([traveledLeft, traveledRight]);
  var untraveled = L.featureGroup([untraveledLeft, untraveledRight]);

  // mean latitude for the meters-per-pixel conversion
  var meanLat = 0;
  for (var mi = 0; mi < coords.length; mi++) { meanLat += coords[mi][1]; }
  meanLat /= coords.length;
  var cosLat = Math.cos(meanLat * Math.PI / 180);

  var leftCoords = null;   // offset polylines at the current zoom
  var rightCoords = null;
  var _zoom = null;
  var _lastTime = null;

  function toLatLngs(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      out.push([arr[i][1], arr[i][0]]);
    }
    return out;
  }

  function rebuildOffsets(zoom) {
    var metersPerPixel = 40075016.686 * cosLat / (256 * Math.pow(2, zoom));
    var offsetM = offsetPx * metersPerPixel;
    leftCoords = offsetPolyline(coords, offsetM);
    rightCoords = offsetPolyline(coords, -offsetM);
    _zoom = zoom;
  }

  /**
   * Split one offset polyline into traveled / untraveled parts at `timeMs`
   * (same index math as the centerline, so the edges stay aligned with it).
   */
  function sliceAt(offsetCoords, timeMs) {
    var traveledLL = [];
    var untraveledLL = [];

    if (timeMs <= times[0]) {
      untraveledLL = toLatLngs(offsetCoords);
    } else if (timeMs >= times[times.length - 1]) {
      traveledLL = toLatLngs(offsetCoords);
    } else {
      for (var i = 0; i < times.length - 1; i++) {
        if (timeMs >= times[i] && timeMs <= times[i + 1]) {
          var range = times[i + 1] - times[i];
          var frac = range > 0 ? (timeMs - times[i]) / range : 0;
          var a = offsetCoords[i];
          var b = offsetCoords[i + 1];
          var ix = a[0] + (b[0] - a[0]) * frac;
          var iy = a[1] + (b[1] - a[1]) * frac;

          for (var j = 0; j <= i; j++) {
            traveledLL.push([offsetCoords[j][1], offsetCoords[j][0]]);
          }
          traveledLL.push([iy, ix]);

          untraveledLL.push([iy, ix]);
          for (var k = i + 1; k < offsetCoords.length; k++) {
            untraveledLL.push([offsetCoords[k][1], offsetCoords[k][0]]);
          }
          break;
        }
      }
    }

    return { traveled: traveledLL, untraveled: untraveledLL };
  }

  /**
   * Update both route overlays for the current time.
   * @param {number} timeMs
   */
  function update(timeMs) {
    _lastTime = timeMs;

    // keep the hollow gap constant on screen
    var map = traveled._map || untraveled._map;
    if (map && map.getZoom() !== _zoom) {
      rebuildOffsets(map.getZoom());
    }
    if (!leftCoords) { return; } // not on the map yet

    var left = sliceAt(leftCoords, timeMs);
    var right = sliceAt(rightCoords, timeMs);

    traveledLeft.setLatLngs(left.traveled);
    traveledRight.setLatLngs(right.traveled);
    untraveledLeft.setLatLngs(left.untraveled);
    untraveledRight.setLatLngs(right.untraveled);
  }

  /**
   * Reset the route (replay restart): nothing traveled, everything ahead.
   */
  function reset() {
    traveledLeft.setLatLngs([]);
    traveledRight.setLatLngs([]);
    if (leftCoords) {
      untraveledLeft.setLatLngs(toLatLngs(leftCoords));
      untraveledRight.setLatLngs(toLatLngs(rightCoords));
    }
  }

  function remove() {
    if (traveled._map) { traveled._map.removeLayer(traveled); }
    if (untraveled._map) { untraveled._map.removeLayer(untraveled); }
  }

  // Recompute the offsets when the zoom changes while the route is idle
  // (e.g. the user zooms while playback is paused)
  function onTraveledAdd() { this._map.on('zoomend', onTraveledZoom); }
  function onTraveledZoom() { if (_lastTime !== null) { update(_lastTime); } }
  function onUntraveledAdd() { this._map.on('zoomend', onUntraveledZoom); }
  function onUntraveledZoom() { if (_lastTime !== null) { update(_lastTime); } }

  traveled.on('add', onTraveledAdd);
  traveled.on('remove', function () { this._map.off('zoomend', onTraveledZoom); });
  untraveled.on('add', onUntraveledAdd);
  untraveled.on('remove', function () { this._map.off('zoomend', onUntraveledZoom); });

  return {
    traveled: traveled,
    untraveled: untraveled,
    update: update,
    reset: reset,
    remove: remove,
  };
}
