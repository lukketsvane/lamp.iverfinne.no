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
import { OrbitControls, useGLTF } from "@react-three/drei";
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
  /** Extra vertical nudge (world units) for per-model framing. */
  offsetY?: number;
  /** Extra horizontal nudge (world units) for per-model framing. */
  offsetX?: number;
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
    name: "Ljomveg",
    title: "Ljomveg",
    tagline: ["Varmt skin.", "Tre, opplyst innanfrå."],
    url: "/models/mysa.glb",
    scale: 0.82,
    offsetY: 0.42,
    lens: ["tripo_part_2_material"],
  },
  // Aure (was lamp_03): three frosted diffusers — the left & right side
  // panels (part_4, part_5) and the top discs (part_2, part_9). All glow.
  {
    name: "Lemljos",
    title: "Lemljos",
    tagline: ["Dempa modus.", "Mjukt ljos for kveldsrom."],
    url: "/models/aure.glb",
    scale: 0.82,
    lens: [
      "tripo_part_2_material",
      "tripo_part_4_material",
      "tripo_part_5_material",
      "tripo_part_9_material",
    ],
  },
  // Kultist (was lamp_02): the oval frosted face is the lens (part_4).
  {
    name: "Kultist",
    title: "Kultist",
    tagline: ["Mjukt ljos.", "Eit jamt, matt skin."],
    url: "/models/kultist.glb",
    scale: 0.86,
    lens: ["tripo_part_4_material"],
  },
  {
    name: "Clamp Lamp",
    title: "Pivot",
    tagline: ["Arbeidslys.", "Retta dit du treng det."],
    url: "/models/clamp_lamp_01.glb",
    scale: 0.86,
  },
  // Flower-shaped clamp lamp; part_7 is the round diffuser disc.
  {
    name: "Clamp Lamp 02",
    title: "Blome",
    tagline: ["Klypelys.", "Ein blome som lyser."],
    url: "/models/clamp_lamp_02.glb",
    scale: 0.86,
    lens: ["tripo_part_7_material"],
  },
  // Stand lamp: no frosted diffuser of its own — part_3 (the shade body) is
  // made emissive and lit from an interior light.
  {
    name: "Stand Lamp",
    title: "Søyle",
    tagline: ["Ståande ljos.", "Roleg i eit hjørne."],
    url: "/models/stand_lamp_01.glb",
    scale: 0.86,
    lens: ["tripo_part_3_material"],
  },
  // Lantern: part_5 is the diffuser at the top of the inner column.
  {
    name: "Lamp 5",
    title: "Lykt",
    tagline: ["Bera ljoset.", "Ei lykt for natta."],
    url: "/models/lamp_5.glb",
    scale: 0.86,
    lens: ["tripo_part_5_material"],
  },
  // Glo (was lamp_01): part_5 is the thin front panel mid-body — the diffuser.
  // Placed just before micro:bit per request.
  {
    name: "Lamp 01",
    title: "Glo",
    tagline: ["Roleg varme.", "Eit skin som legg seg."],
    url: "/models/lamp_01.glb",
    scale: 0.9,
    lens: ["tripo_part_5_material"],
  },
  // Real micro:bit is tiny; it's not a lamp, so no bulb.
  {
    name: "micro:bit",
    title: "micro:bit",
    tagline: ["Lita maskin.", "Ikkje ei lampe i det heile."],
    url: "/models/microbit_2.glb",
    scale: 0.3,
    noBulb: true,
  },
  // Desk scene; reads best from an elevated 3/4 angle.
  {
    name: "Desk Lamp",
    title: "Atelier",
    tagline: ["Arbeidsmodus.", "Eit heilt skrivebord."],
    url: "/models/desk_lamp_scene.glb",
    scale: 0.82,
    camera: [1.5, 3.2, 6],
    noBulb: true,
  },
];

MODELS.forEach((m) => useGLTF.preload(m.url));

const WARM = new THREE.Color("#ffcf8a");
const EXPLODE_SPREAD = 1.6;

