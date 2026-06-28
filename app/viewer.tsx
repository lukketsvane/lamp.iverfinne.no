"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

type Model = {
  name: string;
  url: string;
  scale?: number;
  camera?: [number, number, number];
  /** Explicit lens material-name substrings (overrides auto-detection). */
  lens?: string[];
  /** Set when the model has no light fixture (bulb toggle does nothing). */
  noBulb?: boolean;
};

const DEFAULT_CAM: [number, number, number] = [0, 0, 6];

const MODELS: Model[] = [
  { name: "Clamp Lamp", url: "/models/clamp_lamp_01.glb" },
  // The oval frosted face is the lens (confirmed via part segmentation).
  { name: "Lamp 02", url: "/models/lamp_02.glb", lens: ["tripo_part_4_material"] },
  { name: "Lamp 03", url: "/models/lamp_03.glb", scale: 0.8 },
  // Real micro:bit is only ~45x55 mm; it's not a lamp, so no bulb.
  { name: "micro:bit", url: "/models/microbit_2.glb", scale: 0.32, noBulb: true },
  // Desk scene last; reads best from an elevated 3/4 top-down angle.
  {
    name: "Desk Lamp",
    url: "/models/desk_lamp_scene.glb",
    scale: 0.9,
    camera: [1.5, 3.2, 6],
    noBulb: true, // a whole desk scene — no single light fixture
  },
];

MODELS.forEach((m) => useGLTF.preload(m.url));

const WARM = new THREE.Color("#ffcf8a");
const EXPLODE_SPREAD = 1.6;

/**
 * Find the lens/diffuser meshes geometrically: a thin, front-facing panel
 * (smallest dimension along X or Z), with a large face, sitting in the upper
 * part of the model (so it isn't the base or a horizontal shelf).
 */
function detectLensMeshes(
  clone: THREE.Object3D,
  box: THREE.Box3,
  size: THREE.Vector3
): Set<THREE.Mesh> {
  const M = Math.max(size.x, size.y, size.z) || 1;
  const found = new Set<THREE.Mesh>();
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const b = new THREE.Box3().setFromObject(mesh);
    const s = new THREE.Vector3();
    const c = new THREE.Vector3();
    b.getSize(s);
    b.getCenter(c);
    const dims = [s.x, s.y, s.z];
    const minDim = Math.min(...dims);
    const minAxis = dims.indexOf(minDim);
    const sorted = [...dims].sort((a, b) => a - b);
    const faceRel = (sorted[1] * sorted[2]) / (M * M);
    const thin = minDim / M < 0.09;
    const frontFacing = minAxis !== 1; // thin along X or Z, not Y
    const elevated = c.y > box.min.y + 0.22 * size.y;
    if (thin && frontFacing && elevated && faceRel >= 0.15 && faceRel <= 0.6)
      found.add(mesh);
  });
  return found;
}

/**
 * The active model: normalized (centered + scaled), with animated
 * exploded-view and bulb (emissive lens + interior light) states.
 */
