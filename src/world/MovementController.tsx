import * as THREE from 'three'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { SceneData } from './types'
import { BRIDGE, deckY } from './Bridge'
import { WATER_Y } from './constants'

export type NavMode = 'orbit' | 'fly' | 'walk'

interface MovementControllerProps {
  mode: NavMode
  setMode: (mode: NavMode) => void
  data: SceneData
  focus: React.RefObject<THREE.Vector3>
  speed: number
  setSpeed: React.Dispatch<React.SetStateAction<number>>
}

const BRIDGE_END = BRIDGE.halfMain + BRIDGE.anchor
const BRIDGE_HALF_WIDTH = BRIDGE.roadHalf + BRIDGE.walk + 2

export function getGroundElevation(x: number, z: number, data: SceneData): number {
  const { cx, cz, dx, dz } = data.bridge
  // Projection along and perpendicular to the bridge axis
  const s = (x - cx) * dx + (z - cz) * dz
  const l = -(x - cx) * dz + (z - cz) * dx
  if (Math.abs(l) <= BRIDGE_HALF_WIDTH && Math.abs(s) <= BRIDGE_END + BRIDGE.ramp) {
    return deckY(s)
  }
  return 0 // City land datum
}

export function MovementController({ mode, setMode, data, focus, speed, setSpeed }: MovementControllerProps) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)

  const speedRef = useRef(speed)
  speedRef.current = speed

  // Orientation & velocity refs
  const yaw = useRef(0)
  const pitch = useRef(0)
  const velocity = useRef(new THREE.Vector3())
  const keys = useRef<Record<string, boolean>>({})
  const isDragging = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })

  // Initialize orientation from current camera when entering fly or walk mode
  useEffect(() => {
    if (mode === 'fly' || mode === 'walk') {
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      yaw.current = Math.atan2(-dir.x, -dir.z)
      pitch.current = Math.asin(THREE.MathUtils.clamp(dir.y, -0.99, 0.99))
      velocity.current.set(0, 0, 0)
    }
  }, [mode, camera])

  // Keyboard listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
        setMode(mode === 'fly' ? 'orbit' : 'fly')
        return
      }
      if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey) {
        setMode(mode === 'walk' ? 'orbit' : 'walk')
        return
      }
      keys.current[e.code] = true
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [mode, setMode])

  // Mouse drag & wheel listeners on canvas
  useEffect(() => {
    if (mode === 'orbit') return

    const dom = gl.domElement

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0 || e.button === 2) {
        isDragging.current = true
        lastPointer.current = { x: e.clientX, y: e.clientY }
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging.current && document.pointerLockElement !== dom) return
      const dx = document.pointerLockElement === dom ? e.movementX : e.clientX - lastPointer.current.x
      const dy = document.pointerLockElement === dom ? e.movementY : e.clientY - lastPointer.current.y
      lastPointer.current = { x: e.clientX, y: e.clientY }

      const sensitivity = 0.0024
      yaw.current -= dx * sensitivity
      pitch.current -= dy * sensitivity
      pitch.current = THREE.MathUtils.clamp(pitch.current, -Math.PI * 0.48, Math.PI * 0.48)
    }

    const onPointerUp = () => {
      isDragging.current = false
    }

    const onWheel = (e: WheelEvent) => {
      if (mode === 'fly') {
        e.preventDefault()
        setSpeed((prev) => {
          const factor = e.deltaY < 0 ? 1.25 : 0.8
          return THREE.MathUtils.clamp(Math.round(prev * factor), 5, 250)
        })
      }
    }

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }

    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    dom.addEventListener('wheel', onWheel, { passive: false })
    dom.addEventListener('contextmenu', onContextMenu)

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('wheel', onWheel)
      dom.removeEventListener('contextmenu', onContextMenu)
    }
  }, [mode, gl, setSpeed])

  // Frame update
  useFrame((_, delta) => {
    if (mode === 'orbit') return

    const dt = Math.min(delta, 0.1)
    const k = keys.current

    // Rotation from yaw and pitch
    const euler = new THREE.Euler(pitch.current, yaw.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(euler)

    // Calculate move direction
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler)
    const right = new THREE.Vector3(1, 0, 0).applyEuler(euler)
    const worldUp = new THREE.Vector3(0, 1, 0)

    const moveDir = new THREE.Vector3()

    if (mode === 'walk') {
      // In walk mode, movement is horizontal only
      forward.y = 0
      forward.normalize()
      right.y = 0
      right.normalize()
    }

    if (k['KeyW'] || k['ArrowUp']) moveDir.add(forward)
    if (k['KeyS'] || k['ArrowDown']) moveDir.sub(forward)
    if (k['KeyD'] || k['ArrowRight']) moveDir.add(right)
    if (k['KeyA'] || k['ArrowLeft']) moveDir.sub(right)

    if (mode === 'fly') {
      if (k['Space'] || k['KeyE']) moveDir.add(worldUp)
      if (k['KeyC'] || k['KeyQ']) moveDir.sub(worldUp)
    }

    if (moveDir.lengthSq() > 0) moveDir.normalize()

    // Speed calculation
    const sprint = (k['ShiftLeft'] || k['ShiftRight']) ? 2.5 : 1.0
    const targetSpeed = (mode === 'walk' ? 7.0 : speedRef.current) * sprint
    const targetVel = moveDir.clone().multiplyScalar(targetSpeed)

    // Smooth inertia
    velocity.current.lerp(targetVel, Math.min(1.0, 10 * dt))
    camera.position.addScaledVector(velocity.current, dt)

    // Boundary & elevation constraints
    if (mode === 'walk') {
      const groundY = getGroundElevation(camera.position.x, camera.position.z, data)
      const targetY = groundY + 1.72 // Human eye level
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, Math.min(1.0, 12 * dt))
    } else {
      // Fly mode river floor constraint
      if (camera.position.y < WATER_Y + 1.2) camera.position.y = WATER_Y + 1.2
    }

    // Keep camera within city bounds (+/- 1400m)
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -1450, 1450)
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -1450, 1450)
    camera.position.y = Math.min(camera.position.y, 2200)

    // Dynamic near clipping plane
    const near = THREE.MathUtils.clamp((camera.position.y - 120) * 0.3, 0.5, 250)
    if (Math.abs(near - camera.near) / camera.near > 0.05) {
      camera.near = near
      camera.updateProjectionMatrix()
    }

    // Update focus target for effects
    const camDir = new THREE.Vector3(0, 0, -1).applyEuler(euler)
    focus.current.copy(camera.position).addScaledVector(camDir, 200)
  })

  return null
}
