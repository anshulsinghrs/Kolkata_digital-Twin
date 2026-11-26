// npm run build:scene — turns data/osm-raw.json into data/scene.json (the file the app loads).
// Everything is projected into the single world frame: metres, x east, y up, z south.
import { readFileSync, writeFileSync } from 'node:fs'
import { toWorld, HALF, MARGIN, CENTER } from './geo'

type Pt = [number, number]
type El = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: { type: string; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[]
}

const raw = JSON.parse(readFileSync('data/osm-raw.json', 'utf8')) as { elements: El[]; osm3s?: { timestamp_osm_base?: string } }
const els = raw.elements
const EXT = HALF + MARGIN // buildings/roads kept inside this
const FAR = 18000 // river and land polygons run out to here so the horizon is not an edge

// ---------- geometry helpers ----------
const proj = (g: { lat: number; lon: number }[]): Pt[] => g.map((p) => toWorld(p.lat, p.lon))
const r2 = (v: number) => Math.round(v * 100) / 100
const flat = (ps: Pt[]) => ps.flatMap((p) => [r2(p[0]), r2(p[1])])
const area = (ps: Pt[]) => {
  let a = 0
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    const q = ps[(i + 1) % ps.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}
const centroid = (ps: Pt[]): Pt => {
  let x = 0
  let z = 0
  for (const p of ps) {
    x += p[0]
    z += p[1]
  }
  return [x / ps.length, z / ps.length]
}
const inPoly = (x: number, z: number, ps: Pt[]) => {
  let c = false
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const a = ps[i]
    const b = ps[j]
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}
const openRing = (ps: Pt[]) => {
  const a = ps[0]
  const b = ps[ps.length - 1]
  return ps.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01 ? ps.slice(0, -1) : ps
}
const hash = (n: number, salt = 0) => {
  let h = (n ^ (salt * 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
// Sutherland–Hodgman against an axis-aligned square of half-size L
function clipPoly(ps: Pt[], L: number): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= -L, (a, b) => [-L, a[1] + ((b[1] - a[1]) * (-L - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= L, (a, b) => [L, a[1] + ((b[1] - a[1]) * (L - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= -L, (a, b) => [a[0] + ((b[0] - a[0]) * (-L - a[1])) / (b[1] - a[1]), -L]],
    [(p) => p[1] <= L, (a, b) => [a[0] + ((b[0] - a[0]) * (L - a[1])) / (b[1] - a[1]), L]],
  ]
  let out = ps
  for (const [inside, cut] of edges) {
    const inp = out
    out = []
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i]
      const b = inp[(i + 1) % inp.length]
      const ia = inside(a)
      const ib = inside(b)
      if (ia) out.push(a)
      if (ia !== ib) out.push(cut(a, b))
    }
  }
  return out
}
// Clip a polyline to the square, returning the pieces that survive
function clipLine(ps: Pt[], L: number): Pt[][] {
  const out: Pt[][] = []
  let cur: Pt[] = []
  const inside = (p: Pt) => Math.abs(p[0]) <= L && Math.abs(p[1]) <= L
  const cross = (a: Pt, b: Pt): Pt => {
    // a inside, b outside: walk to the boundary
    let t = 1
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    if (dx > 0) t = Math.min(t, (L - a[0]) / dx)
    if (dx < 0) t = Math.min(t, (-L - a[0]) / dx)
    if (dz > 0) t = Math.min(t, (L - a[1]) / dz)
    if (dz < 0) t = Math.min(t, (-L - a[1]) / dz)
    return [a[0] + dx * t, a[1] + dz * t]
  }
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    if (inside(p)) {
      if (!cur.length && i > 0) cur.push(cross(p, ps[i - 1]))
      cur.push(p)
    } else if (cur.length) {
      cur.push(cross(cur[cur.length - 1], p))
      out.push(cur)
      cur = []
    }
  }
  if (cur.length > 1) out.push(cur)
  return out.filter((c) => c.length > 1)
}

// ---------- river ----------
function stitch(ways: Pt[][]): Pt[][] {
  const left = ways.map((w) => w.slice())
  const rings: Pt[][] = []
  const same = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05
  while (left.length) {
    let cur = left.shift()!
    let grew = true
    while (grew && !same(cur[0], cur[cur.length - 1])) {
      grew = false
      for (let i = 0; i < left.length; i++) {
        const w = left[i]
        if (same(cur[cur.length - 1], w[0])) cur = cur.concat(w.slice(1))
        else if (same(cur[cur.length - 1], w[w.length - 1])) cur = cur.concat(w.slice(0, -1).reverse())
        else if (same(cur[0], w[w.length - 1])) cur = w.slice(0, -1).concat(cur)
        else if (same(cur[0], w[0])) cur = w.slice(1).reverse().concat(cur)
        else continue
        left.splice(i, 1)
        grew = true
        break
      }
    }
    rings.push(openRing(cur))
  }
  return rings
}

const riverRel = els.find((e) => e.type === 'relation' && e.tags?.natural === 'water' && /Hooghly/i.test(e.tags?.name || ''))
if (!riverRel) throw new Error('river relation not found in OSM data')
const riverOuters = stitch(riverRel.members!.filter((m) => m.role === 'outer' && m.geometry).map((m) => proj(m.geometry!)))
const riverFull = riverOuters.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0]
let river = clipPoly(riverFull, FAR)
// drop duplicate consecutive points
river = river.filter((p, i) => {
  const q = river[(i + 1) % river.length]
  return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01
})
const islands = riverRel
  .members!.filter((m) => m.role === 'inner' && m.geometry)
  .map((m) => openRing(proj(m.geometry!)))
  .filter((r) => r.every((p) => Math.abs(p[0]) < FAR && Math.abs(p[1]) < FAR))

// bank chains = runs of the clipped ring that are not on the clip boundary
const onB = (p: Pt) => Math.abs(Math.abs(p[0]) - FAR) < 0.5 || Math.abs(Math.abs(p[1]) - FAR) < 0.5
const chains: Pt[][] = []
{
  const n = river.length
  // start at a boundary vertex so chains are not split by the array seam
  let start = river.findIndex((p, i) => onB(p) && onB(river[(i + 1) % n]))
  if (start < 0) start = 0
  let cur: Pt[] = []
  for (let k = 0; k <= n; k++) {
    const a = river[(start + k) % n]
    const b = river[(start + k + 1) % n]
    const edgeOnBoundary = onB(a) && onB(b) && (Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5)
    if (!edgeOnBoundary) {
      if (!cur.length) cur.push(a)
      cur.push(b)
    } else if (cur.length) {
      chains.push(cur)
      cur = []
    }
  }
  if (cur.length > 1) chains.push(cur)
}
{
  // ignore slivers where the ring merely grazes the clip square
  const plen = (c: Pt[]) => c.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - c[i - 1][0], p[1] - c[i - 1][1]) : 0), 0)
  for (let i = chains.length - 1; i >= 0; i--) if (plen(chains[i]) < 500) chains.splice(i, 1)
}
// perimeter coordinate on the clip square (clockwise seen from above with z down: N edge west->east first)
const perim = (p: Pt) => {
  const [x, z] = p
  if (Math.abs(z + FAR) < 0.6) return x + FAR
  if (Math.abs(x - FAR) < 0.6) return 2 * FAR + (z + FAR)
  if (Math.abs(z - FAR) < 0.6) return 4 * FAR + (FAR - x)
  return 6 * FAR + (FAR - z)
}
const corners: [number, Pt][] = [
  [0, [-FAR, -FAR]],
  [2 * FAR, [FAR, -FAR]],
  [4 * FAR, [FAR, FAR]],
  [6 * FAR, [-FAR, FAR]],
]
const riverProbe = (() => {
  // a point certainly in the river near the origin: scan along x at z = 0
  for (let x = -FAR; x < FAR; x += 5) if (inPoly(x, 0, river) && inPoly(x + 40, 0, river)) return [x + 20, 0] as Pt
  return [0, 0] as Pt
})()
const land: Pt[][] = []
for (const ch of chains) {
  const t0 = perim(ch[ch.length - 1])
  const t1 = perim(ch[0])
  const P = 8 * FAR
  for (const dirn of [1, -1]) {
    const poly = ch.slice()
    // walk the square from the chain's end back to its start
    const span = dirn > 0 ? (t1 - t0 + P) % P : (t0 - t1 + P) % P
    const cs = corners
      .map(([t, c]) => [dirn > 0 ? (t - t0 + P) % P : (t0 - t + P) % P, c] as [number, Pt])
      .filter(([d]) => d > 0 && d < span)
      .sort((a, b) => a[0] - b[0])
    for (const [, c] of cs) poly.push(c)
    if (!inPoly(riverProbe[0], riverProbe[1], poly)) {
      land.push(poly)
      break
    }
  }
}
for (const isl of islands) land.push(isl)

