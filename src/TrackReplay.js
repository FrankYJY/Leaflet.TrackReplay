/**
 * Leaflet.TrackReplay — 时间轴对齐的批量数据回放系统
 *
 * A Leaflet plugin for time-aligned batch data replay.
 * Supports TimestampEdgeoJSON, multi-layer tracks, moving indicators,
 * dynamic route coloring, marker clustering, and more.
 *
 * @author Frank Yao
 * @license MIT
 * @requires Leaflet ^1.7.0
 */

import { parseFeatureCollection } from './core/DataParser.js';
import { createColorMapper } from './core/ColorMapper.js';
import { createTimeEngine } from './core/TimeEngine.js';
import { createLayerControl } from './core/LayerTreeBuilder.js';
import { createDatasetContainer } from './core/DatasetContainer.js';

import { createTrackLayer } from './layers/TrackLayer.js';
import { createPointClusterLayer } from './layers/PointClusterLayer.js';
import { createMovingIndicator } from './layers/MovingIndicator.js';
import { createDynamicRoute } from './layers/DynamicRoute.js';
import { createStaticLayer } from './layers/StaticLayer.js';
import { createBackgroundNodesLayer } from './layers/BackgroundNodesLayer.js';

import { createPlaybackControls } from './controls/PlaybackControls.js';
import { createTimelineControl } from './controls/TimelineControl.js';
import { createControlBar } from './controls/ControlBar.js';
import { createViewFollowControl } from './controls/ViewFollowControl.js';
import { createColorLegend } from './controls/ColorLegend.js';
import { createElementToggles } from './controls/ElementToggles.js';
import { createInfoLabels } from './controls/InfoLabels.js';
import { createClusterScatterControl } from './controls/ClusterScatterControl.js';
import { createDataSourceControl } from './controls/DataSourceControl.js';

import { wgs84ToGcj02, gcj02ToWgs84, outOfChina } from './utils/GCJ02.js';
import { parseGPX } from './utils/GPX.js';
import { createEventBus } from './utils/EventBus.js';

/** Playback events re-emitted on the session bus (forwarded per build). */
var PLAYBACK_EVENTS = ['start', 'pause', 'stop', 'finished', 'tick', 'timechange', 'speedchange'];

/**
 * Internal builder — assembles one complete replay (layers, controls, time
 * engine) from a merged FeatureCollection.
 *
 * The session facade (`trackReplay`, below) calls this once at startup and
 * again on every dataset change. It returns an internal *handle* instead of
 * the public object, so the facade can swap the whole build while its own
 * identity, listeners and API stay stable.
 *
 * @param {L.Map} map              - Leaflet map instance
 * @param {Object} featureCollection - GeoJSON FeatureCollection with TimestampEdgeoJSON features
 * @param {Object} [options]        - full options list, documented on `trackReplay`
 * @param {boolean} [initialCluster] - background-nodes rendering mode carried
 *        over from the previous build (undefined → derived from options)
 * @param {string} [options.colorMode='fixed']     - 'fixed' | 'adaptive' | 'custom'
 * @param {Object} [options.colorConfig]            - custom colorbar config (for 'custom' mode)
 * @param {number[]} [options.colorRange]           - [min, max] km/h for 'fixed' mode
 *        (default [0, 200]); the Turbo-style ramp is spread over this range
 * @param {number} [options.speed=1]                - initial playback speed
 * @param {number[]} [options.speedOptions]         - speed ladder, defaults to
 *        [0.25, 0.5, 1, 2, 4, 8, 60, 600, 3600] (≥60× is labelled as time
 *        compression, e.g. "1s = 1min")
 * @param {Function} [options.speedLabel]           - fn(speed) => display label
 * @param {number} [options.minTickMs=16]           - tick interval floor, keeps
 *        high speeds from flooding the tick loop
 * @param {boolean} [options.loop=false]            - auto-restart when finished
 * @param {number} [options.tickLen=250]            - tick interval in ms
 * @param {boolean} [options.showControls=true]     - show default playback controls
 * @param {boolean} [options.showTimeline=true]     - show timeline slider
 *        (when both are enabled they render together in one box)
 * @param {string} [options.controlBarPosition='bottomleft'] - corner of the combined box
 * @param {boolean} [options.showLegend=true]       - show color legend
 * @param {boolean} [options.showViewFollow=true]   - show view follow control
 * @param {Function} [options.bearingTransform]     - fn(bearing) => newBearing
 * @param {Object} [options.trackLayerOptions]      - options for track layer
 * @param {Object} [options.pointClusterOptions]    - options for point cluster
 * @param {Object} [options.traveledStyle]          - style for traveled route
 * @param {Object} [options.untraveledStyle]        - style for untraveled route
 * @param {Object} [options.movingIcon]             - custom icon for moving indicator
 * @param {Object} [options.elementLabels]          - labels for the per-element layers
 *        ({ track, points, static, events, background_nodes, traveled,
 *        untraveled, indicator })
 * @param {Object} [options.backgroundNodesOptions]  - options for the
 *        "background_nodes" element (many standalone location points, drawn
 *        as clickable dots beneath the tracks; scatter by default):
 *        { style, cluster (default false), clusterOptions }
 * @param {boolean} [options.showClusterScatterControl=true] - the cluster /
 *        scatter settings panel (only added when the data has background
 *        nodes); its background-nodes section switches that element between
 *        clustered and raw scatter rendering at runtime
 * @param {string} [options.clusterScatterPosition='topright'] - control corner
 * @param {string} [options.clusterScatterTitle='Cluster / Scatter'] - panel title
 * @param {Object} [options.clusterScatterLabels] - { cluster, scatter } option
 *        labels (defaults 'Cluster' / 'Scatter'; the section header reuses
 *        elementLabels.background_nodes)
 * @param {boolean} [options.showElementToggles=true]     - batch show/hide control
 *        (one tri-state checkbox per element type, across all objects)
 * @param {string} [options.elementTogglesPosition='topright'] - control corner
 * @param {string} [options.elementTogglesTitle='Batch']  - toggles control title
 * @param {boolean} [options.showInfoLabels=true]   - batch label display control
 *        (rows = objects, columns = element types; batch-opens the layers'
 *        existing popups — the same popups a click shows)
 * @param {string} [options.infoLabelsPosition='topright'] - label control corner
 * @param {string} [options.infoLabelsTitle='Labels'] - label control title
 * @param {string} [options.dataDatum='wgs84'] - datum of the input coordinates
 *        ('wgs84' | 'gcj02'). Converted to `mapDatum` while parsing, so every
 *        layer works in the map's own frame (see GCJ-02 note in README)
 * @param {string} [options.mapDatum='wgs84']  - datum of the active basemap;
 *        use 'gcj02' for AMap/高德 (and other GCJ-02) tiles
 * @param {Object[]} [options.baseLayers]      - [{ label, layer }] basemaps for
 *        the layer tree's radio group (host owns the tile layers)
 * @param {string} [options.baseLayersLabel='Basemap'] - label of that group
 * @param {boolean} [options.showDataSource=false] - (session-level) show the
 *        data source panel: the current datasets (each with a remove button,
 *        plus clear-all) and the import channels (file picker, drag & drop
 *        onto the map, paste, URL, samples); it feeds the dataset API and
 *        survives every rebuild
 * @param {string} [options.dataSourcePosition='topleft'] - panel corner
 * @param {string} [options.dataSourceTitle='Data source'] - panel title
 * @param {boolean} [options.dataSourceExpanded=false] - start with the panel open
 * @param {Object} [options.dataSourceLabels]   - panel UI strings
 * @param {Object} [options.dataSourceMessages] - text builders
 *        ({ added, degraded, empty, error, rowMeta })
 * @param {Object[]} [options.dataSourceSamples] - [{ label, data }] samples
 * @returns {Object} internal handle
 */
