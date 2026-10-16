/**
 * ControlBar — playback buttons and the timeline in a single box
 * (video-player style: buttons on top, progress slider below).
 *
 * Used when both `showControls` and `showTimeline` are enabled; either piece
 * can still be shown alone as its own control.
 */

import { fillPlaybackControls, bindPlaybackKeys } from './PlaybackControls.js';
import { fillTimelineControl } from './TimelineControl.js';

/**
 * Create the combined playback + timeline control.
 *
 * @param {Object} timeEngine
 * @param {Object} [options]
 * @param {string} [options.position='bottomleft']
 * @param {number[]} [options.speedOptions] - speed multipliers for the selector
 * @param {boolean} [options.showLoop=true] - show the loop checkbox
 * @returns {L.Control}
 */
export function createControlBar(timeEngine, options) {
  options = options || {};

  var ControlBar = L.Control.extend({
    options: {
      position: options.position || 'bottomleft',
    },

    onAdd: function (/*map*/) {
      var container = L.DomUtil.create('div', 'leaflet-trackreplay-controlbar');

      // Top row: play/pause, stop, speed, loop
      var buttons = L.DomUtil.create('div', 'leaflet-trackreplay-controls tr-bar-buttons', container);
      fillPlaybackControls(buttons, timeEngine, options);

      // Bottom rows: time display + progress slider + the date line
      var timeline = L.DomUtil.create('div', 'leaflet-trackreplay-timeline tr-bar-timeline', container);
      fillTimelineControl(timeline, timeEngine, options);
      // Let the session reach the timeline's runtime knobs through the bar.
      container._trTimelineApi = timeline._trTimelineApi;

      // Focus-scoped playback keys (Space/←→/0-9/r) on the whole box
      bindPlaybackKeys(container, timeEngine, options);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      return container;
    },
  });

  return new ControlBar();
}