// orient bank lines so the river is on the left of the direction of travel (left = (dz, -dx) in x,z)
const orient = (ch: Pt[]) => {
  const i = Math.floor(ch.length / 2)
  const a = ch[i - 1] ?? ch[0]
  const b = ch[i]
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l = Math.hypot(dx, dz) || 1
  const mx = (a[0] + b[0]) / 2 + (dz / l) * 4
  const mz = (a[1] + b[1]) / 2 - (dx / l) * 4
  return inPoly(mx, mz, river) && !islands.some((s) => inPoly(mx, mz, s)) ? ch : ch.slice().reverse()
}
const banks = chains.map(orient).concat(islands.map((s) => orient(s.concat([s[0]]))))

// ---------- bridge axis ----------
const bridgeOutline = els.find((e) => e.type === 'way' && e.tags?.man_made === 'bridge' && /Howrah|Rabindra/.test(e.tags?.name || ''))
const bridgeRoad = els.find((e) => e.type === 'way' && e.tags?.highway && e.tags?.bridge && /Howrah Bridge/.test(e.tags?.name || ''))
if (!bridgeOutline || !bridgeRoad) throw new Error('Howrah Bridge not found in OSM data')
const bo = openRing(proj(bridgeOutline.geometry!))
const br = proj(bridgeRoad.geometry!)
let bdir: Pt = [br[br.length - 1][0] - br[0][0], br[br.length - 1][1] - br[0][1]]
if (bdir[0] < 0) bdir = [-bdir[0], -bdir[1]]
const bl = Math.hypot(bdir[0], bdir[1])
bdir = [bdir[0] / bl, bdir[1] / bl]
// centre: midpoint of the outline's extent along the axis, on the outline's centreline
const bc0 = centroid(bo)
const along = bo.map((p) => (p[0] - bc0[0]) * bdir[0] + (p[1] - bc0[1]) * bdir[1])
const lat = bo.map((p) => -(p[0] - bc0[0]) * bdir[1] + (p[1] - bc0[1]) * bdir[0])
const sMid = (Math.min(...along) + Math.max(...along)) / 2
const lMid = (Math.min(...lat) + Math.max(...lat)) / 2
const bcen: Pt = [bc0[0] + bdir[0] * sMid - bdir[1] * lMid, bc0[1] + bdir[1] * sMid + bdir[0] * lMid]
const bridgeLen = Math.max(...along) - Math.min(...along)
// where the axis crosses the banks (diagnostic, and used to seat the towers on land)
const crossings: number[] = []
for (let s = -450; s <= 450; s += 1) {
  const a = inPoly(bcen[0] + bdir[0] * s, bcen[1] + bdir[1] * s, river)
  const b = inPoly(bcen[0] + bdir[0] * (s + 1), bcen[1] + bdir[1] * (s + 1), river)
  if (a !== b) crossings.push(s)
}
const toBridge = (p: Pt): Pt => [
  (p[0] - bcen[0]) * bdir[0] + (p[1] - bcen[1]) * bdir[1],
  -(p[0] - bcen[0]) * bdir[1] + (p[1] - bcen[1]) * bdir[0],
]
const inBridgeCorridor = (p: Pt, halfLen = 530, halfW = 24) => {
  const [s, l] = toBridge(p)
  return Math.abs(s) < halfLen && Math.abs(l) < halfW
}

