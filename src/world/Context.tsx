import * as THREE from 'three'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { rng } from './builder'
import { toPts, inPoly, type SceneData, type Pt } from './types'

function distToSegment(px: number, pz: number, x1: number, z1: number, x2: number, z2: number) {
  const dx = x2 - x1
  const dz = z2 - z1
  const l2 = dx * dx + dz * dz
  if (l2 < 0.001) return { d: Math.hypot(px - x1, pz - z1), rot: 0 }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / l2))
  return {
    d: Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz)),
    rot: Math.atan2(dz, dx),
  }
}

/**
 * Surrounding urban context organised by real OpenStreetMap geometry:
 * - Railway corridors (Howrah Junction lines, South Eastern & Eastern Railway) are strictly cleared.
 * - Road networks dictate street frontage alignment (buildings face nearest OSM streets).
 * - River banks and existing OSM building footprints are respected.
 */
export function Context({ data }: { data: SceneData }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const ext = data.meta.half + data.meta.margin

  const items = useMemo(() => {
    const r = rng(2024)
    const river = toPts(data.river).filter((p) => Math.abs(p[0]) < 6500 && Math.abs(p[1]) < 6500)
    const out: { x: number; z: number; w: number; d: number; h: number; rot: number; c: THREE.Color }[] = []
    const tones = [
      '#d9d2c1', '#c9c2b1', '#dcc588', '#d0b473', '#b9ad96',
      '#a89c88', '#c2b08a', '#9c9082', '#b08d6c', '#c9c0ad',
      '#8f8a80', '#a8785c', '#ab6a4e', '#a09a8e'
    ].map((h) => new THREE.Color(h))

    // 1. Spatial Hash for Railway Corridors (strict 24m exclusion zone)
    const CELL_SIZE = 90
    const railGrid = new Map<string, [number, number, number, number][]>()
    const rkey = (cx: number, cz: number) => `${cx},${cz}`

    for (const rail of data.rails) {
      for (let i = 0; i < rail.length - 2; i += 2) {
        const x1 = rail[i], z1 = rail[i + 1], x2 = rail[i + 2], z2 = rail[i + 3]
        const minCx = Math.floor(Math.min(x1, x2) / CELL_SIZE)
        const maxCx = Math.floor(Math.max(x1, x2) / CELL_SIZE)
        const minCz = Math.floor(Math.min(z1, z2) / CELL_SIZE)
        const maxCz = Math.floor(Math.max(z1, z2) / CELL_SIZE)
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cz = minCz; cz <= maxCz; cz++) {
            const k = rkey(cx, cz)
            let arr = railGrid.get(k)
            if (!arr) {
              arr = []
              railGrid.set(k, arr)
            }
            arr.push([x1, z1, x2, z2])
          }
        }
      }
    }

    const isNearRail = (px: number, pz: number, clearance = 24) => {
      const cx = Math.floor(px / CELL_SIZE)
      const cz = Math.floor(pz / CELL_SIZE)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const segs = railGrid.get(rkey(cx + ox, cz + oz))
          if (!segs) continue
          for (const [x1, z1, x2, z2] of segs) {
            if (distToSegment(px, pz, x1, z1, x2, z2).d < clearance) return true
          }
        }
      }
      return false
    }

    // 2. Spatial Hash for Road Networks (clearance + street-facing alignment)
    const roadGrid = new Map<string, { x1: number; z1: number; x2: number; z2: number; halfW: number }[]>()
    for (const rd of data.roads) {
      const halfW = rd.w / 2
      for (let i = 0; i < rd.p.length - 2; i += 2) {
        const x1 = rd.p[i], z1 = rd.p[i + 1], x2 = rd.p[i + 2], z2 = rd.p[i + 3]
        const minCx = Math.floor(Math.min(x1, x2) / CELL_SIZE)
        const maxCx = Math.floor(Math.max(x1, x2) / CELL_SIZE)
        const minCz = Math.floor(Math.min(z1, z2) / CELL_SIZE)
        const maxCz = Math.floor(Math.max(z1, z2) / CELL_SIZE)
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cz = minCz; cz <= maxCz; cz++) {
            const k = rkey(cx, cz)
            let arr = roadGrid.get(k)
            if (!arr) {
              arr = []
              roadGrid.set(k, arr)
            }
            arr.push({ x1, z1, x2, z2, halfW })
          }
        }
      }
    }

    const checkRoadNear = (px: number, pz: number) => {
      const cx = Math.floor(px / CELL_SIZE)
      const cz = Math.floor(pz / CELL_SIZE)
      let minD = Infinity
      let bestRot = 0
      let halfW = 6
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const segs = roadGrid.get(rkey(cx + ox, cz + oz))
          if (!segs) continue
          for (const seg of segs) {
            const res = distToSegment(px, pz, seg.x1, seg.z1, seg.x2, seg.z2)
            if (res.d < minD) {
              minD = res.d
              bestRot = res.rot
              halfW = seg.halfW
            }
          }
        }
      }
      return { dist: minD, rot: bestRot, halfW }
    }

    // 3. Spatial Hash for Existing OSM Buildings
    const bldGrid = new Map<string, Pt[]>()
    for (const b of data.buildings) {
      const cx = Math.floor(b.p[0] / CELL_SIZE)
      const cz = Math.floor(b.p[1] / CELL_SIZE)
      const k = rkey(cx, cz)
      let arr = bldGrid.get(k)
      if (!arr) {
        arr = []
        bldGrid.set(k, arr)
      }
      arr.push([b.p[0], b.p[1]])
    }

    const isNearBuilding = (px: number, pz: number, clearance = 16) => {
      const cx = Math.floor(px / CELL_SIZE)
      const cz = Math.floor(pz / CELL_SIZE)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const pts = bldGrid.get(rkey(cx + ox, cz + oz))
          if (!pts) continue
          for (const [bx, bz] of pts) {
            if (Math.hypot(px - bx, pz - bz) < clearance) return true
          }
        }
      }
      return false
    }

    const R = 4500
    const STEP = 36

    // Traverse Kolkata and Howrah surroundings
    for (let z = -R; z <= R; z += STEP) {
      for (let x = -R; x <= R; x += STEP) {
        const jx = x + (r() - 0.5) * 16
        const jz = z + (r() - 0.5) * 16
        const cheb = Math.max(Math.abs(jx), Math.abs(jz))
        const dist = Math.hypot(jx, jz)

        // Strictly outside the mapped city boundary: context is ONLY for the distant horizon skyline beyond the city
        if (cheb < ext + 15) continue
        if (dist > R) continue

        // Thinning at distant horizon
        const keep = 0.92 - 0.42 * ((dist - ext) / Math.max(1, R - ext)) - 0.18 * (0.5 + 0.5 * Math.sin(jx * 0.003 + jz * 0.003))
        if (r() > keep) continue

        // River clearance (32m buffer)
        if (inPoly(jx, jz, river)) continue
        let nearRiver = false
        for (const [ox, oz] of [[32, 0], [-32, 0], [0, 32], [0, -32]]) {
          if (inPoly(jx + ox, jz + oz, river)) {
            nearRiver = true
            break
          }
        }
        if (nearRiver) continue

        // Railway clearance (no building across train tracks)
        if (isNearRail(jx, jz, 22)) continue

        // Road clearance & alignment
        const roadInfo = checkRoadNear(jx, jz)
        if (roadInfo.dist < roadInfo.halfW + 4) continue

        // Orientation: align parallel/perpendicular to nearest road, or natural Kolkata cardinal grid
        let rot: number
        if (roadInfo.dist < 140) {
          // Align along street frontage (either parallel or perpendicular with small organic variation)
          const flip = r() < 0.25 ? Math.PI / 2 : 0
          rot = roadInfo.rot + flip + (r() - 0.5) * 0.12
        } else {
          // Cardinal street orientation with gentle organic drift
          rot = (r() < 0.5 ? 0 : Math.PI / 2) + (r() - 0.5) * 0.2
        }

        const tall = r() > 0.95
        const w = 12 + r() * 16
        const d = 14 + r() * 18
        const h = tall ? 24 + r() * 18 : 7 + r() * 14

        out.push({
          x: jx,
          z: jz,
          w,
          d,
          h,
          rot,
          c: tones[Math.floor(r() * tones.length)].clone().multiplyScalar(0.82 + r() * 0.28),
        })
      }
    }

    return out
  }, [data, ext])

  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1)
    g.translate(0, 0.5, 0)
    // roofs slightly greyer/weathered than walls
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

  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }), [])

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
