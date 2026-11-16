import * as THREE from 'three'
import { useMemo } from 'react'
import { NOISE_GLSL } from './glsl'
import { lin, rng, shade, type RGB } from './builder'
import { toPts, polyArea, inPoly, type Pt, type SceneData } from './types'

// Kolkata palette: lime-washed yellows and ochres, terracotta, weathered whites, the odd pink or sea-green.
const WALLS: [string, number][] = [
  ['#dcc588', 9], ['#d0b473', 8], ['#e6d5a4', 6], // faded yellow
  ['#bf9450', 6], ['#b08548', 4], // ochre
  ['#ab6a4e', 5], ['#985a45', 3], ['#bd8364', 3], // terracotta
  ['#d9d2c1', 12], ['#c9c2b1', 10], ['#e3dccd', 7], // weathered white
  ['#c79d8c', 3], ['#a0b1a5', 2], ['#95a6b0', 1.5], // pink, sea green, pale blue
  ['#a09a8e', 8], ['#8b867c', 6], // bare cement
]
const WALL_TOTAL = WALLS.reduce((a, w) => a + w[1], 0)
const WALL_LIN = WALLS.map((w) => lin(w[0]))
const ROOFS = ['#8d877d', '#78736b', '#9b9388', '#69655f', '#a59c8e', '#847a6c'].map(lin)
const ROOF_TILE = ['#a3583b', '#8f4c35', '#b06a45'].map(lin)
const ROOF_TIN = ['#8b9092', '#7a6657', '#9aa0a0', '#6f7577', '#8a5c44'].map(lin)
const BRICK = lin('#9a3e2c')
const TANK = [lin('#1d1e20'), lin('#26282b'), lin('#2b3a4a'), lin('#d9d5c8')]

// vertex kinds understood by the shader
const K_WALL = 0, K_ROOF = 1, K_BLANK = 2, K_RIDGED = 3, K_STATION = 4

class Buf {
  pos: number[] = []
  nor: number[] = []
  col: number[] = []
  cell: number[] = []
  info: number[] = []
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: RGB, u: number, vv: number, seed: number, kind: number, floors: number) {
    this.pos.push(x, y, z)
    this.nor.push(nx, ny, nz)
    this.col.push(c[0], c[1], c[2])
    this.cell.push(u, vv)
    this.info.push(seed, kind, floors)
  }
}

function walls(b: Buf, ring: Pt[], y0: number, y1: number, floorsTop: number, c: RGB, seed: number, kind: number, bayW: number, nFloors: number) {
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % n]
    const dx = q[0] - p[0]
    const dz = q[1] - p[1]
    const len = Math.hypot(dx, dz)
    if (len < 0.05) continue
    const nx = dz / len
    const nz = -dx / len
    const bays = len < 1.6 || kind === K_BLANK ? 0 : Math.max(1, Math.round(len / bayW))
    const k = bays === 0 && kind !== K_BLANK ? K_BLANK : kind
    // v runs 0..nFloors over the storeys; the parapet above gets v > nFloors
    const vTop = (nFloors * (y1 - y0)) / Math.max(0.01, floorsTop - y0)
    const s = seed + i * 0.137
    b.v(p[0], y0, p[1], nx, 0, nz, c, 0, 0, s, k, nFloors)
    b.v(q[0], y1, q[1], nx, 0, nz, c, bays, vTop, s, k, nFloors)
    b.v(q[0], y0, q[1], nx, 0, nz, c, bays, 0, s, k, nFloors)
    b.v(p[0], y0, p[1], nx, 0, nz, c, 0, 0, s, k, nFloors)
    b.v(p[0], y1, p[1], nx, 0, nz, c, 0, vTop, s, k, nFloors)
    b.v(q[0], y1, q[1], nx, 0, nz, c, bays, vTop, s, k, nFloors)
  }
}

