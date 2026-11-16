import * as THREE from 'three'
import { useMemo } from 'react'
import { NOISE_GLSL } from './glsl'
import { MeshBuilder, lin, shade, rng, type V3, type RGB } from './builder'
import { toPts, inPoly, type Pt, type SceneData } from './types'
import { WATER_Y } from './constants'

function flatPolys(polys: Pt[][], y: number, color: (i: number) => RGB) {
  const pos: number[] = []
  const col: number[] = []
  polys.forEach((ps, pi) => {
    if (ps.length < 3) return
    const c = color(pi)
    const faces = THREE.ShapeUtils.triangulateShape(ps.map((p) => new THREE.Vector2(p[0], p[1])), [])
    for (const f of faces) {
      let [i0, i1, i2] = f
      const a = ps[i0], b = ps[i1], cc = ps[i2]
      if ((b[1] - a[1]) * (cc[0] - a[0]) - (b[0] - a[0]) * (cc[1] - a[1]) < 0) [i1, i2] = [i2, i1]
      for (const i of [i0, i1, i2]) {
        pos.push(ps[i][0], y, ps[i][1])
        col.push(c[0], c[1], c[2])
      }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const nor = new Float32Array(pos.length)
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return g
}

/** Land with dusty, patchy ground; beyond the mapped area it fades to a generic city-grain texture. */
function landMaterial(ext: number, flatColor?: string, mask?: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial(flatColor ? { color: flatColor, roughness: 0.96 } : { vertexColors: true, roughness: 0.96, metalness: 0 })
  m.onBeforeCompile = (s) => {
    s.uniforms.uExt = { value: ext }
    s.uniforms.uMask = { value: mask ?? null }
    s.uniforms.uHasMask = { value: mask ? 1 : 0 }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; uniform float uExt; uniform sampler2D uMask; uniform float uHasMask;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 p = vWPos.xz;
          float vd = length(vViewPosition);
          float big = fbm(p * 0.012);
          float fine = fbm(p * 0.35) * (1.0 - smoothstep(60.0, 400.0, vd));
          vec3 c = diffuseColor.rgb * mix(0.78, 1.16, big);
          c *= 1.0 + (fine - 0.45) * 0.35;
          c = mix(c, c * vec3(1.08, 0.98, 0.84), smoothstep(0.45, 0.7, fbm(p * 0.03 + 9.0)));
          // outside the mapped square: roof-sized blocks so the far land reads as city, not desert
          float outside = smoothstep(uExt - 30.0, uExt + 60.0, max(abs(p.x), abs(p.y)));
          if (uHasMask > 0.5 && outside < 1.0) outside = max(outside, smoothstep(0.35, 0.75, texture2D(uMask, (p + uExt) / (2.0 * uExt)).r));
          if (outside > 0.0) {
            vec2 q = vec2(p.x * 0.966 + p.y * 0.257, -p.x * 0.257 + p.y * 0.966);
            q += 9.0 * vec2(vnoise(p * 0.011), vnoise(p * 0.011 + 40.0));
            vec2 cell = floor(q / vec2(17.0, 23.0));
            float h1 = hash21(cell), h2 = hash21(cell + 31.0);
            vec3 roofc = mix(vec3(0.34, 0.31, 0.27), vec3(0.47, 0.42, 0.34), h1);
            roofc = mix(roofc, vec3(0.40, 0.27, 0.20), step(0.9, h2));
            vec2 fq = fract(q / vec2(17.0, 23.0));
            float lane = step(fq.x, 0.14) + step(fq.y, 0.10);
            roofc = mix(roofc, vec3(0.20, 0.19, 0.17), clamp(lane, 0.0, 1.0) * 0.6);
            roofc *= mix(0.8, 1.15, fbm(p * 0.02 + 3.0));
            float aa = 1.0 - smoothstep(1400.0, 5200.0, vd);
            roofc = mix(vec3(0.37, 0.34, 0.29) * mix(0.85, 1.12, fbm(p * 0.004)), roofc, aa);
            // inside the mapped square the grain is only a hint; beyond it, it carries the ground
            float beyond = smoothstep(uExt - 30.0, uExt + 60.0, max(abs(p.x), abs(p.y)));
            c = mix(c, roofc * vec3(1.04, 1.0, 0.93), outside * mix(0.5, 1.0, beyond));
          }
          diffuseColor.rgb = c;
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.22;')
  }
  return m
}

/** Roads and railway as flat ribbons; markings, dusty shoulders, rails and sleepers come from the shader. */
function ribbonGeometry(data: SceneData) {
  const pos: number[] = []
  const col: number[] = []
  const road: number[] = [] // 4 components: u (0..1), d (meters), cls (0..4), width (meters)
  const ASPHALT = [lin('#2c2a27'), lin('#34322e'), lin('#44403a')]
  const SIDEWALK = lin('#a29c90')

  const addQuad = (
    p0: Pt, p1: Pt, p2: Pt, p3: Pt,
    y: number,
    u0: number, u1: number,
    d0: number, d1: number,
    c: RGB, cls: number, w: number
  ) => {
    // Triangle 1: p0, p1, p2
    pos.push(p0[0], y, p0[1], p1[0], y, p1[1], p2[0], y, p2[1])
    col.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2])
    road.push(u0, d0, cls, w, u1, d0, cls, w, u1, d1, cls, w)

    // Triangle 2: p0, p2, p3
    pos.push(p0[0], y, p0[1], p2[0], y, p2[1], p3[0], y, p3[1])
    col.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2])
    road.push(u0, d0, cls, w, u1, d1, cls, w, u0, d1, cls, w)
  }

  const addRoad = (ps: Pt[], w: number, y: number, c: RGB, cls: number) => {
    const n = ps.length
    if (n < 2) return

    const norms: Pt[] = []
    const dist: number[] = [0]

    for (let i = 0; i < n; i++) {
      if (i > 0) dist.push(dist[i - 1] + Math.hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1]))

      let inDx = 0, inDz = 0, inLen = 0
      if (i > 0) {
        inDx = ps[i][0] - ps[i - 1][0]
        inDz = ps[i][1] - ps[i - 1][1]
        inLen = Math.hypot(inDx, inDz)
        if (inLen > 0) { inDx /= inLen; inDz /= inLen }
      }

      let outDx = 0, outDz = 0, outLen = 0
      if (i < n - 1) {
        outDx = ps[i + 1][0] - ps[i][0]
        outDz = ps[i + 1][1] - ps[i][1]
        outLen = Math.hypot(outDx, outDz)
        if (outLen > 0) { outDx /= outLen; outDz /= outLen }
      }

      let avgDx: number, avgDz: number
      if (i === 0) { avgDx = outDx; avgDz = outDz }
      else if (i === n - 1) { avgDx = inDx; avgDz = inDz }
      else {
        avgDx = inDx + outDx
        avgDz = inDz + outDz
        const l = Math.hypot(avgDx, avgDz)
        if (l > 0.01) { avgDx /= l; avgDz /= l } else { avgDx = outDx; avgDz = outDz }
      }

      let nx = -avgDz
      let nz = avgDx
      if (i > 0 && i < n - 1 && outLen > 0) {
        const dot = -outDz * nx + outDx * nz
        const miter = Math.max(0.7, Math.min(1.6, 1 / Math.max(0.25, dot)))
        nx *= miter
        nz *= miter
      }
      norms.push([nx, nz])
    }

    const halfW = w * 0.5

    for (let i = 0; i < n - 1; i++) {
      const p0L: Pt = [ps[i][0] + norms[i][0] * halfW, ps[i][1] + norms[i][1] * halfW]
      const p0R: Pt = [ps[i][0] - norms[i][0] * halfW, ps[i][1] - norms[i][1] * halfW]
      const p1L: Pt = [ps[i + 1][0] + norms[i + 1][0] * halfW, ps[i + 1][1] + norms[i + 1][1] * halfW]
      const p1R: Pt = [ps[i + 1][0] - norms[i + 1][0] * halfW, ps[i + 1][1] - norms[i + 1][1] * halfW]

      // Main continuous asphalt carriageway
      addQuad(p0L, p0R, p1R, p1L, y, 0, 1, dist[i], dist[i + 1], c, cls, w)
    }

    // Seamless junction end caps (disc fan at road endpoints for smooth intersections without white paint)
    if (cls <= 1) {
      for (const endIdx of [0, n - 1]) {
        const center = ps[endIdx]
        const segments = 10
        const rCap = halfW
        for (let s = 0; s < segments; s++) {
          const a0 = (s / segments) * Math.PI * 2
          const a1 = ((s + 1) / segments) * Math.PI * 2
          pos.push(
            center[0], y, center[1],
            center[0] + Math.cos(a0) * rCap, y, center[1] + Math.sin(a0) * rCap,
            center[0] + Math.cos(a1) * rCap, y, center[1] + Math.sin(a1) * rCap
          )
          col.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2])
          // u = 0.2 (pure asphalt, away from centerline 0.5 and shoulder 0.0/1.0)
          road.push(0.2, 0, cls, w, 0.2, 0, cls, w, 0.2, 0, cls, w)
        }
      }
    }
  }

  data.roads.forEach((r, i) => {
    const jit = ((i * 37) % 11) * 0.002
    addRoad(toPts(r.p), r.w, 0.14 + jit, shade(ASPHALT[r.c], 0.95 + ((i * 13) % 7) * 0.02), r.c)
  })

  // Railways
  const addRail = (ps: Pt[], w: number, y: number, c: RGB) => {
    const n = ps.length
    if (n < 2) return
    const halfW = w * 0.5
    for (let i = 0; i < n - 1; i++) {
      const dx = ps[i + 1][0] - ps[i][0]
      const dz = ps[i + 1][1] - ps[i][1]
      const l = Math.hypot(dx, dz) || 1
      const nx = -dz / l
      const nz = dx / l
      const p0L: Pt = [ps[i][0] + nx * halfW, ps[i][1] + nz * halfW]
      const p0R: Pt = [ps[i][0] - nx * halfW, ps[i][1] - nz * halfW]
      const p1L: Pt = [ps[i + 1][0] + nx * halfW, ps[i + 1][1] + nz * halfW]
      const p1R: Pt = [ps[i + 1][0] - nx * halfW, ps[i + 1][1] - nz * halfW]
      addQuad(p0L, p0R, p1R, p1L, y, 0, 1, i * 10, (i + 1) * 10, c, 3, w)
    }
  }
  data.rails.forEach((r, i) => addRail(toPts(r), 3.2, 0.18 + ((i * 7) % 5) * 0.003, lin('#5a5248')))

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 4))
  const nor = new Float32Array(pos.length)
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return g
}

