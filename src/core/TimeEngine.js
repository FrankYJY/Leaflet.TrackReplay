/**
 * Shared time-axis engine for Leaflet.TrackReplay.
 *
 * Drives playback across all layers. Emits events via a simple pub/sub.
 * Supports play/pause/stop/seek with configurable speed multiplier.
 */

/**
 * Create a TimeEngine instance.
 *
 * @param {Object} options
 * @param {number} options.tickLen      - milliseconds between ticks (default 250)
 * @param {number} options.speed        - playback speed multiplier (default 1)
 * @param {boolean} options.loop        - auto-restart when finished (default false)
 * @param {number} options.startTime    - initial time (ms, default: auto from data)
 * @param {number} options.endTime      - end time (ms, default: auto from data)
 */
export function createTimeEngine(options) {
  options = options || {};

  var engine = {
    _tickLen: options.tickLen || 250,
    // Floor for the tick interval: without it, high speeds would drive the
    // tick rate to hundreds/thousands per second. Time advances by real
    // elapsed × speed, so a longer interval does NOT change the rate — it
    // only means a bigger simulated step per update.
    _minTickMs: options.minTickMs || 16,
    _speed: options.speed || 1,
    _loop: !!options.loop,
    _startTime: options.startTime || 0,
    _endTime: options.endTime || 0,
    _currentTime: options.startTime || 0,
    _state: 'stopped', // 'stopped' | 'playing' | 'paused'

    _timerId: null,
    _lastRealTime: 0,
    _listeners: {},
  };

  /**
   * Register an event listener.
   * @param {string} event
   * @param {Function} fn
   */
  engine.on = function (event, fn) {
    if (!engine._listeners[event]) {
      engine._listeners[event] = [];
    }
    engine._listeners[event].push(fn);
  };

  /**
   * Remove an event listener.
   * @param {string} event
   * @param {Function} fn
   */
  engine.off = function (event, fn) {
    var arr = engine._listeners[event];
    if (!arr) { return; }
    var idx = arr.indexOf(fn);
    if (idx >= 0) { arr.splice(idx, 1); }
  };

  /**
   * Emit an event to all listeners.
   * @param {string} event
   * @param {Object} data
   */
  engine._emit = function (event, data) {
    var arr = engine._listeners[event];
    if (!arr) { return; }
    for (var i = 0; i < arr.length; i++) {
      arr[i](data);
    }
  };

  /**
   * Set the time range from data.
   * @param {number} start - ms
   * @param {number} end - ms
   */
  engine.setTimeRange = function (start, end) {
    engine._startTime = start;
    engine._endTime = end;
    if (engine._state === 'stopped') {
      engine._currentTime = start;
    }
  };

  /**
   * Get the time range the engine was given (ms).
   * @returns {{start: number, end: number}}
   */
  engine.getTimeRange = function () {
    return { start: engine._startTime, end: engine._endTime };
  };

  /**
   * Get the current progress as a fraction 0-1.
   * @returns {number}
   */
  engine.getProgress = function () {
    var range = engine._endTime - engine._startTime;
    if (range <= 0) { return 0; }
    return clamp((engine._currentTime - engine._startTime) / range, 0, 1);
  };

  /**
   * Get current time in ms.
   * @returns {number}
   */
  engine.getCurrentTime = function () {
    return engine._currentTime;
  };

  /**
   * Get current playback state.
   * @returns {string}
   */
  engine.getState = function () {
    return engine._state;
  };

  /**
   * Start or resume playback.
   */
  engine.play = function () {
    if (engine._state === 'playing') { return; }
    if (engine._currentTime >= engine._endTime) {
      // At end — restart from beginning
      engine._currentTime = engine._startTime;
    }
    engine._state = 'playing';
    engine._lastRealTime = Date.now();
    engine._emit('start', { time: engine._currentTime });
    engine._tick();
    engine._scheduleNext();
  };

  /**
   * Pause playback (keep current time).
   */
  engine.pause = function () {
    if (engine._state !== 'playing') { return; }
    engine._state = 'paused';
    engine._clearTimer();
    engine._emit('pause', { time: engine._currentTime });
  };

  /**
   * Stop playback (reset to start).
   */
  engine.stop = function () {
    engine._state = 'stopped';
    engine._clearTimer();
    engine._currentTime = engine._startTime;
    engine._emit('stop', { time: engine._currentTime });
    engine._emit('timechange', { time: engine._currentTime, progress: 0 });
  };

  /**
   * Seek to a specific time.
   * @param {number} timeMs
   */
  engine.seek = function (timeMs) {
    var oldTime = engine._currentTime;
    engine._currentTime = clamp(timeMs, engine._startTime, engine._endTime);
    engine._emit('timechange', {
      time: engine._currentTime,
      progress: engine.getProgress(),
      fromTime: oldTime,
    });
  };

  /**
   * Seek by progress fraction.
   * @param {number} progress - 0 to 1
   */
  engine.seekByProgress = function (progress) {
    var t = clamp(progress, 0, 1);
    return engine.seek(engine._startTime + t * (engine._endTime - engine._startTime));
  };

  /**
   * Set playback speed.
   * @param {number} speed
   */
  engine.setSpeed = function (speed) {
    engine._speed = speed;
    engine._emit('speedchange', { speed: speed });
  };

  /**
   * Get playback speed.
   * @returns {number}
   */
  engine.getSpeed = function () {
    return engine._speed;
  };

  /**
   * Toggle loop mode.
   * @param {boolean} loop
   */
  engine.setLoop = function (loop) {
    engine._loop = !!loop;
  };

  /**
   * Get loop mode.
   * @returns {boolean}
   */
  engine.getLoop = function () {
    return engine._loop;
  };

  /**
   * Destroy the engine, clearing all timers and listeners.
   */
  engine.destroy = function () {
    engine._clearTimer();
    engine._listeners = {};
  };

  // ---- Private ----

  engine._tick = function () {
    engine._emit('tick', {
      time: engine._currentTime,
      progress: engine.getProgress(),
    });
  };

  engine._scheduleNext = function () {
    if (engine._state !== 'playing') { return; }

    var effectiveTick = Math.max(engine._minTickMs, engine._tickLen / engine._speed);
    engine._timerId = setTimeout(function () {
      if (engine._state !== 'playing') { return; }

      // Advance time based on real elapsed
      var now = Date.now();
      var realElapsed = now - engine._lastRealTime;
      engine._lastRealTime = now;
      var simElapsed = realElapsed * engine._speed;

      engine._currentTime += simElapsed;

      if (engine._currentTime >= engine._endTime) {
        engine._currentTime = engine._endTime;
        engine._tick();
        engine._emit('finished', { time: engine._currentTime });

        if (engine._loop) {
          engine._currentTime = engine._startTime;
          engine._lastRealTime = Date.now();
          engine._emit('start', { time: engine._currentTime });
          engine._scheduleNext();
        } else {
          engine._state = 'paused';
          engine._emit('pause', { time: engine._currentTime });
        }
        return;
      }

      engine._tick();
      engine._scheduleNext();
    }, effectiveTick);
  };

  engine._clearTimer = function () {
    if (engine._timerId) {
      clearTimeout(engine._timerId);
      engine._timerId = null;
    }
  };

  return engine;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
