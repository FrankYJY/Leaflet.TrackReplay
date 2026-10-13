/**
 * ViewFollowControl — map view following for moving indicators.
 *
 * Modes:
 *   - 'off':      no following (default)
 *   - 'latest':   auto-follow the newest moving indicator
 *   - 'random':   follow a random indicator
 *   - 'named':    follow a specific indicator by name/index
 *
 * Auto-disables on user map interaction (pan/drag).
 */

/**
 * Create a view follow control.
 *
 * @param {L.Map} map
 * @param {Object} [options]
 * @returns {Object} { control, setMode(mode, target?), getMode(), update() }
 */
export function createViewFollowControl(map, options) {
  options = options || {};

  var mode = 'off';
  var targetName = null;
  var _indicators = []; // { name, marker, getLatLng }
  var _userInteracting = false;

  // Detect user map interaction
  function onMouseDown() {
    _userInteracting = true;
  }
  function onDragStart() {
    _userInteracting = true;
  }
  function onMoveEnd() {
    // If user dragged and we were following, disable — and sync the control
    // UI back to "Off" so the panel never shows a mode that is not active
    if (_userInteracting && mode !== 'off') {
      setMode('off');
    }
    _userInteracting = false;
  }

  map.on('mousedown', onMouseDown);
  map.on('dragstart', onDragStart);
  map.on('moveend', onMoveEnd);

  /**
   * Register an indicator for potential following.
   * @param {string} name
   * @param {L.Marker} marker
   * @param {number[]} [timeRange] - [startMs, endMs] of the subject's track;
   *        when given, following is skipped outside this range
   */
  function registerIndicator(name, marker, timeRange) {
    _indicators.push({
      name: name,
      marker: marker,
      timeRange: timeRange || null,
      getLatLng: function () { return marker.getLatLng(); },
    });
  }

  /**
   * Unregister an indicator.
   * @param {string} name
   */
  function unregisterIndicator(name) {
    _indicators = _indicators.filter(function (ind) { return ind.name !== name; });
  }

  /**
   * Set the follow mode.
   * @param {string} newMode  - 'off' | 'latest' | 'random' | 'named'
   * @param {string} [target] - indicator name (for 'named' mode)
   */
  function setMode(newMode, target) {
    mode = newMode;
    targetName = target || null;

    if (newMode !== 'off') {
      _userInteracting = false;
    }

    // Keep the control UI consistent — also when following is switched off
    // automatically (e.g. the user dragged the map)
    if (_controlInstance) {
      updateControlUI();
    }
  }

  function getMode() {
    return { mode: mode, target: targetName };
  }

  /**
   * Update the map view to follow the current target.
   * Called on each tick.
   *
   * @param {number} [timeMs] - current playback time; when given, following is
   *        skipped outside the subject's own time range (design doc: no
   *        tracking behaviour beyond the subject's track)
   */
  function update(timeMs) {
    if (mode === 'off' || _userInteracting) { return; }

    var indicator = null;

    if (mode === 'latest' && _indicators.length > 0) {
      indicator = _indicators[_indicators.length - 1];
    } else if (mode === 'random' && _indicators.length > 0) {
      if (!_randomTarget || !_indicators.find(function (i) { return i.name === _randomTarget.name; })) {
        var idx = Math.floor(Math.random() * _indicators.length);
        _randomTarget = _indicators[idx];
      }
      indicator = _randomTarget;
    } else if (mode === 'named' && targetName) {
      indicator = _indicators.find(function (i) { return i.name === targetName; });
    }

    if (indicator && indicator.marker._map) {
      // Skip when the playhead is outside this subject's track time range
      if (timeMs !== undefined && timeMs !== null && indicator.timeRange) {
        if (timeMs < indicator.timeRange[0] || timeMs > indicator.timeRange[1]) {
          return;
        }
      }

      var latlng = indicator.getLatLng();
      if (latlng) {
        map.panTo(latlng, { animate: true, duration: 0.3 });
      }
    }
  }

  var _randomTarget = null;
  var _controlInstance = null;

  /**
   * Update the control UI to reflect current mode.
   */
  function updateControlUI() {
    // Rebuild control DOM — handled by the control itself
    if (_controlInstance && _controlInstance._container) {
      var radios = _controlInstance._container.querySelectorAll('input[type="radio"]');
      for (var i = 0; i < radios.length; i++) {
        var r = radios[i];
        r.checked = false;
        if (r.value === mode) {
          r.checked = true;
        }
      }
    }
  }

  // Build the Leaflet control
  var ViewFollowCtrl = L.Control.extend({
    options: {
      position: options.position || 'topright',
    },

    onAdd: function () {
      _controlInstance = this;

      var container = L.DomUtil.create('div', 'leaflet-trackreplay-viewfollow');
      var title = L.DomUtil.create('div', 'tr-vf-title', container);
      title.textContent = 'Follow:';

      var modes = [
        { value: 'off', label: 'Off' },
        { value: 'latest', label: 'Latest' },
        { value: 'random', label: 'Random' },
        { value: 'named', label: 'Select...' },
      ];

      for (var i = 0; i < modes.length; i++) {
        var label = L.DomUtil.create('label', 'tr-vf-option', container);
        var radio = L.DomUtil.create('input', '', label);
        radio.type = 'radio';
        radio.name = 'tr-viewfollow';
        radio.value = modes[i].value;
        if (modes[i].value === mode) { radio.checked = true; }

        radio.onchange = (function (m) {
          return function () {
            setMode(m.value);
          };
        })(modes[i]);

        label.appendChild(document.createTextNode(' ' + modes[i].label));
      }

      // Named target selector
      var selectContainer = L.DomUtil.create('div', 'tr-vf-select-container', container);
      var select = L.DomUtil.create('select', 'tr-vf-select', selectContainer);
      select.style.maxHeight = '120px';
      select.style.overflowY = 'auto';
      select.style.maxWidth = '200px';

      var defaultOpt = L.DomUtil.create('option', '', select);
      defaultOpt.value = '';
      defaultOpt.textContent = '-- Choose --';

      select.onchange = function () {
        if (select.value) {
          setMode('named', select.value);
        }
      };

      // Update select options when indicators change
      container._updateSelect = function () {
        // Clear existing options (keep default)
        while (select.options.length > 1) {
          select.remove(1);
        }
        for (var j = 0; j < _indicators.length; j++) {
          var opt = L.DomUtil.create('option', '', select);
          opt.value = _indicators[j].name;
          opt.textContent = _indicators[j].name;
          if (_indicators[j].name === targetName) {
            opt.selected = true;
          }
        }
      };

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      return container;
    },
  });

  var control = new ViewFollowCtrl();

  // Refresh select when registering indicators
  var origRegister = registerIndicator;
  registerIndicator = function (name, marker, timeRange) {
    origRegister(name, marker, timeRange);
    if (control._container && control._container._updateSelect) {
      control._container._updateSelect();
    }
  };

  var origUnregister = unregisterIndicator;
  unregisterIndicator = function (name) {
    origUnregister(name);
    if (control._container && control._container._updateSelect) {
      control._container._updateSelect();
    }
  };

  /**
   * Tear down: detach map listeners.
   */
  function destroy() {
    map.off('mousedown', onMouseDown);
    map.off('dragstart', onDragStart);
    map.off('moveend', onMoveEnd);
    _indicators = [];
  }

  return {
    control: control,
    setMode: setMode,
    getMode: getMode,
    update: update,
    registerIndicator: registerIndicator,
    unregisterIndicator: unregisterIndicator,
    destroy: destroy,
  };
}
