import * as THREE from 'three'
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { NOISE_GLSL } from './glsl'
import { SUN_DIR, SUN_COLOR, WATER_Y } from './constants'

// Silty tidal river: planar reflection of the real scene, rippled by animated
// procedural waves, with a fresnel blend into murky body colour and a long sun glint.
const shader = {
  name: 'RiverShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uSun: { value: SUN_DIR },
    uSunColor: { value: SUN_COLOR },
  },
  vertexShader: /* glsl */ `
    varying vec3 vLocal; varying vec3 vWorld;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vLocal = position;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform mat4 textureMatrix;
    uniform float uTime; uniform vec3 uSun; uniform vec3 uSunColor;
    varying vec3 vLocal; varying vec3 vWorld;
    ${NOISE_GLSL}
    // quintic value noise: continuous second derivative, so normals show no grid creases
    float wn(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
                 mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    // Wind ripples riding a slow current. Crests are elongated across the wind and
    // bent by a drifting warp, so nothing lines up into stripes.
    vec2 warp(vec2 p){
      float t = uTime;
      return p + 3.2 * vec2(wn(p * 0.03 + t * 0.02), wn(p * 0.03 + 5.2 - t * 0.017));
    }
    float coarseH(vec2 p){
      float t = uTime; vec2 q = warp(p);
      vec2 a = vec2(q.x * 0.80 + q.y * 0.60, (-q.x * 0.60 + q.y * 0.80) * 2.3);
      vec2 b = vec2(q.x * 0.31 - q.y * 0.95, (q.x * 0.95 + q.y * 0.31) * 1.9);
      float h = 0.34 * wn(a * 0.085 + vec2(t * 0.09, 0.0));
      h += 0.17 * wn(a * 0.21 + vec2(t * 0.16, 3.1));
      h += 0.13 * wn(b * 0.15 + vec2(-t * 0.12, 9.7));
      return h;
    }
    float fineH(vec2 p, float k1, float k2){
      float t = uTime; vec2 q = warp(p);
      vec2 a = vec2(q.x * 0.80 + q.y * 0.60, (-q.x * 0.60 + q.y * 0.80) * 2.1);
      float h = k1 * 0.050 * wn(a * 0.60 + vec2(t * 0.34, 1.7));
      h += k1 * 0.026 * wn(a * 1.35 + vec2(t * 0.6, 4.4));
      h += k2 * 0.012 * wn(a * 3.2 + vec2(-t * 0.9, 8.1));
      return h;
    }
    void main(){
      vec3 toCam = cameraPosition - vWorld;
      float dist = length(toCam);
      vec3 V = toCam / dist;
      // how many metres of water one pixel covers along the view direction: waves smaller
      // than this cannot be drawn, so they are faded out and replaced by blur and a wider glint
      float fp = dist * dist / (max(cameraPosition.y - vWorld.y, 1.0) * 1100.0);
      float kc = clamp(7.0 / fp, 0.0, 1.0);
      float k1 = clamp(1.6 / fp, 0.0, 1.0);
      float k2 = clamp(0.45 / fp, 0.0, 1.0);
      float ec = 0.5 + dist * 0.004;
      float c0 = coarseH(vWorld.xz);
      vec2 sc = vec2(coarseH(vWorld.xz + vec2(ec, 0.0)) - c0, coarseH(vWorld.xz + vec2(0.0, ec)) - c0) / ec * kc;
      float ef = 0.07 + dist * 0.002;
      float f0 = fineH(vWorld.xz, k1, k2);
      vec2 sf = vec2(fineH(vWorld.xz + vec2(ef, 0.0), k1, k2) - f0, fineH(vWorld.xz + vec2(0.0, ef), k1, k2) - f0) / ef;
      vec2 slope = sc + sf;
      vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

      // Accurate screen-space reflection coordinates
      vec4 uv4 = textureMatrix * vec4(vLocal, 1.0);
      vec2 baseUv = uv4.xy / uv4.w;

      // Ripple distortion in UV space:
      // Vertical and lateral wave displacement ripples the reflection, dampened with distance
      vec2 waveDistort = vec2(slope.x * 0.014, slope.y * 0.022) * (0.35 + 0.65 * kc);
      vec2 sampleUv = clamp(baseUv + waveDistort, 0.002, 0.998);

      // Multi-tap jitter for silky river reflection
      float blur = 0.003 * (1.0 - kc * 0.65);
      float j = hash21(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5;
      vec3 refl = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        float o = (float(i) - 1.5 + j) * 0.6;
        vec2 suv = clamp(sampleUv + vec2(o * 0.1, o) * blur, 0.002, 0.998);
        refl += texture2D(tDiffuse, suv).rgb;
      }
      refl *= 0.25;

      float ndv = clamp(dot(N, V), 0.001, 1.0);
      // Realistic Schlick Fresnel for river water: F0 = 0.02
      float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
      fres = clamp(fres, 0.04, 0.62);

      // Authentic Hooghly silt tone: deep muddy khaki-brown
      vec3 silt = vec3(0.18, 0.14, 0.095);
      vec3 body = silt * (0.60 + 0.75 * max(dot(N, uSun), 0.0) * uSunColor);

      // Blend silty water body with rippled sky & bridge reflection
      vec3 col = mix(body, refl * vec3(0.92, 0.88, 0.80), fres);

      // Refined golden sun path glint (tight, elegant shimmer path on wave crests)
      vec3 H = normalize(uSun + V);
      float nh = max(dot(N, H), 0.0);
      float glint = pow(nh, 320.0) * 1.8 * k1 + pow(nh, 80.0) * 0.22 * kc;
      col += uSunColor * glint * fres;

      gl_FragColor = vec4(col, 1.0);
    }`,
}

export function River({ shape }: { shape: THREE.Shape }) {
  const water = useMemo(() => {
    const geo = new THREE.ShapeGeometry(shape, 1)
    const r = new Reflector(geo, { textureWidth: 1024, textureHeight: 1024, clipBias: 0.02, shader, multisample: 0 })
    // Shape lives in (x, -z); lay it flat.
    r.rotation.x = -Math.PI / 2
    r.position.y = WATER_Y
    return r
  }, [shape])
  useEffect(() => () => water.dispose(), [water])
  useFrame((_, dt) => {
    ;(water.material as THREE.ShaderMaterial).uniforms.uTime.value += Math.min(dt, 0.1)
  })
  return <primitive object={water} />
}