// ---------- buildings ----------
type B = { id: number; p: number[]; holes?: number[][]; h: number; k: number; hs: number }
const buildings: B[] = []
const counts = { tag: 0, levels: 0, est: 0 }
const KIND = { normal: 0, station: 1, shed: 2, platform: 3 }

function estimateHeight(id: number, a: number, tags: Record<string, string>) {
  const r = hash(id, 1)
  const r2_ = hash(id, 2)
  let levels: number
  // Dense north-Kolkata fabric: small plots are low, mid plots are the tall walk-ups,
  // very large footprints are warehouses, markets and sheds.
  if (a < 35) levels = 1 + Math.floor(r * 2)
  else if (a < 120) levels = 2 + Math.floor(r * 3)
  else if (a < 500) levels = 3 + Math.floor(r * 3.4)
  else if (a < 1500) levels = 3 + Math.floor(r * 4)
  else if (a < 5000) levels = 2 + Math.floor(r * 4)
  else levels = 2 + Math.floor(r * 2)
  if (r2_ > 0.965 && a > 250 && a < 2500) levels += 4 + Math.floor(hash(id, 3) * 6) // the odd tower
  const b = tags.building
  if (b === 'hut' || b === 'shed' || b === 'roof') levels = 1
  if (b === 'warehouse' || b === 'industrial') levels = Math.min(levels, 3)
  if (b === 'church') levels = Math.max(levels, 4)
  if (b === 'apartments') levels = Math.max(levels, 5)
  return levels * (3.05 + hash(id, 4) * 0.5) + 0.6
}

