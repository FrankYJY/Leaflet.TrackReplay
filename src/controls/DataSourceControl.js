/**
 * DataSourceControl — import AND manage the session's data sources.
 *
 * Three parts in one panel:
 *
 *   1. **Datasets** — the current datasets (name + feature count), each with
 *      its own remove button, plus a two-click "clear everything". The list
 *      refreshes from the session's dataset events, so programmatic
 *      `addDataset()` / `removeDataset()` calls (console, host code) update
 *      it too.
 *   2. **Import** — five channels: dragged files (dropped onto the map), the
 *      file picker, pasted text (GeoJSON or GPX), a URL to fetch, and the
 *      configured sample datasets. GeoJSON may be a FeatureCollection, a
 *      single Feature or an array of either; features without a `layerPath`
 *      get `['imported', <name>]`. GPX is converted by Utils.GPX — segments
 *      with time become replayable TimestampEdgeoJSON, segments without time
 *      become static lines and are called out in the report.
 *   3. **Report** — one line per import attempt (added / degraded / empty /
 *      error); texts come from `messages` so they can be localized.
 *
 * The control is SESSION-scoped: the facade adds it next to `addDataset`, so
 * it survives every internal rebuild (expanded state included).
 */

import { parseGPX } from '../utils/GPX.js';
import { formatTimestamp } from '../utils/TimeUtils.js';
import { buildDatasetPreview, serializeDatasetChunks } from '../core/DatasetPreview.js';

var DEFAULT_LABELS = {
  pick: 'Choose file…',
  add: 'Add',
  load: 'Load',
  pastePlaceholder: 'Paste GeoJSON / GPX text…',
  urlPlaceholder: '…or a URL to a GeoJSON / GPX file',
  samplesLabel: 'Samples',
  dropHint: 'Drop the file to import',
  pastedName: 'Pasted data',
  datasetsLabel: 'Datasets',
  importLabel: 'Import',
  removeLabel: 'Remove',
  clearLabel: 'Clear',
  clearConfirmLabel: 'Confirm clear?',
  emptyLabel: '(no data)',
  previewHint: 'Click to preview the data',
  previewCopy: 'Copy shown',
  previewCopied: 'Copied',
  previewCopyFailed: 'Copy failed',
  previewDownload: 'Download .geojson',
  previewClose: 'Close (Esc)',
  formatHelp: 'Format & example',
  formatCopy: 'Copy JSON',
  formatCopyPython: 'Copy Python',
  formatPythonNote: 'run it yourself: what it prints is the GeoJSON you paste in — just change the data',
  formatFill: 'Fill the paste box',
};

/**
 * Limits for the dataset preview and the full export behind it.
 *
 * The caps are the guard against a pathological dataset freezing the tab:
 * nothing here ever stringifies more than a bounded slice, and the export
 * aborts (rather than keeps going) once a limit is exceeded. `0` or
 * `Infinity` disables a limit.
 */
var DEFAULT_PREVIEW = {
  maxFeatures: 50,        // features shown in the preview text
  maxChars: 20000,        // character budget for the preview text
  summaryScan: 5000,      // features the summary statistics may scan
  downloadMaxChars: 20000000,
  downloadMaxMs: 3000,
};

/** Refuse to even parse an imported text above this many characters. */
var DEFAULT_IMPORT_MAX_CHARS = 50000000;

/**
 * The four input shapes, as minimal runnable examples. Each is the smallest
 * thing of its kind that imports and works: a replayable track, an event
 * marker, background nodes and a static context polygon. They are rendered by
 * the format-help modal (one column per shape) and can be copied or filled
 * into the paste box — see `messages.formatShapes()`.
 */
var EXAMPLE_TRACK = {
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [[116.400, 39.900], [116.410, 39.905], [116.420, 39.910]],
  },
  properties: {
    layerPath: ['demo', 'track'],
    isTimestampedgeojson: true,
    times: [1783014039000, 1783014090000, 1783014190000],
  },
};

var EXAMPLE_EVENT = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [116.404, 39.904] },
  properties: {
    layerPath: ['visitor', 'Mark'],
    element: 'events',
    popup: '<b>U-turn</b><br>event marker',
    style: { color: '#e74c3c', radius: 12 },
  },
};

var EXAMPLE_NODES = {
  type: 'Feature',
  geometry: {
    type: 'MultiPoint',
    coordinates: [[116.401, 39.901], [116.407, 39.907]],
  },
  properties: {
    layerPath: ['background', 'pois'],
    element: 'background_nodes',
    popups: ['POI 1', 'POI 2'],
  },
};

var EXAMPLE_STATIC = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [116.390, 39.890], [116.420, 39.890], [116.420, 39.920],
      [116.390, 39.920], [116.390, 39.890],
    ]],
  },
  properties: {
    layerPath: ['zones', 'area'],
    popup: 'Study area',
    style: { color: '#888', weight: 1, fillOpacity: 0.05 },
  },
};

/**
 * All four shapes in one collection — the fifth column's example. Reusing the
 * shape examples verbatim makes the point self-evident: a mixed collection is
 * literally those features side by side, each routed by its own properties.
 */
var EXAMPLE_MIXED = {
  type: 'FeatureCollection',
  features: [EXAMPLE_TRACK, EXAMPLE_EVENT, EXAMPLE_NODES, EXAMPLE_STATIC],
};

/**
 * Pretty-print an example object — always valid JSON, by construction.
 *
 * Two-element numeric arrays (coordinate pairs, and pairs like a two-entry
 * `times`) are pulled back onto one line: plain stringify explodes every
 * position onto three lines, which buries the very structure the example
 * exists to show.
 *
 * @param {Object} obj
 * @returns {string}
 */
export function prettyExample(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/\[\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\]/g, '[$1, $2]');
}

// ---- the Python generators shown by the format-help modal ----
// One function per shape, each taking your raw data and returning feature
// dict(s) — self-contained (stdlib only), so a copied snippet runs anywhere.
// They are defined once here and composed into both a column's snippet and
// the full mixed script of the last column.

