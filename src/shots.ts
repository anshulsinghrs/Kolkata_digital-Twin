import type { SceneData } from './world/types'
import { toPts } from './world/types'
import { DECK_Y } from './world/constants'

export type Shot = { id: string; label: string; position: [number, number, number]; target: [number, number, number]; fov: number }
export const SHOT_IDS = ['aerial', 'river', 'deck', 'ghat'] as const

/** Bridge-relative helper: s metres east along the axis, l metres to the south of it. */
export function bridgeFrame(data: SceneData) {
  const { cx, cz, dx, dz } = data.bridge
  return (s: number, l: number): [number, number] => [cx + dx * s - dz * l, cz + dz * s + dx * l]
}

/** The stepped ghat just downstream of the bridge on the east bank (the flower-market ghat). */
export function heroGhat(data: SceneData) {
  const W = bridgeFrame(data)
  const [gx, gz] = W(205, 150)
  let best = { x: gx, z: gz, d: Infinity, nx: -1, nz: 0 }
  for (const bank of data.banks) {
    const ps = toPts(bank)
    for (let i = 0; i < ps.length - 1; i++) {
      const a = ps[i], b = ps[i + 1]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (let t = 0; t <= 1; t += Math.min(1, 4 / Math.max(len, 4))) {
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t
        const d = Math.hypot(x - gx, z - gz)
        // river is on the left of travel: left normal = (dz, -dx)
        if (d < best.d) best = { x, z, d, nx: (b[1] - a[1]) / len, nz: -(b[0] - a[0]) / len }
      }
    }
  }
  return best
}

export function makeShots(data: SceneData): Shot[] {
  const W = bridgeFrame(data)
  const g = heroGhat(data)
  // bank tangent at the ghat, pointing towards the bridge
  let tx = -g.nz, tz = g.nx
  if ((data.bridge.cx - g.x) * tx + (data.bridge.cz - g.z) * tz < 0) { tx = -tx; tz = -tz }
  const gp = (alongT: number, intoRiver: number): [number, number] => [g.x + tx * alongT + g.nx * intoRiver, g.z + tz * alongT + g.nz * intoRiver]
  const [gx, gz] = gp(-72, -1.1)
  const [gtx, gtz] = gp(120, 55)
  // upstream of the bridge, looking down-river into the light
  const [rx, rz] = W(60, -380)
  const [rtx, rtz] = W(-40, 0)
  const [dx, dz] = W(128, 3.2)
  const [dtx, dtz] = W(-240, -3)
  return [
    { id: 'aerial', label: 'Aerial', position: [-420, 800, 2280], target: [40, 0, -220], fov: 42 },
    { id: 'river', label: 'River', position: [rx, 0.6, rz], target: [rtx, 30, rtz], fov: 46 },
    { id: 'deck', label: 'Bridge deck', position: [dx, DECK_Y + 4.0, dz], target: [dtx, DECK_Y + 30, dtz], fov: 58 },
    { id: 'ghat', label: 'Ghat', position: [gx, 1.72, gz], target: [gtx, 13, gtz], fov: 60 },
  ]
}
