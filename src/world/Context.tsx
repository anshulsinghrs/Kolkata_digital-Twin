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

type PolyBox = { minX: number; maxX: number; minZ: number; maxZ: number; pts: Pt[] }

function buildPolyGrid(polys: number[][], cellSize: number) {
  const grid = new Map<string, PolyBox[]>()
  for (const flat of polys) {
    if (flat.length < 6) continue
    const pts = toPts(flat)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const [x, z] of pts) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const box: PolyBox = { minX, maxX, minZ, maxZ, pts }
    const cx0 = Math.floor(minX / cellSize), cx1 = Math.floor(maxX / cellSize)
    const cz0 = Math.floor(minZ / cellSize), cz1 = Math.floor(maxZ / cellSize)
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = `${cx},${cz}`
        let arr = grid.get(k)
        if (!arr) { arr = []; grid.set(k, arr) }
        arr.push(box)
      }
    }
  }
  return (px: number, pz: number) => {
    const arr = grid.get(`${Math.floor(px / cellSize)},${Math.floor(pz / cellSize)}`)
    if (!arr) return false
    for (const b of arr) {
      if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ && inPoly(px, pz, b.pts)) return true
    }
    return false
  }
}

/**
 * Complete-city urban fabric aligned to real OpenStreetMap streets, railways, waterbodies, and parks:
 * - Fills the entire 26 km x 26 km Kolkata & Howrah metropolitan area + outer horizon ring
 *   wherever OSM footprints are unmapped, respecting all real streets, rails, parks, ponds, wetlands, and riverbanks.
 */
