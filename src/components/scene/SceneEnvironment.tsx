import { Environment, Lightformer, ContactShadows } from "@react-three/drei";

/**
 * CSP-safe atmosphere. NO `<Environment preset>` (that pulls an HDRI from
 * raw.githack.com and goes black offline). Instead: a fully procedural
 * `<Environment>` lit by a few `<Lightformer>` panels (top key + two colored
 * rim lights) so we get PBR reflections with zero network. Plus one
 * shadow-casting directional light, a soft ambient fill, and a cheap
 * per-frame `<ContactShadows>` ground catcher (accumulative shadows would
 * smear because the robots animate).
 */
export function SceneEnvironment() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
      />

      <Environment resolution={256}>
        {/* top key light — warm cream */}
        <Lightformer intensity={2} position={[0, 5, -2]} scale={[10, 5, 1]} color="#fff5e6" />
        {/* left rim — sky blue */}
        <Lightformer intensity={1} position={[-5, 1, 1]} scale={[3, 6, 1]} color="#5ab4ff" />
        {/* right rim — coral */}
        <Lightformer intensity={1} position={[5, 1, 1]} scale={[3, 6, 1]} color="#ff5c7a" />
      </Environment>

      <ContactShadows
        position={[0, -1, 0]}
        opacity={0.6}
        scale={20}
        blur={2.4}
        far={4}
        resolution={512}
        color="#000000"
      />
    </>
  );
}
