/**
 * Time formatting utilities for Leaflet.TrackReplay.
 */

/**
 * Detect if a timestamp is in seconds or milliseconds.
 * Heuristic: if value < 1e12, treat as seconds; otherwise ms.
 * @param {number} ts
 * @returns {string} 'seconds' | 'milliseconds'
 */
export function detectTimeUnit(ts) {
  // Timestamps after year 2001 in ms are > 1e12, in seconds are ~1e9
  // Timestamps before year 2001 in ms could be ~9e11
  // Use a reasonable threshold: if any timestamp > 1e12, it's ms
  if (ts > 1e12) { return 'milliseconds'; }
  return 'seconds';
}

/**
 * Normalize a timestamp to milliseconds.
 * @param {number} ts
 * @returns {number} timestamp in ms
 */
export function toMilliseconds(ts) {
  if (detectTimeUnit(ts) === 'seconds') {
    return ts * 1000;
  }
  return ts;
}

/**
 * Normalize all timestamps in an array to milliseconds.
 * @param {number[]} times
 * @returns {number[]}
 */
export function normalizeTimesToMs(times) {
  if (!times || times.length === 0) { return []; }
  var unit = detectTimeUnit(times[0]);
  if (unit === 'seconds') {
    return times.map(function (t) { return t * 1000; });
  }
  return times;
}

/**
 * Format a playback speed multiplier for display.
 *
 * Below 60× the plain multiplier is used ("8×"); at 60× and above the label
 * switches to time compression ("1s = 1min"), the natural notation for tracks
 * that span hours or days.
 *
 * @param {number} speed - playback speed multiplier
 * @returns {string}
 */
export function formatSpeedLabel(speed) {
  if (!speed || speed < 60) { return speed + '×'; }

  // speed = seconds of simulated time per second of real time
  if (speed % 3600 === 0) { return '1s = ' + (speed / 3600) + 'h'; }
  if (speed % 60 === 0) { return '1s = ' + (speed / 60) + 'min'; }
  return '1s = ' + (speed / 60).toFixed(1) + 'min';
}

/**
 * Format a Unix timestamp (ms) to local time string.
 * @param {number} tsMs - timestamp in milliseconds
 * @param {string} [format='full'] - 'full', 'time', 'date'
 * @returns {string}
 */
export function formatTimestamp(tsMs, format) {
  var d = new Date(tsMs);
  var year = d.getFullYear();
  var month = pad(d.getMonth() + 1);
  var day = pad(d.getDate());
  var hours = pad(d.getHours());
  var minutes = pad(d.getMinutes());
  var seconds = pad(d.getSeconds());

  if (format === 'time') {
    return hours + ':' + minutes + ':' + seconds;
  }
  if (format === 'date') {
    return year + '-' + month + '-' + day;
  }
  return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
}

/**
 * Parse a local time string back to Unix timestamp (ms).
 * @param {string} str - format "YYYY-MM-DD HH:mm:ss" or "HH:mm:ss"
 * @param {number} [baseDateMs] - base date for time-only format
 * @returns {number} timestamp in ms
 */
export function parseTimeString(str, baseDateMs) {
  var parts = str.trim().split(/[\s:-]+/);
  var d;
  if (parts.length >= 6) {
    // Full datetime
    d = new Date(
      parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10),
      parseInt(parts[3], 10), parseInt(parts[4], 10), parseInt(parts[5], 10)
    );
  } else if (parts.length >= 3) {
    // Time only
    var base = baseDateMs ? new Date(baseDateMs) : new Date();
    d = new Date(
      base.getFullYear(), base.getMonth(), base.getDate(),
      parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10)
    );
  } else {
    return null;
  }
  return d.getTime();
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}
