import * as THREE from 'three'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { rng } from './builder'
import { toPts, inPoly, type SceneData } from './types'

/**
 * The city beyond the mapped square. NOT real geometry: generic low blocks that stand in for
 * the surrounding city so the horizon is a skyline rather than bare ground. They live
 * only outside the OSM extent, cast no shadows, and are mostly swallowed by haze.
 */
export function Context({ data }: { data: SceneData }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const ext = data.meta.half + data.meta.margin
  const items = useMemo(() => {
    const r = rng(2024)
    const river = toPts(data.river).filter((p) => Math.abs(p[0]) < 5200 && Math.abs(p[1]) < 5200)
    const out: { x: number; z: number; w: number; d: number; h: number; rot: number; c: THREE.Color }[] = []
    const tones = ['#b9ad96', '#a89c88', '#c2b08a', '#9c9082', '#b08d6c', '#c9c0ad', '#8f8a80', '#a8785c'].map((h) => new THREE.Color(h))
    const R = 3400
    const { dx, dz } = data.bridge
    for (let v = -R; v <= R; v += 40)
      for (let u = -R; u <= R; u += 34) {
        const ju = u + (r() - 0.5) * 16, jv = v + (r() - 0.5) * 18
        const x = ju * dx - jv * dz, z = ju * dz + jv * dx
        const cheb = Math.max(Math.abs(x), Math.abs(z))
        const dist = Math.hypot(x, z)
        if (cheb < ext + 12 || dist > R) continue
        // thin out with distance, and leave irregular gaps
        const keep = 0.9 - 0.45 * ((dist - ext) / (R - ext)) - 0.22 * (0.5 + 0.5 * Math.sin(x * 0.0043 + z * 0.0031))
        if (r() > keep) continue
        if (inPoly(x, z, river)) continue
        // keep clear of the banks
        let nearRiver = false
        for (const [ox, oz] of [[26, 0], [-26, 0], [0, 26], [0, -26]]) if (inPoly(x + ox, z + oz, river)) nearRiver = true
        if (nearRiver) continue
        const tall = r() > 0.94
        out.push({
          x, z,
          w: 12 + r() * 16, d: 14 + r() * 18,
          h: tall ? 22 + r() * 22 : 6 + r() * 12,
          rot: Math.atan2(-dz, dx) + (r() - 0.5) * 0.5,
          c: tones[Math.floor(r() * tones.length)].clone().multiplyScalar(0.8 + r() * 0.3),
        })
      }
    return out
  }, [data, ext])

  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1)
    g.translate(0, 0.5, 0)
    // roofs a touch greyer than walls
    const n = g.getAttribute('normal')
    const col = new Float32Array(n.count * 3)
    for (let i = 0; i < n.count; i++) {
      const top = n.getY(i) > 0.5
      col[i * 3] = top ? 0.72 : 1
      col[i * 3 + 1] = top ? 0.72 : 1
      col[i * 3 + 2] = top ? 0.74 : 1
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), [])

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rot)
      m.compose(new THREE.Vector3(it.x, 0, it.z), q, new THREE.Vector3(it.w, it.h, it.d))
      ref.current.setMatrixAt(i, m)
      ref.current.setColorAt(i, it.c)
    })
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [items])

  return <instancedMesh ref={ref} args={[geo, mat, items.length]} />
}
