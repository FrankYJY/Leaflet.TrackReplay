/**
 * DataParser — parses the custom GeoJSON FeatureCollection format and
 * processes TimestampEdgeoJSON features into renderable segments.
 */

import { calculateSpeed } from '../utils/GeoUtils.js';
import { normalizeTimesToMs } from '../utils/TimeUtils.js';
import { wgs84ToGcj02, gcj02ToWgs84 } from '../utils/GCJ02.js';

/**
 * @typedef {Object} ParsedData
 * @property {Object} layerTree       - hierarchical layer structure
 * @property {number} timeMin         - earliest timestamp (ms)
 * @property {number} timeMax         - latest timestamp (ms)
 * @property {Object[]} layerFeatures - { layerPath, features: [...] }
 * @property {Object[]} indicatorFeatures - features with drawMovingIndicator
 * @property {number[]} allSpeeds     - flat array of all computed speeds
 */

/**
 * Parse a FeatureCollection into structured data.
 *
 * @param {Object} fc                 - GeoJSON FeatureCollection
 * @param {Object} colorMapper        - ColorMapper instance (for auto-color mode)
 * @param {Object} [options]
 * @param {Function} [options.bearingTransform] - optional bearing transform function
 * @param {string} [options.dataDatum='wgs84']  - datum of the input coordinates
 *        ('wgs84' | 'gcj02'); converted to `mapDatum` during parsing so every
 *        downstream layer works in the map's own frame
 * @param {string} [options.mapDatum='wgs84']   - datum of the active basemap
 *        (GCJ-02 tiles such as AMap/高德 place their content on the GCJ-02 grid)
 * @returns {ParsedData}
 */
export function parseFeatureCollection(fc, colorMapper, options) {
  options = options || {};

  if (!fc || fc.type !== 'FeatureCollection' || !fc.features) {
    throw new Error('DataParser: expected a GeoJSON FeatureCollection');
  }

  var coordTransform = makeCoordTransform(options.dataDatum, options.mapDatum);
  var parseOpts = { bearingTransform: options.bearingTransform, coordTransform: coordTransform };

  var features = fc.features;
  var layerMap = {};     // key: layerPath.join('/'), value: { path, features }
  var indicatorFeatures = [];
  var allSpeeds = [];
  var timeMin = Infinity;
  var timeMax = -Infinity;

  for (var i = 0; i < features.length; i++) {
    var feature = features[i];
    var props = feature.properties || {};

    // Determine layer path
    var layerPath = props.layerPath || ['default'];

    // Check if it's a TimestampEdgeoJSON feature
    if (props.isTimestampedgeojson) {
      var results = processTimestampFeature(feature, colorMapper, parseOpts);
      if (results) {
        for (var j = 0; j < results.length; j++) {
          var seg = results[j];
          addToLayerMap(layerMap, layerPath, seg);

          if (seg._trackMeta && seg._trackMeta._isSource) {
            // Only the source segment carries the whole track's meta, so
            // speeds / time range are collected exactly once per track
            // (collecting them per segment would repeat them N times).
            if (seg._trackMeta.speeds) {
              allSpeeds = allSpeeds.concat(seg._trackMeta.speeds);
            }
            if (seg._trackMeta.timeMin < timeMin) { timeMin = seg._trackMeta.timeMin; }
            if (seg._trackMeta.timeMax > timeMax) { timeMax = seg._trackMeta.timeMax; }

            // If this source feature has drawMovingIndicator, store reference
            if (seg._trackMeta.drawMovingIndicator) {
              indicatorFeatures.push(seg);
            }
          }
        }
      }
    } else {
      // Regular GeoJSON feature (events, zones, …) — add as-is, or on a copy
      // with converted geometry so the caller's input data is never mutated
      addToLayerMap(layerMap, layerPath, coordTransform
        ? convertFeatureGeometry(feature, coordTransform)
        : feature);
    }
  }

  // Normalize time range
  if (timeMin === Infinity) { timeMin = 0; }
  if (timeMax === -Infinity) { timeMax = 0; }

  // Build layer tree from flat map
  var layerTree = buildLayerTree(layerMap);

  return {
    layerTree: layerTree,
    timeMin: timeMin,
    timeMax: timeMax,
    layerFeatures: flattenLayerTree(layerTree),
    indicatorFeatures: indicatorFeatures,
    allSpeeds: allSpeeds,
  };
}

/**
 * Process a single TimestampEdgeoJSON feature.
 * Returns an array of segment-level GeoJSON Feature objects.
 *
 * @param {Object} feature   - the Feature with isTimestampedgeojson=true
 * @param {Object} colorMapper
 * @param {Object} options
 * @returns {Object[]|null}
 */