// Scroll transition: the outgoing model slides vertically off-screen while it
// spins; the incoming one slides in from the opposite edge.
const SLIDE = 5.5; // world units a model travels off-screen
const SPIN = 0.7; // radians of Y-rotation across a transition
const TRANS_SPEED = 3.2; // easing speed (~0.3s)
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

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
  offsetY = 0,
  offsetX = 0,
  exploded,
  bulbOn,
  lensNames,
  dark,
  transitionDir = 1,
  mode = "enter",
  onExitDone,
}: {
  url: string;
  scale?: number;
  offsetY?: number;
  offsetX?: number;
  exploded: boolean;
  bulbOn: boolean;
  lensNames?: string[];
  dark: boolean;
  /** Scroll direction that triggered this transition (+1 next, -1 prev). */
  transitionDir?: number;
  /** "enter" = slide in to rest; "exit" = slide out of view. */
  mode?: "enter" | "exit";
  onExitDone?: () => void;
}) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const spillRef = useRef<THREE.PointLight>(null);
  const factor = useRef(0);
  const glow = useRef(bulbOn ? 1 : 0);
  const prog = useRef(0); // transition progress 0..1
  const exitDone = useRef(false);

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
        if (c.isMeshStandardMaterial && isLens) {
          c.emissive = WARM.clone();
          c.emissiveIntensity = 0;
          c.toneMapped = false; // let the lit panel bloom past white
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

    // Scroll transition: slide vertically + spin.
    const g = groupRef.current;
    if (g) {
      const frameY = -0.5 + offsetY;
      prog.current = Math.min(1, prog.current + dt * TRANS_SPEED);
      const e = easeOutCubic(prog.current);
      if (mode === "enter") {
        g.position.y = frameY + (1 - e) * (-transitionDir * SLIDE);
        g.rotation.y = (1 - e) * (transitionDir * SPIN);
      } else {
        g.position.y = frameY + e * (transitionDir * SLIDE);
        g.rotation.y = e * (-transitionDir * SPIN);
        if (prog.current >= 1 && !exitDone.current) {
          exitDone.current = true;
          onExitDone?.();
        }
      }
    }
  });

  // Drop the whole assembly (model + ground) a little below centre so it clears
  // the heading text and reads as standing on a surface. The initial Y is the
  // off-screen start for the enter animation.
  const frameY = -0.5 + offsetY;
  const startY = mode === "enter" ? frameY - transitionDir * SLIDE : frameY;

  return (
    <group ref={groupRef} position={[offsetX, startY, 0]}>
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
      {/* Ground plane that catches the hard cast shadow (transparent so the
          page backdrop shows through). */}
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, groundY, 0]}
      >
        <planeGeometry args={[40, 40]} />
        <shadowMaterial transparent opacity={dark ? 0.5 : 0.28} />
      </mesh>
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

/** Key light whose direction is steerable (three-finger drag). */
function KeyLight({
  az,
  el,
  dark,
}: {
  az: number;
  el: number;
  dark: boolean;
}) {
  const R = 10;
  const x = R * Math.cos(el) * Math.sin(az);
  const y = R * Math.sin(el);
  const z = R * Math.cos(el) * Math.cos(az);
  return (
    <directionalLight
      castShadow
      position={[x, y, z]}
      intensity={dark ? 0.5 : 2.1}
      color={dark ? "#ffe0b8" : "#ffffff"}
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-radius={2}
      shadow-bias={-0.0004}
      shadow-camera-near={0.5}
      shadow-camera-far={30}
      shadow-camera-left={-5}
      shadow-camera-right={5}
      shadow-camera-top={5}
      shadow-camera-bottom={-5}
    />
  );
}

