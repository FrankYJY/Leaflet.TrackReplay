/**
 * ClusterScatterControl — rendering-mode settings for scatter-style elements.
 *
 * A small settings panel (title configurable, default "Cluster / Scatter")
 * made of one section per element type. Currently one section — background
 * nodes — holding the two-way choice between clustered ('cluster') and raw
 * scatter ('scatter') rendering. Switching the mode rebuilds that element's
 * layers in place (see TrackReplay's applyBackgroundMode): visibility and
 * batch-label state are preserved.
 */

/**
 * Create the cluster / scatter settings control.
 *
 * @param {Object} [options]
 * @param {string} [options.position='topright']
 * @param {string} [options.title='Cluster / Scatter'] - panel title
 * @param {string} [options.sectionLabel='Background nodes'] - the section
 *        header (the caller passes the configured background-nodes label)
 * @param {string} [options.clusterLabel='Cluster']
 * @param {string} [options.scatterLabel='Scatter']
 * @param {boolean} [options.clusterAvailable=true] - false disables the
 *        clustering option (Leaflet.markercluster missing)
 * @param {string} [options.value='scatter'] - initially selected mode
 * @param {Function} [options.onChange] - fn(mode) with 'cluster' | 'scatter'
 * @returns {L.Control} with `setValue(mode)`
 */
export function createClusterScatterControl(options) {
  options = options || {};

  var ClusterScatterCtrl = L.Control.extend({
    options: {
      position: options.position || 'topright',
    },

    onAdd: function (/*map*/) {
      var self = this;
      var container = L.DomUtil.create('div', 'leaflet-trackreplay-clusterscatter');

      var title = L.DomUtil.create('div', 'tr-cs-title', container);
      title.textContent = options.title || 'Cluster / Scatter';

      // The title doubles as the fold header; the body starts expanded.
      var body = L.DomUtil.create('div', 'tr-cs-body', container);
      this._bodyEl = body;
      this._collapsed = false;
      title.onclick = function () { self.setCollapsed(!self._collapsed); };

      // ---- one section per element type (currently: background nodes) ----
      var section = L.DomUtil.create('div', 'tr-cs-section', body);

      var sectionTitle = L.DomUtil.create('div', 'tr-cs-section-title', section);
      sectionTitle.textContent = options.sectionLabel || 'Background nodes';

      // Unique radio-group name: two plugin instances on one page (and their
      // controls) must not fight over each other's checked state.
      var group = 'tr-cs-' + L.stamp(this);

      var modes = [
        { value: 'cluster', label: options.clusterLabel || 'Cluster' },
        { value: 'scatter', label: options.scatterLabel || 'Scatter' },
      ];

      this._inputs = {};
      for (var i = 0; i < modes.length; i++) {
        var line = L.DomUtil.create('label', 'tr-cs-option', section);
        var radio = L.DomUtil.create('input', '', line);
        radio.type = 'radio';
        radio.name = group;
        radio.value = modes[i].value;

        // Clustering needs Leaflet.markercluster; without it 'cluster' would
        // silently fall back to scatter, so disable the option instead.
        if (modes[i].value === 'cluster' && options.clusterAvailable === false) {
          radio.disabled = true;
          L.DomUtil.addClass(line, 'tr-cs-disabled');
        }

        (function (value) {
          radio.onchange = function () {
            if (options.onChange) { options.onChange(value); }
          };
        })(modes[i].value);

        line.appendChild(document.createTextNode(' ' + modes[i].label));
        this._inputs[modes[i].value] = radio;
      }

      this.setValue(options.value === 'cluster' ? 'cluster' : 'scatter');

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      return container;
    },

    /**
     * Reflect a mode in the radios — also used when the mode changes
     * programmatically (e.g. the layer falls back to scatter).
     * @param {string} mode - 'cluster' | 'scatter'
     */
    setValue: function (mode) {
      if (!this._inputs || !this._inputs[mode]) { return; }
      this._inputs[mode].checked = true;
    },

    /** Fold/unfold the body (the title is the header). */
    setCollapsed: function (collapsed) {
      this._collapsed = !!collapsed;
      if (this._bodyEl) { this._bodyEl.style.display = this._collapsed ? 'none' : ''; }
      if (this._container) {
        if (this._collapsed) { L.DomUtil.addClass(this._container, 'tr-cs-collapsed'); }
        else { L.DomUtil.removeClass(this._container, 'tr-cs-collapsed'); }
      }
    },

    /** @returns {boolean} */
    isCollapsed: function () { return !!this._collapsed; },
  });

  return new ClusterScatterCtrl();
}
