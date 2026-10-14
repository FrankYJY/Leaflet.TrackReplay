/**
 * BackgroundNodesLayer — a background layer of many standalone location
 * points ("background nodes"): a point cloud that is NOT tied to any time
 * sequence, drawn as context underneath the tracks (sample points, POIs,
 * coverage readings, …).
 *
 * Data is plain GeoJSON tagged with `properties.element = "background_nodes"`
 * (a reserved element name). Two forms are accepted and may be mixed in one
 * FeatureCollection:
 *
 *   1. one feature per location — Point geometry, popup via `properties.popup`
 *   2. one compact feature for many locations — MultiPoint geometry with
 *      optional `popups[]` / `styles[]` arrays (length = coordinates.length)
 *
 * Rendering: small filled dots (radius 4, neutral slate fill) by default,
 * overridable per feature via `properties.style` (and per point via
 * `styles[i]`). The dots render through the map's shared vector renderer —
 * the same renderer the tracks use — so Leaflet's normal hit-testing applies
 * and every node is clickable for its popup, exactly like track points (a
 * lower pane would paint beneath the tracks but would never receive clicks,
 * since the tracks' canvas covers it). To keep the background semantics the
 * dots are brought to the back of that shared renderer whenever they are
 * (re)added, so they draw beneath the tracks. Every node is drawn as its own
 * dot by default (scatter); `cluster: true` in the options groups dense
 * clouds with Leaflet.markercluster — bubbles sit in the marker pane like
 * track-point clusters, so they are clickable too (click zooms in).
 */

/** Default node style: a small filled dot (design: 小实心圆点). */
var DEFAULT_STYLE = {
  radius: 4,
  color: '#ffffff',
  weight: 1,
  opacity: 1,
  fillColor: '#6b7785',
  fillOpacity: 0.85,
};

/**
 * Create a background nodes layer.
 *
 * @param {Object[]} features   - non-timestamped GeoJSON features of this
 *                                bucket (Point / MultiPoint geometries)
 * @param {Object} [options]
 * @param {Object} [options.style]          - base marker style for all nodes
 *        (merged over the defaults: small filled dot)
 * @param {boolean} [options.cluster=false] - group dense clouds with
 *        Leaflet.markercluster when available (default: plain scatter dots)
 * @param {Object} [options.clusterOptions] - extra options for
 *        L.markerClusterGroup (spiderfy legs are preset)
 * @returns {L.MarkerClusterGroup|L.FeatureGroup} with `_backgroundNodeCount`
 */
export function createBackgroundNodesLayer(features, options) {
  options = options || {};

  var baseStyle = L.extend({}, DEFAULT_STYLE, options.style || {});

  var MCG = (typeof L !== 'undefined' && L.markerClusterGroup) ? L.markerClusterGroup : null;
  var cluster = options.cluster === true && MCG;

  var clusterOptions = L.extend({}, options.clusterOptions || {});
  // Spiderfy legs are animated through `leg._path`, which only exists on an
  // SVG-rendered polyline — same trick as PointClusterLayer.
  if (!clusterOptions.spiderLegPolylineOptions) {
    clusterOptions.spiderLegPolylineOptions = {
      renderer: L.svg(),
      weight: 1.5,
      color: '#222',
      opacity: 0.5,
      interactive: false,
    };
  }

  var group = cluster ? new MCG(clusterOptions) : L.featureGroup();
  var count = 0;

  function addNode(lng, lat, style, popup) {
    var marker = L.circleMarker([lat, lng], style);

    // Keep the dots beneath the tracks: the shared renderer paints in
    // insertion order, so each dot is re-sent to the back every time it
    // (re)enters the map — including when markercluster un-clusters it at
    // higher zoom. Clicking is unaffected: hit-testing picks the topmost
    // layer at the cursor, so uncovered dots receive their own clicks.
    marker.on('add', function () { this.bringToBack(); });

    if (popup) { marker.bindPopup(popup); }
    group.addLayer(marker);
    count++;
  }

  for (var i = 0; i < features.length; i++) {
    var feature = features[i];
    var geom = feature.geometry;
    var props = feature.properties || {};
    var featureStyle = L.extend({}, baseStyle, props.style || {});

    if (geom && geom.type === 'Point') {
      addNode(geom.coordinates[0], geom.coordinates[1], featureStyle, props.popup);
      continue;
    }

    if (geom && geom.type === 'MultiPoint') {
      var coords = geom.coordinates || [];
      var popups = props.popups || null;
      var styles = props.styles || null;

      // Same validation style as DataParser's pointPopups: a length mismatch
      // is reported and the array ignored, rather than silently misaligning.
      if (popups && popups.length !== coords.length) {
        console.error('BackgroundNodes: popups.length (' + popups.length +
          ') !== coordinates.length (' + coords.length + ')');
        popups = null;
      }
      if (styles && styles.length !== coords.length) {
        console.error('BackgroundNodes: styles.length (' + styles.length +
          ') !== coordinates.length (' + coords.length + ')');
        styles = null;
      }

      for (var p = 0; p < coords.length; p++) {
        var pt = coords[p];
        var ptStyle = (styles && styles[p])
          ? L.extend({}, featureStyle, styles[p])
          : featureStyle;
        addNode(pt[0], pt[1], ptStyle, popups && popups[p]);
      }
      continue;
    }

    // The mode is point data by definition; anything else is a data error.
    console.warn('BackgroundNodes: element "background_nodes" expects Point or ' +
      'MultiPoint geometry, got "' + (geom && geom.type) + '" — feature skipped');
  }

  group._backgroundNodeCount = count;
  return group;
}
