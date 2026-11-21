import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'

export type SignalPhase =
  | 'bridge_green'
  | 'bridge_yellow'
  | 'all_red_1'
  | 'cross_green'
  | 'cross_yellow'
  | 'all_red_2'

export interface SignalJunctionData {
  id: string
  name: string
  pos: [number, number, number] // [x, y, z]
  rotY: number
  width: number
}

// 3 Key Signalized Intersections in Kolkata & Howrah
export const SIGNAL_JUNCTIONS: SignalJunctionData[] = [
  {
    id: 'kolkata_bridgehead',
    name: 'Kolkata Bridgehead & Brabourne / Strand Junction',
    pos: [316.0, 0.2, 168.0],
    rotY: 1.42,
    width: 24,
  },
  {
    id: 'howrah_station_loop',
    name: 'Howrah Station & Riverfront Boulevard Junction',
    pos: [-324.0, 0.2, -86.0],
    rotY: -0.26 + Math.PI * 0.5,
    width: 22,
  },
  {
    id: 'strand_mg_crossing',
    name: 'Strand Road & Central Avenue Crossing',
    pos: [350.0, 0.2, 320.0],
    rotY: 1.25,
    width: 20,
  },
]

export const PHASE_DURATIONS: Record<SignalPhase, number> = {
  bridge_green: 18.0,
  bridge_yellow: 3.5,
  all_red_1: 2.0,
  cross_green: 14.0,
  cross_yellow: 3.0,
  all_red_2: 2.0,
}

const NEXT_PHASE: Record<SignalPhase, SignalPhase> = {
  bridge_green: 'bridge_yellow',
  bridge_yellow: 'all_red_1',
  all_red_1: 'cross_green',
  cross_green: 'cross_yellow',
  cross_yellow: 'all_red_2',
  all_red_2: 'bridge_green',
}

export function useSignalController() {
  const phaseRef = useRef<SignalPhase>('bridge_green')
  const timerRef = useRef<number>(0)
  const modeRef = useRef<'auto' | 'priority_bridge' | 'all_green'>('auto')

  return {
    phaseRef,
    timerRef,
    modeRef,
  }
}

