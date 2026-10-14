/**
 * GCJ02 — WGS-84 ⇄ GCJ-02 ("火星坐标系") coordinate conversion.
 *
 * GCJ-02 is the mandatory obfuscated datum for public maps in mainland China
 * (AMap/高德, Tencent, Google China). Tiles from those providers are rendered
 * from GCJ-02 geometry, while GPS devices and most exported datasets are
 * WGS-84 — plotting one on the other is off by roughly 300–600 m.
 *
 * The forward shift (WGS-84 → GCJ-02) is the publicly documented closed-form
 * polynomial on the Krasovsky 1940 ellipsoid; the inverse has no closed form
 * and is computed by iteration (converges to < 1e-9° — sub-millimetre — in a
 * few rounds). Outside China the transform is a no-op: the algorithm is only
 * defined for China, and providers don't shift there.
 *
 * Coordinates are `[lng, lat]` in degrees, matching GeoJSON axis order.
 */

var PI = Math.PI;
var A = 6378245.0;               // Krasovsky 1940 semi-major axis (m)
var EE = 0.00669342162296594323; // first eccentricity squared

/**
 * True when the point lies outside China's bounding box (where GCJ-02 is not
 * applied). Deliberately a rough box — it only guards the shift near borders.
 *
 * @param {number} lng
 * @param {number} lat
 * @returns {boolean}
 */
export function outOfChina(lng, lat) {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x, y) {
  var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

/**
 * WGS-84 → GCJ-02 (closed form).
 *
 * @param {number} lng - WGS-84 longitude
 * @param {number} lat - WGS-84 latitude
 * @returns {number[]} [lng, lat] in GCJ-02
 */
export function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) { return [lng, lat]; }

  var dLat = transformLat(lng - 105.0, lat - 35.0);
  var dLng = transformLng(lng - 105.0, lat - 35.0);
  var radLat = lat / 180.0 * PI;
  var magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  var sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);

  return [lng + dLng, lat + dLat];
}

/**
 * GCJ-02 → WGS-84 (iterative inverse of {@link wgs84ToGcj02}).
 *
 * @param {number} lng - GCJ-02 longitude
 * @param {number} lat - GCJ-02 latitude
 * @returns {number[]} [lng, lat] in WGS-84
 */
export function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) { return [lng, lat]; }

  var wgsLng = lng;
  var wgsLat = lat;
  for (var i = 0; i < 10; i++) {
    var gcj = wgs84ToGcj02(wgsLng, wgsLat);
    var dLng = gcj[0] - lng;
    var dLat = gcj[1] - lat;
    if (Math.abs(dLng) < 1e-9 && Math.abs(dLat) < 1e-9) { break; }
    wgsLng -= dLng;
    wgsLat -= dLat;
  }
  return [wgsLng, wgsLat];
}
