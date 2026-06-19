"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere } from "@react-three/drei";
import { useRef, useState } from "react";
import { MotionValue, useMotionValueEvent } from "framer-motion";
import * as THREE from "three";

interface ThreeDLogoRevealProps {
  rotationSpeed: number;
  glowIntensity: number;
  primaryColor: string;
  accentColor: string;
  phase: MotionValue<"reveal" | "done" | "seam" | "part" | "untie">;
}

function LogoGeometry({
  rotationSpeed,
  primaryColor,
  accentColor,
  glowIntensity,
  phase,
}: {
  rotationSpeed: number;
  primaryColor: string;
  accentColor: string;
  glowIntensity: number;
  phase: MotionValue<"reveal" | "done" | "seam" | "part" | "untie">;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const orbitRef = useRef<THREE.Group>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  useMotionValueEvent(phase, "change", (latest) => {
    setIsRevealing(latest === "reveal");
  });

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01 * rotationSpeed;
      meshRef.current.rotation.x = Math.sin(meshRef.current.rotation.y * 0.5) * 0.2;
      if (isRevealing) {
        meshRef.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
      } else {
        meshRef.current.scale.lerp(new THREE.Vector3(0.3, 0.3, 0.3), 0.1);
      }
    }
    if (orbitRef.current) {
      orbitRef.current.rotation.z += 0.005 * rotationSpeed;
    }
  });

  return (
    <group ref={meshRef} position={[0, 0, 0]}>
      {/* Central cube */}
      <mesh>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshStandardMaterial
          color={primaryColor}
          emissive={primaryColor}
          emissiveIntensity={glowIntensity * 0.5}
          roughness={0.3}
          metalness={0.7}
          transparent
          opacity={isRevealing ? 1 : 0}
        />
      </mesh>

      {/* Glowing outline */}
      <mesh>
        <boxGeometry args={[0.85, 0.85, 0.85]} />
        <meshBasicMaterial
          color={accentColor}
          transparent
          opacity={isRevealing ? 0.4 : 0}
          wireframe={false}
        />
      </mesh>

      {/* Orbiting spheres */}
      <group ref={orbitRef}>
        {[0, 1, 2].map((i) => (
          <group
            key={i}
            position={[
              Math.cos((i * Math.PI * 2) / 3) * 1.5,
              Math.sin((i * Math.PI * 2) / 3) * 1.5,
              0,
            ]}
          >
            <Sphere args={[0.2, 32, 32]}>
              <meshStandardMaterial
                color={accentColor}
                emissive={accentColor}
                emissiveIntensity={glowIntensity * 0.4}
                metalness={1}
                roughness={0.1}
                transparent
                opacity={isRevealing ? 1 : 0.5}
              />
            </Sphere>
          </group>
        ))}
      </group>
    </group>
  );
}

export function ThreeDLogoReveal({
  rotationSpeed,
  glowIntensity,
  primaryColor,
  accentColor,
  phase,
}: ThreeDLogoRevealProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 3], fov: 50 }}
      style={{ background: "transparent", width: "100%", height: "100%" }}
      gl={{ transparent: true, antialias: true }}
    >
      <ambientLight intensity={0.9} />
      <pointLight position={[5, 5, 5]} intensity={1.4} color={accentColor} />
      <pointLight position={[-5, -5, 3]} intensity={0.8} color={primaryColor} />
      <pointLight position={[0, 0, 8]} intensity={0.6} />

      <LogoGeometry
        rotationSpeed={rotationSpeed}
        primaryColor={primaryColor}
        accentColor={accentColor}
        glowIntensity={glowIntensity}
        phase={phase}
      />
    </Canvas>
  );
}
