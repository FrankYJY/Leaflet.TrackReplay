/**
 * DatasetPreview — bounded, human-readable previews of a dataset's raw GeoJSON.
 *
 * Two pure functions over a FeatureCollection (no Leaflet, no DOM), both built
 * so that no single JSON.stringify call can run away with an oversized input:
 *
 *   buildDatasetPreview()     — the truncated, pretty-printed text shown in the
 *                               data-source panel's preview modal, plus summary
 *                               statistics (bounded scan)
 *   serializeDatasetChunks()  — the compact per-feature chunks a full download
 *                               is assembled from (Blob parts — never one giant
 *                               joined string)
 *
 * The guard is the same in both: every feature is pre-checked with an
 * allocation-free size estimate (coordinate positions PLUS property-array
 * entries — a track's `times`/`speeds`/`popups` arrays are as large as its
 * coordinates, so counting only coordinates would let a real track feature
 * through). A feature that would blow the budget is sliced down to what fits
 * (preview) or aborts the serialization (download), and the preview text is
 * hard-capped as a last resort — so stringify only ever sees input of a known,
 * small magnitude, and a pathological dataset can never freeze the tab.
 */

/** Pretty-printed coordinate ≈ 26 chars, doubled for its indent + newlines. */
var PREVIEW_CHARS_PER_POSITION = 48;
/** Pretty-printed property-array entry (number/short string on its own line). */
var PREVIEW_CHARS_PER_ITEM = 32;
/** Compact "[lng,lat]," ≈ 24 chars, with slack for long decimals. */
var COMPACT_CHARS_PER_POSITION = 32;
/** Compact property-array entry. */
var COMPACT_CHARS_PER_ITEM = 16;
/** Per-feature fixed cost (geometry wrapper, braces, scalar properties). */
var FEATURE_OVERHEAD = 240;

/**
 * Build a truncated preview of a FeatureCollection.
 *
 * @param {Object} featureCollection - GeoJSON FeatureCollection
 * @param {Object} [options]
 * @param {number} [options.maxFeatures=50] - at most this many features
 * @param {number} [options.maxChars=20000] - character budget for `text`
 * @param {number} [options.summaryScan=5000] - features the summary may scan
 * @param {Function} [options.truncatedNote] - fn(info) => one line of text,
 *        inserted (in place of the omitted features) when anything was cut;
 *        info = { shownFeatures, totalFeatures, partial }
 * @returns {Object} { text, shownFeatures, totalFeatures, truncated, partial,
 *          summary }
 *          `shownFeatures` counts the features the text includes — the last
 *          one may be partial, and `partial` says how it was cut:
 *          null | {kind:'positions', shown, total, featureIndex}
 *               | {kind:'chars', featureIndex}
 */
export function buildDatasetPreview(featureCollection, options) {
  options = options || {};
  var maxFeatures = options.maxFeatures == null ? 50 : options.maxFeatures;
  var maxChars = options.maxChars == null ? 20000 : options.maxChars;
  var summaryScan = options.summaryScan == null ? 5000 : options.summaryScan;
  var truncatedNote = options.truncatedNote || defaultTruncatedNote;

  var features = (featureCollection && featureCollection.features) || [];
  var summary = summarize(features, summaryScan);

  // The document wrapper. The note line (when anything was cut) replaces the
  // omitted features, i.e. it sits INSIDE the array — where the missing
  // entries would have been — and is deliberately not valid JSON, so a copied
  // snippet can never be mistaken for the complete dataset.
  var head = '{\n  "type": "FeatureCollection",\n  "features": [';
  var tail = '\n  ]\n}';
  var noteReserve = 220; // room for the note + its indent

  var parts = [];
  var chars = head.length + tail.length + noteReserve;
  var shownFeatures = 0;
  var partial = null;

  for (var i = 0; i < features.length; i++) {
    if (shownFeatures >= maxFeatures) { break; }

    var remaining = maxChars - chars;
    if (remaining <= FEATURE_OVERHEAD) { break; }

    var prepared = prepareFeature(features[i], remaining);
    if (!prepared) { break; } // unserializable (cycle, BigInt, …)

    parts.push(prepared.serialized);
    chars += prepared.serialized.length + 6; // ",\n    " separator
    shownFeatures++;

    if (prepared.partial) {
      partial = prepared.partial;
      partial.featureIndex = i;
      break; // the partial feature used the whole remainder
    }
  }

  var truncated = shownFeatures < features.length || !!partial;
  var text = head + (parts.length ? '\n' + parts.join(',\n') : '');
  if (truncated) {
    text += '\n    ' + truncatedNote({
      shownFeatures: shownFeatures,
      totalFeatures: features.length,
      partial: partial,
    });
  }
  text += tail;

  return {
    text: text,
    shownFeatures: shownFeatures,
    totalFeatures: features.length,
    truncated: truncated,
    partial: partial,
    summary: summary,
  };
}

