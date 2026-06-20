// @ts-nocheck
// Consumed as out-of-root source by BOTH apps; their bundlers resolve
// three/@react-three/* from each app's own node_modules at build time, but
// `tsc` run per app can't resolve them from packages/. The ./config contract
// stays fully type-checked.
"use client";

/**
 * AtelierStage — the 3D centrepiece of the cinematic reveal, a faithful port
 * of the Lovable reference (src/components/brand/AtelierStage.tsx): the brand
 * logo as a softly-lit, slowly-drifting plate, raked by volumetric light
 * shafts and dusted with sparkles.
 *
 * Differences from the reference, all deliberate:
 *   • Config-driven — logo URL + brand hex colours come from LandingConfig, so
 *     it themes per brand and uses whatever logo was uploaded in the studio.
 *   • No drei <Environment> preset — that fetches an HDRI from a CDN at
 *     runtime; we light the scene with spot/ambient lights instead so the
 *     reveal never depends on the network (and never half-loads).
 *   • Degrades to a glowing monolith when no logo is set (logos are dynamic).
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { Sparkles, Float } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

interface StageColors {
  primary: string;
  accent: string;
  ink: string;
  metal: string;
}

function LogoPlane({ url, color }: { url: string | null; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const texture = useMemo(() => {
    if (!url) return null;
    const t = new THREE.TextureLoader().load(url);
    t.anisotropy = 8;
    if ("colorSpace" in t) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [url]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ref.current) {
      ref.current.rotation.y = Math.sin(t * 0.4) * 0.35;
      ref.current.rotation.x = Math.cos(t * 0.3) * 0.08;
      ref.current.position.y = Math.sin(t * 0.6) * 0.05;
    }
  });

  return (
    <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.4}>
      <mesh ref={ref}>
        <planeGeometry args={[3.6, 3.6]} />
        <meshStandardMaterial
          map={texture || undefined}
          color={texture ? "#ffffff" : color}
          transparent
          metalness={0.4}
          roughness={0.25}
          emissive={new THREE.Color(color)}
          emissiveIntensity={texture ? 0.15 : 0.45}
          side={THREE.DoubleSide}
        />
      </mesh>
    </Float>
  );
}

function LightShaft({ x, color }: { x: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (ref.current) {
      ref.current.rotation.z = Math.sin(s.clock.elapsedTime * 0.3 + x) * 0.05;
      (ref.current.material as THREE.MeshBasicMaterial).opacity =
        0.08 + Math.sin(s.clock.elapsedTime * 0.8 + x) * 0.04;
    }
  });
  return (
    <mesh ref={ref} position={[x, 0, -2]} rotation={[0, 0, Math.PI / 12]}>
      <planeGeometry args={[0.6, 14]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

function Scene({
  logoUrl,
  colors,
  rotationSpeed = 1,
  glowIntensity = 1,
}: {
  logoUrl: string | null;
  colors: StageColors;
  rotationSpeed?: number;
  glowIntensity?: number;
}) {
  const { ink, primary, accent, metal } = colors;
  return (
    <>
      <fog attach="fog" args={[ink, 5, 14]} />
      <ambientLight intensity={0.35} />
      <spotLight position={[3, 4, 5]} angle={0.6} penumbra={0.8} intensity={2.5 * glowIntensity} color={accent} />
      <spotLight position={[-3, -2, 4]} angle={0.7} penumbra={1} intensity={1.2 * glowIntensity} color={metal} />
      <pointLight position={[0, 0, 6]} intensity={0.5} color={primary} />
      <LightShaft x={-2.5} color={accent} />
      <LightShaft x={2.5} color={accent} />
      <LightShaft x={0} color={accent} />
      <Suspense fallback={null}>
        <LogoPlane url={logoUrl} color={accent} />
      </Suspense>
      <Sparkles count={120} scale={[10, 6, 4]} size={3} speed={0.3 * rotationSpeed} color={accent} />
      <Sparkles count={40} scale={[6, 4, 2]} size={6} speed={0.15 * rotationSpeed} color={metal} />
    </>
  );
}

export function AtelierStage({
  logoUrl,
  colors,
  rotationSpeed,
  glowIntensity,
}: {
  logoUrl: string | null;
  colors: StageColors;
  rotationSpeed?: number;
  glowIntensity?: number;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 38 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Scene logoUrl={logoUrl} colors={colors} rotationSpeed={rotationSpeed} glowIntensity={glowIntensity} />
    </Canvas>
  );
}
