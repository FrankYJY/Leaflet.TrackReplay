/**
 * TimelineControl — progress bar with time display and time editing.
 *
 * Features:
 * - Draggable progress slider
 * - Current timestamp display (local time)
 * - Editable time field (double-click to edit, Enter to confirm)
 */

import { formatTimestamp, parseTimeString } from '../utils/TimeUtils.js';

/**
 * Fill a container with the timeline UI (also used by the combined ControlBar,
 * so the slider can live inside a shared box with the playback buttons).
 *
 * @param {HTMLElement} container
 * @param {Object} timeEngine
 * @param {Object} [options]
 * @returns {HTMLElement} the container
 */
export function fillTimelineControl(container, timeEngine, options) {
  options = options || {};

  // Time display (clickable to edit)
  var timeDisplay = L.DomUtil.create('div', 'tr-time-display', container);
  var timeLabel = L.DomUtil.create('span', 'tr-time-label', timeDisplay);
  timeLabel.textContent = '00:00:00';

  // Editable time input (hidden by default)
  var timeInput = L.DomUtil.create('input', 'tr-time-input', timeDisplay);
  timeInput.type = 'text';
  timeInput.style.display = 'none';
  timeInput.placeholder = 'HH:mm:ss or YYYY-MM-DD HH:mm:ss';

  // Show input on double-click
  timeLabel.ondblclick = function () {
    timeLabel.style.display = 'none';
    timeInput.style.display = '';
    timeInput.value = timeLabel.textContent;
    timeInput.focus();
    timeInput.select();
  };

  // Confirm on Enter
  timeInput.onkeydown = function (e) {
    if (e.keyCode === 13) { // Enter
      var parsed = parseTimeString(timeInput.value, timeEngine.getCurrentTime());
      if (parsed !== null) {
        timeEngine.seek(parsed);
      }
      timeInput.style.display = 'none';
      timeLabel.style.display = '';
    }
    if (e.keyCode === 27) { // Escape
      timeInput.style.display = 'none';
      timeLabel.style.display = '';
    }
  };

  // Blur to cancel
  timeInput.onblur = function () {
    timeInput.style.display = 'none';
    timeLabel.style.display = '';
  };

  // Progress slider
  var sliderContainer = L.DomUtil.create('div', 'tr-slider-container', container);
  var slider = L.DomUtil.create('input', 'tr-slider', sliderContainer);
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1000';
  slider.value = '0';
  slider.step = '1';

  var isDragging = false;

  slider.oninput = function () {
    var progress = parseInt(slider.value, 10) / 1000;
    timeEngine.seekByProgress(progress);
  };

  slider.onmousedown = function () {
    isDragging = true;
    if (timeEngine.getState() === 'playing') {
      timeEngine.pause();
    }
  };

  slider.onmouseup = function () {
    isDragging = false;
  };

  // Listen to time changes
  timeEngine.on('timechange', function (data) {
    if (!isDragging) {
      slider.value = Math.round(data.progress * 1000);
    }
    timeLabel.textContent = formatTimestamp(data.time, 'full');
  });

  timeEngine.on('tick', function (data) {
    if (!isDragging) {
      slider.value = Math.round(data.progress * 1000);
    }
    timeLabel.textContent = formatTimestamp(data.time, 'full');
  });

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);

  return container;
}

/**
 * Create the standalone timeline control (bottomleft by default).
 *
 * @param {Object} timeEngine - TimeEngine instance
 * @param {Object} [options]
 * @param {string} [options.position='bottomleft']
 * @returns {L.Control}
 */
export function createTimelineControl(timeEngine, options) {
  options = options || {};

  var TimelineCtrl = L.Control.extend({
    options: {
      position: options.position || 'bottomleft',
    },

    onAdd: function (/*map*/) {
      var container = L.DomUtil.create('div', 'leaflet-trackreplay-timeline');
      return fillTimelineControl(container, timeEngine, options);
    },
  });

  return new TimelineCtrl();
}
