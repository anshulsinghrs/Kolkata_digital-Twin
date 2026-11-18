import * as THREE from 'three'
import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { EffectComposer, ToneMapping, Noise, Vignette, SMAA } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { HazeEffect } from './HazeEffect'

function Haze({ density, max }: { density: number; max: number }) {
  const camera = useThree((s) => s.camera)
  const effect = useMemo(() => new HazeEffect(camera, { density, max }), [camera])
  useEffect(() => {
    effect.setAtmosphere(density, max)
  }, [effect, density, max])
  return <primitive object={effect} dispose={null} />
}

/**
 * Stable visual post-processing pipeline:
 * Dynamic Live Haze (PM2.5 + RH) -> filmic tone map -> subtle film grain -> vignette -> SMAA.
 */
export function Effects({
  focus: _focus,
  hazeDensity = 0.00023,
  hazeMax = 0.96,
  enableFog = false,
}: {
  focus: React.RefObject<THREE.Vector3>
  hazeDensity?: number
  hazeMax?: number
  enableFog?: boolean
}) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false} frameBufferType={THREE.HalfFloatType}>
      {enableFog && <Haze density={hazeDensity} max={hazeMax} />}
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.065} />
      <Vignette offset={0.36} darkness={0.32} />
      <SMAA />
    </EffectComposer>
  )
}
