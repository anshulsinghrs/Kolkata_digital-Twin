import * as THREE from 'three'
import { useMemo } from 'react'
import { MeshBuilder, lin, shade, rng, type V3, type RGB } from './builder'
import { DECK_Y, WATER_Y } from './constants'
import { NOISE_GLSL } from './glsl'

/**
 * Hand-modelled balanced-cantilever truss bridge (the signature piece).
 * Local frame: X along the bridge axis (0 at mid-river), Y up, Z across.
 * Proportions follow the real structure: 457 m main span between two 85 m
 * towers, 99 m anchor arms, a suspended centre span, K-braced webs and a
 * deck hung below the lower chord on hangers.
 */
export const BRIDGE = {
  halfMain: 228.6,
  anchor: 99,
  panel: 15.24,
  tip: 91.44, // cantilever tips / ends of the suspended span
  towerH: 85,
  zT: 11.6, // half spacing of the two truss planes
  roadHalf: 10.4,
  walk: 4.6,
  ramp: 10,
}
const B = BRIDGE
const END = B.halfMain + B.anchor // 327.6 m (Anchor arm monoliths on the river banks)
export const RAMP_END = 352.0 // 352.0 m: bridge deck curves and merges directly into Road 2 & Brabourne Flyover
export const KOLKATA_CONNECT_END = 352.0

/** Centerline lateral position (Z in bridge frame, positive = South) */
export function roadCenterZ(s: number): number {
  if (s <= 326.0) return 0
  if (s <= 352.0) {
    const t = (s - 326.0) / (352.0 - 326.0)
    return 88.0 * (t * t * (3 - 2 * t))
  }
  return 88.0
}

export const deckY = (s: number) => {
  if (s >= -B.halfMain && s <= B.halfMain) {
    // Parabolic camber across the river (mid-river 11.4m, river towers 8.8m)
    return DECK_Y + 2.6 * (1 - (s / B.halfMain) ** 2)
  }
  if (s > B.halfMain) {
    // Kolkata approach ramp descending from river tower (8.8m) down to ground level (0.14m)
    const t = Math.min(1, Math.max(0, (s - B.halfMain) / (336.0 - B.halfMain)))
    return THREE.MathUtils.lerp(DECK_Y, 0.14, t * t * (3 - 2 * t))
  }
  // Howrah approach ramp
  const t = Math.min(1, Math.max(0, (-s - B.halfMain) / (336.0 - B.halfMain)))
  return THREE.MathUtils.lerp(DECK_Y, 0.14, t * t * (3 - 2 * t))
}
const lowerY = (s: number) => {
  const a = Math.abs(s)
  if (a <= B.halfMain) return deckY(s) + 1.6 + 10.5 * (1 - (a / B.halfMain) ** 2)
  return deckY(s) + 1.6
}
const topY = (s: number) => {
  const a = Math.abs(s)
  if (a <= B.tip) return DECK_Y + 41 + 4.5 * (1 - (a / B.tip) ** 2)
  if (a <= B.halfMain) return DECK_Y + 41 + (B.towerH - 41) * ((a - B.tip) / (B.halfMain - B.tip)) ** 1.75
  const t = Math.min(1, (a - B.halfMain) / B.anchor)
  return DECK_Y + 22 + (B.towerH - 22) * (1 - t) ** 1.55
}

