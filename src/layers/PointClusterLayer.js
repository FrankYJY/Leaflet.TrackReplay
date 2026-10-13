/**
 * PointClusterLayer — renders track points with marker clustering.
 *
 * Uses Leaflet.markercluster if available; falls back to a plain FeatureGroup.
 * Extracts all unique coordinates from track data as point markers.
 */

/**
 * PointClusterLayer — renders track points with marker clustering.
 *
 * Every data point of a TimestampEdgeoJSON track gets its own marker, even when
 * several points share the exact same coordinates (e.g. a track that visits the
 * same place twice). Such coincident points stay clustered — also at max zoom —
 * and clicking the cluster spiderfies them so each point can be inspected
 * (Leaflet.markercluster behaviour, like folium's MarkerCluster).
 *
 * Uses Leaflet.markercluster if available; falls back to a plain FeatureGroup.
 *
 * @param {Object[]} features    - timestamped features (source segments from DataParser)
 * @param {Object} [options]
 * @param {Object} [options.pointStyle]   - style for individual points
 * @param {Object} [options.clusterStyle] - options for markerCluster plugin
 * @returns {L.FeatureGroup|L.MarkerClusterGroup}
 */
export function createPointClusterLayer(features, options) {
  options = options || {};

  var pointStyle = options.pointStyle || {
    radius: 4,
    fillColor: '#3388ff',
    color: '#ffffff',
    weight: 1,
    opacity: 1,
    fillOpacity: 0.8,
  };

  var clusterOptions = L.extend({}, options.clusterStyle || {});

  // Spiderfy legs are animated through `leg._path`, which only exists when the
  // leg polyline is SVG-rendered. Force an SVG renderer for the legs so
  // spiderfy keeps working on maps that use `preferCanvas: true`. The legs are
  // decorative and must not swallow clicks aimed at the spread-out markers
  // (their endpoint sits exactly on the marker).
  if (!clusterOptions.spiderLegPolylineOptions) {
    clusterOptions.spiderLegPolylineOptions = {
      renderer: L.svg(),
      weight: 1.5,
      color: '#222',
      opacity: 0.5,
      interactive: false,
    };
  }

  // Use MarkerClusterGroup if available
  var MCG = (typeof L !== 'undefined' && L.markerClusterGroup) ? L.markerClusterGroup : null;
  var group = MCG ? new MCG(clusterOptions) : L.featureGroup();

  var added = 0;
  var seen = {}; // dedupe table for non-timestamped GeoJSON features

  for (var i = 0; i < features.length; i++) {
    var feature = features[i];
    var meta = feature._trackMeta;

    // ---- Timestamped track: one marker per data point (no deduplication) ----
    if (meta && meta.coords) {
      // Only the source feature carries the full track — split segments repeat it
      if (!meta._isSource) { continue; }

      var coords = meta.coords;
      var pointPopups = meta.pointPopups;
      var segPopups = meta.popups;

      for (var p = 0; p < coords.length; p++) {
        var pt = coords[p];
        var marker = L.circleMarker([pt[1], pt[0]], pointStyle);

        var text = pointPopups && pointPopups[p];
        if (!text && segPopups) {
          // Fallback: popup of the segment arriving at this point
          text = segPopups[p === 0 ? 0 : p - 1];
        }
        if (text) {
          marker.bindPopup(text);
        }
        group.addLayer(marker);
        added++;
      }
      continue;
    }

    // ---- Regular GeoJSON features: deduplicate shared coordinates ----
    var geom = feature.geometry;
    if (!geom || !geom.coordinates) { continue; }
    var props = feature.properties || {};

    var coordList = geom.type === 'LineString' ? geom.coordinates : [geom.coordinates];

    for (var j = 0; j < coordList.length; j++) {
      var c = coordList[j];
      var lng = Array.isArray(c) ? c[0] : (c.lng || c.x || 0);
      var lat = Array.isArray(c) ? c[1] : (c.lat || c.y || 0);
      var key = lat.toFixed(6) + '_' + lng.toFixed(6);

      if (seen[key]) {
        seen[key].count++;
        continue;
      }

      seen[key] = { lat: lat, lng: lng, count: 1 };

      var m = L.circleMarker([lat, lng], pointStyle);
      if (props.popup) {
        m.bindPopup(props.popup);
      }
      group.addLayer(m);
      added++;
    }
  }

  group._pointCount = added;
  return group;
}
