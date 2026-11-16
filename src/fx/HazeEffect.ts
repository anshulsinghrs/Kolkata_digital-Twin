import * as THREE from 'three'
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing'
import { SKY_GLSL } from '../world/glsl'
import { SUN_DIR } from '../world/constants'

// Humid-air haze as a depth-based pass: exponential fog with height falloff,
// tinted by the horizon colour in the view direction (warmer towards the sun).
const frag = /* glsl */ `
uniform mat4 uProjInv; uniform mat4 uCamWorld; uniform vec3 uCamPos; uniform vec3 uSun;
uniform float uDensity; uniform float uScaleHeight; uniform float uMax; uniform float uExposure;
${SKY_GLSL}
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor){
  if (depth >= 0.999999) { outputColor = vec4(inputColor.rgb * uExposure, inputColor.a); return; }
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  v /= v.w;
  vec3 ray = (uCamWorld * vec4(v.xyz, 0.0)).xyz;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-3);
  float k = ray.y / uScaleHeight;
  float base = exp(-max(uCamPos.y, 0.0) / uScaleHeight);
  float integ = abs(k) < 1e-3 ? base : base * (1.0 - exp(-k)) / k;
  // thickens a little faster than pure exponential so the far distance dissolves while the subject stays clear
  float f = 1.0 - exp(-uDensity * dist * integ * (1.0 + dist / 5000.0));
  f = min(f, uMax);
  vec3 hc = hazeColor(dir, uSun);
  // in-scatter glow: haze between you and the sun is brighter
  hc += vec3(1.0, 0.55, 0.25) * 0.35 * pow(max(dot(dir, uSun), 0.0), 10.0);
  outputColor = vec4(mix(inputColor.rgb, hc, f) * uExposure, inputColor.a);
}`

export class HazeEffect extends Effect {
  private cam: THREE.Camera
  constructor(camera: THREE.Camera, { density = 0.00023, scaleHeight = 320, max = 0.96, exposure = 0.92 } = {}) {
    super('HazeEffect', frag, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uSun', new THREE.Uniform(SUN_DIR)],
        ['uDensity', new THREE.Uniform(density)],
        ['uScaleHeight', new THREE.Uniform(scaleHeight)],
        ['uMax', new THREE.Uniform(max)],
        ['uExposure', new THREE.Uniform(exposure)],
      ]),
    })
    this.cam = camera
  }
  update() {
    const c = this.cam as THREE.PerspectiveCamera
    this.uniforms.get('uProjInv')!.value.copy(c.projectionMatrixInverse)
    this.uniforms.get('uCamWorld')!.value.copy(c.matrixWorld)
    this.uniforms.get('uCamPos')!.value.setFromMatrixPosition(c.matrixWorld)
  }
}
