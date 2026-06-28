"use client";

import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Stage,
  useGLTF,
  Html,
} from "@react-three/drei";

type Model = {
  name: string;
  url: string;
};

const MODELS: Model[] = [
  { name: "Desk Lamp", url: "/models/desk_lamp_scene.glb" },
  { name: "Clamp Lamp", url: "/models/clamp_lamp_01.glb" },
  { name: "Lamp 02", url: "/models/lamp_02.glb" },
  { name: "micro:bit", url: "/models/microbit_2.glb" },
];

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

// Preload all models so switching is instant.
MODELS.forEach((m) => useGLTF.preload(m.url));

function Loader() {
  return (
    <Html center>
      <div style={{ color: "#999", fontSize: 14 }}>Lastar…</div>
    </Html>
  );
}

export default function Viewer() {
  const [index, setIndex] = useState(0);
  const model = MODELS[index];

  const go = (dir: number) =>
    setIndex((i) => (i + dir + MODELS.length) % MODELS.length);

  return (
    <main style={{ height: "100dvh", width: "100vw", position: "relative" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 0, 6], fov: 45 }}
        gl={{ preserveDrawingBuffer: true }}
      >
        <color attach="background" args={["#ffffff"]} />
        <Suspense fallback={<Loader />}>
          <Stage
            key={model.url}
            intensity={0.5}
            environment="city"
            adjustCamera={1.1}
            shadows={{ type: "contact", opacity: 0.35, blur: 2.5 }}
          >
            <Model url={model.url} />
          </Stage>
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          enableRotate
        />
      </Canvas>

      {/* UI overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "1.5rem",
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600, letterSpacing: "-0.02em" }}>lamp</span>
          <span style={{ color: "#999", fontSize: 14 }}>
            {index + 1} / {MODELS.length}
          </span>
        </header>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.25rem",
          }}
        >
          <button
            aria-label="Førre modell"
            onClick={() => go(-1)}
            style={btnStyle}
          >
            ‹
          </button>
          <span
            style={{
              minWidth: 140,
              textAlign: "center",
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            {model.name}
          </span>
          <button
            aria-label="Neste modell"
            onClick={() => go(1)}
            style={btnStyle}
          >
            ›
          </button>
        </footer>
      </div>
    </main>
  );
}

const btnStyle: React.CSSProperties = {
  pointerEvents: "auto",
  width: 44,
  height: 44,
  borderRadius: "50%",
  border: "1px solid #e5e5e5",
  background: "#fff",
  color: "#1a1a1a",
  fontSize: 22,
  lineHeight: 1,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
};