var PY_TRACKS = [
  'def tracks(sequences, layer_path, names=None):',
  '    """[(time, lng, lat), ...] per track -> one feature each."""',
  '    def km(a, b):                    # kilometres between two [lng, lat]',
  '        dp = math.radians(b[1] - a[1])',
  '        dl = math.radians(b[0] - a[0])',
  '        h = math.sin(dp / 2) ** 2 + math.cos(math.radians(a[1])) * math.cos(',
  '            math.radians(b[1])) * math.sin(dl / 2) ** 2',
  '        return 2 * 6371 * math.asin(math.sqrt(h))',
  '',
  '    def hms(ms):',
  '        return datetime.fromtimestamp(ms / 1000).strftime("%H:%M:%S")',
  '',
  '    out = []',
  '    for i, points in enumerate(sequences):',
  '        label = names[i] if names else layer_path[-1]',
  '        times = [int(t) for t, _, _ in points]',
  '        coords = [[lng, lat] for _, lng, lat in points]',
  '        speeds = [round(km(coords[j], coords[j + 1]) * 3.6e6 / (times[j + 1] - times[j]), 2)',
  '                  for j in range(len(points) - 1)]',
  '        out.append({',
  '            "type": "Feature",',
  '            "geometry": {"type": "LineString", "coordinates": coords},',
  '            "properties": {',
  '                "layerPath": list(layer_path),',
  '                "isTimestampedgeojson": True,',
  '                "times": times,',
  '                "speeds": speeds,        # omit it: the plugin computes it',
  '                "drawMovingIndicator": True,',
  '                "popups": [f"<b>{label}</b> · segment {j + 1}/{len(speeds)}<br>"',
  '                           f"{hms(times[j])} → {hms(times[j + 1])}<br>"',
  '                           f"{speeds[j]:.1f} km/h · "',
  '                           f"{km(coords[j], coords[j + 1]) * 1000:.0f} m"',
  '                           for j in range(len(speeds))],',
  '            },',
  '        })',
  '    return out',
].join('\n');

var PY_EVENTS = [
  'def events(points, layer_path, popups=None, style=None):',
  '    """[(lng, lat), ...] -> one feature each."""',
  '    return [{',
  '        "type": "Feature",',
  '        "geometry": {"type": "Point", "coordinates": [lng, lat]},',
  '        "properties": {',
  '            "layerPath": list(layer_path),',
  '            "element": "events",',
  '            "popup": popups[i] if popups else f"event {i + 1}",',
  '            "style": style or {"color": "#e74c3c", "radius": 10},',
  '        },',
  '    } for i, (lng, lat) in enumerate(points)]',
].join('\n');

var PY_NODES = [
  'def nodes(points, layer_path, popups=None, style=None):',
  '    """[(lng, lat), ...] -> one MultiPoint feature (call it per group)."""',
  '    props = {',
  '        "layerPath": list(layer_path),',
  '        "element": "background_nodes",',
  '        "popups": popups or [f"POI {i + 1}" for i in range(len(points))],',
  '    }',
  '    if style:',
  '        props["style"] = style',
  '    return [{',
  '        "type": "Feature",',
  '        "geometry": {"type": "MultiPoint",',
  '                     "coordinates": [[lng, lat] for lng, lat in points]},',
  '        "properties": props,',
  '    }]',
].join('\n');

var PY_AREAS = [
  'def areas(rings, layer_path, popups=None, style=None):',
  '    """[[(lng, lat), ...], ...] -> one Polygon each; rings are closed."""',
  '    out = []',
  '    for i, ring in enumerate(rings):',
  '        ring = list(ring)',
  '        if ring[0] != ring[-1]:',
  '            ring.append(ring[0])',
  '        props = {"layerPath": list(layer_path)}',
  '        if popups and popups[i]:',
  '            props["popup"] = popups[i]',
  '        if style:',
  '            props["style"] = style',
  '        out.append({"type": "Feature",',
  '                    "geometry": {"type": "Polygon", "coordinates": [ring]},',
  '                    "properties": props})',
  '    return out',
].join('\n');

/**
 * The imports + call + print wrapped around one shape's function. The stdout
 * reconfiguration is not decoration: a Windows console defaults to a legacy
 * code page, and printing non-ASCII JSON (any Chinese popup text) would crash
 * with UnicodeEncodeError instead of showing the result.
 */
function pySnippet(functions, imports, call, printExpr) {
  return [
    imports,
    'import sys',
    'if hasattr(sys.stdout, "reconfigure"):',
    '    sys.stdout.reconfigure(encoding="utf-8")   # print non-ASCII anywhere',
    '',
    functions, '', call, '',
    'print(json.dumps(' + (printExpr || 'features') + ', ensure_ascii=False, indent=2))',
  ].join('\n');
}

var PY_IMPORTS_BASIC = 'import json';
var PY_IMPORTS_TRACKS = ['import json, math', 'from datetime import datetime'].join('\n');

