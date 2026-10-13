/**
 * TrackLayer — renders speed-colored track lines from parsed segment features.
 *
 * Each segment is a 2-point LineString with style info in properties.style.
 * This layer manages creating/updating the polyline objects.
 */

/**
 * Create a track layer from a list of segment features.
 *
 * @param {Object[]} features     - segment-level GeoJSON features (from DataParser)
 * @param {Object} [options]
 * @param {Object} [options.defaultStyle] - fallback style for segments without one
 * @returns {L.FeatureGroup} a Leaflet FeatureGroup containing all track polylines
 */
export function createTrackLayer(features, options) {
  options = options || {};
  var defaultStyle = options.defaultStyle || {
    color: '#3388ff',
    weight: 3,
    opacity: 0.8,
  };

  var group = L.featureGroup();

  // Build a lookup: original feature time-range → set of segment polylines
  // This helps DynamicRoute later
  group._segmentMap = {};
  group._segments = [];

  for (var i = 0; i < features.length; i++) {
    var feature = features[i];
    var props = feature.properties || {};
    var style = props.style || defaultStyle;
    var geom = feature.geometry;

    if (!geom || geom.type !== 'LineString') { continue; }

    // Convert GeoJSON coords [lng, lat] to Leaflet [lat, lng]
    var latlngs = geom.coordinates.map(function (c) {
      return [c[1], c[0]];
    });

    var polyline = L.polyline(latlngs, style);

    // Attach metadata
    polyline._trackReplayMeta = {
      timeStart: props._timeStart,
      timeEnd: props._timeEnd,
      speed: props.speed,
      segmentIndex: props._segmentIndex,
      popup: props.popup,
    };

    if (props.popup) {
      polyline.bindPopup(props.popup);
    }

    // Group by time range for dynamic route tracking
    var rangeKey = props._timeStart + '_' + props._timeEnd;
    if (!group._segmentMap[rangeKey]) {
      group._segmentMap[rangeKey] = [];
    }
    group._segmentMap[rangeKey].push({
      polyline: polyline,
      timeStart: props._timeStart,
      timeEnd: props._timeEnd,
      speed: props.speed,
      coords: geom.coordinates,
    });

    group._segments.push({
      polyline: polyline,
      timeStart: props._timeStart,
      timeEnd: props._timeEnd,
    });

    group.addLayer(polyline);
  }

  return group;
}
