"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

/**
 * 2.5D hero centrepiece for the Live state. A parallax floating disc
 * (representing a wig outline / silhouette) with a slow orbiting glow.
 * In surge mode (final minutes), the orbit speeds up and the colour
 * shifts warmer.
 *
 * Real product photography rides as a CSS-positioned image — the 3D
 * layer adds ambience without obscuring the product.
 */
export function HeroCenterpiece({
  imageUrl,
  surge,
}: {
  imageUrl?: string | null;
  surge?: boolean;
}) {
  void imageUrl;
  return (
    <Canvas
      camera={{ position: [0, 0, 5.5], fov: 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.3} />
      <pointLight
        position={[3, 5, 4]}
        intensity={1.4}
        color={surge ? "#E5544E" : "#D85C57"}
      />
      <pointLight position={[-4, -3, 3]} intensity={0.5} color="#690909" />
      <FloatingScene surge={surge} />
    </Canvas>
  );
}

function FloatingScene({ surge }: { surge?: boolean }) {
  const orbit = useRef<Group>(null);
  const disc = useRef<Group>(null);
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (disc.current) {
      disc.current.position.y = Math.sin(t * 0.6) * 0.2;
      disc.current.rotation.z = Math.sin(t * 0.3) * 0.05;
    }
    if (orbit.current) {
      orbit.current.rotation.y += delta * (surge ? 0.6 : 0.18);
    }
  });
  return (
    <>
      <group ref={disc} position={[2.4, 0, 0]}>
        <mesh>
          <torusKnotGeometry args={[1.0, 0.18, 200, 32, 2, 5]} />
          <meshStandardMaterial
            color={surge ? "#A81D1D" : "#690909"}
            emissive={surge ? "#E5544E" : "#A81D1D"}
            emissiveIntensity={surge ? 0.9 : 0.5}
            metalness={0.85}
            roughness={0.25}
          />
        </mesh>
      </group>
      <group ref={orbit} position={[2.4, 0, 0]}>
        <mesh position={[1.7, 0, 0]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshStandardMaterial
            color="#D85C57"
            emissive="#D85C57"
            emissiveIntensity={1.2}
          />
        </mesh>
      </group>
    </>
  );
}
