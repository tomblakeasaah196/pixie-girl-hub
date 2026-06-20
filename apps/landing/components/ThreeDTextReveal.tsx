"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { useRef, useState } from "react";
import { MotionValue, useMotionValueEvent } from "framer-motion";
import * as THREE from "three";

interface ThreeDTextRevealProps {
  text1: string;
  text2?: string;
  phase: MotionValue<"reveal" | "done" | "seam" | "part" | "untie">;
  glowIntensity: number;
  primaryColor: string;
  accentColor: string;
}

function AnimatedWord({
  children,
  position,
  color,
  fontSize,
  floatOffset,
  phase,
}: {
  children: string;
  position: [number, number, number];
  color: string;
  fontSize: number;
  floatOffset: number;
  phase: MotionValue<"reveal" | "done" | "seam" | "part" | "untie">;
}) {
  const ref = useRef<THREE.Group>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  useMotionValueEvent(phase, "change", (latest) => {
    setIsRevealing(latest === "reveal");
  });

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4 + floatOffset) * 0.25;
    ref.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.8 + floatOffset) * 0.06;
    const target = isRevealing ? 1 : 0.001;
    ref.current.scale.lerp(new THREE.Vector3(target, target, target), 0.12);
  });

  return (
    <group ref={ref} position={position}>
      <Text fontSize={fontSize} color={color} anchorX="center" anchorY="middle" letterSpacing={0.02}>
        {children}
      </Text>
    </group>
  );
}

export function ThreeDTextReveal({
  text1,
  text2,
  phase,
  glowIntensity,
  primaryColor,
  accentColor,
}: ThreeDTextRevealProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 50 }}
      style={{ width: "100%", height: "100%" }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.9} />
      <pointLight position={[5, 5, 5]} intensity={1.2 * (1 + glowIntensity)} color={accentColor} />
      <pointLight position={[-5, -5, 3]} intensity={0.6} color={primaryColor} />

      <AnimatedWord position={[0, 0.7, 0]} color={primaryColor} fontSize={1} floatOffset={0} phase={phase}>
        {text1}
      </AnimatedWord>

      {text2 && (
        <AnimatedWord position={[0, -0.7, 0]} color={accentColor} fontSize={0.7} floatOffset={1.5} phase={phase}>
          {text2}
        </AnimatedWord>
      )}
    </Canvas>
  );
}