var DEFAULT_MESSAGES = {
  added: function (fc, meta) {
    return 'Added "' + meta.name + '": ' + fc.features.length + ' feature(s)' +
      (meta.report
        ? ' — ' + meta.report.segments + ' track segment(s), ' + meta.report.points + ' point(s)'
        : '');
  },
  degraded: function (report, name) {
    return '"' + name + '": ' + report.staticSegments +
      ' segment(s) have no timestamps — imported as static lines (no playback)';
  },
  empty: function (name) {
    return '"' + name + '": nothing importable found';
  },
  error: function (err, name) {
    return '"' + name + '" failed: ' + (err && err.message ? err.message : err);
  },
  rowMeta: function (d) {
    return d.featureCount + ' feature(s)';
  },

  // ---- dataset preview ----

  /** One-line summary above the preview text. `s` is built by _summaryData(). */
  previewSummary: function (s) {
    var out = s.features + ' feature(s)';
    if (s.types) { out += ' · ' + s.types; }
    if (s.keys) { out += ' · fields: ' + s.keys; }
    if (s.timeStart) { out += ' · ' + s.timeStart + ' → ' + s.timeEnd; }
    if (s.scanned < s.total) { out += ' · stats over the first ' + s.scanned; }
    return out;
  },
  previewTruncated: function (shown, total) {
    return 'showing the first ' + shown + ' of ' + total + ' feature(s)';
  },
  previewPositionsTruncated: function (shown, total) {
    return 'this feature is cut to its first ' + shown + ' of ' + total + ' coordinates';
  },
  previewCharsTruncated: function () {
    return 'the last feature alone exceeds the preview budget — only its beginning is shown';
  },
  previewTooLarge: function (maxChars, maxMs) {
    return 'dataset too large to export here (over ' + maxChars +
      ' characters / ' + maxMs + ' ms) — use the source file or a smaller subset';
  },
  previewMissing: function (name) {
    return '"' + name + '" is no longer available';
  },
  importTooLarge: function (chars, limit) {
    return 'input too large (' + chars + ' characters, limit ' + limit +
      ') — refused to avoid freezing the page';
  },

  // ---- format help (the rules behind the paste box) ----
  // The general contract, one rule per line; the control renders each line as
  // its own row. The per-shape rules live in formatShapes() below.
  formatHelp: function () {
    return [
      'Coordinates are read as WGS-84 (converted for you when the basemap uses another datum).',
      'Every feature needs properties.layerPath — its path in the layer tree (imports without one get ["imported", name]).',
      'A playable track: isTimestampedgeojson: true + times, where times.length === coordinates.length (LineString only).',
      'Per segment (length = coordinates.length - 1): speeds, styles, popups. Per point: pointPopups (= coordinates.length).',
      'Optional: style / color (base style), drawMovingIndicator: true, layerVisibility.',
      'Non-timestamped features group by properties.element (e.g. "events"; "background_nodes" is reserved); popup / style optional.',
    ].join('\n');
  },

  /**
   * The input shapes, one column each in the format-help modal. Each entry
   * carries ONLY its own rules (one per line), its own runnable JSON example,
   * and — kept separate — the Python that turns raw sequences into that JSON
   * via examples/convert.py.
   *
   * @returns {Array<{name: string, rules: string, example: string,
   *          python: string}>}
   */
  formatShapes: function () {
    return [
      {
        name: 'Timestamped track (replayable)',
        rules: [
          'isTimestampedgeojson: true + times, where times.length === coordinates.length (LineString only).',
          'Per segment (length = coordinates.length - 1): speeds (computed if omitted), styles, popups.',
          'Per point: pointPopups (= coordinates.length); a missing array just means no popup there.',
          'drawMovingIndicator: true adds the moving arrow; traveled / untraveled edges come with the track.',
        ].join('\n'),
        example: prettyExample(EXAMPLE_TRACK),
        python: pySnippet(PY_TRACKS, PY_IMPORTS_TRACKS, [
          'features = tracks(',
          '    [[(1783014039000, 116.400, 39.900),',
          '      (1783014090000, 116.410, 39.905),',
          '      (1783014190000, 116.420, 39.910)]],   # add more tracks here',
          '    layer_path=["demo", "track"])',
        ].join('\n')),
      },
      {
        name: 'Event marker',
        rules: [
          'properties.element names the bucket — "events" or any name you like.',
          'Points render as pixel-radius rings; style.radius / style.color override the default.',
          'Drawn above the tracks, so the rings stay clickable; popup opens on click.',
        ].join('\n'),
        example: prettyExample(EXAMPLE_EVENT),
        python: pySnippet(PY_EVENTS, PY_IMPORTS_BASIC, [
          'features = events([(116.404, 39.904), (116.412, 39.908)],',
          '                  layer_path=["visitor", "Mark"],',
          '                  popups=["<b>U-turn</b>", "<b>Stop</b>"])',
        ].join('\n')),
      },
      {
        name: 'Background nodes',
        rules: [
          '"background_nodes" is a reserved element name.',
          'Point or MultiPoint only; MultiPoint may carry popups[] / styles[] (length = coordinates).',
          'Scatter by default (backgroundNodesOptions.cluster groups them); drawn beneath the tracks.',
        ].join('\n'),
        example: prettyExample(EXAMPLE_NODES),
        python: pySnippet(PY_NODES, PY_IMPORTS_BASIC, [
          'features = nodes([(116.401, 39.901), (116.407, 39.907)],',
          '                 layer_path=["background", "pois"])',
        ].join('\n')),
      },
      {
        name: 'Static context',
        rules: [
          'No properties.element — this is the default bucket.',
          'Drawn beneath the tracks, so an area never swallows clicks meant for a track.',
          'Any geometry; popup / style optional.',
        ].join('\n'),
        example: prettyExample(EXAMPLE_STATIC),
        python: pySnippet(PY_AREAS, PY_IMPORTS_BASIC, [
          'features = areas([[(116.390, 39.890), (116.420, 39.890),',
          '                   (116.420, 39.920), (116.390, 39.920)]],',
          '                 layer_path=["zones", "area"], popups=["Study area"])',
        ].join('\n')),
      },
      {
        name: 'Mixed collection',
        rules: [
          'One FeatureCollection may hold any mix of the shapes above — each feature is routed by its own properties.',
          'Features sharing a layerPath merge into ONE object: it can own a track, its events and its nodes at once.',
          'Datasets merge the same way: importing again only adds to (or extends) objects with the same layerPath.',
        ].join('\n'),
        example: prettyExample(EXAMPLE_MIXED),
        python: pySnippet(
          [PY_TRACKS, PY_EVENTS, PY_NODES, PY_AREAS].join('\n\n'),
          PY_IMPORTS_TRACKS,
          [
            '# ---- your raw data ----',
            'point_seq = [(1783014039000, 116.400, 39.900),',
            '             (1783014090000, 116.410, 39.905),',
            '             (1783014190000, 116.420, 39.910)]',
            'event_pts = [(116.404, 39.904)]',
            'poi_pts = [(116.401, 39.901), (116.407, 39.907)]',
            'rings = [[(116.390, 39.890), (116.420, 39.890),',
            '          (116.420, 39.920), (116.390, 39.920)]]',
            '',
            'features = (tracks([point_seq], ["demo", "track"], names=["track"])',
            '            + events(event_pts, ["demo", "track"], popups=["<b>U-turn</b>"])',
            '            + nodes(poi_pts, ["background", "pois"])',
            '            + areas(rings, ["zones", "area"], popups=["Study area"]))',
          ].join('\n'),
          '{"type": "FeatureCollection", "features": features}'),
      },
    ];
  },
};

/**
 * One captioned code block (JSON example / Python generator) in a column.
 * `note` is the short why-line trailing the caption (Python blocks only).
 */
function appendCodeBlock(container, caption, className, text, note) {
  var cap = L.DomUtil.create('div', 'tr-ds-format-shape-caption', container);
  cap.textContent = caption;
  if (note) {
    var noteEl = L.DomUtil.create('span', 'tr-ds-format-caption-note', cap);
    noteEl.textContent = ' — ' + note;
  }
  var pre = L.DomUtil.create('pre', className, container);
  pre.textContent = text;
  return pre;
}

