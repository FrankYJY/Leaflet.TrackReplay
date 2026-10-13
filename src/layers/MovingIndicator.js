/**
 * MovingIndicator — renders a moving marker that follows the track based on
 * current time, with optional bearing-based rotation.
 */

import { interpolatePosition, calculateBearing } from '../utils/GeoUtils.js';

/**
 * Create a moving indicator for a TimestampEdgeoJSON track.
 *
 * @param {Object} sourceFeature  - the _trackMeta-bearing segment feature (source)
 * @param {Object} [options]
 * @param {L.Icon|L.DivIcon|Function} [options.icon] - custom icon for the moving marker
 * @param {Function} [options.bearingTransform] - fn(bearing) => newBearing
 * @param {number} [options.rotationOffset=0] - degrees to add to bearing (e.g., 90 if icon points right)
 * @returns {Object} { marker, update(timeMs), remove() }
 */
export function createMovingIndicator(sourceFeature, options) {
  options = options || {};

  var meta = sourceFeature._trackMeta;
  if (!meta || !meta.times || !meta.coords) {
    throw new Error('MovingIndicator: sourceFeature must have _trackMeta with times and coords');
  }

  var times = meta.times;
  var coords = meta.coords;
  var icon = options.icon;
  var rotationOffset = options.rotationOffset || 0;

  // Rotation is ON by default with a pass-through transform.
  // Pass `bearingTransform: null` to disable rotation entirely (slightly faster).
  var rotateEnabled = options.bearingTransform !== null;
  var bearingTransform = typeof options.bearingTransform === 'function'
    ? options.bearingTransform
    : function (b) { return b; };

  // Default icon: a directional triangle marker.
  // The inner div is a 0×0 element (the triangle is drawn with borders), so a
  // percentage translate on it resolves against the 16×20 border box and would
  // shift the visible triangle ~31px away from the anchor. Keep it untranslated
  // and anchor the icon at the triangle's center instead.
  if (!icon) {
    icon = L.divIcon({
      className: 'leaflet-trackreplay-indicator',
      html: '<div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:20px solid #e74c3c;"></div>',
      iconSize: [16, 20],
      iconAnchor: [8, 10],
    });
  }

  // Rotate around the icon anchor (the geographic point), not the element center.
  var iconOptions = icon.options || {};
  var anchor = iconOptions.iconAnchor;
  var rotationOrigin = options.rotationOrigin ||
    (anchor ? anchor[0] + 'px ' + anchor[1] + 'px' : 'center center');

  // Create marker at first position
  var startCoord = coords[0];
  var marker = L.marker([startCoord[1], startCoord[0]], {
    icon: icon,
    zIndexOffset: 1000,
  });

  // Track current state
  var _currentBearing = 0;
  var _currentLatLng = null;
  var _rotation = 0;

  /**
   * Append the rotation to the marker's positioning transform.
   * Leaflet positions the icon element via `transform: translate3d(...)`,
   * so we must NOT overwrite it — we strip any previous rotate() and append.
   */
  function applyRotation() {
    if (!rotateEnabled) { return; }
    var el = marker.getElement();
    if (!el) { return; }
    var base = (el.style.transform || '').replace(/\s*rotate\([^)]*\)/g, '');
    el.style.transform = base + ' rotate(' + _rotation.toFixed(1) + 'deg)';
    el.style.transformOrigin = rotationOrigin;
  }

  // Re-apply rotation whenever Leaflet re-positions the icon
  // (setLatLng, zoom, pan) — otherwise those calls would wipe it.
  var _origSetPos = marker._setPos;
  if (typeof _origSetPos === 'function') {
    marker._setPos = function (pos) {
      _origSetPos.call(this, pos);
      applyRotation();
    };
  }

  /**
   * Update the marker position based on current time.
   * @param {number} timeMs - current playback time in ms
   */
  function update(timeMs) {
    // Find position in the time array
    if (timeMs <= times[0]) {
      _currentLatLng = L.latLng(coords[0][1], coords[0][0]);
      if (times.length > 1) {
        _currentBearing = calculateBearing(
          coords[0][1], coords[0][0],
          coords[1][1], coords[1][0]
        );
      }
    } else if (timeMs >= times[times.length - 1]) {
      var last = coords.length - 1;
      _currentLatLng = L.latLng(coords[last][1], coords[last][0]);
      if (coords.length > 1) {
        _currentBearing = calculateBearing(
          coords[last - 1][1], coords[last - 1][0],
          coords[last][1], coords[last][0]
        );
      }
    } else {
      // Find the segment
      for (var i = 0; i < times.length - 1; i++) {
        if (timeMs >= times[i] && timeMs <= times[i + 1]) {
          var range = times[i + 1] - times[i];
          var frac = range > 0 ? (timeMs - times[i]) / range : 0;

          var pos = interpolatePosition(
            coords[i][1], coords[i][0],
            coords[i + 1][1], coords[i + 1][0],
            frac
          );

          _currentLatLng = L.latLng(pos.lat, pos.lng);
          _currentBearing = calculateBearing(
            coords[i][1], coords[i][0],
            coords[i + 1][1], coords[i + 1][0]
          );
          break;
        }
      }
    }

    if (!_currentLatLng) { return; }
    marker.setLatLng(_currentLatLng);

    if (rotateEnabled) {
      var finalBearing = bearingTransform(_currentBearing) + rotationOffset;
      _rotation = ((finalBearing % 360) + 360) % 360;
      applyRotation();
    }
  }

  function remove() {
    if (marker._map) {
      marker._map.removeLayer(marker);
    }
  }

  return {
    marker: marker,
    update: update,
    remove: remove,
  };
}