function addBuilding(id: number, tags: Record<string, string>, outer: Pt[], holes: Pt[][]) {
  if (tags.building === 'no' || tags.location === 'underground') return
  outer = openRing(outer)
  if (outer.length < 3) return
  const c = centroid(outer)
  if (Math.abs(c[0]) > EXT || Math.abs(c[1]) > EXT) return
  let a = Math.abs(area(outer))
  for (const h of holes) a -= Math.abs(area(h))
  if (a < 6) return
  let kind = KIND.normal
  if (tags.building === 'train_station') kind = KIND.station
  else if (['roof', 'shed', 'warehouse', 'industrial', 'hut'].includes(tags.building) || tags.shelter === 'yes') kind = KIND.shed
  // Hand-built bridge spans +/- 335 m, width 16 m: do not carve out station approach or Strand Road
  if (kind === KIND.normal && inBridgeCorridor(c, 340, 16)) return
  let h: number
  let hs: number
  const th = parseFloat(tags.height || '')
  const tl = parseFloat(tags['building:levels'] || '')
  if (Number.isFinite(th) && th > 0) {
    h = th
    hs = 0
    counts.tag++
  } else if (Number.isFinite(tl) && tl > 0) {
    h = tl * 3.3 + 0.6
    hs = 1
    counts.levels++
  } else {
    h = estimateHeight(id, a, tags)
    hs = 2
    counts.est++
  }
  if (kind === KIND.station) h = tags.height ? h : 19
  if (kind === KIND.shed) h = Math.min(h, 9)
  const b: B = { id, p: flat(outer), h: r2(h), k: kind, hs }
  if (holes.length) b.holes = holes.map((hh) => flat(openRing(hh)))
  buildings.push(b)
}

for (const e of els) {
  const t = e.tags || {}
  if (e.type === 'way' && (t.building || t['building:part']) && e.geometry && e.geometry.length >= 4) {
    addBuilding(e.id, { ...t, building: t.building || t['building:part'] }, proj(e.geometry), [])
  } else if (e.type === 'relation' && t.building && e.members) {
    const outers = stitch(e.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => proj(m.geometry!)))
    const inners = stitch(e.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => proj(m.geometry!)))
    outers.forEach((o, i) => {
      const hs = inners.filter((h) => h.length >= 3 && inPoly(h[0][0], h[0][1], o))
      addBuilding(e.id * 8 + i, t, o, hs)
    })
  }
}

// platforms become low slabs with canopies
const platforms: number[][] = []
for (const e of els) {
  if (e.type === 'way' && e.tags?.railway === 'platform' && e.geometry && e.geometry.length >= 4) {
    const ps = openRing(proj(e.geometry))
    const g0 = e.geometry[0]
    const g1 = e.geometry[e.geometry.length - 1]
    if (g0.lat !== g1.lat || g0.lon !== g1.lon) continue
    if (Math.abs(area(ps)) > 30) platforms.push(flat(ps))
  }
}

