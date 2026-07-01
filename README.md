# Leaflet.TrackReplay

A Leaflet plugin for replaying GPS tracks with customizable playback controls, speed adjustment, and rich event hooks.

[![npm version](https://img.shields.io/npm/v/leaflet-trackreplay.svg)](https://www.npmjs.com/package/leaflet-trackreplay)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<p align="center">
  <em>Demo screenshot coming soon</em>
</p>

## Features

- 🎬 **Play / Pause / Stop** — Full playback controls as a Leaflet control
- ⏩ **Adjustable speed** — Real-time, fast-forward, or slow-motion
- 🔄 **Loop mode** — Automatically restart playback when the track ends
- 🧭 **Auto-rotate marker** — Marker faces the direction of movement
- 📍 **Seek** — Jump to any position along the track
- 🎨 **Customizable** — Track styles, marker icon, elapsed-trail colors
- 📡 **Rich events** — `start`, `pause`, `stop`, `finish`, `seek`, `speedchange`, `reset`
- 🗺️ **Auto fit bounds** — Automatically zoom to show the full track
- ⏱️ **Time-aware** — Respects per-point timestamps for realistic playback

## Installation

### Via npm

```bash
npm install leaflet-trackreplay
```

### Via CDN (unpkg / jsDelivr)

```html
<!-- CSS -->
<link rel="stylesheet" href="https://unpkg.com/leaflet-trackreplay/dist/leaflet-trackreplay.css" />

<!-- JS -->
<script src="https://unpkg.com/leaflet-trackreplay/dist/leaflet-trackreplay.iife.js"></script>
```

> **Note:** Leaflet.TrackReplay requires Leaflet `^1.7.0`. Make sure Leaflet is loaded first.

## Quick Start

```js
// Create a map
var map = L.map('map').setView([39.9042, 116.4074], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Define your track data
var track = [
  { lat: 39.9042, lng: 116.4074, time: 1700000000000 },
  { lat: 39.9142, lng: 116.4174, time: 1700000060000 },
  { lat: 39.9242, lng: 116.4274, time: 1700000120000 },
  // ... more points
];

// Create the replay control and add it to the map
var replay = L.trackReplay(track, {
  speed: 10,       // 10× real-time
  autoRotate: true,
  fitBounds: true,
}).addTo(map);

// Start playback
replay.start();
```

## API Reference

### Factory

| Method | Description |
|---|---|
| `L.trackReplay(trackData, options?)` | Create a new TrackReplay instance. Returns `L.TrackReplay`. |

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `trackData` | `Array` | `[]` | Array of track points: `{lat, lng, time?}`. `time` is a UNIX timestamp in ms. |
| `trackStyle` | `Object` | `{color:'#3388ff', weight:3, opacity:0.7}` | Style for the untraversed portion of the track (Leaflet Polyline options). |
| `elapsedStyle` | `Object` | `{color:'#ff4444', weight:4, opacity:0.9}` | Style for the already-traversed portion. |
| `markerIcon` | `L.Icon` | `null` | Custom icon for the moving marker. Defaults to a colored circle. |
| `autoRotate` | `Boolean` | `true` | Auto-rotate the marker to face the direction of movement. |
| `speed` | `Number` | `1` | Playback speed multiplier (1 = real-time, 60 = 1 minute per second). |
| `loop` | `Boolean` | `false` | Loop playback when the track ends. |
| `autoPlay` | `Boolean` | `false` | Start playing automatically after `.addTo(map)`. |
| `tickInterval` | `Number` | `42` | Animation frame interval in ms. |
| `fitBounds` | `Boolean` | `true` | Fit map view to track bounds on init. |
| `fitBoundsPadding` | `Array` | `[30, 30]` | Padding in pixels when fitting bounds. |
| `fitBoundsMaxZoom` | `Number` | `16` | Max zoom when fitting bounds. |

### Methods

| Method | Returns | Description |
|---|---|---|
| `start()` | `this` | Start or resume playback. Fires `start` event. |
| `pause()` | `this` | Pause playback. `start()` resumes from here. Fires `pause` event. |
| `stop()` | `this` | Stop and reset to the beginning. Fires `stop` event. |
| `reset()` | `this` | Reset to start without changing play state. Fires `reset` event. |
| `setSpeed(n)` | `this` | Set playback speed multiplier. Fires `speedchange` event. |
| `seek(fraction)` | `this` | Jump to a position (0–1). Fires `seek` event. |
| `setTrackData(data, reset?)` | `this` | Replace track data. Optionally resets playback. |
| `isPlaying()` | `Boolean` | Whether playback is active. |
| `isFinished()` | `Boolean` | Whether the end of the track has been reached. |
| `getProgress()` | `Number` | Current progress as a fraction (0–1). |
| `getLatLng()` | `L.LatLng` | Current interpolated position on the map. |

### Events

| Event | Data | Description |
|---|---|---|
| `start` | `{elapsed}` | Playback started or resumed. |
| `pause` | `{elapsed}` | Playback paused. |
| `stop` | — | Playback stopped and reset. |
| `reset` | — | Track reset to starting position. |
| `finish` | — | Reached the end of the track. |
| `seek` | `{fraction}` | Jumped to a position via `seek()`. |
| `speedchange` | `{speed}` | Playback speed changed. |

## Development

```bash
# Clone the repo
git clone https://github.com/FrankYJY/Leaflet.TrackReplay.git
cd Leaflet.TrackReplay

# Install dependencies
npm install

# Build (outputs to dist/)
npm run build

# Dev/watch mode
npm run dev

# Lint
npm run lint
```

Open `examples/index.html` in a browser to see the demo.

## Contributing

Contributions, issues, and feature requests are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) (TODO).

## License

MIT © [Frank Yao](https://github.com/FrankYJY)