function processTimestampFeature(feature, colorMapper, options) {
  var geom = feature.geometry;
  var props = feature.properties || {};

  if (!geom || geom.type !== 'LineString') {
    // Only LineString is supported for TimestampEdgeoJSON
    return null;
  }

  var coords = options.coordTransform
    ? transformCoords(geom.coordinates, options.coordTransform)
    : geom.coordinates;
  var times = normalizeTimesToMs(props.times || []);

  if (times.length !== coords.length) {
    console.error('TimestampEdgeoJSON: times.length (' + times.length +
      ') !== coordinates.length (' + coords.length + ') for feature:', props);
    return null;
  }

  if (coords.length < 2) { return null; }

  var nSegments = coords.length - 1;
  var speeds = props.speeds ? props.speeds.slice() : null;
  var styles = props.styles ? props.styles.slice() : null;
  var popups = props.popups ? props.popups.slice() : null;
  // Per-point popups (length = coordinates.length) — shown when clicking a point
  var pointPopups = props.pointPopups ? props.pointPopups.slice() : null;
  if (pointPopups && pointPopups.length !== coords.length) {
    console.error('TimestampEdgeoJSON: pointPopups.length (' + pointPopups.length +
      ') !== coordinates.length (' + coords.length + ') for feature:', props);
    pointPopups = null;
  }
  // Feature-level `style` wins; a plain `color` property is treated as a
  // single-color base style for the whole track (design: "整条线一个颜色").
  var baseStyle = props.style || (props.color ? { color: props.color } : null);
  var drawMovingIndicator = !!props.drawMovingIndicator;

  // Speeds are always needed (per-segment speed meta + adaptive stats),
  // but computing them does NOT by itself require splitting the track.
  if (!speeds) {
    speeds = computeSpeeds(coords, times);
  }

  // Step 2: Determine styling (splitting is only needed for per-segment data)
  // Per-segment popups also require splitting so each segment carries its own.
  var needsSplit = !!(popups && popups.length);
  if (baseStyle && styles) {
    // Merge: baseStyle is the foundation, each styles[i] overrides
    needsSplit = true;
  } else if (styles) {
    // styles provided without a base style — split, and fill in speed colours
    // for the segments whose style does not specify one (so per-segment styles
    // may override just weight/opacity and still follow the colour mapping)
    for (var sc = 0; sc < nSegments; sc++) {
      if (!styles[sc]) { styles[sc] = {}; }
      if (styles[sc].color === undefined) {
        var merged = extend({}, styles[sc]);
        merged.color = colorMapper.getColor(speeds[sc]);
        styles[sc] = merged;
      }
    }
    needsSplit = true;
  } else if (!baseStyle) {
    // No styling at all → auto-compute colors from speeds + colorMapper
    styles = speeds.map(function (s) {
      return { color: colorMapper.getColor(s) };
    });
    needsSplit = true;
  }
  // else: baseStyle && !styles → single feature with the base style (unless
  // per-segment popups force a split)

  // Build segment features
  var result = [];

  // Always keep a copy of the source feature for indicator tracking
  // (only the first segment carries the _isSource flag)
  var sourceMeta = {
    _isSource: true,
    times: times,
    coords: coords,
    speeds: speeds,
    popups: popups,
    pointPopups: pointPopups,
    timeMin: times[0],
    timeMax: times[times.length - 1],
    drawMovingIndicator: drawMovingIndicator,
  };

  if (!needsSplit && baseStyle) {
    // Single feature — no split needed. Coordinates come from `coords` so a
    // datum conversion is carried over (and the caller's data stays untouched).
    var singleFeature = cloneFeature(feature);
    singleFeature.geometry.coordinates = coords.map(function (c) { return c.slice(); });
    singleFeature.properties = extend({}, props);
    singleFeature.properties.style = baseStyle;
    singleFeature._trackMeta = sourceMeta;
    // Remove the source marker from properties to keep it clean
    result.push(singleFeature);
    return result;
  }

  // Split into per-segment features (each segment = 2-point LineString)
  for (var i = 0; i < nSegments; i++) {
    var segFeature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [coords[i].slice(), coords[i + 1].slice()],
      },
      properties: extend({}, props),
    };

    // Remove arrays that belong to the whole track — we handle them per-segment
    delete segFeature.properties.times;
    delete segFeature.properties.speeds;
    delete segFeature.properties.styles;
    delete segFeature.properties.popups;
    delete segFeature.properties.pointPopups;
    delete segFeature.properties.drawMovingIndicator;
    delete segFeature.properties.isTimestampedgeojson;

    // Per-segment properties
    segFeature.properties._segmentIndex = i;
    segFeature.properties._timeStart = times[i];
    segFeature.properties._timeEnd = times[i + 1];
    segFeature.properties.speed = speeds[i];

    if (styles && styles[i]) {
      var mergedStyle = baseStyle ? extend({}, baseStyle, styles[i]) : extend({}, styles[i]);
      segFeature.properties.style = mergedStyle;
    } else if (baseStyle) {
      // Split forced by per-segment popups — keep the base style on every segment
      segFeature.properties.style = extend({}, baseStyle);
    }

    if (popups && popups[i]) {
      segFeature.properties.popup = popups[i];
    }

    // Attach track metadata only to the first segment
    if (i === 0) {
      segFeature._trackMeta = sourceMeta;
    } else {
      segFeature._trackMeta = {
        times: times,
        coords: coords,
        speeds: speeds,
        pointPopups: pointPopups,
        timeMin: times[0],
        timeMax: times[times.length - 1],
        drawMovingIndicator: false,
      };
    }

    result.push(segFeature);
  }

  return result;
}

