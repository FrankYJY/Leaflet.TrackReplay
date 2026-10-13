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

import { createTrackLayer } from './layers/TrackLayer.js';
import { createPointClusterLayer } from './layers/PointClusterLayer.js';
import { createMovingIndicator } from './layers/MovingIndicator.js';
import { createDynamicRoute } from './layers/DynamicRoute.js';
import { createStaticLayer } from './layers/StaticLayer.js';

import { createPlaybackControls } from './controls/PlaybackControls.js';
import { createTimelineControl } from './controls/TimelineControl.js';
import { createControlBar } from './controls/ControlBar.js';
import { createViewFollowControl } from './controls/ViewFollowControl.js';
import { createColorLegend } from './controls/ColorLegend.js';
import { createElementToggles } from './controls/ElementToggles.js';
import { createInfoLabels } from './controls/InfoLabels.js';

/**
 * Main TrackReplay orchestrator.
 *
 * @param {L.Map} map              - Leaflet map instance
 * @param {Object} featureCollection - GeoJSON FeatureCollection with TimestampEdgeoJSON features
 * @param {Object} [options]
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
 *        ({ track, points, static, events, traveled, untraveled, indicator })
 * @param {boolean} [options.showElementToggles=true]     - batch show/hide control
 *        (one tri-state checkbox per element type, across all objects)
 * @param {string} [options.elementTogglesPosition='topright'] - control corner
 * @param {string} [options.elementTogglesTitle='Batch']  - toggles control title
 * @param {boolean} [options.showInfoLabels=true]   - batch label display control
 *        (rows = objects, columns = element types; batch-opens the layers'
 *        existing popups — the same popups a click shows)
 * @param {string} [options.infoLabelsPosition='topright'] - label control corner
 * @param {string} [options.infoLabelsTitle='Labels'] - label control title
 * @returns {L.TrackReplay}
 */
export function trackReplay(map, featureCollection, options) {
  options = options || {};

  // ---- 1. Color Mapper ----
  var colorMapper = createColorMapper(options.colorMode || 'fixed', options.colorConfig, {
    range: options.colorRange,
  });

  // ---- 2. Parse Data ----
  var parsed = parseFeatureCollection(featureCollection, colorMapper, {
    bearingTransform: options.bearingTransform,
  });

  // If adaptive mode, initialize stats from all speeds
  if (options.colorMode === 'adaptive' && parsed.allSpeeds.length > 0) {
    colorMapper.initStats(parsed.allSpeeds);
    // Re-parse with initialized color mapper
    parsed = parseFeatureCollection(featureCollection, colorMapper, {
      bearingTransform: options.bearingTransform,
    });
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

  var elLabels = options.elementLabels || {};
  var elementLabel = {
    track: elLabels.track || 'Track',
    points: elLabels.points || 'Points',
    static: elLabels.static || 'Static',
    events: elLabels.events || 'Events',
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
    // it land in the generic "static" element.
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
      var staticLayer = createStaticLayer(staticBuckets[bucket], options.staticLayerOptions);
      group.addLayer(staticLayer);
      elements.push({
        key: bucket,
        label: elementLabel[bucket] || bucket,
        layer: staticLayer,
      });

      // Only the generic "static" bucket is context (zones, areas) and goes to
      // the back; named buckets like "events" are annotations drawn on top so
      // their rings stay visible and clickable over the tracks.
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

  // ---- Public API ----
  var instance = {
    map: map,
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
    controls: controls,
    timeline: timeline,
    controlBar: controlBar,
    legend: legend,
    parsed: parsed,

    /** Start playback */
    play: function () { timeEngine.play(); },

    /** Pause playback */
    pause: function () { timeEngine.pause(); },

    /** Stop playback (reset to start) */
    stop: function () { timeEngine.stop(); },

    /** Seek to a specific time (ms) */
    seek: function (timeMs) { timeEngine.seek(timeMs); },

    /** Set playback speed */
    setSpeed: function (speed) { timeEngine.setSpeed(speed); },

    /** Get playback speed */
    getSpeed: function () { return timeEngine.getSpeed(); },

    /** Enable/disable auto-restart (loop) */
    setLoop: function (loop) { timeEngine.setLoop(loop); },

    /** Get loop mode */
    getLoop: function () { return timeEngine.getLoop(); },

    /** Seek to a progress fraction (0-1) */
    seekByProgress: function (progress) { return timeEngine.seekByProgress(progress); },

    /** Get current time (ms) */
    getCurrentTime: function () { return timeEngine.getCurrentTime(); },

    /** Get playback progress (0-1) */
    getProgress: function () { return timeEngine.getProgress(); },

    /** Get playback state */
    getState: function () { return timeEngine.getState(); },

    /** Get the color legend data */
    getLegend: function (steps) { return colorMapper.getLegend(steps); },

    /** Register an event listener */
    on: function (event, fn) { timeEngine.on(event, fn); },

    /** Remove an event listener */
    off: function (event, fn) { timeEngine.off(event, fn); },

    /** Destroy the instance, removing all layers and controls */
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
  };

  L.TrackReplay.Layers = {
    TrackLayer: { createTrackLayer: createTrackLayer },
    PointClusterLayer: { createPointClusterLayer: createPointClusterLayer },
    MovingIndicator: { createMovingIndicator: createMovingIndicator },
    DynamicRoute: { createDynamicRoute: createDynamicRoute },
    StaticLayer: { createStaticLayer: createStaticLayer },
  };

  L.TrackReplay.Controls = {
    PlaybackControls: { createPlaybackControls: createPlaybackControls },
    TimelineControl: { createTimelineControl: createTimelineControl },
    ControlBar: { createControlBar: createControlBar },
    ViewFollowControl: { createViewFollowControl: createViewFollowControl },
    ColorLegend: { createColorLegend: createColorLegend },
    ElementToggles: { createElementToggles: createElementToggles },
    InfoLabels: { createInfoLabels: createInfoLabels },
  };

  // Factory function
  L.trackReplay = function (map, data, options) {
    return trackReplay(map, data, options);
  };
}

export default trackReplay;
