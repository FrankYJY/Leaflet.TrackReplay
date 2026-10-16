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
};

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
};

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
 *          rowMeta(dataset) }
 * @param {Object[]} [options.samples] - [{ label, data }]; `data` is a
 *        FeatureCollection (or a function returning one), or raw text
 * @param {Function} [options.layerPathFor] - fn(name) => layerPath for
 *        features that have none (default ['imported', name])
 * @param {Function} [options.listDatasets]   - fn() => [{id, name, featureCount}]
 *        — enables the datasets section
 * @param {Function} [options.removeDataset]  - fn(id) => bool
 * @param {Function} [options.clearDatasets]  - fn() => removed count
 * @param {Function} options.onData - fn(featureCollection, meta) — the host
 *        wires this to `replay.addDataset`
 * @returns {L.Control} with `refreshDatasets()`
 */
export function createDataSourceControl(options) {
  options = options || {};
  var labels = L.extend({}, DEFAULT_LABELS, options.labels || {});
  var messages = L.extend({}, DEFAULT_MESSAGES, options.messages || {});
  var layerPathFor = options.layerPathFor || function (name) { return ['imported', name]; };

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
      var addBtn = L.DomUtil.create('button', 'tr-ds-btn', pasteRow);
      addBtn.type = 'button';
      addBtn.textContent = labels.add;
      addBtn.onclick = function () {
        var text = textarea.value;
        if (!text || !text.trim()) { return; }
        textarea.value = '';
        self._ingestText(text, labels.pastedName);
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
              var fc;
              try {
                fc = normalizeGeoJSON(data, sample.label, layerPathFor);
              } catch (err) {
                self._report('err', messages.error(err, sample.label));
                return;
              }
              self._deliver(fc, { name: sample.label });
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
            var name = L.DomUtil.create('span', 'tr-ds-dataset-name', row);
            name.textContent = d.name;
            name.title = d.name;
            var meta = L.DomUtil.create('span', 'tr-ds-dataset-meta', row);
            meta.textContent = messages.rowMeta(d);
            var rm = L.DomUtil.create('button', 'tr-ds-btn tr-ds-remove', row);
            rm.type = 'button';
            rm.textContent = labels.removeLabel;
            rm.onclick = function () {
              if (options.removeDataset) { options.removeDataset(d.id); }
            };
          })(list[i]);
        }
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
