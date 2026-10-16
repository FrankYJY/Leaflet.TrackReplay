/**
 * TimelineControl — progress bar with time display, time editing, and a date
 * line under it.
 *
 * Features:
 * - Draggable progress slider, with a tick at every midnight (day boundary)
 * - Current timestamp display — read in the *display time zone*
 * - Editable time field (double-click to edit, Enter to confirm)
 * - Date line: weekday · day N/M (when the data spans days) · the day's
 *   calendar entry (holidays / workdays, prefixed with the field it came
 *   from) · the display zone
 *
 * Everything time-related goes through one zone object (utils/TimeZone.js), so
 * the label, the editor, the day boundaries and the calendar lookups can never
 * disagree about which day it is.
 */

import { createZone } from '../utils/TimeZone.js';

var DEFAULT_LABELS = {
  /** Indexed by Date#getDay() — Sunday first. */
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  /** Prefix shown for an entry from calendar.holidays / calendar.workdays. */
  holidaysField: 'holidays',
  workdaysField: 'workdays',
};

var DEFAULT_MESSAGES = {
  dayOf: function (n, total) { return 'Day ' + n + '/' + total; },
};

var DAY_MS = 86400000;
/** Must match the slider thumb's width in the stylesheet. */
var THUMB_PX = 14;
/** Day ticks closer than this get thinned out. */
var MIN_TICK_GAP_PX = 6;

/**
 * Fill a container with the timeline UI (also used by the combined ControlBar,
 * so the slider can live inside a shared box with the playback buttons).
 *
 * @param {HTMLElement} container
 * @param {Object} timeEngine
 * @param {Object} [options]
 * @param {*} [options.timeZone='local'] - display zone: 'local' | hours offset
 *        | IANA name (see utils/TimeZone.js)
 * @param {Object} [options.calendar] - { holidays: {date: label}, workdays: {...} };
 *        dates are 'YYYY-MM-DD' keys in the display zone
 * @param {boolean} [options.showDateInfo=true] - show the date line
 * @param {Object} [options.labels] - see DEFAULT_LABELS
 * @param {Object} [options.messages] - see DEFAULT_MESSAGES
 * @returns {HTMLElement} the container (with `_trTimelineApi` attached)
 */