// ---------- roads & rail ----------
const ROAD: Record<string, [number, number]> = {
  motorway: [28, 0], motorway_link: [16, 0],
  trunk: [26, 0], trunk_link: [16, 0],
  primary: [24, 0], primary_link: [14, 0],
  secondary: [18, 0], secondary_link: [12, 0],
  tertiary: [14, 0], tertiary_link: [10, 0],
  unclassified: [10, 1], residential: [8.5, 1],
  living_street: [7, 1], service: [6, 1], track: [4.5, 1],
  footway: [3.5, 2], path: [3, 2], steps: [3, 2], pedestrian: [8, 2],
}
const roads: { p: number[]; w: number; c: number }[] = []
const rails: number[][] = []
for (const e of els) {
  const t = e.tags || {}
  if (e.type !== 'way' || !e.geometry) continue
  if (t.highway && ROAD[t.highway] && !t.tunnel && t.area !== 'yes') {
    const ps = proj(e.geometry)
    // Only exclude roads directly on the main bridge span itself (hand-built bridge spans +/- 280m, width 15m)
    if (t.bridge && ps.every((p) => inBridgeCorridor(p, 280, 15))) continue
    let [w, c] = ROAD[t.highway]
    if (t.lanes && Number(t.lanes) > 1) {
      w = Math.max(w, Number(t.lanes) * 3.5)
    }
    if (t.width && Number(t.width) > w) {
      w = Number(t.width)
    }
    for (const piece of clipLine(ps, EXT)) roads.push({ p: flat(piece), w, c })
  } else if (t.railway === 'rail' && !t.tunnel) {
    for (const piece of clipLine(proj(e.geometry), EXT)) rails.push(flat(piece))
  }
}

// ---------- green, ponds, piers, ghats ----------
const parks: { p: number[]; k: number }[] = []
const ponds: number[][] = []
const piers: { p: number[]; closed: boolean }[] = []
for (const e of els) {
  const t = e.tags || {}
  if (e.type !== 'way' || !e.geometry) continue
  const ps = proj(e.geometry)
  const closed = e.geometry[0].lat === e.geometry[e.geometry.length - 1].lat && e.geometry[0].lon === e.geometry[e.geometry.length - 1].lon
  const inExt = ps.some((p) => Math.abs(p[0]) < EXT && Math.abs(p[1]) < EXT)
  if (!inExt) continue
  if (closed && (t.leisure || /grass|forest|recreation_ground|cemetery|meadow|village_green/.test(t.landuse || '') || /wood|scrub/.test(t.natural || ''))) {
    parks.push({ p: flat(clipPoly(openRing(ps), EXT)), k: t.leisure === 'pitch' ? 1 : 0 })
  } else if (closed && t.natural === 'water') {
    ponds.push(flat(openRing(ps)))
  } else if (t.man_made === 'pier') {
    piers.push({ p: flat(closed ? openRing(ps) : ps), closed })
  }
}
const ghats: { x: number; z: number; name: string }[] = []
for (const e of els) {
  if (e.type === 'node' && /ghat/i.test(e.tags?.name || '') && e.tags?.amenity === 'ferry_terminal') {
    const [x, z] = toWorld(e.lat!, e.lon!)
    if (Math.abs(x) < EXT && Math.abs(z) < EXT && !ghats.some((g) => Math.hypot(g.x - x, g.z - z) < 80)) ghats.push({ x: r2(x), z: r2(z), name: e.tags!.name })
  }
}

