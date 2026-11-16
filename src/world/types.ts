export type SceneData = {
  meta: {
    center: { lat: number; lon: number }
    half: number
    margin: number
    far: number
    source: string
    osmBase: string | null
    heights: { tag: number; levels: number; est: number }
  }
  bridge: { cx: number; cz: number; dx: number; dz: number; length: number }
  river: number[]
  land: number[][]
  banks: number[][]
  buildings: { id: number; p: number[]; holes?: number[][]; h: number; k: number; hs: number }[]
  platforms: number[][]
  roads: { p: number[]; w: number; c: number }[]
  rails: number[][]
  parks: { p: number[]; k: number }[]
  ponds: number[][]
  piers: { p: number[]; closed: boolean }[]
  ghats: { x: number; z: number; name: string }[]
  trees: number[]
  mask: { n: number; cell: number; data: string }
}
export type Pt = [number, number]
export const toPts = (f: number[]): Pt[] => {
  const o: Pt[] = []
  for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]])
  return o
}
export const polyArea = (ps: Pt[]) => {
  let a = 0
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    const q = ps[(i + 1) % ps.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}
export const inPoly = (x: number, z: number, ps: Pt[]) => {
  let c = false
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const a = ps[i]
    const b = ps[j]
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}
