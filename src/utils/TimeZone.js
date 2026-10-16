/**
 * TimeZone — wall-clock math for a chosen *display* zone.
 *
 * The timeline can be read in three kinds of zone, in this order of specificity:
 *
 *   createZone('local')            the browser's own zone (the default)
 *   createZone(8)                  a fixed UTC offset in hours (no DST)
 *   createZone('Asia/Shanghai')    an IANA zone name (DST handled by Intl)
 *
 * Everything the timeline shows — the time label, the date line, the day
 * boundaries on the slider, the holiday lookup keys and the time editor's
 * parsing — goes through one of these, so a track recorded in one zone can be
 * read in another without the parts disagreeing with each other.
 *
 * No dependencies: `Intl.DateTimeFormat` is the platform's own tz database.
 */

/** @returns {Object} zone — see the module comment for the kinds accepted. */
export function createZone(zone) {
  var kind = 'local';
  var fixedOffsetMs = 0;
  var ianaName = null;

  if (typeof zone === 'number' && isFinite(zone)) {
    kind = 'fixed';
    fixedOffsetMs = Math.round(zone * 3600000);
  } else if (typeof zone === 'string' && zone && zone !== 'local') {
    kind = 'iana';
    ianaName = zone;
  }

  var dtf = null;
  if (kind === 'iana') {
    try {
      dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: ianaName,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (err) {
      // Unknown zone name: fall back to local rather than throwing.
      console.warn('TimeZone: unknown zone "' + ianaName + '", using local time');
      kind = 'local';
      ianaName = null;
    }
  }

  /** Wall-clock parts of `ms` in this zone. */
  function parts(ms) {
    if (kind === 'local') {
      var d = new Date(ms);
      return {
        year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
        hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
        weekday: d.getDay(),
      };
    }
    if (kind === 'fixed') {
      var f = new Date(ms + fixedOffsetMs);
      return {
        year: f.getUTCFullYear(), month: f.getUTCMonth() + 1, day: f.getUTCDate(),
        hour: f.getUTCHours(), minute: f.getUTCMinutes(), second: f.getUTCSeconds(),
        weekday: f.getUTCDay(),
      };
    }
    var out = {};
    var fields = dtf.formatToParts(new Date(ms));
    for (var i = 0; i < fields.length; i++) {
      var t = fields[i].type;
      var v = fields[i].value;
      if (t === 'year') { out.year = +v; }
      else if (t === 'month') { out.month = +v; }
      else if (t === 'day') { out.day = +v; }
      else if (t === 'hour') { out.hour = +v % 24; }
      else if (t === 'minute') { out.minute = +v; }
      else if (t === 'second') { out.second = +v; }
    }
    out.weekday = new Date(Date.UTC(out.year, out.month - 1, out.day)).getUTCDay();
    return out;
  }

  /** Offset from UTC (ms) in effect at `ms` for this zone. */
  function offsetMs(ms) {
    if (kind === 'fixed') { return fixedOffsetMs; }
    if (kind === 'local') { return -new Date(ms).getTimezoneOffset() * 60000; }
    var p = parts(ms);
    var asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }

  /** Epoch ms for a wall-clock time in this zone (DST-safe: two passes). */
  function fromParts(year, month, day, hour, minute, second) {
    if (kind === 'local') {
      return new Date(year, month - 1, day, hour, minute, second).getTime();
    }
    var naive = Date.UTC(year, month - 1, day, hour, minute, second);
    var guess = naive - offsetMs(naive);
    var refined = naive - offsetMs(guess);
    return refined;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  var zoneApi = {
    kind: kind,

    /** Compact label for the UI: 'Asia/Shanghai', 'UTC+8', … */
    label: function () {
      if (kind === 'iana') { return ianaName; }
      if (kind === 'fixed') {
        var hours = fixedOffsetMs / 3600000;
        var sign = hours < 0 ? '-' : '+';
        var abs = Math.abs(hours);
        var hh = Math.floor(abs);
        var mm = Math.round((abs - hh) * 60);
        return 'UTC' + sign + hh + (mm ? ':' + pad(mm) : '');
      }
      try {
        return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
      } catch (err) {
        return 'local';
      }
    },

    parts: parts,
    offsetMs: offsetMs,
    fromParts: fromParts,

    /** 'YYYY-MM-DD' in this zone — the key holiday tables are stored under. */
    dateKey: function (ms) {
      var p = parts(ms);
      return p.year + '-' + pad(p.month) + '-' + pad(p.day);
    },

    /** 'full' | 'date' | 'time', matching TimeUtils.formatTimestamp. */
    format: function (ms, fmt) {
      var p = parts(ms);
      if (fmt === 'time') {
        return pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second);
      }
      if (fmt === 'date') {
        return p.year + '-' + pad(p.month) + '-' + pad(p.day);
      }
      return p.year + '-' + pad(p.month) + '-' + pad(p.day) + ' ' +
        pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second);
    },

    /** Epoch ms of that day's 00:00 in this zone. */
    startOfDay: function (ms) {
      var p = parts(ms);
      return fromParts(p.year, p.month, p.day, 0, 0, 0);
    },

    /**
     * Parse what the timeline editor accepts — the same shapes as
     * TimeUtils.parseTimeString, but interpreted in this zone.
     * @returns {number|null} epoch ms
     */
    parse: function (text, baseMs) {
      var partsIn = String(text == null ? '' : text).trim().split(/[\s:-]+/);
      if (partsIn.length >= 6) {
        return fromParts(+partsIn[0], +partsIn[1], +partsIn[2],
          +partsIn[3], +partsIn[4], +partsIn[5]);
      }
      if (partsIn.length >= 3) {
        var base = parts(baseMs == null ? Date.now() : baseMs);
        return fromParts(base.year, base.month, base.day,
          +partsIn[0], +partsIn[1], +partsIn[2]);
      }
      return null;
    },
  };

  return zoneApi;
}
