/**
 * Speed-to-color mapping engine.
 *
 * Three modes:
 *   - 'fixed':    continuous Turbo-style ramp over a configurable speed range
 *                 (default 0–200 km/h) — slow = dark blue, fast = dark red
 *   - 'adaptive': the same ramp over the P5–P95 of all speeds in the data
 *   - 'custom':   user-supplied colorbar config (branca-style)
 *
 * The ramp is magnitude-oriented: cool/dark = slow, warm = fast.
 */

/**
 * Turbo-style continuous ramp (Google Turbo sampled at 15 stops, Apache-2.0).
 * Multi-stop and perceptually smoother than a straight blue→red interpolation,
 * which dips through a muddy grey-purple at the midpoint.
 */
var TURBO_STOPS = [
  '#30123B', '#4145AB', '#4675ED', '#39A2FC', '#1BCFD4',
  '#24ECA6', '#61FC6C', '#A4FC3B', '#D1E834', '#F3C63A',
  '#FE9B2D', '#F36315', '#D93806', '#B11901', '#7A0403',
];

/** Interpolate the Turbo ramp at t ∈ [0, 1]. */
function turboColor(t) {
  t = clamp(t, 0, 1);
  var n = TURBO_STOPS.length - 1;
  var pos = t * n;
  var i = Math.min(Math.floor(pos), n - 1);
  var frac = pos - i;
  if (frac <= 0) { return TURBO_STOPS[i]; }
  if (frac >= 1) { return TURBO_STOPS[i + 1]; }
  return interpolateColor(TURBO_STOPS[i], TURBO_STOPS[i + 1], frac);
}

/** Ramp value for a speed within [lo, hi]. */
function rampColor(speed, lo, hi) {
  if (hi <= lo) { return TURBO_STOPS[0]; }
  return turboColor((speed - lo) / (hi - lo));
}

/**
 * @typedef {Object} ColorBarConfig
 * @property {string[]} colors  - CSS color strings
 * @property {number[]} index   - value stops (same length as colors)
 * @property {number}   vmin    - minimum value of the scale
 * @property {number}   vmax    - maximum value of the scale
 */

/**
 * Create a ColorMapper instance.
 *
 * @param {string} mode            - 'fixed' | 'adaptive' | 'custom'
 * @param {ColorBarConfig} [config] - required when mode === 'custom'
 * @param {Object} [options]
 * @param {number[]} [options.range] - [min, max] speed range for 'fixed' mode
 *        in km/h (default [0, 200]); adaptive stays P5–P95 of the data and
 *        custom uses config.vmin/vmax
 */
export function createColorMapper(mode, config, options) {
  if (!mode) { mode = 'fixed'; }
  options = options || {};

  var fixedRange = { min: 0, max: 200 };
  if (options.range && options.range.length === 2 &&
      isFinite(options.range[0]) && isFinite(options.range[1]) &&
      options.range[1] > options.range[0]) {
    fixedRange = { min: options.range[0], max: options.range[1] };
  }

  var mapper = {
    mode: mode,
    config: config || null,
    range: fixedRange,   // used by 'fixed' mode (and the legend fallback)
    _stats: null, // { p05, p95, min, max } — populated during adaptive init
  };

  /**
   * Initialize with statistics from all speed data (for adaptive mode).
   * @param {number[]} allSpeeds - flat array of all speed values across all tracks
   */
  mapper.initStats = function (allSpeeds) {
    if (!allSpeeds || allSpeeds.length === 0) { return; }
    var sorted = allSpeeds.slice().sort(function (a, b) { return a - b; });
    var p05Idx = Math.floor(0.05 * sorted.length);
    var p95Idx = Math.ceil(0.95 * sorted.length) - 1;
    mapper._stats = {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p05: sorted[Math.max(0, p05Idx)],
      p95: sorted[Math.max(0, p95Idx)],
    };
  };

  /**
   * Get the color for a given speed value.
   * @param {number} speed - km/h
   * @returns {string} CSS color
   */
  mapper.getColor = function (speed) {
    if (mapper.mode === 'custom' && mapper.config) {
      return getCustomColor(speed, mapper.config);
    }
    if (mapper.mode === 'adaptive' && mapper._stats) {
      return rampColor(speed, mapper._stats.p05, mapper._stats.p95);
    }
    return rampColor(speed, mapper.range.min, mapper.range.max);
  };

  /**
   * Generate a legend configuration for display.
   * @param {number} [steps=10] - number of color stops
   * @returns {Array<{speed: number, color: string, label: string}>}
   */
  mapper.getLegend = function (steps) {
    if (!steps) { steps = 10; }
    var range = mapper.getRange();
    var result = [];
    for (var i = 0; i <= steps; i++) {
      var speed = range.min + (range.max - range.min) * (i / steps);
      result.push({
        speed: speed,
        color: mapper.getColor(speed),
        label: speed.toFixed(1) + ' km/h',
      });
    }
    return result;
  };

  /**
   * Get the speed range for the current mode.
   * @returns {{min: number, max: number}}
   */
  mapper.getRange = function () {
    if (mapper.mode === 'custom' && mapper.config) {
      return { min: mapper.config.vmin, max: mapper.config.vmax };
    }
    if (mapper.mode === 'adaptive' && mapper._stats) {
      return { min: mapper._stats.p05, max: mapper._stats.p95 };
    }
    return { min: mapper.range.min, max: mapper.range.max };
  };

  return mapper;
}

// ---- Private helpers ----

/**
 * Custom mode: interpolate between user-defined color stops.
 */
function getCustomColor(speed, config) {
  var colors = config.colors;
  var index = config.index;
  if (!colors || !colors.length) { return '#000000'; }
  if (colors.length === 1) { return colors[0]; }

  var t = clamp((speed - config.vmin) / (config.vmax - config.vmin), 0, 1);

  // Find surrounding stops
  var stops = index || colors.map(function (_, i) {
    return config.vmin + (config.vmax - config.vmin) * (i / (colors.length - 1));
  });

  if (t <= 0) { return colors[0]; }
  if (t >= 1) { return colors[colors.length - 1]; }

  // Map t through the stops
  var mappedValue = config.vmin + t * (config.vmax - config.vmin);

  for (var i = 0; i < stops.length - 1; i++) {
    if (mappedValue >= stops[i] && mappedValue <= stops[i + 1]) {
      var segT = (mappedValue - stops[i]) / (stops[i + 1] - stops[i]);
      return interpolateColor(colors[i], colors[i + 1], segT);
    }
  }

  // Fallback
  if (mappedValue < stops[0]) { return colors[0]; }
  return colors[colors.length - 1];
}

function interpolateColor(color1, color2, t) {
  var c1 = parseColor(color1);
  var c2 = parseColor(color2);
  if (!c1 || !c2) { return color1; }
  var r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  var g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  var b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function parseColor(str) {
  if (!str) { return null; }
  // hex
  if (str[0] === '#') {
    var h = str.slice(1);
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  // rgb(...)
  var m = str.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (m) {
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  }
  return null;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