function ribbonMaterial() {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.88, metalness: 0.02, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad; varying vec4 vRoad; varying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vRoad; varying vec3 vWPos;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float railShine = 0.0;
        {
          vec3 c = diffuseColor.rgb;
          float vd = length(vViewPosition);
          float near = 1.0 - smoothstep(120.0, 750.0, vd);
          float across = abs(vRoad.x - 0.5); // 0 at centerline, 0.5 at curb

          if (vRoad.z < 2.5) {
            // Authentic Asphalt Roads
            // Subtle fine asphalt gravel texture
            c *= mix(0.92, 1.08, fbm(vWPos.xz * 0.15));

            // Tire track wear (slightly darker in wheel tracks)
            float wheelL = smoothstep(0.08, 0.22, across) * (1.0 - smoothstep(0.28, 0.42, across));
            c *= 1.0 - 0.08 * wheelL * near;

            // Paint markings (Warm Kolkata Traffic White)
            vec3 paintColor = vec3(0.93, 0.91, 0.86);

            // 1. Solid Outer Shoulder / Curb Line (both sides)
            float outerEdge = smoothstep(0.44, 0.455, across) * (1.0 - smoothstep(0.475, 0.49, across));
            c = mix(c, paintColor, outerEdge * near * 0.88);

            // 2. Dashed Lane Markings
            float dashPattern = step(fract(vRoad.y / 9.0), 0.48);

            // Centerline dash (all roads)
            float centerDash = (1.0 - smoothstep(0.008, 0.016, across)) * dashPattern;
            c = mix(c, paintColor, centerDash * near * 0.90);

            // Multi-lane dividers for wide roads (width >= 13m)
            if (vRoad.w >= 13.0) {
              float lane2Dash = (1.0 - smoothstep(0.008, 0.016, abs(across - 0.22))) * dashPattern;
              c = mix(c, paintColor, lane2Dash * near * 0.88);
            }
          } else if (vRoad.z > 3.5) {
            // Paved Concrete Sidewalks / Curbs
            float slab = step(fract(vRoad.y / 1.6), 0.04);
            c = mix(c, c * 0.78, slab * near * 0.6);
            // Curb stone dark border along road contact
            float curbEdge = 1.0 - smoothstep(0.06, 0.16, vRoad.x);
            c = mix(c, vec3(0.24, 0.23, 0.21), curbEdge * near * 0.85);
          } else {
            // Railway tracks
            float fw = fwidth(vRoad.x);
            float rail = 1.0 - smoothstep(0.035, 0.035 + fw, abs(across - 0.27));
            float sleeper = step(fract(vRoad.y / 0.65), 0.38) * step(across, 0.40);
            c = mix(c, vec3(0.17, 0.14, 0.12), sleeper * near * 0.8);
            c = mix(c, vec3(0.34, 0.33, 0.33), rail * (0.35 + 0.65 * near));
            railShine = rail * near;
          }
          diffuseColor.rgb = c;
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.22;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, railShine);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.9, railShine);')
  }
  return m
}

