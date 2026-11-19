import * as THREE from 'three'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { SceneData } from './types'
import { NOISE_GLSL } from './glsl'

const h3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}

// One canopy and one trunk geometry, instanced a few thousand times.
function canopyGeometry() {
  const blobs: THREE.BufferGeometry[] = []
  const defs: [number, number, number, number, number][] = [
    [0, 7.5, 0, 3.4, 1],
    [2.1, 6.3, 0.7, 2.5, 1],
    [-1.8, 6.5, -1.3, 2.6, 1],
    [0.2, 5.9, 2.1, 2.3, 0],
    [-0.5, 6.0, -2.4, 2.1, 0],
  ]
  for (const [x, y, z, rad, detail] of defs) {
    const g = new THREE.IcosahedronGeometry(rad, detail)
    const p = g.getAttribute('position') as THREE.BufferAttribute
    const n = g.getAttribute('normal') as THREE.BufferAttribute
    const col = new Float32Array(p.count * 3)
    for (let i = 0; i < p.count; i++) {
      // displacement keyed on the vertex position, so faces that share a corner stay joined
      const ox = Math.round(p.getX(i) * 100), oy = Math.round(p.getY(i) * 100), oz = Math.round(p.getZ(i) * 100)
      const k = 1 + (h3(ox + x, oy + y, oz + z) - 0.5) * 0.36
      const vx = p.getX(i) * k, vy = p.getY(i) * k * 0.8, vz = p.getZ(i) * k
      p.setXYZ(i, vx + x, vy + y, vz + z)
      // soft normals from the tree's core rather than per face, lifted so tops catch the light
      const nn = new THREE.Vector3(vx + x * 0.6, vy + (y - 6.2) + rad * 0.3, vz + z * 0.6).normalize()
      n.setXYZ(i, nn.x, nn.y, nn.z)
      // darker underneath and inside: cheap self-shadowing
      const t = THREE.MathUtils.clamp((vy + y - 4.0) / 6.5, 0, 1)
      const s = 0.36 + 0.78 * t + (h3(oz, ox, oy) - 0.5) * 0.12
      col[i * 3] = s
      col[i * 3 + 1] = s
      col[i * 3 + 2] = s * 0.9
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.deleteAttribute('uv')
    blobs.push(g)
  }
  return mergeGeometries(blobs)!
}

const GREENS = ['#34471f', '#3e5424', '#2c4022', '#4a5a28', '#3a4c1e', '#28391f', '#56602a'].map((h) => new THREE.Color(h))

export function Trees({ data }: { data: SceneData }) {
  const canopy = useRef<THREE.InstancedMesh>(null!)
  const trunk = useRef<THREE.InstancedMesh>(null!)
  const count = data.trees.length / 4
  const canopyGeo = useMemo(canopyGeometry, [])
  const trunkGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.16, 0.3, 5.4, 6, 1, true)
    g.translate(0, 2.7, 0)
    return g
  }, [])
  const canopyMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;')
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // leaf clumps: mottled light and dark, finer when close
            float vd = length(vViewPosition);
            float near = 1.0 - smoothstep(25.0, 140.0, vd);
            vec2 a = vWPos.xz + vWPos.y * vec2(0.71, -0.53);
            vec2 b = vWPos.zy * vec2(1.0, 1.3) + vWPos.x * 0.37;
            float clump = 0.5 * (vnoise(a * 0.9) + vnoise(b * 0.9));
            float leaf = 0.5 * (vnoise(a * 4.3) + vnoise(b * 4.3));
            float t = mix(clump, 0.55 * clump + 0.45 * leaf, near);
            diffuseColor.rgb *= mix(0.62, 1.32, smoothstep(0.25, 0.75, t));
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.12, 0.6), smoothstep(0.62, 0.8, t) * 0.5);
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.20;')
    }
    return m
  }, [])
  const trunkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3b3027', roughness: 1 }), [])

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const c = new THREE.Color()
    const { cx, cz, dx, dz } = data.bridge

    for (let i = 0; i < count; i++) {
      const x = data.trees[i * 4], z = data.trees[i * 4 + 1], s = data.trees[i * 4 + 2], h = data.trees[i * 4 + 3]
      
      // Remove trees that fall on the bridge road, approach ramp, and main road connector corridor
      const wx = x - cx
      const wz = z - cz
      const bridgeS = wx * dx + wz * dz
      const bridgeL = -wx * dz + wz * dx
      if (bridgeS >= 440 && bridgeS <= 568 && Math.abs(bridgeL) <= 22) {
        m.makeTranslation(0, -9999, 0)
        canopy.current.setMatrixAt(i, m)
        trunk.current.setMatrixAt(i, m)
        continue
      }

      q.setFromAxisAngle(up, h * Math.PI * 2)
      const wide = s * (0.95 + ((h * 7) % 1) * 0.4)
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(wide, s, wide))
      canopy.current.setMatrixAt(i, m)
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s))
      trunk.current.setMatrixAt(i, m)
      c.copy(GREENS[Math.floor(h * 97) % GREENS.length]).multiplyScalar(0.72 + ((h * 13) % 1) * 0.4)
      canopy.current.setColorAt(i, c)
    }
    canopy.current.instanceMatrix.needsUpdate = true
    trunk.current.instanceMatrix.needsUpdate = true
    if (canopy.current.instanceColor) canopy.current.instanceColor.needsUpdate = true
    canopy.current.computeBoundingSphere()
    trunk.current.computeBoundingSphere()
  }, [data, count])

  return (
    <group>
      <instancedMesh ref={canopy} args={[canopyGeo, canopyMat, count]} castShadow />
      <instancedMesh ref={trunk} args={[trunkGeo, trunkMat, count]} castShadow />
    </group>
  )
}
