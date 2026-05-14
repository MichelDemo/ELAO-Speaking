"use client";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  Component,
  type ReactNode,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, useFBX, Environment } from "@react-three/drei";
import * as THREE from "three";

interface AvatarProps {
  amplitude: number;
  modelUrl?: string;
}

// ── Error boundary: renders null and calls onError when model load fails ───────
class ModelErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { caught: boolean }
> {
  state = { caught: false };
  static getDerivedStateFromError() {
    return { caught: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.caught ? null : this.props.children;
  }
}

// ── ARKit blendshape names (Avaturn GLB) ──────────────────────────────────────
const BS = {
  jawOpen: "jawOpen",
  visemeAA: "viseme_aa",
  visemeO: "viseme_O",
  blinkL: "eyeBlink_L",
  blinkR: "eyeBlink_R",
};

// ── GLB model (Avaturn — ARKit blendshapes) ───────────────────────────────────
function GLBModel({ amplitude, url }: { amplitude: number; url: string }) {
  const { scene } = useGLTF(url);
  const meshRef = useRef<THREE.SkinnedMesh | null>(null);
  const nextBlinkRef = useRef(Date.now() + 2000 + Math.random() * 3000);
  const blinkEndRef = useRef(0);

  useEffect(() => {
    scene.traverse((obj) => {
      if (
        !meshRef.current &&
        obj instanceof THREE.SkinnedMesh &&
        obj.morphTargetDictionary &&
        BS.jawOpen in obj.morphTargetDictionary
      ) {
        meshRef.current = obj;
      }
    });
  }, [scene]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences) return;

    const set = (name: string, v: number) => {
      const i = mesh.morphTargetDictionary![name];
      if (i !== undefined)
        mesh.morphTargetInfluences![i] = Math.max(0, Math.min(1, v));
    };

    const jaw = Math.min(amplitude * 1.3, 0.65);
    set(BS.jawOpen, jaw);
    set(BS.visemeAA, jaw * 0.55);
    set(BS.visemeO, jaw * 0.3);

    const now = Date.now();
    if (now > blinkEndRef.current && now >= nextBlinkRef.current) {
      blinkEndRef.current = now + 120;
      nextBlinkRef.current = now + 120 + 2500 + Math.random() * 2500;
    }
    const blinking = now < blinkEndRef.current ? 1 : 0;
    set(BS.blinkL, blinking);
    set(BS.blinkR, blinking);
  });

  return (
    <group position={[0, -1.53, 0]}>
      <primitive object={scene} />
    </group>
  );
}

// ── FBX model (Rocketbox _facial.fbx → ARKit blendshapes; Mixamo → jaw bone) ──
function FBXModel({ amplitude, url }: { amplitude: number; url: string }) {
  const fbx = useFBX(url);
  const meshRef = useRef<THREE.SkinnedMesh | null>(null);
  const jawRef = useRef<THREE.Bone | null>(null);
  const nextBlinkRef = useRef(Date.now() + 2000 + Math.random() * 3000);
  const blinkEndRef = useRef(0);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    // Auto-scale so the character is ~1.7 units tall
    const box = new THREE.Box3().setFromObject(fbx);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 0) fbx.scale.setScalar(1.7 / size.y);

    // Prefer ARKit blendshapes (Rocketbox _facial.fbx)
    fbx.traverse((obj) => {
      if (
        !meshRef.current &&
        obj instanceof THREE.SkinnedMesh &&
        obj.morphTargetDictionary &&
        BS.jawOpen in obj.morphTargetDictionary
      ) {
        meshRef.current = obj;
      }
    });

    // Fallback: jaw bone rotation (plain Mixamo FBX without blendshapes)
    if (!meshRef.current) {
      fbx.traverse((obj) => {
        if (!jawRef.current && obj instanceof THREE.Bone) {
          if (obj.name.toLowerCase().includes("jaw")) jawRef.current = obj;
        }
      });
    }
  }, [fbx]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (mesh?.morphTargetDictionary && mesh.morphTargetInfluences) {
      // ARKit blendshape path (Rocketbox)
      const set = (name: string, v: number) => {
        const i = mesh.morphTargetDictionary![name];
        if (i !== undefined)
          mesh.morphTargetInfluences![i] = Math.max(0, Math.min(1, v));
      };
      const jaw = Math.min(amplitude * 1.3, 0.65);
      set(BS.jawOpen, jaw);
      set(BS.visemeAA, jaw * 0.55);
      set(BS.visemeO, jaw * 0.3);

      const now = Date.now();
      if (now > blinkEndRef.current && now >= nextBlinkRef.current) {
        blinkEndRef.current = now + 120;
        nextBlinkRef.current = now + 120 + 2500 + Math.random() * 2500;
      }
      const blinking = now < blinkEndRef.current ? 1 : 0;
      set(BS.blinkL, blinking);
      set(BS.blinkR, blinking);
    } else if (jawRef.current) {
      // Jaw bone fallback (plain Mixamo)
      jawRef.current.rotation.x = -Math.min(amplitude * 0.45, 0.35);
    }
  });

  return (
    <group position={[0, -1.53, 0]}>
      <primitive object={fbx} />
    </group>
  );
}

