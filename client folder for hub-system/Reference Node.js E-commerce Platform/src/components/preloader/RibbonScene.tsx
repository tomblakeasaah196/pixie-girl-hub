import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, MeshTransmissionMaterial } from "@react-three/drei";
import { useRef, Suspense } from "react";
import type { Mesh } from "three";

function GoldenKnot() {
  const ref = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 0.35;
    ref.current.rotation.x += dt * 0.08;
  });
  return (
    <Float speed={1.2} rotationIntensity={0.35} floatIntensity={0.6}>
      <mesh ref={ref} scale={1.05}>
        <torusKnotGeometry args={[1, 0.32, 220, 32, 2, 3]} />
        <MeshTransmissionMaterial
          color="#d4b59e"
          thickness={1.4}
          roughness={0.08}
          transmission={0.4}
          ior={1.6}
          chromaticAberration={0.4}
          backside
          anisotropy={1.2}
          distortion={0.2}
          distortionScale={0.4}
          temporalDistortion={0.1}
        />
      </mesh>
    </Float>
  );
}

function Dust() {
  const ref = useRef<Mesh>(null);
  useFrame((s) => {
    if (!ref.current) return;
    ref.current.rotation.y = s.clock.elapsedTime * 0.05;
  });
  const count = 140;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 10;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 6;
  }
  return (
    <points ref={ref as never}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.018} color="#f7e6c8" transparent opacity={0.85} sizeAttenuation />
    </points>
  );
}

export default function RibbonScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 4.2], fov: 38 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#0E0C0A"]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[4, 5, 3]} intensity={2.5} color="#f4d9a8" />
      <directionalLight position={[-3, -2, -2]} intensity={1.1} color="#5a1a1f" />
      <spotLight position={[0, 6, 4]} angle={0.4} penumbra={1} intensity={2} color="#ffe8c4" />
      <Suspense fallback={null}>
        <GoldenKnot />
        <Dust />
        <Environment preset="studio" />
      </Suspense>
    </Canvas>
  );
}