/**
 * Serialize a whole FeatureCollection into compact per-feature chunks, with a
 * character budget and a time budget. Both are checked between features, and
 * every feature is pre-checked so a single huge feature cannot slip through.
 *
 * The chunks are meant to be handed straight to `new Blob(chunks)` — joining
 * them into one string would double the peak memory for no benefit.
 *
 * @param {Object} featureCollection
 * @param {Object} [options]
 * @param {number} [options.maxChars=20000000] - abort above this many chars
 *        (0 or Infinity = no limit)
 * @param {number} [options.maxMs=3000] - abort after this long (0 or Infinity
 *        = no limit)
 * @returns {{chunks: string[], chars: number}|null} null when aborted
 */
export function serializeDatasetChunks(featureCollection, options) {
  options = options || {};
  var maxChars = options.maxChars == null ? 20000000 : options.maxChars;
  var maxMs = options.maxMs == null ? 3000 : options.maxMs;
  var limitChars = maxChars !== 0 && maxChars !== Infinity;
  var limitMs = maxMs !== 0 && maxMs !== Infinity;

  var features = (featureCollection && featureCollection.features) || [];
  var chunks = ['{"type":"FeatureCollection","features":['];
  var chars = chunks[0].length;
  var started = now();

  for (var i = 0; i < features.length; i++) {
    if (limitMs && now() - started > maxMs) { return abortChunks(chunks); }

    var est = estimateFeatureChars(features[i], COMPACT_CHARS_PER_POSITION, COMPACT_CHARS_PER_ITEM);
    if (limitChars && chars + est > maxChars) { return abortChunks(chunks); }

    var s;
    try {
      s = JSON.stringify(features[i]);
    } catch (err) {
      return abortChunks(chunks); // cycle, BigInt, or a throwing toJSON
    }
    if (s === undefined) { s = 'null'; }

    chunks.push((i ? ',' : '') + s);
    chars += s.length + 1;

    if (limitChars && chars > maxChars) { return abortChunks(chunks); }
  }

  chunks.push(']}');
  return { chunks: chunks, chars: chars + 2 };
}

// ---- Size estimation (no allocation: the guard every stringify sits behind) ----

/**
 * Rough character cost of serializing a feature: coordinate positions plus the
 * entries of its property arrays (a track's `times`/`speeds`/`styles`/`popups`
 * are parallel to its coordinates and just as big). Never builds a string —
 * this is what lets the callers refuse a feature BEFORE handing it to
 * JSON.stringify.
 *
 * @param {Object} feature
 * @param {number} charsPerPosition - 48 pretty / 32 compact
 * @param {number} charsPerItem - 32 pretty / 16 compact
 * @returns {number} estimated characters
 */
export function estimateFeatureChars(feature, charsPerPosition, charsPerItem) {
  var perPosition = charsPerPosition || COMPACT_CHARS_PER_POSITION;
  var perItem = charsPerItem || COMPACT_CHARS_PER_ITEM;
  return FEATURE_OVERHEAD +
    countFeaturePositions(feature) * perPosition +
    countPropertyItems(feature && feature.properties) * perItem;
}

/** Flat count of the entries in a feature's property arrays/objects. */
function countPropertyItems(props) {
  if (!props) { return 0; }
  var keys = Object.keys(props);
  var n = 0;
  for (var i = 0; i < keys.length; i++) {
    var v = props[keys[i]];
    if (isArray(v)) { n += v.length; }
    else if (v && typeof v === 'object') { n += Object.keys(v).length; }
  }
  return n;
}

/** Count the coordinate positions of a feature (all geometry types). */
function countFeaturePositions(feature) {
  var geom = feature && feature.geometry;
  if (!geom) { return 0; }
  if (geom.coordinates) { return countPositions(geom.coordinates); }
  if (geom.geometries) {
    var n = 0;
    for (var i = 0; i < geom.geometries.length; i++) {
      var child = geom.geometries[i];
      if (child && child.coordinates) { n += countPositions(child.coordinates); }
      else if (child && child.geometries) { n += countFeaturePositions({ geometry: child }); }
    }
    return n;
  }
  return 0;
}

/**
 * Count coordinate positions in a (nested) coordinates array, generically:
 * a "position" is an array whose first element is a number.
 */
function countPositions(node) {
  if (!isArray(node) || !node.length) { return 0; }
  if (typeof node[0] === 'number') { return 1; }
  var n = 0;
  for (var i = 0; i < node.length; i++) { n += countPositions(node[i]); }
  return n;
}

