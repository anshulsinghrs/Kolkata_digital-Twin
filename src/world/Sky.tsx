import * as THREE from 'three'
import { useMemo } from 'react'
import { SKY_GLSL, NOISE_GLSL } from './glsl'
import { SUN_DIR } from './constants'

/** Sky dome. With `env` it is the lighting capture: no sun disc, ground half darkened. */
export function SkyDome({ env = false }: { env?: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: { uSun: { value: SUN_DIR }, uEnv: { value: env ? 1 : 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main(){
            vDir = normalize(position);
            vec4 p = modelViewMatrix * vec4(position, 0.0); // rotation only: dome follows the camera
            gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
            gl_Position.z = gl_Position.w; // at the far plane
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun; uniform float uEnv; varying vec3 vDir;
          ${NOISE_GLSL}
          ${SKY_GLSL}
          void main(){
            vec3 d = normalize(vDir);
            vec3 col = d.y < 0.0 ? hazeColor(d, uSun) : skyColor(d, uSun);
            // thin high cloud streaks, lit warm from below
            if (d.y > 0.0) {
              vec2 cp = d.xz / (d.y + 0.12);
              float c = fbm(cp * vec2(0.55, 1.9) + 3.0) * 0.7 + fbm(cp * vec2(1.7, 4.6) + 11.0) * 0.3;
              c = smoothstep(0.44, 0.74, c) * smoothstep(0.03, 0.30, d.y) * 0.62;
              float mu = max(dot(d, uSun), 0.0);
              vec3 cc = mix(vec3(0.86, 0.70, 0.66), vec3(1.6, 1.0, 0.62), pow(mu, 2.5));
              col = mix(col, cc, c);
            }
            float mu = dot(d, uSun);
            float discM = smoothstep(0.99988, 0.99997, mu);
            col += (1.0 - uEnv) * discM * vec3(80.0, 44.0, 15.0);
            // for image-based lighting the lower hemisphere is the ground: darker, warm bounce
            if (uEnv > 0.5) col = mix(col, col * vec3(0.34, 0.29, 0.24), smoothstep(0.02, -0.25, d.y));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [env],
  )
  return (
    <mesh material={material} frustumCulled={false} renderOrder={-1000}>
      <sphereGeometry args={[5000, 48, 24]} />
    </mesh>
  )
}
