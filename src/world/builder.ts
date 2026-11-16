import * as THREE from 'three'

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _d = new THREE.Vector3()
const _n = new THREE.Vector3()
const _v = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed()
const boxPos = unitBox.getAttribute('position').array as Float32Array
const boxNor = unitBox.getAttribute('normal').array as Float32Array

export type V3 = [number, number, number]
export type RGB = [number, number, number]

/** Accumulates many small solids into one non-indexed, vertex-coloured geometry (one draw call). */
export class MeshBuilder {
  pos: number[] = []
  nor: number[] = []
  col: number[] = []

  private pushBox(m: THREE.Matrix4, c: RGB) {
    const nm = new THREE.Matrix3().getNormalMatrix(m)
    for (let i = 0; i < boxPos.length; i += 3) {
      _v.set(boxPos[i], boxPos[i + 1], boxPos[i + 2]).applyMatrix4(m)
      this.pos.push(_v.x, _v.y, _v.z)
      _n.set(boxNor[i], boxNor[i + 1], boxNor[i + 2]).applyMatrix3(nm).normalize()
      this.nor.push(_n.x, _n.y, _n.z)
      this.col.push(c[0], c[1], c[2])
    }
  }

  /** Axis-aligned box given centre and size. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: RGB, rotY = 0) {
    _q.setFromAxisAngle(UP, rotY)
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz))
    this.pushBox(_m, c)
  }

  /** Bar from a to b. `inPlane` is its thickness perpendicular to the bar in the plane containing world Y (or X for vertical bars); `across` is the other. */
  bar(a: V3, b: V3, inPlane: number, across: number, c: RGB) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const len = _d.length()
    if (len < 1e-4) return
    _d.divideScalar(len)
    _q.setFromUnitVectors(UP, _d)
    _m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(inPlane, len, across))
    this.pushBox(_m, c)
  }

  tri(a: V3, b: V3, c: V3, col: RGB) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    _n.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    _n.crossVectors(_d, _n).normalize()
    this.pos.push(...a, ...b, ...c)
    for (let i = 0; i < 3; i++) {
      this.nor.push(_n.x, _n.y, _n.z)
      this.col.push(col[0], col[1], col[2])
    }
  }

  /** Quad a,b,c,d in counter-clockwise order seen from the front. */
  quad(a: V3, b: V3, c: V3, d: V3, col: RGB) {
    this.tri(a, b, c, col)
    this.tri(a, c, d, col)
  }

  /** Vertical prism (n-gon), with top cap. */
  prism(cx: number, cz: number, r: number, y0: number, y1: number, sides: number, c: RGB, rot = 0) {
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2
      const a1 = rot + ((i + 1) / sides) * Math.PI * 2
      const p0: V3 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r]
      const p1: V3 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r]
      const p2: V3 = [p1[0], y1, p1[2]]
      const p3: V3 = [p0[0], y1, p0[2]]
      this.quad(p0, p3, p2, p1, c)
      this.tri([cx, y1, cz], p2, p3, c)
    }
  }

  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.computeBoundingSphere()
    return g
  }
}

/** sRGB hex -> linear RGB triple for vertex colours. */
export const lin = (hex: string): RGB => {
  const c = new THREE.Color(hex)
  return [c.r, c.g, c.b]
}
export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]

/** Deterministic PRNG. */
export function rng(seed: number) {
  let s = (seed >>> 0) || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
