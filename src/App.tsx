import * as THREE from 'three'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerformanceMonitor } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { SceneData } from './world/types'
import { toPts } from './world/types'
import { SkyDome } from './world/Sky'
import { Lighting } from './world/Lighting'
import { Buildings } from './world/Buildings'
import { Ground } from './world/Ground'
import { River } from './world/River'
import { Bridge } from './world/Bridge'
import { Trees } from './world/Trees'
import { Context } from './world/Context'
import { Effects } from './fx/Effects'
import { makeShots, heroGhat, type Shot } from './shots'
import { WATER_Y } from './world/constants'
import { MovementController, type NavMode } from './world/MovementController'
import { Traffic } from './world/Traffic'
import { Flights } from './world/Flights'
import { StationDisplay } from './world/StationDisplay'
import { useLiveData } from './live/useLiveData'
import { LiveTelemetryOverlay } from './ui/LiveTelemetryOverlay'
import type { FlightInfo, TrainStationDeparture } from './live/types'

const MAX_DPR = 1.25
const params = new URLSearchParams(location.search)

function CameraRig({
  shot,
  focus,
  mode,
  setMode,
  data,
  speed,
  setSpeed,
}: {
  shot: Shot
  focus: React.RefObject<THREE.Vector3>
  mode: NavMode
  setMode: (mode: NavMode) => void
  data: SceneData
  speed: number
  setSpeed: React.Dispatch<React.SetStateAction<number>>
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useRef<OrbitControlsImpl>(null)

  useEffect(() => {
    if (mode === 'orbit') {
      camera.position.set(...shot.position)
      camera.fov = shot.fov
      camera.updateProjectionMatrix()
      const c = controls.current
      if (c) {
        c.target.set(...shot.target)
        c.update()
      }
      focus.current.set(...shot.target)
    }
  }, [shot, camera, focus, mode])

  useFrame(() => {
    if (mode !== 'orbit') return
    const c = controls.current
    if (c) focus.current.copy(c.target)
    // never dip under the river surface
    if (camera.position.y < WATER_Y + 1.2) camera.position.y = WATER_Y + 1.2
    // push the near plane out when high above everything: keeps depth precise for the aerial view
    const near = THREE.MathUtils.clamp((camera.position.y - 120) * 0.3, 0.5, 250)
    if (Math.abs(near - camera.near) / camera.near > 0.05) {
      camera.near = near
      camera.updateProjectionMatrix()
    }
  })

  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        enabled={mode === 'orbit'}
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={4500}
        maxPolarAngle={Math.PI * 0.66}
        zoomSpeed={0.8}
      />
      <MovementController
        mode={mode}
        setMode={setMode}
        data={data}
        focus={focus}
        speed={speed}
        setSpeed={setSpeed}
      />
    </>
  )
}

/** Frame statistics for tuning; read from window.__stats. */
function Probe({ onFreeze }: { onFreeze: () => void }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const acc = useRef({ t: performance.now(), n: 0, frames: 0 })
  useEffect(() => {
    gl.info.autoReset = false
    ;(window as unknown as { __scene?: THREE.Scene }).__scene = scene
  }, [gl, scene])
  useFrame(() => {
    const a = acc.current
    a.n++
    a.frames++
    const now = performance.now()
    const w = window as unknown as { __stats?: object; __frames?: number }
    w.__frames = a.frames
    // capture mode: stop the loop after N frames so a headless screenshot gets a settled image
    const freezeAt = Number(params.get('freeze') || 0)
    if (freezeAt && a.frames === freezeAt) {
      onFreeze()
      ;(w as { __frozen?: boolean }).__frozen = true
    }
    if (now - a.t > 1000) {
      w.__stats = { fps: Math.round((a.n * 1000) / (now - a.t)), calls: gl.info.render.calls, triangles: gl.info.render.triangles, dpr: gl.getPixelRatio() }
      a.t = now
      a.n = 0
    }
    gl.info.reset()
  })
  return null
}