function ActiveModel({
  url,
  scale = 1,
  exploded,
  bulbOn,
  lensNames,
}: {
  url: string;
  scale?: number;
  exploded: boolean;
  bulbOn: boolean;
  lensNames?: string[];
}) {
  const { scene } = useGLTF(url);
  const lightRef = useRef<THREE.PointLight>(null);
  const factor = useRef(0);
  const glow = useRef(0);

  const { root, parts, lensMats } = useMemo(() => {
    const clone = scene.clone(true);
    clone.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Decide which meshes are the lens.
    const lensMeshes = lensNames?.length
      ? new Set<THREE.Mesh>()
      : detectLensMeshes(clone, box, size);
    const matchName = (n: string) =>
      !!lensNames?.some((s) => n.toLowerCase().includes(s.toLowerCase()));

    // Clone materials so emissive tweaks don't leak into the cached GLTF,
    // and mark the lens materials emissive.
    const lensMats: THREE.MeshStandardMaterial[] = [];
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const arr = Array.isArray(mesh.material);
      const mats = (arr ? mesh.material : [mesh.material]) as THREE.Material[];
      const cloned = mats.filter(Boolean).map((m) => {
        const c = m.clone() as THREE.MeshStandardMaterial;
        const isLens =
          lensMeshes.has(mesh) || matchName(c.name) || matchName(mesh.name);
        if (c.isMeshStandardMaterial && isLens) {
          c.emissive = WARM.clone();
          c.emissiveIntensity = 0;
          lensMats.push(c);
        }
        return c;
      });
      mesh.material = arr ? cloned : cloned[0];
    });

    // Center the model at the origin.
    clone.position.sub(center);

    // Record explode directions for each top-level part.
    const modelCenter = new THREE.Vector3(0, 0, 0);
    const parts = clone.children.map((child) => {
      const b = new THREE.Box3().setFromObject(child);
      const pc = new THREE.Vector3();
      b.getCenter(pc);
      const dir = pc.clone().sub(modelCenter);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      return { obj: child, orig: child.position.clone(), dir };
    });

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const wrap = new THREE.Group();
    wrap.add(clone);
    wrap.scale.setScalar((2.4 * scale) / maxDim);
    return { root: wrap, parts, lensMats };
  }, [scene, scale, lensNames]);

  useFrame((_, dt) => {
    const k = Math.min(1, dt * 5);
    factor.current += ((exploded ? 1 : 0) - factor.current) * k;
    glow.current += ((bulbOn ? 1 : 0) - glow.current) * k;

    for (const p of parts) {
      p.obj.position
        .copy(p.orig)
        .addScaledVector(p.dir, factor.current * EXPLODE_SPREAD);
    }
    for (const m of lensMats) m.emissiveIntensity = glow.current * 2.4;
    if (lightRef.current) lightRef.current.intensity = glow.current * 7;
  });

  return (
    <group>
      <primitive object={root} />
      <pointLight
        ref={lightRef}
        position={[0, 0.4, 0]}
        color={WARM}
        distance={9}
        decay={2}
        intensity={0}
      />
    </group>
  );
}