// Procedural Traffic Light Gantry with Cantilever Arm & Signal Heads
function SignalPost({
  pos,
  rotY,
  width,
  bridgeLight,
  crossLight,
}: {
  pos: [number, number, number]
  rotY: number
  width: number
  bridgeLight: 'red' | 'yellow' | 'green'
  crossLight: 'red' | 'yellow' | 'green'
}) {
  const poleMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.6, metalness: 0.5 }), [])
  const housingMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#181a1d', roughness: 0.7, metalness: 0.3 }), [])
  const backplateMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.5, metalness: 0.2 }), [])

  // Lens materials with dynamic emissive glow
  const redMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: bridgeLight === 'red' ? '#ff1e1e' : '#4a0808',
      }),
    [bridgeLight]
  )
  const yellowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: bridgeLight === 'yellow' ? '#ffcc00' : '#4a3d00',
      }),
    [bridgeLight]
  )
  const greenMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: bridgeLight === 'green' ? '#00ff66' : '#003d17',
      }),
    [bridgeLight]
  )

  const crossRedMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: crossLight === 'red' ? '#ff1e1e' : '#4a0808',
      }),
    [crossLight]
  )
  const crossYellowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: crossLight === 'yellow' ? '#ffcc00' : '#4a3d00',
      }),
    [crossLight]
  )
  const crossGreenMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: crossLight === 'green' ? '#00ff66' : '#003d17',
      }),
    [crossLight]
  )

  const halfW = width * 0.5

  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* 1. Curb-side Vertical Mast Pole */}
      <mesh position={[-halfW - 0.8, 3.2, 0]} material={poleMat} castShadow>
        <cylinderGeometry args={[0.16, 0.22, 6.4, 16]} />
      </mesh>

      {/* Concrete Foundation Base */}
      <mesh position={[-halfW - 0.8, 0.2, 0]} material={housingMat}>
        <cylinderGeometry args={[0.35, 0.4, 0.4, 16]} />
      </mesh>

      {/* 2. Overhead Cantilever Arm spanning across lanes */}
      <mesh position={[-halfW * 0.35, 6.1, 0]} rotation={[0, 0, Math.PI * 0.5]} material={poleMat} castShadow>
        <cylinderGeometry args={[0.12, 0.14, width * 0.75, 16]} />
      </mesh>

      {/* Support Truss Bar */}
      <mesh position={[-halfW * 0.7, 5.4, 0]} rotation={[0, 0, -Math.PI * 0.28]} material={poleMat}>
        <cylinderGeometry args={[0.07, 0.07, 2.4, 12]} />
      </mesh>

      {/* 3. Main Corridor Signal Head (Overhead facing oncoming traffic) */}
      <group position={[-halfW * 0.25, 5.3, 0]}>
        {/* Yellow Backplate Shield */}
        <mesh position={[0, 0, -0.04]} material={backplateMat}>
          <boxGeometry args={[0.85, 2.1, 0.04]} />
        </mesh>
        {/* Black Housing */}
        <mesh position={[0, 0, 0]} material={housingMat} castShadow>
          <boxGeometry args={[0.65, 1.85, 0.35]} />
        </mesh>
        {/* Red Lens (Top) */}
        <mesh position={[0, 0.6, 0.18]} rotation={[Math.PI * 0.5, 0, 0]} material={redMat}>
          <cylinderGeometry args={[0.22, 0.22, 0.08, 24]} />
        </mesh>
        {/* Yellow Lens (Middle) */}
        <mesh position={[0, 0, 0.18]} rotation={[Math.PI * 0.5, 0, 0]} material={yellowMat}>
          <cylinderGeometry args={[0.22, 0.22, 0.08, 24]} />
        </mesh>
        {/* Green Lens (Bottom) */}
        <mesh position={[0, -0.6, 0.18]} rotation={[Math.PI * 0.5, 0, 0]} material={greenMat}>
          <cylinderGeometry args={[0.22, 0.22, 0.08, 24]} />
        </mesh>
      </group>

      {/* 4. Secondary Side Post Signal Head (at curb height for near vehicles) */}
      <group position={[-halfW - 0.8, 2.8, 0.3]}>
        <mesh position={[0, 0, 0]} material={housingMat} castShadow>
          <boxGeometry args={[0.45, 1.35, 0.28]} />
        </mesh>
        <mesh position={[0, 0.42, 0.14]} rotation={[Math.PI * 0.5, 0, 0]} material={redMat}>
          <cylinderGeometry args={[0.16, 0.16, 0.06, 20]} />
        </mesh>
        <mesh position={[0, 0, 0.14]} rotation={[Math.PI * 0.5, 0, 0]} material={yellowMat}>
          <cylinderGeometry args={[0.16, 0.16, 0.06, 20]} />
        </mesh>
        <mesh position={[0, -0.42, 0.14]} rotation={[Math.PI * 0.5, 0, 0]} material={greenMat}>
          <cylinderGeometry args={[0.16, 0.16, 0.06, 20]} />
        </mesh>
      </group>

      {/* 5. Cross Street Signal Head (facing 90 degrees) */}
      <group position={[-halfW - 0.8, 3.8, 0]} rotation={[0, Math.PI * 0.5, 0]}>
        <mesh position={[0, 0, 0]} material={housingMat} castShadow>
          <boxGeometry args={[0.48, 1.45, 0.3]} />
        </mesh>
        <mesh position={[0, 0.45, 0.15]} rotation={[Math.PI * 0.5, 0, 0]} material={crossRedMat}>
          <cylinderGeometry args={[0.17, 0.17, 0.06, 20]} />
        </mesh>
        <mesh position={[0, 0, 0.15]} rotation={[Math.PI * 0.5, 0, 0]} material={crossYellowMat}>
          <cylinderGeometry args={[0.17, 0.17, 0.06, 20]} />
        </mesh>
        <mesh position={[0, -0.45, 0.15]} rotation={[Math.PI * 0.5, 0, 0]} material={crossGreenMat}>
          <cylinderGeometry args={[0.17, 0.17, 0.06, 20]} />
        </mesh>
      </group>

      {/* 6. Zebra Crossing Stripes (Painted transverse white markings across roadway) */}
      <ZebraCrosswalk width={width} />
    </group>
  )
}

// Zebra Crosswalk Pattern with 10 White Reflective Bars
function ZebraCrosswalk({ width }: { width: number }) {
  const stripeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#f0ede6',
        roughness: 0.9,
        metalness: 0.05,
      }),
    []
  )

  const numStripes = 10
  const stripeW = width / (numStripes * 1.8)
  const stripeL = 3.6
  const spacing = stripeW * 1.8

  const stripes = useMemo(() => {
    const arr: number[] = []
    const startX = -((numStripes - 1) * spacing) * 0.5
    for (let i = 0; i < numStripes; i++) {
      arr.push(startX + i * spacing)
    }
    return arr
  }, [numStripes, spacing])

  return (
    <group position={[0, 0.02, 2.5]}>
      {stripes.map((sx, idx) => (
        <mesh key={idx} position={[sx, 0, 0]} rotation={[-Math.PI * 0.5, 0, 0]} material={stripeMat} receiveShadow>
          <planeGeometry args={[stripeW, stripeL]} />
        </mesh>
      ))}
      {/* Transverse White Stop Line 2.0m upstream of crosswalk */}
      <mesh position={[0, 0.02, -2.0]} rotation={[-Math.PI * 0.5, 0, 0]} material={stripeMat}>
        <planeGeometry args={[width * 0.95, 0.55]} />
      </mesh>
    </group>
  )
}

export function TrafficSignals({
  phase,
}: {
  phase: SignalPhase
}) {
  const bridgeLight =
    phase === 'bridge_green'
      ? 'green'
      : phase === 'bridge_yellow'
      ? 'yellow'
      : 'red'

  const crossLight =
    phase === 'cross_green'
      ? 'green'
      : phase === 'cross_yellow'
      ? 'yellow'
      : 'red'

  return (
    <group name="TrafficSignals">
      {SIGNAL_JUNCTIONS.map((j) => (
        <SignalPost
          key={j.id}
          pos={j.pos}
          rotY={j.rotY}
          width={j.width}
          bridgeLight={bridgeLight}
          crossLight={crossLight}
        />
      ))}
    </group>
  )
}