function World({
  data,
  shot,
  onFreeze,
  mode,
  setMode,
  speed,
  setSpeed,
  speedFactor = 1.0,
  flights = [],
  trains = [],
  hazeDensity = 0.00023,
  hazeMax = 0.96,
  enableFog = false,
}: {
  data: SceneData
  shot: Shot
  onFreeze: () => void
  mode: NavMode
  setMode: (mode: NavMode) => void
  speed: number
  setSpeed: React.Dispatch<React.SetStateAction<number>>
  speedFactor?: number
  flights?: FlightInfo[]
  trains?: TrainStationDeparture[]
  hazeDensity?: number
  hazeMax?: number
  enableFog?: boolean
}) {
  const focus = useRef(new THREE.Vector3())
  const riverShape = useMemo(() => new THREE.Shape(toPts(data.river).map((p) => new THREE.Vector2(p[0], -p[1]))), [data])
  const ghatSpots = useMemo(() => {
    const g = heroGhat(data)
    return [{ x: g.x, z: g.z, half: 85 }, ...data.ghats.map((q) => ({ x: q.x, z: q.z, half: 48 }))]
  }, [data])
  return (
    <>
      <SkyDome />
      <Lighting focus={focus} />
      <Ground data={data} ghatSpots={ghatSpots} />
      <River shape={riverShape} />
      <Buildings data={data} />
      <Trees data={data} />
      <Context data={data} />
      <Bridge center={[data.bridge.cx, data.bridge.cz]} dir={[data.bridge.dx, data.bridge.dz]} />
      <Traffic data={data} speedFactor={speedFactor} />
      <StationDisplay trains={trains} />
      <Flights flights={flights} />
      <CameraRig
        shot={shot}
        focus={focus}
        mode={mode}
        setMode={setMode}
        data={data}
        speed={speed}
        setSpeed={setSpeed}
      />
      <Effects focus={focus} hazeDensity={hazeDensity} hazeMax={hazeMax} enableFog={enableFog} />
      <Probe onFreeze={onFreeze} />
    </>
  )
}

