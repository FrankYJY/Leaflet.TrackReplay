/**
 * Leaflet.TrackReplay - A GPS track replay plugin for Leaflet
 *
 * Replays GPS track data on a Leaflet map with customizable playback
 * controls, speed adjustment, and rich event hooks.
 *
 * @license MIT
 * @author  Frank Yao
 * @version 0.1.0
 */

(function (factory, root) {

  // Module loading boilerplate — supports AMD, CommonJS, and browser globals
  if (typeof define === 'function' && define.amd) {
    define(['leaflet'], factory);
  } else if (typeof module === 'object' && module.exports) {
    factory(require('leaflet'));
  } else {
    // Attach to the global L namespace
    if (root.L) {
      factory(root.L);
      root.L.TrackReplay = root.L.TrackReplay;
    }
  }

}(function (L, root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var DEFAULT_OPTIONS = {
    // --- Control positioning (REQUIRED — inherited defaults are fragile) ------
    position: 'topright',

    // --- Track data ----------------------------------------------------------
    // Array of track points: [{lat, lng, time?}, ...]
    // `time` is a UNIX timestamp (ms). If omitted, points are evenly spaced.
    trackData: [],

    // --- Track appearance ----------------------------------------------------
    trackStyle: {
      color: '#3388ff',
      weight: 3,
      opacity: 0.7,
    },
    // Style for the portion of track already traversed
    elapsedStyle: {
      color: '#ff4444',
      weight: 4,
      opacity: 0.9,
    },

    // --- Marker --------------------------------------------------------------
    // Custom icon for the moving marker (L.Icon or L.DivIcon instance)
    markerIcon: null,
    // Whether to auto-rotate the marker to face the direction of movement
    autoRotate: true,

    // --- Playback ------------------------------------------------------------
    // Playback speed multiplier (1 = real-time, 2 = 2x, 60 = 1 minute/sec, etc.)
    speed: 1,
    // Loop playback when the track ends
    loop: false,
    // Start playing automatically after initialization
    autoPlay: false,
    // Animation frame interval in milliseconds (lower = smoother but more CPU)
    tickInterval: 42,   // ~24 fps

    // --- View ----------------------------------------------------------------
    // Fit the map view to the track bounds on init
    fitBounds: true,
    // Padding when fitting bounds (in pixels)
    fitBoundsPadding: [30, 30],
    // Max zoom level when fitting bounds
    fitBoundsMaxZoom: 16,
  };

  // ---------------------------------------------------------------------------
  // Plugin class
  // ---------------------------------------------------------------------------

  /**
   * L.TrackReplay
   *
   * Extends L.Control so that playback UI is rendered as a standard Leaflet
   * control.  The track and moving marker are managed internally as map layers.
   *
   * @class  L.TrackReplay
   * @extends L.Control
   *
   * @example
   *   var replay = L.trackReplay(trackPoints, { speed: 10 }).addTo(map);
   *   replay.start();
   */
  var TrackReplay = L.Control.extend(/** @lends L.TrackReplay.prototype */ {

    // ---- Mixins ---------------------------------------------------------------
    // L.Control does NOT include L.Evented — we need event methods (on/off/fire)
    includes: (L.Evented && L.Evented.prototype) ? [L.Evented.prototype] : [],

    // ---- L.Control options --------------------------------------------------
    options: DEFAULT_OPTIONS,

    /**
     * @constructs
     * @param {Array}  trackData - Array of {lat, lng, time?} objects.
     * @param {Object} options   - Plugin options (merged with defaults).
     */
    initialize: function (trackData, options) {
      // Allow calling as L.trackReplay(data, opts) — first arg is trackData
      if (Array.isArray(trackData)) {
        options = options || {};
        options.trackData = trackData;
      } else {
        // Called with only an options object: L.trackReplay(opts)
        options = trackData || {};
      }

      L.setOptions(this, options);

      // Internal state --------------------------------------------------------
      this._trackLayerGroup = null;    // L.LayerGroup holding track + marker
      this._elapsedLine = null;        // L.Polyline — traversed portion
      this._remainingLine = null;      // L.Polyline — remaining portion
      this._movingMarker = null;       // L.Marker — current position
      this._segments = [];             // Precomputed segments for interpolation
      this._totalDistance = 0;        // Total track distance in meters
      this._elapsedDistance = 0;      // Distance traversed so far
      this._elapsedTime = 0;          // Real-world time elapsed (ms)
      this._startTime = null;         // performance.now() when playback started
      this._lastTick = null;          // Last animation-frame timestamp
      this._animFrameId = null;       // requestAnimationFrame id
      this._isPlaying = false;
      this._isFinished = false;
      this._currentIndex = 0;         // Index into _segments
      this._currentBearing = 0;       // Current direction (degrees)

      // Container element reference (set in onAdd)
      this._container = null;
    },

    // ---- L.Control lifecycle ------------------------------------------------

    onAdd: function (map) {
      this._map = map;

      // Build control UI
      var container = this._container = L.DomUtil.create(
        'div', 'leaflet-control leaflet-trackreplay-control'
      );

      // Prevent map interaction when clicking the control
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      // Build control DOM
      this._buildUI(container);

      // Initialize map layers
      this._initLayers();

      // Precompute segments
      if (this.options.trackData && this.options.trackData.length) {
        this._computeSegments(this.options.trackData);
        this._drawTrack();
      }

      // Fit bounds if requested
      if (this.options.fitBounds && this.options.trackData.length > 1) {
        this._fitTrackBounds();
      }

      // Auto-play if requested
      if (this.options.autoPlay) {
        this.start();
      }

      return container;
    },

    onRemove: function (/* map */) {
      this.stop();
      this._removeLayers();
      this._map = null;
    },

    // ---- Public API ---------------------------------------------------------

    /**
     * Start or resume playback.
     * @fires L.TrackReplay#start
     * @returns {L.TrackReplay} this
     */
    start: function () {
      if (!this._map) { return this; }
      if (this._isPlaying) { return this; }
      if (this._isFinished) { this.reset(); }

      this._isPlaying = true;
      this._startTime = performance.now() - this._elapsedTime;
      this._lastTick = this._startTime;

      /**
       * Fired when playback starts or resumes.
       * @event L.TrackReplay#start
       */
      this.fire('start', { elapsed: this._elapsedTime });

      this._tick();
      this._updatePlayButton();

      return this;
    },

    /**
     * Pause playback.  start() will resume from the current position.
     * @fires L.TrackReplay#pause
     * @returns {L.TrackReplay} this
     */
    pause: function () {
      if (!this._isPlaying) { return this; }

      this._isPlaying = false;
      if (this._animFrameId) {
        cancelAnimationFrame(this._animFrameId);
        this._animFrameId = null;
      }

      /**
       * Fired when playback is paused.
       * @event L.TrackReplay#pause
       */
      this.fire('pause', { elapsed: this._elapsedTime });

      this._updatePlayButton();

      return this;
    },

    /**
     * Stop playback and reset to the beginning.
     * @fires L.TrackReplay#stop
     * @returns {L.TrackReplay} this
     */
    stop: function () {
      this.pause();
      this.reset();

      /**
       * Fired when playback is stopped.
       * @event L.TrackReplay#stop
       */
      this.fire('stop');

      return this;
    },

    /**
     * Reset to the start of the track without changing play state.
     * @fires L.TrackReplay#reset
     * @returns {L.TrackReplay} this
     */
    reset: function () {
      var wasPlaying = this._isPlaying;
      if (wasPlaying) { this.pause(); }

      this._elapsedTime = 0;
      this._elapsedDistance = 0;
      this._currentIndex = 0;
      this._isFinished = false;
      this._currentBearing = 0;
      this._startTime = null;
      this._lastTick = null;

      this._resetLayers();
      this._updateProgress();

      /**
       * Fired when the track is reset to its starting position.
       * @event L.TrackReplay#reset
       */
      this.fire('reset');

      if (wasPlaying) { this.start(); }

      return this;
    },

    /**
     * Set playback speed.
     * @param {number} multiplier - Speed multiplier (1 = real-time).
     * @returns {L.TrackReplay} this
     */
    setSpeed: function (multiplier) {
      this.options.speed = Number(multiplier) || 1;

      // Adjust startTime so current elapsedTime stays the same
      if (this._isPlaying) {
        this._startTime = performance.now() - this._elapsedTime;
        this._lastTick = performance.now();
      }

      /**
       * Fired when speed changes.
       * @event L.TrackReplay#speedchange
       */
      this.fire('speedchange', { speed: this.options.speed });

      return this;
    },

    /**
     * Jump to a specific position on the track.
     * @param {number} fraction - Value 0–1 representing position along the track.
     * @fires L.TrackReplay#seek
     * @returns {L.TrackReplay} this
     */
    seek: function (fraction) {
      fraction = Math.max(0, Math.min(1, Number(fraction)));

      this._elapsedDistance = this._totalDistance * fraction;
      this._elapsedTime = this._distanceToTime(this._elapsedDistance);
      this._currentIndex = this._findSegmentIndex(this._elapsedDistance);
      this._isFinished = fraction >= 1;

      if (this._isPlaying) {
        this._startTime = performance.now() - this._elapsedTime;
        this._lastTick = performance.now();
      }

      this._updateMarkerPosition();
      this._updateProgress();

      /**
       * Fired when seeking to a position on the track.
       * @event L.TrackReplay#seek
       */
      this.fire('seek', { fraction: fraction });

      return this;
    },

    /**
     * Replace the track data and optionally reset playback.
     * @param {Array}   newData       - New array of track points.
     * @param {boolean} [reset=true]  - Whether to reset playback state.
     * @returns {L.TrackReplay} this
     */
    setTrackData: function (newData, reset) {
      if (reset !== false) { reset = true; }
      var wasPlaying = this._isPlaying;
      if (wasPlaying) { this.pause(); }

      this.options.trackData = newData || [];
      this._computeSegments(this.options.trackData);
      this._drawTrack();

      if (this.options.fitBounds && this.options.trackData.length > 1) {
        this._fitTrackBounds();
      }

      if (reset) { this.reset(); }
      if (wasPlaying) { this.start(); }

      return this;
    },

    /**
     * Whether playback is currently in progress.
     * @returns {boolean}
     */
    isPlaying: function () {
      return this._isPlaying;
    },

    /**
     * Whether playback has finished (reached the end of the track).
     * @returns {boolean}
     */
    isFinished: function () {
      return this._isFinished;
    },

    /**
     * Get the current progress as a fraction (0–1) of the total track.
     * @returns {number}
     */
    getProgress: function () {
      if (this._totalDistance === 0) { return 0; }
      return Math.min(1, this._elapsedDistance / this._totalDistance);
    },

    /**
     * Get the current interpolated position on the map.
     * @returns {L.LatLng|null}
     */
    getLatLng: function () {
      if (this._movingMarker) {
        return this._movingMarker.getLatLng();
      }
      if (this.options.trackData.length) {
        var pt = this.options.trackData[0];
        return L.latLng(pt.lat, pt.lng);
      }
      return null;
    },

    // ---- Internal: segment computation --------------------------------------

    /**
     * Precompute distance/time segments for efficient playback interpolation.
     * @private
     */
    _computeSegments: function (points) {
      this._segments = [];
      this._totalDistance = 0;

      if (!points || points.length < 2) { return; }

      var cumulative = 0;
      var pt, next, latlng, nextLatlng;

      for (var i = 0; i < points.length - 1; i++) {
        pt = points[i];
        next = points[i + 1];
        latlng = L.latLng(pt.lat, pt.lng);
        nextLatlng = L.latLng(next.lat, next.lng);
        var segDist = latlng.distanceTo(nextLatlng);

        var seg = {
          start: i,
          end: i + 1,
          startLatLng: latlng,
          endLatLng: nextLatlng,
          distance: segDist,
          cumulativeStart: cumulative,
          cumulativeEnd: cumulative + segDist,
        };

        // Time delta (real-world ms between points)
        if (pt.time != null && next.time != null) {
          seg.duration = Math.abs(next.time - pt.time);
        } else {
          seg.duration = null;
        }

        this._segments.push(seg);
        cumulative += segDist;
      }

      this._totalDistance = cumulative;
    },

    // ---- Internal: map layers -----------------------------------------------

    _initLayers: function () {
      this._trackLayerGroup = L.layerGroup().addTo(this._map);
    },

    _removeLayers: function () {
      if (this._trackLayerGroup) {
        this._map.removeLayer(this._trackLayerGroup);
        this._trackLayerGroup = null;
      }
    },

    _drawTrack: function () {
      if (!this._trackLayerGroup) { return; }
      this._trackLayerGroup.clearLayers();

      var points = this.options.trackData;
      if (!points || points.length === 0) { return; }

      var latlngs = points.map(function (p) { return L.latLng(p.lat, p.lng); });

      // Full track (remaining / background)
      this._remainingLine = L.polyline(latlngs, this.options.trackStyle);
      this._trackLayerGroup.addLayer(this._remainingLine);

      // Elapsed portion (initially empty polyline)
      this._elapsedLine = L.polyline([], this.options.elapsedStyle);
      this._trackLayerGroup.addLayer(this._elapsedLine);

      // Moving marker
      var icon = this.options.markerIcon || this._defaultIcon();
      this._movingMarker = L.marker(latlngs[0], { icon: icon });
      this._trackLayerGroup.addLayer(this._movingMarker);
    },

    _resetLayers: function () {
      if (this._elapsedLine) {
        this._elapsedLine.setLatLngs([]);
      }
      if (this._movingMarker && this.options.trackData.length) {
        var first = this.options.trackData[0];
        var pos = L.latLng(first.lat, first.lng);
        this._movingMarker.setLatLng(pos);
        if (this.options.autoRotate) {
          var iconEl = this._movingMarker._icon;
          if (iconEl) {
            iconEl.style.transform = '';
            iconEl.style.transformOrigin = '';
          }
        }
      }
      this._updateProgress();
    },

    _fitTrackBounds: function () {
      var latlngs = this.options.trackData.map(function (p) {
        return L.latLng(p.lat, p.lng);
      });
      var bounds = L.latLngBounds(latlngs);
      this._map.fitBounds(bounds, {
        padding: this.options.fitBoundsPadding,
        maxZoom: this.options.fitBoundsMaxZoom,
      });
    },

    // ---- Internal: animation loop -------------------------------------------

    _tick: function () {
      var self = this;

      if (!this._isPlaying) { return; }

      this._animFrameId = requestAnimationFrame(function () {
        self._tick();
      });

      var now = performance.now();
      var realDelta = now - this._lastTick;
      this._lastTick = now;

      // Advance elapsed time (scaled by playback speed)
      this._elapsedTime += realDelta * this.options.speed;

      // Convert elapsed time → distance along track
      this._elapsedDistance = this._timeToDistance(this._elapsedTime);

      // Check if we've reached the end
      if (this._elapsedDistance >= this._totalDistance) {
        this._elapsedDistance = this._totalDistance;

        if (this.options.loop) {
          this._elapsedTime = 0;
          this._elapsedDistance = 0;
          this._currentIndex = 0;
        } else {
          this._isFinished = true;
          this.pause();
        }

        /**
         * Fired when playback reaches the end of the track.
         * @event L.TrackReplay#finish
         */
        this.fire('finish');
      }

      this._updateMarkerPosition();
      this._updateProgress();
    },

    // ---- Internal: position helpers -----------------------------------------

    /**
     * Convert elapsed time to distance along the track.
     * Uses per-segment real-world durations when available; falls back to
     * uniform-speed interpolation.
     * @private
     */
    _timeToDistance: function (timeMs) {
      var remaining = timeMs;
      for (var i = 0; i < this._segments.length; i++) {
        var seg = this._segments[i];
        var segTime = seg.duration || (seg.distance / this._totalDistance * this._estimatedTotalDuration());
        if (remaining <= segTime) {
          return seg.cumulativeStart + (remaining / segTime) * seg.distance;
        }
        remaining -= segTime;
      }
      // Past the end
      return this._totalDistance;
    },

    /**
     * Convert distance along the track to elapsed time.
     * Inverse of _timeToDistance.
     * @private
     */
    _distanceToTime: function (dist) {
      var remaining = dist;
      for (var i = 0; i < this._segments.length; i++) {
        var seg = this._segments[i];
        if (remaining <= seg.distance) {
          var fraction = seg.distance > 0 ? remaining / seg.distance : 0;
          var segTime = seg.duration || (seg.distance / this._totalDistance * this._estimatedTotalDuration());
          return this._segments[i].cumulativeStart > 0 ?
            this._distanceToTime(this._segments[i].cumulativeStart) + fraction * segTime :
            fraction * segTime;
        }
        remaining -= seg.distance;
      }
      return this._estimatedTotalDuration();
    },

    _estimatedTotalDuration: function () {
      var total = 0;
      for (var i = 0; i < this._segments.length; i++) {
        total += this._segments[i].duration || 0;
      }
      if (total > 0) { return total; }
      // Fallback: assume track was recorded over 1 hour
      return 3600000;
    },

    _findSegmentIndex: function (dist) {
      for (var i = 0; i < this._segments.length; i++) {
        if (dist <= this._segments[i].cumulativeEnd) { return i; }
      }
      return this._segments.length - 1;
    },

    /**
     * Interpolate the marker position along the current segment.
     * @private
     */
    _updateMarkerPosition: function () {
      if (!this._movingMarker || this._segments.length === 0) { return; }

      var idx = this._findSegmentIndex(this._elapsedDistance);
      this._currentIndex = idx;

      var seg = this._segments[idx];
      var segProgress = (this._elapsedDistance - seg.cumulativeStart) / (seg.distance || 1);
      segProgress = Math.max(0, Math.min(1, segProgress));

      var lat = seg.startLatLng.lat + (seg.endLatLng.lat - seg.startLatLng.lat) * segProgress;
      var lng = seg.startLatLng.lng + (seg.endLatLng.lng - seg.startLatLng.lng) * segProgress;
      var pos = L.latLng(lat, lng);

      this._movingMarker.setLatLng(pos);

      // --- Update elapsed polyline ------------------------------------------
      // Build the traversed path: all original points up to the current
      // segment, then append the interpolated current position.
      if (this._elapsedLine && this.options.trackData.length) {
        var elapsedLatLngs = [];
        var pts = this.options.trackData;
        var lastIdx = Math.min(seg.start, pts.length - 1);
        for (var i = 0; i <= lastIdx; i++) {
          elapsedLatLngs.push(L.latLng(pts[i].lat, pts[i].lng));
        }
        // Append interpolated position (avoid duplicating if exactly on a point)
        if (segProgress > 0 && segProgress < 1) {
          elapsedLatLngs.push(pos);
        }
        this._elapsedLine.setLatLngs(elapsedLatLngs);
      }

      // --- Auto-rotate marker via CSS transform (no external plugin needed) --
      if (this.options.autoRotate) {
        this._currentBearing = this._computeBearing(seg.startLatLng, seg.endLatLng);
        var iconEl = this._movingMarker._icon;
        if (iconEl) {
          iconEl.style.transform = 'rotate(' + this._currentBearing + 'deg)';
          iconEl.style.transformOrigin = 'center center';
        }
      }
    },

    _computeBearing: function (a, b) {
      var lat1 = a.lat * Math.PI / 180;
      var lat2 = b.lat * Math.PI / 180;
      var dLon = (b.lng - a.lng) * Math.PI / 180;
      var y = Math.sin(dLon) * Math.cos(lat2);
      var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
      return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    },

    // ---- Internal: UI -------------------------------------------------------

    _buildUI: function (container) {
      var self = this;

      // Play / Pause button
      this._playBtn = L.DomUtil.create('a', 'leaflet-trackreplay-btn leaflet-trackreplay-play', container);
      this._playBtn.href = '#';
      this._playBtn.title = 'Play';
      this._playBtn.setAttribute('role', 'button');
      this._playBtn.setAttribute('aria-label', 'Play');
      L.DomEvent.on(this._playBtn, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        if (self._isPlaying) { self.pause(); } else { self.start(); }
      });

      // Stop button
      this._stopBtn = L.DomUtil.create('a', 'leaflet-trackreplay-btn leaflet-trackreplay-stop', container);
      this._stopBtn.href = '#';
      this._stopBtn.title = 'Stop';
      this._stopBtn.setAttribute('role', 'button');
      this._stopBtn.setAttribute('aria-label', 'Stop');
      L.DomEvent.on(this._stopBtn, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        self.stop();
      });

      // Progress bar
      this._progressWrap = L.DomUtil.create('div', 'leaflet-trackreplay-progress-wrap', container);
      this._progressBar = L.DomUtil.create('div', 'leaflet-trackreplay-progress-bar', this._progressWrap);

      // Speed indicator (optional text display)
      this._speedLabel = L.DomUtil.create('span', 'leaflet-trackreplay-speed', container);
      this._speedLabel.textContent = this.options.speed + '×';
    },

    _updatePlayButton: function () {
      if (this._isPlaying) {
        this._playBtn.classList.add('leaflet-trackreplay-pause');
        this._playBtn.title = 'Pause';
        this._playBtn.setAttribute('aria-label', 'Pause');
      } else {
        this._playBtn.classList.remove('leaflet-trackreplay-pause');
        this._playBtn.title = 'Play';
        this._playBtn.setAttribute('aria-label', 'Play');
      }
    },

    _updateProgress: function () {
      if (this._progressBar) {
        var pct = this.getProgress() * 100;
        this._progressBar.style.width = pct + '%';
      }
      if (this._speedLabel) {
        this._speedLabel.textContent = this.options.speed + '×';
      }
    },

    // ---- Internal: helpers --------------------------------------------------

    _defaultIcon: function () {
      return L.divIcon({
        className: 'leaflet-trackreplay-marker',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
    },

  });

  // ---------------------------------------------------------------------------
  // Factory function
  // ---------------------------------------------------------------------------

  /**
   * Factory: create a new TrackReplay instance.
   *
   * @function L.trackReplay
   * @param {Array}  trackData - Array of {lat, lng, time?} objects.
   * @param {Object} [options] - Plugin options.
   * @returns {L.TrackReplay}
   *
   * @example
   *   var replay = L.trackReplay(myTrack, { speed: 5 }).addTo(map);
   */
  L.trackReplay = function (trackData, options) {
    return new TrackReplay(trackData, options);
  };

  // Optionally expose the class itself for extension
  L.TrackReplay = TrackReplay;

}, typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {}));
