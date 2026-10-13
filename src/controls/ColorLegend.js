/**
 * ColorLegend — speed color bar legend control.
 *
 * Displays a gradient bar with speed labels (e.g., "0 km/h" → "200 km/h").
 * The legend is updated dynamically based on the ColorMapper mode and data.
 */

/**
 * Create a color legend control.
 *
 * @param {Object} colorMapper  - ColorMapper instance
 * @param {Object} [options]
 * @param {string} [options.position='bottomright']
 * @param {string} [options.title='Speed (km/h)']
 * @param {number} [options.steps=10]
 * @returns {L.Control}
 */
export function createColorLegend(colorMapper, options) {
  options = options || {};
  var steps = options.steps || 10;
  var titleText = options.title || 'Speed (km/h)';

  var ColorLegendCtrl = L.Control.extend({
    options: {
      position: options.position || 'bottomright',
    },

    onAdd: function (/*map*/) {
      var container = L.DomUtil.create('div', 'leaflet-trackreplay-legend');

      var title = L.DomUtil.create('div', 'tr-legend-title', container);
      title.textContent = titleText;

      var gradientContainer = L.DomUtil.create('div', 'tr-legend-gradient', container);

      var legendData = colorMapper.getLegend(steps);

      // Build horizontal gradient bar
      var bar = L.DomUtil.create('div', 'tr-legend-bar', gradientContainer);
      var gradientCSS = 'linear-gradient(to right';
      for (var i = 0; i < legendData.length; i++) {
        gradientCSS += ', ' + legendData[i].color;
      }
      gradientCSS += ')';
      bar.style.background = gradientCSS;

      // Build labels
      var labelsContainer = L.DomUtil.create('div', 'tr-legend-labels', gradientContainer);

      // Show min, mid, max labels
      var minLabel = L.DomUtil.create('span', 'tr-legend-label-min', labelsContainer);
      minLabel.textContent = legendData[0].label;

      var midLabel = L.DomUtil.create('span', 'tr-legend-label-mid', labelsContainer);
      var midIdx = Math.floor(legendData.length / 2);
      midLabel.textContent = legendData[midIdx].label;

      var maxLabel = L.DomUtil.create('span', 'tr-legend-label-max', labelsContainer);
      maxLabel.textContent = legendData[legendData.length - 1].label;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      return container;
    },

    /**
     * Refresh the legend (call after colorMapper mode changes).
     */
    refresh: function () {
      // Re-render — simplest approach: remove and re-add
      // In practice, the user can call createColorLegend again
      var cnt = this.getContainer();
      if (!cnt) { return; }
      // Clear and rebuild
      while (cnt.firstChild) {
        cnt.removeChild(cnt.firstChild);
      }
      // Re-run onAdd logic
      var newContent = this.onAdd(this._map);
      cnt.appendChild(newContent);
    },
  });

  return new ColorLegendCtrl();
}
