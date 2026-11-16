import * as THREE from 'three'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { SceneData } from './types'
import { BRIDGE, deckY } from './Bridge'
import { WATER_Y } from './constants'

const TOTAL_HALF_SPAN = BRIDGE.halfMain + BRIDGE.anchor + BRIDGE.ramp // ~377.7 m (Total bridge span ~755 m)

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

interface TrainAgent {
  trackZ: number
  x: number
  dir: number
  speed: number
  type: 'express' | 'emu'
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

// Extraction of merged geometry from Blender GLB with vertex color mapping
function extractMergedGeometry(scene: THREE.Group): THREE.BufferGeometry | null {
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

export function Traffic({ data }: { data: SceneData }) {
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

  const taxiGeo = useMemo(() => extractMergedGeometry(taxiGltf.scene) || createFallbackTaxi(), [taxiGltf])
  const busGeo = useMemo(() => extractMergedGeometry(busGltf.scene) || createFallbackBus(), [busGltf])
  const autoGeo = useMemo(() => extractMergedGeometry(autoGltf.scene) || createFallbackAuto(), [autoGltf])
  const bikeGeo = useMemo(() => extractMergedGeometry(bikeGltf.scene) || createFallbackBike(), [bikeGltf])
  const cartGeo = useMemo(() => extractMergedGeometry(cartGltf.scene) || createFallbackCart(), [cartGltf])
  const truckGeo = useMemo(() => extractMergedGeometry(truckGltf.scene) || createFallbackTruck(), [truckGltf])
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

  // Build Viable Road Paths across Complete City from OSM Roads
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
      // Keep drivable roads of at least 25m length
      if (totalLen >= 25) {
        list.push({ idx, pts, cumDist, totalLen, w: r.w, c: r.c })
      }
    })
    return list
  }, [data.roads])

  // Setup Fleet across COMPLETE CITY: Howrah Bridge + All City Roads (both Kolkata and Howrah sides)
  const MAX_INSTANCES = 1000
  const vehicles = useMemo<VehicleAgent[]>(() => {
    const list: VehicleAgent[] = []
    
    // 1. Howrah Bridge Dedicated Traffic (220 vehicles in 8 lanes)
    const bridgeCount = 220
    for (let i = 0; i < bridgeCount; i++) {
      const east = i % 2 === 0
      const dir = east ? 1 : -1
      const lanes = east ? BRIDGE_LANES_EAST : BRIDGE_LANES_WEST
      
      const r = Math.random()
      let kind: VehicleKind
      let lane: number
      let speed: number
      let len: number
      let wid: number
      let hei: number

      if (r < 0.08) {
        kind = 'cart'
        lane = lanes.slowKerb
        speed = 2.0 + Math.random() * 0.6
        len = 3.6; wid = 1.4; hei = 1.2
      } else if (r < 0.20) {
        kind = 'truck'
        lane = Math.random() < 0.65 ? lanes.slowKerb : lanes.middle1
        speed = 7.0 + Math.random() * 2.5
        len = 8.2; wid = 2.5; hei = 2.8
      } else if (r < 0.36) {
        kind = 'bus'
        lane = Math.random() < 0.6 ? lanes.middle1 : lanes.slowKerb
        speed = 8.5 + Math.random() * 3.0
        len = 9.6; wid = 2.45; hei = 3.1
      } else if (r < 0.52) {
        kind = 'auto'
        lane = Math.random() < 0.6 ? lanes.middle2 : lanes.slowKerb
        speed = 9.5 + Math.random() * 3.0
        len = 2.8; wid = 1.35; hei = 1.7
      } else if (r < 0.72) {
        kind = 'bike'
        lane = Math.random() < 0.65 ? lanes.fastInner : lanes.middle2
        speed = 11.0 + Math.random() * 4.0
        len = 2.0; wid = 0.6; hei = 1.5
      } else {
        kind = 'taxi'
        lane = Math.random() < 0.5 ? lanes.middle2 : (Math.random() < 0.5 ? lanes.fastInner : lanes.middle1)
        speed = 11.5 + Math.random() * 3.5
        len = 4.4; wid = 1.72; hei = 1.5
      }

      const s = (Math.random() * 2 - 1) * TOTAL_HALF_SPAN
      list.push({
        kind,
        isBridge: true,
        s,
        laneOffset: lane,
        targetLane: lane,
        dir,
        speed,
        targetSpeed: speed,
        length: len,
        width: wid,
        height: hei,
        isFiltering: false,
      })
    }

    // 2. Complete City Road Network Traffic (680 vehicles distributed across 900+ OSM road paths)
    if (cityRoadPaths.length > 0) {
      // Weight road paths by length and hierarchy (Arterials get more traffic)
      const weights = cityRoadPaths.map((p) => p.totalLen * (p.c === 0 ? 3.5 : p.c === 1 ? 1.0 : 0.4))
      const totalWeight = weights.reduce((a, b) => a + b, 0)
      const targetCityCount = 680

      for (let pi = 0; pi < cityRoadPaths.length; pi++) {
        const path = cityRoadPaths[pi]
        const numOnThisPath = Math.min(14, Math.round((weights[pi] / totalWeight) * targetCityCount))
        if (numOnThisPath === 0) continue

        for (let k = 0; k < numOnThisPath; k++) {
          const dir = k % 2 === 0 ? 1 : -1
          const r = Math.random()
          let kind: VehicleKind
          let speed: number
          let len: number
          let wid: number
          let hei: number

          // Indian Left-Hand Drive Lateral Offset from Road Centerline:
          // Wide roads (width >= 8m): slow vehicles at 0.32 * w, fast at 0.15 * w
          // Standard streets: 0.22 * w
          const isWide = path.w >= 8
          let lateralRatio: number

          if (r < 0.08) {
            kind = 'cart'
            speed = 2.0 + Math.random() * 0.5
            len = 3.6; wid = 1.4; hei = 1.2
            lateralRatio = isWide ? 0.34 : 0.22
          } else if (r < 0.18) {
            kind = 'truck'
            speed = 7.0 + Math.random() * 2.5
            len = 8.2; wid = 2.5; hei = 2.8
            lateralRatio = isWide ? 0.30 : 0.22
          } else if (r < 0.32) {
            kind = 'bus'
            speed = 8.0 + Math.random() * 2.8
            len = 9.6; wid = 2.45; hei = 3.1
            lateralRatio = isWide ? 0.25 : 0.20
          } else if (r < 0.48) {
            kind = 'auto'
            speed = 9.0 + Math.random() * 3.0
            len = 2.8; wid = 1.35; hei = 1.7
            lateralRatio = isWide ? 0.22 : 0.20
          } else if (r < 0.68) {
            kind = 'bike'
            speed = 10.5 + Math.random() * 3.5
            len = 2.0; wid = 0.6; hei = 1.5
            lateralRatio = isWide ? 0.14 : 0.18
          } else {
            kind = 'taxi' // Dominant Kolkata Yellow Taxi
            speed = 11.0 + Math.random() * 3.2
            len = 4.4; wid = 1.72; hei = 1.5
            lateralRatio = isWide ? 0.16 : 0.20
          }

          // Initial s spread evenly along the road segment
          const s = ((k + Math.random() * 0.5) / numOnThisPath) * path.totalLen
          const laneOffset = path.w * lateralRatio

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

  // Trains at Howrah Station yard
  const trains = useRef<TrainAgent[]>([
    { trackZ: 58, x: -330, dir: -1, speed: 12.0, type: 'express' },
    { trackZ: 86, x: -700, dir: 1, speed: 9.5, type: 'emu' },
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

    // 1. Multi-Agent Simulation: Car-Following & Two-Wheeler Filtering
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i]

      // Leader search within the same corridor
      let minGap = Infinity
      let leadSpeed = v.targetSpeed

      for (let j = 0; j < vehicles.length; j++) {
        if (i === j) continue
        const other = vehicles[j]

        // Compare only within same corridor and same direction
        if (v.isBridge !== other.isBridge) continue
        if (!v.isBridge && v.path !== other.path) continue
        if (other.dir !== v.dir) continue

        // Check lateral proximity
        const laneDiff = Math.abs(other.laneOffset - v.laneOffset)
        if (laneDiff < 1.4) {
          const gap = (other.s - v.s) * v.dir
          if (gap > 0 && gap < minGap) {
            minGap = gap - (v.length * 0.5 + other.length * 0.5)
            leadSpeed = other.speed
          }
        }
      }

      // Two-Wheeler Gap Filtering: when traffic slows ahead, bikes split lanes and filter through!
      if (v.kind === 'bike') {
        if (minGap < 9.0 && leadSpeed < 8.0 && !v.isFiltering) {
          v.isFiltering = true
          // Shift laterally between lanes
          v.targetLane = v.laneOffset + (v.dir > 0 ? 1.2 : -1.2)
        } else if (minGap > 14.0 && v.isFiltering) {
          v.isFiltering = false
          // Return to original lane
          v.targetLane = v.isBridge ? (v.dir > 0 ? BRIDGE_LANES_EAST.fastInner : BRIDGE_LANES_WEST.fastInner) : (v.path ? v.path.w * 0.16 : 1.2)
        }
      }

      // Smooth lane changing
      if (Math.abs(v.targetLane - v.laneOffset) > 0.05) {
        v.laneOffset = THREE.MathUtils.lerp(v.laneOffset, v.targetLane, dt * 2.5)
      }

      // Safe Car-Following Rule (IDM Deceleration)
      const safeDistance = Math.max(3.0, 3.5 + v.speed * 0.75)
      if (minGap < safeDistance) {
        const targetV = Math.max(0, leadSpeed * Math.max(0, (minGap - 1.5) / safeDistance))
        v.speed = THREE.MathUtils.lerp(v.speed, targetV, dt * 4.0)
      } else {
        v.speed = THREE.MathUtils.lerp(v.speed, v.targetSpeed, dt * 2.0)
      }

      // Advance vehicle along road
      v.s += v.dir * v.speed * dt

      // Wrap around road boundaries
      if (v.isBridge) {
        if (v.dir > 0 && v.s > TOTAL_HALF_SPAN) v.s = -TOTAL_HALF_SPAN
        if (v.dir < 0 && v.s < -TOTAL_HALF_SPAN) v.s = TOTAL_HALF_SPAN
      } else if (v.path) {
        if (v.dir > 0 && v.s > v.path.totalLen) v.s = 0
        if (v.dir < 0 && v.s < 0) v.s = v.path.totalLen
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
        // Howrah Bridge Local Coordinates
        const localS = v.s
        const localY = deckY(localS)
        const localLane = v.laneOffset

        // Road inclination slope along the bridge
        const ds = 1.0
        const slopeAngle = Math.atan2(deckY(localS + v.dir * ds) - localY, ds)

        dummy.position.set(localS, localY, localLane)
        // Vehicle models have forward pointing along -Z.
        // To face East (+X): -PI/2. To face West (-X): +PI/2
        dummy.rotation.set(0, v.dir > 0 ? -Math.PI * 0.5 : Math.PI * 0.5, 0)
        if (slopeAngle !== 0) dummy.rotateX(v.dir > 0 ? -slopeAngle : slopeAngle)
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

    // 5. Animate Howrah Station Trains
    if (trainGroup.current) {
      trainGroup.current.children.forEach((trainObj, ti) => {
        const t = trains.current[ti]
        if (!t) return
        t.x += t.dir * t.speed * dt
        if (t.dir < 0 && t.x < -740) t.x = -320
        if (t.dir > 0 && t.x > -310) t.x = -730
        trainObj.position.set(t.x, 5.2, t.trackZ)
        trainObj.rotation.y = t.dir > 0 ? 0 : Math.PI
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

      {/* Howrah Station Rail Movement (WAP-7 Express & Suburban Local Trains) */}
      <group ref={trainGroup}>
        {/* Train 1: WAP-7 Outbound Express Train */}
        <group>
          {/* WAP-7 Electric Locomotive (Red & Cream) */}
          <mesh position={[0, 1.9, 0]} castShadow>
            <boxGeometry args={[16.5, 3.6, 3.2]} />
            <meshStandardMaterial color="#b32015" roughness={0.4} metalness={0.3} />
          </mesh>
          <mesh position={[0, 3.9, 0]}>
            <boxGeometry args={[14, 0.4, 2.8]} />
            <meshStandardMaterial color="#c0b8b0" roughness={0.5} />
          </mesh>
          {/* 5 Classic Indian Railways Blue ICF Passenger Coaches */}
          {[1, 2, 3, 4, 5].map((coachIdx) => (
            <mesh key={coachIdx} position={[-coachIdx * 22, 1.85, 0]} castShadow>
              <boxGeometry args={[20.5, 3.5, 3.1]} />
              <meshStandardMaterial color="#1a4b8c" roughness={0.4} metalness={0.2} />
            </mesh>
          ))}
        </group>

        {/* Train 2: Inbound Suburban Local EMU Train (White & Maroon) */}
        <group>
          {/* EMU Driving Cab */}
          <mesh position={[0, 1.85, 0]} castShadow>
            <boxGeometry args={[19, 3.5, 3.2]} />
            <meshStandardMaterial color="#801828" roughness={0.4} />
          </mesh>
          {/* EMU Middle Coaches */}
          {[1, 2, 3, 4].map((coachIdx) => (
            <mesh key={coachIdx} position={[-coachIdx * 20.5, 1.85, 0]} castShadow>
              <boxGeometry args={[19.5, 3.5, 3.2]} />
              <meshStandardMaterial color="#dcd6cd" roughness={0.4} />
            </mesh>
          ))}
        </group>
      </group>
    </>
  )
}