function buildBridge() {
  const steel = new MeshBuilder()
  const matte = new MeshBuilder()
  const lamps = new MeshBuilder()
  const r = rng(1943)

  const STEEL = lin('#9ea4a8')
  const sc = (): RGB => shade(STEEL, 0.88 + r() * 0.2)
  const ASPHALT = lin('#66625c')
  const WALK = lin('#9e978a')
  const CONCRETE = lin('#aba598')
  const STONE = lin('#8e877a')

  // panel points
  const nodes: number[] = []
  for (let j = 6; j >= 1; j--) nodes.push(-(B.halfMain + (j * B.anchor) / 6))
  for (let k = -15; k <= 15; k++) nodes.push(k * B.panel)
  for (let j = 1; j <= 6; j++) nodes.push(B.halfMain + (j * B.anchor) / 6)
  const isTower = (s: number) => Math.abs(Math.abs(s) - B.halfMain) < 0.01

  for (const z of [-B.zT, B.zT]) {
    for (let i = 0; i < nodes.length; i++) {
      const s = nodes[i]
      const lo = lowerY(s)
      const hi = topY(s)
      // verticals (towers are heavier and run down to the pier)
      if (isTower(s)) {
        steel.bar([s, DECK_Y - 2, z], [s, hi + 2.5, z], 3.4, 3.0, shade(STEEL, 0.95))
        steel.box(s, hi + 3.2, z, 4.6, 1.4, 4.2, shade(STEEL, 0.9))
      } else {
        steel.bar([s, lo, z], [s, hi, z], 1.0, 1.1, sc())
      }
      // gusset plates at chord joints
      steel.box(s, hi, z, 3.0, 2.6, 1.5, sc())
      steel.box(s, lo, z, 3.0, 2.4, 1.5, sc())
      if (i === nodes.length - 1) break
      const s2 = nodes[i + 1]
      const lo2 = lowerY(s2)
      const hi2 = topY(s2)
      // chords
      steel.bar([s, hi, z], [s2, hi2, z], 1.7, 1.5, sc())
      steel.bar([s, lo, z], [s2, lo2, z], 1.7, 1.5, sc())
      // K-braced web, in tiers where the truss is deep
      const hA = hi - lo
      const hB = hi2 - lo2
      const stemAtB = hB >= hA
      const n = Math.max(1, Math.round(Math.max(hA, hB) / 27))
      for (let t = 0; t < n; t++) {
        const f0 = t / n
        const f1 = (t + 1) / n
        const a0: V3 = [s, lo + hA * f0, z]
        const a1: V3 = [s, lo + hA * f1, z]
        const b0: V3 = [s2, lo2 + hB * f0, z]
        const b1: V3 = [s2, lo2 + hB * f1, z]
        if (stemAtB) {
          const mid: V3 = [s2, (b0[1] + b1[1]) / 2, z]
          steel.bar(a0, mid, 0.85, 0.9, sc())
          steel.bar(a1, mid, 0.85, 0.9, sc())
          steel.box(mid[0], mid[1], z, 2.0, 2.4, 1.3, sc())
        } else {
          const mid: V3 = [s, (a0[1] + a1[1]) / 2, z]
          steel.bar(b0, mid, 0.85, 0.9, sc())
          steel.bar(b1, mid, 0.85, 0.9, sc())
          steel.box(mid[0], mid[1], z, 2.0, 2.4, 1.3, sc())
        }
        if (t > 0) steel.bar(a0, b0, 0.7, 0.8, sc())
      }
      // hangers carrying the deck
      if (lo - deckY(s) > 2.2 && !isTower(s)) steel.bar([s, deckY(s) - 0.5, z], [s, lo, z], 0.34, 0.34, sc())
    }
  }

  // bracing between the two truss planes
  for (let i = 0; i < nodes.length; i++) {
    const s = nodes[i]
    const lo = lowerY(s)
    const hi = topY(s)
    const clear = lo - deckY(s) > 7.2
    steel.bar([s, hi, -B.zT], [s, hi, B.zT], 0.9, 0.8, sc())
    if (clear) steel.bar([s, lo, -B.zT], [s, lo, B.zT], 0.9, 0.8, sc())
    if (isTower(s)) {
      // tower portal: struts and X-bracing all the way up, clear of the roadway
      const y0 = deckY(s) + 9.5
      const tiers = 6
      const dy = (hi - y0) / tiers
      for (let t = 0; t <= tiers; t++) {
        const y = y0 + t * dy
        steel.bar([s, y, -B.zT], [s, y, B.zT], 1.3, 1.2, sc())
        if (t < tiers) {
          steel.bar([s, y, -B.zT], [s, y + dy, B.zT], 0.7, 0.7, sc())
          steel.bar([s, y, B.zT], [s, y + dy, -B.zT], 0.7, 0.7, sc())
        }
      }
      // arched portal knee braces
      steel.bar([s, y0 - 4.5, -B.zT], [s, y0, -B.zT + 5], 0.8, 0.8, sc())
      steel.bar([s, y0 - 4.5, B.zT], [s, y0, B.zT - 5], 0.8, 0.8, sc())
    } else if (hi - lo > 18 && clear && i % 2 === 0) {
      // sway frames in the upper part of the truss
      const y = Math.max(lo, hi - 14)
      steel.bar([s, y, -B.zT], [s, hi, B.zT], 0.5, 0.5, sc())
      steel.bar([s, y, B.zT], [s, hi, -B.zT], 0.5, 0.5, sc())
      if (y > lo + 1) steel.bar([s, y, -B.zT], [s, y, B.zT], 0.6, 0.6, sc())
    }
    if (i === nodes.length - 1) break
    const s2 = nodes[i + 1]
    // top lateral X
    steel.bar([s, hi, -B.zT], [s2, topY(s2), B.zT], 0.5, 0.5, sc())
    steel.bar([s, hi, B.zT], [s2, topY(s2), -B.zT], 0.5, 0.5, sc())
    if (clear && lowerY(s2) - deckY(s2) > 7.2) {
      steel.bar([s, lo, -B.zT], [s2, lowerY(s2), B.zT], 0.45, 0.45, sc())
      steel.bar([s, lo, B.zT], [s2, lowerY(s2), -B.zT], 0.45, 0.45, sc())
    }
  }

  // Roadway and footpaths:
  // Continuous carriageway from Howrah bank (-336m) to Kolkata bank (+352m),
  // smoothly curving into Road 2 & Brabourne Flyover on the Kolkata bank!
  const walkIn = B.zT + 1.0
  const walkOut = walkIn + B.walk
  const sStart = -336.0
  const sEnd = 352.0
  const STEP = 4.0 // 4m steps for smooth curve geometry

  for (let s = sStart; s < sEnd - 0.01; s += STEP) {
    const s2 = Math.min(s + STEP, sEnd)
    const y1 = deckY(s)
    const y2 = deckY(s2)
    const z1 = roadCenterZ(s)
    const z2 = roadCenterZ(s2)

    const onBridge = s >= -END && s2 <= END
    const roadW = onBridge ? B.roadHalf + 1.2 : 12.0
    const walkW = onBridge ? B.walk : 3.5

    // Clean, unskewed cross-section vertices at s and s2
    // Road asphalt surface corners
    const rL1: V3 = [s, y1, z1 - roadW]
    const rR1: V3 = [s, y1, z1 + roadW]
    const rL2: V3 = [s2, y2, z2 - roadW]
    const rR2: V3 = [s2, y2, z2 + roadW]

    matte.quad(rL1, rR1, rR2, rL2, ASPHALT)

    // Sidewalks flanking the carriageway
    const wL1_out: V3 = [s, y1 + 0.12, z1 - roadW - walkW]
    const wL1_in: V3 = [s, y1 + 0.12, z1 - roadW]
    const wL2_out: V3 = [s2, y2 + 0.12, z2 - roadW - walkW]
    const wL2_in: V3 = [s2, y2 + 0.12, z2 - roadW]
    matte.quad(wL1_out, wL1_in, wL2_in, wL2_out, WALK)

    const wR1_in: V3 = [s, y1 + 0.12, z1 + roadW]
    const wR1_out: V3 = [s, y1 + 0.12, z1 + roadW + walkW]
    const wR2_in: V3 = [s2, y2 + 0.12, z2 + roadW]
    const wR2_out: V3 = [s2, y2 + 0.12, z2 + roadW + walkW]
    matte.quad(wR1_in, wR1_out, wR2_out, wR1_out, WALK)

    // Kerbs between road and footpaths
    matte.quad(
      [rL1[0], y1, rL1[2]],
      [wL1_in[0], y1 + 0.12, wL1_in[2]],
      [wL2_in[0], y2 + 0.12, wL2_in[2]],
      [rL2[0], y2, rL2[2]],
      CONCRETE
    )
    matte.quad(
      [wR1_in[0], y1 + 0.12, wR1_in[2]],
      [rR1[0], y1, rR1[2]],
      [rR2[0], y2, rR2[2]],
      [wR2_in[0], y2 + 0.12, wR2_in[2]],
      CONCRETE
    )

    // Outer retaining walls down to the ground where elevated
    if (y1 > 0.25 || y2 > 0.25) {
      matte.quad(
        [wL1_out[0], -0.5, wL1_out[2]],
        [wL1_out[0], y1 + 0.1, wL1_out[2]],
        [wL2_out[0], y2 + 0.1, wL2_out[2]],
        [wL2_out[0], -0.5, wL2_out[2]],
        STONE
      )
      matte.quad(
        [wR1_out[0], -0.5, wR1_out[2]],
        [wR2_out[0], -0.5, wR2_out[2]],
        [wR2_out[0], y2 + 0.1, wR2_out[2]],
        [wR1_out[0], y1 + 0.1, wR1_out[2]],
        STONE
      )
    }

    // Outer railings along the cantilever span and early approach
    if (s >= -END - 4 && s2 <= END + 4) {
      for (const h of [0.55, 1.15]) {
        steel.bar([wL1_out[0], y1 + h, wL1_out[2]], [wL2_out[0], y2 + h, wL2_out[2]], 0.08, 0.08, STEEL)
        steel.bar([wR1_out[0], y1 + h, wR1_out[2]], [wR2_out[0], y2 + h, wR2_out[2]], 0.08, 0.08, STEEL)
      }
      steel.bar([wL1_out[0], y1, wL1_out[2]], [wL1_out[0], y1 + 1.2, wL1_out[2]], 0.1, 0.1, STEEL)
      steel.bar([wR1_out[0], y1, wR1_out[2]], [wR1_out[0], y1 + 1.2, wR1_out[2]], 0.1, 0.1, STEEL)
    }

    if (onBridge) {
      // stringers under the deck edges
      for (const sg of [-1, 1]) {
        steel.bar([s, y1 - 1.5, sg * B.zT], [s2, y2 - 1.5, sg * B.zT], 2.0, 0.7, shade(STEEL, 0.8))
        steel.bar([s, y1 - 1.1, sg * 4], [s2, y2 - 1.1, sg * 4], 1.1, 0.4, shade(STEEL, 0.75))
      }
      // floor beams
      steel.bar([s, y1 - 1.4, -walkOut], [s, y1 - 1.4, walkOut], 1.5, 0.5, shade(STEEL, 0.78))
    }

    // Dashed lane lines along the curve
    const smid = (s + s2) / 2
    const ymid = deckY(smid)
    const zmid = roadCenterZ(smid)
    const ds = s2 - s
    const dz = z2 - z1
    const segLen = Math.hypot(ds, dz) || 1
    const tx = ds / segLen
    const tz = dz / segLen

    for (const f of [-0.68, -0.34, 0, 0.34, 0.68]) {
      const zl = zmid + f * roadW
      const p1: V3 = [smid - tx * 1.5, ymid + 0.02, zl - tz * 1.5]
      const p2: V3 = [smid + tx * 1.5, ymid + 0.02, zl + tz * 1.5]
      matte.bar(p1, p2, 0.02, 0.14, lin('#b9b3a4'))
    }
  }

  // Kolkata Bridgehead Paved Plaza Apron:
  // Seamlessly paves the entire triangular junction between the bridge portal and city roads,
  // connecting directly into Road 2, Brabourne Flyover (429), Strand Road (431), and Road 751.
  // Completely eliminates any unpaved sand/dirt gap or disconnected edge!
  const P_S_START = 324.0
  const P_S_END = 356.0
  const P_STEP = 2.0
  for (let s = P_S_START; s < P_S_END - 0.01; s += P_STEP) {
    const s2 = Math.min(s + P_STEP, P_S_END)
    const y1 = deckY(s)
    const y2 = deckY(s2)
    const zCurved1 = roadCenterZ(s) + 12.0
    const zCurved2 = roadCenterZ(s2) + 12.0

    // Full trapezoidal asphalt apron spanning from northern boundary (-14.0m) to southern curved ramp edge
    const pN1: V3 = [s, y1, -14.0]
    const pS1: V3 = [s, y1, zCurved1]
    const pS2: V3 = [s2, y2, zCurved2]
    const pN2: V3 = [s2, y2, -14.0]
    matte.quad(pN1, pS1, pS2, pN2, ASPHALT)

    // Northern sidewalk and concrete curb flanking the plaza
    matte.quad(
      [s, y1 + 0.12, -18.0],
      [s, y1 + 0.12, -14.0],
      [s2, y2 + 0.12, -14.0],
      [s2, y2 + 0.12, -18.0],
      WALK
    )
    matte.quad(
      [s, y1, -14.0],
      [s, y1 + 0.12, -14.0],
      [s2, y2 + 0.12, -14.0],
      [s2, y2, -14.0],
      CONCRETE
    )
  }

  // Straight-ahead approach carriageway continuation towards Strand Bank Road / Burrabazar
  for (let s = 327.6; s < 365.0 - 0.01; s += 2.0) {
    const s2 = Math.min(s + 2.0, 365.0)
    const y1 = deckY(s)
    const y2 = deckY(s2)
    matte.quad([s, y1, -12.0], [s, y1, 12.0], [s2, y2, 12.0], [s2, y2, -12.0], ASPHALT)
    const smid = (s + s2) / 2
    const ymid = deckY(smid)
    matte.bar([smid - 1.2, ymid + 0.02, 0], [smid + 1.2, ymid + 0.02, 0], 0.02, 0.16, lin('#b9b3a4'))
    matte.bar([smid - 1.2, ymid + 0.02, -5.5], [smid + 1.2, ymid + 0.02, -5.5], 0.02, 0.14, lin('#b9b3a4'))
    matte.bar([smid - 1.2, ymid + 0.02, 5.5], [smid + 1.2, ymid + 0.02, 5.5], 0.02, 0.14, lin('#b9b3a4'))
  }

  // Street lamps on the deck
  const LAMP_POST = lin('#4a4d4c')
  for (let s = -END; s <= END; s += 30.48) {
    for (const sg of [-1, 1]) {
      const z = sg * (walkIn + 0.5)
      const y = deckY(s)
      steel.bar([s, y, z], [s, y + 8.5, z], 0.2, 0.2, LAMP_POST)
      steel.bar([s, y + 8.5, z], [s, y + 9.1, z - sg * 2.4], 0.14, 0.14, LAMP_POST)
      lamps.box(s, y + 9.0, z - sg * 2.5, 0.9, 0.22, 0.45, [1, 1, 1])
    }
  }

  // Main river piers (monoliths at the banks) and anchorages
  for (const sg of [-1, 1]) {
    const s = sg * B.halfMain
    matte.box(s, (WATER_Y - 6 + DECK_Y - 2) / 2, 0, 30, DECK_Y - 2 - (WATER_Y - 6), 58, CONCRETE)
    matte.box(s, DECK_Y - 2.6, 0, 33, 1.2, 61, shade(CONCRETE, 1.08))
    matte.box(s, WATER_Y + 0.4, 0, 36, 2.2, 64, shade(STONE, 0.9))
    for (const z of [-B.zT, B.zT]) matte.box(s, DECK_Y - 1.4, z, 7, 1.6, 6.5, shade(CONCRETE, 0.9))

    // Anchor Arm Monoliths: two separate massive structures FLANKING the roadway outside the traffic lanes.
    // The central carriageway (|z| <= 10.4m) remains 100% open and unobstructed into the city roads.
    const e = sg * END
    for (const sgZ of [-1, 1]) {
      const zAnchor = sgZ * (B.zT + 2.4) // ±14.0m, outside the roadway
      // Anchor foundation block
      matte.box(e + sg * 1.5, (WATER_Y - 2 + deckY(e) - 0.2) / 2, zAnchor, 18, deckY(e) - WATER_Y + 2.2, 7.5, STONE)
      // Flanking portal pylon framing the entrance
      matte.box(e, deckY(e) + 3.0, zAnchor, 5.0, 6.2, 4.2, shade(CONCRETE, 0.95))
    }
  }

  return { steel: steel.build(), matte: matte.build(), lamps: lamps.build() }
}

