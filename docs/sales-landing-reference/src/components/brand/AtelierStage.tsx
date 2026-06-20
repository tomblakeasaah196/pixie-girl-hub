import { Canvas, useFrame } from "@react-three/fiber";
import { Sparkles, Float, Environment } from "@react-three/drei";
import { useRef, useMemo, Suspense } from "react";
import * as THREE from "three";
import { useBrand } from "./BrandProvider";

function LogoPlane({ url, color }: { url: string; color: string }) {
  const ref = useRef<THREE.Mesh>(null!);
  const texture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const t = loader.load(url);
    t.anisotropy = 8;
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
          map={texture}
          transparent
          metalness={0.4}
          roughness={0.25}
          emissive={new THREE.Color(color)}
          emissiveIntensity={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>
    </Float>
  );
}

function LightShaft({ x, color }: { x: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null!);
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
      <meshBasicMaterial color={color} transparent opacity={0.1} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

function Scene() {
  const { brand } = useBrand();
  return (
    <>
      <color attach="background" args={[brand.three.ink]} />
      <fog attach="fog" args={[brand.three.ink, 5, 14]} />
      <ambientLight intensity={0.35} />
      <spotLight
        position={[3, 4, 5]}
        angle={0.6}
        penumbra={0.8}
        intensity={2.5}
        color={brand.three.accent}
      />
      <spotLight
        position={[-3, -2, 4]}
        angle={0.7}
        penumbra={1}
        intensity={1.2}
        color={brand.three.metal}
      />
      <LightShaft x={-2.5} color={brand.three.accent} />
      <LightShaft x={2.5} color={brand.three.accent} />
      <LightShaft x={0} color={brand.three.accent} />
      <Suspense fallback={null}>
        <LogoPlane url={brand.logo} color={brand.three.accent} />
      </Suspense>
      <Sparkles count={120} scale={[10, 6, 4]} size={3} speed={0.3} color={brand.three.accent} />
      <Sparkles count={40} scale={[6, 4, 2]} size={6} speed={0.15} color={brand.three.metal} />
      <Environment preset="studio" environmentIntensity={0.25} />
    </>
  );
}

export function AtelierStage() {
  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 38 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      className="!absolute inset-0"
    >
      <Scene />
    </Canvas>
  );
}
