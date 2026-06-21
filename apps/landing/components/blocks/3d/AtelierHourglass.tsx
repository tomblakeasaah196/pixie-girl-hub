"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";

export type HourglassTier = 1 | 2 | 3 | 4 | 5;

interface Props {
  /** 0..1 — how full the upper chamber is. */
  topFraction: number;
  tier: HourglassTier;
  /** Four strings — one per rotated face. */
  displayFaces: string[];
  faceLabels: string[];
  /** Brand-driven palette pulled from the Atelier theme. Hex strings. */
  palette: {
    sandRest: string;
    sandUrgent: string;
    glow: string;
    glassTint: string;
  };
}

function vesselGeometry() {
  const pts: THREE.Vector2[] = [];
  const segs = 64;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = (t - 0.5) * 3.4;
    const bulb = 0.95;
    const pinch = 0.35;
    const a = Math.cos((t - 0.25) * Math.PI * 2) * 0.5 + 0.5;
    const b = Math.cos((t - 0.75) * Math.PI * 2) * 0.5 + 0.5;
    let r = pinch + (bulb - pinch) * Math.max(a, b) * 0.9;
    if (t < 0.04) r = 0.45 * (t / 0.04) + 0.2;
    if (t > 0.96) r = 0.55 * ((1 - t) / 0.04) + 0.2;
    pts.push(new THREE.Vector2(r, y));
  }
  return new THREE.LatheGeometry(pts, 96);
}

function radiusAt(y: number) {
  const t = y / 3.4 + 0.5;
  const bulb = 0.95;
  const pinch = 0.35;
  const a = Math.cos((t - 0.25) * Math.PI * 2) * 0.5 + 0.5;
  const b = Math.cos((t - 0.75) * Math.PI * 2) * 0.5 + 0.5;
  return Math.max(0.08, pinch + (bulb - pinch) * Math.max(a, b) * 0.9 - 0.05);
}

interface SandProps {
  topFraction: number;
  tier: HourglassTier;
  particleCount: number;
  streamCount: number;
  sandRest: string;
  sandUrgent: string;
}

