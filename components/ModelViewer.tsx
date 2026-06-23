'use client'

import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

const MODELS = [
  { path: '/models/lamp_01.glb', color: '#7BAEC4' },
  { path: '/models/lamp_02.glb', color: '#C4A87B' },
  { path: '/models/lamp_03.glb', color: '#8BC4A0' },
  { path: '/models/lamp_04.glb', color: '#C4887B' },
  { path: '/models/lamp_05.glb', color: '#A87BC4' },
]

MODELS.forEach((m) => useGLTF.preload(m.path))

function Model({ path, visible }: { path: string; visible: boolean }) {
  const { scene } = useGLTF(path)
  const groupRef = useRef<THREE.Group>(null)

  const cloned = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = false
      }
    })
    return clone
  }, [scene])

  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    const box = new THREE.Box3().setFromObject(g)
    const size = new THREE.Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z)
    if (maxDim > 0) g.scale.setScalar(2.6 / maxDim)
    const box2 = new THREE.Box3().setFromObject(g)
    g.position.y = -box2.min.y
  }, [cloned])

  return (
    <group ref={groupRef} visible={visible}>
      <primitive object={cloned} />
    </group>
  )
}

function Scene({ active }: { active: number }) {
  return (
    <>
      <color attach="background" args={['#f4f3ef']} />

      <ambientLight intensity={0.55} />

      {/* Key light — hard shadow from upper-front-right */}
      <directionalLight
        position={[4, 10, 4]}
        intensity={2.0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.0005}
      />

      {/* Subtle fill from left */}
      <directionalLight position={[-3, 4, -2]} intensity={0.35} />

      {/* Ground — receives hard shadow only, plane invisible */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
        <planeGeometry args={[80, 80]} />
        <shadowMaterial transparent opacity={0.22} />
      </mesh>

      {MODELS.map((m, i) => (
        <Suspense key={m.path} fallback={null}>
          <Model path={m.path} visible={i === active} />
        </Suspense>
      ))}

      <OrbitControls
        enablePan={false}
        enableZoom={false}
        target={[0, 1.3, 0]}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI / 2.15}
        makeDefault
      />
    </>
  )
}

export default function ModelViewer() {
  const [active, setActive] = useState(0)

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ position: [3.8, 2.8, 3.8], fov: 40 }}
        gl={{ antialias: true, alpha: false }}
        style={{ display: 'block' }}
      >
        <Scene active={active} />
      </Canvas>

      {/* Model selector dots */}
      <nav
        style={{
          position: 'absolute',
          bottom: '2.25rem',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        {MODELS.map((m, i) => {
          const isActive = i === active
          return (
            <button
              key={i}
              onClick={() => setActive(i)}
              aria-label={`Lamp ${i + 1}`}
              style={{
                width: isActive ? 13 : 9,
                height: isActive ? 13 : 9,
                borderRadius: '50%',
                background: m.color,
                opacity: isActive ? 1 : 0.45,
                transition: 'all 0.22s ease',
                boxShadow: isActive ? `0 0 0 2px #f4f3ef, 0 0 0 3.5px ${m.color}` : 'none',
              }}
            />
          )
        })}
      </nav>

      {/* Lamp index label */}
      <span
        style={{
          position: 'absolute',
          top: '2rem',
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.68rem',
          letterSpacing: '0.18em',
          color: '#aaa9a5',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {String(active + 1).padStart(2, '0')} / {String(MODELS.length).padStart(2, '0')}
      </span>
    </div>
  )
}