function buildReplay(map, featureCollection, options, initialCluster) {
  options = options || {};

  // Background-nodes rendering mode, resolved BEFORE the layers are built: a
  // mode carried over from the previous build (dataset rebuild) wins over the
  // options default, and it decides the layer type the factory constructs
  // (MarkerClusterGroup vs plain FeatureGroup).
  var markerClusterAvailable = typeof L !== 'undefined' && !!L.markerClusterGroup;
  var backgroundCluster = markerClusterAvailable &&
    (initialCluster !== undefined
      ? initialCluster === true
      : !!(options.backgroundNodesOptions && options.backgroundNodesOptions.cluster === true));

  // ---- 1. Color Mapper ----
  var colorMapper = createColorMapper(options.colorMode || 'fixed', options.colorConfig, {
    range: options.colorRange,
  });

  // ---- 2. Parse Data ----
  // Datum: the input data is converted once, here, into the map's frame; every
  // downstream layer (track, points, events, routes, indicators) then works in
  // one consistent coordinate system.
  var parseOptions = {
    bearingTransform: options.bearingTransform,
    dataDatum: options.dataDatum,
    mapDatum: options.mapDatum,
  };
  var parsed = parseFeatureCollection(featureCollection, colorMapper, parseOptions);

  // If adaptive mode, initialize stats from all speeds
  if (options.colorMode === 'adaptive' && parsed.allSpeeds.length > 0) {
    colorMapper.initStats(parsed.allSpeeds);
    // Re-parse with initialized color mapper
    parsed = parseFeatureCollection(featureCollection, colorMapper, parseOptions);
  }

  // ---- 3. Time Engine ----
  var timeEngine = createTimeEngine({
    speed: options.speed || 1,
    loop: options.loop || false,
    tickLen: options.tickLen || 250,
    minTickMs: options.minTickMs,
    startTime: parsed.timeMin,
    endTime: parsed.timeMax,
  });

  // ---- 4. Build Layers ----
  // Each object (layerPath) owns several *element* layers — track lines, points,
  // traveled/untraveled route, moving indicator — so every element can be shown
  // or hidden independently from the layer tree.
  var layerGroups = {};  // key → parent FeatureGroup (logical container, not added to the map)
  var allLayers = {};    // key → { group, elements, ... }
  var staticLayers = []; // static context layers — sent to the back after build
  var backgroundEntries = []; // { objectKey, features } — for cluster/scatter re-render

  var elLabels = options.elementLabels || {};
  var elementLabel = {
    track: elLabels.track || 'Track',
    points: elLabels.points || 'Points',
    static: elLabels.static || 'Static',
    events: elLabels.events || 'Events',
    background_nodes: elLabels.background_nodes || 'Background nodes',
    traveled: elLabels.traveled || 'Traveled',
    untraveled: elLabels.untraveled || 'Untraveled',
    indicator: elLabels.indicator || 'Indicator',
  };

  for (var i = 0; i < parsed.layerFeatures.length; i++) {
    var entry = parsed.layerFeatures[i];
    var key = entry.layerPath.join('/');

    // Separate timestamp features from static features
    var tsFeatures = [];
    var staticFeatures = [];

    for (var j = 0; j < entry.features.length; j++) {
      var f = entry.features[j];
      if (f.properties && f.properties._segmentIndex !== undefined) {
        tsFeatures.push(f);
      } else if (!f._trackMeta) {
        staticFeatures.push(f);
      } else {
        // Has _trackMeta but no _segmentIndex — these are unsplit ts features
        tsFeatures.push(f);
      }
    }

    var group = L.featureGroup();
    var elements = [];

    // Create track layer for timestamp features
    var trackLayer = null;
    var pointLayer = null;

    if (tsFeatures.length > 0) {
      trackLayer = createTrackLayer(tsFeatures, options.trackLayerOptions);
      group.addLayer(trackLayer);
      elements.push({ key: 'track', label: elementLabel.track, layer: trackLayer });

      pointLayer = createPointClusterLayer(tsFeatures, options.pointClusterOptions);
      group.addLayer(pointLayer);
      elements.push({ key: 'points', label: elementLabel.points, layer: pointLayer });
    }

    // Group non-timestamped features into element layers.
    // `properties.element` names the group (e.g. "events"); features without
    // it land in the generic "static" element. The name "background_nodes" is
    // reserved: that bucket renders as a low-pane cluster point layer (see
    // BackgroundNodesLayer) instead of the plain GeoJSON path.
    var staticBuckets = {};
    var bucketOrder = [];

    for (var sbj = 0; sbj < staticFeatures.length; sbj++) {
      var sf = staticFeatures[sbj];
      var bucketName = (sf.properties && sf.properties.element) || 'static';
      if (!staticBuckets[bucketName]) {
        staticBuckets[bucketName] = [];
        bucketOrder.push(bucketName);
      }
      staticBuckets[bucketName].push(sf);
    }

    for (var sbi = 0; sbi < bucketOrder.length; sbi++) {
      var bucket = bucketOrder[sbi];
      var staticLayer;

      if (bucket === 'background_nodes') {
        // Background nodes (reserved element name): many standalone location
        // points, rendered through the scatter layer — clickable dots that
        // draw beneath the tracks, cluster bubbles in the marker pane.
        // The source features are remembered so the cluster/scatter control
        // can rebuild this element in place.
        backgroundEntries.push({ objectKey: key, features: staticBuckets[bucket] });
        staticLayer = createBackgroundNodesLayer(
          staticBuckets[bucket],
          L.extend({}, options.backgroundNodesOptions, { cluster: backgroundCluster }));
      } else {
        staticLayer = createStaticLayer(staticBuckets[bucket], options.staticLayerOptions);
      }

      group.addLayer(staticLayer);
      elements.push({
        key: bucket,
        label: elementLabel[bucket] || bucket,
        layer: staticLayer,
      });

      // Only the generic "static" bucket is context (zones, areas) and goes to
      // the back; named buckets like "events" are annotations drawn on top so
      // their rings stay visible and clickable over the tracks.
      // (background_nodes manages its own z-order through its pane.)
      if (bucket === 'static') {
        staticLayers.push(staticLayer);
      }
    }

    // layerVisibility: first explicitly set value among the layer's features
    // decides the initial visibility (default: visible)
    var visible = true;
    for (var fi = 0; fi < entry.features.length; fi++) {
      var fprops = entry.features[fi].properties;
      if (fprops && fprops.layerVisibility !== undefined) {
        visible = fprops.layerVisibility !== false;
        break;
      }
    }

    layerGroups[key] = group;
    allLayers[key] = {
      group: group,
      layerPath: entry.layerPath,
      elements: elements,
      trackLayer: trackLayer,
      pointLayer: pointLayer,
      timestampFeatures: tsFeatures,
      visible: visible,
    };

    if (visible) {
      for (var ei = 0; ei < elements.length; ei++) {
        map.addLayer(elements[ei].layer);
      }
    }
  }

  // Static context layers (zones, areas, …) render BELOW the tracks: otherwise
  // a polygon drawn on top would swallow clicks meant for the track segments
  // crossing it. Their own popups still work where no track is underneath.
  for (var sj = 0; sj < staticLayers.length; sj++) {
    staticLayers[sj].bringToBack();
  }

  // ---- 5. Moving Indicators ----
  var movingIndicators = [];

  for (var k = 0; k < parsed.indicatorFeatures.length; k++) {
    var srcFeat = parsed.indicatorFeatures[k];
    var indicatorName = (srcFeat.properties && srcFeat.properties.layerPath)
      ? srcFeat.properties.layerPath.join(' › ') + ' #' + k
      : 'indicator-' + k;

    var indicator = createMovingIndicator(srcFeat, {
      icon: options.movingIcon,
      bearingTransform: options.bearingTransform,
      rotationOffset: options.rotationOffset || 0,
    });

    indicator._name = indicatorName;
    indicator._sourceFeature = srcFeat;
    movingIndicators.push(indicator);

    // The indicator's element entry is registered together with its route
    // layers below, so the tree order reads: track → points → traveled →
    // untraveled → indicator

    // Keep the position fresh if the layer is toggled back on
    (function (ind) {
      ind.marker.on('add', function () { ind.update(timeEngine.getCurrentTime()); });
    })(indicator);
  }

  // ---- 6. Dynamic Routes ----
  var dynamicRoutes = [];

  for (var d = 0; d < parsed.indicatorFeatures.length; d++) {
    var srcF = parsed.indicatorFeatures[d];
    var route = createDynamicRoute(srcF, {
      traveledStyle: options.traveledStyle,
      untraveledStyle: options.untraveledStyle,
    });
    dynamicRoutes.push(route);

    var ownerPath = (srcF.properties && srcF.properties.layerPath) || ['default'];
    var owner = allLayers[ownerPath.join('/')];
    var ownerIndicator = movingIndicators[d]; // same order as parsed.indicatorFeatures

    if (owner) {
      owner.elements.push({ key: 'traveled', label: elementLabel.traveled, layer: route.traveled });
      owner.elements.push({ key: 'untraveled', label: elementLabel.untraveled, layer: route.untraveled });
      if (ownerIndicator) {
        owner.elements.push({ key: 'indicator', label: elementLabel.indicator, layer: ownerIndicator.marker });
      }
      if (owner.visible) {
        map.addLayer(route.traveled);
        map.addLayer(route.untraveled);
        if (ownerIndicator) { map.addLayer(ownerIndicator.marker); }
      }
    } else {
      route.traveled.addTo(map);
      route.untraveled.addTo(map);
      if (ownerIndicator) { ownerIndicator.marker.addTo(map); }
    }

    // Refresh the route when its layers are toggled back on
    (function (rt) {
      var refresh = function () { rt.update(timeEngine.getCurrentTime()); };
      rt.traveled.on('add', refresh);
      rt.untraveled.on('add', refresh);
    })(route);
  }

  // ---- 7. Layer Control ----
  // allLayers entries carry `.elements`, so every display element becomes its
  // own entry in the layer tree
  var layerControl = createLayerControl(map, parsed.layerFeatures, allLayers, {
    collapsed: options.layerControlCollapsed !== false,
    baseLayers: options.baseLayers,
    baseLayersLabel: options.baseLayersLabel,
  });
  map.addControl(layerControl);

  // ---- 7b. Batch element toggles ----
  // One tri-state checkbox per element type (track, points, traveled, …) that
  // switches that type on/off for EVERY object at once. Batch-on also covers
  // objects whose layerVisibility was false.
  var elementToggles = null;
  if (options.showElementToggles !== false) {
    var toggles = createElementToggles(allLayers, {
      position: options.elementTogglesPosition || 'topright',
      title: options.elementTogglesTitle || 'Batch',
    });
    if (toggles.hasRows) {
      elementToggles = toggles;
      map.addControl(elementToggles);
    }
  }

  // ---- 7c. Batch label display (rows = objects, columns = element types) ----
  // Checking a cell batch-opens that element's existing popups — the very same
  // popups a manual click shows.
  var infoLabels = null;
  if (options.showInfoLabels !== false) {
    var labelsControl = createInfoLabels(allLayers, {
      position: options.infoLabelsPosition || 'topright',
      title: options.infoLabelsTitle || 'Labels',
    });
    if (labelsControl.hasContent) {
      infoLabels = labelsControl;
      map.addControl(infoLabels);
    }
  }

  // ---- 7d. Cluster / scatter settings (background nodes) ----
  // The panel's background-nodes section switches between clustered and raw
  // scatter rendering. The mode is a construction-time property of the layer
  // (MarkerClusterGroup vs plain FeatureGroup), so switching rebuilds that
  // element in place and re-points every reference at the new layer.
  var clusterScatterControl = null;
  // (backgroundCluster / markerClusterAvailable are resolved at the top of
  // this function — the mode must be known before the layers are built.)

  /**
   * Recreate the layer control so its bookkeeping follows the rebuilt layers.
   *
   * Leaflet's layer-control base class (which Layers.Tree extends) keeps its
   * own registry keyed by the original layer objects — checkbox inputs store
   * `stamp(layer)` ids, and a zoomend handler resolves them back to layers.
   * Splitting that registry open to splice in a rebuilt layer is fragile
   * across versions (a stale id crashes `_checkDisabledLayers` on the next
   * zoom), so the control is simply rebuilt — it is constructed from
   * `allLayers`, which already points at the new layers.
   */
  function rebuildLayerControl() {
    if (layerControl && layerControl._map) {
      map.removeControl(layerControl);
    }
    layerControl = createLayerControl(map, parsed.layerFeatures, allLayers, {
      collapsed: options.layerControlCollapsed !== false,
      baseLayers: options.baseLayers,
      baseLayersLabel: options.baseLayersLabel,
    });
    map.addControl(layerControl);

    // A re-added control lands at the end of its corner; put the tree back on
    // top so the corner stack keeps its original order (tree, batch, labels…).
    var corner = map._controlCorners[layerControl.getPosition()];
    if (corner && layerControl.getContainer()) {
      corner.insertBefore(layerControl.getContainer(), corner.firstChild);
    }

    if (handle) {
      handle.layerControl = layerControl;
      // A cluster/scatter switch recreates the layer control WITHOUT a session
      // rebuild — let the session refresh its public `layerControl` field.
      if (handle._onLayerControlChange) { handle._onLayerControlChange(layerControl); }
    }
  }

  /**
   * Rebuild every background nodes element with the given rendering mode,
   * preserving whether each object's layer is currently shown on the map.
   * The rebuilt layers are added after their controls were re-pointed, so
   * checked batch-label cells re-open their popups via the layeradd hook.
   */
  function applyBackgroundMode(cluster) {
    if (cluster === backgroundCluster) { return; }
    backgroundCluster = cluster;

    for (var i = 0; i < backgroundEntries.length; i++) {
      var entry = backgroundEntries[i];
      var owner = allLayers[entry.objectKey];
      if (!owner) { continue; }
      var els = owner.elements;

      for (var j = 0; j < els.length; j++) {
        if (els[j].key !== 'background_nodes') { continue; }

        var oldLayer = els[j].layer;
        var wasOn = map.hasLayer(oldLayer);
        if (wasOn) { map.removeLayer(oldLayer); }

        var nextLayer = createBackgroundNodesLayer(entry.features,
          L.extend({}, options.backgroundNodesOptions, { cluster: cluster }));

        els[j].layer = nextLayer;
        if (elementToggles) { elementToggles.replaceLayer(oldLayer, nextLayer); }
        if (infoLabels) { infoLabels.replaceLayer(oldLayer, nextLayer); }

        if (wasOn) { map.addLayer(nextLayer); }
      }
    }

    rebuildLayerControl();
  }

  if (backgroundEntries.length && options.showClusterScatterControl !== false) {
    clusterScatterControl = createClusterScatterControl({
      position: options.clusterScatterPosition || 'topright',
      title: options.clusterScatterTitle || 'Cluster / Scatter',
      sectionLabel: elementLabel.background_nodes,
      clusterLabel: (options.clusterScatterLabels && options.clusterScatterLabels.cluster) || 'Cluster',
      scatterLabel: (options.clusterScatterLabels && options.clusterScatterLabels.scatter) || 'Scatter',
      clusterAvailable: markerClusterAvailable,
      value: backgroundCluster ? 'cluster' : 'scatter',
      onChange: function (mode) { applyBackgroundMode(mode === 'cluster'); },
    });
    map.addControl(clusterScatterControl);
  }

  // ---- 8. View Follow ----
  var viewFollow = null;
  if (options.showViewFollow !== false) {
    viewFollow = createViewFollowControl(map);
    map.addControl(viewFollow.control);

    // Register all moving indicators (with their track time range, so the
    // follow control can skip outside the subject's existence)
    for (var vi = 0; vi < movingIndicators.length; vi++) {
      var vMeta = movingIndicators[vi]._sourceFeature._trackMeta;
      var vRange = (vMeta && vMeta.times && vMeta.times.length)
        ? [vMeta.times[0], vMeta.times[vMeta.times.length - 1]]
        : null;
      viewFollow.registerIndicator(
        movingIndicators[vi]._name,
        movingIndicators[vi].marker,
        vRange
      );
    }
  }

  // ---- 9. Tick handler ----
  // Only visible elements are updated — hidden layers cost nothing per tick.
  function updateTimeElements(time) {
    for (var mi = 0; mi < movingIndicators.length; mi++) {
      if (map.hasLayer(movingIndicators[mi].marker)) {
        movingIndicators[mi].update(time);
      }
    }
    for (var ri = 0; ri < dynamicRoutes.length; ri++) {
      var rt = dynamicRoutes[ri];
      if (map.hasLayer(rt.traveled) || map.hasLayer(rt.untraveled)) {
        rt.update(time);
      }
    }
    if (viewFollow) {
      viewFollow.update(time);
    }
  }

  timeEngine.on('tick', function (data) {
    updateTimeElements(data.time);
  });

  // Handle stop: reset dynamic routes
  timeEngine.on('stop', function () {
    for (var ri = 0; ri < dynamicRoutes.length; ri++) {
      dynamicRoutes[ri].reset();
    }
    for (var mi = 0; mi < movingIndicators.length; mi++) {
      if (map.hasLayer(movingIndicators[mi].marker)) {
        movingIndicators[mi].update(parsed.timeMin);
      }
    }
  });

  // Handle timechange (seek): update all without animation
  timeEngine.on('timechange', function (data) {
    updateTimeElements(data.time);
  });

  // ---- 10. Controls ----
  var controls = null;
  var timeline = null;
  var controlBar = null;
  var legend = null;

  var showControls = options.showControls !== false;
  var showTimeline = options.showTimeline !== false;

  if (showControls && showTimeline) {
    // Both in a single box (video-player style)
    controlBar = createControlBar(timeEngine, {
      position: options.controlBarPosition || 'bottomleft',
      speedOptions: options.speedOptions,
      speedLabel: options.speedLabel,
      showLoop: options.showLoop,
    });
    map.addControl(controlBar);
  } else if (showControls) {
    controls = createPlaybackControls(timeEngine, {
      speedOptions: options.speedOptions,
      speedLabel: options.speedLabel,
      showLoop: options.showLoop,
    });
    map.addControl(controls);
  } else if (showTimeline) {
    timeline = createTimelineControl(timeEngine);
    map.addControl(timeline);
  }

  if (options.showLegend !== false) {
    legend = createColorLegend(colorMapper, {
      title: options.legendTitle || 'Speed (km/h)',
      steps: options.legendSteps,
    });
    map.addControl(legend);
  }

  // ---- Internal handle ----
  // Everything the session facade needs to read, drive, and tear down this
  // build. Public methods and the event forwarding live on the facade, so
  // this handle can be swapped wholesale on every dataset change.
  var handle = {
    timeEngine: timeEngine,
    colorMapper: colorMapper,
    layerGroups: layerGroups,
    allLayers: allLayers,
    movingIndicators: movingIndicators,
    dynamicRoutes: dynamicRoutes,
    viewFollow: viewFollow,
    layerControl: layerControl,
    elementToggles: elementToggles,
    infoLabels: infoLabels,
    clusterScatterControl: clusterScatterControl,
    controls: controls,
    timeline: timeline,
    controlBar: controlBar,
    legend: legend,
    parsed: parsed,

    /** Current background-nodes rendering mode (carried across rebuilds). */
    getClusterMode: function () { return backgroundCluster; },

    /** Tear this build down: layers, controls, listeners. */
    destroy: function () {
      timeEngine.destroy();

      // Remove dynamic routes
      for (var ri = 0; ri < dynamicRoutes.length; ri++) {
        dynamicRoutes[ri].remove();
      }

      // Remove moving indicators
      for (var mi = 0; mi < movingIndicators.length; mi++) {
        movingIndicators[mi].remove();
      }

      // Remove element layers (each element is added to the map individually)
      var keys = Object.keys(allLayers);
      for (var ki = 0; ki < keys.length; ki++) {
        var els = allLayers[keys[ki]].elements;
        for (var ei2 = 0; ei2 < els.length; ei2++) {
          if (map.hasLayer(els[ei2].layer)) {
            map.removeLayer(els[ei2].layer);
          }
        }
      }

      // Remove controls
      if (layerControl._map) {
        map.removeControl(layerControl);
      }
      if (controls && controls._map) {
        map.removeControl(controls);
      }
      if (timeline && timeline._map) {
        map.removeControl(timeline);
      }
      if (controlBar && controlBar._map) {
        map.removeControl(controlBar);
      }
      if (legend && legend._map) {
        map.removeControl(legend);
      }
      if (elementToggles && elementToggles._map) {
        map.removeControl(elementToggles);
      }
      if (infoLabels && infoLabels._map) {
        map.removeControl(infoLabels);
      }
      if (clusterScatterControl && clusterScatterControl._map) {
        map.removeControl(clusterScatterControl);
      }
      if (viewFollow) {
        if (viewFollow.control._map) {
          map.removeControl(viewFollow.control);
        }
        viewFollow.destroy();
      }

      // Remove event listeners
      timeEngine._listeners = {};
    },
  };

  return handle;
}