function Sand({
  topFraction,
  tier,
  particleCount,
  streamCount,
  sandRest,
  sandUrgent,
}: SandProps) {
  const topRef = useRef<THREE.Points>(null!);
  const botRef = useRef<THREE.Points>(null!);
  const streamRef = useRef<THREE.Points>(null!);

  // Initialise once; positions are nudged in-place each frame instead of being
  // re-randomised (which causes flicker).
  const topPositions = useMemo(() => {
    const arr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const ix = i * 3;
      const y = -0.05 + Math.random() * 1.55;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radiusAt(y) * 0.85;
      arr[ix] = Math.cos(a) * r;
      arr[ix + 1] = y;
      arr[ix + 2] = Math.sin(a) * r;
    }
    return arr;
  }, [particleCount]);

  const botPositions = useMemo(() => {
    const arr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const ix = i * 3;
      const y = -1.55 + Math.random() * 1.45;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radiusAt(y) * 0.85;
      arr[ix] = Math.cos(a) * r;
      arr[ix + 1] = y;
      arr[ix + 2] = Math.sin(a) * r;
    }
    return arr;
  }, [particleCount]);

  const streamPositions = useMemo(() => {
    const arr = new Float32Array(streamCount * 3);
    for (let i = 0; i < streamCount; i++) {
      const ix = i * 3;
      arr[ix] = (Math.random() - 0.5) * 0.05;
      arr[ix + 1] = -0.05 + Math.random() * 0.3;
      arr[ix + 2] = (Math.random() - 0.5) * 0.05;
    }
    return arr;
  }, [streamCount]);

  const streamSeeds = useMemo(() => {
    const arr = new Float32Array(streamCount * 2);
    for (let i = 0; i < streamCount; i++) {
      arr[i * 2] = (Math.random() - 0.5) * 0.05;
      arr[i * 2 + 1] = (Math.random() - 0.5) * 0.05;
    }
    return arr;
  }, [streamCount]);

  const colorBuf = useMemo(() => new THREE.Color(), []);
  const targetHex = tier >= 2 ? sandUrgent : sandRest;

  useFrame((_, dt) => {
    const dtClamped = Math.min(dt, 0.05);
    const topY = -0.05 + topFraction * 1.55;
    const botY = -1.55 + (1 - topFraction) * 1.45;

    const top = topPositions;
    for (let i = 0; i < particleCount; i++) {
      const ix = i * 3;
      let y = top[ix + 1];
      y -= dtClamped * (0.05 + Math.random() * 0.05);
      if (y < -0.04 || y > topY) {
        y = topY - Math.random() * 0.05;
        const r = Math.random() * radiusAt(y) * 0.85;
        const a = Math.random() * Math.PI * 2;
        top[ix] = Math.cos(a) * r;
        top[ix + 2] = Math.sin(a) * r;
      }
      top[ix + 1] = y;
    }
    topRef.current.geometry.attributes.position.needsUpdate = true;

    const bot = botPositions;
    for (let i = 0; i < particleCount; i++) {
      const ix = i * 3;
      let y = bot[ix + 1];
      const ceiling = botY;
      if (y > ceiling) {
        y = -1.55 + Math.random() * 0.05;
        const r = Math.random() * radiusAt(y) * 0.85;
        const a = Math.random() * Math.PI * 2;
        bot[ix] = Math.cos(a) * r;
        bot[ix + 2] = Math.sin(a) * r;
      }
      bot[ix + 1] = y;
    }
    botRef.current.geometry.attributes.position.needsUpdate = true;

    const speed = tier >= 4 ? 2.4 : tier >= 3 ? 1.5 : 1.0;
    const stream = streamPositions;
    for (let i = 0; i < streamCount; i++) {
      const ix = i * 3;
      let y = stream[ix + 1];
      y -= dtClamped * (0.9 + Math.random() * 0.4) * speed;
      if (y < botY + 0.05) {
        y = 0.2 + Math.random() * 0.1;
      }
      stream[ix] = streamSeeds[i * 2];
      stream[ix + 1] = y;
      stream[ix + 2] = streamSeeds[i * 2 + 1];
    }
    streamRef.current.geometry.attributes.position.needsUpdate = true;

    colorBuf.set(targetHex);
    const m1 = topRef.current.material as THREE.PointsMaterial;
    const m2 = botRef.current.material as THREE.PointsMaterial;
    const m3 = streamRef.current.material as THREE.PointsMaterial;
    m1.color.lerp(colorBuf, 0.04);
    m2.color.lerp(colorBuf, 0.04);
    m3.color.lerp(colorBuf, 0.06);
  });

  return (
    <group>
      <points ref={topRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[topPositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.025}
          color={sandRest}
          transparent
          opacity={0.95}
          sizeAttenuation
        />
      </points>
      <points ref={botRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[botPositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.028}
          color={sandRest}
          transparent
          opacity={0.95}
          sizeAttenuation
        />
      </points>
      <points ref={streamRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[streamPositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.035}
          color={sandRest}
          transparent
          opacity={1}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

function Vessel({
  topFraction,
  tier,
  displayFaces,
  faceLabels,
  palette,
  particleCount,
  streamCount,
  showAllFaces,
}: Props & {
  particleCount: number;
  streamCount: number;
  showAllFaces: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const glowRef = useRef<THREE.PointLight>(null!);
  const geom = useMemo(() => vesselGeometry(), []);

  useFrame((state, dt) => {
    const dtClamped = Math.min(dt, 0.05);
    if (tier < 4) {
      groupRef.current.rotation.y += (dtClamped * Math.PI * 2) / 90;
    } else if (tier === 4) {
      groupRef.current.rotation.y += (dtClamped * Math.PI * 2) / 180;
    } else {
      groupRef.current.rotation.y = THREE.MathUtils.lerp(
        groupRef.current.rotation.y,
        0,
        dtClamped * 2,
      );
    }

    const t = state.clock.elapsedTime;
    let scale = 1;
    if (tier === 3) scale = 1 + Math.sin(t * Math.PI) * 0.01;
    if (tier === 4) scale = 1.18 + Math.sin(t * 2) * 0.015;
    if (tier === 5) scale = 1.24 + Math.sin(t * Math.PI * 2) * 0.02;
    const s = THREE.MathUtils.lerp(
      groupRef.current.scale.x,
      scale,
      dtClamped * 3,
    );
    groupRef.current.scale.setScalar(s);

    if (glowRef.current) {
      const base = tier >= 3 ? 4 : tier >= 2 ? 2.2 : 0.6;
      glowRef.current.intensity =
        base + (tier >= 3 ? Math.sin(t * 2) * 0.6 : 0);
    }
  });

  const visibleFaces = showAllFaces ? 4 : 1;

  return (
    <group ref={groupRef}>
      <mesh geometry={geom}>
        <meshPhysicalMaterial
          color={palette.glassTint}
          transmission={0.92}
          thickness={0.6}
          roughness={0.08}
          ior={1.45}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          envMapIntensity={1.2}
        />
      </mesh>

      <Sand
        topFraction={topFraction}
        tier={tier}
        particleCount={particleCount}
        streamCount={streamCount}
        sandRest={palette.sandRest}
        sandUrgent={palette.sandUrgent}
      />

      {Array.from({ length: visibleFaces }).map((_, i) => {
        const angle = (i / visibleFaces) * Math.PI * 2;
        const r = 0.98;
        const val = displayFaces[i] ?? displayFaces[0] ?? "";
        const label = faceLabels[i] ?? faceLabels[0] ?? "";
        return (
          <group key={i} rotation={[0, angle, 0]}>
            <Text
              position={[0, 0.55, r]}
              fontSize={tier >= 4 ? 0.85 : 0.6}
              color="#fff8ec"
              anchorX="center"
              anchorY="middle"
              fillOpacity={0.92}
              outlineWidth={0.003}
              outlineColor={palette.glow}
              outlineOpacity={0.5}
            >
              {val}
            </Text>
            {tier < 5 && (
              <Text
                position={[0, 0.18, r]}
                fontSize={0.11}
                color={palette.glow}
                anchorX="center"
                anchorY="middle"
                letterSpacing={0.35}
                fillOpacity={0.85}
              >
                {label}
              </Text>
            )}
          </group>
        );
      })}

      <pointLight
        ref={glowRef}
        position={[0, -1.9, 0]}
        color={palette.glow}
        intensity={0.6}
        distance={4}
      />
    </group>
  );
}

function RingPulse({
  tier,
  color,
}: {
  tier: HourglassTier;
  color: string;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame((state) => {
    if (tier < 5) {
      if (matRef.current) matRef.current.opacity = 0;
      return;
    }
    const t = state.clock.elapsedTime % 1;
    ref.current.scale.setScalar(1 + t * 2);
    matRef.current.opacity = (1 - t) * 0.7;
  });
  return (
    <mesh ref={ref} position={[0, -1.85, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.9, 0.94, 64]} />
      <meshBasicMaterial
        ref={matRef}
        color={color}
        transparent
        opacity={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function StaticFallback({
  displayFaces,
  faceLabels,
  palette,
}: {
  displayFaces: string[];
  faceLabels: string[];
  palette: Props["palette"];
}) {
  return (
    <svg
      viewBox="0 0 200 320"
      className="w-full h-full"
      aria-hidden="true"
      role="img"
    >
      <defs>
        <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.glassTint} stopOpacity="0.35" />
          <stop offset="100%" stopColor={palette.glassTint} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <path
        d="M55 20 Q60 90 100 160 Q140 230 145 300 L55 300 Q60 230 100 160 Q140 90 145 20 Z"
        fill="url(#glass)"
        stroke={palette.glow}
        strokeOpacity="0.35"
        strokeWidth="0.6"
      />
      <text
        x="100"
        y="170"
        textAnchor="middle"
        fill="#fff8ec"
        fontFamily="var(--font-atelier-display, serif)"
        fontSize="40"
        fontStyle="italic"
      >
        {displayFaces[0]}
      </text>
      <text
        x="100"
        y="200"
        textAnchor="middle"
        fill={palette.glow}
        fontFamily="var(--font-atelier-body, sans-serif)"
        fontSize="10"
        letterSpacing="3"
      >
        {faceLabels[0]}
      </text>
    </svg>
  );
}

function usePerfTier(): { particleCount: number; streamCount: number; showAllFaces: boolean; dpr: [number, number] } {
  const [profile, setProfile] = useState(() => ({
    particleCount: 320,
    streamCount: 80,
    showAllFaces: false,
    dpr: [1, 1.5] as [number, number],
  }));
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window.innerWidth;
    if (w >= 1024) {
      setProfile({
        particleCount: 900,
        streamCount: 120,
        showAllFaces: true,
        dpr: [1, 2],
      });
    } else if (w >= 640) {
      setProfile({
        particleCount: 520,
        streamCount: 90,
        showAllFaces: true,
        dpr: [1, 1.75],
      });
    } else {
      setProfile({
        particleCount: 280,
        streamCount: 70,
        showAllFaces: false,
        dpr: [1, 1.5],
      });
    }
  }, []);
  return profile;
}

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(m.matches);
    const handler = (e: MediaQueryListEvent) => setReduce(e.matches);
    m.addEventListener("change", handler);
    return () => m.removeEventListener("change", handler);
  }, []);
  return reduce;
}

export function AtelierHourglass(props: Props) {
  const [mounted, setMounted] = useState(false);
  const perf = usePerfTier();
  const reduceMotion = usePrefersReducedMotion();
  useEffect(() => setMounted(true), []);

  if (!mounted || reduceMotion) {
    return (
      <StaticFallback
        displayFaces={props.displayFaces}
        faceLabels={props.faceLabels}
        palette={props.palette}
      />
    );
  }

  return (
    <Canvas
      camera={{ position: [0, 0.2, 6], fov: 32 }}
      dpr={perf.dpr}
      gl={{ alpha: true, antialias: true }}
      resize={{ scroll: false }}
    >
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[3, 4, 4]}
        intensity={0.6}
        color="#fff1d6"
      />
      <directionalLight
        position={[-3, -2, 2]}
        intensity={0.2}
        color={props.palette.glow}
      />
      <Vessel
        {...props}
        particleCount={perf.particleCount}
        streamCount={perf.streamCount}
        showAllFaces={perf.showAllFaces}
      />
      <RingPulse tier={props.tier} color={props.palette.glow} />
    </Canvas>
  );
}
