import * as THREE from 'three'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { SceneData } from './types'
import { toPts } from './types'
import { BRIDGE, deckY, RAMP_END, roadCenterZ } from './Bridge'
import { WATER_Y } from './constants'

// Bridge bounds: spans Howrah riverbank (-336m) to Kolkata Road 2 junction (+352m)
const BRIDGE_S_MIN = -336.0
const BRIDGE_S_MAX = 352.0
const BRIDGE_TOTAL_SPAN = BRIDGE_S_MAX - BRIDGE_S_MIN // 688.0 m total span
const TOTAL_HALF_SPAN = 340.0

// Indian Left-Hand Drive Traffic Lane Layout on Howrah Bridge
// Roadway width is 21.6m (-10.8m to +10.8m)
// Eastbound (heading towards Kolkata, dir = +1): left-hand side is negative lateral offset
const BRIDGE_LANES_EAST = {
  slowKerb: -8.8, // Slow lane: hand-pulled carts, heavy goods trucks, stopping buses
  middle1: -6.0,  // Freight & buses
  middle2: -3.4,  // Yellow taxis & autos
  fastInner: -1.2 // Taxis & two-wheelers
}
// Westbound (heading towards Howrah, dir = -1): left-hand side is positive lateral offset
const BRIDGE_LANES_WEST = {
  fastInner: 1.2, // Taxis & two-wheelers
  middle2: 3.4,  // Yellow taxis & autos
  middle1: 6.0,  // Freight & buses
  slowKerb: 8.8  // Slow lane: hand-pulled carts, heavy goods trucks, stopping buses
}

export type VehicleKind = 'taxi' | 'bus' | 'auto' | 'bike' | 'cart' | 'truck'

interface RoadPath {
  idx: number
  pts: [number, number][]
  cumDist: number[]
  totalLen: number
  w: number
  c: number
}

interface VehicleAgent {
  kind: VehicleKind
  isBridge: boolean
  path?: RoadPath
  s: number            // longitudinal coordinate along road/bridge
  laneOffset: number   // lateral offset from centerline
  targetLane: number   // intended lane (used when filtering/lane-splitting)
  dir: number          // +1 or -1
  speed: number        // current speed (m/s)
  targetSpeed: number  // free-flow target speed (m/s)
  length: number       // vehicle length (m)
  width: number        // vehicle width (m)
  height: number       // vehicle height (m)
  isFiltering?: boolean
}

interface PedestrianAgent {
  isBridge: boolean
  s: number
  lane: number
  dir: number
  speed: number
  color: THREE.Color
  area: 'bridge_north' | 'bridge_south' | 'ghat' | 'city'
  gx?: number
  gz?: number
  heading?: number
}

interface FerryAgent {
  x: number
  z: number
  targetX: number
  targetZ: number
  originX: number
  originZ: number
  speed: number
  heading: number
  rollPhase: number
}

interface RailSpline {
  idx: number
  pts: [number, number][]
  cumDist: number[]
  totalLen: number
}

interface TrainFormation {
  name: string
  type: 'express' | 'emu' | 'vandebharat'
  splineIdx: number
  speed: number
  s: number
  dir: number
  carSpacing: number
  numCoaches: number
}

// Sample a railway spline at distance s along its polyline
function sampleRail(pts: [number, number][], cumDist: number[], totalLen: number, s: number) {
  if (s <= 0) {
    const dx = pts[1][0] - pts[0][0]
    const dz = pts[1][1] - pts[0][1]
    const len = Math.hypot(dx, dz) || 1
    return { x: pts[0][0], z: pts[0][1], fx: dx / len, fz: dz / len }
  }
  if (s >= totalLen) {
    const n = pts.length
    const dx = pts[n - 1][0] - pts[n - 2][0]
    const dz = pts[n - 1][1] - pts[n - 2][1]
    const len = Math.hypot(dx, dz) || 1
    return { x: pts[n - 1][0], z: pts[n - 1][1], fx: dx / len, fz: dz / len }
  }
  let i = 0
  while (i < cumDist.length - 1 && cumDist[i + 1] < s) i++
  const segLen = cumDist[i + 1] - cumDist[i]
  const t = segLen > 0 ? (s - cumDist[i]) / segLen : 0
  const p0 = pts[i]
  const p1 = pts[i + 1]
  const x = p0[0] + (p1[0] - p0[0]) * t
  const z = p0[1] + (p1[1] - p0[1]) * t
  const dx = p1[0] - p0[0]
  const dz = p1[1] - p0[1]
  const len = Math.hypot(dx, dz) || 1
  return { x, z, fx: dx / len, fz: dz / len }
}

// Sample a 2D polyline road path at distance s along its length
function samplePath(path: RoadPath, s: number) {
  const pts = path.pts
  const cum = path.cumDist
  const n = pts.length

  if (s <= 0) {
    const dx = pts[1][0] - pts[0][0]
    const dz = pts[1][1] - pts[0][1]
    const len = Math.hypot(dx, dz) || 1
    return { x: pts[0][0], z: pts[0][1], fx: dx / len, fz: dz / len }
  }
  if (s >= path.totalLen) {
    const dx = pts[n - 1][0] - pts[n - 2][0]
    const dz = pts[n - 1][1] - pts[n - 2][1]
    const len = Math.hypot(dx, dz) || 1
    return { x: pts[n - 1][0], z: pts[n - 1][1], fx: dx / len, fz: dz / len }
  }

  let i = 0
  while (i < cum.length - 1 && cum[i + 1] < s) i++
  const segLen = cum[i + 1] - cum[i]
  const t = segLen > 0 ? (s - cum[i]) / segLen : 0

  const p0 = pts[i]
  const p1 = pts[i + 1]
  const x = p0[0] + (p1[0] - p0[0]) * t
  const z = p0[1] + (p1[1] - p0[1]) * t
  const dx = p1[0] - p0[0]
  const dz = p1[1] - p0[1]
  const len = Math.hypot(dx, dz) || 1

  return { x, z, fx: dx / len, fz: dz / len }
}

// Color helper to attach vertex colors to procedural fallback geometry
function colorGeo(geo: THREE.BufferGeometry, colorHex: string): THREE.BufferGeometry {
  const c = new THREE.Color(colorHex)
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

// Extraction of merged geometry from Blender GLB with vertex color mapping and wheel alignment
function extractMergedGeometry(
  scene: THREE.Group,
  options?: { maxHalfWidth?: number; wheelTuck?: number }
): THREE.BufferGeometry | null {
  try {
    const geos: THREE.BufferGeometry[] = []
    scene.updateMatrixWorld(true)
    scene.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        const mesh = c as THREE.Mesh
        const g = mesh.geometry.clone()
        g.applyMatrix4(mesh.matrixWorld)
        if (g.attributes.color_1) {
          g.setAttribute('color', g.attributes.color_1)
          delete g.attributes.color_1
        }
        if (!g.attributes.color) {
          const colors = new Float32Array(g.attributes.position.count * 3).fill(1)
          g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        }

        // Apply wheel tuck and width clamping if requested
        if (options && (options.wheelTuck || options.maxHalfWidth)) {
          const pos = g.attributes.position
          const col = g.attributes.color
          const { wheelTuck = 0, maxHalfWidth = 999 } = options
          for (let i = 0; i < pos.count; i++) {
            let x = pos.getX(i)
            const y = pos.getY(i)
            const r = col ? col.getX(i) : 1
            const gVal = col ? col.getY(i) : 1
            const b = col ? col.getZ(i) : 1

            // Wheels and hubcaps are low to the ground (y < 1.05) and either dark rubber or wheel hub
            const isWheel = ((r < 0.25 && gVal < 0.25 && b < 0.25) || Math.abs(x) > 0.6) && y < 1.05
            if (isWheel && wheelTuck > 0) {
              if (x > 0.25) x = Math.max(0.25, x - wheelTuck)
              else if (x < -0.25) x = Math.min(-0.25, x + wheelTuck)
            }

            // Clamp max half width so no vertex protrudes past vehicle body
            if (Math.abs(x) > maxHalfWidth) {
              x = Math.sign(x) * maxHalfWidth
            }
            pos.setX(i, x)
          }
          pos.needsUpdate = true
          g.computeVertexNormals()
          g.computeBoundingBox()
          g.computeBoundingSphere()
        }

        geos.push(g)
      }
    })
    if (geos.length === 0) return null
    return mergeGeometries(geos, false)
  } catch (err) {
    console.warn('Failed to merge glTF geometry, falling back to procedural:', err)
    return null
  }
}