function Scene({
  index,
  dir,
  exiting,
  onExitDone,
  exploded,
  bulbOn,
  dark,
  lightAz,
  lightEl,
  orbitEnabled,
}: {
  index: number;
  dir: number;
  exiting: { index: number; dir: number; id: number } | null;
  onExitDone: () => void;
  exploded: boolean;
  bulbOn: boolean;
  dark: boolean;
  lightAz: number;
  lightEl: number;
  orbitEnabled: boolean;
}) {
  const model = MODELS[index];
  const cam = model.camera ?? DEFAULT_CAM;
  const polar = polarOf(cam);
  const ex = exiting ? MODELS[exiting.index] : null;
  return (
    <>
      {/* Studio three-point lighting (no environment map). The key light casts
          a hard, defined shadow onto the ground plane. */}
      <ambientLight intensity={dark ? 0.12 : 0.34} />
      <KeyLight az={lightAz} el={lightEl} dark={dark} />
      {/* Fill from the opposite side keeps shadows from going pure black. */}
      <directionalLight
        position={[-5, 3, 2]}
        intensity={dark ? 0.14 : 0.55}
        color={dark ? "#9fb2cc" : "#dfe6f0"}
      />
      {/* Rim/back light separates the model from the backdrop. */}
      <directionalLight
        position={[-1, 4, -6]}
        intensity={dark ? 0.3 : 0.7}
        color={dark ? "#ffcaa0" : "#ffffff"}
      />

      <Suspense fallback={null}>
        <ActiveModel
          key={model.url}
          url={model.url}
          scale={model.scale}
          offsetY={model.offsetY}
          offsetX={model.offsetX}
          exploded={exploded}
          bulbOn={bulbOn && !model.noBulb}
          lensNames={model.lens}
          dark={dark}
          transitionDir={dir}
          mode="enter"
        />
        {ex && (
          <ActiveModel
            key={`exit-${exiting!.id}`}
            url={ex.url}
            scale={ex.scale}
            offsetY={ex.offsetY}
            offsetX={ex.offsetX}
            exploded={false}
            bulbOn={bulbOn && !ex.noBulb}
            lensNames={ex.lens}
            dark={dark}
            transitionDir={exiting!.dir}
            mode="exit"
            onExitDone={onExitDone}
          />
        )}
      </Suspense>

      <OrbitControls
        makeDefault
        enableZoom={false}
        enablePan={false}
        enableRotate={orbitEnabled}
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

  // Scroll transition state.
  const [dir, setDir] = useState(1);
  const [exiting, setExiting] = useState<
    { index: number; dir: number; id: number } | null
  >(null);
  const idxRef = useRef(0);
  const exitId = useRef(0);
  const onExitDone = useCallback(() => setExiting(null), []);

  // Steerable key light (three-finger drag) + whether orbit is allowed.
  const [lightAz, setLightAz] = useState(0.84);
  const [lightEl, setLightEl] = useState(0.95);
  const [threeFinger, setThreeFinger] = useState(false);

  // Move to a specific model, kicking off the slide/spin transition. Wraps
  // around at both ends so scrolling past the last returns to the first.
  const jumpTo = useCallback((target: number, d: number) => {
    const i = idxRef.current;
    if (target === i) return;
    idxRef.current = target;
    setDir(d);
    exitId.current += 1;
    setExiting({ index: i, dir: d, id: exitId.current });
    setIndex(target);
  }, []);

  const go = useCallback(
    (d: number) => {
      const i = idxRef.current;
      const next = (i + d + MODELS.length) % MODELS.length;
      jumpTo(next, d);
    },
    [jumpTo]
  );

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

  // Touch: 1 finger orbits, vertical 1-finger swipe navigates; 3 fingers steer
  // the directional light and block both navigation and camera rotation.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const lightStart = useRef<{
    x: number;
    y: number;
    az: number;
    el: number;
  } | null>(null);
  const avg = (touches: React.TouchList) => {
    let x = 0;
    let y = 0;
    for (let i = 0; i < touches.length; i++) {
      x += touches[i].clientX;
      y += touches[i].clientY;
    }
    return { x: x / touches.length, y: y / touches.length };
  };
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length >= 3) {
      setThreeFinger(true);
      touchStart.current = null;
      const c = avg(e.touches);
      lightStart.current = { x: c.x, y: c.y, az: lightAz, el: lightEl };
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (threeFinger && lightStart.current && e.touches.length >= 3) {
      const c = avg(e.touches);
      const dx = c.x - lightStart.current.x;
      const dy = c.y - lightStart.current.y;
      setLightAz(lightStart.current.az - dx * 0.006);
      setLightEl(
        Math.max(0.15, Math.min(1.45, lightStart.current.el - dy * 0.006))
      );
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (threeFinger) {
      if (e.touches.length < 3) {
        setThreeFinger(false);
        lightStart.current = null;
      }
      return;
    }
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
      onTouchMove={onTouchMove}
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
        <Scene
          index={index}
          dir={dir}
          exiting={exiting}
          onExitDone={onExitDone}
          exploded={exploded}
          bulbOn={bulbOn}
          dark={dark}
          lightAz={lightAz}
          lightEl={lightEl}
          orbitEnabled={!threeFinger}
        />
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
            onClick={() => jumpTo(i, i > index ? 1 : -1)}
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