// ---- Preparing one feature (bounded, never mutates the source) ----

/**
 * Serialize one feature with at most `remaining` characters of output.
 *
 * Fast path: the estimate says it fits → stringify it as-is. Otherwise slice
 * it down to the positions that fit (parallel property arrays cut to the same
 * prefix), re-sizing once from the observed cost, and hard-cut as a last
 * resort — a feature whose *properties* alone exceed the budget still yields
 * bounded text instead of an empty preview.
 *
 * @returns {{serialized: string, partial: ?Object}|null}
 */
function prepareFeature(feature, remaining) {
  var budget = remaining - 6; // the caller's ",\n    " separator
  if (budget <= 0) { return null; }

  var estimate = estimateFeatureChars(feature, PREVIEW_CHARS_PER_POSITION, PREVIEW_CHARS_PER_ITEM);
  var direct = null;
  if (estimate <= remaining) {
    direct = stringifyFeature(feature, true);
    if (direct !== null && direct.length <= budget) {
      return { serialized: direct, partial: null };
    }
  }

  // How many positions fit: each one carries not only its own coordinates but
  // its share of the parallel arrays (times / speeds / popups — a track has
  // several entries per coordinate), so both costs belong to the position
  // budget. Cutting geometry without them would not shrink anything.
  var positions = countFeaturePositions(feature);
  var items = countPropertyItems(feature && feature.properties);
  var perPosition = PREVIEW_CHARS_PER_POSITION +
    (positions > 0 ? Math.ceil(items / positions) * PREVIEW_CHARS_PER_ITEM : 0);
  var target = positions > 0
    ? Math.floor((budget - FEATURE_OVERHEAD) / perPosition)
    : 0;
  var sliced = target > 0 && target < positions
    ? sliceFeaturePositions(feature, target)
    : null;
  var text = sliced ? stringifyFeature(sliced.feature, true) : null;

  // The estimate can undershoot (long popup strings, unusual payloads):
  // re-size once from the observed cost per position.
  if (text !== null && text.length > budget && sliced && sliced.shown > 1) {
    var observedPerPosition = text.length / sliced.shown;
    var refined = Math.max(1, Math.floor((budget - FEATURE_OVERHEAD) / observedPerPosition));
    if (refined < sliced.shown) {
      var retry = sliceFeaturePositions(feature, refined);
      var retryText = retry ? stringifyFeature(retry.feature, true) : null;
      if (retryText !== null) { sliced = retry; text = retryText; }
    }
  }

  if (text === null) {
    // Nothing sliceable. Fall back to the direct text — but only while the
    // estimate says that one stringify stays bounded; a feature whose payload
    // alone dwarfs the budget is skipped rather than risked.
    if (direct === null && estimate <= remaining * 20) {
      direct = stringifyFeature(feature, true);
    }
    text = direct;
  }
  if (text === null) { return null; }

  if (text.length > budget) {
    // Pathological tail (a huge non-coordinate payload): keep a bounded
    // prefix. It may cut mid-token — the truncation note is the disclaimer.
    text = text.slice(0, budget);
    return { serialized: text, partial: { kind: 'chars' } };
  }

  if (sliced) {
    return {
      serialized: text,
      partial: { kind: 'positions', shown: sliced.shown, total: sliced.total },
    };
  }
  return { serialized: text, partial: null };
}

/**
 * Shallow-copy a feature with its geometry cut down to at most `maxPositions`
 * coordinate positions, and its coordinate-parallel property arrays (times /
 * speeds / styles / popups / pointPopups — arrays as long as the coordinates)
 * cut to the same prefix. Everything else is shared by reference.
 *
 * @returns {{feature: Object, shown: number, total: number}|null} null when
 *          the feature has nothing to cut (it already fits)
 */
function sliceFeaturePositions(feature, maxPositions) {
  var geom = feature && feature.geometry;
  if (!geom) { return null; }

  var total = countFeaturePositions(feature);
  var state = { budget: maxPositions, used: 0 };
  var slicedGeom = sliceGeometry(geom, state);

  var props = feature.properties;
  var slicedProps = sliceParallelProperties(props, state.used, total);

  // Nothing was actually reduced (short geometry, no oversized arrays).
  if (state.used >= total && slicedProps === props) { return null; }

  var copy = {};
  for (var k in feature) {
    if (Object.prototype.hasOwnProperty.call(feature, k)) { copy[k] = feature[k]; }
  }
  copy.geometry = slicedGeom;
  copy.properties = slicedProps;
  return { feature: copy, shown: state.used, total: total };
}