/** Moves the camera to each model's preferred angle when the model changes. */
function CameraRig({ pos }: { pos: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null;
  useEffect(() => {
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [pos, camera, controls]);
  return null;
}

function Scene({
  index,
  exploded,
  bulbOn,
  dark,
}: {
  index: number;
  exploded: boolean;
  bulbOn: boolean;
  dark: boolean;
}) {
  const model = MODELS[index];
  return (
    <>
      <ambientLight intensity={dark ? 0.12 : 0.7} />
      <hemisphereLight
        intensity={dark ? 0.1 : 0.6}
        groundColor={dark ? "#000000" : "#d8d4c8"}
      />
      <directionalLight position={[5, 8, 6]} intensity={dark ? 0.2 : 1.6} />
      <directionalLight position={[-6, 4, -4]} intensity={dark ? 0.05 : 0.6} />

      <Suspense fallback={null}>
        <ActiveModel
          key={model.url}
          url={model.url}
          scale={model.scale}
          exploded={exploded}
          bulbOn={bulbOn && !model.noBulb}
          lensNames={model.lens}
        />
      </Suspense>

      <ContactShadows
        position={[0, -1.35, 0]}
        opacity={dark ? 0.12 : 0.35}
        scale={10}
        blur={2.6}
        far={4}
      />
      <OrbitControls
        makeDefault
        enableZoom={false}
        enablePan={false}
        enableDamping
        rotateSpeed={0.85}
        target={[0, 0, 0]}
      />
      <CameraRig pos={model.camera ?? DEFAULT_CAM} />
    </>
  );
}

/* ---------- Icons ---------- */
const Icon = {
  Bulb: ({ on }: { on: boolean }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.9 1 1 1.6l.1.5h4.8l.1-.5c.1-.6.5-1.2 1-1.6A6 6 0 0 0 12 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={on ? WARM.getStyle() : "none"}
      />
    </svg>
  ),
  Layers: ({ on }: { on: boolean }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17.5 12 22l9-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={on ? "currentColor" : "none"}
        opacity={on ? 0.85 : 1}
      />
    </svg>
  ),
  Theme: ({ dark }: { dark: boolean }) =>
    dark ? (
      // Sun (click to go light)
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ) : (
      // Moon (click to go dark)
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  Chevron: ({ dir }: { dir: "up" | "down" }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d={dir === "up" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

export default function Viewer() {
  const [index, setIndex] = useState(0);
  const [bulbOn, setBulbOn] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [dark, setDark] = useState(false);
  const wheelLock = useRef(false);

  const go = useCallback((dir: number) => {
    setIndex((i) => Math.min(MODELS.length - 1, Math.max(0, i + dir)));
  }, []);

  // Initialise from system preference; the toggle takes over after that.
  useEffect(() => {
    setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  // Keyboard: up/left = prev, down/right = next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Vertical scroll switches models (one step per gesture).
  const onWheel = (e: React.WheelEvent) => {
    if (wheelLock.current || Math.abs(e.deltaY) < 8) return;
    wheelLock.current = true;
    go(e.deltaY > 0 ? 1 : -1);
    window.setTimeout(() => (wheelLock.current = false), 650);
  };

  const fg = dark ? "#f4f4f5" : "#1a1a1a";
  const muted = dark ? "#6b6b70" : "#b9b6ac";
  const bg = dark ? "#0a0a0b" : "#f0efe9";
  const pad = (n: number) => String(n).padStart(2, "0");
  const bulbDisabled = !!MODELS[index].noBulb;

  return (
    <main
      onWheel={onWheel}
      style={{
        height: "100dvh",
        width: "100vw",
        position: "relative",
        background: bg,
        color: fg,
        transition: "background 0.5s ease, color 0.5s ease",
      }}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 6], fov: 40 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <color attach="background" args={[bg]} />
        <Scene index={index} exploded={exploded} bulbOn={bulbOn} dark={dark} />
      </Canvas>

      {/* Top-right: icons stacked above the counter */}
      <div style={corner}>
        <button
          aria-label="Lyst/mørkt tema"
          onClick={() => setDark((v) => !v)}
          style={{ ...iconBtn, color: fg }}
        >
          <Icon.Theme dark={dark} />
        </button>
        <button
          aria-label="Slå lampa av/på"
          onClick={() => !bulbDisabled && setBulbOn((v) => !v)}
          disabled={bulbDisabled}
          style={{
            ...iconBtn,
            color: fg,
            opacity: bulbDisabled ? 0.25 : 1,
            cursor: bulbDisabled ? "default" : "pointer",
            filter:
              bulbOn && !bulbDisabled
                ? "drop-shadow(0 0 10px rgba(255,200,120,0.9))"
                : "none",
          }}
        >
          <Icon.Bulb on={bulbOn && !bulbDisabled} />
        </button>
        <button
          aria-label="Exploded view"
          onClick={() => setExploded((v) => !v)}
          style={{ ...iconBtn, color: fg, opacity: exploded ? 1 : 0.7 }}
        >
          <Icon.Layers on={exploded} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
          {pad(index + 1)} <span style={{ color: muted }}>/ {pad(MODELS.length)}</span>
        </span>
      </div>

      {/* Large wordmark */}
      <span style={wordmark}>lamp</span>

      {/* Right-side pager */}
      <div style={pager}>
        <button
          aria-label="Førre"
          onClick={() => go(-1)}
          disabled={index === 0}
          style={{ ...pagerBtn, color: fg, opacity: index === 0 ? 0.25 : 0.8 }}
        >
          <Icon.Chevron dir="up" />
        </button>
        {MODELS.map((m, i) => (
          <button
            key={m.url}
            aria-label={m.name}
            onClick={() => setIndex(i)}
            style={{
              ...dot,
              background: i === index ? fg : "transparent",
              borderColor: i === index ? fg : muted,
            }}
          />
        ))}
        <button
          aria-label="Neste"
          onClick={() => go(1)}
          disabled={index === MODELS.length - 1}
          style={{
            ...pagerBtn,
            color: fg,
            opacity: index === MODELS.length - 1 ? 0.25 : 0.8,
          }}
        >
          <Icon.Chevron dir="down" />
        </button>
      </div>
    </main>
  );
}

/* ---------- styles ---------- */
const corner: React.CSSProperties = {
  position: "absolute",
  top: "1.5rem",
  right: "1.5rem",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 14,
};
const wordmark: React.CSSProperties = {
  position: "absolute",
  top: "3.5rem",
  left: "1.5rem",
  fontSize: "clamp(40px, 13vw, 72px)",
  fontWeight: 700,
  letterSpacing: "-0.03em",
  lineHeight: 1,
};
const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 4,
  display: "flex",
  transition: "filter 0.4s ease, opacity 0.3s ease",
};
const pager: React.CSSProperties = {
  position: "absolute",
  right: 16,
  top: "50%",
  transform: "translateY(-50%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
};
const pagerBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
  display: "flex",
};
const dot: React.CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: "50%",
  border: "1.5px solid",
  cursor: "pointer",
  padding: 0,
  transition: "background 0.25s ease, border-color 0.25s ease",
};