/** River edge: stone revetment, ghat steps where the ghats are, small pavilions, jetties. */
function bankGeometry(data: SceneData, ghatSpots: { x: number; z: number; half: number }[]) {
  const mb = new MeshBuilder()
  const STONE = lin('#857c6e')
  const STEP_A = lin('#a79c88')
  const STEP_B = lin('#948a78')
  const WALL = lin('#b3a88f')
  const r = rng(11)
  const river = toPts(data.river)
  const up = (a: V3, b: V3, c: V3, d: V3, col: RGB, hint: V3) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] >= 0) mb.quad(a, b, c, d, col)
    else mb.quad(a, d, c, b, col)
  }
  const pavilions: { x: number; z: number; rot: number }[] = []
  for (const bank of data.banks) {
    const ps = toPts(bank)
    // resample to even steps so stairs and wall caps are regular
    const pts: Pt[] = []
    const STEPLEN = 5
    for (let i = 0; i < ps.length - 1; i++) {
      const a = ps[i], b = ps[i + 1]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const n = Math.max(1, Math.round(len / STEPLEN))
      for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
    }
    pts.push(ps[ps.length - 1])
    const isGhat = pts.map((p) => ghatSpots.some((g) => Math.hypot(g.x - p[0], g.z - p[1]) < g.half))
    // outward (into the river) unit normals; river is on the left of travel
    const nrm: Pt[] = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]
      const dx = b[0] - a[0], dz = b[1] - a[1]
      const l = Math.hypot(dx, dz) || 1
      return [dz / l, -dx / l]
    })
    const at = (i: number, o: number, y: number): V3 => [pts[i][0] + nrm[i][0] * o, y, pts[i][1] + nrm[i][1] * o]
    let seenGhat = false
    for (let i = 0; i < pts.length - 1; i++) {
      const j = i + 1
      const far = Math.max(Math.abs(pts[i][0]), Math.abs(pts[i][1])) > 2500
      const hint: V3 = [nrm[i][0], 1.2, nrm[i][1]]
      if (isGhat[i] && isGhat[j]) {
        // broad landing, then steps down into the water
        up(at(i, -3, 0.02), at(i, 0, 0.02), at(j, 0, 0.02), at(j, -3, 0.02), STEP_A, [0, 1, 0])
        const rise = 0.4, run = 0.62
        const nSteps = Math.ceil((1.6 - WATER_Y) / rise)
        for (let s = 0; s < nSteps; s++) {
          const y0 = -s * rise, y1 = y0 - rise
          const o0 = s * run, o1 = o0 + run
          up(at(i, o0, y0), at(i, o0, y1), at(j, o0, y1), at(j, o0, y0), STEP_B, [nrm[i][0], 0, nrm[i][1]])
          up(at(i, o0, y1), at(i, o1, y1), at(j, o1, y1), at(j, o0, y1), s % 2 ? STEP_A : shade(STEP_A, 0.93), [0, 1, 0])
        }
        if (!seenGhat) {
          const k = Math.min(pts.length - 1, i + 6)
          pavilions.push({ x: pts[k][0] - nrm[k][0] * 7, z: pts[k][1] - nrm[k][1] * 7, rot: Math.atan2(-(pts[j][1] - pts[i][1]), pts[j][0] - pts[i][0]) })
          seenGhat = true
        }
      } else {
        seenGhat = false
        // sloping stone revetment
        up(at(i, 0, 0), at(i, 6.5, WATER_Y - 1.8), at(j, 6.5, WATER_Y - 1.8), at(j, 0, 0), shade(STONE, 0.9 + r() * 0.18), hint)
        if (!far) {
          // low river wall along the top
          up(at(i, 0, 0), at(i, 0, 0.9), at(j, 0, 0.9), at(j, 0, 0), WALL, [nrm[i][0], 0, nrm[i][1]])
          up(at(i, -0.5, 0), at(i, -0.5, 0.9), at(j, -0.5, 0.9), at(j, -0.5, 0), WALL, [-nrm[i][0], 0, -nrm[i][1]])
          up(at(i, -0.5, 0.9), at(i, 0, 0.9), at(j, 0, 0.9), at(j, -0.5, 0.9), shade(WALL, 1.1), [0, 1, 0])
        }
      }
    }
  }

  // ghat pavilions: a flat-roofed colonnade, limewashed
  const OCHRE = lin('#d6b060')
  const WHITE = lin('#e2dbc9')
  for (const pv of pavilions) {
    const co = Math.cos(pv.rot), si = Math.sin(pv.rot)
    const P = (lx: number, lz: number): Pt => [pv.x + lx * co + lz * si, pv.z - lx * si + lz * co]
    const [bx, bz] = P(0, 0)
    mb.box(bx, 0.25, bz, 15, 0.5, 7.5, WHITE, pv.rot)
    for (let k = -3; k <= 3; k++)
      for (const lz of [-3, 3]) {
        const [x, z] = P(k * 2.2, lz)
        mb.box(x, 2.4, z, 0.5, 3.8, 0.5, OCHRE, pv.rot)
      }
    mb.box(bx, 4.55, bz, 15.6, 0.6, 8.0, OCHRE, pv.rot)
    mb.box(bx, 5.0, bz, 16.2, 0.3, 8.6, WHITE, pv.rot)
    mb.box(bx, 5.6, bz, 5.0, 0.9, 8.0, OCHRE, pv.rot)
  }

  // jetties and floating pontoons
  const WOOD = lin('#6f6558')
  const PONTOON = lin('#58666a')
  for (const pier of data.piers) {
    const ps = toPts(pier.p)
    const y = WATER_Y + 1.5
    for (let i = 0; i < ps.length - 1; i++) mb.bar([ps[i][0], y, ps[i][1]], [ps[i + 1][0], y, ps[i + 1][1]], 0.35, 3.6, WOOD)
    if (pier.closed) continue
    const a = ps[0], b = ps[ps.length - 1]
    const end = inPoly(b[0], b[1], river) ? b : a
    const other = end === b ? ps[ps.length - 2] : ps[1]
    const rot = Math.atan2(-(end[1] - other[1]), end[0] - other[0]) + Math.PI / 2
    mb.box(end[0], WATER_Y + 0.55, end[1], 30, 1.5, 8.5, PONTOON, rot)
    mb.box(end[0], WATER_Y + 4.3, end[1], 26, 0.25, 7.5, lin('#b9b1a0'), rot)
    for (const sx of [-12, -4, 4, 12])
      for (const sz of [-3.4, 3.4]) {
        const x = end[0] + sx * Math.cos(rot) + sz * Math.sin(rot)
        const z = end[1] - sx * Math.sin(rot) + sz * Math.cos(rot)
        mb.box(x, WATER_Y + 2.8, z, 0.2, 3.0, 0.2, WOOD, rot)
      }
  }
  return mb.build()
}

