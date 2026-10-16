/**
 * EventBus — a minimal publish/subscribe used by the TrackReplay session.
 *
 * The playback events are forwarded into this bus from the (per-build) time
 * engine, so the session can hand out ONE stable `on()`/`off()` pair that
 * survives every internal rebuild: dataset changes recreate the time engine,
 * but listeners registered on the bus keep working untouched.
 */

/**
 * Create an event bus.
 *
 * @returns {Object} { on, off, emit, clear }
 */
export function createEventBus() {
  var listeners = {};

  return {
    /**
     * Register a listener.
     * @param {string} event
     * @param {Function} fn
     */
    on: function (event, fn) {
      if (!listeners[event]) { listeners[event] = []; }
      listeners[event].push(fn);
    },

    /**
     * Remove a listener.
     * @param {string} event
     * @param {Function} fn
     */
    off: function (event, fn) {
      var arr = listeners[event];
      if (!arr) { return; }
      var idx = arr.indexOf(fn);
      if (idx >= 0) { arr.splice(idx, 1); }
    },

    /**
     * Emit to a snapshot of the listener list (so listeners may
     * register/unregister from inside a handler).
     * @param {string} event
     * @param {Object} [data]
     */
    emit: function (event, data) {
      var arr = listeners[event];
      if (!arr || !arr.length) { return; }
      var copy = arr.slice();
      for (var i = 0; i < copy.length; i++) {
        copy[i](data);
      }
    },

    /** Drop every listener. */
    clear: function () {
      listeners = {};
    },
  };
}
