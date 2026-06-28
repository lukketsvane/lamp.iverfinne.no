"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  ScrollControls,
  useScroll,
  useGLTF,
  Environment,
  ContactShadows,
  Html,
} from "@react-three/drei";
import * as THREE from "three";

type Model = { name: string; url: string };

const MODELS: Model[] = [
  { name: "Desk Lamp", url: "/models/desk_lamp_scene.glb" },
  { name: "Clamp Lamp", url: "/models/clamp_lamp_01.glb" },
  { name: "Lamp 02", url: "/models/lamp_02.glb" },
  { name: "Lamp 03", url: "/models/lamp_03.glb" },
  { name: "micro:bit", url: "/models/microbit_2.glb" },
];

MODELS.forEach((m) => useGLTF.preload(m.url));

/** Loads a GLB and normalizes it: centered at origin, scaled to a fixed size. */
function NormalizedModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    clone.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const wrap = new THREE.Group();
    wrap.add(clone);
    wrap.scale.setScalar(2.4 / maxDim);
    return wrap;
  }, [scene]);
  return <primitive object={object} />;
}

function Loader() {
  return (
    <Html center>
      <div style={{ color: "#aaa", fontSize: 14 }}>Lastar…</div>
    </Html>
  );
}

/**
 * Scroll-driven vertical sequence: the active model is pinned at center and
 * spins as you scroll its section; crossing a section boundary swaps the model.
 */
function Scene({ onIndex }: { onIndex: (i: number) => void }) {
  const scroll = useScroll();
  const groups = useRef<(THREE.Group | null)[]>([]);
  const last = useRef(-1);

  useFrame(() => {
    const seg = scroll.offset * MODELS.length;
    const index = Math.min(MODELS.length - 1, Math.floor(seg));
    const local = seg - index; // 0..1 within the current section

    if (index !== last.current) {
      last.current = index;
      onIndex(index);
    }

    MODELS.forEach((_, i) => {
      const g = groups.current[i];
      if (!g) return;
      const active = i === index;
      g.visible = active;
      if (active) {
        g.rotation.y = local * Math.PI * 2; // one full turn per section
        g.position.y = Math.sin(local * Math.PI) * 0.12; // subtle vertical float
      }
    });
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 8, 6]} intensity={1.1} castShadow />
      <Environment preset="city" />

      {MODELS.map((m, i) => (
        <group
          key={m.url}
          ref={(el) => {
            groups.current[i] = el;
          }}
        >
          <NormalizedModel url={m.url} />
        </group>
      ))}

      <ContactShadows
        position={[0, -1.35, 0]}
        opacity={0.35}
        scale={10}
        blur={2.6}
        far={4}
      />
    </>
  );
}

export default function Viewer() {
  const [index, setIndex] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <main style={{ height: "100dvh", width: "100vw", position: "relative" }}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 6], fov: 40 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <color attach="background" args={["#f0efe9"]} />
        <Suspense fallback={<Loader />}>
          <ScrollControls pages={MODELS.length} damping={0.25}>
            <Scene onIndex={setIndex} />
          </ScrollControls>
        </Suspense>
      </Canvas>

      {/* Fixed overlay (does not capture scroll) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          padding: "1.75rem",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 600, letterSpacing: "-0.02em", fontSize: 18 }}>
          lamp
        </span>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 26, fontWeight: 600, color: "#1a1a1a" }}>
            {pad(index + 1)}{" "}
            <span style={{ color: "#b9b6ac", fontWeight: 500 }}>
              / {pad(MODELS.length)}
            </span>
          </span>
          <span style={{ fontSize: 13, color: "#9b988e" }}>
            {MODELS[index].name}
          </span>
        </div>
      </div>

      {/* Hint */}
      <div
        ref={progressRef}
        style={{
          position: "absolute",
          right: 18,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 11,
          letterSpacing: "0.08em",
          color: "#bdbab0",
          writingMode: "vertical-rl",
          pointerEvents: "none",
        }}
      >
        SCROLL
      </div>
    </main>
  );
}
