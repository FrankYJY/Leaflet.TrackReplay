/**
 * InfoLabels — batch label display control.
 *
 * A table with one row per object and one column per element type that carries
 * label content (track segments, points, events, static features, …). Checking
 * a cell — or clicking the row header for the whole row — batch-displays that
 * group's labels; unchecking hides them again.
 *
 * A "label" is not a copy or an abbreviation of anything: the control simply
 * opens the **existing popups** bound to the layers — the very same popup a
 * manual click shows — so what is displayed in bulk is exactly the popup
 * content, with popup styling.
 *
 * Mechanics (verified against Leaflet 1.9):
 * - popups of labelled layers get `autoClose: false` (so they don't close each
 *   other), `autoPan: false` (so opening dozens never moves the map) and
 *   `closeOnClick: false` (Leaflet fires a synthetic `preclick` before every
 *   map click and closes popups on it via the map's `closePopupOnClick`);
 *   all three are restored when the cell is switched off;
 * - `layer.openPopup()` anchors on the layer's centre (`Path.getCenter()` for
 *   segments, the point itself for markers) and is a no-op while the layer is
 *   off the map;
 * - Leaflet does NOT close a popup when its layer leaves the map, so a
 *   `layeradd`/`layerremove` hook opens/closes labels together with element
 *   visibility (which also handles points that cluster in and out on zoom).
 */

/**
 * Collect the labelable leaf layers of an element layer together with their
 * bound popups.
 *
 * @param {L.Layer} elementLayer
 * @returns {Array<{ layer: L.Layer, popup: L.Popup }>}
 */
function collectLabelTargets(elementLayer) {
  var targets = [];
  if (!elementLayer || typeof elementLayer.eachLayer !== 'function') { return targets; }

  elementLayer.eachLayer(function (layer) {
    if (typeof layer.getPopup !== 'function') { return; }
    var popup = layer.getPopup();
    if (popup) {
      targets.push({ layer: layer, popup: popup });
    }
  });

  return targets;
}

/**
 * Switch a popup between "many open at once" mode and the default behavior:
 *  - autoClose: a new popup would close the previous one
 *  - autoPan:  opening dozens would pan the map around
 *  - closeOnClick: Leaflet fires a synthetic `preclick` before every map
 *    click and closes popups on it (map option closePopupOnClick)
 */
function setManyOpenMode(popup, on) {
  if (!popup) { return; }
  if (on) {
    popup.options.autoClose = false;
    popup.options.autoPan = false;
    popup.options.closeOnClick = false;
  } else {
    popup.options.autoClose = true;
    popup.options.autoPan = true;
    delete popup.options.closeOnClick; // fall back to the map default
  }
}

/**
 * Create the batch label display control (collapsed by default).
 *
 * @param {Object} allLayers - key → { layerPath, elements: [{ key, label, layer }] }
 * @param {Object} [options]
 * @param {string} [options.position='topright']
 * @param {string} [options.title='Labels']
 * @returns {L.Control} `control._rows` / `control._columns` expose the table model
 */