export function App() {
  const [data, setData] = useState<SceneData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shotId, setShotId] = useState(params.get('shot') || 'aerial')
  const [mode, setMode] = useState<NavMode>('orbit')
  const [speed, setSpeed] = useState(35)
  const [dpr, setDpr] = useState(Math.min(window.devicePixelRatio || 1, MAX_DPR))
  const fixedDpr = params.has('dpr')
  const [frozen, setFrozen] = useState(false)
  const [enableFog, setEnableFog] = useState(params.get('fog') === '1')

  // Stage 3: Live telemetry streaming with disk cache fallback
  const { telemetry, loading: telemLoading, error: telemError, refresh: telemRefresh } = useLiveData(20_000)

  const hazeDensity = telemetry?.derived.hazeDensity.value ?? 0.00023
  const hazeMax = telemetry?.derived.hazeMaxExtinction.value ?? 0.96
  const speedFactor = telemetry?.derived.trafficSpeedFactor.value ?? 1.0
  const flights = telemetry?.flights.activeFlights.value ?? []
  const trains = telemetry?.station?.howrahTrains?.value?.activeServices ?? []

  useEffect(() => {
    fetch('/api/scene')
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error || r.statusText)))))
      .then(setData)
      .catch((e) => setError(String(e.message || e)))
  }, [])

  const shots = useMemo(() => (data ? makeShots(data) : []), [data])
  const shot = useMemo(() => {
    const cam = params.get('cam')?.split(',').map(Number)
    if (cam && cam.length >= 6 && cam.every(Number.isFinite))
      return { id: 'custom', label: 'Custom', position: [cam[0], cam[1], cam[2]], target: [cam[3], cam[4], cam[5]], fov: cam[6] || 50 } as Shot
    return shots.find((s) => s.id === shotId) ?? shots[0]
  }, [shots, shotId])

  const pick = (id: string) => {
    setShotId(id)
    setMode('orbit')
    const u = new URL(location.href)
    u.searchParams.set('shot', id)
    history.replaceState(null, '', u)
  }

  if (error) return <div className="loading">Could not load the scene: {error}</div>
  if (!data || !shot) return <div className="loading">Loading Kolkata…</div>
  const h = data.meta.heights
  return (
    <>
      <LiveTelemetryOverlay
        telemetry={telemetry}
        loading={telemLoading}
        error={telemError}
        onRefresh={telemRefresh}
        enableFog={enableFog}
        onToggleFog={() => setEnableFog((prev) => !prev)}
      />

      <Canvas
        shadows
        flat
        frameloop={frozen ? 'never' : 'always'}
        dpr={fixedDpr ? Math.min(Number(params.get('dpr')) || 1, MAX_DPR) : dpr}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: shot.fov, near: 0.5, far: 40000, position: shot.position }}
      >
        {!fixedDpr && (
          <PerformanceMonitor
            bounds={() => [40, 58]}
            onChange={({ factor }) => setDpr(Math.min(window.devicePixelRatio || 1, 0.7 + (MAX_DPR - 0.7) * factor))}
          />
        )}
        <Suspense fallback={null}>
          <World
            data={data}
            shot={shot}
            onFreeze={() => setFrozen(true)}
            mode={mode}
            setMode={setMode}
            speed={speed}
            setSpeed={setSpeed}
            speedFactor={speedFactor}
            flights={flights}
            trains={trains}
            hazeDensity={hazeDensity}
            hazeMax={hazeMax}
            enableFog={enableFog}
          />
        </Suspense>
      </Canvas>

      <div className="nav-modes" role="group" aria-label="Navigation Mode">
        <button aria-pressed={mode === 'orbit'} onClick={() => setMode('orbit')}>
          <span>🔭</span> Orbit View
        </button>
        <button aria-pressed={mode === 'fly'} onClick={() => setMode('fly')}>
          <span>🚁</span> Free Flight (WASD)
        </button>
        <button aria-pressed={mode === 'walk'} onClick={() => setMode('walk')}>
          <span>🚶</span> Street Walk
        </button>
      </div>

      <div className="shots" role="group" aria-label="Saved views">
        {shots.map((s) => (
          <button key={s.id} aria-pressed={mode === 'orbit' && s.id === shot.id} onClick={() => pick(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {mode !== 'orbit' && (
        <div className="movement-hud" role="region" aria-label="Controls guide">
          <div className="hud-header">
            <span className="hud-title">{mode === 'fly' ? '🚁 Free Flight' : '🚶 Street Walk'}</span>
            <span className="hud-badge">{mode === 'fly' ? `${speed} m/s` : '6.5 m/s'}</span>
          </div>
          <div className="hud-grid">
            <div className="hud-row">
              <span className="hud-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>
              <span className="hud-action">Move forward / strafe</span>
            </div>
            {mode === 'fly' && (
              <div className="hud-row">
                <span className="hud-keys"><kbd>Space</kbd> / <kbd>Shift</kbd></span>
                <span className="hud-action">Fly Up / Down</span>
              </div>
            )}
            <div className="hud-row">
              <span className="hud-keys"><kbd>Drag Mouse</kbd></span>
              <span className="hud-action">Look around (360°)</span>
            </div>
            <div className="hud-row">
              <span className="hud-keys"><kbd>Shift</kbd></span>
              <span className="hud-action">Turbo Boost (2.5x)</span>
            </div>
            {mode === 'fly' && (
              <div className="hud-row">
                <span className="hud-keys"><kbd>Scroll Wheel</kbd></span>
                <span className="hud-action">Adjust flight speed</span>
              </div>
            )}
            <div className="hud-row">
              <span className="hud-keys"><kbd>F</kbd> / <kbd>V</kbd></span>
              <span className="hud-action">Toggle Fly / Walk</span>
            </div>
          </div>
        </div>
      )}

      <div className="note">
        Building footprints ({(h.tag + h.levels + h.est).toLocaleString()} OSM buildings), {data.roads.length.toLocaleString()} roads and {data.rails.length.toLocaleString()} rail corridors organized from OpenStreetMap (5 km extent). Surrounding fabric aligned to real street corridors. Map data © OpenStreetMap contributors.
      </div>
    </>
  )
}