/** Render a '\n'-separated rules string as one row per non-empty line. */
function appendRuleLines(container, lines) {
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i]) { continue; }
    var line = L.DomUtil.create('div', 'tr-ds-format-line', container);
    line.textContent = lines[i];
  }
}

/** A safe download file name for a dataset name (no path/OS-hostile chars). */
function safeFileName(name) {
  var s = String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s.slice(0, 80) || 'dataset';
}

/** File name without directory and extension ("/" or "\" separated). */
function basename(name) {
  var s = String(name || '').replace(/\\/g, '/');
  s = s.substring(s.lastIndexOf('/') + 1);
  return s.replace(/\.[^.]+$/, '') || 'data';
}

/**
 * Normalize parsed JSON into a FeatureCollection (FeatureCollection | Feature
 * | array of either), assigning `layerPath` to features that lack one.
 */
function normalizeGeoJSON(data, name, layerPathFor) {
  var features;
  if (data && data.type === 'FeatureCollection') {
    features = data.features || [];
  } else if (data && data.type === 'Feature') {
    features = [data];
  } else if (Array.isArray(data)) {
    features = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i] && data[i].type === 'FeatureCollection') {
        features = features.concat(data[i].features || []);
      } else if (data[i] && data[i].type === 'Feature') {
        features.push(data[i]);
      }
    }
  } else {
    throw new Error('expected GeoJSON (FeatureCollection / Feature / array)');
  }

  var path = null;
  for (var j = 0; j < features.length; j++) {
    var f = features[j];
    if (!f) { continue; }
    f.properties = f.properties || {};
    if (f.properties.layerPath === undefined) {
      if (path === null) { path = layerPathFor(name); }
      f.properties.layerPath = path.slice();
    }
  }

  return { type: 'FeatureCollection', features: features };
}

/**
 * Create the data source control.
 *
 * @param {Object} options
 * @param {string} [options.position='topleft']
 * @param {string} [options.title='Data source']
 * @param {boolean} [options.expanded=false] - start with the body open
 * @param {Object} [options.labels]   - UI strings (see DEFAULT_LABELS)
 * @param {Object} [options.messages] - text builders:
 *        { added(fc, meta), degraded(report, name), empty(name), error(err, name),
 *          rowMeta(dataset), previewSummary(s), previewTruncated(shown, total),
 *          previewPositionsTruncated(shown, total), previewTooLarge(maxChars, maxMs),
 *          previewMissing(name), importTooLarge(chars, limit) }
 * @param {Object[]} [options.samples] - [{ label, data }]; `data` is a
 *        FeatureCollection (or a function returning one), or raw text
 * @param {Function} [options.layerPathFor] - fn(name) => layerPath for
 *        features that have none (default ['imported', name])
 * @param {Function} [options.listDatasets]   - fn() => [{id, name, featureCount}]
 *        — enables the datasets section
 * @param {Function} [options.removeDataset]  - fn(id) => bool
 * @param {Function} [options.clearDatasets]  - fn() => removed count
 * @param {Function} [options.getDataset] - fn(id) => {id, name, featureCollection}
 *        | null — enables the row preview (click a dataset row to open it).
 *        The returned features are the live ones: the preview only ever reads
 *        them (never writes), and cap-checks them before serializing.
 * @param {Object} [options.preview] - preview/export limits, see DEFAULT_PREVIEW
 *        ({maxFeatures, maxChars, summaryScan, downloadMaxChars, downloadMaxMs};
 *        0 or Infinity disables a limit)
 * @param {number} [options.importMaxChars] - refuse to parse an imported text
 *        above this many characters (default 5e7; 0/Infinity disables)
 * @param {Function} options.onData - fn(featureCollection, meta) — the host
 *        wires this to `replay.addDataset`
 * @returns {L.Control} with `refreshDatasets()`
 */
