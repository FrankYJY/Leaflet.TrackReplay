/**
 * ElementToggles — batch show/hide control, one tri-state checkbox per display
 * element type (track lines, points, traveled/untraveled route, indicator, …).
 *
 * Unlike the layer tree's per-object select-all, this works *across all
 * objects*: one click hides e.g. every "track" layer of every object at once.
 * Every change goes through map.addLayer/map.removeLayer, so the layer tree
 * checkboxes (and their select-all parents) stay in sync automatically.
 *
 * Batch switching ignores `layerVisibility` — an object hidden at init is
 * still switched on when its element type is batch-enabled.
 */

/**
 * Aggregate element layers by type across all objects.
 *
 * @param {Object} allLayers - key → { elements: [{ key, label, layer }] }
 * @returns {Array<{ key, label, layers: L.Layer[] }>} in first-appearance order
 */
function collectRows(allLayers) {
  var byKey = {};
  var order = [];
  var owners = Object.keys(allLayers || {});

  for (var i = 0; i < owners.length; i++) {
    var elements = (allLayers[owners[i]] && allLayers[owners[i]].elements) || [];
    for (var j = 0; j < elements.length; j++) {
      var el = elements[j];
      if (!byKey[el.key]) {
        byKey[el.key] = { key: el.key, label: el.label, layers: [] };
        order.push(el.key);
      }
      byKey[el.key].layers.push(el.layer);
    }
  }

  var rows = [];
  for (var k = 0; k < order.length; k++) {
    rows.push(byKey[order[k]]);
  }
  return rows;
}

/**
 * Create the element toggles control.
 *
 * @param {Object} allLayers - from the TrackReplay instance (key → { elements })
 * @param {Object} [options]
 * @param {string} [options.position='topright']
 * @param {string} [options.title='Batch']
 * @returns {L.Control} the control; `control._rows` lists the element types and
 *          `control.hasRows` is false when there is nothing to toggle
 */
export function createElementToggles(allLayers, options) {
  options = options || {};
  var rows = collectRows(allLayers);

  var ElementTogglesControl = L.Control.extend({
    options: {
      position: options.position || 'topright',
    },

    onAdd: function (map) {
      var container = L.DomUtil.create('div', 'leaflet-trackreplay-elementtoggles');
      var self = this;

      this._inputs = {};
      this._counts = {};

      var title = L.DomUtil.create('div', 'tr-et-title', container);
      title.textContent = options.title || 'Batch';

      // The title doubles as the fold header (like the labels/search panels);
      // the body starts expanded.
      var body = L.DomUtil.create('div', 'tr-et-body', container);
      this._bodyEl = body;
      this._collapsed = false;
      title.onclick = function () { self.setCollapsed(!self._collapsed); };

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];

        // div row (block by default → vertical list even without the stylesheet);
        // the label inside keeps "click the text to toggle" working
        var line = L.DomUtil.create('div', 'tr-et-row', body);
        var labelEl = L.DomUtil.create('label', 'tr-et-label', line);

        var input = L.DomUtil.create('input', 'tr-et-checkbox', labelEl);
        input.type = 'checkbox';

        labelEl.appendChild(document.createTextNode(' ' + row.label));

        var count = L.DomUtil.create('span', 'tr-et-count', line);

        (function (r, inp) {
          inp.onclick = function () {
            // The browser already flipped `checked` — apply it to every layer
            // of this element type across all objects
            self._setAll(r, inp.checked);
          };
        })(row, input);

        this._inputs[row.key] = input;
        this._counts[row.key] = count;
      }

      // Recompute the tri-state whenever layers come or go (our clicks, tree
      // checkbox clicks, or programmatic changes)
      this._onLayerChange = function () { self.updateStates(); };
      map.on('layeradd layerremove', this._onLayerChange);
      this.updateStates();

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      return container;
    },

    onRemove: function (map) {
      map.off('layeradd layerremove', this._onLayerChange);
    },

    /** Fold/unfold the body (the title is the header). */
    setCollapsed: function (collapsed) {
      this._collapsed = !!collapsed;
      if (this._bodyEl) { this._bodyEl.style.display = this._collapsed ? 'none' : ''; }
      if (this._container) {
        if (this._collapsed) { L.DomUtil.addClass(this._container, 'tr-et-collapsed'); }
        else { L.DomUtil.removeClass(this._container, 'tr-et-collapsed'); }
      }
    },

    /** @returns {boolean} */
    isCollapsed: function () { return !!this._collapsed; },

    /** Show or hide every layer of one element type (all objects). */
    _setAll: function (row, on) {
      var map = this._map;
      if (!map) { return; }
      for (var i = 0; i < row.layers.length; i++) {
        if (on) {
          map.addLayer(row.layers[i]);
        } else if (map.hasLayer(row.layers[i])) {
          map.removeLayer(row.layers[i]);
        }
      }
    },

    /**
     * Swap one element layer for a rebuilt one (e.g. the background nodes
     * layer re-rendered cluster ↔ scatter). All rows referring to the old
     * layer are re-pointed at the new one and the tri-state counts refresh.
     */
    replaceLayer: function (oldLayer, nextLayer) {
      for (var i = 0; i < rows.length; i++) {
        var layers = rows[i].layers;
        for (var j = 0; j < layers.length; j++) {
          if (layers[j] === oldLayer) { layers[j] = nextLayer; }
        }
      }
      this.updateStates();
    },

    /** Refresh tri-state checkboxes and counts from the map state. */
    updateStates: function () {
      var map = this._map;
      if (!map) { return; }
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var on = 0;
        for (var j = 0; j < row.layers.length; j++) {
          if (map.hasLayer(row.layers[j])) { on++; }
        }

        var input = this._inputs[row.key];
        var count = this._counts[row.key];
        if (!input) { continue; }

        input.checked = on > 0 && on === row.layers.length;
        input.indeterminate = on > 0 && on < row.layers.length;
        if (count) { count.textContent = on + '/' + row.layers.length; }
      }
    },
  });

  var control = new ElementTogglesControl();
  control._rows = rows;
  control.hasRows = rows.length > 0;
  return control;
}
