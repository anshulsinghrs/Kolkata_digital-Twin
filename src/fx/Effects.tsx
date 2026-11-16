import * as THREE from 'three'
import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { EffectComposer, ToneMapping, Noise, Vignette, SMAA } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { HazeEffect } from './HazeEffect'

function Haze() {
  const camera = useThree((s) => s.camera)
  const effect = useMemo(() => new HazeEffect(camera), [camera])
  return <primitive object={effect} dispose={null} />
}

/**
 * Stable visual post-processing pipeline:
 * Haze -> filmic tone map -> subtle film grain -> vignette -> SMAA.
 */
export function Effects({ focus: _focus }: { focus: React.RefObject<THREE.Vector3> }) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false} frameBufferType={THREE.HalfFloatType}>
      <Haze />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.065} />
      <Vignette offset={0.36} darkness={0.32} />
      <SMAA />
    </EffectComposer>
  )
}
