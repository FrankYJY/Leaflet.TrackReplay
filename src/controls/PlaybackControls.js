/**
 * PlaybackControls — video-player-style playback control bar.
 *
 * Provides: play/pause, stop, speed selector, loop toggle.
 * Integrates with TimeEngine events.
 */

import { formatSpeedLabel } from '../utils/TimeUtils.js';

/**
 * Default speed ladder: small multipliers for detailed inspection, then
 * time-compression presets (1s = 1min / 10min / 1h) for long tracks.
 */
var DEFAULT_SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 60, 600, 3600];

/**
 * Fill a container with the playback buttons (also used by the combined
 * ControlBar, so the buttons can live inside a shared box).
 *
 * @param {HTMLElement} container
 * @param {Object} timeEngine
 * @param {Object} [options]
 * @param {number[]} [options.speedOptions] - speed ladder (defaults to
 *        [0.25, 0.5, 1, 2, 4, 8, 60, 600, 3600])
 * @param {Function} [options.speedLabel] - fn(speed) => label (defaults to
 *        "8×" below 60× and "1s = 1min" style at/above 60×)
 * @returns {HTMLElement} the container
 */
export function fillPlaybackControls(container, timeEngine, options) {
  options = options || {};
  var speedOptions = options.speedOptions || DEFAULT_SPEED_OPTIONS;
  var labelFor = options.speedLabel || formatSpeedLabel;
  var showLoop = options.showLoop !== false;

  // Stop button
  var stopBtn = L.DomUtil.create('button', 'tr-btn tr-btn-stop', container);
  stopBtn.title = 'Stop';
  stopBtn.innerHTML = '⏹';
  stopBtn.onclick = function (e) {
    e.preventDefault();
    timeEngine.stop();
  };

  // Play/Pause button
  var playBtn = L.DomUtil.create('button', 'tr-btn tr-btn-play', container);
  playBtn.title = 'Play / Pause';
  playBtn.innerHTML = '▶';
  playBtn.onclick = function (e) {
    e.preventDefault();
    var state = timeEngine.getState();
    if (state === 'playing') {
      timeEngine.pause();
    } else {
      timeEngine.play();
    }
  };

  // Speed selector
  var speedLabel = L.DomUtil.create('span', 'tr-speed-label', container);
  speedLabel.textContent = 'Speed: ';

  var speedSelect = L.DomUtil.create('select', 'tr-speed-select', container);
  for (var i = 0; i < speedOptions.length; i++) {
    var opt = L.DomUtil.create('option', '', speedSelect);
    opt.value = speedOptions[i];
    opt.textContent = labelFor(speedOptions[i]);
    if (speedOptions[i] === (timeEngine.getSpeed() || 1)) {
      opt.selected = true;
    }
  }
  speedSelect.onchange = function () {
    timeEngine.setSpeed(parseFloat(speedSelect.value));
  };

  // Loop toggle
  if (showLoop) {
    var loopLabel = L.DomUtil.create('label', 'tr-loop-label', container);
    var loopCheck = L.DomUtil.create('input', 'tr-loop-check', loopLabel);
    loopCheck.type = 'checkbox';
    loopCheck.checked = timeEngine.getLoop();
    loopCheck.onchange = function () {
      timeEngine.setLoop(loopCheck.checked);
    };
    loopLabel.appendChild(document.createTextNode(' Loop'));
  }

  // Listen to engine state changes to update UI
  timeEngine.on('start', function () {
    playBtn.innerHTML = '⏸';
    playBtn.title = 'Pause';
  });
  timeEngine.on('pause', function () {
    playBtn.innerHTML = '▶';
    playBtn.title = 'Play';
  });
  timeEngine.on('stop', function () {
    playBtn.innerHTML = '▶';
    playBtn.title = 'Play';
  });
  timeEngine.on('finished', function () {
    playBtn.innerHTML = '▶';
    playBtn.title = 'Play';
  });

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);

  return container;
}

/**
 * Create the standalone playback control (topleft by default).
 *
 * @param {Object} timeEngine
 * @param {Object} [options]
 * @param {number[]} [options.speedOptions] - available speed multipliers
 * @param {boolean} [options.showLoop=true]
 * @param {string} [options.position='topleft']
 * @returns {L.Control}
 */
export function createPlaybackControls(timeEngine, options) {
  options = options || {};

  var PlaybackControl = L.Control.extend({
    options: {
      position: options.position || 'topleft',
    },

    onAdd: function (/*map*/) {
      var container = L.DomUtil.create('div', 'leaflet-trackreplay-controls');
      return fillPlaybackControls(container, timeEngine, options);
    },
  });

  return new PlaybackControl();
}