// Procedural Fallback Geometries (length along Z, width along X, height along Y)
function createFallbackTaxi(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const lower = new THREE.BoxGeometry(1.72, 0.65, 4.2); lower.translate(0, 0.42, 0)
  parts.push(colorGeo(lower, '#f5b700'))
  const cabin = new THREE.BoxGeometry(1.55, 0.62, 2.3); cabin.translate(0, 0.98, 0.15)
  parts.push(colorGeo(cabin, '#1f252a'))
  const roof = new THREE.BoxGeometry(1.52, 0.12, 2.2); roof.translate(0, 1.32, 0.15)
  parts.push(colorGeo(roof, '#f5b700'))
  const sign = new THREE.BoxGeometry(0.65, 0.16, 0.28); sign.translate(0, 1.44, -0.1)
  parts.push(colorGeo(sign, '#ffffff'))
  return mergeGeometries(parts, false)!
}

function createFallbackBus(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const lower = new THREE.BoxGeometry(2.45, 1.15, 9.4); lower.translate(0, 0.75, 0)
  parts.push(colorGeo(lower, '#0a4b8f'))
  const windows = new THREE.BoxGeometry(2.42, 0.85, 9.3); windows.translate(0, 1.72, 0)
  parts.push(colorGeo(windows, '#1a2228'))
  const upper = new THREE.BoxGeometry(2.45, 0.55, 9.4); upper.translate(0, 2.4, 0)
  parts.push(colorGeo(upper, '#f5bc18'))
  return mergeGeometries(parts, false)!
}

function createFallbackAuto(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const lower = new THREE.BoxGeometry(1.35, 0.6, 2.7); lower.translate(0, 0.38, 0)
  parts.push(colorGeo(lower, '#157338'))
  const hood = new THREE.BoxGeometry(1.3, 0.65, 2.5); hood.translate(0, 0.98, 0.1)
  parts.push(colorGeo(hood, '#f4b000'))
  return mergeGeometries(parts, false)!
}

function createFallbackBike(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const frame = new THREE.BoxGeometry(0.4, 0.5, 1.9); frame.translate(0, 0.45, 0)
  parts.push(colorGeo(frame, '#b3221b'))
  const rider = new THREE.BoxGeometry(0.45, 0.8, 0.5); rider.translate(0, 1.05, 0.1)
  parts.push(colorGeo(rider, '#3d444b'))
  return mergeGeometries(parts, false)!
}

function createFallbackCart(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const bed = new THREE.BoxGeometry(1.4, 0.15, 2.8); bed.translate(0, 0.65, 0)
  parts.push(colorGeo(bed, '#7d4f2b'))
  const puller = new THREE.BoxGeometry(0.4, 0.95, 0.4); puller.translate(0, 0.65, -1.6)
  parts.push(colorGeo(puller, '#b5845c'))
  return mergeGeometries(parts, false)!
}

function createFallbackTruck(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const cargo = new THREE.BoxGeometry(2.4, 1.8, 5.2); cargo.translate(0, 1.5, 1.4)
  parts.push(colorGeo(cargo, '#2d7a46'))
  const cab = new THREE.BoxGeometry(2.35, 1.7, 2.2); cab.translate(0, 1.45, -2.2)
  parts.push(colorGeo(cab, '#e68a00'))
  return mergeGeometries(parts, false)!
}

function createPedestrianGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const torso = new THREE.BoxGeometry(0.38, 0.65, 0.22); torso.translate(0, 1.0, 0)
  parts.push(colorGeo(torso, '#f0eae1'))
  const head = new THREE.BoxGeometry(0.22, 0.24, 0.22); head.translate(0, 1.45, 0)
  parts.push(colorGeo(head, '#8d5524'))
  const legs = new THREE.BoxGeometry(0.34, 0.65, 0.2); legs.translate(0, 0.35, 0)
  parts.push(colorGeo(legs, '#3a3430'))
  return mergeGeometries(parts, false)!
}

