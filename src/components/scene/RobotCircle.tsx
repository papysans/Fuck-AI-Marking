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

/** Vertical FOV of the stage camera. Narrowed from 40° → 34° so the ring reads
 *  as a distant exhibit (less perspective distortion) rather than a wide-angle
 *  "face in your face" shot. */
export const SCENE_FOV = 34;

export interface CameraSetup {
  /** Horizontal (Z) standoff from the ring centre. */
  distH: number;
  /** Camera eye height above the floor. */
  height: number;
  fov: number;
  /** True radial eye→centre distance (drives fog). */
  dist: number;
  /** Visible world height at the ring — the unit head bubbles size against. */
  viewHeight: number;
}

/**
 * Museum framing: stand WELL back and look DOWN into the ring.
 *
 * On-screen size of a robot is proportional to `1 / (dist * tan(fov/2))`, so
 * pulling back alone does nothing if you also widen the lens. The old rig had
 * dist≈16.8 @ fov 40 (`tan20 = .364` → 6.1); this one is dist≈29 @ fov 34
 * (`tan17 = .306` → 8.9), i.e. robots render ~1.45x smaller with the extra
 * space becoming margin on all four sides.
 *
 * Pitch also goes from atan(7.2/15.2) ≈ 25° to atan(16.7/23.8) ≈ 35°, so the
 * viewer looks down INTO the circle (the far robots clear the near ones and the
 * ring reads as a full ellipse instead of a wall of bodies).
 *
 * Both terms still scale with the ring radius plus a mild per-reviewer term, so
 * a bigger jury (wider ring) keeps the same comfortable margin.
 */
export function cameraSetup(radius: number, count: number): CameraSetup {
  const distH = radius * 2.9 + 11 + count * 0.6;
  const height = radius * 1.9 + 9.5;
  const dist = Math.hypot(distH, height);
  const viewHeight =
    2 * Math.tan(THREE.MathUtils.degToRad(SCENE_FOV) / 2) * dist;
  return { distH, height, fov: SCENE_FOV, dist, viewHeight };
}

export function CameraRig({
  radius,
  count,
}: {
  radius: number;
  count: number;
}) {
  const { camera } = useThree();
  useEffect(() => {
    const { distH, height, fov } = cameraSetup(radius, count);
    camera.position.set(0, height, distH);
    // Aim just above the floor (not at chest height) so the whole ellipse of
    // the ring sits centred with headroom for the head bubbles.
    camera.lookAt(0, 0.4, 0);
    if (camera instanceof THREE.PerspectiveCamera) camera.fov = fov;
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
  const { viewHeight } = cameraSetup(R, N);

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
            {/* NOTE: `index` is deliberately NOT forwarded. Ring placement is
                positional, but animation variation must be derived from the
                stable performer.id — otherwise deleting a robot renumbers its
                neighbours and re-triggers their state machines. */}
            <Robot
              performer={p}
              count={N}
              viewHeight={viewHeight}
              reducedMotion={reducedMotion}
            />
          </group>
        );
      })}
    </group>
  );
}