export function createInfoLabels(allLayers, options) {
  options = options || {};

  // ---- table model ----
  var rows = [];
  var columns = [];
  var seenColumn = {};

  var owners = Object.keys(allLayers || {});
  for (var i = 0; i < owners.length; i++) {
    var owner = allLayers[owners[i]];
    var elements = (owner && owner.elements) || [];
    var row = {
      key: owners[i],
      label: (owner && owner.layerPath ? owner.layerPath : owners[i].split('/')).join(' › '),
      cells: {},
    };

    for (var j = 0; j < elements.length; j++) {
      var element = elements[j];
      var targets = collectLabelTargets(element.layer);
      if (!targets.length) { continue; }

      row.cells[element.key] = {
        label: element.label,
        targets: targets,
        layer: element.layer, // kept so replaceLayer() can find this cell
      };
      if (!seenColumn[element.key]) {
        seenColumn[element.key] = { key: element.key, label: element.label };
        columns.push(seenColumn[element.key]);
      }
    }
    rows.push(row);
  }

  var InfoLabelsControl = L.Control.extend({
    options: {
      position: options.position || 'topright',
    },

    onAdd: function (map) {
      var self = this;

      this._map = map;
      this._state = {};        // rowKey → { elementKey: true }
      this._activeLabels = 0;  // number of currently open popups
      this._targetIndex = {};  // L.stamp(layer) → { rowKey, elementKey }

      var container = L.DomUtil.create('div', 'leaflet-trackreplay-infolabels');

      this._titleEl = L.DomUtil.create('div', 'tr-il-title', container);
      this._titleEl.onclick = function () { self._toggleExpanded(); };

      var table = L.DomUtil.create('table', 'tr-il-table', container);
      table.style.display = 'none'; // collapsed by default
      this._tableEl = table;
      this._collapsed = true;

      // header: one column per element type (headers are labels, not controls)
      var thead = L.DomUtil.create('thead', '', table);
      var headRow = L.DomUtil.create('tr', '', thead);
      L.DomUtil.create('th', 'tr-il-rowhead', headRow);
      for (var c = 0; c < columns.length; c++) {
        var th = L.DomUtil.create('th', 'tr-il-colhead', headRow);
        th.textContent = columns[c].label;
      }

      // one row per object
      var tbody = L.DomUtil.create('tbody', '', table);
      for (var r = 0; r < rows.length; r++) {
        this._buildRow(tbody, rows[r]);
      }

      // Leaflet never closes a popup when its layer leaves the map, so keep
      // labels in sync with element visibility (this also covers points that
      // cluster in and out while zooming)
      this._onLayerChange = function (e) {
        var entry = self._targetIndex[L.stamp(e.layer)];
        if (!entry) { return; }
        if (e.type === 'layeradd') {
          if (self._state[entry.rowKey][entry.elementKey]) {
            // A layer that comes onto the map while its cell is checked — a
            // rebuilt element after a cluster/scatter switch, or a point
            // de-clustering on zoom — was never seen by _applyCell, so its
            // popup still carries the default single-popup options. Put it
            // in "many open at once" mode first, or it would close the
            // previous one instead of joining it.
            setManyOpenMode(e.layer.getPopup(), true);
            e.layer.openPopup();
          }
        } else {
          e.layer.closePopup();
        }
      };
      map.on('layeradd layerremove', this._onLayerChange);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      this._updateTitle();
      return container;
    },

    onRemove: function (map) {
      map.off('layeradd layerremove', this._onLayerChange);
    },

    /** Build one table row (row header + one checkbox per available column). */
    _buildRow: function (tbody, row) {
      var self = this;
      this._state[row.key] = {};

      var tr = L.DomUtil.create('tr', 'tr-il-row', tbody);
      row._tr = tr; // kept for setCellState()/applyCheckedState()

      // row header — click to switch the whole row
      var head = L.DomUtil.create('td', 'tr-il-rowhead', tr);
      var rowCheck = L.DomUtil.create('input', 'tr-il-rowcheck', head);
      rowCheck.type = 'checkbox';
      head.appendChild(document.createTextNode(' ' + row.label));

      head.onclick = function (e) {
        if (e.target === rowCheck) { return; }
        rowCheck.checked = !rowCheck.checked;
        self._setRow(row, tr, rowCheck.checked);
      };
      rowCheck.onclick = function (e) {
        e.stopPropagation();
        self._setRow(row, tr, rowCheck.checked);
      };
      tr._rowCheckbox = rowCheck;

      for (var c = 0; c < columns.length; c++) {
        var colKey = columns[c].key;
        var td = L.DomUtil.create('td', 'tr-il-cell', tr);

        if (!row.cells[colKey]) {
          L.DomUtil.addClass(td, 'tr-il-cell-empty');
          continue;
        }

        var box = L.DomUtil.create('input', '', td);
        box.type = 'checkbox';

        // index this cell's layers for the layeradd/layerremove hook
        var cell = row.cells[colKey];
        cell._box = box; // kept for applyCheckedState()
        for (var t = 0; t < cell.targets.length; t++) {
          this._targetIndex[L.stamp(cell.targets[t].layer)] = {
            rowKey: row.key,
            elementKey: colKey,
          };
        }

        (function (r0, key, cbEl) {
          cbEl.onclick = function (e) {
            e.stopPropagation();
            self._applyCell(r0, key, cbEl.checked);
            self._refreshRow(r0, tr);
          };
        })(row, colKey, box);
      }
    },

    /** Open/close the popups of one (object, element type) cell. */
    _applyCell: function (row, elementKey, on) {
      var cell = row.cells[elementKey];
      if (!cell) { return; }

      var was = !!this._state[row.key][elementKey];
      if (on === was) { return; }
      this._state[row.key][elementKey] = !!on;
      this._activeLabels += on ? cell.targets.length : -cell.targets.length;

      for (var i = 0; i < cell.targets.length; i++) {
        var target = cell.targets[i];

        if (on) {
          setManyOpenMode(target.popup, true);
          target.layer.openPopup();
        } else {
          target.layer.closePopup();
          setManyOpenMode(target.popup, false);
        }
      }

      this._updateTitle();
    },

    /**
     * Swap one element layer for a rebuilt one (e.g. the background nodes
     * layer re-rendered cluster ↔ scatter). The matching cells re-collect
     * their label targets from the new layer and the stamp index is rebuilt;
     * cell checked-state is kept, so the map's layeradd hook re-opens those
     * popups as the new markers come onto the map.
     */
    replaceLayer: function (oldLayer, nextLayer) {
      if (!this._targetIndex) { return; }
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        for (var key in row.cells) {
          if (!row.cells.hasOwnProperty(key)) { continue; }
          var cell = row.cells[key];
          if (cell.layer !== oldLayer) { continue; }

          for (var t = 0; t < cell.targets.length; t++) {
            delete this._targetIndex[L.stamp(cell.targets[t].layer)];
          }

          cell.layer = nextLayer;
          cell.targets = collectLabelTargets(nextLayer);

          for (var t2 = 0; t2 < cell.targets.length; t2++) {
            this._targetIndex[L.stamp(cell.targets[t2].layer)] = {
              rowKey: row.key,
              elementKey: key,
            };
          }
        }
      }
    },

    /**
     * Snapshot the currently checked cells (rowKey/elementKey pairs). Used by
     * the session facade when a dataset change rebuilds every layer/control.
     */
    getCheckedCells: function () {
      var out = [];
      for (var rowKey in this._state) {
        if (!this._state.hasOwnProperty(rowKey)) { continue; }
        for (var elementKey in this._state[rowKey]) {
          if (this._state[rowKey][elementKey]) {
            out.push({ rowKey: rowKey, elementKey: elementKey });
          }
        }
      }
      return out;
    },

    /**
     * Re-check a snapshot of cells on a freshly built control. Cells whose
     * object/element is gone (owned by a removed dataset) are skipped; the
     * popups of the new layers reopen through the map's layeradd hook.
     */
    applyCheckedState: function (checkedCells) {
      for (var i = 0; i < checkedCells.length; i++) {
        var s = checkedCells[i];
        for (var r = 0; r < rows.length; r++) {
          if (rows[r].key !== s.rowKey) { continue; }
          var row = rows[r];
          var cell = row.cells[s.elementKey];
          if (!cell || !cell._box) { break; }
          cell._box.checked = true;
          this._applyCell(row, s.elementKey, true);
          this._refreshRow(row, row._tr);
          break;
        }
      }
    },

    /** Switch every available cell of one row. */
    _setRow: function (row, tr, on) {
      for (var key in row.cells) {
        if (row.cells.hasOwnProperty(key)) {
          this._applyCell(row, key, on);
        }
      }
      this._refreshRow(row, tr);
    },

    /** Tri-state row checkbox (all / partial / none). */
    _refreshRow: function (row, tr) {
      var on = 0;
      var total = 0;
      for (var key in row.cells) {
        if (!row.cells.hasOwnProperty(key)) { continue; }
        total++;
        if (this._state[row.key][key]) { on++; }
      }
      if (!tr._rowCheckbox) { return; }
      tr._rowCheckbox.checked = total > 0 && on === total;
      tr._rowCheckbox.indeterminate = on > 0 && on < total;
    },

    _toggleExpanded: function () {
      this.setCollapsed(!this._collapsed);
    },

    /** Fold/unfold the label table (the title is the header). */
    setCollapsed: function (collapsed) {
      var show = !collapsed;
      this._collapsed = !!collapsed;
      if (this._tableEl) { this._tableEl.style.display = show ? '' : 'none'; }
      if (this._container) {
        if (show) { L.DomUtil.addClass(this._container, 'tr-il-expanded'); }
        else { L.DomUtil.removeClass(this._container, 'tr-il-expanded'); }
      }
    },

    /** @returns {boolean} */
    isCollapsed: function () { return !!this._collapsed; },

    _updateTitle: function () {
      var base = options.title || 'Labels';
      this._titleEl.textContent = this._activeLabels
        ? base + ' (' + this._activeLabels + ')'
        : base;
    },
  });

  var control = new InfoLabelsControl();
  control._rows = rows;
  control._columns = columns;
  control.hasContent = rows.length > 0 && columns.length > 0;
  return control;
}
