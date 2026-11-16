import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { SkyDome } from './Sky'
import { SUN_COLOR, SUN_DIR, SUN_INTENSITY } from './constants'

const MAP = 4096
const EL = Math.asin(SUN_DIR.y)

/**
 * Low sun with one shadow map that follows whatever the camera is looking at:
 * tight around the subject for close shots, wide for the aerial. The scene is
 * static, so the map is only redrawn when that region actually changes.
 */
export function Lighting({ focus }: { focus: React.RefObject<THREE.Vector3> }) {
  const light = useRef<THREE.DirectionalLight>(null!)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const last = useRef({ x: 1e9, z: 1e9, size: 0 })
  const basis = useMemo(() => {
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize()
    const up = new THREE.Vector3().crossVectors(SUN_DIR, right).normalize()
    return { right, up }
  }, [])

  useEffect(() => {
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    gl.shadowMap.autoUpdate = true
  }, [gl])

  useFrame(() => {
    const l = light.current
    const f = focus.current
    const dist = camera.position.distanceTo(f)
    // quantised so small zooms do not thrash the shadow map
    const raw = THREE.MathUtils.clamp(dist * 1.15, 220, 1700)
    const size = Math.pow(1.3, Math.round(Math.log(raw) / Math.log(1.3)))
    const texel = (size * 2) / MAP
    // snap the centre to whole texels in light space to stop shimmer while panning
    const c = new THREE.Vector3(f.x, 0, f.z)
    const sx = Math.round(c.dot(basis.right) / texel) * texel
    const sy = Math.round(c.dot(basis.up) / texel) * texel
    const sd = c.dot(SUN_DIR)
    if (Math.abs(sx - last.current.x) < texel * 8 && Math.abs(sy - last.current.z) < texel * 8 && size === last.current.size) return
    last.current = { x: sx, z: sy, size }
    c.copy(basis.right).multiplyScalar(sx).addScaledVector(basis.up, sy).addScaledVector(SUN_DIR, sd)
    l.target.position.copy(c)
    l.target.updateMatrixWorld()
    l.position.copy(c).addScaledVector(SUN_DIR, 3000)
    const cam = l.shadow.camera
    cam.left = -size
    cam.right = size
    // the frustum only needs to be as tall as the ground footprint seen from a low sun
    const tall = size * Math.sin(EL) + 130
    cam.top = tall
    cam.bottom = -tall
    cam.near = 200
    cam.far = 6500
    cam.updateProjectionMatrix()
    l.shadow.normalBias = Math.max(0.12, texel * 1.4)
    gl.shadowMap.needsUpdate = true
  })

  return (
    <>
      <Environment resolution={128} frames={1} background={false} environmentIntensity={0.65}>
        <SkyDome env />
      </Environment>
      {/* Rich ambient fill: mimics human eye dynamic range in outdoor daylight shadows */}
      <ambientLight color="#ffede0" intensity={1.5} />
      <directionalLight
        ref={light}
        color={SUN_COLOR}
        intensity={SUN_INTENSITY}
        castShadow
        shadow-mapSize={[MAP, MAP]}
        shadow-bias={-0.0004}
      />
      {/* Upward river & land bounce light: illuminates the underside of trusses, roadway and facades */}
      <directionalLight position={[0, -500, 0]} color="#edd8c4" intensity={2.2} />
      {/* Soft eastern sky fill light: prevents opposite-sun facades and shadows from crushing to pure black */}
      <directionalLight position={[500, 150, 0]} color="#e0e4ec" intensity={1.4} />
      <hemisphereLight args={['#ffebd6', '#9e8975', 1.6]} />
    </>
  )
}
