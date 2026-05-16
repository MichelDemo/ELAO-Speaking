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

// ── FBX model ─────────────────────────────────────────────────────────────────
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

    const box = new THREE.Box3().setFromObject(fbx);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 0) fbx.scale.setScalar(1.7 / size.y);

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
  const [pupil, setPupil] = useState({ x: 0, y: 0 });
  const [bobY, setBobY] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);

  // Random blink
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

  // Idle animations: pupil drift + subtle vertical bob
  useEffect(() => {
    const tick = () => {
      tRef.current += 0.012;
      const t = tRef.current;
      setPupil({
        x: Math.sin(t * 0.6) * 2.2 + Math.sin(t * 1.7) * 0.8,
        y: Math.cos(t * 0.4) * 1.4 + Math.cos(t * 1.3) * 0.5,
      });
      setBobY(Math.sin(t * 0.9) * 2.5);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const speaking = amplitude > 0.03;
  const amp = Math.max(0, Math.min(1, amplitude));

  // Mouth geometry
  const mouthOpen = amp * 30;
  const mx1 = 34, mx2 = 66, my = 63;

  // Eyebrow lift when speaking (expressive)
  const browLift = speaking ? -3.5 : 0;
  // Eyebrow furrow angle when thinking (idle slight arch)
  const browSlant = speaking ? 1 : 0;

  // Glow
  const glowSize = 18 + amp * 60;
  const glowOpacity = speaking ? 0.3 + amp * 0.6 : 0.08;

  const SIZE = 270;

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
      <div
        style={{
          position: "relative",
          width: SIZE,
          height: SIZE,
          transform: `translateY(${bobY}px)`,
          transition: "transform 0.1s ease-out",
        }}
      >
        {/* Glow ring */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            boxShadow: `0 0 ${glowSize}px rgba(99,102,241,${glowOpacity})`,
            border: `2px solid rgba(99,102,241,${glowOpacity * 0.7})`,
            transition: "box-shadow 0.12s ease, border-color 0.12s ease",
            pointerEvents: "none",
          }}
        />

        <svg viewBox="0 0 100 100" width={SIZE} height={SIZE}>
          <defs>
            <radialGradient id="faceGrad" cx="38%" cy="32%" r="65%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#312e81" />
            </radialGradient>
            <radialGradient id="eyeGrad" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#e0e7ff" />
              <stop offset="100%" stopColor="#c7d2fe" />
            </radialGradient>
            <radialGradient id="pupilGrad" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#3730a3" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </radialGradient>
          </defs>

          {/* Face */}
          <circle cx="50" cy="50" r="44" fill="url(#faceGrad)" />

          {/* Subtle sheen */}
          <ellipse cx="38" cy="32" rx="14" ry="8" fill="white" opacity="0.06" />

          {/* ── Eyebrows ── */}
          {/* Left eyebrow */}
          <path
            d={`M 26 ${38 + browLift} Q 35 ${34 + browLift - browSlant} 44 ${36 + browLift}`}
            stroke="#c7d2fe"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
            style={{ transition: "d 0.15s ease" }}
          />
          {/* Right eyebrow */}
          <path
            d={`M 56 ${36 + browLift} Q 65 ${34 + browLift - browSlant} 74 ${38 + browLift}`}
            stroke="#c7d2fe"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
            style={{ transition: "d 0.15s ease" }}
          />

          {/* ── Eyes ── */}
          {/* Left eye white */}
          <ellipse cx="35" cy="44" rx="7.5" ry={blink ? 0.6 : 7.5} fill="url(#eyeGrad)" />
          {!blink && (
            <>
              <circle cx={35 + pupil.x} cy={44 + pupil.y} r="3.8" fill="url(#pupilGrad)" />
              <circle cx={35.5 + pupil.x * 0.6} cy={43 + pupil.y * 0.6} r="1.3" fill="white" opacity="0.8" />
              {/* Subtle iris ring */}
              <circle cx={35 + pupil.x} cy={44 + pupil.y} r="3.8" fill="none" stroke="#4338ca" strokeWidth="0.8" opacity="0.5" />
            </>
          )}

          {/* Right eye white */}
          <ellipse cx="65" cy="44" rx="7.5" ry={blink ? 0.6 : 7.5} fill="url(#eyeGrad)" />
          {!blink && (
            <>
              <circle cx={65 + pupil.x} cy={44 + pupil.y} r="3.8" fill="url(#pupilGrad)" />
              <circle cx={65.5 + pupil.x * 0.6} cy={43 + pupil.y * 0.6} r="1.3" fill="white" opacity="0.8" />
              <circle cx={65 + pupil.x} cy={44 + pupil.y} r="3.8" fill="none" stroke="#4338ca" strokeWidth="0.8" opacity="0.5" />
            </>
          )}

          {/* ── Nose hint ── */}
          <path d="M 48 53 Q 50 57 52 53" stroke="#a5b4fc" strokeWidth="1.2" fill="none" opacity="0.4" strokeLinecap="round" />

          {/* ── Mouth ── */}
          {/* Inner mouth (only when open) */}
          {speaking && mouthOpen > 5 && (
            <path
              d={`M ${mx1} ${my} Q 50 ${my + mouthOpen * 0.9} ${mx2} ${my} Z`}
              fill="#1e1b4b"
              opacity="0.95"
            />
          )}
          {/* Teeth (high amplitude) */}
          {speaking && mouthOpen > 12 && (
            <rect
              x="38"
              y={my}
              width="24"
              height={Math.min(mouthOpen * 0.25, 6)}
              fill="white"
              opacity="0.9"
              rx="1.5"
            />
          )}
          {/* Mouth outline — smile at rest, open when speaking */}
          <path
            d={
              speaking && mouthOpen > 4
                ? `M ${mx1} ${my} Q 50 ${my + mouthOpen * 0.85} ${mx2} ${my}`
                : `M ${mx1} ${my - 1} Q 50 ${my + 3} ${mx2} ${my - 1}`
            }
            stroke="white"
            strokeWidth="2.6"
            fill="none"
            strokeLinecap="round"
          />

          {/* ── Blush ── */}
          <ellipse cx="22" cy="57" rx="8" ry="4.5" fill="#f472b6" opacity={speaking ? 0.22 : 0.08} style={{ transition: "opacity 0.3s" }} />
          <ellipse cx="78" cy="57" rx="8" ry="4.5" fill="#f472b6" opacity={speaking ? 0.22 : 0.08} style={{ transition: "opacity 0.3s" }} />
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
        <Canvas camera={{ position: [0, 0.13, 0.48], fov: 22 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[0.5, 2, 1.5]} intensity={1.1} />
          <directionalLight position={[-1, 0.5, -0.5]} intensity={0.3} />
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