function roof(b: Buf, outer: Pt[], holes: Pt[][], y: number, c: RGB, seed: number, kind: number) {
  const contour = outer.map((p) => new THREE.Vector2(p[0], p[1]))
  const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])))
  let faces: number[][]
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, hs)
  } catch {
    return
  }
  const all = outer.concat(...holes)
  for (const f of faces) {
    let [i0, i1, i2] = f
    const a = all[i0], bb = all[i1], cc = all[i2]
    // make the triangle face up (+y)
    const ny = (bb[1] - a[1]) * (cc[0] - a[0]) - (bb[0] - a[0]) * (cc[1] - a[1])
    if (ny < 0) [i1, i2] = [i2, i1]
    for (const i of [i0, i1, i2]) b.v(all[i][0], y, all[i][1], 0, 1, 0, c, 0, 0, seed, kind, 0)
  }
}

function box(b: Buf, cx: number, cz: number, y0: number, y1: number, hx: number, hz: number, rot: number, c: RGB, seed: number) {
  const co = Math.cos(rot), si = Math.sin(rot)
  const ring: Pt[] = [[-hx, -hz], [-hx, hz], [hx, hz], [hx, -hz]].map(([x, z]) => [cx + x * co - z * si, cz + x * si + z * co] as Pt)
  if (polyArea(ring) < 0) ring.reverse()
  walls(b, ring, y0, y1, y1, c, seed, K_BLANK, 3, 1)
  roof(b, ring, [], y1, shade(c, 0.9), seed, K_BLANK)
}

function prism(b: Buf, cx: number, cz: number, r: number, y0: number, y1: number, c: RGB, seed: number) {
  const ring: Pt[] = []
  for (let i = 0; i < 8; i++) ring.push([cx + Math.cos((i / 8) * Math.PI * 2) * r, cz + Math.sin((i / 8) * Math.PI * 2) * r])
  if (polyArea(ring) < 0) ring.reverse()
  walls(b, ring, y0, y1, y1, c, seed, K_BLANK, 3, 1)
  roof(b, ring, [], y1, shade(c, 1.15), seed, K_BLANK)
}