/**
 * Main entry — a TrackReplay session.
 *
 * Startup shapes (all return the same session object):
 *
 *   L.trackReplay(map, featureCollection, options)  // one fixed dataset
 *   L.trackReplay(map, [fc1, fc2, ...], options)    // several datasets
 *   L.trackReplay(map, null, options)               // empty; add later
 *
 * The session owns a dataset container (每 addDataset 一次 = 一个数据集，是
 * 增删的原子单位). `addDataset()` / `removeDataset()` / `clearDatasets()`
 * change the data at runtime: internally the replay is rebuilt from the merged
 * FeatureCollection and the session state is restored (playback time & run
 * state, speed, loop, per-element visibility, checked batch-label cells,
 * cluster/scatter mode, follow mode) — so this object's identity, its
 * listeners and the user's view all survive the rebuild.
 *
 * `on()`/`off()` are one stable bus: playback events (forwarded from the
 * per-build time engine) and dataset lifecycle events share it.
 *
 * Input coordinates must be WGS-84 (地球坐标系); building each dataset's
 * `datum` is not supported — convert before adding if your source is GCJ-02.
 *
 * @param {L.Map} map
 * @param {Object|Object[]} [dataOrArray] - a GeoJSON FeatureCollection, an
 *        array of them, or null/undefined for an empty session
 * @param {Object} [options] - see the options list on buildReplay()
 * @returns {Object} session — playback methods (play/pause/stop/seek/
 *          setSpeed/setLoop/seekByProgress/getCurrentTime/getProgress/
 *          getState/getLegend), dataset methods (addDataset/removeDataset/
 *          clearDatasets/listDatasets/getDataset), the container itself
 *          (`datasets`), `on`/`off`, `destroy`, and the live build fields
 *          (timeEngine, allLayers, infoLabels, … re-assigned on rebuild)
 */
