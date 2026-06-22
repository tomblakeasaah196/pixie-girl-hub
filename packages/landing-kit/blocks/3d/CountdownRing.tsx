// @ts-nocheck
"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";

/**
 * 2.5D countdown ring used on the Before state hero. A subtle ambient
 * torus that slowly rotates, with shimmering colour. Deliberately
 * understated so it never competes with the headline.
 *
 * Loads only on desktop (hidden via CSS on small viewports — see Hero).
 */
export function CountdownRing({ target }: { target: string }) {
  void target;
  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 38 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={1.2} color="#D85C57" />
      <pointLight position={[-5, -5, 5]} intensity={0.6} color="#A81D1D" />
      <RotatingTorus />
    </Canvas>
  );
}

function RotatingTorus() {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.18;
    ref.current.rotation.x += delta * 0.05;
  });
  return (
    <mesh ref={ref} position={[2.2, 0, 0]}>
      <torusGeometry args={[1.6, 0.05, 64, 200]} />
      <meshStandardMaterial
        color="#690909"
        emissive="#A81D1D"
        emissiveIntensity={0.6}
        roughness={0.3}
        metalness={0.7}
      />
    </mesh>
  );
}