export function Traffic({ data, speedFactor = 1.0 }: { data: SceneData; speedFactor?: number }) {
  const { cx, cz, dx, dz } = data.bridge
  const rotY = Math.atan2(-dz, dx) // Angle of bridge axis

  // Transformation matrix from Howrah Bridge local frame to world space
  const bridgeWorldMatrix = useMemo(() => {
    const m = new THREE.Matrix4()
    m.makeRotationY(rotY)
    m.setPosition(cx, 0, cz)
    return m
  }, [cx, cz, rotY])

  // Pre-load Blender GLB models with fallback
  const taxiGltf = useGLTF('/models/yellow_taxi.glb')
  const busGltf = useGLTF('/models/kolkata_bus.glb')
  const autoGltf = useGLTF('/models/auto_rickshaw.glb')
  const bikeGltf = useGLTF('/models/two_wheeler.glb')
  const cartGltf = useGLTF('/models/hand_pulled_cart.glb')
  const truckGltf = useGLTF('/models/goods_truck.glb')

  const taxiGeo = useMemo(() => extractMergedGeometry(taxiGltf.scene, { maxHalfWidth: 0.86, wheelTuck: 0.12 }) || createFallbackTaxi(), [taxiGltf])
  const busGeo = useMemo(() => extractMergedGeometry(busGltf.scene, { maxHalfWidth: 1.23, wheelTuck: 0.22 }) || createFallbackBus(), [busGltf])
  const autoGeo = useMemo(() => extractMergedGeometry(autoGltf.scene, { maxHalfWidth: 0.68, wheelTuck: 0.08 }) || createFallbackAuto(), [autoGltf])
  const bikeGeo = useMemo(() => extractMergedGeometry(bikeGltf.scene) || createFallbackBike(), [bikeGltf])
  const cartGeo = useMemo(() => extractMergedGeometry(cartGltf.scene) || createFallbackCart(), [cartGltf])
  const truckGeo = useMemo(() => extractMergedGeometry(truckGltf.scene, { maxHalfWidth: 1.20, wheelTuck: 0.24 }) || createFallbackTruck(), [truckGltf])
  const pedGeo = useMemo(createPedestrianGeometry, [])

  const lightGeo = useMemo(() => new THREE.BoxGeometry(0.2, 0.16, 0.12), [])

  // Common PBR Material for vehicles
  const vehicleMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.28,
      emissive: new THREE.Color('#1c1914'),
      emissiveIntensity: 0.25,
    }),
    [],
  )

  const pedMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.05,
    }),
    [],
  )

  const headLightMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff9db') }), [])
  const tailLightMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a00') }), [])

  // Build Viable Road Paths across Complete City from OSM Roads (strictly major highways & arterials)
  const cityRoadPaths = useMemo<RoadPath[]>(() => {
    const list: RoadPath[] = []
    data.roads.forEach((r, idx) => {
      const pts: [number, number][] = []
      for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], r.p[i + 1]])
      if (pts.length < 2) return

      const cumDist: number[] = [0]
      let totalLen = 0
      for (let i = 0; i < pts.length - 1; i++) {
        const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        totalLen += d
        cumDist.push(totalLen)
      }
      // Select arterial class roads (c === 0: Strand Rd, Brabourne Rd, MG Rd, Howrah loops) or wide thoroughfares (w >= 8.5)
      // This eliminates all narrow alleys and spaces between buildings so vehicles stay strictly on wide roadways
      if ((totalLen >= 30 && (r.c === 0 || r.w >= 8.5)) || (r.c === 0 && totalLen >= 20)) {
        list.push({ idx, pts, cumDist, totalLen, w: r.w, c: r.c })
      }
    })
    return list
  }, [data.roads])

  // Setup Fleet across COMPLETE CITY: Howrah Bridge + All City Roads (both Kolkata and Howrah sides)
  const MAX_INSTANCES = 1000
  const vehicles = useMemo<VehicleAgent[]>(() => {
    const list: VehicleAgent[] = []
    
    // 1. Howrah Bridge Dedicated Traffic: 96 vehicles organized into 8 strict lanes (12 per lane)
    // Indian Left-Hand Drive convention spanning from Howrah bank (-336m) to Kolkata bank (+336m)
    const bridgeLanesConfig = [
      // Eastbound Lanes (dir = +1)
      {
        lane: BRIDGE_LANES_EAST.slowKerb,
        dir: 1,
        allowed: [
          { kind: 'cart', weight: 3, len: 3.6, wid: 1.4, hei: 1.2, speed: 2.2 },
          { kind: 'truck', weight: 4, len: 8.2, wid: 2.4, hei: 2.8, speed: 7.0 },
          { kind: 'bus', weight: 3, len: 9.6, wid: 2.45, hei: 3.1, speed: 8.0 },
        ],
      },
      {
        lane: BRIDGE_LANES_EAST.middle1,
        dir: 1,
        allowed: [
          { kind: 'bus', weight: 5, len: 9.6, wid: 2.45, hei: 3.1, speed: 8.5 },
          { kind: 'truck', weight: 3, len: 8.2, wid: 2.4, hei: 2.8, speed: 7.5 },
          { kind: 'taxi', weight: 2, len: 4.4, wid: 1.72, hei: 1.5, speed: 10.5 },
        ],
      },
      {
        lane: BRIDGE_LANES_EAST.middle2,
        dir: 1,
        allowed: [
          { kind: 'taxi', weight: 5, len: 4.4, wid: 1.72, hei: 1.5, speed: 11.5 },
          { kind: 'auto', weight: 3, len: 2.8, wid: 1.35, hei: 1.7, speed: 9.5 },
          { kind: 'bike', weight: 2, len: 2.0, wid: 0.6, hei: 1.5, speed: 12.0 },
        ],
      },
      {
        lane: BRIDGE_LANES_EAST.fastInner,
        dir: 1,
        allowed: [
          { kind: 'taxi', weight: 6, len: 4.4, wid: 1.72, hei: 1.5, speed: 12.5 },
          { kind: 'bike', weight: 4, len: 2.0, wid: 0.6, hei: 1.5, speed: 13.5 },
        ],
      },
      // Westbound Lanes (dir = -1)
      {
        lane: BRIDGE_LANES_WEST.fastInner,
        dir: -1,
        allowed: [
          { kind: 'taxi', weight: 6, len: 4.4, wid: 1.72, hei: 1.5, speed: 12.5 },
          { kind: 'bike', weight: 4, len: 2.0, wid: 0.6, hei: 1.5, speed: 13.5 },
        ],
      },
      {
        lane: BRIDGE_LANES_WEST.middle2,
        dir: -1,
        allowed: [
          { kind: 'taxi', weight: 5, len: 4.4, wid: 1.72, hei: 1.5, speed: 11.5 },
          { kind: 'auto', weight: 3, len: 2.8, wid: 1.35, hei: 1.7, speed: 9.5 },
          { kind: 'bike', weight: 2, len: 2.0, wid: 0.6, hei: 1.5, speed: 12.0 },
        ],
      },
      {
        lane: BRIDGE_LANES_WEST.middle1,
        dir: -1,
        allowed: [
          { kind: 'bus', weight: 5, len: 9.6, wid: 2.45, hei: 3.1, speed: 8.5 },
          { kind: 'truck', weight: 3, len: 8.2, wid: 2.4, hei: 2.8, speed: 7.5 },
          { kind: 'taxi', weight: 2, len: 4.4, wid: 1.72, hei: 1.5, speed: 10.5 },
        ],
      },
      {
        lane: BRIDGE_LANES_WEST.slowKerb,
        dir: -1,
        allowed: [
          { kind: 'cart', weight: 3, len: 3.6, wid: 1.4, hei: 1.2, speed: 2.2 },
          { kind: 'truck', weight: 4, len: 8.2, wid: 2.4, hei: 2.8, speed: 7.0 },
          { kind: 'bus', weight: 3, len: 9.6, wid: 2.45, hei: 3.1, speed: 8.0 },
        ],
      },
    ]

    const VEHICLES_PER_LANE = 12
    const span = BRIDGE_TOTAL_SPAN

    bridgeLanesConfig.forEach((cfg, laneIdx) => {
      const pool: any[] = []
      cfg.allowed.forEach((item) => {
        for (let w = 0; w < item.weight; w++) pool.push(item)
      })

      for (let k = 0; k < VEHICLES_PER_LANE; k++) {
        const spec = pool[(k + laneIdx * 3) % pool.length]
        // Stagger initial s coordinate evenly along the bridge span with lane phase shift
        const phase = (k + ((laneIdx * 0.28) % 1)) / VEHICLES_PER_LANE
        const s = BRIDGE_S_MIN + phase * span
        const baseSpeed = spec.speed * (0.92 + ((k * 0.17) % 0.16))

        list.push({
          kind: spec.kind as VehicleKind,
          isBridge: true,
          s,
          laneOffset: cfg.lane,
          targetLane: cfg.lane,
          dir: cfg.dir,
          speed: baseSpeed,
          targetSpeed: baseSpeed,
          length: spec.len,
          width: spec.wid,
          height: spec.hei,
          isFiltering: false,
        })
      }
    })

    // 2. Complete City Road Network Traffic (480 vehicles distributed across major OSM avenues)
    if (cityRoadPaths.length > 0) {
      // Priority weights: Major bridgehead highways (Brabourne Flyover 429, Strand Rd 431/650/818, Howrah Station 438/441/508/41) get dense continuous flow
      const BRIDGEHEAD_ROADS = new Set([429, 431, 650, 818, 438, 439, 441, 508, 41, 221, 2, 751, 752, 33, 34, 20, 430, 436, 442])
      const weights = cityRoadPaths.map((p) => {
        const isBridgehead = BRIDGEHEAD_ROADS.has(p.idx)
        return p.totalLen * (isBridgehead ? 15.0 : (p.c === 0 ? 3.5 : 1.2))
      })
      const totalWeight = weights.reduce((a, b) => a + b, 0)
      const targetCityCount = 480

      for (let pi = 0; pi < cityRoadPaths.length; pi++) {
        const path = cityRoadPaths[pi]
        const isBridgehead = BRIDGEHEAD_ROADS.has(path.idx)
        const maxOnPath = isBridgehead ? 26 : 10
        const numOnThisPath = Math.min(maxOnPath, Math.round((weights[pi] / totalWeight) * targetCityCount))
        if (numOnThisPath === 0) continue

        for (let k = 0; k < numOnThisPath; k++) {
          const dir = k % 2 === 0 ? 1 : -1
          const r = (k * 0.37 + pi * 0.19) % 1.0
          let kind: VehicleKind
          let speed: number
          let len: number
          let wid: number
          let hei: number

          const isWide = path.w >= 8.5
          let lateralRatio: number

          if (r < 0.08) {
            kind = 'cart'
            speed = 2.0 + (r * 0.5)
            len = 3.6; wid = 1.4; hei = 1.2
            lateralRatio = isWide ? 0.30 : 0.20
          } else if (r < 0.20) {
            kind = 'truck'
            speed = 7.0 + (r * 2.0)
            len = 8.2; wid = 2.4; hei = 2.8
            lateralRatio = isWide ? 0.26 : 0.20
          } else if (r < 0.36) {
            kind = 'bus'
            speed = 8.0 + (r * 2.5)
            len = 9.6; wid = 2.45; hei = 3.1
            lateralRatio = isWide ? 0.24 : 0.18
          } else if (r < 0.52) {
            kind = 'auto'
            speed = 9.0 + (r * 2.5)
            len = 2.8; wid = 1.35; hei = 1.7
            lateralRatio = isWide ? 0.20 : 0.18
          } else if (r < 0.70) {
            kind = 'bike'
            speed = 10.5 + (r * 3.0)
            len = 2.0; wid = 0.6; hei = 1.5
            lateralRatio = isWide ? 0.14 : 0.16
          } else {
            kind = 'taxi'
            speed = 11.0 + (r * 3.0)
            len = 4.4; wid = 1.72; hei = 1.5
            lateralRatio = isWide ? 0.16 : 0.18
          }

          // Spread initial s evenly along the road segment
          const s = ((k + 0.5) / numOnThisPath) * path.totalLen
          // Ensure lateral offset keeps vehicle strictly on the asphalt carriageway away from curbs and building walls
          const maxSafeOffset = Math.max(0.8, path.w * 0.5 - (wid * 0.5 + 0.8))
          const laneOffset = Math.min(maxSafeOffset, path.w * lateralRatio)

          list.push({
            kind,
            isBridge: false,
            path,
            s,
            laneOffset,
            targetLane: laneOffset,
            dir,
            speed,
            targetSpeed: speed,
            length: len,
            width: wid,
            height: hei,
            isFiltering: false,
          })
        }
      }
    }

    return list
  }, [cityRoadPaths])

  // Pedestrians on Bridge Footpaths, Ghats, and Busy City Intersections
  const TOTAL_PEDS = 240
  const pedestrians = useMemo<PedestrianAgent[]>(() => {
    const list: PedestrianAgent[] = []
    const clothingColors = [
      '#ffffff', // Dhoti / Kurta
      '#f5a742', // Saffron
      '#e05252', // Crimson
      '#4a90e2', // Light blue
      '#50b86c', // Green
      '#8e44ad', // Violet
      '#f1c40f', // Mustard yellow
      '#bdc3c7', // Khaki grey
      '#e67e22', // Terracotta
    ]

    // 130 pedestrians on Howrah Bridge cantilevered footpaths
    for (let i = 0; i < 130; i++) {
      const north = i % 2 === 0
      const dir = Math.random() < 0.5 ? 1 : -1
      const s = (Math.random() * 2 - 1) * TOTAL_HALF_SPAN
      const lane = (north ? 11.2 : -11.2) + (Math.random() - 0.5) * 1.4
      const color = new THREE.Color(clothingColors[Math.floor(Math.random() * clothingColors.length)])
      list.push({
        isBridge: true,
        s,
        lane,
        dir,
        speed: 1.1 + Math.random() * 0.4,
        color,
        area: north ? 'bridge_north' : 'bridge_south',
      })
    }

    // 70 pedestrians on Flower Market Ghat promenade
    for (let i = 0; i < 70; i++) {
      const gx = 160 + Math.random() * 55
      const gz = 145 + Math.random() * 95
      const color = new THREE.Color(clothingColors[Math.floor(Math.random() * clothingColors.length)])
      list.push({
        isBridge: false,
        s: 0,
        lane: 0,
        dir: 1,
        speed: 0.8 + Math.random() * 0.5,
        color,
        area: 'ghat',
        gx,
        gz,
        heading: Math.random() * Math.PI * 2,
      })
    }

    // 40 pedestrians across city market sidewalks (Burrabazar / Strand approaches)
    for (let i = 0; i < 40; i++) {
      const gx = 280 + Math.random() * 110
      const gz = -100 + Math.random() * 320
      const color = new THREE.Color(clothingColors[Math.floor(Math.random() * clothingColors.length)])
      list.push({
        isBridge: false,
        s: 0,
        lane: 0,
        dir: 1,
        speed: 0.9 + Math.random() * 0.4,
        color,
        area: 'city',
        gx,
        gz,
        heading: Math.random() * Math.PI * 2,
      })
    }

    return list
  }, [TOTAL_PEDS])

  // River Ferries state
  const ferries = useRef<FerryAgent[]>([
    { x: cx - 220, z: cz - 260, originX: cx - 220, originZ: cz - 260, targetX: cx + 190, targetZ: cz - 210, speed: 4.6, heading: 0, rollPhase: 0 },
    { x: cx + 170, z: cz + 310, originX: cx + 170, originZ: cz + 310, targetX: cx - 210, targetZ: cz + 370, speed: 4.2, heading: 0, rollPhase: 1.5 },
    { x: cx - 190, z: cz + 130, originX: cx - 190, originZ: cz + 130, targetX: cx + 210, targetZ: cz + 70, speed: 4.8, heading: 0, rollPhase: 3.1 },
    { x: cx + 200, z: cz - 80, originX: cx + 200, originZ: cz - 80, targetX: cx - 210, targetZ: cz - 120, speed: 4.4, heading: 0, rollPhase: 4.6 },
  ])

  // Build continuous rail splines from OSM data.rails
  const railTracks = useMemo<RailSpline[]>(() => {
    if (!data.rails || data.rails.length === 0) return []
    // Track 36 (Outbound Express), Track 35 (Inbound EMU Local), Track 17 (Vande Bharat South Complex)
    const trackIndices = [36, 35, 17]
    return trackIndices.map((tIdx) => {
      const raw = data.rails[tIdx] || data.rails[0]
      const pts = toPts(raw) as [number, number][]
      const cumDist = [0]
      let total = 0
      for (let i = 0; i < pts.length - 1; i++) {
        total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        cumDist.push(total)
      }
      return { idx: tIdx, pts, cumDist, totalLen: total }
    })
  }, [data.rails])

  // Real track-following Train Formations operating along Howrah OSM Broad Gauge lines
  const trainFormations = useRef<TrainFormation[]>([
    {
      name: '12301 Howrah - New Delhi Rajdhani Express (WAP-7)',
      type: 'express',
      splineIdx: 0, // Track 36 (Outbound from platform 9)
      speed: 13.5,
      s: 260,
      dir: 1,
      carSpacing: 22.0,
      numCoaches: 5,
    },
    {
      name: '37815 Howrah - Barddhaman EMU Local',
      type: 'emu',
      splineIdx: 1, // Track 35 (Inbound toward platform 4)
      speed: 10.5,
      s: 980,
      dir: 1,
      carSpacing: 20.5,
      numCoaches: 4,
    },
    {
      name: '22301 Howrah - New Jalpaiguri Vande Bharat Express',
      type: 'vandebharat',
      splineIdx: 2, // Track 17 (South Complex Line)
      speed: 15.0,
      s: 480,
      dir: 1,
      carSpacing: 22.0,
      numCoaches: 4,
    },
  ])

  // Instanced Meshes refs
  const taxiMesh = useRef<THREE.InstancedMesh>(null!)
  const busMesh = useRef<THREE.InstancedMesh>(null!)
  const autoMesh = useRef<THREE.InstancedMesh>(null!)
  const bikeMesh = useRef<THREE.InstancedMesh>(null!)
  const cartMesh = useRef<THREE.InstancedMesh>(null!)
  const truckMesh = useRef<THREE.InstancedMesh>(null!)
  const pedMesh = useRef<THREE.InstancedMesh>(null!)
  const headLightMesh = useRef<THREE.InstancedMesh>(null!)
  const tailLightMesh = useRef<THREE.InstancedMesh>(null!)

  const ferryGroup = useRef<THREE.Group>(null!)
  const trainGroup = useRef<THREE.Group>(null!)

  useEffect(() => {
    if (!pedMesh.current) return
    pedestrians.forEach((p, idx) => {
      pedMesh.current.setColorAt(idx, p.color)
    })
    if (pedMesh.current.instanceColor) {
      pedMesh.current.instanceColor.needsUpdate = true
    }
  }, [pedestrians])

  useLayoutEffect(() => {
    const offscreen = new THREE.Matrix4().makeTranslation(0, -9999, 0)
    const meshes = [taxiMesh, busMesh, autoMesh, bikeMesh, cartMesh, truckMesh]
    meshes.forEach((m) => {
      if (!m.current) return
      for (let i = 0; i < MAX_INSTANCES; i++) m.current.setMatrixAt(i, offscreen)
      m.current.count = 0
      m.current.instanceMatrix.needsUpdate = true
    })
    if (pedMesh.current) {
      for (let i = 0; i < TOTAL_PEDS; i++) pedMesh.current.setMatrixAt(i, offscreen)
      pedMesh.current.count = 0
      pedMesh.current.instanceMatrix.needsUpdate = true
    }
    if (headLightMesh.current) {
      for (let i = 0; i < MAX_INSTANCES * 2; i++) headLightMesh.current.setMatrixAt(i, offscreen)
      headLightMesh.current.count = 0
      headLightMesh.current.instanceMatrix.needsUpdate = true
    }
    if (tailLightMesh.current) {
      for (let i = 0; i < MAX_INSTANCES * 2; i++) tailLightMesh.current.setMatrixAt(i, offscreen)
      tailLightMesh.current.count = 0
      tailLightMesh.current.instanceMatrix.needsUpdate = true
    }
  }, [MAX_INSTANCES, TOTAL_PEDS])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const lightDummy = useMemo(() => new THREE.Object3D(), [])
  const worldMatrix = useMemo(() => new THREE.Matrix4(), [])
  const lightWorldMatrix = useMemo(() => new THREE.Matrix4(), [])

  // Animation & Multi-Agent Traffic Loop
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.08)

    // 1. Multi-Agent Simulation: Car-Following, Collision Avoidance, IDM
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i]
      const span = v.isBridge ? BRIDGE_TOTAL_SPAN : (v.path?.totalLen || 1000)

      let minClearance = Infinity
      let leadSpeed = v.targetSpeed
      let leadAgent: VehicleAgent | null = null

      for (let j = 0; j < vehicles.length; j++) {
        if (i === j) continue
        const other = vehicles[j]

        // Compare only within same corridor and same direction
        if (v.isBridge !== other.isBridge) continue
        if (!v.isBridge && v.path !== other.path) continue
        if (other.dir !== v.dir) continue

        // Check lateral proximity
        const laneDiff = Math.abs(other.laneOffset - v.laneOffset)
        const combinedHalfWidth = (v.width + other.width) * 0.5
        if (laneDiff < combinedHalfWidth + 0.35) {
          // Forward distance along travel direction with cyclic wrap-around
          let dist = (other.s - v.s) * v.dir
          if (dist < 0) dist += span

          if (dist > 0 && dist < span * 0.5) {
            const clearance = dist - (v.length * 0.5 + other.length * 0.5)
            if (clearance < minClearance) {
              minClearance = clearance
              leadSpeed = other.speed
              leadAgent = other
            }
          }
        }
      }

      // Two-Wheeler Gap Filtering: when traffic slows ahead, bikes split lanes and filter through!
      if (v.kind === 'bike') {
        if (minClearance < 8.0 && leadSpeed < 6.0 && !v.isFiltering) {
          v.isFiltering = true
          v.targetLane = v.laneOffset + (v.dir > 0 ? 1.1 : -1.1)
        } else if (minClearance > 14.0 && v.isFiltering) {
          v.isFiltering = false
          v.targetLane = v.isBridge 
            ? (v.dir > 0 ? BRIDGE_LANES_EAST.fastInner : BRIDGE_LANES_WEST.fastInner) 
            : (v.path ? (v.dir > 0 ? -v.path.w * 0.18 : v.path.w * 0.18) : 1.2)
        }
      }

      // Smooth lateral lane changing
      if (Math.abs(v.targetLane - v.laneOffset) > 0.02) {
        v.laneOffset = THREE.MathUtils.lerp(v.laneOffset, v.targetLane, dt * 2.5)
      }

      // Safe Car-Following Rule (IDM Deceleration) with live traffic speed factor and junction congestion (matches Google Maps Live Traffic)
      let effectiveTargetSpeed = v.targetSpeed * speedFactor
      if (v.isBridge) {
        const absS = Math.abs(v.s)
        if (absS > 220) {
          // Bottleneck slowdown near riverbank merges (matches orange/red in Google Maps)
          const mergeT = Math.min(1, (absS - 220) / (336 - 220))
          effectiveTargetSpeed *= THREE.MathUtils.lerp(1.0, 0.48, mergeT)
        }
      } else if (v.path && (v.path.idx === 429 || v.path.idx === 438 || v.path.idx === 439 || v.path.idx === 2)) {
        // High-density feeder roads moderate speed to 7-9 m/s for authentic urban flow
        effectiveTargetSpeed = Math.min(effectiveTargetSpeed, 8.5)
      }
      const minSafeGap = 3.0 // minimum standing gap (meters)
      const timeHeadway = 1.2 // safe time headway (seconds)
      const desiredGap = minSafeGap + Math.max(0, v.speed) * timeHeadway

      if (leadAgent && minClearance < 1.5) {
        // HARD ANTI-COLLISION CLAMPING: Vehicles must never penetrate!
        v.speed = 0
        if (minClearance < 1.0) {
          const reqDist = v.length * 0.5 + leadAgent.length * 0.5 + 1.8
          v.s = leadAgent.s - v.dir * reqDist
          if (v.isBridge) {
            if (v.s > BRIDGE_S_MAX) v.s -= span
            if (v.s < BRIDGE_S_MIN) v.s += span
          } else if (v.path) {
            if (v.s < 0) v.s += span
            if (v.s > span) v.s -= span
          }
        }
      } else if (leadAgent && minClearance < desiredGap) {
        // Smooth deceleration
        const gapRatio = Math.max(0, (minClearance - minSafeGap) / (desiredGap - minSafeGap + 0.001))
        const targetV = Math.min(leadSpeed * gapRatio, effectiveTargetSpeed)
        const decelRate = minClearance < 4.0 ? 8.0 : 4.0
        v.speed = THREE.MathUtils.lerp(v.speed, Math.max(0, targetV), dt * decelRate)
      } else {
        // Free-flow acceleration
        v.speed = THREE.MathUtils.lerp(v.speed, effectiveTargetSpeed, dt * 1.8)
      }

      // Advance vehicle along road
      v.s += v.dir * v.speed * dt

      // Wrap around road boundaries
      if (v.isBridge) {
        if (v.dir > 0 && v.s > BRIDGE_S_MAX) v.s -= span
        if (v.dir < 0 && v.s < BRIDGE_S_MIN) v.s += span
      } else if (v.path) {
        if (v.dir > 0 && v.s > v.path.totalLen) v.s -= span
        if (v.dir < 0 && v.s < 0) v.s += span
      }
    }

    // 2. Render Vehicle InstancedMeshes
    let taxiIdx = 0
    let busIdx = 0
    let autoIdx = 0
    let bikeIdx = 0
    let cartIdx = 0
    let truckIdx = 0
    let lightIdx = 0

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i]

      if (v.isBridge) {
        // Howrah Bridge Local Coordinates with curved Kolkata approach merging smoothly into Road 2 & Brabourne Flyover
        const localS = v.s
        const localY = deckY(localS)
        const localZCenter = roadCenterZ(localS)

        // Compute tangent and normal along the road curve
        const ds = 0.5
        const z1 = roadCenterZ(localS - ds)
        const z2 = roadCenterZ(localS + ds)
        const dz = z2 - z1
        const segLen = Math.hypot(2 * ds, dz) || 1
        const tx = (2 * ds) / segLen
        const tz = dz / segLen

        const nx = -tz
        const nz = tx

        // Vehicle position with lane offset along curve normal
        const vx = localS + nx * v.laneOffset
        const vy = localY + 0.20
        const vz = localZCenter + nz * v.laneOffset

        // Road inclination slope along travel direction
        const nextY = deckY(localS + v.dir * 1.0)
        const slopeAngle = Math.atan2(nextY - localY, 1.0)

        dummy.position.set(vx, vy, vz)

        // Forward heading: vector is (tx * v.dir, tz * v.dir).
        // Model faces -Z, so rotation around Y is Math.atan2(-tx * v.dir, -tz * v.dir)
        const heading = Math.atan2(-tx * v.dir, -tz * v.dir)
        dummy.rotation.set(0, heading, 0)
        if (slopeAngle !== 0) dummy.rotateX(-slopeAngle)
        dummy.updateMatrix()

        // Multiply by Bridge world transform
        worldMatrix.multiplyMatrices(bridgeWorldMatrix, dummy.matrix)
      } else if (v.path) {
        // City Road Network Path Coordinates
        const sample = samplePath(v.path, v.s)
        const fx = sample.fx
        const fz = sample.fz

        // In Indian Left-Hand Drive:
        // Moving forward (dir = +1 along fx, fz): driver's left is (-fz, fx)
        // Moving reverse (dir = -1 along -fx, -fz): driver's left is (fz, -fx)
        const travelFx = fx * v.dir
        const travelFz = fz * v.dir
        const leftNormalX = -travelFz
        const leftNormalZ = travelFx

        // Position on the left side of the road
        const wx = sample.x + leftNormalX * v.laneOffset
        const wy = 0.20 // Touching road surface
        const wz = sample.z + leftNormalZ * v.laneOffset

        // Orientation: models face -Z forward, so target (travelFx, travelFz) requires Math.atan2(-travelFx, -travelFz)
        const heading = Math.atan2(-travelFx, -travelFz)

        dummy.position.set(wx, wy, wz)
        dummy.rotation.set(0, heading, 0)
        dummy.updateMatrix()
        worldMatrix.copy(dummy.matrix)
      }

      // Assign to respective instanced mesh
      switch (v.kind) {
        case 'taxi':
          if (taxiIdx < MAX_INSTANCES) taxiMesh.current?.setMatrixAt(taxiIdx++, worldMatrix)
          break
        case 'bus':
          if (busIdx < MAX_INSTANCES) busMesh.current?.setMatrixAt(busIdx++, worldMatrix)
          break
        case 'auto':
          if (autoIdx < MAX_INSTANCES) autoMesh.current?.setMatrixAt(autoIdx++, worldMatrix)
          break
        case 'bike':
          if (bikeIdx < MAX_INSTANCES) bikeMesh.current?.setMatrixAt(bikeIdx++, worldMatrix)
          break
        case 'cart':
          if (cartIdx < MAX_INSTANCES) cartMesh.current?.setMatrixAt(cartIdx++, worldMatrix)
          break
        case 'truck':
          if (truckIdx < MAX_INSTANCES) truckMesh.current?.setMatrixAt(truckIdx++, worldMatrix)
          break
      }

      // Headlights & Taillights for motorized vehicles
      if (v.kind !== 'cart' && lightIdx < MAX_INSTANCES * 2 - 2) {
        const halfL = v.length * 0.48
        const halfW = v.kind === 'bus' || v.kind === 'truck' ? 1.05 : (v.kind === 'bike' ? 0.0 : 0.7)
        const hY = v.kind === 'bus' || v.kind === 'truck' ? 0.75 : 0.52

        // Front Headlights (-Z is front)
        if (halfW > 0) {
          lightDummy.position.set(-halfW, hY, -halfL)
          lightDummy.rotation.set(0, 0, 0)
          lightDummy.updateMatrix()
          lightWorldMatrix.multiplyMatrices(worldMatrix, lightDummy.matrix)
          headLightMesh.current?.setMatrixAt(lightIdx++, lightWorldMatrix)

          lightDummy.position.set(halfW, hY, -halfL)
          lightDummy.updateMatrix()
          lightWorldMatrix.multiplyMatrices(worldMatrix, lightDummy.matrix)
          headLightMesh.current?.setMatrixAt(lightIdx++, lightWorldMatrix)
        } else {
          lightDummy.position.set(0, hY, -halfL)
          lightDummy.rotation.set(0, 0, 0)
          lightDummy.updateMatrix()
          lightWorldMatrix.multiplyMatrices(worldMatrix, lightDummy.matrix)
          headLightMesh.current?.setMatrixAt(lightIdx++, lightWorldMatrix)
        }

        // Rear Taillights (+Z is rear)
        if (halfW > 0) {
          lightDummy.position.set(-halfW, hY, halfL)
          lightDummy.updateMatrix()
          lightWorldMatrix.multiplyMatrices(worldMatrix, lightDummy.matrix)
          tailLightMesh.current?.setMatrixAt(lightIdx - 2, lightWorldMatrix)

          lightDummy.position.set(halfW, hY, halfL)
          lightDummy.updateMatrix()
          lightWorldMatrix.multiplyMatrices(worldMatrix, lightDummy.matrix)
          tailLightMesh.current?.setMatrixAt(lightIdx - 1, lightWorldMatrix)
        } else {
          lightDummy.position.set(0, hY, halfL)
          lightDummy.updateMatrix()
          lightWorldMatrix.multiplyMatrices(worldMatrix, lightDummy.matrix)
          tailLightMesh.current?.setMatrixAt(lightIdx - 1, lightWorldMatrix)
        }
      }
    }

    // Update instance counts and matrices
    if (taxiMesh.current) { taxiMesh.current.count = taxiIdx; taxiMesh.current.instanceMatrix.needsUpdate = true }
    if (busMesh.current) { busMesh.current.count = busIdx; busMesh.current.instanceMatrix.needsUpdate = true }
    if (autoMesh.current) { autoMesh.current.count = autoIdx; autoMesh.current.instanceMatrix.needsUpdate = true }
    if (bikeMesh.current) { bikeMesh.current.count = bikeIdx; bikeMesh.current.instanceMatrix.needsUpdate = true }
    if (cartMesh.current) { cartMesh.current.count = cartIdx; cartMesh.current.instanceMatrix.needsUpdate = true }
    if (truckMesh.current) { truckMesh.current.count = truckIdx; truckMesh.current.instanceMatrix.needsUpdate = true }
    if (headLightMesh.current) { headLightMesh.current.count = lightIdx; headLightMesh.current.instanceMatrix.needsUpdate = true }
    if (tailLightMesh.current) { tailLightMesh.current.count = lightIdx; tailLightMesh.current.instanceMatrix.needsUpdate = true }

    // 3. Render Pedestrian Crowd
    if (pedMesh.current) {
      let pedCount = 0
      for (let i = 0; i < pedestrians.length; i++) {
        const p = pedestrians[i]

        if (p.isBridge) {
          p.s += p.dir * p.speed * dt
          if (p.dir > 0 && p.s > TOTAL_HALF_SPAN) p.s = -TOTAL_HALF_SPAN
          if (p.dir < 0 && p.s < -TOTAL_HALF_SPAN) p.s = TOTAL_HALF_SPAN

          const localY = deckY(p.s) + 0.1
          dummy.position.set(p.s, localY, p.lane)
          dummy.rotation.set(0, p.dir > 0 ? -Math.PI * 0.5 : Math.PI * 0.5, 0)
          dummy.updateMatrix()
          worldMatrix.multiplyMatrices(bridgeWorldMatrix, dummy.matrix)
        } else {
          // Ghat promenade and city pedestrians
          if (p.gx !== undefined && p.gz !== undefined && p.heading !== undefined) {
            p.gx += Math.sin(p.heading) * p.speed * dt
            p.gz += Math.cos(p.heading) * p.speed * dt
            if (p.area === 'ghat') {
              if (p.gx < 155 || p.gx > 215) p.heading = Math.PI - p.heading
              if (p.gz < 140 || p.gz > 240) p.heading = -p.heading
            } else {
              if (p.gx < 270 || p.gx > 400) p.heading = Math.PI - p.heading
              if (p.gz < -120 || p.gz > 250) p.heading = -p.heading
            }
            dummy.position.set(p.gx, 0.2, p.gz)
            dummy.rotation.set(0, p.heading, 0)
            dummy.updateMatrix()
            worldMatrix.copy(dummy.matrix)
          } else {
            dummy.position.set(180, 0.2, 180)
            dummy.rotation.set(0, 0, 0)
            dummy.updateMatrix()
            worldMatrix.copy(dummy.matrix)
          }
        }

        pedMesh.current.setMatrixAt(pedCount++, worldMatrix)
      }
      pedMesh.current.count = pedCount
      pedMesh.current.instanceMatrix.needsUpdate = true
    }

    // 4. Animate Hooghly River Ferries
    if (ferryGroup.current) {
      ferryGroup.current.children.forEach((child, fi) => {
        const f = ferries.current[fi]
        if (!f) return
        const tX = f.targetX - f.x
        const tZ = f.targetZ - f.z
        const dist = Math.hypot(tX, tZ)
        if (dist < 10) {
          const tempX = f.targetX
          const tempZ = f.targetZ
          f.targetX = f.originX
          f.targetZ = f.originZ
          f.originX = tempX
          f.originZ = tempZ
        } else {
          f.x += (tX / dist) * f.speed * dt
          f.z += (tZ / dist) * f.speed * dt
          f.heading = Math.atan2(tX, tZ)
        }
        child.position.set(f.x, WATER_Y + 0.6, f.z)
        child.rotation.y = f.heading
        const time = Date.now() * 0.002 + f.rollPhase
        child.rotation.z = Math.sin(time) * 0.035
        child.rotation.x = Math.cos(time * 0.8) * 0.015
      })
    }

    // 5. Animate Howrah Station Trains along real OSM Railway Tracks
    if (trainGroup.current && railTracks.length >= 3) {
      trainFormations.current.forEach((tf, trainIdx) => {
        const trObj = trainGroup.current.children[trainIdx] as THREE.Group
        if (!trObj) return
        const spline = railTracks[tf.splineIdx]
        if (!spline || spline.totalLen <= 0) return

        // Advance along spline
        tf.s += tf.dir * tf.speed * speedFactor * dt
        const trainTotalLen = (tf.numCoaches + 1) * tf.carSpacing
        if (tf.dir > 0 && tf.s > spline.totalLen + trainTotalLen) {
          tf.s = -50
        } else if (tf.dir < 0 && tf.s < -trainTotalLen) {
          tf.s = spline.totalLen + 50
        }

        // Position each carriage (loco + coaches) individually along the curved track spline
        trObj.children.forEach((carMesh, carIdx) => {
          const carS = tf.s - carIdx * tf.carSpacing
          // If car is outside visible track bounds, tuck underground
          if (carS < 0 || carS > spline.totalLen) {
            carMesh.position.set(0, -999, 0)
            return
          }

          const samp = sampleRail(spline.pts, spline.cumDist, spline.totalLen, carS)
          // Steel rail ribbons sit at y = 0.22; train carriage center sits at y = 2.05
          carMesh.position.set(samp.x, 2.05, samp.z)
          // Box length along Z rotates to align with track forward tangent (fx, fz)
          carMesh.rotation.y = Math.atan2(samp.fx, samp.fz)
        })
      })
    }
  })

  return (
    <>
      {/* 6 Vehicle Types - Exactly One InstancedMesh each (GPU Instanced Draw Calls) */}
      <instancedMesh ref={taxiMesh} args={[taxiGeo, vehicleMat, MAX_INSTANCES]} castShadow receiveShadow />
      <instancedMesh ref={busMesh} args={[busGeo, vehicleMat, MAX_INSTANCES]} castShadow receiveShadow />
      <instancedMesh ref={autoMesh} args={[autoGeo, vehicleMat, MAX_INSTANCES]} castShadow receiveShadow />
      <instancedMesh ref={bikeMesh} args={[bikeGeo, vehicleMat, MAX_INSTANCES]} castShadow receiveShadow />
      <instancedMesh ref={cartMesh} args={[cartGeo, vehicleMat, MAX_INSTANCES]} castShadow receiveShadow />
      <instancedMesh ref={truckMesh} args={[truckGeo, vehicleMat, MAX_INSTANCES]} castShadow receiveShadow />

      {/* Pedestrians - Single InstancedMesh for bridge, ghats & city */}
      <instancedMesh ref={pedMesh} args={[pedGeo, pedMat, TOTAL_PEDS]} castShadow />

      {/* Vehicle Lights */}
      <instancedMesh ref={headLightMesh} args={[lightGeo, headLightMat, MAX_INSTANCES * 2]} />
      <instancedMesh ref={tailLightMesh} args={[lightGeo, tailLightMat, MAX_INSTANCES * 2]} />

      {/* Hooghly River Passenger Ferries */}
      <group ref={ferryGroup}>
        {ferries.current.map((_, i) => (
          <group key={i}>
            {/* Lower Hull (deep navy blue) */}
            <mesh position={[0, 0.7, 0]} castShadow>
              <boxGeometry args={[7.2, 1.5, 23]} />
              <meshStandardMaterial color="#0c3559" roughness={0.35} metalness={0.2} />
            </mesh>
            {/* Passenger Main Deck (off-white) */}
            <mesh position={[0, 2.2, -0.5]} castShadow>
              <boxGeometry args={[6.0, 1.6, 17]} />
              <meshStandardMaterial color="#f2eee9" roughness={0.3} metalness={0.1} />
            </mesh>
            {/* Upper Wheelhouse (Kolkata orange-red) */}
            <mesh position={[0, 3.4, -3.2]}>
              <boxGeometry args={[4.4, 1.0, 5.5]} />
              <meshStandardMaterial color="#d95e16" roughness={0.4} />
            </mesh>
            {/* Wheelhouse Roof Cap */}
            <mesh position={[0, 4.0, -3.2]}>
              <boxGeometry args={[4.8, 0.2, 5.8]} />
              <meshStandardMaterial color="#ffffff" roughness={0.2} />
            </mesh>
            {/* Navigation Mast & Signal Light */}
            <mesh position={[0, 4.8, -3.2]}>
              <cylinderGeometry args={[0.08, 0.08, 1.6, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        ))}
      </group>

      {/* Howrah Station Rail Movement (Authentic Track-Following Trains along OSM Splines) */}
      <group ref={trainGroup}>
        {/* Train 1: WAP-7 Express Train (Outbound on Rail 36 toward New Delhi / Mumbai) */}
        <group name="train-wap7-express">
          {/* Car 0: WAP-7 Electric Locomotive (Red & Cream liveried) */}
          <group>
            {/* Locomotive Body (length along Z axis: 18m, width 3.2m, height 3.6m) */}
            <mesh castShadow receiveShadow>
              <boxGeometry args={[3.2, 3.4, 18.0]} />
              <meshStandardMaterial color="#b32015" roughness={0.35} metalness={0.25} />
            </mesh>
            {/* Cream Middle Band */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[3.24, 0.65, 18.1]} />
              <meshStandardMaterial color="#f5eedb" roughness={0.4} />
            </mesh>
            {/* Cab Roof Equipment & Pantographs */}
            <mesh position={[0, 1.9, 0]}>
              <boxGeometry args={[2.9, 0.45, 15.5]} />
              <meshStandardMaterial color="#b8c0c8" roughness={0.5} />
            </mesh>
            {/* Pantograph Assemblies (Front & Rear) */}
            <mesh position={[0, 2.3, 5.0]}>
              <boxGeometry args={[1.8, 0.5, 2.2]} />
              <meshStandardMaterial color="#d42015" roughness={0.5} metalness={0.6} />
            </mesh>
            <mesh position={[0, 2.3, -5.0]}>
              <boxGeometry args={[1.8, 0.5, 2.2]} />
              <meshStandardMaterial color="#d42015" roughness={0.5} metalness={0.6} />
            </mesh>
            {/* Front Headlight Light Source illuminating track rails */}
            <pointLight position={[0, 0.5, 9.2]} intensity={16} distance={35} color="#fff6dd" />
            {/* Front Bogie */}
            <mesh position={[0, -1.3, 5.2]}>
              <boxGeometry args={[2.8, 0.55, 3.8]} />
              <meshStandardMaterial color="#1f2428" roughness={0.8} />
            </mesh>
            {/* Rear Bogie */}
            <mesh position={[0, -1.3, -5.2]}>
              <boxGeometry args={[2.8, 0.55, 3.8]} />
              <meshStandardMaterial color="#1f2428" roughness={0.8} />
            </mesh>
          </group>

          {/* Cars 1..5: 5 Classic Indian Railways Royal Blue ICF Passenger Coaches */}
          {[1, 2, 3, 4, 5].map((cIdx) => (
            <group key={cIdx}>
              {/* Coach Body (length along Z: 21m) */}
              <mesh castShadow receiveShadow>
                <boxGeometry args={[3.2, 3.3, 21.0]} />
                <meshStandardMaterial color="#1a4b8c" roughness={0.4} metalness={0.2} />
              </mesh>
              {/* Windows Band */}
              <mesh position={[0, 0.35, 0]}>
                <boxGeometry args={[3.24, 0.75, 20.6]} />
                <meshStandardMaterial color="#14181c" roughness={0.2} />
              </mesh>
              {/* Coach Roof (off-white curved top) */}
              <mesh position={[0, 1.75, 0]}>
                <boxGeometry args={[3.1, 0.3, 20.8]} />
                <meshStandardMaterial color="#b8c2cc" roughness={0.5} />
              </mesh>
              {/* Wheel Bogies (Front & Rear) */}
              <mesh position={[0, -1.3, 6.8]}>
                <boxGeometry args={[2.7, 0.5, 3.5]} />
                <meshStandardMaterial color="#1f2428" roughness={0.8} />
              </mesh>
              <mesh position={[0, -1.3, -6.8]}>
                <boxGeometry args={[2.7, 0.5, 3.5]} />
                <meshStandardMaterial color="#1f2428" roughness={0.8} />
              </mesh>
            </group>
          ))}
        </group>

        {/* Train 2: Eastern Railway Suburban EMU Local (Inbound on Rail 35) */}
        <group name="train-suburban-emu">
          {/* Car 0: Driving Motor Cab (Maroon & White) */}
          <group>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[3.2, 3.3, 19.5]} />
              <meshStandardMaterial color="#7a1622" roughness={0.4} />
            </mesh>
            {/* White Upper Section */}
            <mesh position={[0, 0.65, 0]}>
              <boxGeometry args={[3.22, 1.45, 19.3]} />
              <meshStandardMaterial color="#eae5dc" roughness={0.4} />
            </mesh>
            {/* Headlight */}
            <pointLight position={[0, 0.4, 9.9]} intensity={12} distance={25} color="#fff6dd" />
            {/* Bogies */}
            <mesh position={[0, -1.3, 6.0]}>
              <boxGeometry args={[2.7, 0.5, 3.5]} />
              <meshStandardMaterial color="#1f2428" roughness={0.8} />
            </mesh>
            <mesh position={[0, -1.3, -6.0]}>
              <boxGeometry args={[2.7, 0.5, 3.5]} />
              <meshStandardMaterial color="#1f2428" roughness={0.8} />
            </mesh>
          </group>

          {/* Cars 1..4: EMU Passenger Coaches */}
          {[1, 2, 3, 4].map((cIdx) => (
            <group key={cIdx}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[3.2, 3.3, 19.5]} />
                <meshStandardMaterial color="#eae5dc" roughness={0.4} />
              </mesh>
              {/* Lower Maroon Stripe */}
              <mesh position={[0, -0.75, 0]}>
                <boxGeometry args={[3.22, 0.75, 19.4]} />
                <meshStandardMaterial color="#7a1622" roughness={0.4} />
              </mesh>
              {/* Bogies */}
              <mesh position={[0, -1.3, 6.0]}>
                <boxGeometry args={[2.7, 0.5, 3.5]} />
                <meshStandardMaterial color="#1f2428" roughness={0.8} />
              </mesh>
              <mesh position={[0, -1.3, -6.0]}>
                <boxGeometry args={[2.7, 0.5, 3.5]} />
                <meshStandardMaterial color="#1f2428" roughness={0.8} />
              </mesh>
            </group>
          ))}
        </group>

        {/* Train 3: Vande Bharat Express (White & Blue Trainset on Rail 17) */}
        <group name="train-vande-bharat">
          {/* Car 0: Aerodynamic Sleek Driving Cab */}
          <group>
            {/* Main Aerodynamic Cab Body */}
            <mesh castShadow receiveShadow>
              <boxGeometry args={[3.2, 3.3, 20.5]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.25} metalness={0.15} />
            </mesh>
            {/* Continuous Dark Tinted Window Band with Royal Blue Stripe */}
            <mesh position={[0, 0.35, 0]}>
              <boxGeometry args={[3.24, 0.8, 20.3]} />
              <meshStandardMaterial color="#1e3a8a" roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.35, 0]}>
              <boxGeometry args={[3.26, 0.45, 19.8]} />
              <meshStandardMaterial color="#0f172a" roughness={0.2} />
            </mesh>
            {/* Modern LED Headlight Beam */}
            <pointLight position={[0, 0.4, 10.4]} intensity={18} distance={32} color="#e0f2fe" />
            {/* Bogies */}
            <mesh position={[0, -1.3, 6.5]}>
              <boxGeometry args={[2.7, 0.5, 3.5]} />
              <meshStandardMaterial color="#1f2428" roughness={0.8} />
            </mesh>
            <mesh position={[0, -1.3, -6.5]}>
              <boxGeometry args={[2.7, 0.5, 3.5]} />
              <meshStandardMaterial color="#1f2428" roughness={0.8} />
            </mesh>
          </group>

          {/* Cars 1..4: Vande Bharat Passenger Coaches */}
          {[1, 2, 3, 4].map((cIdx) => (
            <group key={cIdx}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[3.2, 3.3, 21.0]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.25} metalness={0.15} />
              </mesh>
              {/* Blue cheatline & window band */}
              <mesh position={[0, 0.35, 0]}>
                <boxGeometry args={[3.24, 0.8, 20.8]} />
                <meshStandardMaterial color="#1e3a8a" roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.35, 0]}>
                <boxGeometry args={[3.26, 0.45, 20.2]} />
                <meshStandardMaterial color="#0f172a" roughness={0.2} />
              </mesh>
              {/* Bogies */}
              <mesh position={[0, -1.3, 6.8]}>
                <boxGeometry args={[2.7, 0.5, 3.5]} />
                <meshStandardMaterial color="#1f2428" roughness={0.8} />
              </mesh>
              <mesh position={[0, -1.3, -6.8]}>
                <boxGeometry args={[2.7, 0.5, 3.5]} />
                <meshStandardMaterial color="#1f2428" roughness={0.8} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    </>
  )
}