export function trackReplay(map, dataOrArray, options) {
  options = options || {};

  // Startup shape: single FeatureCollection | array of them | empty.
  var initial = [];
  if (Array.isArray(dataOrArray)) { initial = dataOrArray; }
  else if (dataOrArray) { initial = [dataOrArray]; }

  var container = createDatasetContainer();
  var bus = createEventBus();
  var currentBuild = null;

  /** Re-point the instance's live build fields at the current build. */
  function syncFields() {
    var b = currentBuild;
    instance.timeEngine = b ? b.timeEngine : null;
    instance.colorMapper = b ? b.colorMapper : null;
    instance.layerGroups = b ? b.layerGroups : {};
    instance.allLayers = b ? b.allLayers : {};
    instance.movingIndicators = b ? b.movingIndicators : [];
    instance.dynamicRoutes = b ? b.dynamicRoutes : [];
    instance.viewFollow = b ? b.viewFollow : null;
    instance.layerControl = b ? b.layerControl : null;
    instance.elementToggles = b ? b.elementToggles : null;
    instance.infoLabels = b ? b.infoLabels : null;
    instance.clusterScatterControl = b ? b.clusterScatterControl : null;
    instance.controls = b ? b.controls : null;
    instance.timeline = b ? b.timeline : null;
    instance.controlBar = b ? b.controlBar : null;
    instance.legend = b ? b.legend : null;
    instance.parsed = b ? b.parsed : null;
  }

  /** Forward a build's playback events into the session bus. */
  function bindEngineEvents(build) {
    for (var i = 0; i < PLAYBACK_EVENTS.length; i++) {
      (function (evt) {
        build.timeEngine.on(evt, function (data) { bus.emit(evt, data); });
      })(PLAYBACK_EVENTS[i]);
    }
  }

  /** Capture the user-visible state of a build, to be re-applied after a rebuild. */
  function captureState(build) {
    var state = {
      time: build.timeEngine.getCurrentTime(),
      playing: build.timeEngine.getState() === 'playing',
      speed: build.timeEngine.getSpeed(),
      loop: build.timeEngine.getLoop(),
      cluster: build.getClusterMode(),
      elements: [],
      labels: [],
      follow: null,
    };

    var keys = Object.keys(build.allLayers);
    for (var i = 0; i < keys.length; i++) {
      var els = build.allLayers[keys[i]].elements;
      for (var j = 0; j < els.length; j++) {
        state.elements.push({
          objectKey: keys[i],
          elementKey: els[j].key,
          on: map.hasLayer(els[j].layer),
        });
      }
    }

    if (build.infoLabels) { state.labels = build.infoLabels.getCheckedCells(); }
    if (build.viewFollow) { state.follow = build.viewFollow.getMode(); }
    return state;
  }

  /** Re-apply a captured state onto a freshly built replay. */
  function applyState(build, state) {
    build.timeEngine.setSpeed(state.speed);
    build.timeEngine.setLoop(state.loop);

    // Per-element visibility — entries whose object/element no longer exists
    // (e.g. it was owned by the removed dataset) are skipped.
    for (var i = 0; i < state.elements.length; i++) {
      var s = state.elements[i];
      var owner = build.allLayers[s.objectKey];
      if (!owner) { continue; }
      for (var j = 0; j < owner.elements.length; j++) {
        var el = owner.elements[j];
        if (el.key !== s.elementKey) { continue; }
        var on = map.hasLayer(el.layer);
        if (s.on && !on) { map.addLayer(el.layer); }
        else if (!s.on && on) { map.removeLayer(el.layer); }
        break;
      }
    }

    // Re-checked batch-label cells: their popups reopen through the map's
    // layeradd hook as the new layers come onto the map.
    if (build.infoLabels && state.labels.length) {
      build.infoLabels.applyCheckedState(state.labels);
    }

    if (build.viewFollow && state.follow && state.follow.mode !== 'off') {
      build.viewFollow.setMode(state.follow.mode, state.follow.target);
    }

    // Time and run state last. seek() clamps into the new time range; playing
    // resumes from the restored position (if the position ended up at the new
    // end, play() restarts from the beginning — TimeEngine's usual behavior).
    build.timeEngine.seek(state.time);
    if (state.playing) { build.timeEngine.play(); }
  }

  /**
   * Rebuild from the container's merged data, restoring session state.
   * Called at startup and on every dataset change.
   */
  function rebuild() {
    var snap = null;
    if (currentBuild) {
      snap = captureState(currentBuild);
      currentBuild.destroy();
      currentBuild = null;
      syncFields();
    }

    if (container.isEmpty()) { return; }

    currentBuild = buildReplay(map, container.mergedFeatureCollection(), options,
      snap ? snap.cluster : undefined);
    currentBuild._onLayerControlChange = function (lc) { instance.layerControl = lc; };
    bindEngineEvents(currentBuild);
    if (snap) { applyState(currentBuild, snap); }
    syncFields();
  }

  var instance = {
    map: map,
    datasets: container,
    dataSourceControl: null,
    dataDatum: options.dataDatum || 'wgs84',
    mapDatum: options.mapDatum || 'wgs84',

    // Live build fields — kept current by syncFields() (null/empty before the
    // first build and after clearDatasets()).
    timeEngine: null,
    colorMapper: null,
    layerGroups: {},
    allLayers: {},
    movingIndicators: [],
    dynamicRoutes: [],
    viewFollow: null,
    layerControl: null,
    elementToggles: null,
    infoLabels: null,
    clusterScatterControl: null,
    controls: null,
    timeline: null,
    controlBar: null,
    legend: null,
    parsed: null,

    // ---- Playback (no-ops while the session has no data) ----

    /** Start playback */
    play: function () { if (currentBuild) { currentBuild.timeEngine.play(); } },

    /** Pause playback */
    pause: function () { if (currentBuild) { currentBuild.timeEngine.pause(); } },

    /** Stop playback (reset to start) */
    stop: function () { if (currentBuild) { currentBuild.timeEngine.stop(); } },

    /** Seek to a specific time (ms) */
    seek: function (timeMs) { if (currentBuild) { currentBuild.timeEngine.seek(timeMs); } },

    /** Set playback speed */
    setSpeed: function (speed) { if (currentBuild) { currentBuild.timeEngine.setSpeed(speed); } },

    /** Get playback speed */
    getSpeed: function () { return currentBuild ? currentBuild.timeEngine.getSpeed() : 1; },

    /** Enable/disable auto-restart (loop) */
    setLoop: function (loop) { if (currentBuild) { currentBuild.timeEngine.setLoop(loop); } },

    /** Get loop mode */
    getLoop: function () { return currentBuild ? currentBuild.timeEngine.getLoop() : false; },

    /** Seek to a progress fraction (0-1) */
    seekByProgress: function (progress) {
      if (currentBuild) { return currentBuild.timeEngine.seekByProgress(progress); }
    },

    /** Get current time (ms); null while the session has no data */
    getCurrentTime: function () { return currentBuild ? currentBuild.timeEngine.getCurrentTime() : null; },

    /** Get playback progress (0-1) */
    getProgress: function () { return currentBuild ? currentBuild.timeEngine.getProgress() : 0; },

    /** Get playback state */
    getState: function () { return currentBuild ? currentBuild.timeEngine.getState() : 'stopped'; },

    /** Get the color legend data */
    getLegend: function (steps) { return currentBuild ? currentBuild.colorMapper.getLegend(steps) : []; },

    // ---- Datasets (每次 add = 一个数据集；删除即精确移除这一份) ----

    /**
     * Add a dataset (one GeoJSON FeatureCollection, WGS-84). It merges with
     * the existing data by layerPath and shows up immediately; the session
     * state is preserved.
     * @param {Object} featureCollection
     * @param {Object} [opts] - { name } display name
     * @returns {number} the dataset id (pass it to removeDataset)
     */
    addDataset: function (featureCollection, opts) {
      var ds = container.add(featureCollection, opts);
      rebuild();
      bus.emit('datasetadd', {
        id: ds.id,
        name: ds.name,
        featureCount: ds.featureCount,
        total: container.count(),
      });
      return ds.id;
    },

    /**
     * Remove exactly one dataset (by the id returned from addDataset).
     * Objects that spanned several datasets survive with the remaining parts;
     * objects owned by this dataset disappear with it.
     * @param {number} id
     * @returns {boolean} true when a dataset was removed
     */
    removeDataset: function (id) {
      var removed = container.remove(id);
      if (!removed) { return false; }
      rebuild();
      bus.emit('datasetremove', {
        id: removed.id,
        name: removed.name,
        featureCount: removed.featureCount,
        total: container.count(),
      });
      return true;
    },

    /**
     * Remove every dataset (the session stays alive; add more later).
     * @returns {number} how many datasets were removed
     */
    clearDatasets: function () {
      var n = container.clear();
      if (n === 0) { return 0; }
      rebuild();
      bus.emit('datasetsclear', { removed: n });
      return n;
    },

    /** @returns {Array<{id, name, featureCount}>} the current datasets */
    listDatasets: function () { return container.list(); },

    /** @returns {{id, name, featureCollection}|null} one dataset's raw data */
    getDataset: function (id) { return container.get(id); },

    // ---- Events & lifecycle ----

    /** Register an event listener (playback + dataset events share one bus) */
    on: function (event, fn) { bus.on(event, fn); },

    /** Remove an event listener */
    off: function (event, fn) { bus.off(event, fn); },

    /** Destroy the session: all layers, controls, listeners and datasets */
    destroy: function () {
      if (currentBuild) {
        currentBuild.destroy();
        currentBuild = null;
      }
      if (instance.dataSourceControl && instance.dataSourceControl._map) {
        map.removeControl(instance.dataSourceControl);
      }
      instance.dataSourceControl = null;
      container.clear();
      syncFields();
      bus.clear();
    },
  };

  // ---- Initial datasets → first build ----
  for (var di = 0; di < initial.length; di++) {
    container.add(initial[di]);
  }
  rebuild();

  // ---- Session-level data source panel (survives every rebuild) ----
  // Created after the first build, so its dataset list reflects the initial
  // datasets right away; afterwards it stays in sync through the events.
  if (options.showDataSource) {
    instance.dataSourceControl = createDataSourceControl({
      position: options.dataSourcePosition || 'topleft',
      title: options.dataSourceTitle || 'Data source',
      expanded: !!options.dataSourceExpanded,
      labels: options.dataSourceLabels,
      messages: options.dataSourceMessages,
      samples: options.dataSourceSamples,
      listDatasets: function () { return container.list(); },
      removeDataset: function (id) { return instance.removeDataset(id); },
      clearDatasets: function () { return instance.clearDatasets(); },
      onData: function (fc, meta) {
        instance.addDataset(fc, { name: meta && meta.name });
      },
    });
    map.addControl(instance.dataSourceControl);

    // Keep the dataset list in sync with every dataset change — including
    // programmatic addDataset()/removeDataset() calls from host code.
    var refreshDataSource = function () { instance.dataSourceControl.refreshDatasets(); };
    bus.on('datasetadd', refreshDataSource);
    bus.on('datasetremove', refreshDataSource);
    bus.on('datasetsclear', refreshDataSource);
  }

  return instance;
}