export function createDataSourceControl(options) {
  options = options || {};
  var labels = L.extend({}, DEFAULT_LABELS, options.labels || {});
  var messages = L.extend({}, DEFAULT_MESSAGES, options.messages || {});
  var layerPathFor = options.layerPathFor || function (name) { return ['imported', name]; };
  var previewOpts = L.extend({}, DEFAULT_PREVIEW, options.preview || {});
  var importMaxChars = options.importMaxChars == null
    ? DEFAULT_IMPORT_MAX_CHARS
    : options.importMaxChars;

  var DataSourceCtrl = L.Control.extend({
    options: {
      position: options.position || 'topleft',
    },

    onAdd: function (map) {
      var self = this;
      this._map = map;
      this._clearArmed = false;

      var container = L.DomUtil.create('div', 'leaflet-trackreplay-datasource');
      this._container = container;

      this._titleEl = L.DomUtil.create('div', 'tr-ds-title', container);
      this._titleEl.onclick = function () { self._toggle(); };

      var body = L.DomUtil.create('div', 'tr-ds-body', container);
      body.style.display = 'none';
      this._bodyEl = body;

      // ---- 1. datasets (management) ----
      if (options.listDatasets) {
        var dsSection = L.DomUtil.create('div', 'tr-ds-section tr-ds-datasets', body);

        var dsHead = L.DomUtil.create('div', 'tr-ds-section-head', dsSection);
        var dsHeadLabel = L.DomUtil.create('span', 'tr-ds-section-label', dsHead);
        dsHeadLabel.textContent = labels.datasetsLabel;

        var clearBtn = L.DomUtil.create('button', 'tr-ds-btn tr-ds-clear', dsHead);
        clearBtn.type = 'button';
        clearBtn.textContent = labels.clearLabel;
        this._clearBtn = clearBtn;
        this._clearTimer = null;
        clearBtn.onclick = function () { self._onClearClick(); };

        this._datasetsEl = L.DomUtil.create('div', 'tr-ds-dataset-list', dsSection);
      }

      // ---- 2. import (five channels) ----
      var importSection = L.DomUtil.create('div', 'tr-ds-section tr-ds-import', body);
      var importHead = L.DomUtil.create('div', 'tr-ds-section-head', importSection);
      var importLabel = L.DomUtil.create('span', 'tr-ds-section-label', importHead);
      importLabel.textContent = labels.importLabel || 'Import';

      // file picker
      var fileRow = L.DomUtil.create('div', 'tr-ds-row', importSection);
      var pickBtn = L.DomUtil.create('button', 'tr-ds-btn', fileRow);
      pickBtn.type = 'button';
      pickBtn.textContent = labels.pick;
      var fileInput = L.DomUtil.create('input', 'tr-ds-file', fileRow);
      fileInput.type = 'file';
      fileInput.accept = '.json,.geojson,.gpx,application/json,application/gpx+xml';
      fileInput.multiple = true;
      fileInput.style.display = 'none';
      pickBtn.onclick = function () { fileInput.click(); };
      fileInput.onchange = function () {
        for (var i = 0; i < fileInput.files.length; i++) { self._readFile(fileInput.files[i]); }
        fileInput.value = ''; // allow picking the same file again
      };

      // paste
      var pasteRow = L.DomUtil.create('div', 'tr-ds-row', importSection);
      var textarea = L.DomUtil.create('textarea', 'tr-ds-paste', pasteRow);
      textarea.rows = 3;
      textarea.placeholder = labels.pastePlaceholder;
      this._pasteEl = textarea;
      var addBtn = L.DomUtil.create('button', 'tr-ds-btn', pasteRow);
      addBtn.type = 'button';
      addBtn.textContent = labels.add;
      addBtn.onclick = function () {
        var text = textarea.value;
        if (!text || !text.trim()) { return; }
        textarea.value = '';
        self._ingestText(text, labels.pastedName);
      };

      // Format help — the rules behind the format plus the minimal example,
      // in the same modal the dataset preview uses. The paste box itself
      // stays clean (a placeholder can't hold a whole example).
      var formatLink = L.DomUtil.create('div', 'tr-ds-format-link', importSection);
      formatLink.textContent = labels.formatHelp;
      formatLink.tabIndex = 0;
      formatLink.onclick = function () { self._openFormatHelp(); };
      formatLink.onkeydown = function (e) {
        if (e.keyCode === 13 || e.keyCode === 32) {
          L.DomEvent.stop(e);
          self._openFormatHelp();
        }
      };

      // URL
      var urlRow = L.DomUtil.create('div', 'tr-ds-row', importSection);
      var urlInput = L.DomUtil.create('input', 'tr-ds-url', urlRow);
      urlInput.type = 'text';
      urlInput.placeholder = labels.urlPlaceholder;
      var loadBtn = L.DomUtil.create('button', 'tr-ds-btn', urlRow);
      loadBtn.type = 'button';
      loadBtn.textContent = labels.load;
      loadBtn.onclick = function () {
        var url = (urlInput.value || '').trim();
        if (!url) { return; }
        self._loadUrl(url);
      };

      // samples
      if (options.samples && options.samples.length) {
        var sampleRow = L.DomUtil.create('div', 'tr-ds-row tr-ds-samples', importSection);
        var sampleLabel = L.DomUtil.create('span', 'tr-ds-samples-label', sampleRow);
        sampleLabel.textContent = labels.samplesLabel + ':';
        for (var si = 0; si < options.samples.length; si++) {
          (function (sample) {
            var btn = L.DomUtil.create('button', 'tr-ds-btn tr-ds-sample', sampleRow);
            btn.type = 'button';
            btn.textContent = sample.label;
            btn.onclick = function () {
              var data = typeof sample.data === 'function' ? sample.data() : sample.data;
              if (typeof data === 'string') {
                self._ingestText(data, sample.label);
                return;
              }
              // A sample may return `{ featureCollection, name }` to control
              // the dataset name it is added under (e.g. numbered repeats).
              var name = sample.label;
              if (data && data.featureCollection) {
                name = data.name || name;
                data = data.featureCollection;
              }
              var fc;
              try {
                fc = normalizeGeoJSON(data, name, layerPathFor);
              } catch (err) {
                self._report('err', messages.error(err, name));
                return;
              }
              self._deliver(fc, { name: name });
            };
          })(options.samples[si]);
        }
      }

      // ---- 3. report ----
      this._reportEl = L.DomUtil.create('div', 'tr-ds-report', body);

      // ---- file drag & drop on the map ----
      var mapContainer = map.getContainer();
      this._overlay = L.DomUtil.create('div', 'tr-ds-dropoverlay', mapContainer);
      this._overlay.textContent = labels.dropHint;
      this._overlay.style.display = 'none';

      function hasFiles(e) {
        return !!(e.dataTransfer && Array.prototype.indexOf.call(
          e.dataTransfer.types || [], 'Files') >= 0);
      }

      this._onDragOver = function (e) {
        if (!hasFiles(e)) { return; }
        L.DomEvent.preventDefault(e); // required to allow the drop
        self._overlay.style.display = '';
      };
      this._onDragLeave = function (e) {
        if (e.relatedTarget && mapContainer.contains(e.relatedTarget)) { return; }
        self._overlay.style.display = 'none';
      };
      this._onDrop = function (e) {
        if (!hasFiles(e)) { return; }
        L.DomEvent.preventDefault(e);
        self._overlay.style.display = 'none';
        var files = e.dataTransfer.files;
        for (var i = 0; i < files.length; i++) { self._readFile(files[i]); }
      };

      L.DomEvent.on(mapContainer, 'dragover', this._onDragOver);
      L.DomEvent.on(mapContainer, 'dragleave', this._onDragLeave);
      L.DomEvent.on(mapContainer, 'drop', this._onDrop);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      this.refreshDatasets();
      if (options.expanded) { this._toggle(); }

      return container;
    },

    onRemove: function (map) {
      this._closeModal();
      var mapContainer = map.getContainer();
      L.DomEvent.off(mapContainer, 'dragover', this._onDragOver);
      L.DomEvent.off(mapContainer, 'dragleave', this._onDragLeave);
      L.DomEvent.off(mapContainer, 'drop', this._onDrop);
      if (this._overlay && this._overlay.parentNode) {
        this._overlay.parentNode.removeChild(this._overlay);
      }
      if (this._clearTimer) { clearTimeout(this._clearTimer); }
    },

    // ---- internals ----

    _toggle: function () {
      var show = this._bodyEl.style.display === 'none';
      this._bodyEl.style.display = show ? '' : 'none';
      if (this._container) {
        if (show) { L.DomUtil.addClass(this._container, 'tr-ds-expanded'); }
        else { L.DomUtil.removeClass(this._container, 'tr-ds-expanded'); }
      }
    },

    /** Rebuild the dataset rows (and the title count) from the session. */
    refreshDatasets: function () {
      if (!this._datasetsEl) { return; }
      var self = this;
      var list = options.listDatasets ? options.listDatasets() : [];

      while (this._datasetsEl.firstChild) {
        this._datasetsEl.removeChild(this._datasetsEl.firstChild);
      }

      if (!list.length) {
        var empty = L.DomUtil.create('div', 'tr-ds-empty', this._datasetsEl);
        empty.textContent = labels.emptyLabel;
      } else {
        for (var i = 0; i < list.length; i++) {
          (function (d) {
            var row = L.DomUtil.create('div', 'tr-ds-dataset-row', self._datasetsEl);

            // Clicking the row previews the dataset — when the host wired
            // `getDataset`. Keyboard-reachable (Enter/Space) like everything
            // else in the plugin's focus-scoped keyboard model.
            if (options.getDataset) {
              L.DomUtil.addClass(row, 'tr-ds-row-clickable');
              row.tabIndex = 0;
              row.title = labels.previewHint;
              row.onclick = function () { self._openPreview(d.id, d.name); };
              row.onkeydown = function (e) {
                if (e.target !== row) { return; } // the Remove button keeps its own keys
                if (e.keyCode === 13 || e.keyCode === 32) {
                  L.DomEvent.stop(e); // Space must not scroll the page
                  self._openPreview(d.id, d.name);
                }
              };
            }

            var name = L.DomUtil.create('span', 'tr-ds-dataset-name', row);
            name.textContent = d.name;
            name.title = d.name;
            var meta = L.DomUtil.create('span', 'tr-ds-dataset-meta', row);
            meta.textContent = messages.rowMeta(d);
            var rm = L.DomUtil.create('button', 'tr-ds-btn tr-ds-remove', row);
            rm.type = 'button';
            rm.textContent = labels.removeLabel;
            rm.onclick = function (e) {
              // Keep the click on the button: removing must not also preview.
              L.DomEvent.stopPropagation(e);
              if (options.removeDataset) { options.removeDataset(d.id); }
            };
          })(list[i]);
        }
      }

      // An open preview belongs to a dataset that may just have been removed
      // (or cleared) — every dataset event funnels through here, so this is
      // the one place that has to notice.
      if (this._previewId != null) {
        var stillThere = false;
        for (var p = 0; p < list.length; p++) {
          if (list[p].id === this._previewId) { stillThere = true; break; }
        }
        if (!stillThere) { this._closeModal(); }
      }

      var base = options.title || 'Data source';
      this._titleEl.textContent = list.length ? base + ' (' + list.length + ')' : base;
    },

    /** Two-click "clear": first click arms (text changes), second confirms. */
    _onClearClick: function () {
      var self = this;
      if (!options.clearDatasets) { return; }
      if (!this._clearArmed) {
        this._clearArmed = true;
        this._clearBtn.textContent = labels.clearConfirmLabel;
        L.DomUtil.addClass(this._clearBtn, 'tr-ds-armed');
        this._clearTimer = setTimeout(function () { self._disarmClear(); }, 3000);
        return;
      }
      this._disarmClear();
      options.clearDatasets();
    },

    _disarmClear: function () {
      if (this._clearTimer) { clearTimeout(this._clearTimer); this._clearTimer = null; }
      if (!this._clearArmed) { return; }
      this._clearArmed = false;
      if (this._clearBtn) {
        this._clearBtn.textContent = labels.clearLabel;
        L.DomUtil.removeClass(this._clearBtn, 'tr-ds-armed');
      }
    },

    // ---- modals (dataset preview + format help share one shell) ----

    /**
     * Build the modal shell: a full-size layer inside the map container (it
     * swallows mouse/wheel/touch before they reach Leaflet, so the map behind
     * is inert), a panel with a title + ✕, a backdrop click and a
     * focus-scoped Esc to close. Returns the panel for the caller's content.
     */
    _openModalShell: function (title, closeTitle, wide) {
      var self = this;
      if (this._modalOverlay) { this._closeModal(); }

      var overlay = L.DomUtil.create('div', 'tr-ds-preview-overlay', this._map.getContainer());
      overlay.setAttribute('tabindex', '-1');
      L.DomEvent.disableClickPropagation(overlay);
      L.DomEvent.disableScrollPropagation(overlay);
      L.DomEvent.on(overlay, 'click', function (e) {
        if (e.target === overlay) { self._closeModal(); } // click the backdrop
      });
      // Focus-scoped Esc — the plugin has no global key handlers. The overlay
      // takes focus on open; keys pressed inside it never reach the map.
      L.DomEvent.on(overlay, 'keydown', function (e) {
        if (e.keyCode === 27) { self._closeModal(); }
        L.DomEvent.stopPropagation(e);
      });

      var panel = L.DomUtil.create('div',
        wide ? 'tr-ds-preview-panel tr-ds-modal-wide' : 'tr-ds-preview-panel', overlay);
      var head = L.DomUtil.create('div', 'tr-ds-preview-head', panel);
      var titleEl = L.DomUtil.create('span', 'tr-ds-preview-title', head);
      titleEl.textContent = title;
      titleEl.title = title;
      var closeBtn = L.DomUtil.create('button', 'tr-ds-btn tr-ds-preview-close', head);
      closeBtn.type = 'button';
      closeBtn.textContent = '✕';
      closeBtn.title = closeTitle;
      closeBtn.setAttribute('aria-label', closeTitle);
      closeBtn.onclick = function () { self._closeModal(); };

      this._modalOverlay = overlay;
      overlay.focus();
      return { overlay: overlay, panel: panel };
    },

    /** Close whatever modal is open and release its DOM + timers. */
    _closeModal: function () {
      if (this._previewStatusTimer) {
        clearTimeout(this._previewStatusTimer);
        this._previewStatusTimer = null;
      }
      if (this._modalOverlay && this._modalOverlay.parentNode) {
        this._modalOverlay.parentNode.removeChild(this._modalOverlay);
      }
      this._modalOverlay = null;
      this._previewBody = null;
      this._previewStatus = null;
      this._previewId = null;
      this._previewName = null;
    },

    /**
     * Open the preview modal for one dataset. The data comes from
     * `options.getDataset` and is rendered through core/DatasetPreview.js,
     * which caps every stringify — the features are only ever read.
     */
    _openPreview: function (id, name) {
      var self = this;
      if (!options.getDataset) { return; }

      var record = null;
      try { record = options.getDataset(id); } catch (err) { record = null; }
      if (!record || !record.featureCollection) {
        this._report('warn', messages.previewMissing(name == null ? String(id) : name));
        return;
      }

      var preview;
      try {
        preview = buildDatasetPreview(record.featureCollection, {
          maxFeatures: previewOpts.maxFeatures,
          maxChars: previewOpts.maxChars,
          summaryScan: previewOpts.summaryScan,
          truncatedNote: function (info) { return self._previewNote(info); },
        });
      } catch (err) {
        this._report('err', messages.error(err, name));
        return;
      }

      var title = name == null ? String(id) : name;
      var panel = this._openModalShell(title, labels.previewClose).panel;

      var summaryEl = L.DomUtil.create('div', 'tr-ds-preview-summary', panel);
      summaryEl.textContent = messages.previewSummary(this._summaryData(preview.summary));

      var body = L.DomUtil.create('pre', 'tr-ds-preview-body', panel);
      body.textContent = preview.text;

      var foot = L.DomUtil.create('div', 'tr-ds-preview-foot', panel);
      var copyBtn = L.DomUtil.create('button', 'tr-ds-btn tr-ds-preview-copy', foot);
      copyBtn.type = 'button';
      copyBtn.textContent = labels.previewCopy;
      copyBtn.onclick = function () { self._copyPreview(); };
      var dlBtn = L.DomUtil.create('button', 'tr-ds-btn tr-ds-preview-download', foot);
      dlBtn.type = 'button';
      dlBtn.textContent = labels.previewDownload;
      dlBtn.onclick = function () { self._downloadPreview(); };
      var status = L.DomUtil.create('span', 'tr-ds-preview-status', foot);

      this._previewBody = body;
      this._previewStatus = status;
      this._previewId = id;
      this._previewName = title;
    },

    /**
     * Open the format-help modal: the general rules on top (one line each,
     * from messages.formatHelp), then one column per input shape below — each
     * column carries only its own rules and its own runnable example, with
     * Copy / Fill buttons acting on that example. Filling never imports by
     * itself: it puts the text in the paste box, ready to edit.
     */
    _openFormatHelp: function () {
      var self = this;
      var shell = this._openModalShell(labels.formatHelp, labels.previewClose, true);

      var rulesEl = L.DomUtil.create('div', 'tr-ds-format-lines', shell.panel);
      appendRuleLines(rulesEl, String(messages.formatHelp() || '').split('\n'));

      var shapesEl = L.DomUtil.create('div', 'tr-ds-format-shapes', shell.panel);
      var shapes = messages.formatShapes() || [];

      for (var i = 0; i < shapes.length; i++) {
        (function (shape) {
          var example = shape.example || '';
          var col = L.DomUtil.create('div', 'tr-ds-format-shape', shapesEl);
          var nameEl = L.DomUtil.create('div', 'tr-ds-format-shape-name', col);
          nameEl.textContent = shape.name || '';

          var colRules = L.DomUtil.create('div', 'tr-ds-format-shape-rules', col);
          appendRuleLines(colRules, String(shape.rules || '').split('\n'));

          // The data and the code that produces it are deliberately separate
          // blocks: the JSON is what you paste in, the Python is how you make
          // it from your own raw sequences (examples/convert.py).
          appendCodeBlock(col, 'JSON', 'tr-ds-format-shape-example', example);
          var python = shape.python || '';
          if (python) {
            appendCodeBlock(col, 'Python', 'tr-ds-format-shape-python', python,
              labels.formatPythonNote);
          }

          var foot = L.DomUtil.create('div', 'tr-ds-format-shape-foot', col);
          var copyBtn = L.DomUtil.create('button', 'tr-ds-btn tr-ds-format-copy', foot);
          copyBtn.type = 'button';
          copyBtn.textContent = labels.formatCopy;
          copyBtn.onclick = function () {
            var label = copyBtn.textContent;
            self._copyText(example, function (okFlag) {
              self._flashButton(copyBtn, label,
                okFlag ? labels.previewCopied : labels.previewCopyFailed);
            });
          };
          if (python) {
            var pyBtn = L.DomUtil.create('button', 'tr-ds-btn tr-ds-format-copy-python', foot);
            pyBtn.type = 'button';
            pyBtn.textContent = labels.formatCopyPython;
            pyBtn.onclick = function () {
              var label = pyBtn.textContent;
              self._copyText(python, function (okFlag) {
                self._flashButton(pyBtn, label,
                  okFlag ? labels.previewCopied : labels.previewCopyFailed);
              });
            };
          }
          var fillBtn = L.DomUtil.create('button', 'tr-ds-btn tr-ds-format-fill', foot);
          fillBtn.type = 'button';
          fillBtn.textContent = labels.formatFill;
          fillBtn.onclick = function () { self._fillPasteBox(example); };
        })(shapes[i]);
      }
    },

    /** Put an example into the paste box, ready to edit, and focus it. */
    _fillPasteBox: function (text) {
      if (!this._pasteEl || !text) { return; }
      this._closeModal();
      this._pasteEl.value = text;
      this._pasteEl.focus();
    },

    /**
     * The truncation line placed inside the preview text (see DatasetPreview).
     * `info.partial` says how the last included feature was cut, if at all:
     * null | {kind:'positions', shown, total} | {kind:'chars'}.
     */
    _previewNote: function (info) {
      var parts = [];
      if (info.partial && info.partial.kind === 'positions') {
        parts.push(messages.previewPositionsTruncated(info.partial.shown, info.partial.total));
      } else if (info.partial) {
        parts.push(messages.previewCharsTruncated());
      }
      if (info.shownFeatures < info.totalFeatures) {
        parts.push(messages.previewTruncated(info.shownFeatures, info.totalFeatures));
      }
      return '// ' + parts.join(' · ');
    },

    /** Shape the summary statistics for messages.previewSummary(). */
    _summaryData: function (summary) {
      var typeNames = Object.keys(summary.typeCounts);
      var typeBits = [];
      var shownTypes = Math.min(typeNames.length, 4);
      for (var i = 0; i < shownTypes; i++) {
        typeBits.push(typeNames[i] + '×' + summary.typeCounts[typeNames[i]]);
      }
      if (typeNames.length > shownTypes) { typeBits.push('+' + (typeNames.length - shownTypes)); }

      var keys = summary.propertyKeys.join(', ');
      if (summary.moreKeys) { keys += ' (+' + summary.moreKeys + ')'; }

      var timeStart = null;
      var timeEnd = null;
      if (summary.timeRange) {
        timeStart = formatTimestamp(summary.timeRange[0], 'full');
        timeEnd = formatTimestamp(summary.timeRange[1], 'full');
      }

      return {
        features: summary.totalFeatures,
        types: typeBits.join(', '),
        keys: keys,
        timeStart: timeStart,
        timeEnd: timeEnd,
        scanned: summary.scannedFeatures,
        total: summary.totalFeatures,
      };
    },

    /** Copy exactly what the preview shows (bounded by construction). */
    _copyPreview: function () {
      var self = this;
      this._copyText(this._previewBody ? this._previewBody.textContent : '', function (okFlag) {
        self._flashStatus(self._previewStatus,
          okFlag ? labels.previewCopied : labels.previewCopyFailed);
      });
    },

    /**
     * Copy `text` and report the outcome through `onDone(okFlag)`. Clipboard
     * API first (localhost is a secure context), selected-textarea fallback.
     */
    _copyText: function (text, onDone) {
      var self = this;
      if (!text) { return; }
      var done = function (okFlag) { if (onDone) { onDone(okFlag); } };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(function () { done(true); }, function () { self._copyFallback(text, done); });
      } else {
        this._copyFallback(text, done);
      }
    },

    _copyFallback: function (text, done) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (err) { copied = false; }
      document.body.removeChild(ta);
      done(copied);
    },

    /**
     * Download the COMPLETE dataset as .geojson. The only place that
     * serializes everything — so it goes through the chunked serializer,
     * whose character + time budgets abort (and report) rather than freeze
     * the tab. The chunks feed `new Blob` directly: no giant joined string.
     */
    _downloadPreview: function () {
      var record = null;
      try {
        record = options.getDataset ? options.getDataset(this._previewId) : null;
      } catch (err) { record = null; }
      if (!record) {
        this._report('warn', messages.previewMissing(this._previewName || ''));
        return;
      }

      var result = null;
      try {
        result = serializeDatasetChunks(record.featureCollection, {
          maxChars: previewOpts.downloadMaxChars,
          maxMs: previewOpts.downloadMaxMs,
        });
      } catch (err) { result = null; }

      if (!result) {
        var tooLarge = messages.previewTooLarge(
          previewOpts.downloadMaxChars, previewOpts.downloadMaxMs);
        this._flashStatus(this._previewStatus, tooLarge);
        this._report('warn', tooLarge);
        return;
      }

      try {
        var blob = new Blob(result.chunks, { type: 'application/geo+json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = safeFileName(this._previewName) + '.geojson';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      } catch (err) {
        this._report('err', messages.error(err, this._previewName));
      }
    },

    /** Show a short-lived note in a status element. */
    _flashStatus: function (el, text) {
      var self = this;
      if (!el) { return; }
      el.textContent = text;
      if (this._previewStatusTimer) { clearTimeout(this._previewStatusTimer); }
      this._previewStatusTimer = setTimeout(function () {
        el.textContent = '';
        self._previewStatusTimer = null;
      }, 2500);
    },

    /** Swap a button's label for a moment (the per-column copy feedback). */
    _flashButton: function (btn, original, text) {
      var self = this;
      if (!btn) { return; }
      btn.textContent = text;
      if (this._previewStatusTimer) { clearTimeout(this._previewStatusTimer); }
      this._previewStatusTimer = setTimeout(function () {
        btn.textContent = original;
        self._previewStatusTimer = null;
      }, 1500);
    },

    /** Append one report line (kind: 'ok' | 'warn' | 'err'), keeping the last 8. */
    _report: function (kind, text) {
      if (!this._reportEl) { return; }
      var line = L.DomUtil.create('div', 'tr-ds-line tr-ds-' + kind, this._reportEl);
      line.textContent = text;
      var lines = this._reportEl.children;
      while (lines.length > 8) { this._reportEl.removeChild(lines[0]); }
      this._reportEl.scrollTop = this._reportEl.scrollHeight;
    },

    _readFile: function (file) {
      var self = this;
      var name = file.name || 'file';
      var reader = new FileReader();
      reader.onload = function () { self._ingestText(String(reader.result), name); };
      reader.onerror = function () {
        self._report('err', messages.error(new Error('could not read the file'), name));
      };
      reader.readAsText(file);
    },

    _loadUrl: function (url) {
      var self = this;
      var name = basename(url);
      var req = typeof fetch === 'function'
        ? fetch(url)
        : Promise.reject(new Error('fetch is not available'));
      req
        .then(function (res) {
          if (!res.ok) { throw new Error('HTTP ' + res.status); }
          return res.text();
        })
        .then(function (text) { self._ingestText(text, name); })
        .catch(function (err) { self._report('err', messages.error(err, name)); });
    },

    /** Detect GPX vs GeoJSON (by extension or leading '<') and deliver. */
    _ingestText: function (text, name) {
      var trimmed = (text || '').replace(/^﻿/, '').trim();
      if (!trimmed) { return; }

      // Same guard as the preview/export, applied at the door: parsing a
      // text this large would very likely freeze (or OOM) the tab.
      if (importMaxChars && trimmed.length > importMaxChars) {
        this._report('warn', messages.importTooLarge(trimmed.length, importMaxChars));
        return;
      }

      if (/\.gpx$/i.test(name) || trimmed.charAt(0) === '<') {
        var res;
        try {
          res = parseGPX(trimmed, { layerPath: layerPathFor(basename(name)) });
        } catch (err) {
          this._report('err', messages.error(err, name));
          return;
        }
        if (!res.featureCollection.features.length) {
          this._report('warn', messages.empty(name));
          return;
        }
        this._deliver(res.featureCollection, { name: name, report: res.report });
        if (res.report.staticSegments) {
          this._report('warn', messages.degraded(res.report, name));
        }
        return;
      }

      var data;
      try {
        data = JSON.parse(trimmed);
      } catch (err) {
        this._report('err', messages.error(new Error('not valid JSON or GPX'), name));
        return;
      }

      var fc;
      try {
        fc = normalizeGeoJSON(data, basename(name), layerPathFor);
      } catch (err) {
        this._report('err', messages.error(err, name));
        return;
      }
      this._deliver(fc, { name: name });
    },

    /** Hand a validated FeatureCollection to the host's onData callback. */
    _deliver: function (fc, meta) {
      if (!fc) { return; }
      if (!fc.features.length) { this._report('warn', messages.empty(meta.name)); return; }
      try {
        if (options.onData) { options.onData(fc, meta); }
        this._report('ok', messages.added(fc, meta));
      } catch (err) {
        this._report('err', messages.error(err, meta.name));
      }
    },
  });

  return new DataSourceCtrl();
}