export function Bridge({ center, dir }: { center: [number, number]; dir: [number, number] }) {
  const { steel, matte, lamps } = useMemo(buildBridge, [])
  const steelMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.40,
      roughness: 0.45,
      emissive: new THREE.Color('#3a352e'),
      emissiveIntensity: 0.45,
    }),
    [],
  )
  const matteMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;')
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float vd = length(vViewPosition);
            float near = 1.0 - smoothstep(40.0, 220.0, vd);
            vec2 p = vWPos.xz + vWPos.y * 0.7;
            float blotch = fbm(p * 0.16);
            float grain = vnoise(p * 9.0) * near;
            diffuseColor.rgb *= mix(0.78, 1.18, blotch) * (1.0 + (grain - 0.5) * 0.22);
            // old repairs: darker tar patches and seams
            diffuseColor.rgb *= 1.0 - 0.22 * smoothstep(0.62, 0.7, fbm(p * 0.45 + 20.0)) * near;
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.72, 0.97, vnoise(vWPos.xz * 0.6));')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.24;')
    }
    return m
  }, [])
  const lampMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#201a12', emissive: new THREE.Color(1.0, 0.72, 0.36), emissiveIntensity: 2.2 }),
    [],
  )
  const rotY = Math.atan2(-dir[1], dir[0])
  return (
    <group position={[center[0], 0, center[1]]} rotation={[0, rotY, 0]}>
      <mesh geometry={steel} material={steelMat} castShadow receiveShadow />
      <mesh geometry={matte} material={matteMat} castShadow receiveShadow />
      <mesh geometry={lamps} material={lampMat} />
    </group>
  )
}