// ---------- trees ----------
// occupancy grid: 0 free land, 1 building, 2 road, 3 rail/platform, 4 water
const CELL = 8
const GN = Math.ceil((EXT * 2) / CELL)
const grid = new Uint8Array(GN * GN)
const gi = (x: number, z: number) => {
  const i = Math.floor((x + EXT) / CELL)
  const j = Math.floor((z + EXT) / CELL)
  return i < 0 || j < 0 || i >= GN || j >= GN ? -1 : j * GN + i
}
const pts = (f: number[]): Pt[] => {
  const o: Pt[] = []
  for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]])
  return o
}
const fillPoly = (ps: Pt[], v: number, pad = 0) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const p of ps) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1])
  }
  for (let z = z0 - pad; z <= z1 + pad; z += CELL / 2)
    for (let x = x0 - pad; x <= x1 + pad; x += CELL / 2) {
      const k = gi(x, z)
      if (k >= 0 && inPoly(x, z, ps)) grid[k] = v
    }
}
const stamp = (ps: Pt[], rad: number, v: number) => {
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[i]
    const b = ps[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2))
    for (let s = 0; s <= n; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / n
      const z = a[1] + ((b[1] - a[1]) * s) / n
      for (let dz = -rad; dz <= rad; dz += CELL / 2)
        for (let dx = -rad; dx <= rad; dx += CELL / 2) {
          const k = gi(x + dx, z + dz)
          if (k >= 0 && dx * dx + dz * dz <= rad * rad && grid[k] === 0) grid[k] = v
        }
    }
  }
}
const riverNear = clipPoly(river, EXT + 50)
for (let j = 0; j < GN; j++)
  for (let i = 0; i < GN; i++) {
    const x = -EXT + (i + 0.5) * CELL
    const z = -EXT + (j + 0.5) * CELL
    if (inPoly(x, z, riverNear)) grid[j * GN + i] = 4
  }
for (const b of buildings) fillPoly(pts(b.p), 1)
for (const p of platforms) fillPoly(pts(p), 3)
for (const r of roads) stamp(pts(r.p), r.w / 2 + 0.8, 2)
for (const r of rails) stamp(pts(r), 3.2, 3)
for (const p of ponds) fillPoly(pts(p), 4)

const trees: number[] = []
const treePts: Pt[] = []
const freeAround = (x: number, z: number, rad: number) => {
  for (let dz = -rad; dz <= rad; dz += CELL)
    for (let dx = -rad; dx <= rad; dx += CELL) {
      const k = gi(x + dx, z + dz)
      if (k < 0 || grid[k] !== 0) return false
    }
  return true
}
let tseed = 7
const rnd = () => hash(tseed++, 99)
const addTree = (x: number, z: number, scale: number, minGap = 5) => {
  if (inBridgeCorridor([x, z], 340, 18)) return
  for (let i = treePts.length - 1; i >= 0 && i > treePts.length - 400; i--) {
    const q = treePts[i]
    if (Math.abs(q[0] - x) < minGap && Math.abs(q[1] - z) < minGap) return
  }
  treePts.push([x, z])
  trees.push(r2(x), r2(z), r2(scale), r2(rnd()))
}
// along both banks
for (const ch of banks) {
  let carry = 0
  for (let i = 0; i < ch.length - 1; i++) {
    const a = ch[i]
    const b = ch[i + 1]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 0.01) continue
    const dx = (b[0] - a[0]) / len
    const dz = (b[1] - a[1]) / len
    for (let s = carry; s < len; s += 9 + rnd() * 9) {
      const off = 5 + rnd() * 11 // inland = right of travel = (-dz, dx)
      const x = a[0] + dx * s - dz * off
      const z = a[1] + dz * s + dx * off
      if (Math.abs(x) > EXT - 4 || Math.abs(z) > EXT - 4) continue
      if (rnd() < 0.82 && freeAround(x, z, 2)) addTree(x, z, 0.85 + rnd() * 0.75)
      carry = 0
    }
  }
}
// parks and gardens
for (const pk of parks) {
  if (pk.k === 1) continue
  const ps = pts(pk.p)
  if (ps.length < 3) continue
  const n = Math.min(400, Math.floor(Math.abs(area(ps)) / 70))
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const p of ps) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1])
  }
  for (let i = 0; i < n * 3; i++) {
    const x = x0 + rnd() * (x1 - x0)
    const z = z0 + rnd() * (z1 - z0)
    if (inPoly(x, z, ps) && freeAround(x, z, 2)) addTree(x, z, 0.8 + rnd() * 0.9, 6)
  }
}
// street trees on the bigger roads
for (const r of roads) {
  if (r.c !== 0) continue
  const ps = pts(r.p)
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[i]
    const b = ps[i + 1]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1) continue
    const inCore = Math.max(Math.abs(a[0]), Math.abs(a[1])) <= 2600
    const stepBase = inCore ? 16 : 45
    const dx = (b[0] - a[0]) / len
    const dz = (b[1] - a[1]) / len
    for (let s = rnd() * stepBase; s < len; s += stepBase + rnd() * 24) {
      const sg = rnd() < 0.5 ? -1 : 1
      const off = sg * (r.w / 2 + 2.6)
      const x = a[0] + dx * s - dz * off
      const z = a[1] + dz * s + dx * off
      if (rnd() < (inCore ? 0.55 : 0.35) && freeAround(x, z, 0)) addTree(x, z, 0.7 + rnd() * 0.6, 7)
    }
  }
}
// open ground: dense in core 5.5km x 5.5km, parks & arterials cover outer Kolkata
for (let z = -2800; z < 2800; z += 16)
  for (let x = -2800; x < 2800; x += 16) {
    const px = x + rnd() * 10
    const pz = z + rnd() * 10
    if (rnd() < 0.14 && freeAround(px, pz, 6)) addTree(px, pz, 0.8 + rnd() * 0.9, 8)
  }

