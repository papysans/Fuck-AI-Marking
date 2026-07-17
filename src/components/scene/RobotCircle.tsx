import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Robot } from "./Robot";
import type { ScenePerformer } from "./ImmersiveScene";

/**
 * Reviewers arranged on a circle, each facing the center — a face-to-face
 * "argument ring" (N=2 → two facing each other; N≥3 → a ring). Radius grows
 * with N so even a wide Dance pose never overlaps a neighbor. The whole ring
 * slowly self-rotates (~50s/rev) so an outside viewer sees each robot's front
 * in turn; disabled under reduced-motion. React keys by performer.id, so
 * adding/removing a performer mounts/unmounts exactly one robot (its mixer +
 * SkeletonUtils clone included).
 */

/**
 * Radius that keeps adjacent robots apart as the ring grows. Uses the chord
 * rule (min arc-separation `SEP` between neighbours) with a floor, so more
 * reviewers spread onto a visibly wider circle instead of crowding a fixed one
 * (N=3 → roomy, N=6 → wider, never cramped).
 */
export function ringRadius(count: number): number {
  const n = Math.max(count, 2);
  const SEP = 2.3; // desired spacing between adjacent robots
  return Math.max(3.8, SEP / Math.sin(Math.PI / n));
}

/**
 * Camera sits WELL outside the ring, high and looking down — a museum-style
 * "viewing a set of exhibits from a calm distance" framing with margin on all
 * sides. Distance and height both scale with the ring radius, plus a mild
 * per-reviewer term, so the whole circle stays fully in frame with whitespace
 * as robots are added (larger N → wider ring → camera pulls further back).
 */
export function CameraRig({
  radius,
  count,
}: {
  radius: number;
  count: number;
}) {
  const { camera } = useThree();
  useEffect(() => {
    const dist = radius * 2.1 + 6 + count * 0.4; // pull back, grows with N
    const height = radius * 0.8 + 4.2; // raised for a clear top-down angle
    camera.position.set(0, height, dist);
    camera.lookAt(0, 0.6, 0);
    camera.updateProjectionMatrix();
  }, [camera, radius, count]);
  return null;
}

export function RobotCircle({
  performers,
  reducedMotion,
}: {
  performers: ScenePerformer[];
  reducedMotion: boolean;
}) {
  const spin = useRef<THREE.Group>(null);
  const N = performers.length;
  const R = ringRadius(N);

  // Slow carousel spin on the ring group (drag handled by PresentationControls
  // on an outer group, so the two never fight).
  useFrame((_, dt) => {
    if (reducedMotion || !spin.current) return;
    spin.current.rotation.y += dt * ((2 * Math.PI) / 50);
  });

  return (
    <group ref={spin}>
      {performers.map((p, i) => {
        // i=0 starts at the front (+Z); evenly spaced around the circle.
        const angle = N <= 1 ? 0 : (i / N) * Math.PI * 2;
        const x = Math.sin(angle) * (N <= 1 ? 0 : R);
        const z = Math.cos(angle) * (N <= 1 ? 0 : R);
        // Face the center: yaw = angle + π rotates the model's +Z toward origin.
        const rotY = angle + Math.PI;
        return (
          <group key={p.id} position={[x, 0, z]} rotation={[0, rotY, 0]}>
            <Robot
              performer={p}
              index={i}
              count={N}
              reducedMotion={reducedMotion}
            />
          </group>
        );
      })}
    </group>
  );
}