function buildGeometry(data: SceneData) {
  const b = new Buf()
  for (const bd of data.buildings) {
    const r = rng(bd.id)
    let outer = toPts(bd.p)
    const A = polyArea(outer)
    if (A < 0) outer = outer.slice().reverse()
    const holes = (bd.holes || []).map((h) => {
      const hp = toPts(h)
      return polyArea(hp) > 0 ? hp.reverse() : hp
    })
    const area = Math.abs(A)
    const seed = r() * 100
    const h = bd.h

    if (bd.k === 1) {
      // the big railway terminus: red brick, banded, with a metal train-shed roof
      const floors = 4
      walls(b, outer, 0, h + 1.2, h, BRICK, seed, K_STATION, 5.2, floors)
      for (const hh of holes) walls(b, hh, 0, h + 1.2, h, BRICK, seed, K_STATION, 5.2, floors)
      roof(b, outer, holes, h, lin('#7d8183'), seed, K_RIDGED)
      continue
    }
    if (bd.k === 2) {
      const tin = ROOF_TIN[Math.floor(r() * ROOF_TIN.length)]
      walls(b, outer, 0, h, h, lin('#8a8377'), seed, K_BLANK, 4, 1)
      roof(b, outer, holes, h, tin, seed, K_RIDGED)
      continue
    }

    // wall colour: weighted pick, then a little per-building drift so neighbours never match exactly
    let t = r() * WALL_TOTAL
    let wi = 0
    for (; wi < WALLS.length - 1; wi++) {
      t -= WALLS[wi][1]
      if (t <= 0) break
    }
    const drift = 0.86 + r() * 0.24
    const wc: RGB = shade(WALL_LIN[wi], drift)
    const low = h < 8.5 && area < 160
    const rc = low && r() < 0.45 ? ROOF_TILE[Math.floor(r() * 3)] : low && r() < 0.35 ? ROOF_TIN[Math.floor(r() * 5)] : ROOFS[Math.floor(r() * ROOFS.length)]
    const floorH = 3.0 + r() * 0.5
    const nFloors = Math.max(1, Math.round((h - 0.4) / floorH))
    const bayW = 2.5 + r() * 1.1
    const parapet = area > 28 && h > 5 ? 0.7 + r() * 0.5 : 0
    walls(b, outer, 0, h + parapet, h, wc, seed, K_WALL, bayW, nFloors)
    for (const hh of holes) walls(b, hh, 0, h + parapet, h, wc, seed + 3, K_WALL, bayW, nFloors)
    roof(b, outer, holes, h, shade(rc, 0.9 + r() * 0.2), seed, K_ROOF)

    // rooftop clutter: stair head-rooms and water tanks give the skyline its texture
    if (area > 60 && h > 6.5) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
      for (const p of outer) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1])
      }
      const inside = (x: number, z: number, m: number) => {
        for (const [ox, oz] of [[-m, -m], [m, -m], [m, m], [-m, m], [0, 0]]) {
          if (!inPoly(x + ox, z + oz, outer)) return false
          for (const hh of holes) if (inPoly(x + ox, z + oz, hh)) return false
        }
        return true
      }
      const pick = (m: number): Pt | null => {
        for (let k = 0; k < 10; k++) {
          const x = x0 + r() * (x1 - x0)
          const z = z0 + r() * (z1 - z0)
          if (inside(x, z, m)) return [x, z]
        }
        return null
      }
      const e0 = outer[0], e1 = outer[1]
      const rot = Math.atan2(e1[1] - e0[1], e1[0] - e0[0])
      if (r() < 0.75) {
        const p = pick(2.4)
        if (p) box(b, p[0], p[1], h, h + 2.5 + r() * 0.6, 1.5 + r() * 0.8, 1.7 + r() * 0.9, rot, shade(wc, 0.92), seed)
      }
      const nt = area > 400 ? 3 : area > 150 ? 2 : 1
      for (let k = 0; k < nt; k++) {
        if (r() < 0.25) continue
        const p = pick(1.5)
        if (!p) continue
        const stand = 0.5 + r() * 1.6
        const rad = 0.75 + r() * 0.45
        box(b, p[0], p[1], h, h + stand, rad * 0.9, rad * 0.9, rot, lin('#6d665c'), seed)
        prism(b, p[0], p[1], rad, h + stand, h + stand + 1.5 + r() * 0.6, TANK[r() < 0.72 ? Math.floor(r() * 2) : 2 + Math.floor(r() * 2)], seed)
      }
    }
  }

  // station towers: square brick towers with pitched caps at the convex corners facing the river
  const station = data.buildings.filter((x) => x.k === 1).sort((a, c) => c.p.length - a.p.length)[0]
  if (station) {
    let ring = toPts(station.p)
    if (polyArea(ring) < 0) ring = ring.slice().reverse()
    const n = ring.length
    const cands: { p: Pt; score: number; rot: number }[] = []
    for (let i = 0; i < n; i++) {
      const a = ring[(i + n - 1) % n], p = ring[i], c = ring[(i + 1) % n]
      const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(c[0] - p[0], c[1] - p[1])
      const cross = (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0])
      const dot = ((p[0] - a[0]) * (c[0] - p[0]) + (p[1] - a[1]) * (c[1] - p[1])) / (l1 * l2)
      if (cross > 0 && Math.abs(dot) < 0.45 && l1 > 9 && l2 > 9) cands.push({ p, score: p[0] - 0.25 * Math.abs(p[1] - 250), rot: Math.atan2(c[1] - p[1], c[0] - p[0]) })
    }
    cands.sort((x, y) => y.score - x.score)
    const used: Pt[] = []
    for (const cd of cands) {
      if (used.length >= 8) break
      if (used.some((u) => Math.hypot(u[0] - cd.p[0], u[1] - cd.p[1]) < 28)) continue
      used.push(cd.p)
      const [x, z] = cd.p
      const top = station.h + 12
      const ringT: Pt[] = [[-5, -5], [-5, 5], [5, 5], [5, -5]].map(([u, w]) => [x + u * Math.cos(cd.rot) - w * Math.sin(cd.rot), z + u * Math.sin(cd.rot) + w * Math.cos(cd.rot)] as Pt)
      if (polyArea(ringT) < 0) ringT.reverse()
      walls(b, ringT, 0, top, top, BRICK, 77, K_STATION, 5, 6)
      box(b, x, z, top, top + 1.0, 5.8, 5.8, cd.rot, lin('#d8c9a8'), 1)
      // pyramid cap
      const cap = lin('#7a3b2c')
      const apex: [number, number, number] = [x, top + 8.5, z]
      const sq: Pt[] = [[-5.2, -5.2], [-5.2, 5.2], [5.2, 5.2], [5.2, -5.2]].map(([u, w]) => [x + u * Math.cos(cd.rot) - w * Math.sin(cd.rot), z + u * Math.sin(cd.rot) + w * Math.cos(cd.rot)] as Pt)
      if (polyArea(sq) < 0) sq.reverse()
      for (let i = 0; i < 4; i++) {
        const p = sq[i], q = sq[(i + 1) % 4]
        const e1 = new THREE.Vector3(q[0] - p[0], 0, q[1] - p[1])
        const e2 = new THREE.Vector3(apex[0] - p[0], apex[1] - (top + 1), apex[2] - p[1])
        const nn = e2.cross(e1).normalize()
        b.v(p[0], top + 1, p[1], nn.x, nn.y, nn.z, cap, 0, 0, 1, K_BLANK, 0)
        b.v(apex[0], apex[1], apex[2], nn.x, nn.y, nn.z, cap, 0, 0, 1, K_BLANK, 0)
        b.v(q[0], top + 1, q[1], nn.x, nn.y, nn.z, cap, 0, 0, 1, K_BLANK, 0)
      }
    }
  }

  // platforms: a low slab with a long canopy on top
  for (const pf of data.platforms) {
    let ring = toPts(pf)
    if (polyArea(ring) < 0) ring = ring.reverse()
    walls(b, ring, 0, 1.0, 1.0, lin('#8f8a80'), 5, K_BLANK, 4, 1)
    roof(b, ring, [], 1.0, lin('#9a958a'), 5, K_BLANK)
    walls(b, ring, 5.0, 5.5, 5.5, lin('#6f6f6c'), 6, K_BLANK, 4, 1)
    roof(b, ring, [], 5.5, lin('#8d9192'), 6, K_RIDGED)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3))
  g.setAttribute('aCell', new THREE.Float32BufferAttribute(b.cell, 2))
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(b.info, 3))
  g.computeBoundingSphere()
  return g
}

function makeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aCell; attribute vec3 aInfo;
        varying vec2 vCell; varying vec3 vInfo; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCell = aCell; vInfo = aInfo; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vCell; varying vec3 vInfo; varying vec3 vWPos;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float winGlass = 0.0; float winLit = 0.0;
        {
          vec3 base = diffuseColor.rgb;
          float vd = length(vViewPosition);
          float kind = vInfo.y;
          // weathering: broad blotches, and on walls rain streaks from the top and grime at the foot
          float n1 = fbm(vWPos.xz * 0.07 + vWPos.y * 0.09 + vInfo.x);
          base *= mix(0.66, 1.14, n1);
          bool isWall = kind < 0.5 || kind > 3.5;
          if (kind < 0.5 || kind > 1.5) {
            if (abs(vNormal.y) < 0.5) {
              float streak = vnoise(vec2(dot(vWPos.xz, vec2(0.83, 0.56)) * 1.7, vWPos.y * 0.16 + vInfo.x));
              base *= mix(0.70, 1.05, streak * streak);
              base *= mix(0.62, 1.0, smoothstep(0.0, 3.5, vWPos.y));
              // soot and damp under the roof line and on older walls
              base = mix(base, base * vec3(0.62, 0.60, 0.58), smoothstep(0.55, 0.85, fbm(vWPos.xz * 0.21 + vWPos.y * 0.33 + vInfo.x * 3.0)) * 0.6);
            }
          }
          if (isWall && gl_FrontFacing) {
            vec2 c = vCell; vec2 id = floor(c); vec2 f = fract(c);
            float nF = vInfo.z;
            vec2 fw = fwidth(c);
            float fade = (1.0 - smoothstep(420.0, 1000.0, vd)) * (1.0 - smoothstep(0.30, 0.75, max(fw.x, fw.y)));
            if (c.y < nF) {
              float rr = hash21(id + floor(vInfo.x * 31.0));
              float rb = hash21(vec2(floor(vInfo.x * 13.0), 3.0));
              bool ground = id.y < 0.5;
              vec2 lo = vec2(0.27, 0.20), hi = vec2(0.73, 0.80);
              if (kind > 3.5) { lo = vec2(0.30, 0.16); hi = vec2(0.70, 0.84); }
              if (ground) { lo = vec2(0.10, 0.0); hi = vec2(0.90, 0.74); }
              vec2 e = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
              float m = e.x * e.y;
              // window surround: a paler plaster frame
              vec2 lo2 = lo - vec2(0.045, 0.05), hi2 = hi + vec2(0.045, 0.05);
              vec2 e2 = smoothstep(lo2 - fw, lo2 + fw, f) * (1.0 - smoothstep(hi2 - fw, hi2 + fw, f));
              float frame = e2.x * e2.y * (1.0 - m);
              vec3 trim = kind > 3.5 ? vec3(0.78, 0.70, 0.55) : mix(base * 1.25, vec3(0.72, 0.68, 0.60), 0.35);
              base = mix(base, trim, frame * fade * (ground ? 0.0 : 0.8));
              // what fills the opening: louvred green shutters, dark glass, or a lit room
              bool shut = rr < 0.52;
              bool lit = rr > 0.972;
              vec3 green = mix(vec3(0.040, 0.125, 0.075), vec3(0.060, 0.150, 0.125), rb);
              green = mix(green, vec3(0.20, 0.13, 0.08), step(0.82, rb));        // some are brown teak
              float slats = 0.72 + 0.28 * step(0.5, fract(f.y * 13.0));
              float leaf = 1.0 - 0.35 * smoothstep(0.0, fw.x * 2.0 + 0.012, 0.012 - abs(f.x - 0.5));
              vec3 fill = shut ? green * slats * leaf : vec3(0.022, 0.028, 0.034);
              if (ground) {
                float gr = hash21(id + 7.0 + floor(vInfo.x * 5.0));
                fill = gr < 0.5 ? vec3(0.035, 0.03, 0.028) : mix(vec3(0.20, 0.22, 0.24), vec3(0.30, 0.16, 0.10), step(0.75, gr)) * (0.75 + 0.25 * step(0.5, fract(f.y * 22.0)));
                shut = true;
              }
              base = mix(base, fill, m * fade);
              // string course at each floor line, and a sill shadow
              float band = 1.0 - smoothstep(0.035, 0.035 + fw.y, f.y);
              base *= 1.0 - 0.16 * band * fade;
              base *= mix(0.86, 1.0, fade);   // keep the average tone when windows dissolve
              winGlass = m * fade * (shut ? 0.0 : 1.0);
              winLit = m * fade * (lit && !ground ? 1.0 : 0.0);
            } else {
              // parapet: cornice line
              float cor = 1.0 - smoothstep(0.0, 0.10 + fw.y, c.y - nF);
              base *= 1.0 + 0.10 * cor * fade;
            }
            if (kind > 3.5) {
              // cream banding on the brick terminus
              float bandS = smoothstep(0.86, 0.90, f.y) + (1.0 - smoothstep(0.03, 0.06, f.y));
              base = mix(base, vec3(0.74, 0.66, 0.50), clamp(bandS, 0.0, 1.0) * 0.8 * fade * step(c.y, nF));
            }
          } else if (kind > 2.5 && kind < 3.5) {
            // ridged metal roofs: alternating lit and shaded pitches
            float rid = fract(dot(vWPos.xz, vec2(0.966, 0.257)) / 16.0);
            base *= mix(0.72, 1.12, smoothstep(0.0, 0.5, rid) * (1.0 - smoothstep(0.5, 0.56, rid)) + step(0.56, rid) * 0.25);
            base *= 0.92 + 0.08 * step(0.5, fract(dot(vWPos.xz, vec2(-0.257, 0.966)) / 1.1));
          } else if (kind > 0.5 && kind < 1.5) {
            base *= mix(0.80, 1.08, vnoise(vWPos.xz * 0.45 + vInfo.x));
          }
          diffuseColor.rgb = base;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.10, winGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.55, 0.22) * winLit * 0.85 + diffuseColor.rgb * 0.20;`)
  }
  return m
}

export function Buildings({ data }: { data: SceneData }) {
  const geometry = useMemo(() => buildGeometry(data), [data])
  const material = useMemo(makeMaterial, [])
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}
