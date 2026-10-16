/**
 * GPX — GPS Exchange Format → GeoJSON conversion.
 *
 * GPX (the XML track format exported by GPS devices, sports watches and
 * tracking apps) carries one or more <trk> tracks, each split into <trkseg>
 * segments of <trkpt lat lon> points with optional <ele> and <time>. This
 * converter turns them into what TrackReplay consumes:
 *
 *   - a segment whose points ALL carry <time> → a TimestampEdgeoJSON
 *     LineString (`times[]` in ms). `drawMovingIndicator` is on by default so
 *     the imported track replays immediately (moving arrow + route edges);
 *     pass `movingIndicator: false` to leave it off.
 *   - a segment without (or with partial) time information → a plain static
 *     LineString — it cannot participate in playback; the report flags it so
 *     the caller can tell the user.
 *   - each <trkseg> becomes its own feature: gaps between segments are never
 *     bridged with invented interpolation.
 *   - <wpt> waypoints become static Point features (popup from name/desc).
 *
 * Uses the browser DOMParser. Coordinates are used as-is — GPX is WGS-84
 * (地球坐标系), which is the plugin's input contract.
 */

/** Escape a string for safe inclusion in popup HTML. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** First descendant with the given local name (namespace-prefix agnostic). */
function childText(el, name) {
  var list = el.getElementsByTagNameNS('*', name);
  return list.length ? list[0].textContent : null;
}

/**
 * Parse GPX text into a GeoJSON FeatureCollection.
 *
 * @param {string} text - the GPX document
 * @param {Object} [opts]
 * @param {string[]} [opts.layerPath] - layerPath assigned to every produced
 *        feature (omit to leave it off — the import flow assigns one)
 * @param {boolean} [opts.movingIndicator=true] - set drawMovingIndicator on
 *        timed segments
 * @param {Object} [opts.staticStyle] - style for the segments that carry no
 *        time (defaults to a neutral grey line)
 * @param {string} [opts.waypointElement] - `properties.element` for waypoints
 *        (e.g. "events"); omitted → they land in the generic static bucket
 * @returns {{featureCollection: Object, report: Object}} report counts:
 *          { segments, timedSegments, staticSegments, points, waypoints }
 */
export function parseGPX(text, opts) {
  opts = opts || {};
  if (typeof DOMParser === 'undefined') {
    throw new Error('GPX: DOMParser is not available in this environment');
  }

  var doc = new DOMParser().parseFromString(text, 'application/xml');
  var parseError = doc.getElementsByTagName('parsererror');
  if (parseError.length) {
    throw new Error('GPX: the file is not valid XML');
  }

  var report = { segments: 0, timedSegments: 0, staticSegments: 0, points: 0, waypoints: 0 };
  var features = [];

  function baseProps() {
    var props = {};
    if (opts.layerPath) { props.layerPath = opts.layerPath.slice(); }
    return props;
  }

  // ---- tracks: one feature per <trkseg> ----
  var tracks = doc.getElementsByTagNameNS('*', 'trk');
  for (var t = 0; t < tracks.length; t++) {
    var segments = tracks[t].getElementsByTagNameNS('*', 'trkseg');
    for (var s = 0; s < segments.length; s++) {
      var trkpts = segments[s].getElementsByTagNameNS('*', 'trkpt');
      var coords = [];
      var times = [];
      var allTimed = trkpts.length > 0;

      for (var p = 0; p < trkpts.length; p++) {
        var lat = parseFloat(trkpts[p].getAttribute('lat'));
        var lon = parseFloat(trkpts[p].getAttribute('lon'));
        if (!isFinite(lat) || !isFinite(lon)) { continue; }

        coords.push([lon, lat]);
        var timeText = childText(trkpts[p], 'time');
        var ms = timeText ? Date.parse(timeText) : NaN;
        if (isFinite(ms)) { times.push(ms); } else { allTimed = false; }
      }

      if (coords.length < 2) { continue; }

      report.segments++;
      report.points += coords.length;

      var props = baseProps();
      var timed = allTimed && times.length === coords.length;
      if (timed) {
        props.isTimestampedgeojson = true;
        props.times = times;
        if (opts.movingIndicator !== false) { props.drawMovingIndicator = true; }
        report.timedSegments++;
      } else {
        props.style = opts.staticStyle || { color: '#7f8c8d', weight: 3, opacity: 0.8 };
        report.staticSegments++;
      }

      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: props,
      });
    }
  }

  // ---- waypoints: static Point features ----
  var waypoints = doc.getElementsByTagNameNS('*', 'wpt');
  for (var w = 0; w < waypoints.length; w++) {
    var wlat = parseFloat(waypoints[w].getAttribute('lat'));
    var wlon = parseFloat(waypoints[w].getAttribute('lon'));
    if (!isFinite(wlat) || !isFinite(wlon)) { continue; }

    var wprops = baseProps();
    if (opts.waypointElement) { wprops.element = opts.waypointElement; }

    var wname = childText(waypoints[w], 'name');
    var wdesc = childText(waypoints[w], 'desc');
    if (wname || wdesc) {
      wprops.popup = (wname ? '<b>' + escapeHtml(wname) + '</b>' : '') +
        (wdesc ? (wname ? '<br>' : '') + escapeHtml(wdesc) : '');
    }

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [wlon, wlat] },
      properties: wprops,
    });
    report.waypoints++;
  }

  return {
    featureCollection: { type: 'FeatureCollection', features: features },
    report: report,
  };
}
