import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { FlightInfo } from '../live/types'

// Build a clean low-poly airliner geometry once
function createAirlinerGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()

  // Fuselage: aerodynamic body
  const body = new THREE.CylinderGeometry(2.0, 1.4, 38, 10)
  body.rotateX(Math.PI / 2) // Orient along Z axis

  // Main wings: swept back
  const wings = new THREE.BoxGeometry(34, 0.5, 5.5)
  wings.translate(0, -0.2, 2)

  // Vertical tailfin
  const fin = new THREE.BoxGeometry(0.5, 7.5, 4.8)
  fin.translate(0, 4.5, -14)

  // Horizontal stabilizers
  const hStab = new THREE.BoxGeometry(12, 0.4, 3.2)
  hStab.translate(0, 1.2, -15)

  // Engines
  const engineL = new THREE.CylinderGeometry(0.9, 0.9, 4.5, 8)
  engineL.rotateX(Math.PI / 2)
  engineL.translate(-6.5, -1.8, 1.5)

  const engineR = new THREE.CylinderGeometry(0.9, 0.9, 4.5, 8)
  engineR.rotateX(Math.PI / 2)
  engineR.translate(6.5, -1.8, 1.5)

  // Combine parts
  // Use simple group or merged geometry
  return body
}

function SingleFlight({ flight }: { flight: FlightInfo }) {
  const group = useRef<THREE.Group>(null!)
  const headingRad = flight.headingDeg != null ? -(flight.headingDeg * Math.PI) / 180 : 0
  const y = Math.max(80, flight.altitudeMeters ?? 600)

  // Subdued airliner materials
  const airframeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#f0f3f6',
        roughness: 0.35,
        metalness: 0.25,
      }),
    []
  )

  const wingMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#d6dde4',
        roughness: 0.45,
        metalness: 0.15,
      }),
    []
  )

  const strobeRef = useRef<THREE.Mesh>(null!)
  useFrame(({ clock }) => {
    // White strobe flash every 1.2 seconds
    if (strobeRef.current) {
      const flash = Math.sin(clock.getElapsedTime() * 5.2) > 0.85
      strobeRef.current.visible = flash
    }
  })

  // Only render if flight is within 45 km of center
  const distFromCenter = Math.hypot(flight.worldX, flight.worldZ)
  if (distFromCenter > 45_000) return null

  return (
    <group ref={group} position={[flight.worldX, y, flight.worldZ]} rotation={[0, headingRad, 0]}>
      {/* Fuselage */}
      <mesh material={airframeMat}>
        <cylinderGeometry args={[2.0, 1.4, 38, 10]} />
      </mesh>

      {/* Main Wings */}
      <mesh position={[0, -0.2, 2]} material={wingMat}>
        <boxGeometry args={[34, 0.5, 5.5]} />
      </mesh>

      {/* Vertical Tailfin */}
      <mesh position={[0, 4.5, -14]} material={airframeMat}>
        <boxGeometry args={[0.5, 7.5, 4.8]} />
      </mesh>

      {/* Horizontal Stabilizers */}
      <mesh position={[0, 1.2, -15]} material={wingMat}>
        <boxGeometry args={[12, 0.4, 3.2]} />
      </mesh>

      {/* Jet Engines */}
      <mesh position={[-6.5, -1.8, 1.5]} material={airframeMat}>
        <cylinderGeometry args={[0.9, 0.9, 4.5, 8]} />
      </mesh>
      <mesh position={[6.5, -1.8, 1.5]} material={airframeMat}>
        <cylinderGeometry args={[0.9, 0.9, 4.5, 8]} />
      </mesh>

      {/* Nav Lights: Red Port, Green Starboard */}
      <mesh position={[-17.2, -0.2, 2]}>
        <sphereGeometry args={[0.35, 6, 6]} />
        <meshBasicMaterial color="#ff2222" />
      </mesh>
      <mesh position={[17.2, -0.2, 2]}>
        <sphereGeometry args={[0.35, 6, 6]} />
        <meshBasicMaterial color="#22ff44" />
      </mesh>

      {/* Flashing Strobe Light on Tail */}
      <mesh ref={strobeRef} position={[0, 8.5, -15.5]}>
        <sphereGeometry args={[0.45, 6, 6]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      {/* Contrail if high altitude */}
      {y > 1200 && (
        <group position={[0, -1.8, -25]}>
          <mesh position={[-6.5, 0, 0]}>
            <cylinderGeometry args={[0.8, 2.5, 40, 6]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
          </mesh>
          <mesh position={[6.5, 0, 0]}>
            <cylinderGeometry args={[0.8, 2.5, 40, 6]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
          </mesh>
        </group>
      )}

      {/* 3D Billboard Radar Label */}
      <Html
        position={[0, 9, 0]}
        center
        distanceFactor={600}
        zIndexRange={[100, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className="flight-billboard">
          <div className="flight-callsign">✈ {flight.callsign}</div>
          <div className="flight-meta">
            {flight.altitudeMeters != null ? `${flight.altitudeMeters}m` : 'ALT UNK'} •{' '}
            {flight.velocityKmph != null ? `${Math.round(flight.velocityKmph)} km/h` : ''}
          </div>
        </div>
      </Html>
    </group>
  )
}

export function Flights({ flights }: { flights: FlightInfo[] }) {
  if (!flights || flights.length === 0) return null

  return (
    <group name="live-flights">
      {flights.map((f) => (
        <SingleFlight key={f.icao24} flight={f} />
      ))}
    </group>
  )
}