export function Ground({ data, ghatSpots }: { data: SceneData; ghatSpots: { x: number; z: number; half: number }[] }) {
  const ext = data.meta.half + data.meta.margin
  const land = useMemo(() => flatPolys(data.land.map(toPts), 0, () => lin('#8f8676')), [data])
  const parks = useMemo(
    () => flatPolys(data.parks.map((p) => toPts(p.p)), 0.05, (i) => (data.parks[i].k === 1 ? lin('#77803f') : lin('#4f6233'))),
    [data],
  )
  const ponds = useMemo(() => flatPolys(data.ponds.map(toPts), 0.06, () => lin('#2c3327')), [data])
  const ribbons = useMemo(() => ribbonGeometry(data), [data])
  const banks = useMemo(() => bankGeometry(data, ghatSpots), [data, ghatSpots])
  const mask = useMemo(() => {
    const bin = atob(data.mask.data)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const t = new THREE.DataTexture(arr, data.mask.n, data.mask.n, THREE.RedFormat)
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }, [data])
  const landMat = useMemo(() => landMaterial(ext, undefined, mask), [ext, mask])
  const parkMat = useMemo(() => {
    const m = landMaterial(1e6)
    m.polygonOffset = true
    m.polygonOffsetFactor = -1
    m.polygonOffsetUnits = -3
    return m
  }, [])
  const ribbonMat = useMemo(ribbonMaterial, [])
  const stoneMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;')
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // worn stone flags: joints, per-slab tone, damp staining towards the waterline
            float vd = length(vViewPosition);
            float near = 1.0 - smoothstep(30.0, 160.0, vd);
            vec2 g = vWPos.xz / vec2(1.35, 0.9);
            g.x += 0.5 * floor(g.y);
            vec2 f = fract(g);
            float joint = max(1.0 - smoothstep(0.0, 0.04, f.x), 1.0 - smoothstep(0.0, 0.06, f.y));
            float slab = hash21(floor(g));
            vec3 c = diffuseColor.rgb * mix(0.80, 1.14, fbm(vWPos.xz * 0.12 + vWPos.y));
            c *= 1.0 + (slab - 0.5) * 0.20 * near;
            c *= 1.0 - 0.30 * joint * near;
            c *= mix(0.62, 1.0, smoothstep(${(WATER_Y).toFixed(1)}, ${(WATER_Y + 2.4).toFixed(1)}, vWPos.y));
            c = mix(c, c * vec3(0.72, 0.80, 0.62), (1.0 - smoothstep(${(WATER_Y).toFixed(1)}, ${(WATER_Y + 1.3).toFixed(1)}, vWPos.y)) * 0.7);
            diffuseColor.rgb = c;
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.22;')
    }
    return m
  }, [])
  const pondMat = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    [],
  )
  const farMat = useMemo(() => landMaterial(0, '#8f8676'), [])
  return (
    <group>
      {/* everything out to the horizon, below the river so it only shows past the mapped land */}
      <mesh rotation-x={-Math.PI / 2} position-y={WATER_Y - 2} material={farMat}>
        <circleGeometry args={[30000, 48]} />
      </mesh>
      <mesh geometry={land} material={landMat} receiveShadow />
      <mesh geometry={parks} material={parkMat} receiveShadow />
      <mesh geometry={ponds} material={pondMat} receiveShadow />
      <mesh geometry={ribbons} material={ribbonMat} receiveShadow />
      <mesh geometry={banks} material={stoneMat} castShadow receiveShadow />
    </group>
  )
}
