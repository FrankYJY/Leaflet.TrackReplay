/**
 * Geographic calculation utilities for Leaflet.TrackReplay.
 */

/**
 * Calculate distance between two coordinates in kilometers (Haversine formula).
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} distance in km
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  var R = 6371; // Earth radius in km
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate speed between two points given timestamps.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @param {number} time1 - Unix timestamp (ms)
 * @param {number} time2 - Unix timestamp (ms)
 * @returns {number} speed in km/h, or 0 if time diff is zero
 */
export function calculateSpeed(lat1, lng1, lat2, lng2, time1, time2) {
  var distKm = haversineDistance(lat1, lng1, lat2, lng2);
  var timeHours = (time2 - time1) / (1000 * 3600);
  if (timeHours <= 0) { return 0; }
  return distKm / timeHours;
}

/**
 * Calculate bearing from point A to point B.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} bearing in degrees (0 = north, clockwise)
 */
export function calculateBearing(lat1, lng1, lat2, lng2) {
  var dLng = toRad(lng2 - lng1);
  var phi1 = toRad(lat1);
  var phi2 = toRad(lat2);
  var y = Math.sin(dLng) * Math.cos(phi2);
  var x = Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  var bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * Interpolate a position between two coordinates at a given fraction.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @param {number} fraction - 0 to 1
 * @returns {object} { lat, lng }
 */
export function interpolatePosition(lat1, lng1, lat2, lng2, fraction) {
  return {
    lat: lat1 + (lat2 - lat1) * fraction,
    lng: lng1 + (lng2 - lng1) * fraction,
  };
}

/**
 * Find the segment index and fraction for a given timestamp.
 * @param {number[]} times - sorted timestamp array
 * @param {number} currentTime
 * @returns {object|null} { index, fraction, beforeIndex, afterIndex }
 */
export function findTimePosition(times, currentTime) {
  if (!times || times.length === 0) { return null; }
  if (currentTime <= times[0]) {
    return { index: 0, fraction: 0, beforeIndex: 0, afterIndex: 0 };
  }
  if (currentTime >= times[times.length - 1]) {
    var last = times.length - 1;
    return { index: last - 1, fraction: 1, beforeIndex: last - 1, afterIndex: last };
  }
  for (var i = 0; i < times.length - 1; i++) {
    if (currentTime >= times[i] && currentTime <= times[i + 1]) {
      var range = times[i + 1] - times[i];
      var frac = range > 0 ? (currentTime - times[i]) / range : 0;
      return { index: i, fraction: frac, beforeIndex: i, afterIndex: i + 1 };
    }
  }
  return null;
}

/**
 * Calculate the 95th percentile of an array.
 * @param {number[]} values
 * @returns {number}
 */
export function percentile95(values) {
  if (!values || values.length === 0) { return 0; }
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Calculate the 5th percentile of an array.
 * @param {number[]} values
 * @returns {number}
 */
export function percentile05(values) {
  if (!values || values.length === 0) { return 0; }
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var idx = Math.floor(0.05 * sorted.length);
  return sorted[Math.min(sorted.length - 1, idx)];
}

function toRad(deg) {
  return deg * Math.PI / 180;
}

function toDeg(rad) {
  return rad * 180 / Math.PI;
}
