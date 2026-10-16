/**
 * SearchIndex — a pure multi-occurrence text index ("leaflet-multisearch").
 *
 * The model is *find all* (like a word processor): every record is one hit,
 * even when several records share exactly the same text, and `search()`
 * returns them all together with the total count. There is no "text → one
 * location" collapsing — this index exists precisely because that model
 * cannot represent duplicates.
 *
 * No Leaflet, no DOM: records are `{ text, ... }` and every other field is
 * carried through opaquely as `record`. Matching is case-insensitive
 * substring; `matchStart` reports where the query was found so callers can
 * highlight it.
 */

/** Normalize a value to a trimmed string ('' for null/undefined). */
function toText(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Create a search index.
 *
 * @returns {Object} { set, add, clear, size, search }
 */
export function createSearchIndex() {
  var records = []; // { text, lower, record }

  /**
   * Replace every record.
   * @param {Object[]} items - `[{ text, ...payload }]`; items whose text is
   *        empty after trimming are skipped, payload is kept by reference
   * @returns {number} how many records were indexed
   */
  function set(items) {
    records = [];
    var n = items ? items.length : 0;
    for (var i = 0; i < n; i++) {
      add(items[i]);
    }
    return records.length;
  }

  function add(item) {
    if (!item) { return records.length; }
    var text = toText(item.text);
    if (!text) { return records.length; }
    records.push({ text: text, lower: text.toLowerCase(), record: item });
    return records.length;
  }

  function clear() {
    records = [];
  }

  function size() {
    return records.length;
  }

  /**
   * Find every record whose text contains `query` (case-insensitive,
   * query trimmed). Returns ALL matches — duplicates included.
   *
   * @param {string} query
   * @returns {{ total: number, matches: Array<{text, matchStart, record}> }}
   *          in insertion order (stable — the caller decides it)
   */
  function search(query) {
    var q = toText(query).toLowerCase();
    var matches = [];
    if (!q) { return { total: 0, matches: matches }; }

    for (var i = 0; i < records.length; i++) {
      var at = records[i].lower.indexOf(q);
      if (at >= 0) {
        matches.push({
          text: records[i].text,
          matchStart: at,
          record: records[i].record,
        });
      }
    }
    return { total: matches.length, matches: matches };
  }

  return {
    set: set,
    add: add,
    clear: clear,
    size: size,
    search: search,
  };
}