// ---------- unmapped-ground mask ----------
// OSM building coverage is patchy (especially on the Howrah side). Where the map has land but
// nothing drawn nearby, the ground gets a city-grain texture instead of bare earth. 1 = unmapped.
const MCELL = 24
const MN = Math.ceil((EXT * 2) / MCELL)
const maskBytes = new Uint8Array(MN * MN)
const parkPolys = parks.map((pk) => pts(pk.p))
for (let j = 0; j < MN; j++)
  for (let i = 0; i < MN; i++) {
    const x = -EXT + (i + 0.5) * MCELL
    const z = -EXT + (j + 0.5) * MCELL
    let empty = true
    scan: for (let dz = -36; dz <= 36; dz += CELL)
      for (let dx = -36; dx <= 36; dx += CELL) {
        const k = gi(x + dx, z + dz)
        if (k < 0) continue
        const v = grid[k]
        const d2 = dx * dx + dz * dz
        if ((v === 1 && d2 <= 36 * 36) || ((v === 3 || v === 4) && d2 <= 16 * 16)) {
          empty = false
          break scan
        }
      }
    if (empty && parkPolys.some((pp) => pp.length > 2 && inPoly(x, z, pp))) empty = false
    if (empty && inBridgeCorridor([x, z], 350, 20)) empty = false
    maskBytes[j * MN + i] = empty ? 255 : 0
  }

// ---------- write ----------
const scene = {
  meta: {
    center: CENTER,
    half: HALF,
    margin: MARGIN,
    far: FAR,
    source: '© OpenStreetMap contributors (ODbL), via Overpass API',
    osmBase: raw.osm3s?.timestamp_osm_base ?? null,
    heights: counts,
  },
  bridge: { cx: r2(bcen[0]), cz: r2(bcen[1]), dx: bdir[0], dz: bdir[1], length: r2(bridgeLen) },
  river: flat(river),
  land: land.map(flat),
  banks: banks.map(flat),
  buildings,
  platforms,
  roads,
  rails,
  parks,
  ponds,
  piers,
  ghats,
  trees,
  mask: { n: MN, cell: MCELL, data: Buffer.from(maskBytes).toString('base64') },
}
writeFileSync('data/scene.json', JSON.stringify(scene))
console.log({
  riverPts: river.length,
  chains: chains.map((c) => c.length),
  land: land.map((l) => `${l.length}pts area ${(Math.abs(area(l)) / 1e6).toFixed(1)}km2`),
  islands: islands.length,
  bridge: scene.bridge,
  bankCrossingsAlongAxis: crossings,
  buildings: buildings.length,
  withHoles: buildings.filter((b) => b.holes).length,
  heights: counts,
  platforms: platforms.length,
  roads: roads.length,
  rails: rails.length,
  parks: parks.length,
  ponds: ponds.length,
  piers: piers.length,
  ghats,
  trees: trees.length / 4,
  unmappedShare: (maskBytes.reduce((a, v) => a + (v ? 1 : 0), 0) / maskBytes.length).toFixed(2),
})
