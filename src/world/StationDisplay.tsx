import * as THREE from 'three'
import { useMemo, useState, useEffect } from 'react'
import { Html } from '@react-three/drei'
import type { TrainStationDeparture } from '../live/types'

export function StationDisplay({
  trains = [],
}: {
  trains?: TrainStationDeparture[]
}) {
  const [page, setPage] = useState(0)

  // Cycle train pages every 4 seconds
  useEffect(() => {
    if (!trains || trains.length === 0) return
    const timer = setInterval(() => {
      setPage((prev) => (prev + 1) % Math.ceil(Math.min(trains.length, 12) / 4))
    }, 4000)
    return () => clearInterval(timer)
  }, [trains])

  const visibleTrains = useMemo(() => {
    if (!trains || trains.length === 0) return []
    const start = page * 4
    return trains.slice(start, start + 4)
  }, [trains, page])

  // Howrah Station terminal eastern entrance portico coords:
  // x = -316.5 (front façade of station building), y = 14 (above main entrance portico), z = 85 (facing east toward Hooghly river & bridge)
  const pos: [number, number, number] = [-316.5, 14, 85]

  return (
    <group position={pos} rotation={[0, Math.PI / 2, 0]}>
      {/* Heavy Steel Gantry Mounting Structure */}
      <mesh position={[0, -5, -7]}>
        <cylinderGeometry args={[0.3, 0.35, 11, 8]} />
        <meshStandardMaterial color="#2d3339" roughness={0.7} metalness={0.6} />
      </mesh>
      <mesh position={[0, -5, 7]}>
        <cylinderGeometry args={[0.3, 0.35, 11, 8]} />
        <meshStandardMaterial color="#2d3339" roughness={0.7} metalness={0.6} />
      </mesh>
      {/* Display Board Enclosure */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.6, 5.8, 15.5]} />
        <meshStandardMaterial color="#1a1c1e" roughness={0.8} metalness={0.5} />
      </mesh>

      {/* Amber Luminous Backlight */}
      <pointLight position={[0.8, 0, 0]} intensity={25} distance={18} color="#ff9922" />

      {/* Electronic Passenger Information System (PIDS) LED Display */}
      <Html
        position={[0.32, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
        transform
        distanceFactor={28}
        zIndexRange={[50, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className="pids-board">
          <div className="pids-header">
            <span className="pids-logo">🏛</span>
            <span className="pids-station">HOWRAH JUNCTION (HWH) • LIVE TRAIN INFORMATION</span>
            <span className="pids-live-tag">● LIVE PIDS</span>
          </div>

          <div className="pids-columns">
            <span className="col-time">TIME</span>
            <span className="col-train">TRAIN NO. & NAME</span>
            <span className="col-plat">PLAT</span>
            <span className="col-status">STATUS</span>
          </div>

          <div className="pids-rows">
            {visibleTrains.length > 0 ? (
              visibleTrains.map((t) => (
                <div key={t.trainNumber} className="pids-row">
                  <span className="pids-time">{t.scheduledTime}</span>
                  <span className="pids-train">
                    <span className="pids-num">{t.trainNumber}</span>
                    <span className="pids-name">{t.trainName}</span>
                  </span>
                  <span className="pids-plat">{t.platform}</span>
                  <span className={`pids-status pids-status-${t.status.toLowerCase().replace(/\s+/g, '')}`}>
                    {t.status.toUpperCase()}
                  </span>
                </div>
              ))
            ) : (
              <div className="pids-row pids-empty">
                Connecting to Howrah Terminal Train Dispatch System…
              </div>
            )}
          </div>

          <div className="pids-footer">
            <span>EASTERN RAILWAY (PF 1-16) • SOUTH EASTERN RAILWAY (PF 17-23)</span>
            <span>INDIAN RAILWAYS [MODELLED]</span>
          </div>
        </div>
      </Html>
    </group>
  )
}