// ── SVG fallback face ──────────────────────────────────────────────────────────
function SVGFace({ amplitude }: { amplitude: number }) {
  const [blink, setBlink] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const schedule = () => {
      timerRef.current = setTimeout(
        () => {
          setBlink(true);
          setTimeout(() => setBlink(false), 120);
          schedule();
        },
        2500 + Math.random() * 2500
      );
    };
    schedule();
    return () => clearTimeout(timerRef.current);
  }, []);

  const speaking = amplitude > 0.03;
  const mouthOpen = Math.max(0, amplitude * 22);
  const mx1 = 34, mx2 = 66, my = 62;
  const mouthPath = `M ${mx1} ${my} Q 50 ${my + Math.max(2, mouthOpen)} ${mx2} ${my}`;
  const glowSize = 20 + amplitude * 50;
  const glowOpacity = 0.35 + amplitude * 0.55;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
      }}
    >
      <div style={{ position: "relative", width: 220, height: 220 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            boxShadow: speaking
              ? `0 0 ${glowSize}px rgba(99,102,241,${glowOpacity})`
              : "none",
            border: speaking
              ? `2px solid rgba(99,102,241,${glowOpacity * 0.6})`
              : "2px solid transparent",
            transition: "box-shadow 0.1s ease, border-color 0.1s ease",
            pointerEvents: "none",
          }}
        />
        <svg viewBox="0 0 100 100" width={220} height={220}>
          <defs>
            <radialGradient id="faceGrad" cx="38%" cy="32%" r="65%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#312e81" />
            </radialGradient>
            <radialGradient id="eyeGrad" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#e0e7ff" />
              <stop offset="100%" stopColor="#c7d2fe" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="44" fill="url(#faceGrad)" />
          <ellipse cx="35" cy="43" rx="7" ry={blink ? 0.7 : 7} fill="url(#eyeGrad)" />
          {!blink && (
            <>
              <circle cx="36.5" cy="44" r="3.5" fill="#1e1b4b" />
              <circle cx="37.8" cy="42.5" r="1.2" fill="white" opacity="0.75" />
            </>
          )}
          <ellipse cx="65" cy="43" rx="7" ry={blink ? 0.7 : 7} fill="url(#eyeGrad)" />
          {!blink && (
            <>
              <circle cx="66.5" cy="44" r="3.5" fill="#1e1b4b" />
              <circle cx="67.8" cy="42.5" r="1.2" fill="white" opacity="0.75" />
            </>
          )}
          {speaking && mouthOpen > 4 && (
            <path
              d={`M ${mx1} ${my} Q 50 ${my + mouthOpen} ${mx2} ${my} Z`}
              fill="#1e1b4b"
              opacity="0.9"
            />
          )}
          {speaking && mouthOpen > 8 && (
            <rect x="40" y={my} width="20" height="5" fill="white" opacity="0.92" rx="1.5" />
          )}
          <path
            d={mouthPath}
            stroke="white"
            strokeWidth="2.8"
            fill="none"
            strokeLinecap="round"
          />
          {speaking && (
            <>
              <ellipse cx="24" cy="56" rx="7" ry="4" fill="#f472b6" opacity="0.18" />
              <ellipse cx="76" cy="56" rx="7" ry="4" fill="#f472b6" opacity="0.18" />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function Avatar({ amplitude, modelUrl }: AvatarProps) {
  const [useSVG, setUseSVG] = useState(false);
  const url = modelUrl ?? process.env.NEXT_PUBLIC_AVATURN_URL ?? "";
  const isFBX = url.toLowerCase().endsWith(".fbx");

  if (!url || useSVG) {
    return <SVGFace amplitude={amplitude} />;
  }

  return (
    <ModelErrorBoundary onError={() => setUseSVG(true)}>
      <div style={{ width: "100%", height: "100%", background: "#0f172a" }}>
        <Canvas camera={{ position: [0, 0.13, 0.55], fov: 25 }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[0.5, 2, 1.5]} intensity={1} />
          <directionalLight position={[-1, 0.5, -0.5]} intensity={0.25} />
          <Suspense fallback={null}>
            {isFBX ? (
              <FBXModel amplitude={amplitude} url={url} />
            ) : (
              <GLBModel amplitude={amplitude} url={url} />
            )}
            <Environment preset="city" />
          </Suspense>
        </Canvas>
      </div>
    </ModelErrorBoundary>
  );
}