/**
 * Compute speed for each segment between consecutive points.
 * @param {number[][]} coords - [[lng, lat], ...]
 * @param {number[]} times - ms timestamps
 * @returns {number[]} speeds in km/h
 */
function computeSpeeds(coords, times) {
  var speeds = [];
  for (var i = 0; i < coords.length - 1; i++) {
    var lng1 = coords[i][0], lat1 = coords[i][1];
    var lng2 = coords[i + 1][0], lat2 = coords[i + 1][1];
    speeds.push(calculateSpeed(lat1, lng1, lat2, lng2, times[i], times[i + 1]));
  }
  return speeds;
}

// ---- Layer map helpers ----

function addToLayerMap(layerMap, layerPath, feature) {
  var key = layerPath.join('/');
  if (!layerMap[key]) {
    layerMap[key] = { path: layerPath, features: [] };
  }
  layerMap[key].features.push(feature);
}

function buildLayerTree(layerMap) {
  var root = { children: {}, features: [], name: 'root' };

  var keys = Object.keys(layerMap);
  for (var i = 0; i < keys.length; i++) {
    var entry = layerMap[keys[i]];
    var path = entry.path;
    var node = root;

    for (var j = 0; j < path.length; j++) {
      var name = path[j];
      if (!node.children[name]) {
        node.children[name] = { children: {}, features: [], name: name };
      }
      node = node.children[name];
    }
    node.features = node.features.concat(entry.features);
  }

  return root;
}

function flattenLayerTree(node, prefix) {
  if (!prefix) { prefix = []; }
  var result = [];

  var childNames = Object.keys(node.children);
  for (var i = 0; i < childNames.length; i++) {
    var child = node.children[childNames[i]];
    var childPath = prefix.concat([child.name]);
    if (child.features.length > 0) {
      result.push({ layerPath: childPath, features: child.features });
    }
    var deeper = flattenLayerTree(child, childPath);
    for (var j = 0; j < deeper.length; j++) {
      result.push(deeper[j]);
    }
  }

  return result;
}

// ---- Datum conversion helpers ----

/**
 * Build a [lng, lat] → [lng, lat] transform for a datum pair, or null when the
 * datums match (the common case, and a no-op).
 */
function makeCoordTransform(fromDatum, toDatum) {
  var from = fromDatum || 'wgs84';
  var to = toDatum || 'wgs84';
  if (from === to) { return null; }
  if (from === 'wgs84' && to === 'gcj02') { return wgs84ToGcj02; }
  if (from === 'gcj02' && to === 'wgs84') { return gcj02ToWgs84; }
  console.error('DataParser: unsupported datum conversion "' + from + '" → "' + to + '"');
  return null;
}

/**
 * Recursively convert GeoJSON positions (Point/LineString/Polygon/… nesting).
 * Extra ordinates (altitude) are preserved.
 */
function transformCoords(coords, fn) {
  if (!coords || !coords.length) { return coords; }
  if (typeof coords[0] === 'number') {
    var p = fn(coords[0], coords[1]);
    return coords.length > 2 ? p.concat(coords.slice(2)) : p;
  }
  var out = [];
  for (var i = 0; i < coords.length; i++) {
    out.push(transformCoords(coords[i], fn));
  }
  return out;
}

/** Copy a feature with its geometry coordinates transformed. */
function convertFeatureGeometry(feature, fn) {
  var geom = feature.geometry;
  if (!geom || !geom.coordinates) { return feature; }
  var copy = {};
  for (var k in feature) {
    if (Object.prototype.hasOwnProperty.call(feature, k)) { copy[k] = feature[k]; }
  }
  copy.geometry = { type: geom.type, coordinates: transformCoords(geom.coordinates, fn) };
  return copy;
}

// ---- Generic helpers ----

function cloneFeature(f) {
  return {
    type: f.type,
    geometry: {
      type: f.geometry.type,
      coordinates: f.geometry.coordinates.map(function (c) {
        return Array.isArray(c) ? c.slice() : c;
      }),
    },
    properties: extend({}, f.properties),
  };
}

function extend(target) {
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (!src) { continue; }
    var keys = Object.keys(src);
    for (var j = 0; j < keys.length; j++) {
      target[keys[j]] = src[keys[j]];
    }
  }
  return target;
}