export function fillTimelineControl(container, timeEngine, options) {
  options = options || {};
  var labels = extend({}, DEFAULT_LABELS, options.labels || {});
  var messages = extend({}, DEFAULT_MESSAGES, options.messages || {});
  var zone = createZone(options.timeZone);
  var calendar = options.calendar || null;
  var calendarWarned = false;

  // ---- time display (clickable to edit) ----
  var timeDisplay = L.DomUtil.create('div', 'tr-time-display', container);
  var timeLabel = L.DomUtil.create('span', 'tr-time-label', timeDisplay);
  timeLabel.textContent = '00:00:00';

  var timeInput = L.DomUtil.create('input', 'tr-time-input', timeDisplay);
  timeInput.type = 'text';
  timeInput.style.display = 'none';
  timeInput.placeholder = 'HH:mm:ss or YYYY-MM-DD HH:mm:ss';

  timeLabel.ondblclick = function () {
    timeLabel.style.display = 'none';
    timeInput.style.display = '';
    timeInput.value = timeLabel.textContent;
    timeInput.focus();
    timeInput.select();
  };

  timeInput.onkeydown = function (e) {
    if (e.keyCode === 13) { // Enter — parsed in the display zone
      var parsed = zone.parse(timeInput.value, timeEngine.getCurrentTime());
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

  timeInput.onblur = function () {
    timeInput.style.display = 'none';
    timeLabel.style.display = '';
  };

  // ---- progress slider (+ the day-boundary ticks that sit on it) ----
  var sliderContainer = L.DomUtil.create('div', 'tr-slider-container', container);
  var slider = L.DomUtil.create('input', 'tr-slider', sliderContainer);
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1000';
  slider.value = '0';
  slider.step = '1';

  var ticksLayer = L.DomUtil.create('div', 'tr-dayticks', sliderContainer);

  var isDragging = false;

  slider.oninput = function () {
    timeEngine.seekByProgress(parseInt(slider.value, 10) / 1000);
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

  // ---- date line ----
  var dateInfo = null;
  if (options.showDateInfo !== false) {
    dateInfo = L.DomUtil.create('div', 'tr-tl-dateinfo', container);
  }

  // ---- range / calendar helpers ----

  function timeRange() {
    return (typeof timeEngine.getTimeRange === 'function')
      ? timeEngine.getTimeRange()
      : { start: 0, end: 0 };
  }

  /** 1-based index of the calendar day `time` falls on, within the data. */
  function dayIndex(time, range) {
    return Math.round((zone.startOfDay(time) - zone.startOfDay(range.start)) / DAY_MS) + 1;
  }

  /** How many calendar days the data spans (inclusive). */
  function dayTotal(range) {
    return Math.round((zone.startOfDay(range.end) - zone.startOfDay(range.start)) / DAY_MS) + 1;
  }

  /** The day's calendar entry, with the field it came from. */
  function calendarEntry(time) {
    if (!calendar) { return null; }
    var key = zone.dateKey(time);
    var work = calendar.workdays ? calendar.workdays[key] : null;
    var holiday = calendar.holidays ? calendar.holidays[key] : null;
    if (work && holiday && !calendarWarned) {
      calendarWarned = true;
      console.warn('TrackReplay: "' + key + '" is in both calendar.workdays and ' +
        'calendar.holidays — workdays wins');
    }
    if (work) { return { field: labels.workdaysField, value: work }; }
    if (holiday) { return { field: labels.holidaysField, value: holiday }; }
    return null;
  }

  function dateInfoText(time) {
    var range = timeRange();
    var p = zone.parts(time);
    var bits = [labels.weekdays[p.weekday] || ''];

    var total = (range.end > range.start) ? dayTotal(range) : 1;
    if (total > 1) {
      bits.push(messages.dayOf(dayIndex(time, range), total));
    }

    var entry = calendarEntry(time);
    if (entry) {
      bits.push(entry.field);
      bits.push(String(entry.value));
    }

    bits.push(zone.label());
    return bits.join(' · ');
  }

  var lastDateInfo = null;

  /** Only touches the DOM when the line actually changes (it is updated per frame). */
  function updateDateInfo(time) {
    if (!dateInfo) { return; }
    var text = dateInfoText(time);
    if (text === lastDateInfo) { return; }
    lastDateInfo = text;
    dateInfo.textContent = text;
  }

  /** One tick per midnight inside the range, thinned out when they crowd. */
  function renderTicks() {
    while (ticksLayer.firstChild) {
      ticksLayer.removeChild(ticksLayer.firstChild);
    }
    var range = timeRange();
    if (!(range.end > range.start)) { return; }
    if (dayTotal(range) < 2) { return; }

    var stamps = [];
    var t = zone.startOfDay(range.start);
    if (t <= range.start) { t = zone.startOfDay(t + 26 * 3600000); } // +26h: past any DST day
    while (t < range.end) {
      stamps.push(t);
      t = zone.startOfDay(t + 26 * 3600000);
    }
    if (!stamps.length) { return; }

    // Positions are percentages in a calc(), so they survive a resize; only
    // the thinning step has to guess the width.
    var width = slider.clientWidth || 300;
    var gap = width / (stamps.length + 1);
    var step = gap < MIN_TICK_GAP_PX ? Math.ceil(MIN_TICK_GAP_PX / gap) : 1;

    for (var i = 0; i < stamps.length; i += step) {
      var pct = (stamps[i] - range.start) / (range.end - range.start);
      var tick = L.DomUtil.create('span', 'tr-daytick', ticksLayer);
      tick.style.left = 'calc(' + (THUMB_PX / 2) + 'px + (100% - ' +
        THUMB_PX + 'px) * ' + pct.toFixed(6) + ')';
    }
  }

  var ticksRendered = false;
  function ensureTicks() {
    if (ticksRendered) { return; }
    ticksRendered = true;
    renderTicks();
  }

  // ---- engine wiring ----

  function renderTime(data) {
    if (!isDragging) {
      slider.value = Math.round(data.progress * 1000);
    }
    timeLabel.textContent = zone.format(data.time, 'full');
    updateDateInfo(data.time);
    ensureTicks();
  }

  timeEngine.on('timechange', renderTime);
  timeEngine.on('tick', renderTime);

  // First paint. Without it the label sits at '00:00:00' until the user
  // interacts, and the ticks never appear at all (their thinning measures the
  // slider, which has no width until the control is in the DOM) — so render
  // once on the next task, after insertion.
  setTimeout(function () {
    ticksRendered = false;
    renderTime({
      time: timeEngine.getCurrentTime(),
      progress: timeEngine.getProgress(),
    });
  }, 0);

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);

  // ---- runtime knobs (used by the session's setTimeZone / setCalendar) ----

  container._trTimelineApi = {
    setTimeZone: function (tz) {
      zone = createZone(tz);
      lastDateInfo = null;
      ticksRendered = false;
      renderTime({ time: timeEngine.getCurrentTime(), progress: timeEngine.getProgress() });
    },
    setCalendar: function (table) {
      calendar = table || null;
      calendarWarned = false;
      lastDateInfo = null;
      updateDateInfo(timeEngine.getCurrentTime());
    },
    getZoneLabel: function () { return zone.label(); },
    refresh: function () {
      lastDateInfo = null;
      ticksRendered = false;
      renderTime({ time: timeEngine.getCurrentTime(), progress: timeEngine.getProgress() });
    },
  };

  return container;
}

/**
 * Create the standalone timeline control (bottomleft by default).
 *
 * @param {Object} timeEngine - TimeEngine instance
 * @param {Object} [options] - see fillTimelineControl
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

function extend(target) {
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (!src) { continue; }
    var keys = Object.keys(src);
    for (var j = 0; j < keys.length; j++) {
      target[keys[j]] = src[keys[j]];
    }
  }
  return target;
}
