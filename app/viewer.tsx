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
import {
  OrbitControls,
  useGLTF,
  ContactShadows,
  Environment,
  Lightformer,
} from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

type Model = {
  name: string;
  /** Display name (serif heading). */
  title: string;
  /** Two-line tagline shown under the title. */
  tagline: [string, string];
  url: string;
  scale?: number;
  camera?: [number, number, number];
  /** Explicit lens material-name substrings (overrides auto-detection). */
  lens?: string[];
  /** Set when the model has no light fixture (bulb toggle does nothing). */
  noBulb?: boolean;
};

const DEFAULT_CAM: [number, number, number] = [0, 0, 6];

/** Polar angle of a camera position, used to lock orbit to horizontal only. */
function polarOf([x, y, z]: [number, number, number]) {
  const r = Math.hypot(x, y, z) || 1;
  return Math.acos(Math.max(-1, Math.min(1, y / r)));
}

const MODELS: Model[] = [
  // Mysa (was lamp_04): part_0 = wooden shade disc, part_1 = column; part_2 is
  // the diffuser sitting under the shade — the light source.
  {
    name: "Mysa",
    title: "Mysa",
    tagline: ["Warm cast.", "Wood, lit from within."],
    url: "/models/mysa.glb",
    lens: ["tripo_part_2_material"],
  },
  // Aure (was lamp_03): lens found geometrically.
  {
    name: "Aure",
    title: "Aure",
    tagline: ["Ambient mode.", "Soft light for evening rooms."],
    url: "/models/aure.glb",
    scale: 0.8,
  },
  // Lume (was lamp_02): the oval frosted face is the lens (part_4).
  {
    name: "Lume",
    title: "Lume",
    tagline: ["Soft light.", "An even, frosted glow."],
    url: "/models/lume.glb",
    lens: ["tripo_part_4_material"],
  },
  // part_5 is the thin front panel that sits mid-body — the lit diffuser.
  {
    name: "Lamp 01",
    title: "Glo",
    tagline: ["Quiet warmth.", "A glow that settles in."],
    url: "/models/lamp_01.glb",
    lens: ["tripo_part_5_material"],
  },
  {
    name: "Clamp Lamp",
    title: "Pivot",
    tagline: ["Task light.", "Aimed where you need it."],
    url: "/models/clamp_lamp_01.glb",
  },
  // Hidden for now:
  // micro:bit — not a lamp.
  // Desk Lamp — a whole desk scene, no single fixture.
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
  dark,
}: {
  url: string;
  scale?: number;
  exploded: boolean;
  bulbOn: boolean;
  lensNames?: string[];
  dark: boolean;
}) {
  const { scene } = useGLTF(url);
  const lightRef = useRef<THREE.PointLight>(null);
  const spillRef = useRef<THREE.PointLight>(null);
  const factor = useRef(0);
  const glow = useRef(0);

  const { root, parts, lensMats, groundY } = useMemo(() => {
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
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const arr = Array.isArray(mesh.material);
      const mats = (arr ? mesh.material : [mesh.material]) as THREE.Material[];
      const cloned = mats.filter(Boolean).map((m) => {
        const c = m.clone() as THREE.MeshStandardMaterial;
        const isLens =
          lensMeshes.has(mesh) || matchName(c.name) || matchName(mesh.name);
        if (c.isMeshStandardMaterial) {
          // Subtle environment pickup makes the wood/metal read as real.
          c.envMapIntensity = 0.8;
          if (isLens) {
            c.emissive = WARM.clone();
            c.emissiveIntensity = 0;
            c.toneMapped = false; // let the lit panel bloom past white
            lensMats.push(c);
          }
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
    const s = (2.4 * scale) / maxDim;
    const wrap = new THREE.Group();
    wrap.add(clone);
    wrap.scale.setScalar(s);
    // Bottom of the (centered) model after scaling — the ground line.
    const groundY = -(size.y * s) / 2;
    return { root: wrap, parts, lensMats, groundY };
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
    for (const m of lensMats) m.emissiveIntensity = glow.current * 3.2;
    if (lightRef.current) lightRef.current.intensity = glow.current * 9;
    if (spillRef.current) spillRef.current.intensity = glow.current * 4;
  });

  return (
    <group>
      <primitive object={root} />
      {/* Core glow from inside the fixture. */}
      <pointLight
        ref={lightRef}
        position={[0, 0.3, 0.4]}
        color={WARM}
        distance={9}
        decay={2}
        intensity={0}
      />
      {/* Wider warm spill that washes the surrounding scene when lit. */}
      <pointLight
        ref={spillRef}
        position={[0, 0.6, 2]}
        color={WARM}
        distance={16}
        decay={2}
        intensity={0}
      />
      <ContactShadows
        position={[0, groundY, 0]}
        opacity={dark ? 0.55 : 0.32}
        color={dark ? "#000000" : "#3a3328"}
        scale={11}
        blur={3}
        far={4.5}
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
  const cam = model.camera ?? DEFAULT_CAM;
  const polar = polarOf(cam);
  return (
    <>
      <ambientLight intensity={dark ? 0.14 : 0.42} />
      {/* In-scene image-based lighting (no HDR download) for soft, real
          reflections on the wood and metal. */}
      <Environment resolution={256} frames={1}>
        <Lightformer
          intensity={dark ? 0.7 : 1.7}
          position={[0, 2.5, 3]}
          scale={[9, 9, 1]}
          color={dark ? "#352a1f" : "#fff6ea"}
        />
        <Lightformer
          intensity={dark ? 0.3 : 0.8}
          position={[-4, 1, -2]}
          scale={[6, 6, 1]}
          color={dark ? "#1b2230" : "#d4dae4"}
        />
        <Lightformer
          intensity={dark ? 0.25 : 0.6}
          position={[4, 0, -3]}
          scale={[6, 6, 1]}
          color={dark ? "#2a2018" : "#ffe7c2"}
        />
      </Environment>
      <directionalLight
        position={[4, 7, 5]}
        intensity={dark ? 0.35 : 1.7}
        color={dark ? "#ffd9a8" : "#ffffff"}
      />
      <directionalLight position={[-6, 3, -4]} intensity={dark ? 0.12 : 0.5} />

      <Suspense fallback={null}>
        <ActiveModel
          key={model.url}
          url={model.url}
          scale={model.scale}
          exploded={exploded}
          bulbOn={bulbOn && !model.noBulb}
          lensNames={model.lens}
          dark={dark}
        />
      </Suspense>

      <OrbitControls
        makeDefault
        enableZoom={false}
        enablePan={false}
        enableDamping
        rotateSpeed={0.85}
        target={[0, 0, 0]}
        minPolarAngle={polar}
        maxPolarAngle={polar}
      />
      <CameraRig pos={cam} />

      {/* Glow atmosphere: the emissive lens (toneMapped:false) blooms when lit. */}
      <EffectComposer>
        <Bloom
          mipmapBlur
          intensity={dark ? 1.6 : 0.9}
          luminanceThreshold={1.0}
          luminanceSmoothing={0.2}
          radius={0.7}
        />
      </EffectComposer>
    </>
  );
}

/* ---------- Icons (outline hybrid, ~1.7pt stroke) ---------- */
const STROKE = 1.7;
const Icon = {
  Bulb: ({ on }: { on: boolean }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.9 1 1 1.6l.1.5h4.8l.1-.5c.1-.6.5-1.2 1-1.6A6 6 0 0 0 12 3Z"
        stroke="currentColor"
        strokeWidth={STROKE}
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
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={on ? "currentColor" : "none"}
        opacity={on ? 0.85 : 1}
      />
    </svg>
  ),
  // Contrast / half-filled disc — the theme toggle in the reference.
  Theme: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={STROKE} />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
    </svg>
  ),
};

export default function Viewer() {
  const [index, setIndex] = useState(0);
  const [bulbOn, setBulbOn] = useState(false);
  // Exploded view is temporarily disabled (button greyed out).
  const exploded = false;
  const [dark, setDark] = useState(false);
  const wheelLock = useRef(false);

  const go = useCallback((dir: number) => {
    setIndex((i) => Math.min(MODELS.length - 1, Math.max(0, i + dir)));
  }, []);

  // Follow the system/device theme dynamically; the manual toggle overrides
  // until the device preference changes again.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
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

  // Vertical swipe navigates on touch (horizontal drag is left for orbit).
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx) * 1.3) {
      if (wheelLock.current) return;
      wheelLock.current = true;
      go(dy < 0 ? 1 : -1);
      window.setTimeout(() => (wheelLock.current = false), 500);
    }
  };

  const model = MODELS[index];
  const fg = dark ? "#f4f4f5" : "#1a1a1a";
  const sub = dark ? "#a7a39b" : "#5c5950";
  const muted = dark ? "#54525a" : "#c3c0b6";
  const bg = dark
    ? "radial-gradient(120% 90% at 62% 38%, #1c1814 0%, #0c0b0d 55%, #070608 100%)"
    : "radial-gradient(120% 90% at 50% 34%, #faf9f5 0%, #efece4 60%, #e6e3d9 100%)";
  const bulbDisabled = !!model.noBulb;

  return (
    <main
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        height: "100dvh",
        width: "100vw",
        position: "relative",
        background: bg,
        color: fg,
        transition: "background 0.6s ease, color 0.5s ease",
      }}
    >
      <Canvas
        dpr={[1, 2]}
        shadows
        camera={{ position: [0, 0, 6], fov: 40 }}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Scene index={index} exploded={exploded} bulbOn={bulbOn} dark={dark} />
      </Canvas>

      {/* Top-left: serif model name + tagline */}
      <div style={heading}>
        <h1 style={{ ...title, color: fg }}>{model.title}</h1>
        <p style={{ ...tagline, color: sub }}>
          {model.tagline[0]}
          <br />
          {model.tagline[1]}
        </p>
      </div>

      {/* Top-right: stacked controls */}
      <div style={corner}>
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
          aria-label="Exploded view (utilgjengeleg)"
          disabled
          title="Kjem snart"
          style={{
            ...iconBtn,
            color: muted,
            opacity: 0.4,
            cursor: "default",
          }}
        >
          <Icon.Layers on={false} />
        </button>
        <button
          aria-label="Lyst/mørkt tema"
          onClick={() => setDark((v) => !v)}
          style={{ ...iconBtn, color: fg }}
        >
          <Icon.Theme />
        </button>
      </div>

      {/* Left rail: model dots */}
      <div style={rail}>
        {MODELS.map((m, i) => (
          <button
            key={m.url}
            aria-label={m.title}
            aria-current={i === index}
            onClick={() => setIndex(i)}
            style={{
              ...dot,
              width: i === index ? 9 : 7,
              height: i === index ? 9 : 7,
              background: i === index ? fg : muted,
              opacity: i === index ? 1 : 0.7,
            }}
          />
        ))}
      </div>
    </main>
  );
}

