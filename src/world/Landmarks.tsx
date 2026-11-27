import * as THREE from 'three'
import { useMemo } from 'react'
import { MeshBuilder, lin, shade, type V3 } from './builder'
import { WATER_Y } from './constants'

/**
 * Iconic 3D architectural landmarks across the 26 km x 26 km Complete Kolkata Digital Twin:
 * - Vidyasagar Setu (2nd Hooghly Bridge) cable-stayed span
 * - Victoria Memorial (Makrana marble domes, chhatris & colonnade)
 * - Netaji Subhas Chandra Bose International Airport (CCU) ATC tower, runway markings & parked jets
 * - Salt Lake Stadium (Yuva Bharati Krirangan)
 * - Science City geodesic globe
 * - Dakshineswar Kali Temple & Nivedita Setu
 */
function buildLandmarks() {
  const matte = new MeshBuilder()
  const steel = new MeshBuilder()

  const MARBLE = lin('#f2efe8')
  const MARBLE_SHADE = shade(MARBLE, 0.90)
  const GOLD = lin('#d4a843')
  const ASPHALT = lin('#3a3834')
  const WHITE_PAINT = lin('#ebe8df')
  const PYLON = lin('#dfe3e6')
  const CABLE = lin('#cfd5d9')
  const GLASS = lin('#3f5d73')
  const STADIUM_WALL = lin('#d8d2c7')
  const STADIUM_ROOF = lin('#ece9e2')
  const TERRACOTTA = lin('#b95439')
  const CREAM = lin('#efe6d2')

  // Helper to place local geometry at world (cx, cz) rotated by rotY
  const place = (
    mb: MeshBuilder,
    cx: number,
    cz: number,
    rotY: number,
    lx: number,
    ly: number,
    lz: number,
    sx: number,
    sy: number,
    sz: number,
    col: [number, number, number],
  ) => {
    const c = Math.cos(rotY)
    const s = Math.sin(rotY)
    const wx = cx + lx * c + lz * s
    const wz = cz - lx * s + lz * c
    mb.box(wx, ly, wz, sx, sy, sz, col, rotY)
  }

  const placeBar = (
    mb: MeshBuilder,
    cx: number,
    cz: number,
    rotY: number,
    a: V3,
    b: V3,
    inPlane: number,
    across: number,
    col: [number, number, number],
  ) => {
    const c = Math.cos(rotY)
    const s = Math.sin(rotY)
    const wa: V3 = [cx + a[0] * c + a[2] * s, a[1], cz - a[0] * s + a[2] * c]
    const wb: V3 = [cx + b[0] * c + b[2] * s, b[1], cz - b[0] * s + b[2] * c]
    mb.bar(wa, wb, inPlane, across, col)
  }

  // ---------------------------------------------------------------------------
  // 1. VIDYASAGAR SETU (2nd Hooghly Bridge) — cable-stayed bridge at [-1900, 3155]
  // ---------------------------------------------------------------------------
  {
    const cx = -1900
    const cz = 3155
    const rotY = -0.709 // aligned to OSM Road 1042/1122 river crossing
    const DECK_H = 24.0
    const HALF_MAIN = 228.5
    const HALF_TOTAL = 410.0

    // Deck segments (main span + approach ramps descending to ground)
    const STEP = 20
    for (let s = -HALF_TOTAL; s < HALF_TOTAL; s += STEP) {
      const s2 = Math.min(s + STEP, HALF_TOTAL)
      const sm = (s + s2) / 2
      const t1 = Math.abs(s) <= HALF_MAIN ? 0 : Math.min(1, (Math.abs(s) - HALF_MAIN) / (HALF_TOTAL - HALF_MAIN))
      const t2 = Math.abs(s2) <= HALF_MAIN ? 0 : Math.min(1, (Math.abs(s2) - HALF_MAIN) / (HALF_TOTAL - HALF_MAIN))
      const y1 = DECK_H * (1 - t1 * t1 * (3 - 2 * t1)) + 0.3
      const y2 = DECK_H * (1 - t2 * t2 * (3 - 2 * t2)) + 0.3
      placeBar(matte, cx, cz, rotY, [s, y1, 0], [s2, y2, 0], 1.8, 28, ASPHALT)
      placeBar(matte, cx, cz, rotY, [s, y1 + 0.95, 0], [s2, y2 + 0.95, 0], 0.3, 0.5, WHITE_PAINT)
      // Side crash barriers
      for (const side of [-14.2, 14.2]) {
        placeBar(steel, cx, cz, rotY, [s, y1 + 1.1, side], [s2, y2 + 1.1, side], 0.6, 0.5, PYLON)
      }
      // Approach piers
      if (Math.abs(sm) > HALF_MAIN + 20 && Math.abs(Math.round(sm) % 60) < STEP) {
        const ym = (y1 + y2) / 2
        for (const side of [-9, 9]) {
          place(matte, cx, cz, rotY, sm, ym / 2, side, 3.0, ym, 3.0, PYLON)
        }
      }
    }

    // Twin 127m A-frame Pylons & Fan Stay Cables
    for (const ps of [-HALF_MAIN, HALF_MAIN]) {
      // River pier foundation
      place(matte, cx, cz, rotY, ps, (WATER_Y + 4) / 2, 0, 16, 10, 44, shade(PYLON, 0.85))
      // Pylon legs (reaching 127m)
      for (const lz of [-15.5, 15.5]) {
        placeBar(steel, cx, cz, rotY, [ps, 0, lz], [ps, 127, lz * 0.72], 4.2, 4.2, PYLON)
      }
      // Cross-portal struts
      placeBar(steel, cx, cz, rotY, [ps, 21, -15.5], [ps, 21, 15.5], 3.5, 3.0, PYLON)
      placeBar(steel, cx, cz, rotY, [ps, 76, -12.6], [ps, 76, 12.6], 3.2, 3.0, PYLON)
      placeBar(steel, cx, cz, rotY, [ps, 124, -11.2], [ps, 124, 11.2], 4.5, 4.0, PYLON)

      // Fan of stay cables (both riverward and landward)
      for (const dir of [-1, 1]) {
        for (let k = 1; k <= 11; k++) {
          const anchorS = ps + dir * (k * 17.5)
          const t = Math.abs(anchorS) <= HALF_MAIN ? 0 : Math.min(1, (Math.abs(anchorS) - HALF_MAIN) / (HALF_TOTAL - HALF_MAIN))
          const anchorY = DECK_H * (1 - t * t * (3 - 2 * t)) + 1.0
          const topY = 82 + k * 3.8
          for (const lz of [-14.2, 14.2]) {
            placeBar(steel, cx, cz, rotY, [ps, topY, lz * 0.78], [anchorS, anchorY, lz], 0.24, 0.24, CABLE)
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. VICTORIA MEMORIAL — Makrana white marble monument at [-432, 4486]
  // ---------------------------------------------------------------------------
  {
    const vx = -432
    const vz = 4486
    const rot = 0.08
    // Stepped marble plinth
    place(matte, vx, vz, rot, 0, 1.5, 0, 110, 3, 76, MARBLE_SHADE)
    place(matte, vx, vz, rot, 0, 3.5, 0, 102, 2, 68, MARBLE)
    // Main museum wings
    place(matte, vx, vz, rot, 0, 12, 0, 92, 16, 52, MARBLE)
    place(matte, vx, vz, rot, 0, 14, 0, 48, 20, 62, MARBLE)
    // Central drum & dome + Angel of Victory spire (56m)
    matte.prism(vx, vz, 15.5, 22, 34, 16, MARBLE)
    matte.prism(vx, vz, 13.5, 34, 42, 16, MARBLE)
    matte.prism(vx, vz, 8.5, 42, 48, 12, MARBLE)
    matte.prism(vx, vz, 2.2, 48, 56, 8, GOLD)
    // 4 Corner Chhatri domes
    for (const sx of [-36, 36]) {
      for (const sz of [-21, 21]) {
        const c = Math.cos(rot), s = Math.sin(rot)
        const wx = vx + sx * c + sz * s
        const wz = vz - sx * s + sz * c
        matte.prism(wx, wz, 5.2, 20, 29, 8, MARBLE)
        matte.prism(wx, wz, 3.6, 29, 33, 8, MARBLE_SHADE)
        matte.prism(wx, wz, 0.8, 33, 36, 6, GOLD)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. CCU AIRPORT (Netaji Subhas Chandra Bose Int'l) — ATC, Runways & Jets
  // ---------------------------------------------------------------------------
  {
    // ATC Control Tower (65m tall) west of Runway 01L/19R
    const tx = 9780
    const tz = -7650
    matte.prism(tx, tz, 5.5, 0, 48, 8, MARBLE)
    matte.prism(tx, tz, 8.2, 48, 56, 10, GLASS)
    matte.prism(tx, tz, 8.8, 56, 58, 10, MARBLE)
    matte.prism(tx, tz, 2.8, 58, 65, 8, WHITE_PAINT)

    // Runway centerline dashes & threshold piano keys on both parallel runways
    const runways: [[number, number], [number, number]][] = [
      [[10230, -6360], [10575, -9563]], // Runway 01R/19L
      [[9942, -5705], [10298, -8973]],  // Runway 01L/19R
    ]
    for (const [a, b] of runways) {
      const dx = b[0] - a[0], dz = b[1] - a[1]
      const len = Math.hypot(dx, dz)
      const ux = dx / len, uz = dz / len
      const rot = Math.atan2(-dz, dx)
      // Dashed centerline every 70m
      for (let d = 120; d < len - 120; d += 70) {
        const px = a[0] + ux * d, pz = a[1] + uz * d
        matte.bar([px - ux * 16, 0.22, pz - uz * 16], [px + ux * 16, 0.22, pz + uz * 16], 0.04, 1.1, WHITE_PAINT)
      }
      // Threshold markings at both ends
      for (const endD of [45, len - 45]) {
        const ex = a[0] + ux * endD, ez = a[1] + uz * endD
        for (const lat of [-14, -9, -4, 4, 9, 14]) {
          const lx = ex - uz * lat, lz = ez + ux * lat
          matte.box(lx, 0.22, lz, 28, 0.06, 2.2, WHITE_PAINT, rot)
        }
      }
    }

    // Parked Passenger Jets along Terminal Apron
    const gates: [number, number, number][] = [
      [9890, -7220, 1.45],
      [9905, -7330, 1.45],
      [9920, -7440, 1.45],
      [9935, -7550, 1.45],
      [9950, -7660, 1.45],
      [9965, -7770, 1.45],
    ]
    for (const [gx, gz, rot] of gates) {
      // Fuselage + wings + tail fin
      steel.box(gx, 3.2, gz, 38, 4.2, 4.2, WHITE_PAINT, rot)
      steel.box(gx, 2.8, gz, 8.5, 0.8, 36, shade(WHITE_PAINT, 0.92), rot)
      place(steel, gx, gz, rot, -16, 7.2, 0, 5.5, 6.5, 0.8, lin('#1d4ed8'))
    }
  }

  // ---------------------------------------------------------------------------
  // 4. SALT LAKE STADIUM (Yuva Bharati Krirangan) at [6444, 1803]
  // ---------------------------------------------------------------------------
  {
    const sx = 6444
    const sz = 1803
    const N = 28
    const RX = 135, RZ = 108
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2
      const a1 = ((i + 1) / N) * Math.PI * 2
      const am = (a0 + a1) / 2
      const px = sx + Math.cos(am) * RX
      const pz = sz + Math.sin(am) * RZ
      const rot = Math.atan2(-(Math.sin(a1) * RZ - Math.sin(a0) * RZ), Math.cos(a1) * RX - Math.cos(a0) * RX)
      matte.box(px, 14, pz, 32, 28, 22, STADIUM_WALL, rot)
      matte.box(px, 29, pz, 34, 2.4, 28, STADIUM_ROOF, rot)
    }
    // 4 Stadium floodlight towers
    for (const [ox, oz] of [[-125, -95], [125, -95], [-125, 95], [125, 95]]) {
      steel.box(sx + ox, 32, sz + oz, 4, 64, 4, PYLON)
      steel.box(sx + ox, 65, sz + oz, 12, 6, 8, WHITE_PAINT)
    }
  }

  // ---------------------------------------------------------------------------
  // 5. SCIENCE CITY GEODESIC DOME at [5036, 5065]
  // ---------------------------------------------------------------------------
  {
    const cx = 5036
    const cz = 5065
    matte.prism(cx, cz, 26, 0, 12, 16, MARBLE_SHADE)
    matte.prism(cx, cz, 22, 12, 24, 16, MARBLE)
    matte.prism(cx, cz, 15, 24, 32, 16, WHITE_PAINT)
    matte.prism(cx + 55, cz - 25, 18, 0, 22, 14, MARBLE)
  }

  // ---------------------------------------------------------------------------
  // 6. DAKSHINESWAR KALI TEMPLE [1100, -7759] & NIVEDITA SETU [658, -7503]
  // ---------------------------------------------------------------------------
  {
    const dx = 1100, dz = -7759
    matte.box(dx, 4, dz, 38, 8, 38, CREAM)
    matte.box(dx, 14, dz, 24, 14, 24, CREAM)
    matte.prism(dx, dz, 4.5, 21, 34, 8, TERRACOTTA)
    for (const ox of [-9, 9]) {
      for (const oz of [-9, 9]) {
        matte.prism(dx + ox, dz + oz, 2.8, 21, 28, 6, TERRACOTTA)
      }
    }

    // Nivedita Setu extradosed multi-pylon bridge across northern Hooghly River
    const nx = 658, nz = -7503, nRot = -0.18
    for (let s = -440; s < 440; s += 25) {
      placeBar(matte, nx, nz, nRot, [s, 14, 0], [s + 25, 14, 0], 1.6, 26, ASPHALT)
    }
    for (let ps = -330; ps <= 330; ps += 110) {
      place(steel, nx, nz, nRot, ps, 22, 0, 4, 44, 4, PYLON)
      placeBar(steel, nx, nz, nRot, [ps, 42, 0], [ps - 45, 14.8, 0], 0.25, 0.25, CABLE)
      placeBar(steel, nx, nz, nRot, [ps, 42, 0], [ps + 45, 14.8, 0], 0.25, 0.25, CABLE)
    }
  }

  return { matte: matte.build(), steel: steel.build() }
}

export function Landmarks() {
  const { matte, steel } = useMemo(buildLandmarks, [])
  const matteMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 }), [])
  const steelMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.35 }), [])

  return (
    <group>
      <mesh geometry={matte} material={matteMat} castShadow receiveShadow />
      <mesh geometry={steel} material={steelMat} castShadow receiveShadow />
    </group>
  )
}
