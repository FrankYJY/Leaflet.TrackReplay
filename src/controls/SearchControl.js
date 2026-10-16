/**
 * SearchControl — multi-occurrence text search for Leaflet layers
 * ("leaflet-multisearch").
 *
 * Unlike list-style searchers that collapse equal texts into one entry, this
 * control treats every occurrence as its own hit (word-processor model):
 * duplicates are all indexed, the badge reports the total, and Enter / the
 * nav buttons cycle through the hits with wraparound — each jump moves the
 * map to the record and optionally opens its popup. Records inside a
 * MarkerClusterGroup are revealed first with `zoomToShowLayer`.
 *
 * The control knows nothing about the host's data model: it asks the
 * `records` callback for
 *
 *     [{ text, layer?, latlng?, group?, meta? }]
 *
 * and hands `meta` back untouched (through `formatResult` / `onGoto`). Its
 * only dependencies are Leaflet and SearchIndex — it is deliberately written
 * to be extractable into a standalone plugin.
 */

import { createSearchIndex } from '../core/SearchIndex.js';

var DEFAULT_LABELS = {
  open: 'Search',
  close: 'Collapse',
  placeholder: 'Search…',
  prev: 'Previous',
  next: 'Next',
};

var DEFAULT_MESSAGES = {
  /** badge text for the total number of hits */
  count: function (total) { return total + ' hit(s)'; },
  /** current position within the hits */
  of: function (current, total) { return current + '/' + total; },
  /** there are more hits than the list shows */
  more: function (shown, total) { return '… ' + shown + ' of ' + total; },
  /** no match line */
  empty: function () { return 'No match'; },
};

/**
 * Plain text of a popup content value (string HTML or DOM node): tags and
 * common entities removed, whitespace collapsed. Exported because hosts
 * building `records` from popups need exactly this normalization.
 *
 * @param {string|HTMLElement} content
 * @returns {string}
 */