export function Context({ data }: { data: SceneData }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const ext = data.meta.half + data.meta.margin

  const items = useMemo(() => {
    const r = rng(2024)
    const river = toPts(data.river).filter((p) => Math.abs(p[0]) < ext + 3500 && Math.abs(p[1]) < ext + 3500)
    const out: { x: number; z: number; w: number; d: number; h: number; rot: number; c: THREE.Color }[] = []
    const tones = [
      '#d9d2c1', '#c9c2b1', '#dcc588', '#d0b473', '#b9ad96',
      '#a89c88', '#c2b08a', '#9c9082', '#b08d6c', '#c9c0ad',
      '#8f8a80', '#a8785c', '#ab6a4e', '#a09a8e'
    ].map((h) => new THREE.Color(h))

    const CELL_SIZE = 120
    const rkey = (cx: number, cz: number) => `${cx},${cz}`

    // 1. Spatial Hash for Railway Corridors (22m exclusion zone)
    const railGrid = new Map<string, [number, number, number, number][]>()
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
            if (!arr) { arr = []; railGrid.set(k, arr) }
            arr.push([x1, z1, x2, z2])
          }
        }
      }
    }

    const isNearRail = (px: number, pz: number, clearance = 22) => {
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

    // 2. Spatial Hash for Road & Runway Networks (clearance + street-facing alignment)
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
            if (!arr) { arr = []; roadGrid.set(k, arr) }
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

    // 3. Spatial Hash for Existing OSM Buildings (all vertices + polygon containment)
    const isInExistingBuilding = buildPolyGrid(data.buildings.map((b) => b.p), CELL_SIZE)
    const bldPtsGrid = new Map<string, Pt[]>()
    for (const b of data.buildings) {
      for (let i = 0; i < b.p.length; i += 2) {
        const bx = b.p[i], bz = b.p[i + 1]
        const k = rkey(Math.floor(bx / CELL_SIZE), Math.floor(bz / CELL_SIZE))
        let arr = bldPtsGrid.get(k)
        if (!arr) { arr = []; bldPtsGrid.set(k, arr) }
        arr.push([bx, bz])
      }
    }
    const isNearBuilding = (px: number, pz: number, clearance = 18) => {
      if (isInExistingBuilding(px, pz)) return true
      const cx = Math.floor(px / CELL_SIZE)
      const cz = Math.floor(pz / CELL_SIZE)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const pts = bldPtsGrid.get(rkey(cx + ox, cz + oz))
          if (!pts) continue
          for (const [bx, bz] of pts) {
            if (Math.hypot(px - bx, pz - bz) < clearance) return true
          }
        }
      }
      return false
    }

    // 4. Spatial Hash for Parks & Waterbodies (Maidan, Salt Lake parks, East Kolkata Wetlands, ponds)
    const isInPark = buildPolyGrid(data.parks.map((p) => p.p), 200)
    const isInPond = buildPolyGrid(data.ponds, 200)

    // 5. Fast O(1) River Lookup Grid (40m cells within river bounding box)
    let rMinX = Infinity, rMaxX = -Infinity, rMinZ = Infinity, rMaxZ = -Infinity
    for (const [rx, rz] of river) {
      if (rx < rMinX) rMinX = rx
      if (rx > rMaxX) rMaxX = rx
      if (rz < rMinZ) rMinZ = rz
      if (rz > rMaxZ) rMaxZ = rz
    }
    const RCELL = 40
    const rW = Math.max(1, Math.ceil((rMaxX - rMinX) / RCELL) + 1)
    const rH = Math.max(1, Math.ceil((rMaxZ - rMinZ) / RCELL) + 1)
    const riverMask = new Uint8Array(rW * rH)
    for (let j = 0; j < rH; j++) {
      const wz = rMinZ + (j + 0.5) * RCELL
      for (let i = 0; i < rW; i++) {
        const wx = rMinX + (i + 0.5) * RCELL
        if (inPoly(wx, wz, river)) riverMask[j * rW + i] = 1
      }
    }
    const isNearRiver = (px: number, pz: number) => {
      if (px < rMinX - 40 || px > rMaxX + 40 || pz < rMinZ - 40 || pz > rMaxZ + 40) return false
      const ci = Math.floor((px - rMinX) / RCELL)
      const cj = Math.floor((pz - rMinZ) / RCELL)
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj
        if (jj < 0 || jj >= rH) continue
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di
          if (ii >= 0 && ii < rW && riverMask[jj * rW + ii]) return true
        }
      }
      return false
    }

    const R = ext + 1200
    const STEP = 72

    // Populate the complete 26km x 26km Kolkata & Howrah urban fabric + outer horizon
    for (let z = -R; z <= R; z += STEP) {
      for (let x = -R; x <= R; x += STEP) {
        const jx = x + (r() - 0.5) * 26
        const jz = z + (r() - 0.5) * 26
        const dist = Math.hypot(jx, jz)
        if (dist > R) continue

        // Keep Howrah Bridge & Station plaza completely clear
        if (Math.abs(jx) < 520 && Math.abs(jz) < 300) continue
        // Keep core hero Kolkata side (already 100% mapped with real OSM buildings) untouched
        if (jx > -100 && jx < 2450 && Math.abs(jz) < 2450) continue

        // Thinning only at the very outer horizon beyond ext
        if (dist > ext) {
          const keep = 0.85 - 0.45 * ((dist - ext) / Math.max(1, R - ext))
          if (r() > keep) continue
        } else {
          // Slight natural courtyard/street-pocket variation (88% density)
          if (r() > 0.88) continue
        }

        // O(1) River, Park, Pond & Rail clearance
        if (isNearRiver(jx, jz)) continue
        if (isInPark(jx, jz) || isInPond(jx, jz)) continue
        if (isNearRail(jx, jz, 22)) continue

        // Road & Airport runway clearance (runways have halfW >= 18 -> keep wide 28m clearance)
        const roadInfo = checkRoadNear(jx, jz)
        const roadPad = roadInfo.halfW >= 18 ? 28 : 5
        if (roadInfo.dist < roadInfo.halfW + roadPad) continue

        if (isNearBuilding(jx, jz, 20)) continue

        // Orientation: align along nearest street frontage
        let rot: number
        if (roadInfo.dist < 220) {
          const flip = r() < 0.25 ? Math.PI / 2 : 0
          rot = roadInfo.rot + flip + (r() - 0.5) * 0.12
        } else {
          rot = (r() < 0.5 ? 0 : Math.PI / 2) + (r() - 0.5) * 0.2
        }

        const isNewTownOrSaltLake = jx > 3500 && jz > -3500 && jz < 3500
        const tall = r() > (isNewTownOrSaltLake ? 0.78 : 0.92)
        const w = 22 + r() * 24
        const d = 22 + r() * 26
        const h = tall ? 24 + r() * 28 : 9 + r() * 17

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
