/**
 * Web-Mercator (slippy-map) projection maths for the office-location picker.
 *
 * The picker shows a Geoapify STATIC map image with the pin fixed at the
 * centre. To let the user click / drag / zoom without a JS map SDK we do the
 * same pixel↔coordinate maths a tile map does internally:
 *
 *  - click at pixel (x,y)  → the lat/lng under that pixel  (pointAt)
 *  - drag the map by (dx,dy) px → the map's new centre       (panCenter)
 *  - a clock-in radius in metres → its pixel size at a zoom  (metersPerPixel)
 *  - a radius that should fit the view → a sensible zoom      (zoomForRadius)
 *
 * All standard EPSG:3857 with a 256-px tile, matching Geoapify's static tiles.
 */

const TILE = 256;
const EARTH_CIRCUMFERENCE_PX_Z0 = 156543.03392; // metres/pixel at the equator, zoom 0
const DEG = Math.PI / 180;

function worldSize(zoom: number): number {
  return TILE * Math.pow(2, zoom);
}

/** Ground resolution (metres per screen pixel) at a latitude + zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_PX_Z0 * Math.cos(lat * DEG)) / Math.pow(2, zoom);
}

/** lat/lng → absolute world-pixel coordinates at a zoom. */
export function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const ws = worldSize(zoom);
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin(clampedLat * DEG);
  return {
    x: ((lng + 180) / 360) * ws,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * ws,
  };
}

/** Absolute world-pixel coordinates → lat/lng at a zoom. */
export function unproject(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const ws = worldSize(zoom);
  const lng = (x / ws) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / ws;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

/**
 * The lat/lng under pixel (px,py) of a `w`×`h` image centred at (lat,lng).
 * Used for click-to-place: the clicked point becomes the new centre/pin.
 */
export function pointAt(
  lat: number,
  lng: number,
  zoom: number,
  px: number,
  py: number,
  w: number,
  h: number,
): { lat: number; lng: number } {
  const c = project(lat, lng, zoom);
  return unproject(c.x + (px - w / 2), c.y + (py - h / 2), zoom);
}

/**
 * New map centre after the image is dragged by (dx,dy) screen pixels
 * (image moved right/down = positive). Dragging the map right reveals content
 * to the west, so the centre shifts opposite the drag.
 */
export function panCenter(
  lat: number,
  lng: number,
  zoom: number,
  dx: number,
  dy: number,
): { lat: number; lng: number } {
  const c = project(lat, lng, zoom);
  return unproject(c.x - dx, c.y - dy, zoom);
}

/**
 * A zoom at which a circle of `radiusM` metres fills about `frac` of a
 * `heightPx`-tall view — so a freshly-opened office fills the frame nicely
 * rather than being a dot or overflowing. Clamped to sane map zooms.
 */
export function zoomForRadius(
  lat: number,
  radiusM: number,
  heightPx: number,
  frac = 0.6,
): number {
  const safeRadius = Math.max(radiusM, 1);
  // want circle diameter (2·radius/mpp) ≤ heightPx·frac  →  solve for zoom
  const z = Math.log2(
    (heightPx * frac * EARTH_CIRCUMFERENCE_PX_Z0 * Math.cos(lat * DEG)) /
      (2 * safeRadius),
  );
  return Math.max(3, Math.min(19, Math.round(z)));
}