/* ---------- styles ---------- */
const heading: React.CSSProperties = {
  position: "absolute",
  top: "3rem",
  left: "1.5rem",
  maxWidth: "70vw",
  pointerEvents: "none",
};
const title: React.CSSProperties = {
  fontFamily: "var(--font-serif), Georgia, 'Times New Roman', serif",
  fontWeight: 500,
  fontSize: "clamp(46px, 16vw, 84px)",
  lineHeight: 0.95,
  letterSpacing: "-0.01em",
};
const tagline: React.CSSProperties = {
  marginTop: "0.85rem",
  fontSize: "clamp(15px, 4.6vw, 19px)",
  fontWeight: 400,
  lineHeight: 1.35,
  letterSpacing: "0.01em",
};
const corner: React.CSSProperties = {
  position: "absolute",
  top: "1.5rem",
  right: "1.5rem",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 20,
};
const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 4,
  display: "flex",
  transition: "filter 0.4s ease, opacity 0.3s ease",
};
const rail: React.CSSProperties = {
  position: "absolute",
  left: "1.5rem",
  top: "50%",
  transform: "translateY(-50%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 14,
};
const dot: React.CSSProperties = {
  borderRadius: "50%",
  border: "none",
  cursor: "pointer",
  padding: 0,
  transition: "background 0.25s ease, opacity 0.25s ease, width 0.2s ease, height 0.2s ease",
};
