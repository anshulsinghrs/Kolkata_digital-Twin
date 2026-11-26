// One world frame for everything: metres, x east, y up, z south, origin at CENTER.
export const CENTER = { lat: 22.5851, lon: 88.3468 }
export const HALF = 3000 // core hero extent
export const MARGIN = 10000 // full Kolkata + CCU Airport extent: 26 km x 26 km (+/- 13000 m)
const R = 6378137
const D2R = Math.PI / 180
const KX = R * D2R * Math.cos(CENTER.lat * D2R)
const KZ = R * D2R
export const toWorld = (lat: number, lon: number): [number, number] => [
  (lon - CENTER.lon) * KX,
  -(lat - CENTER.lat) * KZ,
]
export const bbox = (half: number) => ({
  s: CENTER.lat - half / KZ,
  n: CENTER.lat + half / KZ,
  w: CENTER.lon - half / KX,
  e: CENTER.lon + half / KX,
})