// ---- Attach to Leaflet namespace ----

if (typeof L !== 'undefined') {
  // Main class
  L.TrackReplay = trackReplay;

  // Sub-modules exposed for advanced users who want to compose manually
  L.TrackReplay.Core = {
    DataParser: { parseFeatureCollection: parseFeatureCollection },
    ColorMapper: { createColorMapper: createColorMapper },
    TimeEngine: { createTimeEngine: createTimeEngine },
    LayerTreeBuilder: { createLayerControl: createLayerControl },
    DatasetContainer: { createDatasetContainer: createDatasetContainer },
  };

  L.TrackReplay.Layers = {
    TrackLayer: { createTrackLayer: createTrackLayer },
    PointClusterLayer: { createPointClusterLayer: createPointClusterLayer },
    MovingIndicator: { createMovingIndicator: createMovingIndicator },
    DynamicRoute: { createDynamicRoute: createDynamicRoute },
    StaticLayer: { createStaticLayer: createStaticLayer },
    BackgroundNodesLayer: { createBackgroundNodesLayer: createBackgroundNodesLayer },
  };

  L.TrackReplay.Controls = {
    PlaybackControls: { createPlaybackControls: createPlaybackControls },
    TimelineControl: { createTimelineControl: createTimelineControl },
    ControlBar: { createControlBar: createControlBar },
    ViewFollowControl: { createViewFollowControl: createViewFollowControl },
    ColorLegend: { createColorLegend: createColorLegend },
    ElementToggles: { createElementToggles: createElementToggles },
    InfoLabels: { createInfoLabels: createInfoLabels },
    ClusterScatterControl: { createClusterScatterControl: createClusterScatterControl },
    DataSourceControl: { createDataSourceControl: createDataSourceControl },
  };

  L.TrackReplay.Utils = {
    GCJ02: {
      wgs84ToGcj02: wgs84ToGcj02,
      gcj02ToWgs84: gcj02ToWgs84,
      outOfChina: outOfChina,
    },
    GPX: {
      parseGPX: parseGPX,
    },
  };

  // Factory function
  L.trackReplay = function (map, data, options) {
    return trackReplay(map, data, options);
  };
}

export default trackReplay;