export function plainText(content) {
  if (content == null) { return ''; }
  if (typeof content !== 'string') {
    return content.textContent ? String(content.textContent).replace(/\s+/g, ' ').trim() : '';
  }
  var s = content
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Create the multi-search control.
 *
 * @param {Object} options
 * @param {Function} options.records - fn() => [{ text, layer?, latlng?,
 *        group?, meta? }]. Called lazily whenever the index is invalid
 *        (first query after a change) — never per keystroke.
 * @param {string} [options.position='topleft']
 * @param {number} [options.zoom] - setView zoom for a jump; omit to panTo
 *        (keeping the current zoom)
 * @param {number} [options.maxResults=50] - rows shown; the count badge is
 *        never truncated
 * @param {boolean} [options.highlight=true] - pulse a ring at the hit
 * @param {Object} [options.labels]   - UI strings (see DEFAULT_LABELS)
 * @param {Object} [options.messages] - badge/row texts (see DEFAULT_MESSAGES)
 * @param {Function} [options.formatResult] - fn(match) => display string for
 *        a list row (default: the text itself, with the query bolded)
 * @param {Function} [options.onGoto] - fn(match, position, total) after a jump
 * @returns {L.Control} with `refresh()`
 */
export function createSearchControl(options) {
  options = options || {};
  var labels = L.extend({}, DEFAULT_LABELS, options.labels || {});
  var messages = L.extend({}, DEFAULT_MESSAGES, options.messages || {});
  var maxResults = options.maxResults == null ? 50 : options.maxResults;

  var SearchCtrl = L.Control.extend({
    options: {
      position: options.position || 'topleft',
    },

    onAdd: function (map) {
      var self = this;
      this._map = map;

      this._index = createSearchIndex();
      this._dirty = true;
      this._query = '';
      this._matches = [];
      this._cursor = -1;
      this._gotoSeq = 0;
      this._flashMarker = null;

      var container = L.DomUtil.create('div', 'leaflet-multisearch');
      this._container = container;

      // collapsed state: a magnifier button that opens the search box
      var toggle = L.DomUtil.create('button', 'lms-toggle', container);
      toggle.type = 'button';
      toggle.title = labels.open;
      toggle.innerHTML = '&#128269;'; // 🔍
      toggle.onclick = function () { self._open(); };

      var box = L.DomUtil.create('div', 'lms-box', container);
      this._boxEl = box;

      var row = L.DomUtil.create('div', 'lms-row', box);

      var prevBtn = L.DomUtil.create('button', 'lms-nav lms-prev', row);
      prevBtn.type = 'button';
      prevBtn.title = labels.prev;
      prevBtn.textContent = '◀';
      prevBtn.onclick = function () { self._step(-1); };
      this._prevBtn = prevBtn;

      var input = L.DomUtil.create('input', 'lms-input', row);
      input.type = 'text';
      input.placeholder = labels.placeholder;
      input.oninput = function () { self._search(input.value); };
      input.onkeydown = function (e) {
        if (e.keyCode === 13) { // Enter
          e.preventDefault();
          self._step(e.shiftKey ? -1 : 1);
        } else if (e.keyCode === 27) { // Escape
          e.preventDefault();
          if (input.value) {
            input.value = '';
            self._search('');
          } else {
            self._close();
          }
        }
      };
      this._input = input;

      var nextBtn = L.DomUtil.create('button', 'lms-nav lms-next', row);
      nextBtn.type = 'button';
      nextBtn.title = labels.next;
      nextBtn.textContent = '▶';
      nextBtn.onclick = function () { self._step(1); };
      this._nextBtn = nextBtn;

      this._countEl = L.DomUtil.create('span', 'lms-count', row);

      var closeBtn = L.DomUtil.create('button', 'lms-nav lms-close', row);
      closeBtn.type = 'button';
      closeBtn.title = labels.close;
      closeBtn.textContent = '✕';
      closeBtn.onclick = function () { self._close(); };

      this._listEl = L.DomUtil.create('div', 'lms-list', box);
      this._listEl.style.display = 'none';

      // keep clicks/keys inside the control away from the map
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      // Focus-scoped keys: while the control itself has focus, ←/→/↑/↓ cycle
      // the hits and Enter advances. Inputs and buttons keep their native
      // behavior (typing, caret movement, activation) — deeper focus wins.
      container.tabIndex = 0;
      container.addEventListener('keydown', function (e) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
            t.tagName === 'BUTTON' || t.isContentEditable === true)) {
          return;
        }
        var k = e.keyCode;
        if (k === 37 || k === 38) { e.preventDefault(); self._step(-1); }      // ← ↑
        else if (k === 39 || k === 40) { e.preventDefault(); self._step(1); }  // → ↓
        else if (k === 13) { e.preventDefault(); self._step(1); }              // Enter
        else if (k === 27) {                                                   // Esc
          e.preventDefault();
          if (self._query) { self._input.value = ''; self._search(''); }
          else { self._close(); }
        }
      });

      this._setCount('');
      return container;
    },

    onRemove: function (map) {
      if (this._flashMarker && map.hasLayer(this._flashMarker)) {
        map.removeLayer(this._flashMarker);
      }
    },

    // ---- public ----

    /**
     * Mark the index stale and, when a query is active, re-run it now —
     * call this after the searched layers were rebuilt (data changes,
     * re-rendering). Cheap: the actual re-indexing happens lazily.
     */
    refresh: function () {
      this._dirty = true;
      if (this._query) { this._search(this._query, true); }
    },

    // ---- internals ----

    _open: function () {
      L.DomUtil.addClass(this._container, 'lms-open');
      this._input.focus();
      // reopening with an existing query restores its results
      if (this._input.value) { this._search(this._input.value, true); }
    },

    _close: function () {
      L.DomUtil.removeClass(this._container, 'lms-open');
      this._hideList();
    },

    _ensureIndex: function () {
      if (!this._dirty) { return; }
      this._index.set(options.records ? options.records() : []);
      this._dirty = false;
    },

    /** Run a query. `keepCursor` (used by refresh()) preserves the position. */
    _search: function (query, keepCursor) {
      var self = this;
      this._query = query;

      if (!query || !query.replace(/\s/g, '')) {
        this._matches = [];
        this._cursor = -1;
        this._setCount('');
        this._hideList();
        return;
      }

      this._ensureIndex();
      var res = this._index.search(query);
      this._matches = res.matches;

      if (keepCursor && this._cursor >= 0 && res.total) {
        this._cursor = Math.min(this._cursor, res.total - 1);
      } else {
        this._cursor = -1; // Enter / a row click jumps; typing alone does not
      }

      if (!res.total) {
        this._setCount(messages.empty());
        while (this._listEl.firstChild) {
          this._listEl.removeChild(this._listEl.firstChild);
        }
        this._hideList();
        return;
      }

      this._setCount(this._countText());
      this._renderList();

      // keep the highlighted row in view when the cursor moved
      if (this._cursor >= 0) {
        var active = this._listEl.querySelector('.lms-active');
        if (active && active.scrollIntoView) { active.scrollIntoView({ block: 'nearest' }); }
      }
    },

    _countText: function () {
      var text = messages.count(this._matches.length);
      if (this._cursor >= 0) {
        text += ' · ' + messages.of(this._cursor + 1, this._matches.length);
      }
      return text;
    },

    _setCount: function (text) {
      this._countEl.textContent = text || '';
      this._countEl.style.display = text ? '' : 'none';
    },

    _renderList: function () {
      var self = this;
      while (this._listEl.firstChild) {
        this._listEl.removeChild(this._listEl.firstChild);
      }

      var shown = Math.min(this._matches.length, maxResults);
      for (var i = 0; i < shown; i++) {
        (function (idx) {
          var match = self._matches[idx];
          var item = L.DomUtil.create('div', 'lms-item', self._listEl);
          if (idx === self._cursor) { L.DomUtil.addClass(item, 'lms-active'); }

          if (options.formatResult) {
            item.textContent = options.formatResult(match);
          } else {
            // default: text with the matched part bolded
            var at = match.matchStart;
            var qlen = self._query.trim().length;
            item.appendChild(document.createTextNode(match.text.slice(0, at)));
            var b = L.DomUtil.create('b', '', item);
            b.textContent = match.text.slice(at, at + qlen);
            item.appendChild(document.createTextNode(match.text.slice(at + qlen)));
          }

          item.title = match.text;
          // mousedown (not click): fires before the input's blur hides the list
          item.onmousedown = function (e) {
            e.preventDefault();
            self._goto(idx);
          };
        })(i);
      }

      if (this._matches.length > shown) {
        var more = L.DomUtil.create('div', 'lms-more', this._listEl);
        more.textContent = messages.more(shown, this._matches.length);
      }

      this._listEl.style.display = '';
    },

    _hideList: function () {
      this._listEl.style.display = 'none';
    },

    /**
     * Cycle to the next/prev hit (wrapping). The first Enter after typing
     * goes to hit 1; every further one advances.
     */
    _step: function (dir) {
      if (!this._matches.length) { return; }
      var next = this._cursor + dir;
      if (next < 0) { next = this._matches.length - 1; }
      if (next >= this._matches.length) { next = 0; }
      this._goto(next);
    },

    /** Jump to one hit: move the map, reveal it (cluster-aware), open popup. */
    _goto: function (index) {
      var self = this;
      var match = this._matches[index];
      if (!match) { return; }
      this._cursor = index;

      var rec = match.record || {};
      var map = this._map;
      var latlng = rec.latlng ||
        (rec.layer && rec.layer.getLatLng ? rec.layer.getLatLng() : null) ||
        (rec.layer && rec.layer.getBounds ? rec.layer.getBounds().getCenter() : null);

      function open() {
        if (rec.layer && typeof rec.layer.openPopup === 'function' && rec.layer._map) {
          rec.layer.openPopup();
        }
      }
      function flash() {
        if (!latlng) { return; }
        if (options.highlight === false) { return; }
        if (self._flashMarker && map.hasLayer(self._flashMarker)) {
          map.removeLayer(self._flashMarker);
        }
        self._flashMarker = L.marker(latlng, {
          icon: L.divIcon({ className: 'lms-flash', iconSize: [30, 30], iconAnchor: [15, 15] }),
          interactive: false,
          zIndexOffset: 1200,
        }).addTo(map);
        setTimeout(function () {
          if (map.hasLayer(self._flashMarker)) { map.removeLayer(self._flashMarker); }
        }, 1600);
      }

      // A record inside a MarkerClusterGroup must be revealed first — the
      // group zooms in until the marker stands alone, then we open its popup.
      if (rec.group && typeof rec.group.zoomToShowLayer === 'function' && rec.layer) {
        rec.group.zoomToShowLayer(rec.layer, function () { open(); flash(); });
      } else if (latlng) {
        // Move first and open the popup only AFTER the move finishes: opening
        // mid-animation lets the popup's autoPan cancel the pan animation,
        // which strands the map short of the target on long jumps.
        var seq = ++this._gotoSeq;
        var moved = !map.getCenter().equals(latlng, 1e-9) ||
          (options.zoom != null && map.getZoom() !== options.zoom);

        if (moved) {
          map.once('moveend', function () {
            if (seq !== self._gotoSeq) { return; } // superseded by a newer jump
            open();
          });
          if (options.zoom) { map.setView(latlng, options.zoom); }
          else { map.panTo(latlng); }
        } else {
          open();
        }
        flash();
      }

      this._setCount(this._countText());
      // reflect the active row in the (possibly stale) list
      var items = this._listEl.querySelectorAll('.lms-item');
      for (var i = 0; i < items.length; i++) {
        if (i === index) { L.DomUtil.addClass(items[i], 'lms-active'); }
        else { L.DomUtil.removeClass(items[i], 'lms-active'); }
      }

      if (options.onGoto) { options.onGoto(match, index + 1, this._matches.length); }
    },
  });

  return new SearchCtrl();
}
