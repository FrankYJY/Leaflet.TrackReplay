/**
 * StaticLayer — renders a regular (non-timestamped) GeoJSON layer.
 * This is a thin wrapper around L.geoJSON for consistency with the plugin API.
 *
 * Point features render as rings by default: an unfilled L.circleMarker whose
 * radius is in pixels (screen-fixed size, like folium's CircleMarker). That is
 * the shape used for event markers; override with `properties.style`
 * (e.g. `{fill: true, fillColor: …}` for a filled dot, `radius` for size).
 */

/** Default ring style for Point features (overridden per feature by style). */
var RING_DEFAULT = {
  radius: 10,
  color: '#e74c3c',
  weight: 2,
  opacity: 0.9,
  fill: false,
};

/**
 * Create a static GeoJSON layer.
 *
 * @param {Object[]} features    - standard GeoJSON features
 * @param {Object} [options]     - options passed to L.geoJSON
 * @returns {L.GeoJSON}
 */
export function createStaticLayer(features, options) {
  options = options || {};

  var fc = {
    type: 'FeatureCollection',
    features: features,
  };

  // Bind `properties.popup` content if present (mirrors the timestamped
  // feature convention), without clobbering a user-supplied onEachFeature.
  var userOnEach = options.onEachFeature;
  var geoJsonOptions = L.extend({}, options);
  geoJsonOptions.onEachFeature = function (feature, layer) {
    var props = feature.properties || {};
    if (props.popup && layer.bindPopup) {
      layer.bindPopup(props.popup);
    }
    if (userOnEach) { userOnEach(feature, layer); }
  };

  // Apply `properties.style` per feature unless the caller supplies a style fn
  if (!geoJsonOptions.style) {
    geoJsonOptions.style = function (feature) {
      return (feature.properties && feature.properties.style) || {};
    };
  }

  // Points become rings (unfilled circle markers) unless the caller decides
  if (!geoJsonOptions.pointToLayer) {
    geoJsonOptions.pointToLayer = function (feature, latlng) {
      var style = L.extend({}, RING_DEFAULT,
        (feature.properties && feature.properties.style) || {});
      return L.circleMarker(latlng, style);
    };
  }

  var layer = L.geoJSON(fc, geoJsonOptions);
  return layer;
}
