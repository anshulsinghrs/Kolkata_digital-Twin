import * as THREE from 'three'

// World frame: metres, x east, y up, z south. Origin at 22.5851 N, 88.3468 E. Land is y = 0.
export const WATER_Y = -4.2
export const DECK_Y = 7.0 // bridge roadway above land datum

// Golden hour: sun low in the west-south-west.
const AZ = THREE.MathUtils.degToRad(262) // compass bearing of the sun
const EL = THREE.MathUtils.degToRad(12)
export const SUN_DIR = new THREE.Vector3(
  Math.sin(AZ) * Math.cos(EL),
  Math.sin(EL),
  -Math.cos(AZ) * Math.cos(EL),
).normalize()
export const SUN_COLOR = new THREE.Color(1.0, 0.71, 0.43)
export const SUN_INTENSITY = 5.4
