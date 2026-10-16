/**
 * DatasetContainer — holds the raw GeoJSON datasets fed into a TrackReplay
 * session and produces the merged FeatureCollection each rebuild consumes.
 *
 * Pure logic: no Leaflet, no map, no DOM. One `add()` = one dataset = the
 * atomic unit of removal ("remove exactly what this add introduced"): the
 * merged collection is simply the concatenation of every dataset's features,
 * so removing a dataset and re-parsing is guaranteed to leave exactly the
 * remaining parts — objects that span several datasets survive with the parts
 * that are left, objects owned by a single dataset disappear with it.
 *
 * Datasets are held by reference — features are not copied — so callers must
 * not mutate a FeatureCollection after adding it.
 *
 * Input coordinates must be in WGS-84 (地球坐标系); the datum conversion to
 * the map's frame happens later, at parse time, and is unrelated to how the
 * data got into the container.
 */

/**
 * Create a dataset container.
 *
 * @returns {Object} container
 */
export function createDatasetContainer() {
  var datasets = []; // [{ id, name, features }]
  var seq = 0;

  var container = {
    /**
     * Add one GeoJSON FeatureCollection as a new dataset.
     *
     * @param {Object} featureCollection
     * @param {Object} [opts]
     * @param {string} [opts.name] - display name (default "Dataset N")
     * @returns {{id: number, name: string, featureCount: number}}
     */
    add: function (featureCollection, opts) {
      opts = opts || {};
      if (!featureCollection || featureCollection.type !== 'FeatureCollection' ||
          !Array.isArray(featureCollection.features)) {
        throw new Error('DatasetContainer: expected a GeoJSON FeatureCollection');
      }
      var record = {
        id: ++seq,
        name: opts.name || ('Dataset ' + seq),
        features: featureCollection.features,
      };
      datasets.push(record);
      return { id: record.id, name: record.name, featureCount: record.features.length };
    },

    /**
     * Remove one dataset by id.
     *
     * @param {number} id
     * @returns {{id, name, featureCount}|null} removed summary, or null
     */
    remove: function (id) {
      for (var i = 0; i < datasets.length; i++) {
        if (datasets[i].id === id) {
          var removed = datasets.splice(i, 1)[0];
          return { id: removed.id, name: removed.name, featureCount: removed.features.length };
        }
      }
      return null;
    },

    /**
     * Remove every dataset.
     * @returns {number} how many datasets were removed
     */
    clear: function () {
      var n = datasets.length;
      datasets = [];
      return n;
    },

    /**
     * Metadata list of the current datasets (查).
     * @returns {Array<{id, name, featureCount}>}
     */
    list: function () {
      var out = [];
      for (var i = 0; i < datasets.length; i++) {
        out.push({
          id: datasets[i].id,
          name: datasets[i].name,
          featureCount: datasets[i].features.length,
        });
      }
      return out;
    },

    /**
     * One dataset's metadata plus its raw data (查).
     * @param {number} id
     * @returns {{id, name, featureCollection}|null}
     */
    get: function (id) {
      for (var i = 0; i < datasets.length; i++) {
        if (datasets[i].id === id) {
          var rec = datasets[i];
          return {
            id: rec.id,
            name: rec.name,
            featureCollection: { type: 'FeatureCollection', features: rec.features },
          };
        }
      }
      return null;
    },

    /** @returns {boolean} */
    isEmpty: function () { return datasets.length === 0; },

    /** @returns {number} */
    count: function () { return datasets.length; },

    /**
     * The concatenation of every dataset — what each rebuild parses. A fresh
     * FeatureCollection object each call (feature objects are shared, not
     * cloned; the parser never mutates its input).
     *
     * @returns {Object} GeoJSON FeatureCollection
     */
    mergedFeatureCollection: function () {
      var features = [];
      for (var i = 0; i < datasets.length; i++) {
        features = features.concat(datasets[i].features);
      }
      return { type: 'FeatureCollection', features: features };
    },
  };

  return container;
}
