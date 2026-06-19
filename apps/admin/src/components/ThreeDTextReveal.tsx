"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere } from "@react-three/drei";
import { useRef, useEffect, useState } from "react";
import { MotionValue, useMotionValueEvent } from "framer-motion";
import * as THREE from "three";

interface ThreeDTextRevealProps {
  brandType: "pixiegirl" | "faitlynhair";
  text1: string;
  text2?: string;
  phase: MotionValue<"reveal" | "done" | "seam" | "part" | "untie">;
  glowIntensity: number;
  primaryColor: string;
  accentColor: string;
  inkColor: string;
}

function TextBubbles({
  text1,
  text2,
  phase,
  delay = 0,
  glowIntensity,
  primaryColor,
  accentColor,
}: {
  text1: string;
  text2?: string;
  phase: MotionValue<"reveal" | "done" | "seam" | "part" | "untie">;
  delay?: number;
  glowIntensity: number;
  primaryColor: string;
  accentColor: string;
}) {
  const group1Ref = useRef<THREE.Group>(null);
  const group2Ref = useRef<THREE.Group>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  useMotionValueEvent(phase, "change", (latest) => {
    setIsRevealing(latest === "reveal");
  });

  useFrame(() => {
    if (group1Ref.current) {
      group1Ref.current.rotation.y += 0.003;
      group1Ref.current.rotation.x += 0.001;
      if (isRevealing) {
        group1Ref.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
      } else {
        group1Ref.current.scale.lerp(new THREE.Vector3(0.3, 0.3, 0.3), 0.1);
      }
    }
    if (group2Ref.current && text2) {
      group2Ref.current.rotation.y -= 0.002;
      group2Ref.current.rotation.x -= 0.0015;
      if (isRevealing) {
        group2Ref.current.scale.lerp(new THREE.Vector3(0.7, 0.7, 0.7), 0.1);
      } else {
        group2Ref.current.scale.lerp(new THREE.Vector3(0.2, 0.2, 0.2), 0.1);
      }
    }
  });

  return (
    <>
      <group ref={group1Ref} position={[0, 0.5, 0]}>
        <Sphere args={[1, 64, 64]}>
          <meshStandardMaterial
            color={primaryColor}
            emissive={primaryColor}
            emissiveIntensity={glowIntensity * 0.5}
            roughness={0.3}
            metalness={0.7}
            transparent
            opacity={isRevealing ? 1 : 0}
          />
        </Sphere>
        <mesh>
          <sphereGeometry args={[1.05, 64, 64]} />
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={isRevealing ? 0.3 : 0}
            wireframe={false}
          />
        </mesh>
      </group>

      {text2 && (
        <group ref={group2Ref} position={[0, -0.5, 0]}>
          <Sphere args={[0.7, 64, 64]}>
            <meshStandardMaterial
              color={accentColor}
              emissive={accentColor}
              emissiveIntensity={glowIntensity * 0.4}
              roughness={0.3}
              metalness={0.7}
              transparent
              opacity={isRevealing ? 1 : 0}
            />
          </Sphere>
          <mesh>
            <sphereGeometry args={[0.75, 64, 64]} />
            <meshBasicMaterial
              color={primaryColor}
              transparent
              opacity={isRevealing ? 0.2 : 0}
              wireframe={false}
            />
          </mesh>
        </group>
      )}
    </>
  );
}

export function ThreeDTextReveal({
  brandType,
  text1,
  text2,
  phase,
  glowIntensity,
  primaryColor,
  accentColor,
}: ThreeDTextRevealProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 4], fov: 50 }}
      style={{ background: "transparent", width: "100%", height: "100%" }}
      gl={{ transparent: true, antialias: true }}
    >
      <ambientLight intensity={0.8} />
      <pointLight position={[5, 5, 5]} intensity={1.2} color={accentColor} />
      <pointLight position={[-5, -5, 3]} intensity={0.6} color={primaryColor} />
      <pointLight position={[0, 0, 8]} intensity={0.4} />

      <TextBubbles
        text1={text1}
        text2={text2}
        phase={phase}
        delay={0}
        glowIntensity={glowIntensity}
        primaryColor={primaryColor}
        accentColor={accentColor}
      />
    </Canvas>
  );
}
