/**
 * LayerTreeBuilder — builds the hierarchical layer control structure
 * from parsed layer data.
 *
 * Uses Leaflet.Control.Layers.Tree when available (a real collapsible tree,
 * one branch per layerPath segment, and — when the caller provides them —
 * one leaf per display element: track, points, traveled route, indicator, …).
 * Falls back to Leaflet's built-in L.control.layers with breadcrumb labels
 * ("group › object › element") otherwise.
 */

/**
 * Create a layer tree control from parsed layer data.
 *
 * @param {L.Map} map
 * @param {Object[]} layerFeatures - from DataParser.parseFeatureCollection()
 * @param {Object} layersByPath     - { layerPathKey: L.Layer | { group, elements } }
 *                                   `elements` is [{ key, label, layer }, …]
 * @param {Object} [options]
 * @param {boolean} [options.collapsed=true] - start collapsed
 * @returns {L.Control} the layer control instance
 */
export function createLayerControl(map, layerFeatures, layersByPath, options) {
  options = options || {};

  var treeNodes = [];   // hierarchical nodes for L.control.layers.tree
  var overlayMap = {};  // flat label → layer map for the built-in control

  for (var i = 0; i < layerFeatures.length; i++) {
    var entry = layerFeatures[i];
    var path = entry.layerPath;
    var layerEntry = layersByPath[path.join('/')];

    if (!layerEntry) { continue; }

    // Accept either { group, elements } (per-element layers) or a plain L.Layer
    var elements = layerEntry.elements || null;
    var baseLabel = path.join(' › ');

    if (elements && elements.length) {
      for (var e = 0; e < elements.length; e++) {
        overlayMap[baseLabel + ' › ' + elements[e].label] = elements[e].layer;
      }
    } else {
      overlayMap[baseLabel] = layerEntry.group || layerEntry;
    }

    // Walk/create the branch for this path. Intermediate nodes are plain
    // groups; the node for the full path either carries the layer directly
    // or gets one child per display element.
    var siblings = treeNodes;
    for (var j = 0; j < path.length; j++) {
      var name = path[j];
      var isLeaf = (j === path.length - 1);
      var node = null;

      for (var k = 0; k < siblings.length; k++) {
        if (siblings[k].label === name) { node = siblings[k]; break; }
      }
      if (!node) {
        node = { label: name };
        if (!isLeaf) { node.children = []; }
        siblings.push(node);
      }

      if (isLeaf) {
        if (elements && elements.length) {
          if (!node.children) { node.children = []; }
          for (var e2 = 0; e2 < elements.length; e2++) {
            node.children.push({ label: elements[e2].label, layer: elements[e2].layer });
          }
        } else {
          node.layer = layerEntry.group || layerEntry;
        }
      } else {
        // A node may already exist as a leaf and now needs to become a group
        if (!node.children) { node.children = []; }
        siblings = node.children;
      }
    }
  }

  // Every branch (object or group) gets a select-all checkbox
  addSelectAll(treeNodes);

  var collapsed = options.collapsed !== false;

  var control;
  if (typeof L !== 'undefined' && L.control && L.control.layers && L.control.layers.tree) {
    // Real tree control (Leaflet.Control.Layers.Tree)
    control = L.control.layers.tree(null, treeNodes, {
      collapsed: collapsed,
      selectorBack: false,
      labelIsSelector: 'both',
      collapseAll: 'Collapse all',
      expandAll: 'Expand all',
    });
  } else {
    // Fallback: built-in flat control with breadcrumb labels
    control = L.control.layers(null, overlayMap, {
      collapsed: collapsed,
    });
  }

  control._trackReplayTree = treeNodes;
  return control;
}

function addSelectAll(nodes) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].children && nodes[i].children.length) {
      nodes[i].selectAllCheckbox = true;
      addSelectAll(nodes[i].children);
    }
  }
}