/**
 * Cut the property arrays that run parallel to the coordinates to the same
 * prefix. A "parallel" array is one whose length does not exceed the
 * coordinate count (times = N, speeds/styles/popups = N-1, pointPopups = N);
 * short unrelated arrays are left alone.
 */
function sliceParallelProperties(props, shown, total) {
  if (!props) { return props; }
  var keys = Object.keys(props);
  var copy = null;
  for (var i = 0; i < keys.length; i++) {
    var v = props[keys[i]];
    if (isArray(v) && v.length > shown && v.length <= total) {
      if (!copy) {
        copy = {};
        for (var k in props) {
          if (Object.prototype.hasOwnProperty.call(props, k)) { copy[k] = props[k]; }
        }
      }
      copy[keys[i]] = v.slice(0, shown);
    }
  }
  return copy || props;
}

function sliceGeometry(geom, state) {
  if (geom.geometries) {
    var out = [];
    for (var i = 0; i < geom.geometries.length; i++) {
      out.push(sliceGeometry(geom.geometries[i], state));
    }
    return { type: 'GeometryCollection', geometries: out };
  }
  return { type: geom.type, coordinates: slicePositions(geom.coordinates, state) };
}

/**
 * Generic prefix slice of a coordinates tree: keep positions until the budget
 * runs out, then drop everything that follows.
 */
function slicePositions(node, state) {
  if (!isArray(node)) { return node; }
  if (typeof node[0] === 'number') {
    if (state.used >= state.budget) { return null; }
    state.used++;
    return node;
  }
  var out = [];
  for (var i = 0; i < node.length; i++) {
    var child = slicePositions(node[i], state);
    if (child === null) { break; }
    out.push(child);
  }
  return out;
}

// ---- Summary statistics (bounded scan) ----

/**
 * Collect summary statistics, scanning at most `summaryScan` features.
 * Scalar reads only — coordinates are never touched.
 */
function summarize(features, summaryScan) {
  var scanned = Math.min(features.length, summaryScan);
  var typeCounts = {};
  var seenKeys = {};
  var keyList = [];
  var timeMin = null;
  var timeMax = null;

  for (var i = 0; i < scanned; i++) {
    var feature = features[i] || {};
    var type = (feature.geometry && feature.geometry.type) || 'null';
    typeCounts[type] = (typeCounts[type] || 0) + 1;

    var props = feature.properties || {};
    var keys = Object.keys(props);
    for (var j = 0; j < keys.length; j++) {
      if (!Object.prototype.hasOwnProperty.call(seenKeys, keys[j])) {
        seenKeys[keys[j]] = true;
        keyList.push(keys[j]);
      }
    }

    var times = props.times;
    if (isArray(times) && times.length) {
      var first = times[0];
      var last = times[times.length - 1];
      if (timeMin === null || first < timeMin) { timeMin = first; }
      if (timeMax === null || last > timeMax) { timeMax = last; }
    }
  }

  return {
    totalFeatures: features.length,
    scannedFeatures: scanned,
    typeCounts: typeCounts,
    propertyKeys: keyList.slice(0, 6),
    moreKeys: Math.max(0, keyList.length - 6),
    timeRange: timeMin === null ? null : [timeMin, timeMax],
  };
}

// ---- Helpers ----

/** Pretty-print a feature and nest it one level under `"features": [`. */
function stringifyFeature(feature, indent) {
  var s;
  try {
    s = JSON.stringify(feature, null, 2);
  } catch (err) {
    return null;
  }
  if (s === undefined) { return null; }
  return indent ? s.replace(/^/gm, '    ') : s;
}

function defaultTruncatedNote(info) {
  if (info.partial && info.partial.kind === 'positions') {
    return '// … feature ' + (info.partial.featureIndex + 1) + ' cut to its first ' +
      info.partial.shown + ' of ' + info.partial.total + ' coordinates' +
      (info.shownFeatures < info.totalFeatures
        ? ' · showing the first ' + info.shownFeatures + ' of ' + info.totalFeatures + ' feature(s)'
        : '');
  }
  if (info.partial) {
    return '// … the last feature is cut off' +
      (info.shownFeatures < info.totalFeatures
        ? ' · showing the first ' + info.shownFeatures + ' of ' + info.totalFeatures + ' feature(s)'
        : '');
  }
  return '// … showing the first ' + info.shownFeatures + ' of ' + info.totalFeatures + ' feature(s)';
}

/** Free the accumulated chunks as soon as a limit is hit. */
function abortChunks(chunks) {
  chunks.length = 0;
  return null;
}

function now() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
}

function isArray(v) {
  return Object.prototype.toString.call(v) === '[object Array]';
}
